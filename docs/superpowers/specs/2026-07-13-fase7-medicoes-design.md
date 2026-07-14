# Fase 7 — Medições de empreiteiros · Spec de design

> Status: aprovado por Rodrigo em 13/07/2026, aguardando plano de implementação.
> Consome as tabelas de `docs/superpowers/specs/2026-07-13-fase7-contratos-design.md` (Contratos).
> Cobre apenas o regime de **empreiteiros terceirizados por serviço** (contrato → medição por
> item → saldo). O regime de mão de obra direta (produção individual de funcionários próprios)
> fica para uma spec separada — decisão de Rodrigo em 13/07/2026, ao iniciar esta spec.

## 1. Objetivo

Lançar a execução periódica de cada item de um contrato ativo (quantidade executada no
período), acumular o saldo restante frente à quantidade contratada, e calcular o valor a
pagar ao empreiteiro (bruto, retenção e líquido), com aprovação exclusiva do admin e trava de
saldo no banco.

## 2. Modelo de dados

### `status_medicao` (enum novo)

```sql
CREATE TYPE status_medicao AS ENUM ('rascunho', 'aprovada');
```

Só duas etapas (mais simples que `status_contrato`): equipe lança e edita em rascunho; admin
aprova. Sem retorno de `aprovada` para `rascunho`, sem exceção pra admin — mesma lógica de
`contratos`.

O valor `'medicoes'` no enum `modulo_app` **já existe** (adicionado preventivamente em
`20260707_fase7_modulos_extras_enum.sql`, nunca usado até agora) — nenhuma migração necessária
para isso.

### `medicoes_seq` (contador sequencial por contrato)

```sql
CREATE TABLE medicoes_seq (
  contrato_id   UUID PRIMARY KEY REFERENCES contratos(id) ON DELETE CASCADE,
  ultimo_numero INTEGER NOT NULL DEFAULT 0
);
```

Diferente de `contratos_seq` (que é por obra), aqui o contador é **por contrato**: a 1ª medição
do CT-003 e a 1ª medição do CT-005 podem coexistir. Criado sob demanda (`ON CONFLICT DO NOTHING`)
na primeira medição do contrato, mesmo padrão de `proximo_numero_contrato()`.

### `medicoes` (cabeçalho)

```sql
CREATE TABLE medicoes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contrato_id     UUID NOT NULL REFERENCES contratos(id),
  numero          INTEGER NOT NULL,             -- 1, 2, 3... gerado por trigger, por contrato
  data_referencia DATE NOT NULL,
  status          status_medicao NOT NULL DEFAULT 'rascunho',
  valor_bruto     NUMERIC(14,2) NOT NULL DEFAULT 0,  -- somado de medicoes_itens
  valor_retido    NUMERIC(14,2) NOT NULL DEFAULT 0,  -- valor_bruto × contrato.retencao_pct
  valor_liquido   NUMERIC(14,2) NOT NULL DEFAULT 0,  -- valor_bruto − valor_retido
  aprovada_por    UUID REFERENCES perfis_usuario(id),
  aprovada_em     TIMESTAMPTZ,
  ativo           BOOLEAN NOT NULL DEFAULT true,     -- soft delete (só rascunho, ver §5)
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
  criado_por      UUID NOT NULL DEFAULT auth.uid() REFERENCES perfis_usuario(id),
  UNIQUE (contrato_id, numero)
);
```

### `medicoes_itens`

```sql
CREATE TABLE medicoes_itens (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  medicao_id          UUID NOT NULL REFERENCES medicoes(id) ON DELETE CASCADE,
  contrato_item_id    UUID NOT NULL REFERENCES contratos_itens(id),
  quantidade_periodo  NUMERIC(14,4) NOT NULL,   -- aceita fração (ex.: 1,2)
  valor_total_item    NUMERIC(14,2) NOT NULL,   -- quantidade_periodo × contratos_itens.valor_unitario
  ativo               BOOLEAN NOT NULL DEFAULT true,
  criado_em           TIMESTAMPTZ NOT NULL DEFAULT now(),
  criado_por          UUID NOT NULL DEFAULT auth.uid() REFERENCES perfis_usuario(id)
);
```

Não guarda `servico_id`/`unidade_id` próprios — sempre herda de `contrato_item_id`. Isso também
evita repetir o autocomplete de serviço (e o bug de paginação de 1000 linhas corrigido hoje em
Contratos/Compras): a lista de itens de uma medição vem sempre do próprio contrato, que tem no
máximo algumas dezenas de itens.

`valor_total_item` é calculado por trigger `BEFORE INSERT OR UPDATE` (lê `valor_unitario` do
`contratos_itens` referenciado). `medicoes.valor_bruto`/`valor_retido`/`valor_liquido` são
recalculados por trigger `AFTER INSERT OR UPDATE` em `medicoes_itens`, mesmo padrão de
`recalcular_valor_contrato()`.

## 3. Numeração

Trigger `proximo_numero_medicao()` (`SECURITY DEFINER`, `BEFORE INSERT` em `medicoes`): garante
linha em `medicoes_seq` para o `contrato_id`, incrementa `ultimo_numero` e grava
`NEW.numero := ultimo_numero`. Sem policy de INSERT/UPDATE direta em `medicoes_seq` — só a
function escreve (mesmo padrão de `contratos_seq`).

## 4. Trava de saldo (regra central)

Ao aprovar uma medição (transição `rascunho → aprovada`), um trigger `BEFORE UPDATE` em
`medicoes` verifica, para cada item ativo da medição:

```
quantidade contratada (contratos_itens.quantidade)
  >= soma de quantidade_periodo de TODAS as medições já aprovadas do mesmo contrato_item_id
     (excluindo esta, que ainda não estava aprovada)
   + quantidade_periodo desta medição
```

Se ultrapassar, a transação inteira é bloqueada com `RAISE EXCEPTION` — **sem exceção nem para
admin**. Rascunhos não contam para o saldo (podem ser ajustados ou descartados livremente); só
o que está `aprovada` consome a quantidade contratada. Se for necessário medir mais do que o
contratado, o caminho é aditivar o contrato primeiro (aumentar a quantidade do item enquanto ele
permitir edição), não forçar a medição.

## 5. Telas

- **Dentro do detalhe do contrato** (`/contratos/:id`), quando `status = 'ativo'`: nova seção
  "Medições" listando as medições já lançadas (número, data, valor líquido, chip de status) +
  botão "+ Nova medição".
- **Nova medição** (`/contratos/:id/medicoes/nova`): pré-lista automaticamente todos os itens
  ativos do contrato (sem busca/autocomplete — vêm prontos), um campo "quantidade executada
  neste período" por item (aceita decimais), mostrando ao lado quantidade já aprovada
  anteriormente e saldo restante após esta medição. Salva sempre como `rascunho`.
- **Detalhe da medição** (`/contratos/:id/medicoes/:medicaoId`): tabela de itens (serviço,
  unidade, qtd. contratada, qtd. já aprovada antes, qtd. deste período, saldo, valor unit.,
  valor total do item), resumo (bruto / retido / líquido); em `rascunho`: editar itens,
  "Aprovar medição" (admin only, dispara a trava de saldo); em `aprovada`: somente leitura +
  "Imprimir PDF".
- **Lista global `/medicoes`** (substitui o placeholder "Em construção" atual): todas as
  medições de todos os contratos, filtro por status/empreiteiro/contrato, atalho para o
  detalhe de cada uma. Menu "Medições" já existe em `Layout.tsx` apontando para essa rota.

## 6. PDF

Documento com identidade RT: cabeçalho (contrato, empreiteiro, número e data da medição),
tabela de itens (serviço, unidade, qtd. contratada, qtd. medida antes, qtd. deste período,
saldo, valor unit., valor total) e resumo (bruto / retido / líquido). Sem assinatura digital
nesta primeira versão — documento de registro/conferência, não peça que exija assinatura
formal ainda (diferente de RDO/FVS).

## 7. Permissões e RLS

- Reaproveita o módulo `medicoes` já existente no enum `modulo_app` (checkbox em Usuários).
- `pode_editar_medicoes()`: `true` para admin, ou para equipe com `medicoes` no array de
  módulos do perfil — mesmo padrão de `pode_editar_contratos()`.
- Criar/editar medição em rascunho: admin ou equipe com módulo `medicoes`, e só se o contrato
  estiver `ativo`.
- Aprovar (`rascunho → aprovada`): **exclusivo admin**, disparando a trava de saldo do §4.
- Itens de medição (`medicoes_itens`) só editáveis enquanto a medição está em `rascunho` —
  trava tanto na tela quanto no RLS, **sem exceção para admin** (lição aplicada desde o início,
  aprendida com o bug de bypass de admin corrigido em Contratos no mesmo dia).
- SELECT em `medicoes`/`medicoes_itens`: admin e equipe autenticados (leitura ampla, como em
  Contratos). **Cliente não tem acesso** — mesma regra de Contratos (dado de custo/fornecedor).
- Regra de soft delete (CLAUDE.md §3): toda policy de SELECT que filtra por `ativo = true`
  inclui desde o início `OR pode_editar_medicoes()`.
- Soft delete de medição: só permitido em `rascunho` (mesma lógica de contrato/item — depois
  de aprovada, o registro é permanente, sem inativação).

## 8. Rastreabilidade

Todo registro grava `criado_por`/`criado_em`. Aprovação grava `aprovada_por`/`aprovada_em` —
nada se sobrescreve, seguindo CLAUDE.md §6.

## 9. Fora de escopo (deferido)

- **Regime de mão de obra direta** (produção individual de funcionários próprios, medição para
  gerar pagamento por produção) — spec separada futura.
- **Lançamento financeiro real** (pagamento) — Financeiro (Fase 3) ainda não existe; a medição
  aprovada só registra o valor líquido a pagar. Integração vem quando a Fase 3 for construída
  (amarração já prevista no CLAUDE.md §5: "avanço aprovado → medição liberada → lançamento
  financeiro").
- **Anexo de comprovante/documento assinado da medição** — pedido explicitamente adiado pelo
  Rodrigo nesta mesma conversa, para tratar depois num módulo próprio de anexos/documentos.
- **Vínculo automático com Avanço Físico do Cronograma** — decisão de Rodrigo em 13/07/2026:
  quantidade executada é sempre digitada manualmente na medição, não puxada do avanço.
- Edição do cabeçalho da medição (data de referência) após aprovada, e exclusão de medição
  aprovada pela tela — permanente por design (ver §7).

## 10. Critérios de aceite

- [ ] Funciona no celular e desktop.
- [ ] Admin (ou equipe com módulo `medicoes`) cria medição em rascunho dentro de um contrato
      ativo, lança quantidade executada por item (incluindo valores fracionados), salva.
- [ ] Aprovação exclusiva do admin; equipe com módulo não vê botão de aprovar.
- [ ] Trava de saldo bloqueia aprovação que ultrapasse a quantidade contratada de qualquer
      item, mesmo tentando como admin.
- [ ] Retenção calculada corretamente (bruto / retido / líquido) a partir do `retencao_pct` do
      contrato.
- [ ] Itens de medição aprovada são imutáveis (testado tentando editar via tela e via API).
- [ ] Cliente não vê `/medicoes` nem as rotas de contrato/medições.
- [ ] Numeração sequencial por contrato (1, 2, 3...) sem colisão entre contratos diferentes.
- [ ] PDF gera com os valores corretos (bruto/retido/líquido) e identidade RT.
- [ ] Migração versionada em `supabase/migrations`.
- [ ] Rodrigo testou com uma medição real de um contrato ativo e deu aceite.
