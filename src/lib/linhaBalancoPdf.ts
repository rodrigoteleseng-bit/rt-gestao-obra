import { jsPDF } from 'jspdf'
import { supabase } from './supabase'
import { paginado, fatiar, type RespostaPaginada } from './cronograma'

export type GranularidadeLinhaBalanco = 'semanal' | 'mensal'

const NAVY = '#1A3248'
const CINZA_GRADE = '#d8dde3'
const CINZA_TEXTO = '#444444'

// Paleta com 9 cores distinguíveis — bate com a quantidade real de etapas
// cadastradas por sobrado nesta obra (COBERTURA, DIVERSOS,
// IMPERMEABILIZAÇÃO, INSTALAÇÕES, LOUÇAS E METAIS, MURO DE CONTENÇÃO,
// PAVIMENTO PLATIBANDA, PAVIMENTO SUPERIOR, PAVIMENTO TERREO). Se a obra
// tiver mais etapas que isso no futuro, a paleta repete (ainda funciona,
// só fica menos distinguível).
const PALETA = ['#1A3248', '#C49A7A', '#3A7CA5', '#6B8F71', '#A65E5E', '#8B6BA6', '#C9A227', '#4A7A8C', '#B85C38']

interface TarefaCronograma {
  id: string
  etapa_id: string | null
  unidade_id: string | null
}

interface PontoSobrado {
  sobradoIndex: number
  previsto: number | null // timestamp (ms) — data prevista no Cronograma
  planejado: number | null // timestamp (ms) — data prometida no compromisso semanal do Planejamento (meta 100%)
  real: number | null // timestamp (ms), só quando a etapa bateu 100% no sobrado
}

interface LinhaEtapa {
  nome: string
  cor: string
  pontos: PontoSobrado[]
}

function inicioDaSemana(data: Date): Date {
  const d = new Date(data)
  const dia = d.getDay()
  const deslocamento = dia === 0 ? -6 : 1 - dia // volta pra segunda-feira
  d.setDate(d.getDate() + deslocamento)
  d.setHours(0, 0, 0, 0)
  return d
}

function inicioDoMes(data: Date): Date {
  return new Date(data.getFullYear(), data.getMonth(), 1)
}

export async function gerarPdfLinhaBalanco(obraId: string, granularidade: GranularidadeLinhaBalanco) {
  // cronograma_tarefas/cronograma_previsto/avancos_fisicos passam de 1000
  // linhas nesta obra — o Supabase corta silenciosamente sem paginar, então
  // usa o mesmo helper já usado no Cronograma (Fase 2, src/lib/cronograma.ts).
  type TarefaComEtapaUnidade = TarefaCronograma & { etapas: { nome: string } | null; unidades: { tipo: string } | null }
  const [unidadesResp, tarefasLista, versaoResp] = await Promise.all([
    supabase.from('unidades').select('id, nome').eq('obra_id', obraId).eq('ativo', true).eq('tipo', 'sobrado').order('nome'),
    paginado<TarefaComEtapaUnidade>((de, ate, contar) =>
      supabase.from('cronograma_tarefas')
        .select('id, etapa_id, unidade_id, etapas(nome), unidades(tipo)', contar ? { count: 'exact' } : undefined)
        .eq('obra_id', obraId).eq('ativo', true).eq('resumo', false)
        .range(de, ate) as unknown as PromiseLike<RespostaPaginada<TarefaComEtapaUnidade>>),
    supabase.from('cronograma_versoes').select('id').eq('obra_id', obraId).eq('vigente', true).eq('ativo', true).maybeSingle(),
  ])
  if (unidadesResp.error) throw new Error('Erro ao carregar sobrados: ' + unidadesResp.error.message)
  if (!versaoResp.data) throw new Error('Nenhuma versão vigente do cronograma encontrada para esta obra.')

  const sobrados = unidadesResp.data ?? []
  if (sobrados.length === 0) throw new Error('Nenhum sobrado cadastrado nesta obra.')
  const indicePorSobrado = new Map(sobrados.map((s, i) => [s.id, i + 1]))

  const tarefasSobrados = tarefasLista.filter(t => t.unidades?.tipo === 'sobrado' && t.etapa_id && t.unidade_id && t.etapas?.nome)
  if (tarefasSobrados.length === 0) throw new Error('Nenhuma tarefa de sobrado encontrada no cronograma.')

  const idsTarefas = tarefasSobrados.map(t => t.id)
  const lotesIds = fatiar(idsTarefas, 500)
  const [previstoLista, avancoLotes, compromissosLotes] = await Promise.all([
    paginado<{ tarefa_id: string; inicio: string; fim: string }>((de, ate, contar) =>
      supabase.from('cronograma_previsto')
        .select('tarefa_id, inicio, fim', contar ? { count: 'exact' } : undefined)
        .eq('versao_id', versaoResp.data!.id).in('tarefa_id', idsTarefas)
        .range(de, ate) as unknown as PromiseLike<RespostaPaginada<{ tarefa_id: string; inicio: string; fim: string }>>),
    Promise.all(lotesIds.map(lote =>
      paginado<{ tarefa_id: string; percentual: number; data_referencia: string }>((de, ate, contar) =>
        supabase.from('avancos_fisicos')
          .select('tarefa_id, percentual, data_referencia', contar ? { count: 'exact' } : undefined)
          .eq('ativo', true).in('tarefa_id', lote).order('data_referencia', { ascending: false })
          .range(de, ate) as unknown as PromiseLike<RespostaPaginada<{ tarefa_id: string; percentual: number; data_referencia: string }>>))),
    Promise.all(lotesIds.map(lote =>
      paginado<{ tarefa_id: string; planejamento_semanas: { data_fim: string } | null }>((de, ate, contar) =>
        supabase.from('planejamento_compromissos')
          .select('tarefa_id, meta_percentual, planejamento_semanas(data_fim)', contar ? { count: 'exact' } : undefined)
          .eq('ativo', true).eq('meta_percentual', 100).in('tarefa_id', lote)
          .range(de, ate) as unknown as PromiseLike<RespostaPaginada<{ tarefa_id: string; planejamento_semanas: { data_fim: string } | null }>>))),
  ])

  const previstoPorTarefa = new Map(previstoLista.map(p => [p.tarefa_id, { inicio: p.inicio, fim: p.fim }]))
  const avancoPorTarefa = new Map<string, { percentual: number; data_referencia: string }>()
  for (const lote of avancoLotes) for (const a of lote) if (!avancoPorTarefa.has(a.tarefa_id)) avancoPorTarefa.set(a.tarefa_id, a)

  // Data prometida via compromisso semanal (meta 100%) — pega a mais recente
  // quando a mesma tarefa foi comprometida com meta 100% em mais de uma semana.
  const planejadoPorTarefa = new Map<string, number>()
  for (const lote of compromissosLotes) for (const c of lote) {
    if (!c.planejamento_semanas?.data_fim) continue
    const fimMs = new Date(c.planejamento_semanas.data_fim).getTime()
    const atual = planejadoPorTarefa.get(c.tarefa_id)
    if (atual == null || fimMs > atual) planejadoPorTarefa.set(c.tarefa_id, fimMs)
  }

  // Agrupa por (nome da etapa, sobrado) — cada sobrado tem sua própria linha
  // de etapas no banco (etapas.unidade_id), então o nome é o único jeito de
  // juntar "Alvenaria do Sobrado 01" com "Alvenaria do Sobrado 02" na mesma
  // linha do gráfico.
  const grupos = new Map<string, Map<string, string[]>>() // nomeEtapa -> unidadeId -> tarefaIds
  for (const t of tarefasSobrados) {
    const nomeEtapa = t.etapas!.nome
    if (!grupos.has(nomeEtapa)) grupos.set(nomeEtapa, new Map())
    const porUnidade = grupos.get(nomeEtapa)!
    if (!porUnidade.has(t.unidade_id!)) porUnidade.set(t.unidade_id!, [])
    porUnidade.get(t.unidade_id!)!.push(t.id)
  }

  let dataMin = Infinity
  let dataMax = -Infinity
  const linhas: LinhaEtapa[] = []
  let corIndex = 0
  for (const [nomeEtapa, porUnidade] of grupos) {
    const pontos: PontoSobrado[] = []
    for (const [unidadeId, tarefaIds] of porUnidade) {
      const sobradoIndex = indicePorSobrado.get(unidadeId)
      if (!sobradoIndex) continue
      let previstoFim: number | null = null
      let planejadoFim: number | null = null
      const percentuais: number[] = []
      let dataUltimaMedicao: number | null = null
      for (const tid of tarefaIds) {
        const prev = previstoPorTarefa.get(tid)
        if (prev?.inicio) dataMin = Math.min(dataMin, new Date(prev.inicio).getTime())
        if (prev?.fim) {
          const fimMs = new Date(prev.fim).getTime()
          dataMax = Math.max(dataMax, fimMs)
          previstoFim = previstoFim == null ? fimMs : Math.max(previstoFim, fimMs)
        }
        const planejadoTarefa = planejadoPorTarefa.get(tid)
        if (planejadoTarefa != null) {
          dataMax = Math.max(dataMax, planejadoTarefa)
          planejadoFim = planejadoFim == null ? planejadoTarefa : Math.max(planejadoFim, planejadoTarefa)
        }
        const av = avancoPorTarefa.get(tid)
        percentuais.push(av?.percentual ?? 0)
        if (av?.data_referencia) {
          const dataMs = new Date(av.data_referencia).getTime()
          dataUltimaMedicao = dataUltimaMedicao == null ? dataMs : Math.max(dataUltimaMedicao, dataMs)
        }
      }
      const percentualMedio = percentuais.length > 0 ? percentuais.reduce((a, b) => a + b, 0) / percentuais.length : 0
      const real = percentualMedio >= 100 && dataUltimaMedicao != null ? dataUltimaMedicao : null
      if (real != null) dataMax = Math.max(dataMax, real)
      pontos.push({ sobradoIndex, previsto: previstoFim, planejado: planejadoFim, real })
    }
    pontos.sort((a, b) => a.sobradoIndex - b.sobradoIndex)
    linhas.push({ nome: nomeEtapa, cor: PALETA[corIndex % PALETA.length], pontos })
    corIndex++
  }
  if (!Number.isFinite(dataMin) || !Number.isFinite(dataMax) || dataMin >= dataMax) {
    throw new Error('Não há datas previstas suficientes no cronograma para desenhar a linha de balanço.')
  }

  // ---- desenho do PDF ----
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' })
  const W = pdf.internal.pageSize.getWidth()
  const H = pdf.internal.pageSize.getHeight()
  const ML = 16, MR = 10, MT = 22, MB = 26
  const areaX = ML, areaY = MT
  const areaW = W - ML - MR
  const areaH = H - MT - MB
  const totalSobrados = sobrados.length

  const x = (t: number) => areaX + ((t - dataMin) / (dataMax - dataMin)) * areaW
  const y = (sobradoIndex: number) => areaY + areaH - ((sobradoIndex - 0.5) / totalSobrados) * areaH

  pdf.setFillColor(NAVY)
  pdf.rect(0, 0, W, 14, 'F')
  pdf.setTextColor('#ffffff')
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(13)
  pdf.text('RT ENGENHARIA — LINHA DE BALANÇO', ML, 9)
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(8.5)
  pdf.text(granularidade === 'semanal' ? 'Marcações semanais' : 'Marcações mensais', W - MR, 9, { align: 'right' })

  // eixo Y — sobrados
  pdf.setDrawColor(CINZA_GRADE)
  pdf.setTextColor(NAVY)
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(8)
  sobrados.forEach((s, i) => {
    const linhaY = y(i + 1)
    pdf.setDrawColor(CINZA_GRADE)
    pdf.line(areaX, linhaY, areaX + areaW, linhaY)
    pdf.setTextColor(NAVY)
    pdf.text(s.nome, areaX - 2, linhaY + 1.2, { align: 'right' })
  })

  // eixo X — semanas ou meses
  pdf.setFontSize(6.5)
  pdf.setFont('helvetica', 'normal')
  const marcas: number[] = []
  if (granularidade === 'semanal') {
    let cursor = inicioDaSemana(new Date(dataMin))
    while (cursor.getTime() <= dataMax) { marcas.push(cursor.getTime()); cursor = new Date(cursor.getTime() + 7 * 86400000) }
  } else {
    let cursor = inicioDoMes(new Date(dataMin))
    while (cursor.getTime() <= dataMax) { marcas.push(cursor.getTime()); cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1) }
  }
  // evita rótulo colado — pula marcas se ficariam a menos de 9mm uma da outra
  const passoMinimoMm = 9
  let ultimaXDesenhada = -Infinity
  for (const marca of marcas) {
    const px = x(marca)
    pdf.setDrawColor(CINZA_GRADE)
    pdf.line(px, areaY, px, areaY + areaH)
    if (px - ultimaXDesenhada >= passoMinimoMm) {
      const d = new Date(marca)
      const rotulo = granularidade === 'semanal'
        ? `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`
        : `${['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'][d.getMonth()]}/${String(d.getFullYear()).slice(2)}`
      pdf.setTextColor(CINZA_TEXTO)
      pdf.text(rotulo, px, areaY + areaH + 5, { align: 'center' })
      ultimaXDesenhada = px
    }
  }

  // moldura da área de plotagem
  pdf.setDrawColor(NAVY)
  pdf.rect(areaX, areaY, areaW, areaH)

  // linhas por etapa: previsto (sólida), planejado (pontilhada) e real
  // (tracejada, só onde já bateu 100%)
  for (const linha of linhas) {
    pdf.setDrawColor(linha.cor)
    pdf.setLineWidth(0.5)
    for (let i = 0; i < linha.pontos.length - 1; i++) {
      const a = linha.pontos[i], b = linha.pontos[i + 1]
      if (a.previsto != null && b.previsto != null) {
        pdf.setLineDashPattern([], 0)
        pdf.line(x(a.previsto), y(a.sobradoIndex), x(b.previsto), y(b.sobradoIndex))
      }
      if (a.planejado != null && b.planejado != null) {
        pdf.setLineDashPattern([0.3, 1.1], 0)
        pdf.line(x(a.planejado), y(a.sobradoIndex), x(b.planejado), y(b.sobradoIndex))
        pdf.setLineDashPattern([], 0)
      }
      if (a.real != null && b.real != null) {
        pdf.setLineDashPattern([1.2, 1], 0)
        pdf.line(x(a.real), y(a.sobradoIndex), x(b.real), y(b.sobradoIndex))
        pdf.setLineDashPattern([], 0)
      }
    }
  }
  pdf.setLineWidth(0.2)

  // legenda
  let legendaY = areaY + areaH + 13
  pdf.setFontSize(7.5)
  let legendaX = ML
  for (const linha of linhas) {
    pdf.setFillColor(linha.cor)
    pdf.rect(legendaX, legendaY - 2.5, 3, 3, 'F')
    pdf.setTextColor(CINZA_TEXTO)
    pdf.setFont('helvetica', 'normal')
    const largura = pdf.getTextWidth(linha.nome)
    pdf.text(linha.nome, legendaX + 4, legendaY)
    legendaX += largura + 12
    if (legendaX > W - MR - 30) { legendaX = ML; legendaY += 5 }
  }
  legendaY += 6
  pdf.setFont('helvetica', 'italic')
  pdf.setFontSize(7)
  pdf.text('Linha sólida = previsto (Cronograma) · pontilhada = prometido (compromisso semanal do Planejamento) · tracejada = real (só quando o sobrado atingiu 100% de avanço na etapa)', ML, legendaY)

  const paginas = pdf.getNumberOfPages()
  for (let i = 1; i <= paginas; i++) {
    pdf.setPage(i)
    pdf.setFontSize(7.5)
    pdf.setTextColor(CINZA_TEXTO)
    pdf.text('RT Engenharia · Rodrigo Teles Silva · CREA 1018712895 D/GO · Inteligência Aplicada', ML, H - 6)
  }
  pdf.save(`Linha de Balanco - ${granularidade}.pdf`)
}
