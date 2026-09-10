// Geração do PDF do Controle Tecnológico do Concreto (jsPDF, client-side).
// Cabeçalho com identidade RT (mesmo padrão de todo PDF do app, ver medicoesPdf.ts) +
// dados da concretagem + tabela-legenda dos caminhões. Página 1 = mapa de
// concretagem anexado (convertido em imagem via prepararImagemAnexo — PDF de
// 1 página ou foto, nunca a ferramenta de pintura, que é Fase 2). Página 2 =
// cabeçalho + tabela-legenda, sempre paisagem.
import { jsPDF } from 'jspdf'
import { supabase, type CtConcretagem, type CtCaminhao } from './supabase'
import { larguraProporcional, type IdentidadeMarca } from './pdfBranding'
import { prepararImagemAnexo, type ImagemAnexo } from './pdfParaImagem'

const NAVY = '#1A3248'
const TERRACOTA = '#C49A7A'
const CINZA = '#6c757d'
const ML = 14
const MR = 14

export interface DadosPdfConcretagem {
  concretagem: CtConcretagem
  caminhoes: CtCaminhao[]
  identidade: IdentidadeMarca
  obraNome: string
  unidadeNome: string
}

function fmtData(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`
}

function fmtHora(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

function fmtSlumpSolicitado(nominal: number | null, tolerancia: number | null): string {
  if (nominal === null) return '—'
  return tolerancia ? `${nominal}±${tolerancia}` : `${nominal}`
}

// Cabeçalho (faixa navy + identidade RT + título + obra/unidade/data + numeração
// CTC) — compartilhado pelas duas páginas do PDF, pra dar a mesma moldura em
// ambas. Usa a largura REAL da página atual (pdf.internal.pageSize), não um
// valor fixo de paisagem, porque a página do mapa pode ser retrato.
function desenharCabecalho(pdf: jsPDF, d: DadosPdfConcretagem): void {
  const W = pdf.internal.pageSize.getWidth()

  pdf.setFillColor(NAVY)
  pdf.rect(0, 0, W, 30, 'F')
  pdf.setFillColor(TERRACOTA)
  pdf.rect(0, 30, W, 1.4, 'F')
  if (d.identidade.logoBase64) {
    const alturaLogo = 22
    const larguraLogo = larguraProporcional(pdf, d.identidade.logoBase64, alturaLogo)
    pdf.addImage(d.identidade.logoBase64, 'PNG', ML, 4, larguraLogo, alturaLogo)
  } else {
    pdf.setTextColor('#ffffff')
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(17)
    pdf.text('RT ENGENHARIA', ML, 13)
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(8.5)
    pdf.setTextColor('#B8D4E8')
    pdf.text('Inteligência Aplicada', ML, 18.5)
  }
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(14)
  pdf.setTextColor('#ffffff')
  pdf.text('CONTROLE TECNOLÓGICO DO CONCRETO', W - MR, 13, { align: 'right' })

  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(9)
  pdf.setTextColor('#D0AE95')
  const textoObraLinha = `${d.obraNome} · ${d.unidadeNome} · ${fmtData(d.concretagem.data)}`
  pdf.text(textoObraLinha, W - MR, 19, { align: 'right' })

  // Numeração (CTC-001...) fica à esquerda dessa linha, com uma folga medida
  // via getTextWidth — não uma posição fixa — pra nunca encostar no texto da
  // obra mesmo com nome de obra comprido (mesma técnica usada no ajuste do
  // fornecedor da tabela abaixo, ver docs/superpowers/plans/2026-09-10-ct-lacre-horario-slump.md).
  const larguraObraLinha = pdf.getTextWidth(textoObraLinha)
  pdf.setFont('helvetica', 'bold')
  pdf.setTextColor('#ffffff')
  pdf.text(d.concretagem.numero, W - MR - larguraObraLinha - 6, 19, { align: 'right' })
}

function desenharPaginaMapa(pdf: jsPDF, d: DadosPdfConcretagem, imagem: ImagemAnexo): void {
  desenharCabecalho(pdf, d)
  const W = pdf.internal.pageSize.getWidth()
  const H = pdf.internal.pageSize.getHeight()
  const MT = 40 // abaixo do cabeçalho — mesma altura em que a tabela começa na página 2
  // Margem inferior maior que as demais: desenharRodapeTodasPaginas desenha a
  // linha/numeração de página em TODA página, inclusive esta — sem essa reserva
  // o rodapé invade a base da imagem em mapas paisagem/proporção A4 (o caso comum,
  // já que a orientação da página é escolhida pra combinar com a da imagem).
  const MB = 20
  const boxW = W - ML - MR
  const boxH = H - MT - MB
  const escala = Math.min(boxW / imagem.width, boxH / imagem.height)
  const larguraFinal = imagem.width * escala
  const alturaFinal = imagem.height * escala
  const x = ML + (boxW - larguraFinal) / 2
  const y = MT + (boxH - alturaFinal) / 2
  pdf.addImage(imagem.dataUrl, 'PNG', x, y, larguraFinal, alturaFinal)
}

function desenharPaginaTabela(pdf: jsPDF, d: DadosPdfConcretagem): void {
  const W = 297
  const LARG = W - ML - MR
  let y = 40

  desenharCabecalho(pdf, d)

  const colX = { cor: ML, fornecedor: ML + 12, nf: ML + 78, amostra: ML + 97, lacre: ML + 125, volume: ML + 152, slump: ML + 167, saida: ML + 192, chegada: ML + 204, inicio: ML + 220, fim: ML + 235 }
  pdf.setFillColor('#F0EBE3')
  pdf.rect(ML, y, LARG, 7, 'F')
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(7)
  pdf.setTextColor(NAVY)
  pdf.text('', colX.cor + 1, y + 4.7)
  pdf.text('FORNECEDOR', colX.fornecedor, y + 4.7)
  pdf.text('NF', colX.nf, y + 4.7)
  pdf.text('AMOSTRA', colX.amostra, y + 4.7)
  pdf.text('LACRE', colX.lacre, y + 4.7)
  pdf.text('VOL. (M³)', colX.volume, y + 4.7)
  pdf.text('SLUMP SOL./MED.', colX.slump, y + 4.7)
  pdf.text('SAÍDA', colX.saida, y + 4.7)
  pdf.text('CHEGADA', colX.chegada, y + 4.7)
  pdf.text('IN. DESC.', colX.inicio, y + 4.7)
  pdf.text('FIM DESC.', colX.fim, y + 4.7)
  y += 7

  for (const c of d.caminhoes) {
    pdf.setDrawColor('#E0DAD0')
    pdf.setLineWidth(0.2)
    pdf.line(ML, y, W - MR, y)
    pdf.setFillColor(c.cor)
    pdf.rect(colX.cor + 1, y + 1.5, 5, 5, 'F')
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(8)
    pdf.setTextColor('#222222')
    pdf.text(c.fornecedor, colX.fornecedor, y + 5.2)
    pdf.text(c.nf, colX.nf, y + 5.2)
    pdf.text(c.numero_amostra, colX.amostra, y + 5.2)
    pdf.text(c.numero_lacre, colX.lacre, y + 5.2)
    pdf.text(`${c.volume_m3}`, colX.volume, y + 5.2)
    pdf.text(`${fmtSlumpSolicitado(c.slump_solicitado_cm, c.slump_tolerancia_cm)} / ${c.slump_medido_cm ?? '—'}`, colX.slump, y + 5.2)
    pdf.text(fmtHora(c.hora_saida_usina), colX.saida, y + 5.2)
    pdf.text(fmtHora(c.hora_chegada_obra), colX.chegada, y + 5.2)
    pdf.text(fmtHora(c.hora_inicio_descarga), colX.inicio, y + 5.2)
    pdf.text(fmtHora(c.hora_fim_descarga), colX.fim, y + 5.2)
    y += 8
  }
  pdf.setDrawColor('#E0DAD0')
  pdf.line(ML, y, W - MR, y)
  y += 6

  pdf.setFont('helvetica', 'italic')
  pdf.setFontSize(8)
  pdf.setTextColor(CINZA)
  pdf.text('Mapa de concretagem na página anterior.', ML, y)
}

// Roda por último, depois que todas as páginas existem — pdf.getNumberOfPages()
// já conta a página do mapa. Usa a altura REAL de cada página (não um valor
// fixo de paisagem), porque a página do mapa pode ser retrato.
function desenharRodapeTodasPaginas(pdf: jsPDF, rodapeTexto: string): void {
  const totalPaginas = pdf.getNumberOfPages()
  for (let i = 1; i <= totalPaginas; i++) {
    pdf.setPage(i)
    const W = pdf.internal.pageSize.getWidth()
    const H = pdf.internal.pageSize.getHeight()
    const yLinha = H - 14
    const yTexto = H - 9
    pdf.setDrawColor(TERRACOTA)
    pdf.setLineWidth(0.5)
    pdf.line(ML, yLinha, W - MR, yLinha)
    pdf.setFontSize(7.5)
    pdf.setTextColor(CINZA)
    pdf.setFont('helvetica', 'normal')
    pdf.text(rodapeTexto, ML, yTexto)
    pdf.text(`Página ${i} de ${totalPaginas}`, W - MR, yTexto, { align: 'right' })
  }
}

export async function gerarPdfConcretagem(d: DadosPdfConcretagem): Promise<void> {
  if (!d.concretagem.anexo_url) {
    throw new Error('Esta concretagem não tem mapa anexado — não é possível gerar o PDF.')
  }
  const { data: blob, error } = await supabase.storage
    .from('controle-tecnologico')
    .download(d.concretagem.anexo_url)
  if (error || !blob) {
    throw new Error(`Não foi possível baixar o mapa anexado: ${error?.message ?? 'arquivo não encontrado'}`)
  }
  const imagem = await prepararImagemAnexo(blob, d.concretagem.anexo_url)

  const orientacaoMapa = imagem.width >= imagem.height ? 'landscape' : 'portrait'
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: orientacaoMapa })
  desenharPaginaMapa(pdf, d, imagem)

  pdf.addPage('a4', 'landscape')
  desenharPaginaTabela(pdf, d)

  desenharRodapeTodasPaginas(pdf, d.identidade.rodapeTexto)

  pdf.save(`Controle Tecnologico - ${d.unidadeNome} - ${fmtData(d.concretagem.data)}.pdf`)
}
