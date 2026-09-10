# Medições — Deduções + Dados para Emissão de Nota Fiscal — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a free-form "Deduções" line-item table to Medições (regime empreiteiros) that subtracts from the medição's valor líquido, and a fixed "Dados para Emissão de Nota Fiscal" block on the medição PDF, per the approved spec.

**Architecture:** New table `medicoes_deducoes` (soft-deletable, same rascunho-only edit trava as `medicoes_itens`), a new RPC `salvar_deducoes_medicao` (free add/remove/edit, same pattern as `salvar_itens_contrato`), an updated `recalcular_valor_medicao()` trigger that also subtracts active deduções, and a new `cep` column on `obras`. The PDF generator and `MedicaoForm.tsx` are extended to load, edit, and print the new data.

**Tech Stack:** Supabase Postgres/RLS/plpgsql, React 19 + TypeScript, jsPDF.

**Spec:** `docs/superpowers/specs/2026-09-10-medicoes-deducoes-nf-design.md` — read it if anything below is ambiguous; it has the full rationale for each design choice.

## Global Constraints

- Endereço no quadro de NF vem de `obras.endereco_escritorio` (não `endereco`).
- CEP é campo novo dedicado (`obras.cep`), não embutido em texto de endereço.
- Deduções seguem a mesma trava de `medicoes_itens`: editável só quando a medição está em `rascunho`; travado ao aprovar, sem exceção pra admin.
- Tabela de itens do PDF mantém uma única coluna de valor (não duplicar Valor Total / Valor A Pagar).
- Bloco "Avaliação do Fornecedor" está fora de escopo — não implementar.
- Toda policy de SELECT com `ativo = true` precisa do `OR pode_editar_medicoes()` (regra de soft delete do projeto, CLAUDE.md §3).
- Toda `SECURITY DEFINER`/função privilegiada precisa `SET search_path = public`.
- Nada se apaga — soft delete via `ativo = false`, nunca `DELETE`.

---

### Task 1: Migração — `obras.cep`, tabela `medicoes_deducoes`, trigger de recálculo, RLS, RPC

**Files:**
- Create: `supabase/migrations/20260910_medicoes_deducoes_nf.sql`

**Interfaces:**
- Produces: tabela `medicoes_deducoes(id, medicao_id, descricao, quantidade, valor_unitario, valor_total, ativo, criado_em, criado_por)`; coluna `obras.cep TEXT`; função `salvar_deducoes_medicao(p_medicao UUID, p_deducoes JSONB) RETURNS VOID`, chamável via `supabase.rpc('salvar_deducoes_medicao', {...})` com payload snake_case `{id, descricao, quantidade, valor_unitario, removido}[]`; `medicoes.valor_liquido` passa a refletir `bruto - retido - soma(deducoes ativas)`.

- [ ] **Step 1: Escrever a migração completa**

```sql
-- Deduções em Medições (regime empreiteiros): algo fornecido pelo RT que
-- não estava no contrato, descontado da medição — descrição, quantidade,
-- valor unitário, valor total. Mesma trava de rascunho de medicoes_itens
-- (sem exceção pra admin). Também adiciona obras.cep, usado no quadro
-- "Dados para Emissão de Nota Fiscal" do PDF junto com cnpj/cno_obra/
-- endereco_escritorio/email (já existentes).
-- Ver docs/superpowers/specs/2026-09-10-medicoes-deducoes-nf-design.md.

ALTER TABLE obras ADD COLUMN cep TEXT;

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

-- Calcula valor_total da dedução — sem lookup externo, o valor unitário
-- é digitado direto (diferente de medicoes_itens, que busca no contrato).
CREATE OR REPLACE FUNCTION calcular_valor_deducao() RETURNS TRIGGER AS $$
BEGIN
  NEW.valor_total := NEW.quantidade * NEW.valor_unitario;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER trg_calcular_valor_deducao
  BEFORE INSERT OR UPDATE ON medicoes_deducoes
  FOR EACH ROW EXECUTE FUNCTION calcular_valor_deducao();

-- recalcular_valor_medicao() passa a subtrair deduções ativas do líquido.
-- Substitui a função existente (a trigger em medicoes_itens continua
-- apontando pra ela); nova trigger espelho em medicoes_deducoes chama a
-- mesma função.
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

-- RLS — mesma trava de medicoes_itens: editável só em rascunho, sem
-- exceção pra admin fora disso. Regra de soft delete do projeto: SELECT
-- com ativo=true sempre tem "OR pode_editar_medicoes()".
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

-- RPC de escrita em lote (padrão salvar_itens_contrato): insere (sem id),
-- atualiza (com id) ou soft-deleta (removido=true) numa única chamada.
-- Diferente de itens de medição/contrato, deduções podem ficar vazias —
-- não há exigência de lista mínima.
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

- [ ] **Step 2: Aplicar a migração no Supabase de produção**

Use a ferramenta MCP `mcp__claude_ai_Supabase__apply_migration` com `name: "medicoes_deducoes_nf"` e o SQL completo do Step 1. Projeto: `yxshldsfmbmbzdkcymca`.

- [ ] **Step 3: Verificar o schema aplicado**

Rode via `mcp__claude_ai_Supabase__execute_sql`:

```sql
SELECT column_name FROM information_schema.columns WHERE table_name = 'obras' AND column_name = 'cep';
SELECT table_name FROM information_schema.tables WHERE table_name = 'medicoes_deducoes';
SELECT routine_name FROM information_schema.routines WHERE routine_name = 'salvar_deducoes_medicao';
SELECT polname FROM pg_policies WHERE tablename = 'medicoes_deducoes';
```

Esperado: uma linha em cada uma das 3 primeiras queries, 3 linhas na última (`med_deducoes_select`, `med_deducoes_insert`, `med_deducoes_update`).

- [ ] **Step 4: Teste funcional do trigger de recálculo via SQL**

Contra um contrato de teste existente com uma medição em rascunho (ou crie um cenário isolado com `BEGIN; ... ROLLBACK;` se não houver dado de teste seguro). Insira uma dedução e confirme que `medicoes.valor_liquido` cai exatamente pelo `valor_total` da dedução:

```sql
BEGIN;
-- Substitua pelos ids de um contrato/medição de teste em rascunho.
SELECT id, valor_bruto, valor_retido, valor_liquido FROM medicoes WHERE status = 'rascunho' LIMIT 1;
-- Anote o id retornado como :medicao_teste e o valor_liquido como :liquido_antes.
INSERT INTO medicoes_deducoes (medicao_id, descricao, quantidade, valor_unitario)
VALUES ('<medicao_teste>', 'Teste de dedução', 2, 50);
SELECT valor_liquido FROM medicoes WHERE id = '<medicao_teste>';
-- Esperado: liquido_antes - 100.
ROLLBACK;
```

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260910_medicoes_deducoes_nf.sql
git commit -m "feat: adiciona Deduções e obras.cep para Medições e Dados de NF"
```

Report format: status (DONE/BLOCKED/NEEDS_CONTEXT), migration applied (yes/no), verification query output, concerns.

---

### Task 2: Tipos TypeScript + campo CEP em Dados da Obra

**Files:**
- Modify: `src/lib/supabase.ts` (interface `Obra`, nova interface `MedicaoDeducao`)
- Modify: `src/pages/DadosObra.tsx`

**Interfaces:**
- Consumes: coluna `obras.cep` (Task 1).
- Produces: `Obra.cep: string | null`; `export interface MedicaoDeducao { id, medicao_id, descricao, quantidade, valor_unitario, valor_total, ativo, criado_em, criado_por }` — usada pelas Tasks 3 e 4.

- [ ] **Step 1: Adicionar `cep` à interface `Obra` em `src/lib/supabase.ts`**

Localize a interface `Obra` (linha 27 hoje) e o campo `endereco_escritorio` dentro dela. Adicione `cep` logo após:

```ts
export interface Obra {
  id: string
  nome: string
  descricao: string | null
  endereco: string | null
  cidade: string | null
  estado: string | null
  data_inicio: string | null
  data_fim_prevista: string | null
  status: StatusObra
  logo_url: string | null
  rodape_pdf: string | null
  nome_empreendimento: string | null
  cnpj: string | null
  cno_obra: string | null
  endereco_escritorio: string | null
  cep: string | null
  // ...demais campos existentes (email, criado_por, criado_em, ativo etc. — não remover nada)
}
```

- [ ] **Step 2: Adicionar a interface `MedicaoDeducao`**

Logo após a interface `MedicaoItem` existente (linha 810-819 hoje):

```ts
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

- [ ] **Step 3: Adicionar estado `cep` em `DadosObra.tsx`**

No topo do componente, junto ao `useState` de `enderecoEscritorio` (linha 32 hoje):

```tsx
const [enderecoEscritorio, setEnderecoEscritorio] = useState('')
const [cep, setCep] = useState('')
const [email, setEmail] = useState('')
```

- [ ] **Step 4: Incluir `cep` em `abrirNovo()` e `abrirEdicao()`**

Em `abrirNovo()` (linha 55 hoje):

```tsx
setCnpj(''); setCnoObra(''); setEnderecoEscritorio(''); setCep(''); setEmail('')
```

Em `abrirEdicao()` (linha 72 hoje):

```tsx
setEnderecoEscritorio(o.endereco_escritorio ?? '')
setCep(o.cep ?? '')
setEmail(o.email ?? '')
```

- [ ] **Step 5: Incluir `cep` no payload de `salvar()`**

No objeto `dados` (linha 121 hoje):

```tsx
endereco_escritorio: enderecoEscritorio.trim() || null,
cep: cep.trim() || null,
email: email.trim() || null,
```

- [ ] **Step 6: Renderizar o campo CEP na tela**

Substitua o label solo de "Endereço Escritório" (linhas 201-204 hoje) por um `.linha` com Endereço Escritório + CEP, mesmo padrão do par CNPJ/CNO Obra logo acima:

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

- [ ] **Step 7: Checar tipos e build**

```bash
npm run build
```

Esperado: build sem erros de TypeScript.

- [ ] **Step 8: Commit**

```bash
git add src/lib/supabase.ts src/pages/DadosObra.tsx
git commit -m "feat: adiciona campo CEP em Dados da Obra"
```

Report format: status, build output (pass/fail), concerns.

---

### Task 3: PDF — tabela de Deduções + quadro de Dados para Nota Fiscal

**Files:**
- Modify: `src/lib/medicoesPdf.ts`

**Interfaces:**
- Consumes: `MedicaoDeducao` não é usada diretamente aqui (o PDF recebe um shape próprio, ver abaixo) — mas o campo `valor_total` de `medicoes_deducoes` é a fonte de `DeducaoPdfMedicao.valorTotal`.
- Produces: `export interface DeducaoPdfMedicao { descricao, quantidade, valorUnitario, valorTotal }`; `DadosPdfMedicao` ganha `cnpjObra`, `cnoObra`, `enderecoEscritorioObra`, `cepObra`, `emailObra`, `deducoes: DeducaoPdfMedicao[]` — consumidos pela Task 4.

**Contexto crítico:** o "bloco final" (assinaturas + resumo + acumulado) é travado numa posição fixa (`BLOCO_FINAL_Y`) calculada a partir de uma altura fixa (`ALTURA_BLOCO_FINAL = 68`), especificamente pra nunca quebrar no meio de uma página. A tabela de Deduções entra **dentro** desse bloco atômico (entre a faixa VALOR BRUTO/RETENÇÃO/LÍQUIDO e o acumulado do contrato), então `ALTURA_BLOCO_FINAL` precisa crescer dinamicamente com o número de deduções — não pode continuar sendo uma constante. O quadro de Dados para Nota Fiscal, ao contrário, entra **depois** do bloco atômico, como conteúdo normal com paginação (não precisa ficar preso ao rodapé).

- [ ] **Step 1: Adicionar `DeducaoPdfMedicao` e estender `DadosPdfMedicao`**

Logo após a interface `ItemPdfMedicao` (linha 27 hoje):

```ts
export interface DeducaoPdfMedicao {
  descricao: string
  quantidade: number
  valorUnitario: number
  valorTotal: number
}
```

Na interface `DadosPdfMedicao` (linhas 29-49 hoje), adicione os campos novos após `estadoObra` e após `itens`:

```ts
export interface DadosPdfMedicao {
  contrato: Contrato
  medicao: Medicao
  empreiteiroNome: string
  obraNome: string
  nomeEmpreendimento: string | null
  enderecoObra: string | null
  cidadeObra: string | null
  estadoObra: string | null
  cnpjObra: string | null
  cnoObra: string | null
  enderecoEscritorioObra: string | null
  cepObra: string | null
  emailObra: string | null
  identidade: IdentidadeMarca
  responsavelNome: string
  responsavelEmail: string
  responsavelTelefone: string | null
  itens: ItemPdfMedicao[]
  deducoes: DeducaoPdfMedicao[]
  totalBrutoContrato: number
  totalRetidoContrato: number
  totalLiquidoContrato: number
}
```

- [ ] **Step 2: Tornar `ALTURA_BLOCO_FINAL` dinâmico**

Substitua (linhas 76-77 hoje):

```ts
  const ALTURA_BLOCO_FINAL = 68 // assinaturas + resumo + acumulado — medido no bloco real (~58mm) + folga de ~10mm
  const BLOCO_FINAL_Y = LIMITE_RODAPE - ALTURA_BLOCO_FINAL // posição fixa — o bloco final sempre começa aqui, travado no rodapé
```

Por:

```ts
  const LARG_DESC_DEDUCAO = 168 // largura da coluna de descrição na tabela de deduções
  // Altura real da tabela de deduções dentro do bloco final — soma o
  // cabeçalho, cada linha (com quebra de texto, mesma fórmula da tabela
  // de itens) e a linha de total. Zero quando não há deduções, então o
  // bloco final volta exatamente ao tamanho de antes.
  function alturaTabelaDeducoes(): number {
    if (d.deducoes.length === 0) return 0
    const alturaLinhas = d.deducoes.reduce((soma, ded) => {
      const linhas = pdf.splitTextToSize(ded.descricao, LARG_DESC_DEDUCAO) as string[]
      return soma + Math.max(linhas.length, 1) * 4.2 + 2.5
    }, 0)
    return 5 + 7 + alturaLinhas + 7 // margem superior + cabeçalho + linhas + linha de total
  }
  const ALTURA_BLOCO_FINAL = 68 + alturaTabelaDeducoes() // assinaturas + resumo + acumulado (~58mm) + folga (~10mm) + deduções, se houver
  const BLOCO_FINAL_Y = LIMITE_RODAPE - ALTURA_BLOCO_FINAL // posição fixa — o bloco final sempre começa aqui, travado no rodapé
```

- [ ] **Step 3: Adicionar `precisaEspaco`, um helper de paginação sem cabeçalho de tabela**

`precisaLinha` (linhas 106-111 hoje) sempre chama `cabecalhoTabela()` ao criar página nova, o que é específico da tabela de itens. O quadro de Nota Fiscal precisa de um helper de paginação genérico. Adicione logo após a definição de `precisaLinha`:

```ts
  function precisaEspaco(mm: number) {
    if (y + mm > LIMITE_CONTEUDO) novaPagina()
  }
```

- [ ] **Step 4: Calcular `totalDeducoes` e ajustar `liquido` (rascunho)**

No bloco "resumo desta medição" (linhas 323-327 hoje), adicione o cálculo de `totalDeducoes` e use-o no `liquido` de rascunho:

```ts
  const aprovada = d.medicao.status === 'aprovada'
  const retencaoPct = d.contrato.retencao_pct ?? 0
  const bruto = aprovada ? d.medicao.valor_bruto : brutoItens
  const retido = aprovada ? d.medicao.valor_retido : Math.round(brutoItens * retencaoPct) / 100
  const totalDeducoes = d.deducoes.reduce((s, ded) => s + ded.valorTotal, 0)
  const liquido = aprovada ? d.medicao.valor_liquido : bruto - retido - totalDeducoes
```

(`d.medicao.valor_liquido`, no caso aprovada, já vem do banco com a subtração de deduções aplicada pelo trigger da Task 1 — nenhuma mudança adicional necessária aí.)

- [ ] **Step 5: Renderizar a tabela de Deduções dentro do bloco final**

Depois do bloco de tiles (`tiles.forEach(...)` termina em `y += alturaDestaque + 5`, linha 353 hoje) e antes do comentário `// acumulado do contrato inteiro` (linha 355 hoje), insira:

```ts
  // ---------- deduções desta medição, se houver ----------
  if (d.deducoes.length > 0) {
    y += 5
    const colXDed = { descricao: ML, quantidade: ML + 184, valorUnitario: ML + 212, valorTotal: ML + 246 }
    pdf.setFillColor('#F0EBE3')
    pdf.rect(ML, y, LARG, 7, 'F')
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(7)
    pdf.setTextColor(NAVY)
    pdf.text('DEDUÇÕES', colXDed.descricao + 1, y + 4.7)
    pdf.text('QTD.', colXDed.quantidade + 14, y + 4.7, { align: 'center' })
    pdf.text('VALOR UNIT.', colXDed.valorUnitario + 17, y + 4.7, { align: 'center' })
    pdf.text('VALOR TOTAL', W - MR - 18, y + 4.7, { align: 'center' })
    y += 7

    for (const ded of d.deducoes) {
      pdf.setFont('helvetica', 'normal')
      pdf.setFontSize(8.5)
      const linhasDesc = pdf.splitTextToSize(ded.descricao, LARG_DESC_DEDUCAO) as string[]
      const alturaLinha = Math.max(linhasDesc.length, 1) * 4.2 + 2.5
      pdf.setDrawColor('#E0DAD0')
      pdf.setLineWidth(0.2)
      pdf.line(ML, y, W - MR, y)
      pdf.setTextColor(PRETO)
      pdf.text(linhasDesc, colXDed.descricao + 1, y + 4.2)
      pdf.text(`${ded.quantidade}`, colXDed.quantidade + 14, y + 4.2, { align: 'center' })
      pdf.text(`R$ ${formatarMoeda(ded.valorUnitario)}`, colXDed.valorUnitario + 17, y + 4.2, { align: 'center' })
      pdf.text(`R$ ${formatarMoeda(ded.valorTotal)}`, W - MR - 18, y + 4.2, { align: 'center' })
      y += alturaLinha
    }
    pdf.setDrawColor('#E0DAD0')
    pdf.line(ML, y, W - MR, y)
    y += 5
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(9.5)
    pdf.setTextColor(NAVY)
    pdf.text('Total de Deduções', ML, y)
    pdf.text(`R$ ${formatarMoeda(totalDeducoes)}`, W - MR, y, { align: 'right' })
    y += 2
  }

```

- [ ] **Step 6: Renderizar o quadro "Dados para Emissão de Nota Fiscal" após o bloco final**

No final da função, depois de `pdf.text(nota, ML, y)` (linha 385 hoje) e antes de `rodape()` (linha 387 hoje), insira:

```ts
  // ---------- dados para emissão de nota fiscal ----------
  const camposNF: [string, string][] = [
    ['Empresa', d.nomeEmpreendimento ?? d.obraNome],
    ['CNPJ', d.cnpjObra ?? '—'],
    ['Endereço', d.enderecoEscritorioObra ?? '—'],
    ['CEP', d.cepObra ?? '—'],
    ['E-mail', d.emailObra ?? '—'],
    ['CNO', d.cnoObra ?? '—'],
  ]
  precisaEspaco(8 + camposNF.length * 5.5)
  y += 8
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(10)
  pdf.setTextColor(NAVY)
  pdf.text('DADOS PARA EMISSÃO DE NOTA FISCAL', ML, y)
  y += 6
  for (const [rotulo, valor] of camposNF) {
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(8.5)
    pdf.setTextColor(TERRACOTA)
    pdf.text(`${rotulo}:`, ML, y)
    pdf.setFont('helvetica', 'normal')
    pdf.setTextColor('#333333')
    pdf.text(valor, ML + 28, y)
    y += 5.5
  }

```

- [ ] **Step 7: Teste via script Node (mesmo padrão já usado neste projeto pra validar layout de PDF sem navegador)**

Crie um script temporário fora do repositório (ex.: no diretório de scratchpad) que importe `gerarPdfMedicao`... na verdade `gerarPdfMedicao` chama `pdf.save()`, que no browser dispara download — em Node isso não funciona diretamente. Em vez disso, valide a lógica de posicionamento com um teste isolado: copie a função `alturaTabelaDeducoes` e o cálculo de `ALTURA_BLOCO_FINAL`/`BLOCO_FINAL_Y` para um script Node standalone com jsPDF, alimentando 0, 1 e 4 deduções (uma com descrição longa o bastante pra quebrar linha), e imprima os valores resultantes de `ALTURA_BLOCO_FINAL` e `BLOCO_FINAL_Y` no console — confirme que ambos são finitos, que `BLOCO_FINAL_Y` continua positivo (não estoura pra fora da página) mesmo com 4 deduções, e que com 0 deduções o resultado é idêntico ao valor fixo anterior (68 / `196-68=128`).

```bash
node -e "
const { jsPDF } = require('jspdf');
const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' });
const LARG_DESC_DEDUCAO = 168;
function altura(deducoes) {
  if (deducoes.length === 0) return 0;
  const alturaLinhas = deducoes.reduce((soma, ded) => {
    const linhas = pdf.splitTextToSize(ded.descricao, LARG_DESC_DEDUCAO);
    return soma + Math.max(linhas.length, 1) * 4.2 + 2.5;
  }, 0);
  return 5 + 7 + alturaLinhas + 7;
}
const casos = [
  [],
  [{ descricao: 'Almoço Mês Dezembro' }],
  [
    { descricao: 'Almoço Mês Dezembro' },
    { descricao: 'Almoço Mês Janeiro' },
    { descricao: 'Empréstimo de ferramenta para acabamento da cobertura, devolvida com atraso' },
    { descricao: 'Material elétrico fornecido pela RT' },
  ],
];
for (const c of casos) {
  const a = 68 + altura(c);
  console.log(c.length, 'deduções -> ALTURA_BLOCO_FINAL =', a, ' BLOCO_FINAL_Y =', 196 - a);
}
"
```

Esperado: primeira linha `0 deduções -> ALTURA_BLOCO_FINAL = 68  BLOCO_FINAL_Y = 128` (idêntico ao comportamento anterior); as demais com `ALTURA_BLOCO_FINAL` crescente e `BLOCO_FINAL_Y` ainda positivo e razoável (bem acima de 39, que é onde o cabeçalho termina).

- [ ] **Step 8: Checar tipos e build**

```bash
npm run build
```

Esperado: build sem erros de TypeScript (a Task 4 ainda não existe, então `gerarPdfMedicao` fica temporariamente sem chamador atualizado — isso é esperado e não quebra o build, já que `MedicaoForm.tsx` só será alterado na Task 4; se o build falhar por causa da chamada existente de `gerarPdfMedicao` em `MedicaoForm.tsx` não fornecer os campos novos obrigatórios, isso é o TypeScript corretamente sinalizando que a Task 4 é necessária — reporte isso como esperado, não como bug).

- [ ] **Step 9: Commit**

```bash
git add src/lib/medicoesPdf.ts
git commit -m "feat: tabela de Deduções e quadro de Nota Fiscal no PDF de Medição"
```

Report format: status, resultado do script Node do Step 7 (colar a saída), resultado do build (e se falhou por causa da Task 4 pendente, deixar claro), concerns.

---

### Task 4: Tela — seção Deduções em `MedicaoForm.tsx`, persistência e impressão

**Files:**
- Modify: `src/pages/MedicaoForm.tsx`

**Interfaces:**
- Consumes: `MedicaoDeducao` (Task 2), `DeducaoPdfMedicao` + `DadosPdfMedicao` estendida (Task 3), RPC `salvar_deducoes_medicao` (Task 1).
- Produces: nenhuma interface nova consumida por outra task — esta é a última task do plano.

- [ ] **Step 1: Importar os tipos novos**

No topo do arquivo (linhas 4-8 hoje):

```tsx
import {
  supabase, type Contrato, type ContratoItem, type Servico, type Unidade,
  type Medicao, type MedicaoItem, type MedicaoDeducao, type StatusMedicao,
} from '../lib/supabase'
import { gerarPdfMedicao, type DeducaoPdfMedicao } from '../lib/medicoesPdf'
```

- [ ] **Step 2: Adicionar estado de deduções**

Logo após a interface `ItemLinha` (linha 32 hoje), adicione:

```tsx
interface DeducaoLinha {
  id: string | null
  descricao: string
  quantidade: string
  valorUnitario: string
  removido: boolean
}
```

Junto aos demais `useState` de carregamento (perto da linha 52-53 hoje, ao lado de `itensExistentes`):

```tsx
const [itensExistentes, setItensExistentes] = useState<MedicaoItem[]>([])
const [deducoesExistentes, setDeducoesExistentes] = useState<MedicaoDeducao[]>([])
```

E junto ao `useState` de `linhas` (linha 57 hoje):

```tsx
const [linhas, setLinhas] = useState<ItemLinha[]>([])
const [deducoes, setDeducoes] = useState<DeducaoLinha[]>([])
```

- [ ] **Step 3: Carregar deduções existentes em `carregar()`**

Dentro do bloco `if (!nova && medicaoId) { ... }` (linhas 105-118 hoje), logo após carregar `itensAtual`:

```tsx
      const { data: itensAtual } = await supabase.from('medicoes_itens').select('*')
        .eq('medicao_id', medicaoId).eq('ativo', true)
      setItensExistentes(itensAtual ?? [])
      const { data: deducoesAtual } = await supabase.from('medicoes_deducoes').select('*')
        .eq('medicao_id', medicaoId).eq('ativo', true).order('criado_em')
      setDeducoesExistentes(deducoesAtual ?? [])
```

- [ ] **Step 4: Popular `deducoes` a partir de `deducoesExistentes`**

No `useEffect` que monta `linhas` (linhas 123-145 hoje), adicione a montagem de `deducoes` logo depois de `setLinhas(...)`, dentro do mesmo efeito (reage a `deducoesExistentes` também — adicione à lista de dependências):

```tsx
  useEffect(() => {
    if (carregando) return
    const porServico = new Map(servicos.map(s => [s.id, s]))
    const nomeUnidade = new Map(unidades.map(u => [u.id, u.nome]))
    const itemExistentePorContratoItem = new Map(itensExistentes.map(i => [i.contrato_item_id, i]))

    setLinhas(contratoItens.map(ci => {
      const s = porServico.get(ci.servico_id)
      const existente = itemExistentePorContratoItem.get(ci.id)
      return {
        contratoItemId: ci.id,
        servicoNome: s?.nome ?? '—',
        servicoCodigo: s?.codigo ?? '',
        und: s?.und ?? '',
        unidadeNome: nomeUnidade.get(ci.unidade_id) ?? '—',
        quantidadeContratada: ci.quantidade,
        valorUnitario: ci.valor_unitario,
        jaAprovado: jaAprovadoPorItem.get(ci.id) ?? 0,
        quantidadePeriodo: existente ? String(existente.quantidade_periodo) : '0',
        medicaoItemId: existente?.id ?? null,
      }
    }))

    setDeducoes(deducoesExistentes.map(ded => ({
      id: ded.id,
      descricao: ded.descricao,
      quantidade: String(ded.quantidade),
      valorUnitario: String(ded.valor_unitario),
      removido: false,
    })))
  }, [carregando, contratoItens, servicos, unidades, itensExistentes, jaAprovadoPorItem, deducoesExistentes])
```

- [ ] **Step 5: Funções de edição da lista de deduções**

Logo após `atualizarLinha` (linhas 147-149 hoje):

```tsx
  function adicionarDeducao() {
    setDeducoes(prev => [...prev, { id: null, descricao: '', quantidade: '1', valorUnitario: '0', removido: false }])
  }

  function atualizarDeducao(index: number, campo: 'descricao' | 'quantidade' | 'valorUnitario', valor: string) {
    setDeducoes(prev => prev.map((d, i) => i === index ? { ...d, [campo]: valor } : d))
  }

  function removerDeducao(index: number) {
    setDeducoes(prev => {
      const linha = prev[index]
      if (linha.id === null) return prev.filter((_, i) => i !== index)
      return prev.map((d, i) => i === index ? { ...d, removido: true } : d)
    })
  }
```

(Uma dedução nunca salva — `id === null` — é removida da lista local direto; uma já persistida é marcada `removido` e enviada pra soft delete no próximo salvamento, mesmo padrão de `contratos_itens`/`salvar_itens_contrato`.)

- [ ] **Step 6: Payload de deduções pra RPC**

Logo após `removerDeducao`, adicione um helper reaproveitado pelos dois fluxos de salvar:

```tsx
  function payloadDeducoes() {
    return deducoes
      .filter(d => d.id !== null || !d.removido)
      .map(d => ({
        id: d.id,
        descricao: d.descricao.trim(),
        quantidade: Number(d.quantidade) || 0,
        valor_unitario: Number(d.valorUnitario) || 0,
        removido: d.removido,
      }))
  }
```

- [ ] **Step 7: Chamar `salvar_deducoes_medicao` em `salvarNova()`**

Substitua `salvarNova` (linhas 151-171 hoje) para, após criar a medição com sucesso, salvar as deduções antes de navegar — só se houver alguma dedução digitada (evita uma chamada RPC vazia e desnecessária no caso comum sem deduções):

```tsx
  async function salvarNova() {
    if (!contrato) return
    setSalvando(true)
    setMsg(null)
    const { data: novaMedicaoId, error } = await supabase.rpc('criar_medicao_com_itens', {
      p_contrato: contrato.id,
      p_data_inicio: dataInicio,
      p_data_fim: dataFim,
      p_itens: linhas.map(l => ({
        contrato_item_id: l.contratoItemId,
        quantidade_periodo: Number(l.quantidadePeriodo) || 0,
      })),
    })
    if (error || !novaMedicaoId) {
      setSalvando(false)
      setMsg({ tipo: 'erro', texto: `Erro ao criar medição: ${error?.message}` })
      return
    }
    const payload = payloadDeducoes()
    if (payload.length > 0) {
      const { error: erroDeducoes } = await supabase.rpc('salvar_deducoes_medicao', {
        p_medicao: novaMedicaoId,
        p_deducoes: payload,
      })
      if (erroDeducoes) {
        setSalvando(false)
        setMsg({ tipo: 'erro', texto: `Medição criada, mas houve erro ao salvar as deduções: ${erroDeducoes.message}` })
        navigate(`/contratos/${contrato.id}/medicoes/${novaMedicaoId}`, { replace: true })
        return
      }
    }
    setSalvando(false)
    navigate(`/contratos/${contrato.id}/medicoes/${novaMedicaoId}`, { replace: true })
  }
```

- [ ] **Step 8: Chamar `salvar_deducoes_medicao` em `salvarEdicao()`**

Substitua `salvarEdicao` (linhas 173-193 hoje):

```tsx
  async function salvarEdicao() {
    if (!medicao) return
    setSalvando(true)
    setMsg(null)
    const { error } = await supabase.rpc('salvar_itens_medicao', {
      p_medicao: medicao.id,
      p_itens: linhas.map(l => ({
        id: l.medicaoItemId,
        quantidade_periodo: Number(l.quantidadePeriodo) || 0,
      })),
    })
    if (error) {
      setSalvando(false)
      setMsg({ tipo: 'erro', texto: `Não foi possível salvar os itens: ${error.message}` })
      if (contratoId) carregar(contratoId)
      return
    }
    const { error: erroDeducoes } = await supabase.rpc('salvar_deducoes_medicao', {
      p_medicao: medicao.id,
      p_deducoes: payloadDeducoes(),
    })
    if (erroDeducoes) {
      setSalvando(false)
      setMsg({ tipo: 'erro', texto: `Itens salvos, mas houve erro ao salvar as deduções: ${erroDeducoes.message}` })
      if (contratoId) carregar(contratoId)
      return
    }
    setSalvando(false)
    setMsg({ tipo: 'ok', texto: 'Itens e deduções atualizados.' })
    if (contratoId) carregar(contratoId)
  }
```

(Na edição, `payloadDeducoes()` é sempre enviado, mesmo vazio — diferente da criação — porque uma edição pode estar justamente removendo a última dedução restante, e `salvar_deducoes_medicao` aceita lista vazia sem erro.)

- [ ] **Step 9: Estender `imprimir()` com os novos dados de obra e as deduções**

Substitua `imprimir()` (linhas 244-278 hoje):

```tsx
  async function imprimir() {
    if (!contrato || !medicao) return
    const [{ data: obraRow }, { data: responsavelRow }, { data: deducoesAtual }] = await Promise.all([
      supabase.from('obras')
        .select('nome, logo_url, rodape_pdf, nome_empreendimento, endereco, cidade, estado, cnpj, cno_obra, endereco_escritorio, cep, email')
        .eq('id', contrato.obra_id).maybeSingle(),
      supabase.from('perfis_usuario').select('nome, email, telefone').eq('id', medicao.criado_por).maybeSingle(),
      supabase.from('medicoes_deducoes').select('*').eq('medicao_id', medicao.id).eq('ativo', true).order('criado_em'),
    ])
    const identidade = await carregarIdentidadeObra(obraRow)
    const deducoesPdf: DeducaoPdfMedicao[] = (deducoesAtual ?? []).map(ded => ({
      descricao: ded.descricao,
      quantidade: ded.quantidade,
      valorUnitario: ded.valor_unitario,
      valorTotal: ded.valor_total,
    }))
    gerarPdfMedicao({
      contrato,
      medicao,
      identidade,
      empreiteiroNome,
      obraNome: obraRow?.nome ?? '—',
      nomeEmpreendimento: obraRow?.nome_empreendimento ?? null,
      enderecoObra: obraRow?.endereco ?? null,
      cidadeObra: obraRow?.cidade ?? null,
      estadoObra: obraRow?.estado ?? null,
      cnpjObra: obraRow?.cnpj ?? null,
      cnoObra: obraRow?.cno_obra ?? null,
      enderecoEscritorioObra: obraRow?.endereco_escritorio ?? null,
      cepObra: obraRow?.cep ?? null,
      emailObra: obraRow?.email ?? null,
      responsavelNome: responsavelRow?.nome ?? '—',
      responsavelEmail: responsavelRow?.email ?? '—',
      responsavelTelefone: responsavelRow?.telefone ?? null,
      totalBrutoContrato,
      totalRetidoContrato,
      totalLiquidoContrato,
      itens: linhas.map(l => ({
        servicoCodigo: l.servicoCodigo,
        servicoNome: l.servicoNome,
        und: l.und,
        unidadeNome: l.unidadeNome,
        quantidadeContratada: l.quantidadeContratada,
        jaAprovado: l.jaAprovado,
        quantidadePeriodo: Number(l.quantidadePeriodo) || 0,
        valorUnitario: l.valorUnitario,
      })),
      deducoes: deducoesPdf,
    })
  }
```

(`imprimir()` já busca as deduções direto do banco, em vez de reusar o estado `deducoes` da tela — mesmo motivo pelo qual `itens` já era montado a partir de `linhas`, mas aqui optamos por buscar de novo porque `deducoes` pode conter edições não salvas ainda; buscar do banco garante que o PDF sempre reflete o que está persistido, igual ao resto da tela.)

- [ ] **Step 10: Renderizar a seção "Deduções" na tela**

Logo após o bloco `Itens` (fecha em `</div></div>`, linha 383 hoje) e antes do bloco de resumo (linha 385 hoje), insira uma nova seção. Ela só aparece se houver deduções OU se a medição estiver editável (pra sempre oferecer o botão de adicionar em rascunho, mas não poluir a tela de uma medição aprovada sem nenhuma):

```tsx
      {(deducoes.length > 0 || podeEditarItens) && (
        <div className={styles.bloco}>
          <h2>Deduções</h2>
          {deducoes.filter(d => !d.removido).length === 0 && !podeEditarItens && (
            <p className={styles.vazio}>Nenhuma dedução nesta medição.</p>
          )}
          {deducoes.filter(d => !d.removido).length > 0 && (
            <div className={styles.tabelaWrap}>
              <table className={styles.tabela}>
                <thead>
                  <tr>
                    <th>Descrição</th><th>Quantidade</th><th>Valor unit.</th><th>Valor total</th>
                    {podeEditarItens && <th></th>}
                  </tr>
                </thead>
                <tbody>
                  {deducoes.map((d, index) => {
                    if (d.removido) return null
                    const valorTotal = (Number(d.quantidade) || 0) * (Number(d.valorUnitario) || 0)
                    return (
                      <tr key={d.id ?? `nova-${index}`}>
                        <td data-label="Descrição">
                          {podeEditarItens
                            ? <input type="text" value={d.descricao}
                                onChange={e => atualizarDeducao(index, 'descricao', e.target.value)} />
                            : d.descricao}
                        </td>
                        <td data-label="Quantidade">
                          {podeEditarItens
                            ? <input type="number" min="0" step="0.0001" value={d.quantidade} className={styles.inputQtd}
                                onChange={e => atualizarDeducao(index, 'quantidade', e.target.value)} />
                            : d.quantidade}
                        </td>
                        <td data-label="Valor unitário">
                          {podeEditarItens
                            ? <input type="number" min="0" step="0.01" value={d.valorUnitario} className={styles.inputQtd}
                                onChange={e => atualizarDeducao(index, 'valorUnitario', e.target.value)} />
                            : `R$ ${formatarMoeda(Number(d.valorUnitario) || 0)}`}
                        </td>
                        <td data-label="Valor total">R$ {formatarMoeda(valorTotal)}</td>
                        {podeEditarItens && (
                          <td><button type="button" className={styles.btnSecundario} onClick={() => removerDeducao(index)}>Remover</button></td>
                        )}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          {podeEditarItens && (
            <button type="button" className={styles.btnSecundario} onClick={adicionarDeducao} style={{ marginTop: 10 }}>
              + Adicionar dedução
            </button>
          )}
        </div>
      )}

```

- [ ] **Step 11: Refletir deduções no resumo em tela (rascunho)**

No cálculo de `liquidoCalc` (linha 295-298 hoje), subtraia as deduções ativas (não removidas):

```tsx
  const brutoCalc = linhas.reduce((acc, l) => acc + (Number(l.quantidadePeriodo) || 0) * l.valorUnitario, 0)
  const retencaoPct = contrato.retencao_pct ?? 0
  const retidoCalc = Math.round(brutoCalc * retencaoPct) / 100
  const totalDeducoesCalc = deducoes.filter(d => !d.removido).reduce((acc, d) => acc + (Number(d.quantidade) || 0) * (Number(d.valorUnitario) || 0), 0)
  const liquidoCalc = brutoCalc - retidoCalc - totalDeducoesCalc
```

(O `liquido` fechado — medição aprovada/cancelada — continua vindo direto de `medicao.valor_liquido`, já correto pelo trigger da Task 1; esta mudança só afeta o recomputo ao vivo de rascunho/nova, mesmo padrão já usado pra `bruto`/`retido`.)

- [ ] **Step 12: Checar tipos e build**

```bash
npm run build
```

Esperado: build sem erros de TypeScript.

- [ ] **Step 13: Commit**

```bash
git add src/pages/MedicaoForm.tsx
git commit -m "feat: secao de Deducoes em Medicoes, persistencia e impressao"
```

Report format: status, build output (pass/fail), concerns — em particular, sinalizar se algo no Step 10 (JSX) precisou de ajuste de classe CSS não coberta por `styles.tabela`/`styles.inputQtd`/`styles.btnSecundario`/`styles.vazio` (todas já existem no módulo CSS hoje, usadas pela tabela de Itens/outras telas — se algum nome não existir, é um achado a reportar, não a inventar).

---

## Ordem de execução

Tasks 1 → 2 → 3 → 4, sequenciais (cada uma consome tipos/RPC/colunas da anterior). Não há paralelismo seguro aqui — mesmo arquivo (`MedicaoForm.tsx`) é tocado só na Task 4, mas ela depende dos tipos da Task 2 e da assinatura de `gerarPdfMedicao`/`DadosPdfMedicao` da Task 3.

## Teste guiado final (Rodrigo, depois de todas as tasks)

1. Abrir um contrato ativo → Nova medição.
2. Adicionar ao menos uma dedução (descrição, quantidade, valor unitário) antes de criar a medição — confirmar que o valor líquido em tela já desconta na hora.
3. Criar a medição, reabrir, editar a dedução (mudar valor) e adicionar uma segunda — salvar, confirmar que persistiu.
4. Remover uma dedução, salvar, confirmar que sumiu e o líquido recalculou.
5. Aprovar a medição — confirmar que a seção de Deduções trava (sem input, sem botão de adicionar/remover).
6. Imprimir o PDF — conferir a tabela de Deduções (com o total certo) e o quadro "Dados para Emissão de Nota Fiscal" com os dados da obra usada no teste (cadastrar CNPJ/CNO/Endereço Escritório/CEP/E-mail em Dados da Obra antes, se a obra de teste ainda não tiver).
7. Testar uma medição sem nenhuma dedução — confirmar que a tabela de Deduções não aparece no PDF nem ocupa espaço vazio na tela.
