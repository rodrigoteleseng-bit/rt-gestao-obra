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
