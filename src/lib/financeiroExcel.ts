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

  // Etapa alvo de cada lançamento: resolve por servico_id mesmo que o
  // serviço esteja inativo (só a listagem de linhas por serviço usa
  // apenas serviços ativos — a soma da etapa nunca pode perder um valor
  // já pago), com fallback pra etapa_id direto. Só retorna um id que
  // realmente existe em `etapas`; senão, o lançamento cai em "Não
  // classificado" — nunca fica escondido somado a uma etapa que não é a
  // dele nem descartado em silêncio.
  function etapaAlvo(l: LancamentoFinanceiro): string | null {
    let etapaId: string | null = null
    if (l.servico_id) {
      const servico = servicos.find(s => s.id === l.servico_id)
      etapaId = servico ? servico.etapa_id : null
    } else if (l.etapa_id) {
      etapaId = l.etapa_id
    }
    if (!etapaId) return null
    return etapas.some(e => e.id === etapaId) ? etapaId : null
  }

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
      const lancamentosDaEtapa = comData.filter(l => etapaAlvo(l) === etapa.id)
      if (servicosDaEtapa.length === 0 && lancamentosDaEtapa.length === 0) continue
      unidadeTemConteudo = true

      let orcadoEtapa = 0, gastoMesEtapa = 0, gastoAcumEtapa = 0
      const linhasServico: LinhaOrcamentoMes[] = []
      const idsServicosAtivos = new Set(servicosDaEtapa.map(s => s.id))

      for (const servico of servicosDaEtapa) {
        const lancDoServico = lancamentosDaEtapa.filter(l => l.servico_id === servico.id)
        const orcado = servico.total ?? 0
        const gastoMes = somar(lancDoServico, noMes)
        const gastoAcum = somar(lancDoServico, ateFimMes)
        orcadoEtapa += orcado; gastoMesEtapa += gastoMes; gastoAcumEtapa += gastoAcum
        linhasServico.push({ tipo: 'servico', nome: servico.nome, orcado, gastoMes, gastoAcumulado: gastoAcum })
      }

      // Lançamentos vinculados à etapa sem linha de serviço própria: sem
      // serviço (direto na etapa) ou vinculados a um serviço inativo —
      // ambos somam no subtotal da etapa, nunca desaparecem.
      const lancamentosSemLinhaPropria = lancamentosDaEtapa.filter(l => !l.servico_id || !idsServicosAtivos.has(l.servico_id))
      gastoMesEtapa += somar(lancamentosSemLinhaPropria, noMes)
      gastoAcumEtapa += somar(lancamentosSemLinhaPropria, ateFimMes)

      linhasEtapa.push({ tipo: 'etapa', nome: etapa.nome, orcado: orcadoEtapa, gastoMes: gastoMesEtapa, gastoAcumulado: gastoAcumEtapa })
      linhasEtapa.push(...linhasServico)

      orcadoUnidade += orcadoEtapa; gastoMesUnidade += gastoMesEtapa; gastoAcumUnidade += gastoAcumEtapa
    }

    if (!unidadeTemConteudo) continue
    linhas.push({ tipo: 'unidade', nome: unidade.nome, orcado: orcadoUnidade, gastoMes: gastoMesUnidade, gastoAcumulado: gastoAcumUnidade })
    linhas.push(...linhasEtapa)
  }

  const naoClassificado = comData.filter(l => etapaAlvo(l) === null)
  const gastoMesNC = somar(naoClassificado, noMes)
  const gastoAcumNC = somar(naoClassificado, ateFimMes)
  if (gastoMesNC > 0 || gastoAcumNC > 0) {
    linhas.push({ tipo: 'unidade', nome: 'Não classificado', orcado: 0, gastoMes: gastoMesNC, gastoAcumulado: gastoAcumNC })
  }

  return linhas
}

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
