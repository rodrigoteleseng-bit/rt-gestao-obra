# Curva S Financeira — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar peso em R$ à Curva S física (hoje só duração) e entregar a Curva S financeira
(previsto × realizado × desvio), previsto×realizado×saldo por etapa, e projeção de custo final por
ritmo de gasto, tudo dentro da aba "Financeiro" nova em `/cronograma`.

**Architecture:** Nenhuma tabela nova. Uma função SQL `SECURITY DEFINER` expõe os totais pagos de
`lancamentos_financeiros` agregados (sem fornecedor/NF/descrição) para qualquer usuário que possa
acessar a obra — inclusive `cliente`, que não tem acesso à tabela crua. No frontend, o peso da
árvore do cronograma (`montarArvore`, hoje só duração) ganha um parâmetro opcional de peso por
tarefa; a Curva S física existente não muda de comportamento (usa o peso padrão), e uma nova função
`calcularPesoFinanceiro` produz o peso híbrido R$/duração usado só pela Curva S financeira.

**Tech Stack:** React 19 + TypeScript + Vite, Supabase (Postgres + RLS), sem framework de testes
automatizados no projeto (ver Global Constraints).

## Global Constraints

- Spec de origem: `docs/superpowers/specs/2026-09-04-fase3-curva-s-financeira-design.md` — todo
  requisito deste plano vem de lá; qualquer dúvida de comportamento, essa spec é a fonte.
- **Este repositório não tem framework de testes automatizados** (sem vitest/jest, sem arquivo
  `*.test.ts`, `package.json` só tem `dev`/`build`/`preview`). O padrão real do projeto, usado em
  toda fase anterior, é: `npm run build` (roda `tsc -b && vite build`) para checagem de tipo, mais
  verificação manual/guiada (usuário temporário no preview, removido depois do teste). Cada tarefa
  abaixo substitui "escreva o teste que falha" por essa verificação real — não introduza um
  framework de testes novo, isso não foi pedido e não é como o projeto verifica hoje.
- Categorias de risco desta entrega, por `docs/colaboracao-codex-claude.md`: **RLS/RPC nova**
  (Tarefa 1) e **cálculo financeiro** (Tarefas 3, 5, 6) — exige revisão do Claude Code **antes**
  da implementação (já feita nesta sessão, autor da spec e deste plano) e **de novo depois do
  commit**, antes de qualquer teste de campo do Rodrigo.
- Responsável padrão pela execução deste plano: **Codex** (ver
  `docs/colaboracao-codex-claude.md`). Claude Code revisa antes de qualquer teste de campo.
- Migrações Supabase vão em `supabase/migrations/`, sempre versionadas — nenhuma alteração manual
  direta em produção.
- Mensagens de UI e nomes de campo em português, seguindo o padrão do resto do app.
- `formatarMoeda(valor)` (de `src/lib/formato.ts`) formata só o número — o `"R$ "` é escrito à mão
  no JSX (`R$ {formatarMoeda(valor)}`), igual em todo o resto do app.

---

### Task 1: RPC `financeiro_realizado_agregado`

**Files:**
- Create: `supabase/migrations/20260904_financeiro_curva_s_agregado.sql`

**Interfaces:**
- Produces: função Postgres `financeiro_realizado_agregado(p_obra_id uuid) RETURNS TABLE
  (data_pagamento date, etapa_id uuid, servico_id uuid, valor numeric)`, `GRANT EXECUTE ... TO
  authenticated`. Task 5 consome via `supabase.rpc('financeiro_realizado_agregado', { p_obra_id })`.

- [ ] **Step 1: Escrever a migração**

```sql
-- Curva S financeira: agrega lancamentos_financeiros pagos por data/etapa/servico,
-- sem expor fornecedor/NF/descricao, para uso pela Curva S financeira e pelo
-- previsto x realizado x saldo por etapa (visivel tambem ao papel cliente, que
-- nao tem acesso a lancamentos_financeiros diretamente).
-- Ver docs/superpowers/specs/2026-09-04-fase3-curva-s-financeira-design.md secao 8.

CREATE OR REPLACE FUNCTION financeiro_realizado_agregado(p_obra_id UUID)
RETURNS TABLE (data_pagamento DATE, etapa_id UUID, servico_id UUID, valor NUMERIC)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT lf.data_pagamento, lf.etapa_id, lf.servico_id, SUM(lf.valor) AS valor
  FROM lancamentos_financeiros lf
  WHERE lf.obra_id = p_obra_id
    AND lf.ativo = true
    AND lf.status = 'pago'
    AND pode_acessar_obra(p_obra_id)
  GROUP BY lf.data_pagamento, lf.etapa_id, lf.servico_id
$$;

GRANT EXECUTE ON FUNCTION financeiro_realizado_agregado(UUID) TO authenticated;
```

- [ ] **Step 2: Aplicar a migração**

Aplicar via Supabase MCP (`apply_migration`) ou `supabase db push`, conforme o fluxo já usado nas
migrações anteriores deste projeto (não há stack local — migrações vão direto para o projeto
remoto).

- [ ] **Step 3: Verificar a função existe e o shape das colunas está correto**

Rodar no SQL Editor do Supabase:

```sql
SELECT proname, pg_get_function_result(oid) AS retorno
FROM pg_proc
WHERE proname = 'financeiro_realizado_agregado';
```

Expected: uma linha, `retorno` contendo `TABLE(data_pagamento date, etapa_id uuid, servico_id uuid,
valor numeric)`.

- [ ] **Step 4: Verificar que a função soma corretamente contra a obra piloto**

```sql
SELECT SUM(valor) AS total_pago
FROM financeiro_realizado_agregado('00000000-0000-0000-0000-000000000001');
```

Expected: um número (pode ser 0 se não houver lançamento `pago` ainda) que bate com
`SELECT SUM(valor) FROM lancamentos_financeiros WHERE obra_id =
'00000000-0000-0000-0000-000000000001' AND ativo AND status = 'pago'` rodado como superusuário no
mesmo SQL Editor — os dois totais devem ser idênticos.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260904_financeiro_curva_s_agregado.sql
git commit -m "feat: RPC financeiro_realizado_agregado para Curva S financeira"
```

---

### Task 2: Generalizar o peso da árvore do cronograma (`montarArvore`)

**Files:**
- Modify: `src/lib/cronograma.ts:122-160` (função `montarArvore`)
- Modify: `src/pages/Cronograma.tsx:233-241` (componente `CurvaS`, extrai a coleta de folhas)

**Interfaces:**
- Consumes: nada novo.
- Produces: `montarArvore(tarefas, previstoPorTarefa, pctPorTarefa, pesoFolha?)` — 4º parâmetro
  opcional `pesoFolha: (tarefa: CronogramaTarefa, previsto: CronogramaPrevisto | null) => number`,
  default `(_, previsto) => previsto?.duracao_horas || 1` (comportamento atual, sem mudança para
  quem já chama com 3 argumentos). Nova função exportada `folhasComPrevisto(arvore: Map<string,
  NoCronograma[]>): NoCronograma[]`, usada por Task 6.

- [ ] **Step 1: Generalizar `montarArvore` em `src/lib/cronograma.ts`**

Substituir a assinatura e o corpo de `agregar` (linhas 122-157 atuais):

```ts
export function montarArvore(
  tarefas: CronogramaTarefa[],
  previstoPorTarefa: Map<string, CronogramaPrevisto>,
  pctPorTarefa: Map<string, AvancoFisico>,
  pesoFolha: (tarefa: CronogramaTarefa, previsto: CronogramaPrevisto | null) => number =
    (_tarefa, previsto) => previsto?.duracao_horas || 1,
): Map<string, NoCronograma[]> {
  const nos = new Map<string, NoCronograma>()
  for (const t of tarefas) {
    nos.set(t.id, { tarefa: t, filhos: [], previsto: previstoPorTarefa.get(t.id) ?? null, peso: 0, percentual: 0 })
  }
  const raizesPorUnidade = new Map<string, NoCronograma[]>()
  for (const t of tarefas) {
    const no = nos.get(t.id)!
    if (t.parent_id && nos.has(t.parent_id)) {
      nos.get(t.parent_id)!.filhos.push(no)
    } else {
      const lista = raizesPorUnidade.get(t.unidade_id) ?? []
      lista.push(no)
      raizesPorUnidade.set(t.unidade_id, lista)
    }
  }
  function agregar(no: NoCronograma): void {
    if (no.filhos.length === 0) {
      no.peso = pesoFolha(no.tarefa, no.previsto)
      no.percentual = pctPorTarefa.get(no.tarefa.id)?.percentual ?? 0
      return
    }
    let peso = 0
    let executado = 0
    for (const f of no.filhos) {
      agregar(f)
      peso += f.peso
      executado += f.peso * f.percentual
    }
    no.peso = peso
    no.percentual = peso > 0 ? executado / peso : 0
  }
  for (const raizes of raizesPorUnidade.values()) for (const r of raizes) agregar(r)
  return raizesPorUnidade
}
```

- [ ] **Step 2: Adicionar `folhasComPrevisto` logo depois de `montarArvore` em `src/lib/cronograma.ts`**

```ts
// Extrai as tarefas-folha com previsto de uma árvore já montada — usado pela Curva S
// física e pela Curva S financeira (mesmo critério: só entram na curva tarefas com
// data prevista na baseline vigente).
export function folhasComPrevisto(arvore: Map<string, NoCronograma[]>): NoCronograma[] {
  const folhas: NoCronograma[] = []
  const coletar = (no: NoCronograma) => {
    if (no.filhos.length === 0) { if (no.previsto) folhas.push(no) }
    else no.filhos.forEach(coletar)
  }
  for (const raizes of arvore.values()) raizes.forEach(coletar)
  return folhas
}
```

- [ ] **Step 3: Usar `folhasComPrevisto` em `CurvaS` (`src/pages/Cronograma.tsx`)**

No import do topo do arquivo, adicionar `folhasComPrevisto` à lista importada de `../lib/cronograma`
(linha 4-7 atual). Dentro de `CurvaS` (por volta da linha 233-241 atual), substituir:

```ts
    // Folhas com previsto
    const folhas: NoCronograma[] = []
    const coletar = (no: NoCronograma) => {
      if (no.filhos.length === 0) { if (no.previsto) folhas.push(no) }
      else no.filhos.forEach(coletar)
    }
    for (const raizes of arvore.values()) raizes.forEach(coletar)
    if (folhas.length === 0) return null
```

por:

```ts
    const folhas = folhasComPrevisto(arvore)
    if (folhas.length === 0) return null
```

- [ ] **Step 4: Checagem de tipo**

Run: `npm run build`
Expected: build passa sem erro (`tsc -b && vite build` conclui, sem `error TS...` no output).

- [ ] **Step 5: Verificar que a Curva S física não mudou**

Rodar `npm run dev`, abrir `/cronograma` → aba "Curva S" com a obra piloto carregada, anotar os
valores dos três cards (Previsto até hoje / Realizado / Desvio). Devem ser **idênticos** aos
valores de antes desta mudança (a refatoração só reorganiza código, não muda cálculo — `pesoFolha`
não foi passado, então o default reproduz exatamente `previsto?.duracao_horas || 1`).

- [ ] **Step 6: Commit**

```bash
git add src/lib/cronograma.ts src/pages/Cronograma.tsx
git commit -m "refactor: generaliza peso da arvore do cronograma para aceitar peso em R$"
```

---

### Task 3: Peso híbrido R$/duração (`calcularPesoFinanceiro`)

**Files:**
- Modify: `src/lib/cronograma.ts` (adicionar ao final do arquivo)

**Interfaces:**
- Consumes: `CronogramaTarefa`, `CronogramaPrevisto` (já definidos em `src/lib/supabase.ts`),
  `Servico` (idem, precisa ser importado neste arquivo).
- Produces: `interface PesoFinanceiro { pesoFolha: (tarefaId: string) => number; valorTotal:
  number; valorVinculado: number; cobertura: number }` e `calcularPesoFinanceiro(tarefas:
  CronogramaTarefa[], previstoPorTarefa: Map<string, CronogramaPrevisto>, servicos: Servico[]):
  PesoFinanceiro`. Consumido por Task 6.

- [ ] **Step 1: Adicionar o import de `Servico` no topo de `src/lib/cronograma.ts`**

```ts
import type { CronogramaVersao, CronogramaTarefa, CronogramaPrevisto, AvancoFisico, Servico } from './supabase'
```

- [ ] **Step 2: Adicionar `calcularPesoFinanceiro` ao final de `src/lib/cronograma.ts`**

```ts
// Peso hibrido R$/duracao para a Curva S financeira (ver
// docs/superpowers/specs/2026-09-04-fase3-curva-s-financeira-design.md secao 4).
// Tarefas-folha com servico_id vinculado a um servico ativo pesam pelo valor real
// do servico (dividido proporcionalmente por duracao se o mesmo servico_id estiver
// em mais de uma tarefa, para nunca contar o mesmo valor duas vezes). O restante do
// orcamento total (o que ainda nao tem vinculo direto) e distribuido pelas tarefas
// sem vinculo, proporcional a duracao de cada uma — mesma aproximacao [estimado] ja
// usada pelo peso por duracao puro, agora ancorada a um total real.
export interface PesoFinanceiro {
  pesoFolha: (tarefaId: string) => number
  valorTotal: number
  valorVinculado: number
  cobertura: number
}

export function calcularPesoFinanceiro(
  tarefas: CronogramaTarefa[],
  previstoPorTarefa: Map<string, CronogramaPrevisto>,
  servicos: Servico[],
): PesoFinanceiro {
  const valorPorServico = new Map(servicos.filter(s => s.ativo).map(s => [s.id, s.total ?? 0]))
  const valorTotal = servicos.filter(s => s.ativo).reduce((a, s) => a + (s.total ?? 0), 0)

  const idsComFilhos = new Set(tarefas.filter(t => t.parent_id).map(t => t.parent_id as string))
  const folhas = tarefas.filter(t => !idsComFilhos.has(t.id))

  const duracao = (t: CronogramaTarefa) => previstoPorTarefa.get(t.id)?.duracao_horas || 1

  const grupoPorServico = new Map<string, CronogramaTarefa[]>()
  const naoVinculadas: CronogramaTarefa[] = []
  for (const f of folhas) {
    if (f.servico_id && valorPorServico.has(f.servico_id)) {
      const grupo = grupoPorServico.get(f.servico_id) ?? []
      grupo.push(f)
      grupoPorServico.set(f.servico_id, grupo)
    } else {
      naoVinculadas.push(f)
    }
  }

  const pesos = new Map<string, number>()
  let valorVinculado = 0
  for (const [servicoId, grupo] of grupoPorServico) {
    const valorServico = valorPorServico.get(servicoId) ?? 0
    valorVinculado += valorServico
    const duracaoGrupo = grupo.reduce((a, t) => a + duracao(t), 0)
    for (const t of grupo) {
      pesos.set(t.id, duracaoGrupo > 0 ? valorServico * (duracao(t) / duracaoGrupo) : valorServico / grupo.length)
    }
  }

  const valorResto = Math.max(0, valorTotal - valorVinculado)
  const duracaoResto = naoVinculadas.reduce((a, t) => a + duracao(t), 0)
  for (const t of naoVinculadas) {
    pesos.set(t.id, duracaoResto > 0 ? valorResto * (duracao(t) / duracaoResto) : 0)
  }

  return {
    pesoFolha: (tarefaId: string) => pesos.get(tarefaId) ?? 0,
    valorTotal,
    valorVinculado,
    cobertura: valorTotal > 0 ? valorVinculado / valorTotal : 0,
  }
}
```

- [ ] **Step 3: Checagem de tipo**

Run: `npm run build`
Expected: build passa sem erro.

- [ ] **Step 4: Verificar a soma dos pesos bate com o orçamento total**

Verificação manual temporária: em `src/pages/Cronograma.tsx`, dentro do `useMemo` de `calculado`
(por volta da linha 46-51 atual), adicionar por um instante:

```ts
console.log('DEBUG peso financeiro', calcularPesoFinanceiro(dados.tarefas, dados.previstoPorTarefa, /* servicos carregados */))
```

Não é possível rodar este passo isoladamente antes da Task 6 carregar `servicos` — adiar esta
verificação específica (soma dos pesos = `valorTotal`, `cobertura` entre 0 e 1) para o Step de
verificação da Task 6, que já tem `servicos` disponível. Marcar este step como feito após a
verificação da Task 6 confirmar os números.

- [ ] **Step 5: Commit**

```bash
git add src/lib/cronograma.ts
git commit -m "feat: peso hibrido R$/duracao para Curva S financeira"
```

---

### Task 4: Tipo `RealizadoAgregado`

**Files:**
- Modify: `src/lib/supabase.ts` (adicionar logo após a `interface LancamentoFinanceiro`, atual
  linha ~564)

**Interfaces:**
- Produces: `interface RealizadoAgregado { data_pagamento: string; etapa_id: string | null;
  servico_id: string | null; valor: number }`. Consumido por Task 5.

- [ ] **Step 1: Adicionar a interface**

```ts
// Retorno da RPC financeiro_realizado_agregado — totais pagos por dia/etapa/servico,
// sem fornecedor/NF/descricao (ver migração 20260904_financeiro_curva_s_agregado.sql).
export interface RealizadoAgregado {
  data_pagamento: string
  etapa_id: string | null
  servico_id: string | null
  valor: number
}
```

- [ ] **Step 2: Checagem de tipo**

Run: `npm run build`
Expected: build passa sem erro.

- [ ] **Step 3: Commit**

```bash
git add src/lib/supabase.ts
git commit -m "feat: tipo RealizadoAgregado para Curva S financeira"
```

---

### Task 5: `src/lib/financeiro-curva.ts` — carregamento e cálculos

**Files:**
- Create: `src/lib/financeiro-curva.ts`

**Interfaces:**
- Consumes: `supabase` (de `./supabase`), `RealizadoAgregado`, `Servico`, `Etapa` (de
  `./supabase`), `NoCronograma` (de `./cronograma`, só o shape `{ peso: number; previsto:
  CronogramaPrevisto | null }` é usado).
- Produces:
  - `carregarRealizadoAgregado(obraId: string): Promise<RealizadoAgregado[]>`
  - `calcularSaldoPorEtapa(servicos: Servico[], etapas: Etapa[], realizados:
    RealizadoAgregado[]): SaldoEtapa[]` com `interface SaldoEtapa { etapaId: string | null;
    etapaNome: string; orcado: number; realizado: number; saldo: number; pctConsumido: number |
    null }`
  - `calcularRitmoMensal(realizados: RealizadoAgregado[], hoje: string): number | null`
  - `calcularMesesRestantes(hoje: string, fimCronograma: string | null): number`
  - `calcularProjecao(realizados: RealizadoAgregado[], hoje: string, fimCronograma: string | null,
    orcamentoTotal: number): ProjecaoCustoFinal` com `interface ProjecaoCustoFinal { ritmoMensal:
    number | null; mesesRestantes: number; realizadoTotal: number; custoFinalProjetado: number |
    null; desvioProjetado: number | null }`
  - `calcularCurvaSFinanceira(folhas: { peso: number; previsto: { inicio: string; fim: string } }[],
    realizados: RealizadoAgregado[], hoje: string): { pontos: PontoCurvaFinanceira[];
    valorTotalCronograma: number }` com `interface PontoCurvaFinanceira { data: string; previsto:
    number; realizado: number | null }`

  Consumido por Task 6.

- [ ] **Step 1: Criar o arquivo com carregamento e saldo por etapa**

```ts
// Curva S financeira, previsto x realizado x saldo por etapa, e projeção de custo
// final por ritmo de gasto. Ver
// docs/superpowers/specs/2026-09-04-fase3-curva-s-financeira-design.md.

import { supabase } from './supabase'
import type { Etapa, RealizadoAgregado, Servico } from './supabase'

export async function carregarRealizadoAgregado(obraId: string): Promise<RealizadoAgregado[]> {
  const { data, error } = await supabase.rpc('financeiro_realizado_agregado', { p_obra_id: obraId })
  if (error) throw new Error(error.message)
  return data ?? []
}

export interface SaldoEtapa {
  etapaId: string | null
  etapaNome: string
  orcado: number
  realizado: number
  saldo: number
  pctConsumido: number | null
}

// Resolve a etapa de um lançamento: pelo serviço vinculado, senão pela etapa direta
// do lançamento, senão "não classificado" — nunca inventa vínculo (regra de
// rastreabilidade nº 3 do CLAUDE.md).
export function calcularSaldoPorEtapa(
  servicos: Servico[],
  etapas: Etapa[],
  realizados: RealizadoAgregado[],
): SaldoEtapa[] {
  const etapaPorServico = new Map(servicos.map(s => [s.id, s.etapa_id]))
  const nomeEtapa = new Map(etapas.map(e => [e.id, e.nome]))

  const orcadoPorEtapa = new Map<string, number>()
  for (const s of servicos) {
    if (!s.ativo) continue
    orcadoPorEtapa.set(s.etapa_id, (orcadoPorEtapa.get(s.etapa_id) ?? 0) + (s.total ?? 0))
  }

  const realizadoPorEtapa = new Map<string, number>()
  let naoClassificado = 0
  for (const r of realizados) {
    const etapaResolvida = (r.servico_id && etapaPorServico.get(r.servico_id)) || r.etapa_id
    if (!etapaResolvida) { naoClassificado += r.valor; continue }
    realizadoPorEtapa.set(etapaResolvida, (realizadoPorEtapa.get(etapaResolvida) ?? 0) + r.valor)
  }

  const etapaIds = new Set([...orcadoPorEtapa.keys(), ...realizadoPorEtapa.keys()])
  const linhas: SaldoEtapa[] = [...etapaIds].map(etapaId => {
    const orcado = orcadoPorEtapa.get(etapaId) ?? 0
    const realizado = realizadoPorEtapa.get(etapaId) ?? 0
    return {
      etapaId,
      etapaNome: nomeEtapa.get(etapaId) ?? '(etapa removida)',
      orcado,
      realizado,
      saldo: orcado - realizado,
      pctConsumido: orcado > 0 ? realizado / orcado : null,
    }
  })
  linhas.sort((a, b) => a.etapaNome.localeCompare(b.etapaNome))

  if (naoClassificado > 0) {
    linhas.push({
      etapaId: null, etapaNome: 'Não classificado',
      orcado: 0, realizado: naoClassificado, saldo: -naoClassificado, pctConsumido: null,
    })
  }
  return linhas
}
```

- [ ] **Step 2: Adicionar projeção de custo final ao mesmo arquivo**

```ts
function mesAnoISO(dataISO: string): string {
  return dataISO.slice(0, 7)
}

// Média do realizado dos últimos 3 meses fechados (o mês corrente nunca entra —
// está incompleto). Sem mês fechado ainda: retorna null ("sem dados suficientes",
// nunca inventa um número — regra de rastreabilidade nº 3 do CLAUDE.md).
export function calcularRitmoMensal(realizados: RealizadoAgregado[], hoje: string): number | null {
  const mesAtual = mesAnoISO(hoje)
  const porMes = new Map<string, number>()
  for (const r of realizados) {
    const m = mesAnoISO(r.data_pagamento)
    if (m >= mesAtual) continue
    porMes.set(m, (porMes.get(m) ?? 0) + r.valor)
  }
  const meses = [...porMes.keys()].sort().reverse().slice(0, 3)
  if (meses.length === 0) return null
  const soma = meses.reduce((a, m) => a + (porMes.get(m) ?? 0), 0)
  return soma / meses.length
}

export function calcularMesesRestantes(hoje: string, fimCronograma: string | null): number {
  if (!fimCronograma || fimCronograma <= hoje) return 0
  const dias = (Date.parse(fimCronograma) - Date.parse(hoje)) / 86_400_000
  return Math.max(0, dias / 30)
}

export interface ProjecaoCustoFinal {
  ritmoMensal: number | null
  mesesRestantes: number
  realizadoTotal: number
  custoFinalProjetado: number | null
  desvioProjetado: number | null
}

export function calcularProjecao(
  realizados: RealizadoAgregado[],
  hoje: string,
  fimCronograma: string | null,
  orcamentoTotal: number,
): ProjecaoCustoFinal {
  const realizadoTotal = realizados.reduce((a, r) => a + r.valor, 0)
  const ritmoMensal = calcularRitmoMensal(realizados, hoje)
  const mesesRestantes = calcularMesesRestantes(hoje, fimCronograma)
  const custoFinalProjetado = ritmoMensal === null ? null : realizadoTotal + ritmoMensal * mesesRestantes
  const desvioProjetado = custoFinalProjetado === null ? null : custoFinalProjetado - orcamentoTotal
  return { ritmoMensal, mesesRestantes, realizadoTotal, custoFinalProjetado, desvioProjetado }
}
```

- [ ] **Step 3: Adicionar a série da Curva S financeira ao mesmo arquivo**

```ts
export interface PontoCurvaFinanceira { data: string; previsto: number; realizado: number | null }

// Mesma lógica de interpolação linear já usada pela Curva S física
// (src/pages/Cronograma.tsx, componente CurvaS): previsto = soma do peso de cada
// folha ponderado pela fração do intervalo [início, fim] já decorrida na data.
// Realizado vem de lancamentos_financeiros pagos (via financeiro_realizado_agregado),
// não do peso/árvore — são fontes independentes, plotadas na mesma escala (R$).
export function calcularCurvaSFinanceira(
  folhas: { peso: number; previsto: { inicio: string; fim: string } }[],
  realizados: RealizadoAgregado[],
  hoje: string,
): { pontos: PontoCurvaFinanceira[]; valorTotalCronograma: number } {
  const valorTotalCronograma = folhas.reduce((a, f) => a + f.peso, 0)
  if (valorTotalCronograma === 0 || folhas.length === 0) return { pontos: [], valorTotalCronograma: 0 }

  const inicioObra = folhas.reduce((a, f) => f.previsto.inicio < a ? f.previsto.inicio : a, '9999-12-31')
  const fimObra = folhas.reduce((a, f) => f.previsto.fim > a ? f.previsto.fim : a, '0000-01-01')

  const porData = new Map<string, number>()
  for (const r of realizados) porData.set(r.data_pagamento, (porData.get(r.data_pagamento) ?? 0) + r.valor)
  const datasOrdenadas = [...porData.keys()].sort()

  const DIA = 86_400_000
  const t0 = Date.parse(inicioObra)
  const t1 = Date.parse(fimObra)
  const pontos: PontoCurvaFinanceira[] = []
  for (let t = t0; ; t += 7 * DIA) {
    const clampT = Math.min(t, t1)
    const dataISO = new Date(clampT).toISOString().slice(0, 10)
    let prev = 0
    for (const f of folhas) {
      const pi = Date.parse(f.previsto.inicio)
      const pf = Date.parse(f.previsto.fim)
      const frac = clampT >= pf ? 1 : clampT <= pi ? 0 : (clampT - pi) / (pf - pi)
      prev += f.peso * frac
    }
    let realizado: number | null = null
    if (dataISO <= hoje) {
      realizado = 0
      for (const d of datasOrdenadas) { if (d <= dataISO) realizado += porData.get(d) ?? 0; else break }
    }
    pontos.push({ data: dataISO, previsto: prev, realizado })
    if (t >= t1) break
  }
  return { pontos, valorTotalCronograma }
}
```

- [ ] **Step 4: Checagem de tipo**

Run: `npm run build`
Expected: build passa sem erro.

- [ ] **Step 5: Commit**

```bash
git add src/lib/financeiro-curva.ts
git commit -m "feat: calculos da Curva S financeira, saldo por etapa e projecao de custo final"
```

---

### Task 6: Aba "Financeiro" em `/cronograma`

**Files:**
- Modify: `src/pages/Cronograma.tsx`
- Modify: `src/pages/Cronograma.module.css` (só se algo abaixo não encontrar classe equivalente —
  ver Step 3)

**Interfaces:**
- Consumes: tudo produzido nas Tasks 1-5 — `montarArvore` (4º argumento), `folhasComPrevisto`,
  `calcularPesoFinanceiro`, `carregarRealizadoAgregado`, `calcularSaldoPorEtapa`,
  `calcularProjecao`, `calcularCurvaSFinanceira`, tipo `RealizadoAgregado`.
- Produces: aba "Financeiro" visível a todos os papéis (mesma visibilidade da aba "Curva S" já
  existente).

- [ ] **Step 1: Carregar `servicos`, `etapas` e `realizados` junto com o cronograma**

No topo de `src/pages/Cronograma.tsx`, ajustar os imports:

```ts
import { useEffect, useMemo, useState } from 'react'
import { useObra } from '../contexts/ObraContext'
import { supabase, type Etapa, type RealizadoAgregado, type Servico, type Unidade } from '../lib/supabase'
import {
  carregarCronograma, percentuaisAtuais, montarArvore, statusTarefa, hojeISO,
  folhasComPrevisto, calcularPesoFinanceiro,
  type DadosCronograma, type NoCronograma, type StatusTarefa,
} from '../lib/cronograma'
import { carregarRealizadoAgregado, calcularSaldoPorEtapa, calcularProjecao, calcularCurvaSFinanceira } from '../lib/financeiro-curva'
import styles from './Cronograma.module.css'
```

Ajustar `type Aba` (linha 18 atual) para incluir a nova aba:

```ts
type Aba = 'arvore' | 'curva' | 'financeiro' | 'atrasadas'
```

Adicionar estado para os dados novos, junto aos outros `useState` do componente `Cronograma`:

```ts
  const [servicos, setServicos] = useState<Servico[]>([])
  const [etapas, setEtapas] = useState<Etapa[]>([])
  const [realizados, setRealizados] = useState<RealizadoAgregado[]>([])
```

Ajustar o `useEffect` de carregamento (linhas 31-42 atuais) para buscar tudo em paralelo:

```ts
  useEffect(() => {
    if (!obraAtiva) return
    setCarregando(true)
    Promise.all([
      carregarCronograma(obraAtiva.id),
      supabase.from('unidades').select('*').eq('obra_id', obraAtiva.id).order('ordem').then(r => r.data ?? []),
      carregarTodosServicosAtivos(),
      carregarEtapasDaObra(obraAtiva.id),
      carregarRealizadoAgregado(obraAtiva.id),
    ]).then(([d, u, s, e, r]) => {
      setDados(d)
      setUnidades(u)
      setServicos(s)
      setEtapas(e)
      setRealizados(r)
      setCarregando(false)
    })
  }, [obraAtiva])
```

Adicionar os dois helpers de carregamento logo acima do componente `Cronograma` (mesmo padrão de
paginação já usado em `src/pages/Financeiro.tsx`, função `carregarTodosServicos`):

```ts
async function carregarTodosServicosAtivos(): Promise<Servico[]> {
  const todos: Servico[] = []
  const pagina = 1000
  for (let de = 0; ; de += pagina) {
    const { data } = await supabase.from('servicos').select('*').eq('ativo', true).order('codigo').range(de, de + pagina - 1)
    const lote = data ?? []
    todos.push(...lote)
    if (lote.length < pagina) break
  }
  return todos
}

async function carregarEtapasDaObra(obraId: string): Promise<Etapa[]> {
  const { data: unidadesData } = await supabase.from('unidades').select('id').eq('obra_id', obraId)
  const ids = (unidadesData ?? []).map(u => u.id)
  if (ids.length === 0) return []
  const { data } = await supabase.from('etapas').select('*').in('unidade_id', ids).eq('placeholder', false).order('ordem')
  return data ?? []
}
```

- [ ] **Step 2: Adicionar o botão da aba**

Na barra de abas (linhas 88-94 atuais), adicionar o botão entre "Curva S" e "Atrasadas":

```tsx
      <div className={styles.abas}>
        <button className={aba === 'arvore' ? styles.abaAtiva : styles.aba} onClick={() => setAba('arvore')}>Tarefas</button>
        <button className={aba === 'curva' ? styles.abaAtiva : styles.aba} onClick={() => setAba('curva')}>Curva S</button>
        <button className={aba === 'financeiro' ? styles.abaAtiva : styles.aba} onClick={() => setAba('financeiro')}>Financeiro</button>
        <button className={aba === 'atrasadas' ? styles.abaAtiva : styles.aba} onClick={() => setAba('atrasadas')}>
          Atrasadas
        </button>
      </div>
```

Depois do bloco `{aba === 'curva' && (...)}`, adicionar:

```tsx
      {aba === 'financeiro' && (
        <CurvaSFinanceira
          dados={dados} arvore={arvore} hoje={hoje}
          servicos={servicos} etapas={etapas} realizados={realizados}
        />
      )}
```

- [ ] **Step 3: Escrever o componente `CurvaSFinanceira`**

Adicionar ao final de `src/pages/Cronograma.tsx`, no mesmo estilo do componente `CurvaS` existente
(reaproveita `styles.cards`, `styles.card`, `styles.cardLabel`, `styles.cardValor`,
`styles.cardBom`/`styles.cardRuim`, `styles.graficoWrap`, `styles.grafico`, `styles.legenda`,
`styles.tabelaWrap`, `styles.tabela`, `styles.num`, `styles.fonte` — todas já existem em
`Cronograma.module.css`, nenhuma classe nova é necessária):

```tsx
const fmtMoeda = (v: number) => `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`

function CurvaSFinanceira({ dados, arvore, hoje, servicos, etapas, realizados }: {
  dados: DadosCronograma
  arvore: Map<string, NoCronograma[]>
  hoje: string
  servicos: Servico[]
  etapas: Etapa[]
  realizados: RealizadoAgregado[]
}) {
  const peso = useMemo(
    () => calcularPesoFinanceiro(dados.tarefas, dados.previstoPorTarefa, servicos),
    [dados, servicos],
  )

  const arvoreFinanceira = useMemo(
    () => montarArvore(dados.tarefas, dados.previstoPorTarefa, percentuaisAtuais(dados.avancos), (t) => peso.pesoFolha(t.id)),
    [dados, peso],
  )

  const folhas = useMemo(() => folhasComPrevisto(arvoreFinanceira), [arvoreFinanceira])

  const curva = useMemo(
    () => calcularCurvaSFinanceira(
      folhas.map(f => ({ peso: f.peso, previsto: { inicio: f.previsto!.inicio, fim: f.previsto!.fim } })),
      realizados,
      hoje,
    ),
    [folhas, realizados, hoje],
  )

  const fimCronograma = folhas.reduce<string | null>((a, f) => {
    const fim = f.previsto!.fim
    return !a || fim > a ? fim : a
  }, null)

  const projecao = useMemo(
    () => calcularProjecao(realizados, hoje, fimCronograma, peso.valorTotal),
    [realizados, hoje, fimCronograma, peso.valorTotal],
  )

  const saldoPorEtapa = useMemo(
    () => calcularSaldoPorEtapa(servicos, etapas, realizados),
    [servicos, etapas, realizados],
  )

  if (peso.valorTotal === 0 || curva.pontos.length === 0) {
    return <p className={styles.vazio}>Sem orçamento ou cronograma suficiente para calcular a Curva S financeira.</p>
  }

  const { pontos } = curva
  const pontosPassados = pontos.filter(p => p.data <= hoje)
  const previstoHoje = pontosPassados[pontosPassados.length - 1]?.previsto ?? 0
  const realizadoHoje = projecao.realizadoTotal
  const desvio = realizadoHoje - previstoHoje

  const W = 820, H = 320, ML = 64, MR = 16, MT = 16, MB = 40
  const maxValor = Math.max(...pontos.map(p => p.previsto), realizadoHoje, 1)
  const x = (i: number) => ML + (i / (pontos.length - 1)) * (W - ML - MR)
  const y = (v: number) => MT + (1 - v / maxValor) * (H - MT - MB)
  const pathPrevisto = pontos.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.previsto).toFixed(1)}`).join('')
  const reais = pontos.map((p, i) => ({ p, i })).filter(({ p }) => p.realizado !== null)
  const pathReal = reais.map(({ p, i }, k) => `${k === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.realizado!).toFixed(1)}`).join('')
  const idxHoje = reais.length > 0 ? reais[reais.length - 1].i : -1

  const marcas = pontos
    .map((p, i) => ({ p, i }))
    .filter(({ p }, k, arr) => {
      const mes = p.data.slice(0, 7)
      return k === 0 || (mes !== arr[k - 1].p.data.slice(0, 7) && ['01', '04', '07', '10'].includes(p.data.slice(5, 7)))
    })

  return (
    <>
      <div className={styles.cards}>
        <div className={styles.card}>
          <span className={styles.cardLabel}>Previsto até hoje</span>
          <span className={styles.cardValor}>{fmtMoeda(previstoHoje)}</span>
        </div>
        <div className={styles.card}>
          <span className={styles.cardLabel}>Realizado</span>
          <span className={styles.cardValor}>{fmtMoeda(realizadoHoje)}</span>
        </div>
        <div className={`${styles.card} ${desvio > 0 ? styles.cardRuim : styles.cardBom}`}>
          <span className={styles.cardLabel}>Desvio</span>
          <span className={styles.cardValor}>{desvio >= 0 ? '+' : ''}{fmtMoeda(desvio)}</span>
        </div>
      </div>

      <div className={styles.graficoWrap}>
        <svg viewBox={`0 0 ${W} ${H}`} className={styles.grafico} role="img" aria-label="Curva S financeira: previsto x realizado">
          {[0, 0.25, 0.5, 0.75, 1].map(f => (
            <g key={f}>
              <line x1={ML} y1={y(f * maxValor)} x2={W - MR} y2={y(f * maxValor)} className={styles.grade} />
              <text x={ML - 8} y={y(f * maxValor) + 4} className={styles.eixoY}>{fmtMoeda(f * maxValor)}</text>
            </g>
          ))}
          {marcas.map(({ p, i }) => (
            <text key={p.data} x={x(i)} y={H - MB + 18} className={styles.eixoX}>
              {p.data.slice(5, 7)}/{p.data.slice(2, 4)}
            </text>
          ))}
          {idxHoje >= 0 && <line x1={x(idxHoje)} y1={MT} x2={x(idxHoje)} y2={H - MB} className={styles.linhaHoje} />}
          <path d={pathPrevisto} className={styles.curvaPrevisto} />
          {pathReal && <path d={pathReal} className={styles.curvaReal} />}
        </svg>
        <div className={styles.legenda}>
          <span><span className={styles.legPrevisto} /> Previsto</span>
          <span><span className={styles.legReal} /> Realizado</span>
        </div>
      </div>

      <div className={styles.tabelaWrap}>
        <h3>Previsto × realizado × saldo por etapa</h3>
        <table className={styles.tabela}>
          <thead>
            <tr>
              <th>Etapa</th>
              <th className={styles.num}>Orçado</th>
              <th className={styles.num}>Realizado</th>
              <th className={styles.num}>Saldo</th>
              <th className={styles.num}>% consumido</th>
            </tr>
          </thead>
          <tbody>
            {saldoPorEtapa.map(l => (
              <tr key={l.etapaId ?? 'sem-etapa'}>
                <td>{l.etapaNome}</td>
                <td className={styles.num}>{fmtMoeda(l.orcado)}</td>
                <td className={styles.num}>{fmtMoeda(l.realizado)}</td>
                <td className={styles.num}>{fmtMoeda(l.saldo)}</td>
                <td className={styles.num}>{l.pctConsumido === null ? '—' : `${(l.pctConsumido * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className={styles.cards}>
        <div className={styles.card}>
          <span className={styles.cardLabel}>Ritmo mensal de gasto</span>
          <span className={styles.cardValor}>{projecao.ritmoMensal === null ? 'Sem dados suficientes' : fmtMoeda(projecao.ritmoMensal)}</span>
        </div>
        <div className={styles.card}>
          <span className={styles.cardLabel}>Custo final projetado</span>
          <span className={styles.cardValor}>{projecao.custoFinalProjetado === null ? '—' : fmtMoeda(projecao.custoFinalProjetado)}</span>
        </div>
        <div className={`${styles.card} ${(projecao.desvioProjetado ?? 0) > 0 ? styles.cardRuim : styles.cardBom}`}>
          <span className={styles.cardLabel}>Desvio projetado vs. orçado</span>
          <span className={styles.cardValor}>{projecao.desvioProjetado === null ? '—' : `${projecao.desvioProjetado >= 0 ? '+' : ''}${fmtMoeda(projecao.desvioProjetado)}`}</span>
        </div>
      </div>

      <details className={styles.fonte}>
        <summary>De onde vêm estes números</summary>
        <ul>
          <li><strong>Cobertura do de-para:</strong> {(peso.cobertura * 100).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}% do orçamento total (R$ {fmtMoeda(peso.valorTotal)}) está vinculado diretamente a uma tarefa do cronograma; o restante é distribuído entre as tarefas sem vínculo, proporcional à duração prevista de cada uma.</li>
          <li><strong>Previsto:</strong> peso híbrido R$/duração de cada tarefa-folha, distribuído linearmente entre início e fim previstos.</li>
          <li><strong>Realizado:</strong> soma de {realizados.length.toLocaleString('pt-BR')} lançamento(s) financeiro(s) pago(s), agregados por data — sem fornecedor, NF ou lançamento individual.</li>
          <li><strong>Projeção de custo final:</strong> realizado acumulado + (ritmo médio dos últimos 3 meses fechados × meses restantes até o fim do cronograma vigente). Estimativa por tendência, não uma projeção técnica de engenharia (Earned Value).</li>
          <li>Lançamentos sem etapa/serviço vinculado aparecem como "Não classificado" na tabela de saldo — nunca somados a nenhuma etapa específica.</li>
        </ul>
      </details>
    </>
  )
}
```

- [ ] **Step 4: Checagem de tipo**

Run: `npm run build`
Expected: build passa sem erro.

- [ ] **Step 5: Verificar a Task 3 pendente (soma dos pesos = orçamento total)**

Com `npm run dev` rodando, abrir `/cronograma` → aba "Financeiro" com a obra piloto. No console do
navegador, a cobertura mostrada na caixa "De onde vêm estes números" deve ser um número entre 0% e
100%. Conferir manualmente: `peso.valorVinculado + valorResto` deve bater com `peso.valorTotal` —
adicionar temporariamente `console.log(peso)` dentro de `CurvaSFinanceira`, comparar
`valorVinculado <= valorTotal` e que a soma de todos os `pesoFolha(id)` das folhas bate com
`valorTotal` (dentro de arredondamento de ponto flutuante, diferença < R$ 1). Remover o
`console.log` antes do commit.

- [ ] **Step 6: Teste guiado (manual, com usuário temporário — mesmo padrão de toda fase anterior)**

1. Login como `admin`: abrir `/cronograma` → aba "Financeiro". Conferir que os três cards
   (Previsto/Realizado/Desvio) aparecem, o gráfico desenha as duas curvas, a tabela de saldo por
   etapa lista as etapas com orçado/realizado/saldo, e os cards de projeção aparecem (ou "Sem dados
   suficientes" se não houver 1 mês fechado de lançamentos pagos ainda).
2. Criar um usuário temporário com papel `cliente` vinculado à obra piloto (mesmo processo usado em
   testes anteriores — remover ao final). Login como esse usuário: confirmar que a aba "Financeiro"
   aparece em `/cronograma` com os mesmos números agregados, e que **não há** nenhum link, botão ou
   dado que mostre fornecedor, NF, descrição ou lançamento individual.
3. Confirmar que `/financeiro` (a tela de lançamentos) continua bloqueada para esse usuário
   `cliente` (comportamento já existente da Fase 3a, não deve ter mudado).
4. Remover o usuário temporário de teste.

- [ ] **Step 7: Commit**

```bash
git add src/pages/Cronograma.tsx
git commit -m "feat: aba Financeiro em /cronograma com Curva S financeira, saldo por etapa e projecao"
```

---

### Task 7: Atualizar a documentação de fase

**Files:**
- Modify: `docs/fase2.md`
- Modify: `docs/fase3_financeiro.md`

**Interfaces:** nenhuma — só documentação.

- [ ] **Step 1: Fechar a pendência em `docs/fase2.md`**

Na seção "Pendências transferidas", remover ou marcar como concluída a linha "De-para cronograma ↔
orçamento + Curva S em R$ — Fase 3", com uma nota curta apontando para
`docs/fase3_financeiro.md` (data desta entrega) e para a migração `20260904_financeiro_curva_s_agregado.sql`.

- [ ] **Step 2: Registrar a entrega em `docs/fase3_financeiro.md`**

Adicionar uma seção nova (mesmo padrão das demais seções de `docs/fase3_financeiro.md`) descrevendo:
Curva S financeira, previsto×realizado×saldo por etapa e projeção de custo final entregues; a
cobertura do de-para no momento da entrega (número real, extraído do card "De onde vêm estes
números" testado no Step 6 da Task 6); que a projeção usa ritmo de gasto, não Earned Value; e que
cliente vê os agregados, nunca lançamento individual. Mover essas três funcionalidades da lista
"Fora de escopo da Fase 3a" (linhas 25-27 do arquivo atual) para "O que foi entregue".

- [ ] **Step 3: Commit**

```bash
git add docs/fase2.md docs/fase3_financeiro.md
git commit -m "docs: registra Curva S financeira, previsto x realizado por etapa e projecao de custo final"
```

---

## Revisão obrigatória antes do teste de campo do Rodrigo

Por `docs/colaboracao-codex-claude.md`, esta entrega mexe em **RLS/RPC nova** (Task 1) e **cálculo
financeiro** (Tasks 3, 5, 6) — depois do commit da Task 7, pedir revisão pós-commit do Claude Code
antes de qualquer teste de campo do Rodrigo. A revisão prévia (arquitetura, RLS, fórmulas) já foi
feita na sessão que gerou este plano; falta confirmar que a implementação bate com o desenho.
