import { jsPDF } from 'jspdf'
import { supabase } from './supabase'
import { paginado, fatiar, etapaAncestralPorTarefa, type RespostaPaginada, type NoParaEtapa } from './cronograma'

const NAVY = '#1A3248'
const TERRACOTA = '#C49A7A'
const AZUL_MEDIO = '#3A7CA5'
const CINZA_GRADE = '#d8dde3'
const CINZA_TEXTO = '#444444'
const NUDE_BANDA = '#F0EBE3'

interface BarraTarefa {
  id: string
  nome: string
  unidadeNome: string
  unidadeOrdem: number
  etapaNome: string
  previstoInicio: number | null
  previstoFim: number | null
  planejadoInicio: number | null
  planejadoFim: number | null
  realInicio: number | null
  realFim: number | null
}

function inicioDaSemana(data: Date): Date {
  const d = new Date(data)
  const dia = d.getDay()
  const deslocamento = dia === 0 ? -6 : 1 - dia
  d.setDate(d.getDate() + deslocamento)
  d.setHours(0, 0, 0, 0)
  return d
}

function truncarTexto(pdf: jsPDF, texto: string, larguraMax: number): string {
  if (pdf.getTextWidth(texto) <= larguraMax) return texto
  let t = texto
  while (t.length > 1 && pdf.getTextWidth(t + '…') > larguraMax) t = t.slice(0, -1)
  return t + '…'
}

export async function gerarPdfGanttPlanejamento(obraId: string) {
  // Só entram tarefas comprometidas em semanas com planejamento já travado
  // ("planejada" ou "fechada") — semana aberta ainda pode mudar.
  const semanasResp = await supabase.from('planejamento_semanas')
    .select('id, data_inicio, data_fim')
    .eq('obra_id', obraId).eq('ativo', true).in('status', ['planejada', 'fechada'])
  if (semanasResp.error) throw new Error('Erro ao carregar semanas: ' + semanasResp.error.message)
  const semanas = semanasResp.data ?? []
  if (semanas.length === 0) throw new Error('Nenhuma semana com planejamento fechado encontrada para montar o Gantt.')
  const semanaPorId = new Map(semanas.map(s => [s.id, s]))
  const idsSemanas = semanas.map(s => s.id)

  const compromissosLotes = await Promise.all(fatiar(idsSemanas, 500).map(lote =>
    paginado<{ tarefa_id: string; semana_id: string }>((de, ate, contar) =>
      supabase.from('planejamento_compromissos')
        .select('tarefa_id, semana_id', contar ? { count: 'exact' } : undefined)
        .eq('ativo', true).in('semana_id', lote)
        .range(de, ate) as unknown as PromiseLike<RespostaPaginada<{ tarefa_id: string; semana_id: string }>>)))
  const compromissos = compromissosLotes.flat()
  if (compromissos.length === 0) throw new Error('Nenhum compromisso encontrado em semanas fechadas.')

  // planejado por tarefa = do início da 1ª semana comprometida ao fim da última
  const planejadoPorTarefa = new Map<string, { inicio: number; fim: number }>()
  for (const c of compromissos) {
    const sem = semanaPorId.get(c.semana_id)
    if (!sem) continue
    const inicioMs = new Date(sem.data_inicio).getTime()
    const fimMs = new Date(sem.data_fim).getTime()
    const atual = planejadoPorTarefa.get(c.tarefa_id)
    if (!atual) planejadoPorTarefa.set(c.tarefa_id, { inicio: inicioMs, fim: fimMs })
    else planejadoPorTarefa.set(c.tarefa_id, { inicio: Math.min(atual.inicio, inicioMs), fim: Math.max(atual.fim, fimMs) })
  }

  const idsTarefas = [...planejadoPorTarefa.keys()]
  const lotesTarefas = fatiar(idsTarefas, 500)

  type TarefaComUnidade = {
    id: string; nome: string; unidade_id: string | null
    unidades: { nome: string; ordem: number } | null
  }
  const [tarefasLotes, versaoResp] = await Promise.all([
    Promise.all(lotesTarefas.map(lote =>
      paginado<TarefaComUnidade>((de, ate, contar) =>
        supabase.from('cronograma_tarefas')
          .select('id, nome, unidade_id, unidades(nome, ordem)', contar ? { count: 'exact' } : undefined)
          .in('id', lote)
          .range(de, ate) as unknown as PromiseLike<RespostaPaginada<TarefaComUnidade>>))),
    supabase.from('cronograma_versoes').select('id').eq('obra_id', obraId).eq('vigente', true).eq('ativo', true).maybeSingle(),
  ])
  const tarefasInfo = tarefasLotes.flat()
  if (!versaoResp.data) throw new Error('Nenhuma versão vigente do cronograma encontrada para esta obra.')

  // etapa_id de cronograma_tarefas nunca foi preenchido na importação do MS
  // Project — deriva a etapa subindo a árvore até o filho direto da raiz da
  // unidade. Precisa da árvore inteira (grupos + folhas) das unidades
  // envolvidas, não só das tarefas comprometidas.
  const idsUnidadesEnvolvidas = [...new Set(tarefasInfo.map(t => t.unidade_id).filter((id): id is string => !!id))]
  const todosNos = idsUnidadesEnvolvidas.length === 0 ? [] : await paginado<NoParaEtapa>((de, ate, contar) =>
    supabase.from('cronograma_tarefas')
      .select('id, nome, parent_id, unidade_id', contar ? { count: 'exact' } : undefined)
      .eq('ativo', true).in('unidade_id', idsUnidadesEnvolvidas)
      .range(de, ate) as unknown as PromiseLike<RespostaPaginada<NoParaEtapa>>)
  const etapaPorTarefaId = etapaAncestralPorTarefa(todosNos)

  const [previstoLista, avancoLotes] = await Promise.all([
    paginado<{ tarefa_id: string; inicio: string; fim: string }>((de, ate, contar) =>
      supabase.from('cronograma_previsto')
        .select('tarefa_id, inicio, fim', contar ? { count: 'exact' } : undefined)
        .eq('versao_id', versaoResp.data!.id).in('tarefa_id', idsTarefas)
        .range(de, ate) as unknown as PromiseLike<RespostaPaginada<{ tarefa_id: string; inicio: string; fim: string }>>),
    Promise.all(lotesTarefas.map(lote =>
      paginado<{ tarefa_id: string; data_referencia: string }>((de, ate, contar) =>
        supabase.from('avancos_fisicos')
          .select('tarefa_id, data_referencia', contar ? { count: 'exact' } : undefined)
          .eq('ativo', true).in('tarefa_id', lote)
          .range(de, ate) as unknown as PromiseLike<RespostaPaginada<{ tarefa_id: string; data_referencia: string }>>))),
  ])

  const previstoPorTarefa = new Map(previstoLista.map(p => [p.tarefa_id, { inicio: p.inicio, fim: p.fim }]))
  const avancoPorTarefa = new Map<string, { min: number; max: number }>()
  for (const lote of avancoLotes) for (const a of lote) {
    const ms = new Date(a.data_referencia).getTime()
    const atual = avancoPorTarefa.get(a.tarefa_id)
    if (!atual) avancoPorTarefa.set(a.tarefa_id, { min: ms, max: ms })
    else avancoPorTarefa.set(a.tarefa_id, { min: Math.min(atual.min, ms), max: Math.max(atual.max, ms) })
  }

  const barras: BarraTarefa[] = []
  let dataMin = Infinity
  let dataMax = -Infinity
  for (const t of tarefasInfo) {
    const etapaNome = etapaPorTarefaId.get(t.id)
    if (!t.unidades || !etapaNome) continue
    const planejado = planejadoPorTarefa.get(t.id) ?? null
    const previsto = previstoPorTarefa.get(t.id) ?? null
    const avanco = avancoPorTarefa.get(t.id) ?? null
    const previstoInicio = previsto ? new Date(previsto.inicio).getTime() : null
    const previstoFim = previsto ? new Date(previsto.fim).getTime() : null
    const barra: BarraTarefa = {
      id: t.id,
      nome: t.nome,
      unidadeNome: t.unidades.nome,
      unidadeOrdem: t.unidades.ordem,
      etapaNome,
      previstoInicio,
      previstoFim,
      planejadoInicio: planejado?.inicio ?? null,
      planejadoFim: planejado?.fim ?? null,
      realInicio: avanco?.min ?? null,
      realFim: avanco?.max ?? null,
    }
    barras.push(barra)
    for (const v of [previstoInicio, previstoFim, barra.planejadoInicio, barra.planejadoFim, barra.realInicio, barra.realFim]) {
      if (v != null) { dataMin = Math.min(dataMin, v); dataMax = Math.max(dataMax, v) }
    }
  }
  if (barras.length === 0) throw new Error('Nenhuma tarefa comprometida encontrada para montar o Gantt.')
  if (!Number.isFinite(dataMin) || !Number.isFinite(dataMax) || dataMin >= dataMax) {
    throw new Error('Não há datas suficientes para desenhar o Gantt.')
  }

  barras.sort((a, b) =>
    a.unidadeOrdem - b.unidadeOrdem
    || a.unidadeNome.localeCompare(b.unidadeNome)
    || a.etapaNome.localeCompare(b.etapaNome)
    || a.nome.localeCompare(b.nome))

  // Monta a lista linear de linhas a desenhar: cabeçalho de unidade,
  // subcabeçalho de etapa (só quando muda) e uma linha por tarefa.
  type LinhaDesenho =
    | { tipo: 'unidade'; texto: string }
    | { tipo: 'etapa'; texto: string }
    | { tipo: 'tarefa'; barra: BarraTarefa }
  const linhas: LinhaDesenho[] = []
  let unidadeAtual = ''
  let etapaAtual = ''
  for (const b of barras) {
    if (b.unidadeNome !== unidadeAtual) {
      linhas.push({ tipo: 'unidade', texto: b.unidadeNome })
      unidadeAtual = b.unidadeNome
      etapaAtual = ''
    }
    if (b.etapaNome !== etapaAtual) {
      linhas.push({ tipo: 'etapa', texto: b.etapaNome })
      etapaAtual = b.etapaNome
    }
    linhas.push({ tipo: 'tarefa', barra: b })
  }

  // ---- desenho do PDF ----
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' })
  const W = pdf.internal.pageSize.getWidth()
  const H = pdf.internal.pageSize.getHeight()
  const ML = 60, MR = 10, MT = 24, MB = 18
  const areaX = ML
  const areaW = W - ML - MR
  const topoLinhas = MT
  const fundoLinhas = H - MB

  const x = (t: number) => areaX + ((t - dataMin) / (dataMax - dataMin)) * areaW

  const ALT_UNIDADE = 6
  const ALT_ETAPA = 5
  const ALT_TAREFA = 7

  function desenharTopo() {
    pdf.setFillColor(NAVY)
    pdf.rect(0, 0, W, 14, 'F')
    pdf.setTextColor('#ffffff')
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(13)
    pdf.text('RT ENGENHARIA — GANTT DO PLANEJAMENTO', ML, 9)
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(8.5)
    pdf.text('Tarefas comprometidas em semanas fechadas', W - MR, 9, { align: 'right' })

    // marcações de tempo (semanas), do topo ao fundo da área de linhas
    pdf.setFontSize(6.5)
    let cursor = inicioDaSemana(new Date(dataMin))
    const passoMinimoMm = 9
    let ultimaXDesenhada = -Infinity
    while (cursor.getTime() <= dataMax) {
      const px = x(cursor.getTime())
      pdf.setDrawColor(CINZA_GRADE)
      pdf.line(px, topoLinhas, px, fundoLinhas)
      if (px - ultimaXDesenhada >= passoMinimoMm) {
        pdf.setTextColor(CINZA_TEXTO)
        pdf.setFont('helvetica', 'normal')
        pdf.text(`${String(cursor.getDate()).padStart(2, '0')}/${String(cursor.getMonth() + 1).padStart(2, '0')}`, px, topoLinhas - 2, { align: 'center' })
        ultimaXDesenhada = px
      }
      cursor = new Date(cursor.getTime() + 7 * 86400000)
    }
    pdf.setDrawColor(NAVY)
    pdf.rect(areaX, topoLinhas, areaW, fundoLinhas - topoLinhas)
  }

  function desenharRodape() {
    pdf.setFontSize(7)
    pdf.setFont('helvetica', 'italic')
    pdf.setTextColor(CINZA_TEXTO)
    let lx = ML
    const ly = H - 11
    const itens: [string, string][] = [
      ['Previsto (Cronograma)', NAVY],
      ['Planejado (comprometido no Planejamento)', TERRACOTA],
      ['Real (Avanço Físico)', AZUL_MEDIO],
    ]
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(7.5)
    for (const [rotulo, cor] of itens) {
      pdf.setFillColor(cor)
      pdf.rect(lx, ly - 2.3, 4, 2, 'F')
      pdf.setTextColor(CINZA_TEXTO)
      pdf.text(rotulo, lx + 5.5, ly)
      lx += pdf.getTextWidth(rotulo) + 16
    }
    pdf.setFontSize(7.5)
    pdf.setTextColor(CINZA_TEXTO)
    pdf.text('RT Engenharia · Rodrigo Teles Silva · CREA 1018712895 D/GO · Inteligência Aplicada', ML, H - 6)
  }

  let y = topoLinhas
  desenharTopo()

  function novaPagina() {
    pdf.addPage()
    y = topoLinhas
    desenharTopo()
  }

  for (const linha of linhas) {
    const altura = linha.tipo === 'unidade' ? ALT_UNIDADE : linha.tipo === 'etapa' ? ALT_ETAPA : ALT_TAREFA
    if (y + altura > fundoLinhas) novaPagina()

    if (linha.tipo === 'unidade') {
      pdf.setFillColor(NUDE_BANDA)
      pdf.rect(areaX, y, areaW, altura, 'F')
      pdf.setTextColor(NAVY)
      pdf.setFont('helvetica', 'bold')
      pdf.setFontSize(9)
      pdf.text(linha.texto, areaX + 2, y + altura - 2)
      y += altura
      continue
    }
    if (linha.tipo === 'etapa') {
      pdf.setTextColor(NAVY)
      pdf.setFont('helvetica', 'bolditalic')
      pdf.setFontSize(7.5)
      pdf.text(linha.texto, areaX + 4, y + altura - 1.5)
      y += altura
      continue
    }

    // linha.tipo === 'tarefa'
    const b = linha.barra
    pdf.setDrawColor(CINZA_GRADE)
    pdf.line(areaX, y + altura, areaX + areaW, y + altura)
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(7)
    pdf.setTextColor(CINZA_TEXTO)
    const nomeExibido = truncarTexto(pdf, b.nome, ML - 8)
    pdf.text(nomeExibido, 3, y + altura - 1.7)

    const espessura = 1.3
    let by = y + 1.2
    if (b.previstoInicio != null && b.previstoFim != null) {
      pdf.setFillColor(NAVY)
      const largura = Math.max(x(b.previstoFim) - x(b.previstoInicio), 0.6)
      pdf.rect(x(b.previstoInicio), by, largura, espessura, 'F')
    }
    by += espessura + 0.5
    if (b.planejadoInicio != null && b.planejadoFim != null) {
      pdf.setFillColor(TERRACOTA)
      const largura = Math.max(x(b.planejadoFim) - x(b.planejadoInicio), 0.6)
      pdf.rect(x(b.planejadoInicio), by, largura, espessura, 'F')
    }
    by += espessura + 0.5
    if (b.realInicio != null && b.realFim != null) {
      pdf.setFillColor(AZUL_MEDIO)
      const largura = Math.max(x(b.realFim) - x(b.realInicio), 0.6)
      pdf.rect(x(b.realInicio), by, largura, espessura, 'F')
    }
    y += altura
  }

  const paginas = pdf.getNumberOfPages()
  for (let i = 1; i <= paginas; i++) {
    pdf.setPage(i)
    desenharRodape()
  }
  pdf.save('Gantt do Planejamento.pdf')
}
