// Geração do PDF do pedido de compra com identidade RT Engenharia (jsPDF, client-side).
// Documento pra enviar a fornecedores/grupos pedindo cotação: lista de itens
// com aplicação (código do orçamento), quantidade, unidade, data necessária
// e urgência — sem preços (isso é conferido internamente, não sai no PDF).
import { jsPDF } from 'jspdf'
import type { PedidoCompra, PedidoCompraItem, Servico } from './supabase'

const NAVY = '#1A3248'
const TERRACOTA = '#C49A7A'
const CINZA = '#6c757d'

export interface DadosPdfPedido {
  pedido: PedidoCompra
  itens: PedidoCompraItem[]
  obraNome: string
  servicos: Servico[]
}

function codigoAplicacao(servicoId: string | null, servicos: Servico[]): string {
  if (!servicoId) return '—'
  const s = servicos.find(sv => sv.id === servicoId)
  return s?.codigo || s?.nome || '—'
}

function fmtData(iso: string | null): string {
  if (!iso) return '—'
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`
}

export function gerarPdfPedido(d: DadosPdfPedido): void {
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
  pdf.text('PEDIDO DE COMPRA', W - MR, 12, { align: 'right' })
  pdf.setFontSize(10)
  pdf.setTextColor('#D0AE95')
  pdf.text(`Nº ${String(d.pedido.numero).padStart(3, '0')}`, W - MR, 18.5, { align: 'right' })
  y = 39

  // ---------- identificação ----------
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(11)
  pdf.setTextColor('#222222')
  pdf.text(`Obra: ${d.obraNome}`, ML, y)
  y += 7

  if (d.pedido.descricao) {
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(9.5)
    pdf.setTextColor(CINZA)
    const linhas = pdf.splitTextToSize(d.pedido.descricao, LARG) as string[]
    pdf.text(linhas, ML, y)
    y += linhas.length * 4.6 + 3
  } else {
    y += 2
  }

  // ---------- tabela de itens ----------
  const colX = { item: ML, aplic: ML + 60, qtd: ML + 90, und: ML + 112, data: ML + 132, urg: ML + 160 }
  const colW = { item: 56, aplic: 26, qtd: 18, und: 16, data: 26, urg: 22 }

  function cabecalhoTabela() {
    precisa(10)
    pdf.setFillColor('#F0EBE3')
    pdf.rect(ML, y, LARG, 7, 'F')
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(8)
    pdf.setTextColor(NAVY)
    pdf.text('ITEM', colX.item + 1, y + 4.7)
    pdf.text('APLICAÇÃO', colX.aplic + 1, y + 4.7)
    pdf.text('QTD.', colX.qtd + 1, y + 4.7)
    pdf.text('UND.', colX.und + 1, y + 4.7)
    pdf.text('DATA NA OBRA', colX.data + 1, y + 4.7)
    pdf.text('URG.', colX.urg + 1, y + 4.7)
    y += 7
  }

  cabecalhoTabela()

  for (const it of d.itens) {
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(9)
    const linhasItem = pdf.splitTextToSize(it.descricao_item, colW.item - 2) as string[]
    const linhasAplic = pdf.splitTextToSize(codigoAplicacao(it.servico_id, d.servicos), colW.aplic - 2) as string[]
    const alturaLinha = Math.max(linhasItem.length, linhasAplic.length, 1) * 4.2 + 2.5

    precisa(alturaLinha)
    pdf.setDrawColor('#E0DAD0')
    pdf.setLineWidth(0.2)
    pdf.line(ML, y, W - MR, y)

    pdf.setTextColor('#222222')
    pdf.text(linhasItem, colX.item + 1, y + 4.2)
    pdf.setTextColor(CINZA)
    pdf.text(linhasAplic, colX.aplic + 1, y + 4.2)
    pdf.setTextColor('#222222')
    pdf.text(`${it.quantidade_pedida}`, colX.qtd + 1, y + 4.2)
    pdf.text(it.und || '—', colX.und + 1, y + 4.2)
    pdf.text(fmtData(it.data_necessaria), colX.data + 1, y + 4.2)
    if (it.urgente) {
      pdf.setTextColor('#a35c00')
      pdf.setFont('helvetica', 'bold')
      pdf.text('⚡ SIM', colX.urg + 1, y + 4.2)
      pdf.setFont('helvetica', 'normal')
    } else {
      pdf.setTextColor(CINZA)
      pdf.text('—', colX.urg + 1, y + 4.2)
    }
    y += alturaLinha
  }
  pdf.setDrawColor('#E0DAD0')
  pdf.line(ML, y, W - MR, y)

  rodape()
  const nomeObra = d.obraNome.replace(/\s+/g, '')
  pdf.save(`Pedido_${String(d.pedido.numero).padStart(3, '0')}_${nomeObra}.pdf`)
}
