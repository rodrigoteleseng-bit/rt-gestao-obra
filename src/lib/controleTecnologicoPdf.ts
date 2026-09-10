// Geração do PDF do Controle Tecnológico do Concreto (jsPDF, client-side), paisagem.
// Cabeçalho com identidade RT (mesmo padrão de todo PDF do app, ver medicoesPdf.ts) +
// dados da concretagem + tabela-legenda dos caminhões. Sem mapa embutido nesta fase.
import { jsPDF } from 'jspdf'
import type { CtConcretagem, CtCaminhao } from './supabase'
import { larguraProporcional, type IdentidadeMarca } from './pdfBranding'

const NAVY = '#1A3248'
const TERRACOTA = '#C49A7A'
const CINZA = '#6c757d'

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
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export function gerarPdfConcretagem(d: DadosPdfConcretagem): void {
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' })
  const W = 297
  const ML = 14
  const MR = 14
  const LARG = W - ML - MR
  let y = 0

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
  pdf.text(`${d.obraNome} · ${d.unidadeNome} · ${fmtData(d.concretagem.data)}`, W - MR, 19, { align: 'right' })
  y = 40

  const colX = { cor: ML, fornecedor: ML + 12, nf: ML + 62, amostra: ML + 92, volume: ML + 132, slump: ML + 157, saida: ML + 187, chegada: ML + 212, inicio: ML + 237, fim: ML + 262 }
  pdf.setFillColor('#F0EBE3')
  pdf.rect(ML, y, LARG, 7, 'F')
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(7)
  pdf.setTextColor(NAVY)
  pdf.text('', colX.cor + 1, y + 4.7)
  pdf.text('FORNECEDOR', colX.fornecedor, y + 4.7)
  pdf.text('NF', colX.nf, y + 4.7)
  pdf.text('AMOSTRA', colX.amostra, y + 4.7)
  pdf.text('VOL. (M³)', colX.volume, y + 4.7)
  pdf.text('SLUMP SOL./MED.', colX.slump, y + 4.7)
  pdf.text('SAÍDA USINA', colX.saida, y + 4.7)
  pdf.text('CHEGADA OBRA', colX.chegada, y + 4.7)
  pdf.text('INÍCIO DESC.', colX.inicio, y + 4.7)
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
    pdf.text(`${c.volume_m3}`, colX.volume, y + 5.2)
    pdf.text(`${c.slump_solicitado_cm ?? '—'} / ${c.slump_medido_cm ?? '—'}`, colX.slump, y + 5.2)
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
  pdf.text('Mapa de concretagem anexado separadamente na tela do app.', ML, y)

  const totalPaginas = pdf.getNumberOfPages()
  for (let i = 1; i <= totalPaginas; i++) {
    pdf.setPage(i)
    pdf.setDrawColor(TERRACOTA)
    pdf.setLineWidth(0.5)
    pdf.line(ML, 196, W - MR, 196)
    pdf.setFontSize(7.5)
    pdf.setTextColor(CINZA)
    pdf.setFont('helvetica', 'normal')
    pdf.text(d.identidade.rodapeTexto, ML, 201)
    pdf.text(`Página ${i} de ${totalPaginas}`, W - MR, 201, { align: 'right' })
  }

  pdf.save(`Controle Tecnologico - ${d.unidadeNome} - ${fmtData(d.concretagem.data)}.pdf`)
}
