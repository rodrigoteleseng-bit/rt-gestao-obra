import { jsPDF } from 'jspdf'
import { supabase } from './supabase'
import { paginado, fatiar, etapaAncestralPorTarefa, type RespostaPaginada, type NoParaEtapa } from './cronograma'

export type GranularidadeLinhaBalanco = 'semanal' | 'mensal'

const NAVY = '#1A3248'
const CINZA_GRADE = '#d8dde3'
const CINZA_TEXTO = '#444444'

// Paleta de cores distinguíveis pros grupos da árvore do cronograma (a
// quantidade real varia por sobrado — normalmente mais de 9 — a paleta
// repete quando precisa, só fica menos distinguível).
const PALETA = ['#1A3248', '#C49A7A', '#3A7CA5', '#6B8F71', '#A65E5E', '#8B6BA6', '#C9A227', '#4A7A8C', '#B85C38']

interface PontoSobrado {
  sobradoIndex: number
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
  // Só entram sobrados/etapas com pelo menos uma tarefa realmente
  // comprometida (qualquer meta) numa semana com planejamento travado
  // (planejada/fechada) — não a árvore inteira do cronograma.
  const compromissosLista = await paginado<{ tarefa_id: string; meta_percentual: number; planejamento_semanas: { data_fim: string } | null }>((de, ate, contar) =>
    supabase.from('planejamento_compromissos')
      .select('tarefa_id, meta_percentual, planejamento_semanas!inner(data_fim, status, obra_id)', contar ? { count: 'exact' } : undefined)
      .eq('ativo', true).eq('planejamento_semanas.obra_id', obraId)
      .in('planejamento_semanas.status', ['planejada', 'fechada'])
      .range(de, ate) as unknown as PromiseLike<RespostaPaginada<{ tarefa_id: string; meta_percentual: number; planejamento_semanas: { data_fim: string } | null }>>)
  if (compromissosLista.length === 0) throw new Error('Nenhum compromisso encontrado em semanas planejadas/fechadas.')

  const idsTarefas = [...new Set(compromissosLista.map(c => c.tarefa_id))]
  const lotesIds = fatiar(idsTarefas, 500)

  type TarefaComUnidade = { id: string; unidade_id: string | null; unidades: { nome: string; ordem: number } | null }
  const tarefasInfoLotes = await Promise.all(lotesIds.map(lote =>
    paginado<TarefaComUnidade>((de, ate, contar) =>
      supabase.from('cronograma_tarefas')
        .select('id, unidade_id, unidades(nome, ordem)', contar ? { count: 'exact' } : undefined)
        .in('id', lote)
        .range(de, ate) as unknown as PromiseLike<RespostaPaginada<TarefaComUnidade>>)))
  const tarefasInfo = tarefasInfoLotes.flat()
  const unidadePorTarefaId = new Map(tarefasInfo.map(t => [t.id, t.unidade_id]))

  // Sobrados na ordem de exibição — só os que têm tarefa comprometida.
  const sobradosMap = new Map<string, { id: string; nome: string; ordem: number }>()
  for (const t of tarefasInfo) if (t.unidade_id && t.unidades) sobradosMap.set(t.unidade_id, { id: t.unidade_id, nome: t.unidades.nome, ordem: t.unidades.ordem })
  const sobrados = [...sobradosMap.values()].sort((a, b) => a.ordem - b.ordem || a.nome.localeCompare(b.nome))
  if (sobrados.length === 0) throw new Error('Nenhum sobrado com compromisso no Planejamento ainda.')
  const indicePorSobrado = new Map(sobrados.map((s, i) => [s.id, i + 1]))

  // etapa_id de cronograma_tarefas nunca foi preenchido na importação do MS
  // Project — deriva a etapa subindo a árvore até o filho direto da raiz da
  // unidade. Precisa da árvore inteira (grupos + folhas) das unidades
  // envolvidas, não só das tarefas comprometidas.
  const idsUnidadesEnvolvidas = sobrados.map(s => s.id)
  const todosNos = await paginado<NoParaEtapa>((de, ate, contar) =>
    supabase.from('cronograma_tarefas')
      .select('id, nome, parent_id, unidade_id', contar ? { count: 'exact' } : undefined)
      .eq('ativo', true).in('unidade_id', idsUnidadesEnvolvidas)
      .range(de, ate) as unknown as PromiseLike<RespostaPaginada<NoParaEtapa>>)
  const etapaPorTarefaId = etapaAncestralPorTarefa(todosNos)

  const avancoLotes = await Promise.all(lotesIds.map(lote =>
    paginado<{ tarefa_id: string; percentual: number; data_referencia: string }>((de, ate, contar) =>
      supabase.from('avancos_fisicos')
        .select('tarefa_id, percentual, data_referencia', contar ? { count: 'exact' } : undefined)
        .eq('ativo', true).in('tarefa_id', lote).order('data_referencia', { ascending: false })
        .range(de, ate) as unknown as PromiseLike<RespostaPaginada<{ tarefa_id: string; percentual: number; data_referencia: string }>>)))
  const avancoPorTarefa = new Map<string, { percentual: number; data_referencia: string }>()
  for (const lote of avancoLotes) for (const a of lote) if (!avancoPorTarefa.has(a.tarefa_id)) avancoPorTarefa.set(a.tarefa_id, a)

  // Data prometida via compromisso semanal (meta 100%) — pega a mais recente
  // quando a mesma tarefa foi comprometida com meta 100% em mais de uma semana.
  const planejadoPorTarefa = new Map<string, number>()
  for (const c of compromissosLista) {
    if (c.meta_percentual !== 100 || !c.planejamento_semanas?.data_fim) continue
    const fimMs = new Date(c.planejamento_semanas.data_fim).getTime()
    const atual = planejadoPorTarefa.get(c.tarefa_id)
    if (atual == null || fimMs > atual) planejadoPorTarefa.set(c.tarefa_id, fimMs)
  }

  // Agrupa por (nome da etapa, sobrado) — cada sobrado tem sua própria árvore
  // de grupos no cronograma, então o nome é o único jeito de juntar
  // "Alvenaria do Sobrado 01" com "Alvenaria do Sobrado 02" na mesma linha
  // do gráfico. Só entram as tarefas efetivamente comprometidas.
  const grupos = new Map<string, Map<string, string[]>>() // nomeEtapa -> unidadeId -> tarefaIds
  for (const tid of idsTarefas) {
    const unidadeId = unidadePorTarefaId.get(tid)
    const nomeEtapa = etapaPorTarefaId.get(tid)
    if (!unidadeId || !nomeEtapa || !indicePorSobrado.has(unidadeId)) continue
    if (!grupos.has(nomeEtapa)) grupos.set(nomeEtapa, new Map())
    const porUnidade = grupos.get(nomeEtapa)!
    if (!porUnidade.has(unidadeId)) porUnidade.set(unidadeId, [])
    porUnidade.get(unidadeId)!.push(tid)
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
      let planejadoFim: number | null = null
      const percentuais: number[] = []
      let dataUltimaMedicao: number | null = null
      for (const tid of tarefaIds) {
        const planejadoTarefa = planejadoPorTarefa.get(tid)
        if (planejadoTarefa != null) {
          dataMax = Math.max(dataMax, planejadoTarefa)
          dataMin = Math.min(dataMin, planejadoTarefa)
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
      if (real != null) { dataMax = Math.max(dataMax, real); dataMin = Math.min(dataMin, real) }
      pontos.push({ sobradoIndex, planejado: planejadoFim, real })
    }
    pontos.sort((a, b) => a.sobradoIndex - b.sobradoIndex)
    linhas.push({ nome: nomeEtapa, cor: PALETA[corIndex % PALETA.length], pontos })
    corIndex++
  }
  if (!Number.isFinite(dataMin) || !Number.isFinite(dataMax)) {
    throw new Error('Não há datas de planejamento suficientes para desenhar a linha de balanço.')
  }
  // Com pouco histórico (ex.: só a semana atual), todos os pontos podem cair
  // na mesma data — sem isso o eixo do tempo teria largura zero. Garante uma
  // semana de largura mínima nesse caso, só pra desenhar o gráfico.
  if (dataMin === dataMax) {
    dataMin -= 3.5 * 86400000
    dataMax += 3.5 * 86400000
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

  // linhas por etapa: planejado (pontilhada) e real (tracejada, só onde já
  // bateu 100%)
  for (const linha of linhas) {
    pdf.setDrawColor(linha.cor)
    pdf.setLineWidth(0.5)
    for (let i = 0; i < linha.pontos.length - 1; i++) {
      const a = linha.pontos[i], b = linha.pontos[i + 1]
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
  pdf.text('Linha pontilhada = planejado (compromisso semanal do Planejamento) · tracejada = real (só quando o sobrado atingiu 100% de avanço na etapa)', ML, legendaY)

  const paginas = pdf.getNumberOfPages()
  for (let i = 1; i <= paginas; i++) {
    pdf.setPage(i)
    pdf.setFontSize(7.5)
    pdf.setTextColor(CINZA_TEXTO)
    pdf.text('RT Engenharia · Rodrigo Teles Silva · CREA 1018712895 D/GO · Inteligência Aplicada', ML, H - 6)
  }
  pdf.save(`Linha de Balanco - ${granularidade}.pdf`)
}
