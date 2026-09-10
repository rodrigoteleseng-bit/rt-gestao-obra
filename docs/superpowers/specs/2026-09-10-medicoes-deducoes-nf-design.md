# Medições (empreiteiros) — Deduções + Dados para Emissão de Nota Fiscal

> Spec de design. Aprovada por Rodrigo em 10/09/2026, decisões coletadas via perguntas de esclarecimento.

## 1. Contexto e pedido original

Rodrigo pediu, com base num modelo real usado na empresa (`MEDIÇÃO BR ENGENHARIA 01.pdf`):

> "nas medições primeiro de terceiros, quero acrescentar DEDUÇÕES, onde seria algo que eu forneci que nao estava no contrato pra descontar na medição, onde teria descrição, quantidade, valor unitario, e valor total [...] nas fichas de medições também é importante ter um quadro fixo com algumas informações que seriam DADOS PARA EMISSAO DE NOTA FISCAL"

Escopo: regime **empreiteiros** de Medições (`/contratos/:id/medicoes`, `/medicoes`), tela `MedicaoForm.tsx` e gerador `medicoesPdf.ts`. O regime Produção própria (`/medicoes` — MP-...) não é afetado.

## 2. Análise do modelo de referência

Estrutura do PDF de referência (texto extraído, ver histórico da sessão para o conteúdo completo):

- Tabela de itens medidos: Descrição, Unidade, Quantidade, Valor Unitário, Valor Total, Valor A Pagar (no exemplo real, Valor Total e Valor A Pagar são sempre idênticos linha a linha).
- Resumo: Valor Bruto Medição → Retenção 5% → **DEDUÇÕES** (tabela: Descrição, Quantidade, Valor Unitário, Valor Total) → Total de Deduções → **Valor a Receber**.
- "Retenção Acumulada" exibida separadamente, como total informativo do contrato até aquela medição.
- **DADOS PARA EMISSÃO DA NOTA FISCAL**: razão social, CNPJ, Endereço, CEP, E-mail, CNO.
- "Avaliação do Fornecedor" (Segurança/Qualidade/Prazo).

Confronto com o que já existe no app (achados, não estimativas):

- `medicoesPdf.ts` já calcula e imprime **"Retenção acumulada do contrato"** (`totalRetidoContrato`, somado de todas as medições aprovadas do contrato) — é o mesmo conceito de "Retenção Acumulada" do modelo. Não precisa ser construído.
- `obras` já tem `cnpj`, `cno_obra`, `endereco_escritorio`, `email` (adicionados na sessão anterior a este pedido). Falta apenas **CEP**.
- Não existe hoje nenhuma tabela equivalente a Deduções.

## 3. Decisões (confirmadas por Rodrigo)

| Pergunta | Decisão |
|---|---|
| Qual endereço no quadro de NF? | **Endereço Escritório** (`obras.endereco_escritorio`), não o endereço da obra |
| Onde registrar o CEP? | **Novo campo dedicado** `obras.cep`, editável em Dados da Obra |
| Quando Deduções são editáveis? | **Mesma trava dos itens** — só em rascunho; travado ao aprovar, sem exceção pra admin |
| Colunas Valor Total / Valor A Pagar na tabela de itens? | **Uma coluna só** — mantém o que já existe, não duplica |
| Bloco "Avaliação do Fornecedor"? | **Fora de escopo** desta entrega |

## 4. Modelo de dados

### 4.1 Campo novo em `obras`

```sql
ALTER TABLE obras ADD COLUMN cep TEXT;
```

Mesmo padrão dos campos cadastrais adicionados antes (nullable, sem mudança de RLS — `obras` já é admin-only pra escrita).

### 4.2 Nova tabela `medicoes_deducoes`

Réplica estrutural de `medicoes_itens` (mesmas colunas de auditoria, mesmo padrão de trigger e RLS), com campos próprios de dedução:

```sql
CREATE TABLE medicoes_deducoes (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  medicao_id     UUID NOT NULL REFERENCES medicoes(id) ON DELETE CASCADE,
  descricao      TEXT NOT NULL,
  quantidade     NUMERIC(14,4) NOT NULL CHECK (quantidade > 0),
  valor_unitario NUMERIC(14,2) NOT NULL CHECK (valor_unitario >= 0),
  valor_total    NUMERIC(14,2) NOT NULL DEFAULT 0,
  ativo          BOOLEAN NOT NULL DEFAULT true,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now(),
  criado_por     UUID NOT NULL DEFAULT auth.uid() REFERENCES perfis_usuario(id)
);

CREATE INDEX idx_medicoes_deducoes_medicao ON medicoes_deducoes(medicao_id);
```

> **Achado durante a análise (não estava na proposta inicial):** os itens de medição usam duas RPCs (`criar_medicao_com_itens`, `salvar_itens_medicao`) com um modelo de edição **fixo** — cada linha corresponde a um `contrato_item_id` existente e só a quantidade é editável, sem inserir/remover linhas depois da criação. Deduções, ao contrário, são uma lista **livre**: o usuário adiciona e remove quantas quiser a qualquer momento em rascunho. O padrão certo pra isso já existe no projeto em `salvar_itens_contrato` (`supabase/migrations/20260717_atomicidade_compras_contratos_medicoes.sql:196-241`) — um array `{id, ...campos, removido}` que insere (sem id), atualiza (com id) ou soft-deleta (`removido=true`) numa única chamada atômica. §4.5 e §5 usam esse padrão, com uma RPC própria pra deduções, em vez de forçar o encaixe nas duas RPCs de itens já auditadas e em produção.

Trigger `calcular_valor_deducao()` (`BEFORE INSERT OR UPDATE`), análogo a `calcular_valor_item_medicao`, mas sem lookup externo — o valor unitário da dedução é digitado direto (não vem de um `contrato_item`):

```sql
CREATE OR REPLACE FUNCTION calcular_valor_deducao() RETURNS TRIGGER AS $$
BEGIN
  NEW.valor_total := NEW.quantidade * NEW.valor_unitario;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER trg_calcular_valor_deducao
  BEFORE INSERT OR UPDATE ON medicoes_deducoes
  FOR EACH ROW EXECUTE FUNCTION calcular_valor_deducao();
```

### 4.3 `recalcular_valor_medicao()` passa a somar deduções

Substitui a função existente (mesma trigger `trg_recalcular_valor_medicao` em `medicoes_itens`, mais uma trigger espelho em `medicoes_deducoes` chamando a mesma função):

```sql
CREATE OR REPLACE FUNCTION recalcular_valor_medicao() RETURNS TRIGGER AS $$
DECLARE
  v_medicao_id  UUID := COALESCE(NEW.medicao_id, OLD.medicao_id);
  v_contrato_id UUID;
  v_retencao    NUMERIC(5,2);
  v_bruto       NUMERIC(14,2);
  v_retido      NUMERIC(14,2);
  v_deducoes    NUMERIC(14,2);
BEGIN
  SELECT contrato_id INTO v_contrato_id FROM medicoes WHERE id = v_medicao_id;
  SELECT COALESCE(retencao_pct, 0) INTO v_retencao FROM contratos WHERE id = v_contrato_id;

  SELECT COALESCE(SUM(valor_total_item), 0) INTO v_bruto
  FROM medicoes_itens WHERE medicao_id = v_medicao_id AND ativo = true;

  SELECT COALESCE(SUM(valor_total), 0) INTO v_deducoes
  FROM medicoes_deducoes WHERE medicao_id = v_medicao_id AND ativo = true;

  v_retido := ROUND(v_bruto * v_retencao / 100, 2);

  UPDATE medicoes SET
    valor_bruto = v_bruto, valor_retido = v_retido, valor_liquido = v_bruto - v_retido - v_deducoes
  WHERE id = v_medicao_id;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER trg_recalcular_valor_medicao_deducoes
  AFTER INSERT OR UPDATE ON medicoes_deducoes
  FOR EACH ROW EXECUTE FUNCTION recalcular_valor_medicao();
```

`valor_liquido` pode ficar negativo se as deduções superarem bruto−retenção — não há trava contra isso (mesma filosofia de "nunca inventar validação para cenário que não foi pedido"; se ocorrer na prática, é um sinal visível no PDF e na tela, não um erro escondido).

### 4.4 RLS — mesma trava de `medicoes_itens`

```sql
ALTER TABLE medicoes_deducoes ENABLE ROW LEVEL SECURITY;

CREATE POLICY med_deducoes_select ON medicoes_deducoes FOR SELECT
  USING ((ativo = true AND meu_papel() = ANY (ARRAY['admin', 'equipe']::papel_usuario[])) OR pode_editar_medicoes());

CREATE POLICY med_deducoes_insert ON medicoes_deducoes FOR INSERT
  WITH CHECK (
    pode_editar_medicoes()
    AND EXISTS (SELECT 1 FROM medicoes m WHERE m.id = medicao_id AND m.status = 'rascunho')
  );

CREATE POLICY med_deducoes_update ON medicoes_deducoes FOR UPDATE
  USING (
    pode_editar_medicoes()
    AND EXISTS (SELECT 1 FROM medicoes m WHERE m.id = medicao_id AND m.status = 'rascunho')
  )
  WITH CHECK (
    pode_editar_medicoes()
    AND EXISTS (SELECT 1 FROM medicoes m WHERE m.id = medicao_id AND m.status = 'rascunho')
  );
```

Igual ao padrão de `medicoes_itens` pós-`20260713_fase7_medicoes_travas.sql`: `USING` e `WITH CHECK` idênticos, checando o status **atual** da medição — uma dedução só é editável enquanto a medição-mãe está em rascunho, sem exceção pra admin. Ao aprovar a medição, toda dedução ativa fica congelada (mesma trava que já existe pros itens).

Sem policy de DELETE — soft delete via UPDATE `ativo=false`, coberto pela policy de update acima (a trava por status continua valendo).

### 4.5 RPC `salvar_deducoes_medicao` (nova)

Réplica do padrão `salvar_itens_contrato` — substitui todo o conjunto de deduções da medição numa única transação, aceitando inserção, edição e remoção (soft delete) na mesma chamada:

```sql
CREATE OR REPLACE FUNCTION salvar_deducoes_medicao(p_medicao UUID, p_deducoes JSONB)
RETURNS VOID LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE v_contrato UUID; v_obra UUID; v_status status_medicao; v_item JSONB; v_id UUID;
BEGIN
  SELECT m.contrato_id,c.obra_id,m.status INTO v_contrato,v_obra,v_status
  FROM medicoes m JOIN contratos c ON c.id=m.contrato_id WHERE m.id=p_medicao AND m.ativo=true FOR UPDATE OF m;
  IF NOT FOUND OR v_status<>'rascunho' THEN RAISE EXCEPTION 'Medicao inexistente ou fora do rascunho.'; END IF;
  IF NOT pode_editar_medicoes() OR NOT pode_acessar_obra(v_obra) THEN RAISE EXCEPTION 'Sem permissao para editar esta medicao.'; END IF;
  IF jsonb_typeof(p_deducoes) <> 'array' THEN RAISE EXCEPTION 'Lista de deducoes invalida.'; END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_deducoes) LOOP
    v_id := NULLIF(v_item->>'id','')::UUID;
    IF v_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM medicoes_deducoes WHERE id=v_id AND medicao_id=p_medicao) THEN
      RAISE EXCEPTION 'Deducao nao pertence a medicao.';
    END IF;
    IF COALESCE((v_item->>'removido')::BOOLEAN,false) THEN
      IF v_id IS NOT NULL THEN UPDATE medicoes_deducoes SET ativo=false WHERE id=v_id; END IF;
      CONTINUE;
    END IF;
    IF NULLIF(v_item->>'descricao','') IS NULL
      OR COALESCE((v_item->>'quantidade')::NUMERIC,0)<=0
      OR COALESCE((v_item->>'valor_unitario')::NUMERIC,0)<0
    THEN RAISE EXCEPTION 'Deducao invalida.'; END IF;

    IF v_id IS NULL THEN
      INSERT INTO medicoes_deducoes (medicao_id,descricao,quantidade,valor_unitario)
      VALUES (p_medicao,v_item->>'descricao',(v_item->>'quantidade')::NUMERIC,(v_item->>'valor_unitario')::NUMERIC);
    ELSE
      UPDATE medicoes_deducoes SET descricao=v_item->>'descricao',
        quantidade=(v_item->>'quantidade')::NUMERIC, valor_unitario=(v_item->>'valor_unitario')::NUMERIC, ativo=true
      WHERE id=v_id;
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION salvar_deducoes_medicao(UUID,JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION salvar_deducoes_medicao(UUID,JSONB) TO authenticated;
```

Diferente de `salvar_itens_contrato`, deduções **podem ficar vazias** (nenhum `RAISE EXCEPTION` de lista mínima) — uma medição sem nenhum fornecimento a descontar é o caso comum, não um erro.

Chamada em dois momentos, sempre como uma segunda chamada depois de `criar_medicao_com_itens`/já dentro do fluxo de edição, não dentro da mesma transação SQL:
- **Criação:** logo após `criar_medicao_com_itens` retornar o novo `medicao_id`, se houver deduções digitadas. Não é a mesma transação, mas o risco é baixo e o estado de falha é benigno — a medição continua em rascunho (nada aprovado, nada travado), e se a segunda chamada falhar a tela mostra o erro sem navegar pra longe, permitindo tentar salvar de novo. Modificar `criar_medicao_com_itens` (RPC já auditada, em produção, usada pelo fluxo de itens que funciona hoje) pra aceitar um segundo array só pra evitar essa segunda chamada foi descartado — risco maior que o benefício.
- **Edição:** junto com `salvar_itens_medicao`, mesma dinâmica (duas chamadas sequenciais, mesmo motivo).

### 4.6 Tipos TypeScript (`src/lib/supabase.ts`)

```ts
export interface Obra {
  // ...campos existentes...
  endereco_escritorio: string | null
  cep: string | null   // novo — inserir logo após endereco_escritorio
  email: string | null
}

export interface MedicaoDeducao {
  id: string
  medicao_id: string
  descricao: string
  quantidade: number
  valor_unitario: number
  valor_total: number
  ativo: boolean
  criado_em: string
  criado_por: string
}
```

## 5. Tela (`src/pages/MedicaoForm.tsx`)

Nova seção "Deduções", abaixo da tabela de itens existente, mesmo padrão de lista-com-linhas-editáveis já usado nesta mesma tela para os itens (`ItemLinha`/`linhas`) e em Contratos/Compras:

- Estado local `DeducaoLinha { id: string | null (temp/persistido), descricao, quantidade, valorUnitario }`, carregado de `medicoes_deducoes` (medição existente) ou vazio (nova medição).
- Botão "+ Adicionar dedução" insere uma linha vazia; cada linha tem um "Remover" que marca a linha para exclusão (soft delete no salvar, igual ao padrão de itens).
- Colunas: Descrição (texto livre), Quantidade, Valor Unitário → Valor Total calculado no cliente para exibição imediata (o valor persistido vem sempre do trigger no banco, nunca do cálculo do cliente — mesmo cuidado já documentado no código de resumo do PDF).
- Seção só renderiza campos editáveis quando `podeEditarItens` (rascunho); em medição aprovada, vira lista somente-leitura (ou fica oculta se vazia).
- Persistência via a nova RPC `salvar_deducoes_medicao` (§4.5): estado local em camelCase (`DeducaoLinha`), convertido para o payload snake_case que a RPC espera no `.rpc()` call — `{id, descricao, quantidade, valor_unitario, removido}` (mesmo padrão de conversão já usado em `salvarNova`/`salvarEdicao` para `contrato_item_id`/`quantidade_periodo`). Linha nova (`id` null) insere, linha existente atualiza, linha marcada `removido` soft-deleta. Chamada como uma segunda chamada logo após `criar_medicao_com_itens` (nova medição) ou `salvar_itens_medicao` (edição) — ver §4.5 sobre por que não é a mesma transação SQL dos itens.
- Resumo em tela (`resumoLinha`, linhas 394-396 hoje: bruto / retenção acumulada / líquido do contrato) não muda de estrutura — `valor_liquido` já vem recalculado do banco incluindo deduções.

## 6. PDF (`src/lib/medicoesPdf.ts`)

### 6.1 Interface `DadosPdfMedicao`

```ts
export interface DadosPdfMedicao {
  // ...campos existentes...
  enderecoObra: string | null
  cidadeObra: string | null
  estadoObra: string | null
  cnpjObra: string | null              // novo
  cnoObra: string | null               // novo
  enderecoEscritorioObra: string | null // novo
  cepObra: string | null                // novo
  emailObra: string | null              // novo
  deducoes: DeducaoPdfMedicao[]         // novo
  // ...resto inalterado...
}

export interface DeducaoPdfMedicao {
  descricao: string
  quantidade: number
  valorUnitario: number
  valorTotal: number
}
```

### 6.2 Bloco Deduções (novo, no resumo)

Entre a faixa "VALOR BRUTO / RETENÇÃO / VALOR LÍQUIDO" (já existe) e o bloco de acumulado do contrato: quando `d.deducoes.length > 0`, uma tabela simples (mesmo estilo visual das linhas de item: navy para cabeçalho, cinza claro pras linhas) com Descrição / Quantidade / Valor Unitário / Valor Total, seguida de uma linha de destaque "Total de Deduções". Quando vazio, o bloco inteiro não aparece (sem tabela vazia poluindo o PDF).

O tile "VALOR LÍQUIDO" já reflete `d.medicao.valor_liquido` (aprovada) ou o recomputo local (rascunho) — como o cálculo de líquido no banco já subtrai deduções (§4.3), nenhuma mudança é necessária nesse tile além de estender o recomputo do rascunho:

```ts
const totalDeducoes = d.deducoes.reduce((s, ded) => s + ded.valorTotal, 0)
const liquido = aprovada ? d.medicao.valor_liquido : bruto - retido - totalDeducoes
```

"Retenção acumulada do contrato" (`totalRetidoContrato`) permanece como está — já é o equivalente funcional de "Retenção Acumulada" do modelo de referência.

### 6.3 Quadro "Dados para Emissão de Nota Fiscal" (novo)

Bloco fixo de texto, inserido após o bloco de acumulado do contrato e antes do rodapé (nova página se não couber, usando o mesmo `precisaLinha`/`novaPagina` já existentes no arquivo). Título em navy, depois pares rótulo/valor:

- Empresa: `d.nomeEmpreendimento ?? d.obraNome`
- CNPJ: `d.cnpjObra ?? '—'`
- Endereço: `d.enderecoEscritorioObra ?? '—'`
- CEP: `d.cepObra ?? '—'`
- E-mail: `d.emailObra ?? '—'`
- CNO: `d.cnoObra ?? '—'`

Campo ausente sempre aparece como "—", nunca omitido da lista (regra de rastreabilidade do projeto — nunca inventar/esconder dado faltante).

### 6.4 Nome do arquivo, numeração, demais blocos

Sem alteração.

## 7. Tela (`src/pages/DadosObra.tsx`)

Novo campo **CEP**, ao lado de ou junto do bloco "Endereço Escritório" já existente (mesmo padrão de `.linha` já usado para CNPJ + CNO Obra):

```tsx
<div className={styles.linha}>
  <label className={styles.campo}>
    Endereço Escritório
    <input value={enderecoEscritorio} onChange={e => setEnderecoEscritorio(e.target.value)} placeholder="Opcional" />
  </label>
  <label className={styles.campo}>
    CEP
    <input value={cep} onChange={e => setCep(e.target.value)} placeholder="Opcional" />
  </label>
</div>
```

Estado, carregamento (`abrirEdicao`/`abrirNovo`) e payload de `salvar()` seguem o mesmo padrão dos quatro campos cadastrais já adicionados.

## 8. `src/pages/MedicaoForm.tsx` — `imprimir()`

Query de `obras` (linha 247 hoje) ganha as colunas novas:

```ts
supabase.from('obras')
  .select('nome, logo_url, rodape_pdf, nome_empreendimento, endereco, cidade, estado, cnpj, cno_obra, endereco_escritorio, cep, email')
  .eq('id', contrato.obra_id).maybeSingle()
```

E o objeto passado a `gerarPdfMedicao` ganha os campos novos (`cnpjObra: obraRow?.cnpj ?? null`, etc.) mais `deducoes`, carregado de `medicoes_deducoes` junto com os itens já carregados hoje (mesma query paralela em `Promise.all`, ou uma query adicional se a medição existir).

## 9. Fora de escopo (explícito)

- Bloco "Avaliação do Fornecedor" (Segurança/Qualidade/Prazo).
- Colunas separadas "Valor Total" / "Valor A Pagar" na tabela de itens.
- Qualquer trava de valor mínimo/máximo sobre deduções (ex.: impedir líquido negativo) — não foi pedido.
- Regime Produção própria — Deduções e Dados de NF só se aplicam ao regime empreiteiros.
