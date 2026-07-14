// Geração do PDF da medição de empreiteiro com identidade RT Engenharia
// (jsPDF, client-side) — mesmo padrão visual de comprasPdf.ts. Mostra
// quantidade contratada, já aprovada, medida neste período e saldo,
// mais o resumo bruto/retido/líquido.
import { jsPDF } from 'jspdf'
import type { Contrato, Medicao } from './supabase'

const NAVY = '#1A3248'
const TERRACOTA = '#C49A7A'
const CINZA = '#6c757d'

export interface ItemPdfMedicao {
  servicoCodigo: string
  servicoNome: string
  unidadeNome: string
  quantidadeContratada: number
  jaAprovado: number
  quantidadePeriodo: number
  valorUnitario: number
}

export interface DadosPdfMedicao {
  contrato: Contrato
  medicao: Medicao
  empreiteiroNome: string
  itens: ItemPdfMedicao[]
}

function fmtData(iso: string | null): string {
  if (!iso) return '—'
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`
}

export function gerarPdfMedicao(d: DadosPdfMedicao): void {
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' })
  const W = 210
  const ML = 14
  const MR = 14
  const LARG = W - ML - MR
  let y = 0

  function rodape() {
    const total = pdf.getNumberOfPages()
    for (let i = 1; i <= total; i++) {
      pdf.setPage(i)
      pdf.setDrawColor(TERRACOTA)
      pdf.setLineWidth(0.5)
      pdf.line(ML, 285, W - MR, 285)
      pdf.setFontSize(7.5)
      pdf.setTextColor(CINZA)
      pdf.setFont('helvetica', 'normal')
      pdf.text('RT Engenharia — Rodrigo Teles Silva · CREA 1018712895 D/GO · Inteligência Aplicada', ML, 290)
      pdf.text(`Página ${i} de ${total}`, W - MR, 290, { align: 'right' })
    }
  }

  function novaPagina() { pdf.addPage(); y = 16 }
  function precisa(mm: number) { if (y + mm > 280) novaPagina() }

  // ---------- cabeçalho ----------
  pdf.setFillColor(NAVY)
  pdf.rect(0, 0, W, 30, 'F')
  pdf.setFillColor(TERRACOTA)
  pdf.rect(0, 30, W, 1.4, 'F')
  pdf.setTextColor('#ffffff')
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(17)
  pdf.text('RT ENGENHARIA', ML, 13)
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(8.5)
  pdf.setTextColor('#B8D4E8')
  pdf.text('Inteligência Aplicada', ML, 18.5)
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(11)
  pdf.setTextColor('#ffffff')
  pdf.text('MEDIÇÃO', W - MR, 12, { align: 'right' })
  pdf.setFontSize(10)
  pdf.setTextColor('#D0AE95')
  pdf.text(`${d.contrato.numero} — ${d.medicao.numero}ª medição`, W - MR, 18.5, { align: 'right' })
  y = 39

  // ---------- identificação ----------
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(11)
  pdf.setTextColor('#222222')
  pdf.text(`Empreiteiro: ${d.empreiteiroNome}`, ML, y)
  y += 6
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(9.5)
  pdf.setTextColor(CINZA)
  pdf.text(`Objeto: ${d.contrato.objeto}`, ML, y)
  y += 5.5
  pdf.text(`Data de referência: ${fmtData(d.medicao.data_referencia)}`, ML, y)
  y += 8

  // ---------- tabela de itens ----------
  const colX = { item: ML, und: ML + 58, contratada: ML + 74, antes: ML + 94, periodo: ML + 114, unit: ML + 134, total: ML + 157 }
  const colW = { item: 56, und: 14, contratada: 18, antes: 18, periodo: 18, unit: 21, total: 22 }

  function cabecalhoTabela() {
    precisa(10)
    pdf.setFillColor('#F0EBE3')
    pdf.rect(ML, y, LARG, 7, 'F')
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(7.5)
    pdf.setTextColor(NAVY)
    pdf.text('SERVIÇO', colX.item + 1, y + 4.7)
    pdf.text('UND.', colX.und + 1, y + 4.7)
    pdf.text('CONTRAT.', colX.contratada + 1, y + 4.7)
    pdf.text('ANTES', colX.antes + 1, y + 4.7)
    pdf.text('PERÍODO', colX.periodo + 1, y + 4.7)
    pdf.text('V. UNIT.', colX.unit + 1, y + 4.7)
    pdf.text('V. TOTAL', colX.total + 1, y + 4.7)
    y += 7
  }

  cabecalhoTabela()

  let bruto = 0
  for (const it of d.itens) {
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(8.5)
    const nomeCompleto = it.servicoCodigo ? `${it.servicoCodigo} — ${it.servicoNome}` : it.servicoNome
    const linhasItem = pdf.splitTextToSize(nomeCompleto, colW.item - 2) as string[]
    const alturaLinha = Math.max(linhasItem.length, 1) * 4.2 + 2.5
    const valorTotalItem = it.quantidadePeriodo * it.valorUnitario
    bruto += valorTotalItem

    precisa(alturaLinha)
    pdf.setDrawColor('#E0DAD0')
    pdf.setLineWidth(0.2)
    pdf.line(ML, y, W - MR, y)

    pdf.setTextColor('#222222')
    pdf.text(linhasItem, colX.item + 1, y + 4.2)
    pdf.text(it.unidadeNome, colX.und + 1, y + 4.2)
    pdf.text(`${it.quantidadeContratada}`, colX.contratada + 1, y + 4.2)
    pdf.text(`${it.jaAprovado}`, colX.antes + 1, y + 4.2)
    pdf.text(`${it.quantidadePeriodo}`, colX.periodo + 1, y + 4.2)
    pdf.text(`R$ ${it.valorUnitario.toFixed(2)}`, colX.unit + 1, y + 4.2)
    pdf.text(`R$ ${valorTotalItem.toFixed(2)}`, colX.total + 1, y + 4.2)
    y += alturaLinha
  }
  pdf.setDrawColor('#E0DAD0')
  pdf.line(ML, y, W - MR, y)
  y += 10

  // ---------- resumo financeiro ----------
  const retencaoPct = d.contrato.retencao_pct ?? 0
  const retido = Math.round(bruto * retencaoPct) / 100
  const liquido = bruto - retido

  precisa(24)
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(10)
  pdf.setTextColor('#222222')
  pdf.text('Valor bruto:', colX.unit, y)
  pdf.text(`R$ ${bruto.toFixed(2)}`, W - MR, y, { align: 'right' })
  y += 6
  pdf.text(`Retenção (${retencaoPct}%):`, colX.unit, y)
  pdf.text(`− R$ ${retido.toFixed(2)}`, W - MR, y, { align: 'right' })
  y += 6
  pdf.setFont('helvetica', 'bold')
  pdf.text('Valor líquido:', colX.unit, y)
  pdf.text(`R$ ${liquido.toFixed(2)}`, W - MR, y, { align: 'right' })

  rodape()
  pdf.save(`${d.contrato.numero} - MEDICAO ${d.medicao.numero} - ${d.empreiteiroNome}.pdf`)
}
