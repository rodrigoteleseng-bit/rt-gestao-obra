# Exportação Excel do Financeiro (formato ENGEFER) — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Botão "Exportar Excel" em `/financeiro` que gera um `.xlsx` com um par de abas por mês (ledger de pagamentos + orçamento previsto/realizado/saldo por item), no mesmo formato que a ENGEFER já usa e que o cliente da obra ENGEFER Sudoeste já está acostumado a receber, sempre recalculado na hora a partir dos dados reais do app — nunca um snapshot guardado.

**Architecture:** Novo módulo puro de agregação + geração de workbook (`src/lib/financeiroExcel.ts`, lazy-loaded via `import()` no clique do botão, mesmo padrão de code-splitting já usado pelos geradores de PDF do app). Lê `lancamentos_financeiros`/`servicos`/`etapas`/`unidades` já carregados na tela `/financeiro` — sem RPC nova, sem tabela nova além de uma coluna. Um campo novo (`nf_numero`) preenchido nos dois lugares onde `observacao` já é editável hoje (criação do lançamento avulso, edição antes de pagar).

**Tech Stack:** React 19 + TypeScript, Supabase (Postgres), `exceljs` (nova dependência, geração de `.xlsx` no navegador com estilo de célula — negrito, formato de moeda/percentual).

## Global Constraints

- Sem framework de testes automatizado neste repositório — a verificação de cada task é `npm run build` (`tsc -b && vite build`) limpo, mais (quando a task envolve lógica pura) um script `npx tsx` ad-hoc contra uma fixture, descartável depois de rodar.
- Nunca inventar dado (CLAUDE.md §6.3): campo sem fonte fica vazio/"—", nunca preenchido com estimativa.
- Nada se apaga, tudo se inativa (CLAUDE.md §6.4) — não se aplica diretamente aqui (este export não apaga nada), mas nenhuma task deste plano faz hard delete de nada.
- Toda hierarquia respeita OBRA → UNIDADE → ETAPA → SERVIÇO (CLAUDE.md §4) — a aba de orçamento mensal agrupa por unidade → etapa → serviço, não só por etapa, para não intercalar etapas de unidades diferentes quando a obra tem mais de uma unidade (ex.: Tharsos Imperial, 13 sobrados).
- Acesso restrito a admin/equipe com módulo `financeiro` — mesma régua que a tela `/financeiro` já aplica; `cliente` nunca vê o botão nem acessa a tela.
- Migração de banco versionada em `supabase/migrations/`, nunca alteração manual direta em produção (aplicar via MCP do Supabase, não SQL solto).

---

## Nota sobre a spec

A spec (`docs/superpowers/specs/2026-09-08-exportacao-excel-financeiro-design.md`, §3) descreve `nf_numero` como editável "nos três lugares onde `observacao` já é editável hoje (criação, baixa/pagamento, edição)". Releitura de `src/pages/Financeiro.tsx` durante este planejamento mostrou que `observacao` na verdade só existe em **dois** lugares — criação (linha 309) e edição (linha 340); a seção "Dar baixa" (linhas 313-327) não tem campo de observação. `nf_numero` segue o padrão real: criação + edição, não baixa (a NF é uma característica da despesa em si, conhecida ao lançar/editar — não do ato de pagar).

---

### Task 1: Migração `nf_numero` + biblioteca `exceljs`

**Files:**
- Create: `supabase/migrations/20260908_financeiro_nf_numero.sql`
- Modify: `src/lib/supabase.ts:546-568` (interface `LancamentoFinanceiro`)
- Modify: `package.json` (via `npm install`, não edição manual)

**Interfaces:**
- Produces: coluna `lancamentos_financeiros.nf_numero` (`text`, nullable); campo `nf_numero: string | null` na interface `LancamentoFinanceiro`; dependência `exceljs` disponível para import em `src/lib/financeiroExcel.ts` (Task 3).

- [ ] **Step 1: Criar a migração**

```sql
-- Número da NF do lançamento financeiro, usado na aba "RF MM-YY" da
-- exportação Excel (coluna "Nº NF") e na conferência de despesas.
-- Nullable, sem invenção de dado quando vazio.
ALTER TABLE lancamentos_financeiros ADD COLUMN nf_numero TEXT;
```

Salvar em `supabase/migrations/20260908_financeiro_nf_numero.sql`.

- [ ] **Step 2: Aplicar a migração no projeto Supabase**

Usar a ferramenta MCP do Supabase (`mcp__claude_ai_Supabase__apply_migration`) com `project_id: yxshldsfmbmbzdkcymca`, `name: financeiro_nf_numero`, `query` igual ao SQL acima.

- [ ] **Step 3: Confirmar a coluna existe**

Usar `mcp__claude_ai_Supabase__execute_sql` com:
```sql
select column_name, data_type, is_nullable
from information_schema.columns
where table_name = 'lancamentos_financeiros' and column_name = 'nf_numero';
```
Esperado: uma linha, `data_type = text`, `is_nullable = YES`.

- [ ] **Step 4: Adicionar o campo na interface TypeScript**

Em `src/lib/supabase.ts`, dentro de `export interface LancamentoFinanceiro { ... }` (linhas 546-568), adicionar a propriedade logo depois de `observacao`:

```ts
  observacao: string | null
  nf_numero: string | null
  ativo: boolean
```

(Substitui as linhas 562-563 atuais — `observacao: string | null` seguido de `ativo: boolean` — inserindo `nf_numero: string | null` entre elas.)

- [ ] **Step 5: Instalar a biblioteca exceljs**

```bash
npm install exceljs
```

Confirma que `exceljs` aparece em `dependencies` no `package.json` (não `devDependencies` — é usada em código que roda no navegador do usuário final, mesmo grupo de `jspdf`).

- [ ] **Step 6: Verificar build**

```bash
npm run build
```
Esperado: `tsc -b && vite build` completa sem erros.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260908_financeiro_nf_numero.sql src/lib/supabase.ts package.json package-lock.json
git commit -m "feat: adiciona nf_numero ao lancamento financeiro e instala exceljs"
```

---

### Task 2: Campo "Nº NF" em `/financeiro` (criação e edição)

**Files:**
- Modify: `src/pages/Financeiro.tsx`

**Interfaces:**
- Consumes: `LancamentoFinanceiro.nf_numero: string | null` (Task 1).
- Produces: estados `nfNumero`/`editNfNumero` e os campos correspondentes nos payloads de `insert`/`update` de `lancamentos_financeiros`, consumidos por nenhuma outra task (é o fim da cadeia desta parte).

- [ ] **Step 1: Adicionar estado do formulário de criação**

Em `src/pages/Financeiro.tsx`, logo após a linha 76 (`const [observacao, setObservacao] = useState('')`):

```ts
  const [observacao, setObservacao] = useState('')
  const [nfNumero, setNfNumero] = useState('')
  const [salvando, setSalvando] = useState(false)
```

(Insere a nova linha entre `observacao` e `salvando`, que já existe na linha 77.)

- [ ] **Step 2: Adicionar estado do formulário de edição**

Logo após a linha 90 (`const [editObservacao, setEditObservacao] = useState('')`):

```ts
  const [editObservacao, setEditObservacao] = useState('')
  const [editNfNumero, setEditNfNumero] = useState('')
  const [salvandoEdicao, setSalvandoEdicao] = useState(false)
```

(Insere a nova linha entre `editObservacao` e `salvandoEdicao`, que já existe na linha 91.)

- [ ] **Step 3: Incluir `nf_numero` no insert de `criarAvulso`**

Na função `criarAvulso` (linhas 155-191), o `insert` (linhas 166-177) ganha o campo novo depois de `observacao`:

```ts
    const { error } = await supabase.from('lancamentos_financeiros').insert({
      obra_id: obraAtiva.id,
      unidade_id: etapa?.unidade_id ?? null,
      etapa_id: etapa?.id ?? null,
      servico_id: servico?.id ?? null,
      descricao: descricao.trim(),
      favorecido: favorecido.trim(),
      valor: valorNumero,
      data_vencimento: vencimento,
      observacao: observacao.trim() || null,
      nf_numero: nfNumero.trim() || null,
      criado_por: perfil.id,
    })
```

E o reset do formulário após sucesso (linhas 183-188) ganha `setNfNumero('')`:

```ts
    setDescricao('')
    setFavorecido('')
    setValor('')
    setVencimento(hojeIso())
    setServicoId(null)
    setObservacao('')
    setNfNumero('')
```

- [ ] **Step 4: Popular `editNfNumero` em `iniciarEdicao`**

Em `iniciarEdicao` (linhas 201-211), depois de `setEditObservacao(l.observacao ?? '')`:

```ts
  function iniciarEdicao(l: LancamentoFinanceiro) {
    setEditando(l)
    setBaixando(null)
    setEditDescricao(l.descricao)
    setEditFavorecido(l.favorecido)
    setEditValor(String(l.valor))
    setEditVencimento(l.data_vencimento ?? hojeIso())
    setEditServicoId(l.servico_id)
    setEditObservacao(l.observacao ?? '')
    setEditNfNumero(l.nf_numero ?? '')
    setMsg(null)
  }
```

- [ ] **Step 5: Incluir `nf_numero` no update de `salvarEdicao`**

Na função `salvarEdicao` (linhas 239-268), o `update` (linhas 250-259) ganha o campo novo depois de `observacao`:

```ts
    const { error } = await supabase.from('lancamentos_financeiros').update({
      unidade_id: etapa?.unidade_id ?? null,
      etapa_id: etapa?.id ?? null,
      servico_id: servico?.id ?? null,
      descricao: editDescricao.trim(),
      favorecido: editFavorecido.trim(),
      valor: valorNumero,
      data_vencimento: editVencimento || null,
      observacao: editObservacao.trim() || null,
      nf_numero: editNfNumero.trim() || null,
    }).eq('id', editando.id)
```

- [ ] **Step 6: Campo na JSX de criação**

Na seção "Lançamento avulso" (linha 309), depois do campo Observação:

```tsx
        <label className={styles.campo}>Observação<input value={observacao} onChange={e => setObservacao(e.target.value)} /></label>
        <label className={styles.campo}>Nº da NF<input value={nfNumero} onChange={e => setNfNumero(e.target.value)} /></label>
        <button className={styles.btnPrincipal} onClick={criarAvulso} disabled={salvando}>{salvando ? 'Salvando...' : 'Criar lançamento'}</button>
```

- [ ] **Step 7: Campo na JSX de edição**

Na seção "Editar lançamento" (linha 340), depois do campo Observação:

```tsx
          <label className={styles.campo}>Observação<input value={editObservacao} onChange={e => setEditObservacao(e.target.value)} /></label>
          <label className={styles.campo}>Nº da NF<input value={editNfNumero} onChange={e => setEditNfNumero(e.target.value)} /></label>
          <div className={styles.acoes}>
```

- [ ] **Step 8: Verificar build**

```bash
npm run build
```
Esperado: sem erros.

- [ ] **Step 9: Commit**

```bash
git add src/pages/Financeiro.tsx
git commit -m "feat: adiciona campo Nº da NF na criacao e edicao de lancamento financeiro"
```

---

### Task 3: Módulo de geração do Excel (`src/lib/financeiroExcel.ts`)

**Files:**
- Create: `src/lib/financeiroExcel.ts`

**Interfaces:**
- Consumes: `Etapa`, `LancamentoFinanceiro`, `Servico`, `Unidade` de `src/lib/supabase.ts` (campos usados: `Servico.etapa_id/codigo/nome/total/ativo`; `Etapa.unidade_id/ordem/nome`; `Unidade.ordem/nome`; `LancamentoFinanceiro.data_pagamento/valor/favorecido/servico_id/etapa_id/nf_numero`); `exceljs` (Task 1).
- Produces: `gerarExcelFinanceiro(obraNome: string, lancamentosPagos: LancamentoFinanceiro[], servicos: Servico[], etapas: Etapa[], unidades: Unidade[]): Promise<void>` — consumida pela Task 4. Lança `Error('Nenhum lançamento pago encontrado para exportar.')` se `lancamentosPagos` não tiver nenhum item com `data_pagamento` preenchido.

- [ ] **Step 1: Criar o arquivo com os tipos e o resolvedor de aplicação**

```ts
// src/lib/financeiroExcel.ts
// Exportação do Financeiro para .xlsx no formato multi-abas que a ENGEFER
// já usa (par de abas por mês: ledger de pagamentos + orçamento com
// previsto/realizado/saldo por item). Sempre recalculado na hora a partir
// dos lançamentos reais — nunca um snapshot guardado.
import ExcelJS from 'exceljs'
import type { Etapa, LancamentoFinanceiro, Servico, Unidade } from './supabase'

function resolverAplicacao(
  l: Pick<LancamentoFinanceiro, 'servico_id' | 'etapa_id'>,
  servicos: Servico[],
  etapas: Etapa[],
): string {
  const servico = l.servico_id ? servicos.find(s => s.id === l.servico_id) : null
  if (servico) return servico.nome
  const etapa = l.etapa_id ? etapas.find(e => e.id === l.etapa_id) : null
  if (etapa) return etapa.nome
  return 'Não classificado'
}

function mesAnoISO(dataISO: string): string {
  return dataISO.slice(0, 7)
}

function rotuloMes(mesAno: string): string {
  const [ano, mes] = mesAno.split('-')
  return `${mes}-${ano.slice(2)}`
}

export function listarMesesDoRange(primeiraData: string, hoje: string): string[] {
  const meses: string[] = []
  const partesInicio = primeiraData.slice(0, 7).split('-').map(Number)
  const partesFim = hoje.slice(0, 7).split('-').map(Number)
  let ano = partesInicio[0]
  let mes = partesInicio[1]
  const anoFim = partesFim[0]
  const mesFim = partesFim[1]
  while (ano < anoFim || (ano === anoFim && mes <= mesFim)) {
    meses.push(`${ano}-${String(mes).padStart(2, '0')}`)
    mes += 1
    if (mes > 12) { mes = 1; ano += 1 }
  }
  return meses
}
```

- [ ] **Step 2: Verificar as funções puras com um script ad-hoc**

Criar um arquivo temporário `scratch-verify-meses.ts` na raiz do projeto (fora de `src/`, não será commitado):

```ts
import { listarMesesDoRange } from './src/lib/financeiroExcel'

const meses = listarMesesDoRange('2026-07-15', '2026-09-08')
console.log(JSON.stringify(meses))
// Esperado: ["2026-07","2026-08","2026-09"]

const umMes = listarMesesDoRange('2026-09-01', '2026-09-08')
console.log(JSON.stringify(umMes))
// Esperado: ["2026-09"]

const viradaDeAno = listarMesesDoRange('2025-11-20', '2026-01-05')
console.log(JSON.stringify(viradaDeAno))
// Esperado: ["2025-11","2025-12","2026-01"]
```

Rodar:
```bash
npx tsx scratch-verify-meses.ts
```
Conferir as três saídas contra os comentários "Esperado". Depois apagar o arquivo:
```bash
rm scratch-verify-meses.ts
```

- [ ] **Step 3: Adicionar o cálculo das linhas do ledger mensal (aba "RF MM-YY")**

Acrescentar ao final de `src/lib/financeiroExcel.ts`:

```ts
export interface LinhaLedgerMes {
  dataPagamento: string
  nfNumero: string
  favorecido: string
  aplicacao: string
  valor: number
  totalAcumulado: number
  percentualAcumulado: number
}

export function calcularLinhasLedgerMes(
  lancamentosPagos: LancamentoFinanceiro[],
  servicos: Servico[],
  etapas: Etapa[],
  mesAno: string,
  valorTotalOrcamento: number,
): LinhaLedgerMes[] {
  const comData = lancamentosPagos
    .filter((l): l is LancamentoFinanceiro & { data_pagamento: string } => Boolean(l.data_pagamento))
    .sort((a, b) => a.data_pagamento.localeCompare(b.data_pagamento))

  let acumuladoAntes = 0
  for (const l of comData) {
    if (mesAnoISO(l.data_pagamento) < mesAno) acumuladoAntes += l.valor
  }

  const doMes = comData.filter(l => mesAnoISO(l.data_pagamento) === mesAno)
  const linhas: LinhaLedgerMes[] = []
  let acumulado = acumuladoAntes
  for (const l of doMes) {
    acumulado += l.valor
    linhas.push({
      dataPagamento: l.data_pagamento,
      nfNumero: l.nf_numero ?? '',
      favorecido: l.favorecido,
      aplicacao: resolverAplicacao(l, servicos, etapas),
      valor: l.valor,
      totalAcumulado: acumulado,
      percentualAcumulado: valorTotalOrcamento > 0 ? acumulado / valorTotalOrcamento : 0,
    })
  }
  return linhas
}
```

- [ ] **Step 4: Verificar `calcularLinhasLedgerMes` com um script ad-hoc**

Criar `scratch-verify-ledger.ts` na raiz do projeto:

```ts
import { calcularLinhasLedgerMes } from './src/lib/financeiroExcel'
import type { LancamentoFinanceiro } from './src/lib/supabase'

const base: Omit<LancamentoFinanceiro, 'id' | 'data_pagamento' | 'valor' | 'favorecido' | 'nf_numero' | 'servico_id' | 'etapa_id'> = {
  obra_id: 'o1', unidade_id: null, descricao: 'x', medicao_item_id: null, pedido_item_id: null,
  status: 'pago', data_vencimento: null, forma_pagamento: 'Pix', conta_origem: null,
  observacao: null, ativo: true, criado_por: 'u1', criado_em: '2026-01-01', pago_por: 'u1', pago_em: '2026-01-01',
}

const lancs: LancamentoFinanceiro[] = [
  { ...base, id: '1', data_pagamento: '2026-07-10', valor: 1000, favorecido: 'Fornecedor A', nf_numero: '111', servico_id: null, etapa_id: null },
  { ...base, id: '2', data_pagamento: '2026-08-05', valor: 500, favorecido: 'Fornecedor B', nf_numero: null, servico_id: null, etapa_id: null },
  { ...base, id: '3', data_pagamento: '2026-08-20', valor: 300, favorecido: 'Fornecedor C', nf_numero: '222', servico_id: null, etapa_id: null },
]

const linhasAgosto = calcularLinhasLedgerMes(lancs, [], [], '2026-08', 10000)
console.log(JSON.stringify(linhasAgosto, null, 2))
// Esperado: 2 linhas (Fornecedor B, Fornecedor C).
// totalAcumulado da 1a linha (B): 1500 (1000 de julho + 500)
// totalAcumulado da 2a linha (C): 1800 (1500 + 300)
// percentualAcumulado da 2a linha: 0.18
```

Rodar:
```bash
npx tsx scratch-verify-ledger.ts
```
Conferir os valores contra os comentários "Esperado", depois apagar:
```bash
rm scratch-verify-ledger.ts
```

- [ ] **Step 5: Adicionar o cálculo das linhas de orçamento mensal (aba "MM-YY")**

Acrescentar ao final de `src/lib/financeiroExcel.ts`:

```ts
export interface LinhaOrcamentoMes {
  tipo: 'unidade' | 'etapa' | 'servico'
  nome: string
  orcado: number
  gastoMes: number
  gastoAcumulado: number
}

export function calcularLinhasOrcamentoMes(
  unidades: Unidade[],
  etapas: Etapa[],
  servicos: Servico[],
  lancamentosPagos: LancamentoFinanceiro[],
  inicioMes: string,
  fimMes: string,
): LinhaOrcamentoMes[] {
  const comData = lancamentosPagos.filter((l): l is LancamentoFinanceiro & { data_pagamento: string } => Boolean(l.data_pagamento))
  const noMes = (l: LancamentoFinanceiro & { data_pagamento: string }) => l.data_pagamento >= inicioMes && l.data_pagamento <= fimMes
  const ateFimMes = (l: LancamentoFinanceiro & { data_pagamento: string }) => l.data_pagamento <= fimMes
  const somar = (lista: (LancamentoFinanceiro & { data_pagamento: string })[], filtro: (l: LancamentoFinanceiro & { data_pagamento: string }) => boolean) =>
    lista.filter(filtro).reduce((s, l) => s + l.valor, 0)

  const unidadesOrdenadas = [...unidades].sort((a, b) => a.ordem - b.ordem)
  const linhas: LinhaOrcamentoMes[] = []

  for (const unidade of unidadesOrdenadas) {
    const etapasDaUnidade = etapas.filter(e => e.unidade_id === unidade.id).sort((a, b) => a.ordem - b.ordem)
    let orcadoUnidade = 0, gastoMesUnidade = 0, gastoAcumUnidade = 0
    const linhasEtapa: LinhaOrcamentoMes[] = []
    let unidadeTemConteudo = false

    for (const etapa of etapasDaUnidade) {
      const servicosDaEtapa = servicos.filter(s => s.etapa_id === etapa.id && s.ativo)
        .sort((a, b) => (a.codigo ?? '').localeCompare(b.codigo ?? ''))
      const lancamentosEtapaDireta = comData.filter(l => !l.servico_id && l.etapa_id === etapa.id)
      if (servicosDaEtapa.length === 0 && lancamentosEtapaDireta.length === 0) continue
      unidadeTemConteudo = true

      let orcadoEtapa = 0, gastoMesEtapa = 0, gastoAcumEtapa = 0
      const linhasServico: LinhaOrcamentoMes[] = []

      for (const servico of servicosDaEtapa) {
        const lancDoServico = comData.filter(l => l.servico_id === servico.id)
        const orcado = servico.total ?? 0
        const gastoMes = somar(lancDoServico, noMes)
        const gastoAcum = somar(lancDoServico, ateFimMes)
        orcadoEtapa += orcado; gastoMesEtapa += gastoMes; gastoAcumEtapa += gastoAcum
        linhasServico.push({ tipo: 'servico', nome: servico.nome, orcado, gastoMes, gastoAcumulado: gastoAcum })
      }

      gastoMesEtapa += somar(lancamentosEtapaDireta, noMes)
      gastoAcumEtapa += somar(lancamentosEtapaDireta, ateFimMes)

      linhasEtapa.push({ tipo: 'etapa', nome: etapa.nome, orcado: orcadoEtapa, gastoMes: gastoMesEtapa, gastoAcumulado: gastoAcumEtapa })
      linhasEtapa.push(...linhasServico)

      orcadoUnidade += orcadoEtapa; gastoMesUnidade += gastoMesEtapa; gastoAcumUnidade += gastoAcumEtapa
    }

    if (!unidadeTemConteudo) continue
    linhas.push({ tipo: 'unidade', nome: unidade.nome, orcado: orcadoUnidade, gastoMes: gastoMesUnidade, gastoAcumulado: gastoAcumUnidade })
    linhas.push(...linhasEtapa)
  }

  const naoClassificado = comData.filter(l => !l.servico_id && !l.etapa_id)
  const gastoMesNC = somar(naoClassificado, noMes)
  const gastoAcumNC = somar(naoClassificado, ateFimMes)
  if (gastoMesNC > 0 || gastoAcumNC > 0) {
    linhas.push({ tipo: 'unidade', nome: 'Não classificado', orcado: 0, gastoMes: gastoMesNC, gastoAcumulado: gastoAcumNC })
  }

  return linhas
}
```

- [ ] **Step 6: Verificar `calcularLinhasOrcamentoMes` com um script ad-hoc**

Criar `scratch-verify-orcamento.ts` na raiz do projeto:

```ts
import { calcularLinhasOrcamentoMes } from './src/lib/financeiroExcel'
import type { Etapa, LancamentoFinanceiro, Servico, Unidade } from './src/lib/supabase'

const unidades: Unidade[] = [{ id: 'u1', obra_id: 'o1', nome: 'Sobrado 01', tipo: 'sobrado', ordem: 1 }]
const etapas: Etapa[] = [{ id: 'e1', unidade_id: 'u1', nome: 'Fundação', codigo: '1', ordem: 1, placeholder: false }]
const servicos: Servico[] = [
  { id: 's1', etapa_id: 'e1', codigo: '1.1', nome: 'Escavação', grupo: null, und: 'm3', quant: 10, valor_unit: 100, total: 1000, ativo: true },
]
const base = {
  obra_id: 'o1', unidade_id: null, descricao: 'x', favorecido: 'F', medicao_item_id: null, pedido_item_id: null,
  status: 'pago' as const, data_vencimento: null, forma_pagamento: 'Pix', conta_origem: null,
  observacao: null, nf_numero: null, ativo: true, criado_por: 'u1', criado_em: '2026-01-01', pago_por: 'u1', pago_em: '2026-01-01',
}
const lancs: LancamentoFinanceiro[] = [
  { ...base, id: 'l1', data_pagamento: '2026-08-10', valor: 400, servico_id: 's1', etapa_id: null },
  { ...base, id: 'l2', data_pagamento: '2026-09-01', valor: 100, servico_id: null, etapa_id: 'e1' },
  { ...base, id: 'l3', data_pagamento: '2026-09-02', valor: 50, servico_id: null, etapa_id: null },
]

const linhas = calcularLinhasOrcamentoMes(unidades, etapas, servicos, lancs, '2026-09-01', '2026-09-30')
console.log(JSON.stringify(linhas, null, 2))
// Esperado 3 linhas:
// { tipo: 'unidade', nome: 'Sobrado 01', orcado: 1000, gastoMes: 100, gastoAcumulado: 500 }
// { tipo: 'etapa', nome: 'Fundação', orcado: 1000, gastoMes: 100, gastoAcumulado: 500 }
// { tipo: 'servico', nome: 'Escavação', orcado: 1000, gastoMes: 0, gastoAcumulado: 400 }
// + 1 linha 'Não classificado': gastoMes 50, gastoAcumulado 50 (l3, sem etapa/servico)
```

Rodar:
```bash
npx tsx scratch-verify-orcamento.ts
```
Conferir: a linha "Fundação" soma o lançamento direto na etapa (l2, R$100 em setembro) ao gasto da etapa mesmo sem linha de serviço própria para ele; a linha "Escavação" reflete só o lançamento vinculado ao serviço (l1, R$400 acumulado, R$0 no mês porque foi pago em agosto); a linha "Não classificado" aparece com R$50 (l3, sem etapa nem serviço). Depois apagar:
```bash
rm scratch-verify-orcamento.ts
```

- [ ] **Step 7: Adicionar a montagem do workbook e o download**

Acrescentar ao final de `src/lib/financeiroExcel.ts`:

```ts
export async function gerarExcelFinanceiro(
  obraNome: string,
  lancamentosPagos: LancamentoFinanceiro[],
  servicos: Servico[],
  etapas: Etapa[],
  unidades: Unidade[],
): Promise<void> {
  const comData = lancamentosPagos.filter(l => l.data_pagamento)
  if (comData.length === 0) {
    throw new Error('Nenhum lançamento pago encontrado para exportar.')
  }

  const primeiraData = comData.reduce((min, l) => (l.data_pagamento! < min ? l.data_pagamento! : min), comData[0].data_pagamento!)
  const hoje = new Date().toISOString().slice(0, 10)
  const meses = listarMesesDoRange(primeiraData, hoje)
  const valorTotalOrcamento = servicos.filter(s => s.ativo).reduce((s, sv) => s + (sv.total ?? 0), 0)

  const workbook = new ExcelJS.Workbook()

  for (const mesAno of meses) {
    const [ano, mes] = mesAno.split('-')
    const inicioMes = `${mesAno}-01`
    const fimMes = new Date(Number(ano), Number(mes), 0).toISOString().slice(0, 10)
    const rotulo = rotuloMes(mesAno)

    const abaRF = workbook.addWorksheet(`RF ${rotulo}`)
    abaRF.columns = [
      { header: 'Data de Pagamento', key: 'data', width: 16 },
      { header: 'Nº NF', key: 'nf', width: 12 },
      { header: 'Fornecedor', key: 'fornecedor', width: 30 },
      { header: 'Aplicação', key: 'aplicacao', width: 30 },
      { header: 'Valor', key: 'valor', width: 14 },
      { header: 'Total Acumulado', key: 'total', width: 16 },
      { header: '% Acum.', key: 'pct', width: 10 },
    ]
    abaRF.getRow(1).font = { bold: true }
    const linhasLedger = calcularLinhasLedgerMes(comData, servicos, etapas, mesAno, valorTotalOrcamento)
    for (const l of linhasLedger) {
      abaRF.addRow({
        data: new Date(`${l.dataPagamento}T00:00:00`).toLocaleDateString('pt-BR'),
        nf: l.nfNumero,
        fornecedor: l.favorecido,
        aplicacao: l.aplicacao,
        valor: l.valor,
        total: l.totalAcumulado,
        pct: l.percentualAcumulado,
      })
    }
    abaRF.getColumn('valor').numFmt = '#,##0.00'
    abaRF.getColumn('total').numFmt = '#,##0.00'
    abaRF.getColumn('pct').numFmt = '0.0%'

    const abaOrc = workbook.addWorksheet(rotulo)
    abaOrc.columns = [
      { header: 'Item', key: 'nome', width: 40 },
      { header: 'Orçado', key: 'orcado', width: 14 },
      { header: 'Gasto no mês', key: 'gastoMes', width: 14 },
      { header: 'Gasto acumulado', key: 'gastoAcum', width: 16 },
      { header: 'Saldo', key: 'saldo', width: 14 },
    ]
    abaOrc.getRow(1).font = { bold: true }
    const linhasOrc = calcularLinhasOrcamentoMes(unidades, etapas, servicos, comData, inicioMes, fimMes)
    for (const linha of linhasOrc) {
      const row = abaOrc.addRow({
        nome: linha.nome,
        orcado: linha.orcado,
        gastoMes: linha.gastoMes,
        gastoAcum: linha.gastoAcumulado,
        saldo: linha.orcado - linha.gastoAcumulado,
      })
      if (linha.tipo === 'unidade') row.font = { bold: true, size: 12 }
      else if (linha.tipo === 'etapa') row.font = { bold: true }
    }
    ;(['orcado', 'gastoMes', 'gastoAcum', 'saldo'] as const).forEach(k => { abaOrc.getColumn(k).numFmt = '#,##0.00' })
  }

  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `Financeiro - ${obraNome}.xlsx`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
```

- [ ] **Step 8: Verificar a geração completa do workbook com um script ad-hoc**

Criar `scratch-verify-workbook.ts` na raiz do projeto (usa as mesmas fixtures do Step 6, sem o `document`/`URL` do navegador — testa só a parte de dados, escrevendo o buffer em disco pra inspeção manual):

```ts
import ExcelJS from 'exceljs'
import { calcularLinhasLedgerMes, calcularLinhasOrcamentoMes, listarMesesDoRange } from './src/lib/financeiroExcel'
import type { Etapa, LancamentoFinanceiro, Servico, Unidade } from './src/lib/supabase'
import { writeFileSync } from 'node:fs'

const unidades: Unidade[] = [{ id: 'u1', obra_id: 'o1', nome: 'Sobrado 01', tipo: 'sobrado', ordem: 1 }]
const etapas: Etapa[] = [{ id: 'e1', unidade_id: 'u1', nome: 'Fundação', codigo: '1', ordem: 1, placeholder: false }]
const servicos: Servico[] = [
  { id: 's1', etapa_id: 'e1', codigo: '1.1', nome: 'Escavação', grupo: null, und: 'm3', quant: 10, valor_unit: 100, total: 1000, ativo: true },
]
const base = {
  obra_id: 'o1', unidade_id: null, descricao: 'x', favorecido: 'Fornecedor Teste', medicao_item_id: null, pedido_item_id: null,
  status: 'pago' as const, data_vencimento: null, forma_pagamento: 'Pix', conta_origem: null,
  observacao: null, nf_numero: '999', ativo: true, criado_por: 'u1', criado_em: '2026-01-01', pago_por: 'u1', pago_em: '2026-01-01',
}
const lancs: LancamentoFinanceiro[] = [
  { ...base, id: 'l1', data_pagamento: '2026-08-10', valor: 400, servico_id: 's1', etapa_id: null },
]

const meses = listarMesesDoRange('2026-08-10', '2026-09-08')
const workbook = new ExcelJS.Workbook()
for (const mesAno of meses) {
  const [ano, mes] = mesAno.split('-')
  const inicioMes = `${mesAno}-01`
  const fimMes = new Date(Number(ano), Number(mes), 0).toISOString().slice(0, 10)
  const abaRF = workbook.addWorksheet(`RF ${mes}-${ano.slice(2)}`)
  abaRF.columns = [{ header: 'Data', key: 'data' }, { header: 'Fornecedor', key: 'fornecedor' }]
  for (const l of calcularLinhasLedgerMes(lancs, servicos, etapas, mesAno, 1000)) {
    abaRF.addRow({ data: l.dataPagamento, fornecedor: l.favorecido })
  }
  const abaOrc = workbook.addWorksheet(`${mes}-${ano.slice(2)}`)
  abaOrc.columns = [{ header: 'Item', key: 'nome' }, { header: 'Orçado', key: 'orcado' }]
  for (const linha of calcularLinhasOrcamentoMes(unidades, etapas, servicos, lancs, inicioMes, fimMes)) {
    abaOrc.addRow({ nome: linha.nome, orcado: linha.orcado })
  }
}
console.log('Abas geradas:', workbook.worksheets.map(w => w.name))
// Esperado: ["RF 08-26","08-26","RF 09-26","09-26"] — um par por mês, mesmo o mês
// atual (09-26) sem nenhum lançamento (RF 09-26 fica só com o cabeçalho).
const buffer = await workbook.xlsx.writeBuffer()
writeFileSync('scratch-verify.xlsx', buffer as unknown as Uint8Array)
console.log('Arquivo escrito: scratch-verify.xlsx, tamanho:', (buffer as ArrayBuffer).byteLength, 'bytes')
```

Rodar:
```bash
npx tsx scratch-verify-workbook.ts
```
Conferir a lista de abas no console contra o comentário "Esperado" (par RF/orçamento para agosto E para setembro, mesmo setembro sem lançamento nenhum — confirma que mês vazio não é pulado). Depois apagar os dois arquivos:
```bash
rm scratch-verify-workbook.ts scratch-verify.xlsx
```

- [ ] **Step 9: Verificar build**

```bash
npm run build
```
Esperado: sem erros. (Este módulo não é importado por nenhuma tela ainda — a Task 4 faz a ligação — então o build só confirma que o arquivo compila isoladamente.)

- [ ] **Step 10: Commit**

```bash
git add src/lib/financeiroExcel.ts
git commit -m "feat: adiciona geracao de excel financeiro no formato ENGEFER"
```

---

### Task 4: Botão "Exportar Excel" em `/financeiro`

**Files:**
- Modify: `src/pages/Financeiro.tsx`

**Interfaces:**
- Consumes: `gerarExcelFinanceiro` de `src/lib/financeiroExcel.ts` (Task 3), via `import()` dinâmico (mesmo padrão de lazy-load já usado pelos geradores de PDF do app, ex.: `await import('../lib/comprasPdf')`).

- [ ] **Step 1: Adicionar estado de exportação**

Depois da linha 65 (`const [msg, setMsg] = useState<...>(null)`):

```ts
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)
  const [exportando, setExportando] = useState(false)
```

- [ ] **Step 2: Adicionar o handler `exportarExcel`**

Logo depois da função `carregarBase` (depois da linha 114, antes do `useMemo` de `resumo` na linha 116):

```ts
  async function exportarExcel() {
    if (!obraAtiva) return
    setExportando(true)
    setMsg(null)
    try {
      const { gerarExcelFinanceiro } = await import('../lib/financeiroExcel')
      const pagos = lancamentos.filter(l => l.status === 'pago')
      await gerarExcelFinanceiro(obraAtiva.nome, pagos, servicos, etapas, unidades)
    } catch (e) {
      setMsg({ tipo: 'erro', texto: e instanceof Error ? e.message : 'Erro ao gerar o Excel.' })
    } finally {
      setExportando(false)
    }
  }
```

- [ ] **Step 3: Adicionar o botão no cabeçalho**

Na linha 281-289 (`<div className={styles.cabecalho}>...</div>`):

```tsx
      <div className={styles.cabecalho}>
        <div>
          <h1>Financeiro</h1>
          <p>Livro de lançamentos a pagar e pagos da obra ativa.</p>
        </div>
        <div className={styles.acoes}>
          <button className={styles.btnSecundario} onClick={exportarExcel} disabled={exportando || carregando}>
            {exportando ? 'Gerando...' : 'Exportar Excel'}
          </button>
          <button className={styles.btnSecundario} onClick={carregarBase} disabled={carregando}>
            Atualizar
          </button>
        </div>
      </div>
```

(Substitui o único `<button>` "Atualizar" que hoje é filho direto de `.cabecalho` por um `<div className={styles.acoes}>` com os dois botões — `styles.acoes` já existe no CSS module, usado nas seções "Dar baixa"/"Editar lançamento" linhas 322 e 341.)

- [ ] **Step 4: Verificar build**

```bash
npm run build
```
Esperado: sem erros.

- [ ] **Step 5: Commit**

```bash
git add src/pages/Financeiro.tsx
git commit -m "feat: adiciona botao Exportar Excel na tela financeiro"
```

---

## Self-Review (registro)

- **Cobertura da spec:** §3 (campo `nf_numero`) → Task 1+2. §4 (biblioteca `exceljs`) → Task 1. §5 (estrutura do arquivo, ambas as abas, meses sem pular) → Task 3. §6 (botão em `/financeiro`, mesma régua de acesso) → Task 4 (usa o `podeAcessar` que já é o early-return da tela — nenhum código novo de permissão necessário). §7 (fora de escopo) → nenhuma task extrapola.
- **Correção adicionada durante o planejamento (não estava na spec):** a aba "MM-YY" agrupa por unidade → etapa → serviço, não só por etapa — a spec não mencionava a unidade como nível de agrupamento, mas `etapas.ordem` é escopado por unidade (cada unidade recomeça a numeração), então ordenar globalmente por esse campo intercalaria etapas de sobrados diferentes em obras com mais de uma unidade (ex.: Tharsos Imperial). Necessário para respeitar a hierarquia do CLAUDE.md §4.
- **Correção de fato (não de comportamento):** a spec falava em "três lugares" onde `nf_numero` seria editável, espelhando `observacao`; a releitura do arquivo real mostrou que `observacao` só existe em dois lugares (criação, edição) — a seção "Dar baixa" não tem esse campo. Plano segue os dois lugares reais.
- **Tipagem:** `LinhaLedgerMes`/`LinhaOrcamentoMes` (Task 3) são consumidos só dentro do próprio `financeiroExcel.ts` (Task 3, Step 7) — sem uso em outra task, sem risco de nome divergente.
- **Placeholders:** nenhum "TBD"/"depois" neste plano — todo step tem código completo.
