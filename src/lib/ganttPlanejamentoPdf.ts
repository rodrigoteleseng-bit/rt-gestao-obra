import { jsPDF } from 'jspdf'
import { supabase } from './supabase'
import { paginado, fatiar, etapaAncestralPorTarefa, type RespostaPaginada, type NoParaEtapa } from './cronograma'

const NAVY = '#1A3248'
const CINZA_GRADE = '#d8dde3'
const CINZA_TEXTO = '#444444'
const NUDE_BANDA = '#F0EBE3'
const VERDE = '#2E7D32'
const VERMELHO = '#C62828'
const AMARELO = '#E3A00C'
const PRETO = '#222222'
const BRANCO = '#ffffff'

const DIA_SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const CATEGORIA_LABEL: Record<string, string> = {
  material: 'Material',
  mao_de_obra: 'Mão de obra',
  projeto_documentacao: 'Projeto/documentação',
  decisao_pendente: 'Decisão pendente',
  equipamento: 'Equipamento',
  financeiro: 'Financeiro',
  servico_predecessor: 'Serviço predecessor',
  clima: 'Clima',
}

interface Segmento {
  inicio: number
  fim: number
  cor: string
}

interface BarraTarefa {
  id: string
  nome: string
  unidadeNome: string
  unidadeOrdem: number
  etapaNome: string
  atual: Segmento | null
  proxima: Segmento | null
  diasAvanco: number[]
}

// Datas do Postgres vêm como "YYYY-MM-DD" — sem forçar meia-noite local, o
// navegador interpreta como UTC e o dia exibido pode ficar um a menos.
function dataLocal(iso: string): Date {
  return new Date(iso + 'T00:00:00')
}

function truncarTexto(pdf: jsPDF, texto: string, larguraMax: number): string {
  if (pdf.getTextWidth(texto) <= larguraMax) return texto
  let t = texto
  while (t.length > 1 && pdf.getTextWidth(t + '…') > larguraMax) t = t.slice(0, -1)
  return t + '…'
}

export async function gerarPdfGanttPlanejamento(obraId: string, semanaAtualId: string) {
  const obraResp = await supabase.from('obras').select('nome').eq('id', obraId).maybeSingle()
  const obraNome = obraResp.data?.nome ?? 'Obra'

  const semanaAtualResp = await supabase.from('planejamento_semanas')
    .select('id, data_inicio, data_fim, status, ppc')
    .eq('id', semanaAtualId).eq('ativo', true).maybeSingle()
  if (semanaAtualResp.error) throw new Error('Erro ao carregar semana atual: ' + semanaAtualResp.error.message)
  if (!semanaAtualResp.data) throw new Error('Semana não encontrada.')
  const semanaAtual = semanaAtualResp.data

  // Semana seguinte = a próxima semana cadastrada por data (segunda a sexta),
  // detectada automaticamente — precisa já existir.
  const proximaResp = await supabase.from('planejamento_semanas')
    .select('id, data_inicio, data_fim')
    .eq('obra_id', obraId).eq('ativo', true).gt('data_inicio', semanaAtual.data_fim)
    .order('data_inicio', { ascending: true }).limit(1).maybeSingle()
  if (proximaResp.error) throw new Error('Erro ao carregar semana seguinte: ' + proximaResp.error.message)
  if (!proximaResp.data) throw new Error('Crie a semana seguinte antes de gerar este Gantt.')
  const proxima = proximaResp.data

  const semanaIds = [semanaAtual.id, proxima.id]
  const compromissosResp = await supabase.from('planejamento_compromissos')
    .select('tarefa_id, semana_id, cumprido, motivo_categoria')
    .eq('ativo', true).in('semana_id', semanaIds)
  if (compromissosResp.error) throw new Error('Erro ao carregar compromissos: ' + compromissosResp.error.message)
  const compromissos = compromissosResp.data ?? []
  if (compromissos.length === 0) throw new Error('Nenhum compromisso encontrado nessas duas semanas.')

  const compromissoAtualPorTarefa = new Map<string, { cumprido: boolean | null }>()
  const compromissoProximaPorTarefa = new Map<string, { cumprido: boolean | null }>()
  let totalAtual = 0
  let cumpridasAtual = 0
  let naoCumpridasAtual = 0
  const motivos = new Map<string, number>()
  for (const c of compromissos) {
    if (c.semana_id === semanaAtual.id) {
      compromissoAtualPorTarefa.set(c.tarefa_id, { cumprido: c.cumprido })
      totalAtual += 1
      if (c.cumprido === true) cumpridasAtual += 1
      if (c.cumprido === false) {
        naoCumpridasAtual += 1
        if (c.motivo_categoria) motivos.set(c.motivo_categoria, (motivos.get(c.motivo_categoria) ?? 0) + 1)
      }
    } else {
      compromissoProximaPorTarefa.set(c.tarefa_id, { cumprido: c.cumprido })
    }
  }
  const pendentesAtual = totalAtual - cumpridasAtual - naoCumpridasAtual

  const idsTarefas = [...new Set(compromissos.map(c => c.tarefa_id))]
  const lotesTarefas = fatiar(idsTarefas, 500)

  type TarefaComUnidade = { id: string; nome: string; unidade_id: string | null; unidades: { nome: string; ordem: number } | null }
  const tarefasLotes = await Promise.all(lotesTarefas.map(lote =>
    paginado<TarefaComUnidade>((de, ate, contar) =>
      supabase.from('cronograma_tarefas')
        .select('id, nome, unidade_id, unidades(nome, ordem)', contar ? { count: 'exact' } : undefined)
        .in('id', lote)
        .range(de, ate) as unknown as PromiseLike<RespostaPaginada<TarefaComUnidade>>)))
  const tarefasInfo = tarefasLotes.flat()

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

  // Avanço físico lançado dentro da janela das duas semanas — cada dia
  // lançado vira uma marca no Gantt (não uma barra contínua).
  const avancoLotes = await Promise.all(lotesTarefas.map(lote =>
    paginado<{ tarefa_id: string; data_referencia: string }>((de, ate, contar) =>
      supabase.from('avancos_fisicos')
        .select('tarefa_id, data_referencia', contar ? { count: 'exact' } : undefined)
        .eq('ativo', true).in('tarefa_id', lote)
        .gte('data_referencia', semanaAtual.data_inicio).lte('data_referencia', proxima.data_fim)
        .range(de, ate) as unknown as PromiseLike<RespostaPaginada<{ tarefa_id: string; data_referencia: string }>>)))
  const diasAvancoPorTarefa = new Map<string, Set<number>>()
  for (const lote of avancoLotes) for (const a of lote) {
    const dia = dataLocal(a.data_referencia).getTime()
    const atual = diasAvancoPorTarefa.get(a.tarefa_id) ?? new Set<number>()
    atual.add(dia)
    diasAvancoPorTarefa.set(a.tarefa_id, atual)
  }

  const atualInicio = dataLocal(semanaAtual.data_inicio).getTime()
  const atualFim = dataLocal(semanaAtual.data_fim).getTime()
  const proximaInicio = dataLocal(proxima.data_inicio).getTime()
  const proximaFim = dataLocal(proxima.data_fim).getTime()

  const barras: BarraTarefa[] = []
  for (const t of tarefasInfo) {
    const etapaNome = etapaPorTarefaId.get(t.id)
    if (!t.unidades || !etapaNome) continue
    const cAtual = compromissoAtualPorTarefa.get(t.id)
    const cProxima = compromissoProximaPorTarefa.get(t.id)
    if (!cAtual && !cProxima) continue
    const atual: Segmento | null = cAtual
      ? { inicio: atualInicio, fim: atualFim, cor: cAtual.cumprido === true ? VERDE : cAtual.cumprido === false ? VERMELHO : AMARELO }
      : null
    const proximaSeg: Segmento | null = cProxima ? { inicio: proximaInicio, fim: proximaFim, cor: AMARELO } : null
    barras.push({
      id: t.id,
      nome: t.nome,
      unidadeNome: t.unidades.nome,
      unidadeOrdem: t.unidades.ordem,
      etapaNome,
      atual,
      proxima: proximaSeg,
      diasAvanco: [...(diasAvancoPorTarefa.get(t.id) ?? [])],
    })
  }
  if (barras.length === 0) throw new Error('Nenhuma tarefa comprometida encontrada para montar o Gantt.')

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
  let etapaAtualNome = ''
  for (const b of barras) {
    if (b.unidadeNome !== unidadeAtual) {
      linhas.push({ tipo: 'unidade', texto: b.unidadeNome })
      unidadeAtual = b.unidadeNome
      etapaAtualNome = ''
    }
    if (b.etapaNome !== etapaAtualNome) {
      linhas.push({ tipo: 'etapa', texto: b.etapaNome })
      etapaAtualNome = b.etapaNome
    }
    linhas.push({ tipo: 'tarefa', barra: b })
  }

  // ---- desenho do PDF ----
  const dataMin = atualInicio
  const dataMax = proximaFim
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' })
  const W = pdf.internal.pageSize.getWidth()
  const H = pdf.internal.pageSize.getHeight()
  const ML = 74, MR = 10, MT = 39, MB = 22
  const areaX = ML
  const areaW = W - ML - MR
  const topoLinhas = MT
  const fundoLinhas = H - MB

  const x = (t: number) => areaX + ((t - dataMin) / (dataMax - dataMin)) * areaW

  const ALT_UNIDADE = 6.5
  const ALT_ETAPA = 5.5
  const ALT_TAREFA = 8

  function desenharTopo() {
    pdf.setFillColor(NAVY)
    pdf.rect(0, 0, W, 16, 'F')
    pdf.setTextColor(BRANCO)
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(13)
    pdf.text('RT ENGENHARIA - GANTT DO PLANEJAMENTO', 10, 9.5)
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(8.5)
    pdf.text(obraNome, W - MR, 9.5, { align: 'right' })

    const ppc = semanaAtual.ppc == null ? '-' : `${semanaAtual.ppc}%`
    const cards: [string, string, string][] = [
      ['SEMANA ATUAL', `${fmt(semanaAtual.data_inicio)} a ${fmt(semanaAtual.data_fim)}`, NAVY],
      ['PPC', ppc, semanaAtual.ppc != null && semanaAtual.ppc < 70 ? VERMELHO : VERDE],
      ['COMPROMISSOS', String(totalAtual), NAVY],
      ['CUMPRIDAS', String(cumpridasAtual), VERDE],
      ['NAO CUMPRIDAS', String(naoCumpridasAtual), VERMELHO],
      ['PENDENTES', String(pendentesAtual), AMARELO],
    ]
    const cardY = 18
    const cardH = 12
    const cardW = (W - 20 - (cards.length - 1) * 3) / cards.length
    cards.forEach(([label, valor, cor], i) => {
      const cx = 10 + i * (cardW + 3)
      pdf.setFillColor(i === 0 ? NUDE_BANDA : BRANCO)
      pdf.setDrawColor(CINZA_GRADE)
      pdf.roundedRect(cx, cardY, cardW, cardH, 1.5, 1.5, 'FD')
      pdf.setFont('helvetica', 'bold')
      pdf.setFontSize(5.8)
      pdf.setTextColor(CINZA_TEXTO)
      pdf.text(label, cx + 2, cardY + 4)
      pdf.setFontSize(9)
      pdf.setTextColor(cor)
      pdf.text(valor, cx + 2, cardY + 9)
    })

    pdf.setFillColor(NUDE_BANDA)
    pdf.rect(0, MT - 10, ML, 10, 'F')
    pdf.setTextColor(NAVY)
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(8)
    pdf.text('Unidade / etapa / tarefa', 4, MT - 3)

    const meio = x(atualFim + (proximaInicio - atualFim) / 2)
    pdf.setFillColor(NUDE_BANDA)
    pdf.rect(areaX, MT - 10, meio - areaX, 4.5, 'F')
    pdf.rect(meio, MT - 10, areaX + areaW - meio, 4.5, 'F')
    pdf.setFontSize(7)
    pdf.setTextColor(NAVY)
    pdf.text(`Semana atual (${fmt(semanaAtual.data_inicio)} a ${fmt(semanaAtual.data_fim)})`, areaX + 2, MT - 6.8)
    pdf.text(`Semana seguinte (${fmt(proxima.data_inicio)} a ${fmt(proxima.data_fim)})`, meio + 2, MT - 6.8)

    // marcações diárias, do topo ao fundo da área de linhas
    let cursor = new Date(dataMin)
    while (cursor.getTime() <= dataMax) {
      const px = x(cursor.getTime())
      const ehFimDeSemana = cursor.getDay() === 0 || cursor.getDay() === 6
      if (ehFimDeSemana) {
        pdf.setFillColor(CINZA_GRADE)
        const proximoDia = cursor.getTime() + 86400000
        pdf.rect(px, topoLinhas, Math.max(x(proximoDia) - px, 0.1), fundoLinhas - topoLinhas, 'F')
      }
      pdf.setDrawColor(CINZA_GRADE)
      pdf.line(px, topoLinhas, px, fundoLinhas)
      pdf.setFont('helvetica', 'bold')
      pdf.setFontSize(6.8)
      pdf.setTextColor(NAVY)
      pdf.text(DIA_SEMANA[cursor.getDay()], px + 1, topoLinhas - 4.7, { align: 'left' })
      pdf.setFont('helvetica', 'normal')
      pdf.setFontSize(6.2)
      pdf.setTextColor(CINZA_TEXTO)
      pdf.text(`${String(cursor.getDate()).padStart(2, '0')}/${String(cursor.getMonth() + 1).padStart(2, '0')}`, px + 1, topoLinhas - 1.1, { align: 'left' })
      cursor = new Date(cursor.getTime() + 86400000)
    }

    // divisória entre a semana atual e a seguinte
    const divisoriaX = meio
    pdf.setDrawColor(NAVY)
    pdf.setLineWidth(0.6)
    pdf.line(divisoriaX, topoLinhas - 9, divisoriaX, fundoLinhas)
    pdf.setLineWidth(0.2)

    pdf.setDrawColor(NAVY)
    pdf.rect(areaX, topoLinhas, areaW, fundoLinhas - topoLinhas)
  }

  function desenharRodape() {
    let lx = ML
    const ly = H - 11
    const itens: [string, string][] = [
      ['Cumprida', VERDE],
      ['Não cumprida', VERMELHO],
      ['Planejada (semana seguinte)', AMARELO],
    ]
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(7.5)
    for (const [rotulo, cor] of itens) {
      pdf.setFillColor(cor)
      pdf.rect(lx, ly - 2.6, 4.5, 2.6, 'F')
      pdf.setTextColor(CINZA_TEXTO)
      pdf.text(rotulo, lx + 6, ly)
      lx += pdf.getTextWidth(rotulo) + 18
    }
    pdf.setFillColor(PRETO)
    pdf.circle(lx + 1.3, ly - 1.3, 1.3, 'F')
    pdf.setTextColor(CINZA_TEXTO)
    pdf.text('Dia com avanço lançado', lx + 4.5, ly)

    const principaisMotivos = [...motivos.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
    if (principaisMotivos.length > 0) {
      pdf.setFont('helvetica', 'bold')
      pdf.setFontSize(7.2)
      pdf.setTextColor(VERMELHO)
      pdf.text('Principais motivos: ' + principaisMotivos.map(([motivo, qtd]) => `${CATEGORIA_LABEL[motivo] ?? motivo} (${qtd})`).join(' | '), ML, H - 15)
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
      pdf.setFontSize(9.5)
      pdf.text(linha.texto, areaX + 2, y + altura - 2)
      y += altura
      continue
    }
    if (linha.tipo === 'etapa') {
      pdf.setTextColor(NAVY)
      pdf.setFont('helvetica', 'bolditalic')
      pdf.setFontSize(8)
      pdf.text(linha.texto, areaX + 4, y + altura - 1.5)
      y += altura
      continue
    }

    // linha.tipo === 'tarefa'
    const b = linha.barra
    pdf.setDrawColor(CINZA_GRADE)
    pdf.line(areaX, y + altura, areaX + areaW, y + altura)
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(7.5)
    pdf.setTextColor(CINZA_TEXTO)
    const nomeExibido = truncarTexto(pdf, b.nome, ML - 6)
    pdf.text(nomeExibido, 3, y + altura / 2 + 1.2)

    const alturaBarra = 4.2
    const byBase = y + (altura - alturaBarra) / 2
    for (const seg of [b.atual, b.proxima]) {
      if (!seg) continue
      pdf.setFillColor(seg.cor)
      const largura = Math.max(x(seg.fim) - x(seg.inicio), 0.8)
      pdf.rect(x(seg.inicio), byBase, largura, alturaBarra, 'F')
    }
    for (const dia of b.diasAvanco) {
      pdf.setFillColor(PRETO)
      pdf.circle(x(dia) , byBase + alturaBarra / 2, 1.1, 'F')
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

function fmt(iso: string): string {
  const d = dataLocal(iso)
  return `${String(d.getDate()).padStart(2, '0')}/${MESES[d.getMonth()]}`
}
