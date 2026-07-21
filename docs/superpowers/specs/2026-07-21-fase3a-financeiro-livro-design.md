# Fase 3a — Financeiro: Livro de lançamentos · Spec de design

> Status: aprovado por Rodrigo em 21/07/2026, aguardando plano de implementação.
> Escopo: **só o livro financeiro** (lançamentos, contas a pagar, gasto avulso). Curva S,
> previsto×realizado e projeção de custo final ficam para a **Fase 3b**, spec separada, que
> consome o que esta fase produz — decisão explícita do Rodrigo em 21/07/2026 (dividir em duas
> entregas sequenciais em vez de uma spec só).

## 1. Objetivo

Hoje, Contratos+Medições (empreiteiros e produção própria) e Compras/NF já calculam o valor de
cada gasto quando são aprovados — mas nenhum desses módulos gera um lançamento financeiro
propriamente dito. O valor fica preso dentro do próprio módulo de origem, sem virar contas a
pagar, sem data de vencimento, sem baixa de pagamento, sem consolidação contra o orçamento. Esta
fase cria o livro que:

1. **Ingere automaticamente** o valor já calculado quando uma medição é aprovada ou uma NF é
   conferida — sem retrabalho de digitar de novo (decisão do Rodrigo em 21/07/2026).
2. **Separa custo incorrido de pagamento** — o lançamento nasce como "a pagar" e só vira "pago"
   quando alguém dá baixa manual com data real, forma de pagamento e conta usada (decisão do
   Rodrigo em 21/07/2026 — cobre fluxo de caixa de verdade, não só reconhecimento de custo).
3. **Aceita lançamento avulso manual** para gastos que não passam por nenhum módulo existente —
   taxas, licenças, seguros, despesas administrativas (decisão do Rodrigo em 21/07/2026).

## 2. Levantamento do estado real (base de toda decisão abaixo)

Consultado direto no banco de produção (projeto `rt-gestao-obra`) em 21/07/2026, não estimado:

- **Orçamento:** 3.475 serviços ativos, R$ 10.413.111,11 no total.
- **Contratos:** 1 contrato ativo/encerrado, R$ 201.500,00.
- **Medições de empreiteiro aprovadas:** 1, R$ 96.448,75 líquidos.
- **Medições de produção própria aprovadas/pagas:** 0.
- **Pedidos de compra além de rascunho:** 2.
- **Itens de pedido com `valor_recebido` preenchido:** 0 — ver §5 (gap encontrado).
- **Canteiro de Obras já tem etapas próprias para gasto administrativo/taxas:** `2.1 PROJETOS
  GRÁFICOS E SERVIÇOS TÉCNICOS` (R$ 169.086,00), `2.2 TAXAS/IMPOSTOS` (R$ 575.443,95),
  `2.4 CUSTOS ADMINISTRATIVOS LOCAL` (R$ 893.610,00), `2.6 CONSUMOS` (R$ 103.661,16),
  `2.7 MANUTENÇÃO PÓS OBRA` (R$ 154.223,67) — o lançamento avulso vincula nessas etapas já
  existentes, sem precisar criar categoria nova.
- **Módulo `financeiro` já existe no enum `modulo_app`** (adicionado preventivamente, mesmo
  padrão já usado para `contratos` antes de o módulo existir) — **nenhuma migração de enum
  necessária**, evita o risco já documentado de `ALTER TYPE ... ADD VALUE` em transação (ver
  CLAUDE.md §0, armadilha registrada).
- **`CronogramaTarefa.servico_id` já existe** e `src/lib/cronograma.ts:2-3` já tem um comentário
  deixado de propósito: *"Peso das tarefas na Curva S = duração prevista [estimado — migra para
  valor (R$) quando houver de-para com o orçamento, Fase 3]"* — confirma que o de-para
  cronograma↔orçamento já está pronto para a Fase 3b consumir; não é escopo desta fase, só
  registrado aqui para não se perder o contexto.

## 3. Modelo de dados

### `status_lancamento_financeiro` (enum novo)

```sql
CREATE TYPE status_lancamento_financeiro AS ENUM ('a_pagar', 'pago');
```

### `lancamentos_financeiros` (tabela nova)

```sql
CREATE TABLE lancamentos_financeiros (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  obra_id             UUID NOT NULL REFERENCES obras(id) ON DELETE CASCADE,
  unidade_id          UUID REFERENCES unidades(id),
  etapa_id            UUID REFERENCES etapas(id),          -- nullable: ver "fila a classificar" abaixo
  servico_id          UUID REFERENCES servicos(id),      -- nullable: nem todo gasto avulso desce até serviço
  descricao           TEXT NOT NULL,
  favorecido          TEXT NOT NULL,                      -- fornecedor/empreiteiro/profissional/prestador
  valor               NUMERIC(14,2) NOT NULL CHECK (valor > 0),

  -- origem: exatamente um preenchido, ou nenhum (avulso) — FK tipada, não ponteiro genérico
  medicao_item_id       UUID REFERENCES medicoes_itens(id),
  pedido_item_id        UUID REFERENCES pedidos_compra_itens(id),
  producao_medicao_id   UUID REFERENCES producao_medicoes(id),
  CONSTRAINT origem_unica CHECK (
    (CASE WHEN medicao_item_id     IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN pedido_item_id      IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN producao_medicao_id IS NOT NULL THEN 1 ELSE 0 END) <= 1
  ),

  status              status_lancamento_financeiro NOT NULL DEFAULT 'a_pagar',
  data_vencimento      DATE,                              -- nasce em aberto (ver §6), preenchida depois
  data_pagamento       DATE,
  forma_pagamento      TEXT,                              -- texto livre: PIX, boleto, transferência, dinheiro…
  conta_origem         TEXT,                               -- texto livre: qual conta/banco pagou
  observacao          TEXT,

  ativo               BOOLEAN NOT NULL DEFAULT true,
  criado_por          UUID NOT NULL DEFAULT auth.uid() REFERENCES perfis_usuario(id),
  criado_em           TIMESTAMPTZ NOT NULL DEFAULT now(),
  pago_por            UUID REFERENCES perfis_usuario(id),
  pago_em             TIMESTAMPTZ,
  CHECK (status = 'a_pagar' OR (data_pagamento IS NOT NULL AND forma_pagamento IS NOT NULL))
);

CREATE INDEX idx_lancamentos_obra_vencimento
  ON lancamentos_financeiros(obra_id, data_vencimento)
  WHERE ativo AND status = 'a_pagar';
```

Decisões de modelagem, explicadas:

- **FK tipada por origem, não `origem_tipo`/`origem_id` genérico** — nenhuma outra tabela deste
  projeto usa ponteiro polimórfico (Contratos, Medições, Produção própria sempre usam FK real);
  manter o padrão evita perder integridade referencial do Postgres. `CONSTRAINT origem_unica`
  garante no máximo uma origem marcada — zero origens marcadas = lançamento avulso.
- **`etapa_id` e `servico_id` nullable, mas com um limite:** a regra mestre do CLAUDE.md §4 exige
  vínculo até ETAPA no mínimo — porém `pedidos_compra_itens` **não tem coluna de etapa**, só
  `servico_id` (nullable, para o caso "a classificar"). Um item de Compras "a classificar" não
  tem de onde derivar etapa nenhuma, e **itens de pedido travam assim que o pedido sai do
  rascunho** (nunca mais editáveis em Compras — `fase6_compras.md`). Isso significa que um item
  "a classificar" fica sem correção possível em Compras para sempre, mas o dinheiro ainda
  precisa ser rastreado (contas a pagar reais). Solução: `etapa_id`/`servico_id` nascem `NULL`
  nesse caso — o lançamento existe (valor, favorecido, vencimento, pagamento funcionam
  normalmente) mas fica marcado como **"fila a classificar"** na lista (§8), e o Financeiro
  ganha a única ação capaz de completar esse vínculo depois (edição de etapa/serviço no
  lançamento, permitida enquanto `status = 'a_pagar'`) — já que Compras não pode mais fazer isso.
  Lançamentos originados de medição sempre têm `servico_id`/`unidade_id` (os itens de contrato
  de origem já têm os dois preenchidos). Um lançamento avulso pode ficar só em etapa se o gasto
  não descer a um serviço específico (ex.: "custos administrativos" genérico).
- **`unidade_id` nullable** — nem todo serviço do orçamento pertence a uma unidade específica de
  forma útil pro lançamento (ex.: serviços de Canteiro de Obras já carregam a unidade "Canteiro"
  via etapa, mas itens de contrato trazem `unidade_id` próprio junto com `servico_id`
  em `contratos_itens` — usar esse valor quando vier de medição).
- **`CHECK (status = 'a_pagar' OR (...))`** — trava no banco que uma baixa de pagamento nunca
  fica incompleta (não dá pra marcar `pago` sem data e forma de pagamento), sem depender só da
  tela pra garantir isso.
- **RLS de soft delete desde o início:** `ativo` já nasce preparado para a regra do CLAUDE.md §3
  (SELECT com `ativo = true OR pode_editar_financeiro()`, nunca só `ativo = true`) — ver §7.

## 4. Ingestão automática por origem

### Medições de empreiteiro (aprovada → 1 lançamento por item)

Trigger em `AFTER UPDATE ON medicoes` (quando `status` transiciona para `'aprovada'`), inserindo
um `lancamentos_financeiros` por linha de `medicoes_itens` ativa daquela medição:

- `valor` = `medicoes_itens.valor_total_item × (medicoes.valor_liquido / medicoes.valor_bruto)` —
  reaproveita a proporção líquido/bruto já calculada no cabeçalho (não recalcula retenção do
  zero, evita divergir da matemática que Medições já valida).
- `servico_id`/`unidade_id` = os mesmos de `contratos_itens` referenciado por
  `medicoes_itens.contrato_item_id` (contrato já guarda serviço × unidade por item).
- `favorecido` = nome do empreiteiro do contrato.
- `medicao_item_id` = a origem.

### Produção própria (aprovada/paga → 1 lançamento por medição)

Trigger em `AFTER UPDATE ON producao_medicoes` (transição para `'aprovada'`):

- `valor` = `producao_medicoes.valor_total`.
- `favorecido` = nome do trabalhador (ou "Equipe de produção própria — período X" se a medição
  cobrir mais de um profissional, a confirmar no detalhamento técnico).
- `etapa_id` = **decisão a confirmar no plano técnico** — uma medição de produção própria pode
  cobrir paredes de serviços diferentes no mesmo período; vincular só até ETAPA (não SERVIÇO)
  é a opção mais segura dado o que já existe hoje em `producao_paredes_progresso`, mas precisa
  de checagem no schema antes de fechar isso na implementação.
- `producao_medicao_id` = a origem.

### Compras (NF conferida → 1 lançamento por item)

**Pré-requisito que esta fase precisa resolver antes do gatilho funcionar (achado em
21/07/2026):** `pedidos_compra_itens.valor_recebido` existe na tabela e já é **lido** na tela de
conferência tripla (`CompraForm.tsx:958,977`), mas **nunca é escrito** — a tela "Conferência com
nota fiscal" hoje só anexa o arquivo da NF e uma observação (`registrarNf()`), sem nenhum campo
para digitar o valor por item. Confirmado no banco: 0 itens com `valor_recebido` preenchido em
produção. **Esta fase inclui, como pré-requisito em Compras, adicionar um campo de valor por
item na tela de conferência de NF** — sem isso, o trigger de ingestão não tem dado real para
disparar.

Com esse campo existindo, o trigger (`AFTER UPDATE ON pedidos_compra_itens`, quando
`valor_recebido` passa de `NULL` para preenchido):

- `valor` = `pedidos_compra_itens.valor_recebido`.
- `servico_id`/`etapa_id` = derivados do `servico_id` do item quando presente; se o item ficou
  "a classificar" (`servico_id = NULL` — e `pedidos_compra_itens` não tem nenhuma coluna de
  etapa própria), os dois nascem `NULL` e o lançamento entra na "fila a classificar" (§3, §9) —
  resolvido nesta spec, não é mais decisão em aberto.
- `favorecido` = nome do fornecedor vencedor da cotação daquele item.
- `pedido_item_id` = a origem.

### Regra comum às três origens

Todo lançamento automático nasce com `status = 'a_pagar'` e **`data_vencimento = NULL`**
(decisão do Rodrigo em 21/07/2026 — condição de pagamento em Compras/Contratos é texto livre,
não dá pra calcular vencimento de forma confiável a partir disso; melhor ficar em aberto e
sinalizado como pendente do que adivinhar errado). A tela de lançamentos destaca visualmente
todo item com vencimento não preenchido, para alguém completar.

## 5. Lançamento avulso (manual)

Formulário simples: descrição, favorecido, valor, vínculo Unidade→Etapa→Serviço (reaproveitando
o componente `AplicacaoCascata` já construído para Compras em 21/07/2026 — mesmo padrão de
cascata digitável, mesmas tabelas `unidades`/`etapas`/`servicos`), data de vencimento (aqui sim
obrigatória, já que não há automação para inferir) e observação opcional. `medicao_item_id`,
`pedido_item_id` e `producao_medicao_id` ficam todos `NULL`.

## 6. Ciclo de pagamento

- **`a_pagar`** — estado inicial, sempre. Editável (corrigir vencimento, favorecido, valor antes
  de pagar) por quem tem o módulo `financeiro`.
- **`pago`** — baixa manual: preenche `data_pagamento`, `forma_pagamento`, `conta_origem`,
  grava `pago_por`/`pago_em`. **Imutável depois de paga** — mesmo padrão já usado em
  `ferramenta_emprestimos` (devolução) e reforçado na revisão de Aluguel de Ferramentas em
  21/07/2026: a policy de UPDATE trava quando `status = 'pago'`, sem exceção nem para admin.
- **Alertas de vencimento** — mesmo padrão visual já revisado e aprovado em Aluguel de
  Ferramentas (21/07/2026): vencida / vence hoje / vence amanhã, usando a mesma função
  `diasEntre`/`dataHoje` de `src/lib/almoxarifado.ts` (ou promovida para um lugar compartilhado,
  já que deixa de ser exclusiva do Almoxarifado — a confirmar no plano técnico).

## 7. RLS e permissões

- **Módulo `financeiro`** (já existe no enum, ver §2) — checkbox em Usuários, mesmo padrão de
  todos os outros módulos.
- `pode_editar_financeiro()`: `meu_papel() = 'admin' OR (meu_papel() = 'equipe' AND 'financeiro'
  = ANY(meus_modulos()))` — mesma fórmula usada em `pode_editar_almoxarifado()` e afins,
  `SET search_path = public` desde a criação (não repetir o gap fechado em 19/07/2026).
- **SELECT:** `ativo = true OR pode_editar_financeiro()` — cláusula OR desde o início (regra do
  CLAUDE.md §3, evita repetir o fix crítico de 13/07/2026).
- **UPDATE:** `pode_editar_financeiro() AND status = 'a_pagar'` na `USING`, `WITH CHECK
  (pode_editar_financeiro())` — trava de imutabilidade pós-pagamento (§6).
- **INSERT manual (avulso):** `pode_editar_financeiro() AND criado_por = auth.uid()`.
- **INSERT automático (triggers):** roda como `SECURITY DEFINER` das funções de ingestão, não
  depende de policy de INSERT do usuário que aprovou a medição/conferiu a NF.
- **Isolamento por obra:** policy `RESTRICTIVE FOR ALL` com `pode_acessar_obra(obra_id)`, mesmo
  padrão de toda tabela nova desde a auditoria de 17/07/2026.
- **Cliente não vê o livro** (decisão do Rodrigo em 21/07/2026) — mesmo padrão de
  Contratos/Medições/Compras. Só verá quando a Fase 3b (visão agregada) existir.

## 8. Interface

Tela nova `/financeiro`, visível no menu só para quem tem acesso ao módulo. Lista de
lançamentos com:

- Filtro por status (a pagar / pago), por etapa/unidade, por texto (descrição/favorecido).
- Alertas de vencidos/vencendo hoje/amanhã no topo, mesmo padrão visual de Aluguel de
  Ferramentas.
- Botão "+ Lançamento avulso" abrindo o formulário do §5.
- Cada linha mostra origem (badge "Medição CT-001 nº 2", "Pedido 067", "Produção própria",
  "Avulso") com link pro registro de origem quando existir.
- Ação "Dar baixa" (preenche pagamento) e "Editar" (só enquanto `a_pagar`) por linha.

## 9. Casos de borda

- **Item "a classificar" de Compras** (sem `servico_id`, e sem nenhuma coluna de etapa na
  origem) — o trigger ainda cria o lançamento (não pode travar o fluxo de Compras por causa do
  Financeiro, e o valor ainda precisa virar conta a pagar real), com `etapa_id`/`servico_id`
  ambos `NULL` e sinalizado na lista como "fila a classificar". Como o item de origem em Compras
  trava assim que o pedido sai do rascunho (nunca mais editável lá), a única forma de completar
  o vínculo depois é editando etapa/serviço direto no lançamento (permitido enquanto
  `a_pagar` — ver §3).
- **Medição/pedido cancelado depois de gerar lançamento** — hoje nem Medições nem Compras têm
  fluxo de "cancelar após aprovado" que desfaça o valor; se isso vier a existir, o lançamento
  correspondente precisa ser inativado (nunca apagado) por uma ação equivalente — fora do escopo
  desta fase, registrado para não esquecer.
- **Backfill do que já foi aprovado antes desta fase existir** (1 medição de R$ 96.448,75 já
  aprovada) — decisão do Rodrigo: gerar o lançamento retroativo dessa medição já aprovada, ou só
  capturar aprovações a partir da entrada em produção desta fase? **Pendente de confirmação no
  plano técnico.**
- **Retenção com `contratos.retencao_pct` nulo** — `medicoes.valor_bruto = valor_liquido` nesse
  caso (já é como Medições calcula hoje), a proporção do §4 vira 1:1, sem tratamento especial
  necessário.

## 10. Fora de escopo desta fase (fica para depois, com decisão própria)

- Curva S, previsto×realizado e projeção de custo final — **Fase 3b**, spec separada.
- Parcelamento de um único gasto em várias datas de vencimento — cada lançamento é atômico (um
  valor, um vencimento); parcelar hoje significa lançar avulso mais de uma vez.
- Cálculo automático de vencimento a partir da condição de pagamento (texto livre) — ver §4.
- Reajuste/correção monetária (INCC) do orçamento previsto ao longo do tempo.
- Conciliação bancária automática (importar extrato, casar com lançamento).
- Edição ou estorno de um lançamento já pago — imutável por design (§6); reversão sempre por
  lançamento novo, nunca por edição do antigo.
- Notificação por e-mail/push de vencimento — só alerta visual na tela, mesmo escopo do que já
  existe para ferramentas em atraso/locação vencida.
