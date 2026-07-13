// Geração do PDF de estoque atual por categoria, pra conferência física
// (jsPDF, client-side), identidade RT Engenharia — mesmo padrão de
// comprasPdf.ts/requisicoesPdf.ts.
import { jsPDF } from 'jspdf'

const NAVY = '#1A3248'
const TERRACOTA = '#C49A7A'
const CINZA = '#6c757d'

export interface ItemEstoquePdf {
  codigo: string
  nome: string
  und: string
  saldo: number
}

export interface DadosPdfEstoque {
  categoriaLabel: string
  obraNome: string
  itens: ItemEstoquePdf[]
}

function fmtDataHoje(): string {
  const d = new Date()
  const dia = String(d.getDate()).padStart(2, '0')
  const mes = String(d.getMonth() + 1).padStart(2, '0')
  return `${dia}/${mes}/${d.getFullYear()}`
}

export function gerarPdfEstoque(d: DadosPdfEstoque): void {
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
  pdf.text(`ESTOQUE — ${d.categoriaLabel.toUpperCase()}`, W - MR, 12, { align: 'right' })
  pdf.setFontSize(9)
  pdf.setTextColor('#D0AE95')
  pdf.text(`Emitido em ${fmtDataHoje()}`, W - MR, 18.5, { align: 'right' })
  y = 39

  // ---------- identificação ----------
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(11)
  pdf.setTextColor('#222222')
  pdf.text(`Obra: ${d.obraNome}`, ML, y)
  y += 6
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(9.5)
  pdf.setTextColor(CINZA)
  pdf.text(`${d.itens.length} ite${d.itens.length === 1 ? 'm' : 'ns'} cadastrado${d.itens.length === 1 ? '' : 's'} nesta categoria`, ML, y)
  y += 7

  // ---------- tabela ----------
  const colX = { cod: ML, nome: ML + 32, und: ML + 124, saldo: ML + 148 }
  const colW = { cod: 32, nome: 92, und: 24, saldo: LARG - (32 + 92 + 24) }

  function cabecalhoTabela() {
    precisa(10)
    pdf.setFillColor('#F0EBE3')
    pdf.rect(ML, y, LARG, 7, 'F')
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(8)
    pdf.setTextColor(NAVY)
    pdf.text('CÓDIGO', colX.cod + 1, y + 4.7)
    pdf.text('NOME', colX.nome + 1, y + 4.7)
    pdf.text('UND.', colX.und + 1, y + 4.7)
    pdf.text('SALDO ATUAL', colX.saldo + 1, y + 4.7)
    y += 7
  }

  cabecalhoTabela()

  for (const it of d.itens) {
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(9)
    const linhasNome = pdf.splitTextToSize(it.nome, colW.nome - 2) as string[]
    const alturaLinha = Math.max(linhasNome.length, 1) * 4.2 + 2.5

    precisa(alturaLinha)
    pdf.setDrawColor('#E0DAD0')
    pdf.setLineWidth(0.2)
    pdf.line(ML, y, W - MR, y)

    pdf.setTextColor('#222222')
    pdf.text(it.codigo, colX.cod + 1, y + 4.2)
    pdf.text(linhasNome, colX.nome + 1, y + 4.2)
    pdf.setTextColor(CINZA)
    pdf.text(it.und || '—', colX.und + 1, y + 4.2)
    pdf.setFont('helvetica', 'bold')
    pdf.setTextColor('#222222')
    pdf.text(String(it.saldo), colX.saldo + 1, y + 4.2)
    y += alturaLinha
  }
  pdf.setDrawColor('#E0DAD0')
  pdf.line(ML, y, W - MR, y)

  rodape()

  const dataArquivo = fmtDataHoje().replace(/\//g, '-')
  const categoriaArquivo = d.categoriaLabel.replace(/\s+/g, '_')
  pdf.save(`Estoque_${categoriaArquivo}_${dataArquivo}.pdf`)
}
