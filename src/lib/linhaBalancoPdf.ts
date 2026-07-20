import { jsPDF } from 'jspdf'
import { supabase } from './supabase'
import { paginado, fatiar, etapaAncestralPorTarefa, type RespostaPaginada } from './cronograma'

export type GranularidadeLinhaBalanco = 'semanal' | 'mensal'

const NAVY = '#1A3248'
const CINZA_GRADE = '#d8dde3'
const CINZA_TEXTO = '#444444'

// Paleta de cores distinguíveis pros grupos da árvore do cronograma (a
// quantidade real varia por sobrado — normalmente mais de 9 — a paleta
// repete quando precisa, só fica menos distinguível).
const PALETA = ['#1A3248', '#C49A7A', '#3A7CA5', '#6B8F71', '#A65E5E', '#8B6BA6', '#C9A227', '#4A7A8C', '#B85C38']

interface NoCronograma {
  id: string
  nome: string
  parent_id: string | null
  unidade_id: string | null
  resumo: boolean
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
  const [unidadesResp, versaoResp] = await Promise.all([
    supabase.from('unidades').select('id, nome').eq('obra_id', obraId).eq('ativo', true).eq('tipo', 'sobrado').order('nome'),
    supabase.from('cronograma_versoes').select('id').eq('obra_id', obraId).eq('vigente', true).eq('ativo', true).maybeSingle(),
  ])
  if (unidadesResp.error) throw new Error('Erro ao carregar sobrados: ' + unidadesResp.error.message)
  if (!versaoResp.data) throw new Error('Nenhuma versão vigente do cronograma encontrada para esta obra.')

  const todosSobrados = unidadesResp.data ?? []
  if (todosSobrados.length === 0) throw new Error('Nenhum sobrado cadastrado nesta obra.')
  const idsSobrados = todosSobrados.map(s => s.id)

  // Busca a árvore inteira (grupos + folhas) dos sobrados, pra derivar a
  // etapa de cada folha subindo até o nó filho direto da raiz da unidade.
  const todosNos = await paginado<NoCronograma>((de, ate, contar) =>
    supabase.from('cronograma_tarefas')
      .select('id, nome, parent_id, unidade_id, resumo', contar ? { count: 'exact' } : undefined)
      .eq('obra_id', obraId).eq('ativo', true).in('unidade_id', idsSobrados)
      .range(de, ate) as unknown as PromiseLike<RespostaPaginada<NoCronograma>>)

  const etapaPorTarefaId = etapaAncestralPorTarefa(todosNos)
  const tarefasSobrados = todosNos.filter(t => !t.resumo && etapaPorTarefaId.has(t.id))
  if (tarefasSobrados.length === 0) throw new Error('Nenhuma tarefa de sobrado encontrada no cronograma.')

  const idsTarefas = tarefasSobrados.map(t => t.id)
  const lotesIds = fatiar(idsTarefas, 500)
  const [previstoLotes, avancoLotes, compromissosLotes] = await Promise.all([
    Promise.all(lotesIds.map(lote =>
      paginado<{ tarefa_id: string; inicio: string; fim: string }>((de, ate, contar) =>
        supabase.from('cronograma_previsto')
          .select('tarefa_id, inicio, fim', contar ? { count: 'exact' } : undefined)
          .eq('versao_id', versaoResp.data!.id).in('tarefa_id', lote)
          .range(de, ate) as unknown as PromiseLike<RespostaPaginada<{ tarefa_id: string; inicio: string; fim: string }>>))),
    Promise.all(lotesIds.map(lote =>
      paginado<{ tarefa_id: string; percentual: number; data_referencia: string }>((de, ate, contar) =>
        supabase.from('avancos_fisicos')
          .select('tarefa_id, percentual, data_referencia', contar ? { count: 'exact' } : undefined)
          .eq('ativo', true).in('tarefa_id', lote).order('data_referencia', { ascending: false })
          .range(de, ate) as unknown as PromiseLike<RespostaPaginada<{ tarefa_id: string; percentual: number; data_referencia: string }>>))),
    Promise.all(lotesIds.map(lote =>
      // planejamento_semanas!inner + filtro no status: só conta compromisso
      // de semana com planejamento já travado (planejada/fechada) — uma
      // semana ainda aberta pode mudar, não é "prometido" de verdade ainda.
      // Sem filtro de meta_percentual aqui: precisa de QUALQUER compromisso
      // pra saber quais sobrados entram no gráfico (a linha "planejado" em si
      // só usa os de meta 100%, filtrado depois).
      paginado<{ tarefa_id: string; meta_percentual: number; planejamento_semanas: { data_fim: string } | null }>((de, ate, contar) =>
        supabase.from('planejamento_compromissos')
          .select('tarefa_id, meta_percentual, planejamento_semanas!inner(data_fim, status)', contar ? { count: 'exact' } : undefined)
          .eq('ativo', true).in('tarefa_id', lote)
          .in('planejamento_semanas.status', ['planejada', 'fechada'])
          .range(de, ate) as unknown as PromiseLike<RespostaPaginada<{ tarefa_id: string; meta_percentual: number; planejamento_semanas: { data_fim: string } | null }>>))),
  ])

  const previstoLista = previstoLotes.flat()
  const previstoPorTarefa = new Map(previstoLista.map(p => [p.tarefa_id, { inicio: p.inicio, fim: p.fim }]))
  const avancoPorTarefa = new Map<string, { percentual: number; data_referencia: string }>()
  for (const lote of avancoLotes) for (const a of lote) if (!avancoPorTarefa.has(a.tarefa_id)) avancoPorTarefa.set(a.tarefa_id, a)

  const compromissos = compromissosLotes.flat()

  // Data prometida via compromisso semanal (meta 100%) — pega a mais recente
  // quando a mesma tarefa foi comprometida com meta 100% em mais de uma semana.
  const planejadoPorTarefa = new Map<string, number>()
  for (const c of compromissos) {
    if (c.meta_percentual !== 100 || !c.planejamento_semanas?.data_fim) continue
    const fimMs = new Date(c.planejamento_semanas.data_fim).getTime()
    const atual = planejadoPorTarefa.get(c.tarefa_id)
    if (atual == null || fimMs > atual) planejadoPorTarefa.set(c.tarefa_id, fimMs)
  }

  // Só entram no gráfico os sobrados que já têm pelo menos um compromisso
  // (qualquer meta) no Planejamento — Rodrigo pediu pra não poluir com os
  // 13 sobrados sempre, já que a maioria ainda não está sendo planejada.
  const tarefaPorId = new Map(tarefasSobrados.map(t => [t.id, t]))
  const idsUnidadesComCompromisso = new Set<string>()
  for (const c of compromissos) {
    const unidadeId = tarefaPorId.get(c.tarefa_id)?.unidade_id
    if (unidadeId) idsUnidadesComCompromisso.add(unidadeId)
  }
  const sobrados = todosSobrados.filter(s => idsUnidadesComCompromisso.has(s.id))
  if (sobrados.length === 0) throw new Error('Nenhum sobrado com compromisso no Planejamento ainda.')
  const indicePorSobrado = new Map(sobrados.map((s, i) => [s.id, i + 1]))

  // Agrupa por (nome da etapa, sobrado) — cada sobrado tem sua própria árvore
  // de grupos no cronograma, então o nome é o único jeito de juntar
  // "Alvenaria do Sobrado 01" com "Alvenaria do Sobrado 02" na mesma linha
  // do gráfico.
  const grupos = new Map<string, Map<string, string[]>>() // nomeEtapa -> unidadeId -> tarefaIds
  for (const t of tarefasSobrados) {
    if (!indicePorSobrado.has(t.unidade_id!)) continue
    const nomeEtapa = etapaPorTarefaId.get(t.id)!
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
