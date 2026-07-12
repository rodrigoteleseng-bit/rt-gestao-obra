// Geração do PDF de bloco de requisições de material em branco, pré-numeradas,
// com identidade RT Engenharia (jsPDF, client-side). Padrão do modelo físico do
// Rodrigo (folha de requisição do almoxarifado), 2 fichas por página A4.
import { jsPDF } from 'jspdf'

const NAVY = '#1A3248'
const TERRACOTA = '#C49A7A'
const CINZA = '#6c757d'

export interface DadosPdfBlocoRequisicoes {
  obraNome: string
  numeroInicial: number
  numeroFinal: number
}

export function gerarPdfBlocoRequisicoes(d: DadosPdfBlocoRequisicoes): void {
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' })
  const W = 210
  const H = 297
  const ML = 14
  const MR = 14
  const LARG = W - ML - MR

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

  // desenha uma ficha de requisição a partir do topo `topo`, ocupando `altura` mm
  function desenharFicha(topo: number, altura: number, numero: number) {
    let y = topo

    // ---------- cabeçalho navy ----------
    pdf.setFillColor(NAVY)
    pdf.rect(ML, y, LARG, 22, 'F')
    pdf.setFillColor(TERRACOTA)
    pdf.rect(ML, y + 22, LARG, 1.2, 'F')

    pdf.setTextColor('#ffffff')
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(13)
    pdf.text('REQUISIÇÃO DE MATERIAL — ALMOXARIFADO', ML + 3, y + 8)

    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(8.5)
    pdf.setTextColor('#B8D4E8')
    pdf.text(`Empresa: RT Engenharia · Obra: ${d.obraNome}`, ML + 3, y + 14.5)

    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(8)
    pdf.setTextColor('#ffffff')
    pdf.text('Nº REQUISIÇÃO', W - MR - 3, y + 7, { align: 'right' })
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(16)
    pdf.setTextColor(TERRACOTA)
    pdf.text(String(numero).padStart(5, '0'), W - MR - 3, y + 16, { align: 'right' })

    y += 22 + 1.2 + 6

    // ---------- data da solicitação ----------
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(9.5)
    pdf.setTextColor('#222222')
    pdf.text('Data da Solicitação:  ____ / ____ / ________', ML, y)
    y += 6

    // ---------- tabela de itens ----------
    const colX = { num: ML, desc: ML + 9, cod: ML + 91, qtd: ML + 121, aplic: ML + 141 }
    const colW = { num: 9, desc: 82, cod: 30, qtd: 20, aplic: LARG - (9 + 82 + 30 + 20) }
    const alturaCab = 6.5
    const alturaLinha = 6.2
    const nLinhas = 10

    pdf.setFillColor('#F0EBE3')
    pdf.rect(ML, y, LARG, alturaCab, 'F')
    pdf.setDrawColor('#E0DAD0')
    pdf.setLineWidth(0.3)
    pdf.rect(ML, y, LARG, alturaCab)
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(7.5)
    pdf.setTextColor(NAVY)
    pdf.text('Nº', colX.num + colW.num / 2, y + 4.3, { align: 'center' })
    pdf.text('Descrição do Material', colX.desc + 1, y + 4.3)
    pdf.text('Código do produto', colX.cod + 1, y + 4.3)
    pdf.text('Quantidade', colX.qtd + 1, y + 4.3)
    pdf.text('APLICAÇÃO', colX.aplic + 1, y + 4.3)
    y += alturaCab

    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(9)
    pdf.setTextColor('#E0DAD0')
    for (let i = 1; i <= nLinhas; i++) {
      pdf.setDrawColor('#E0DAD0')
      pdf.setLineWidth(0.25)
      pdf.rect(ML, y, LARG, alturaLinha)
      pdf.line(colX.desc, y, colX.desc, y + alturaLinha)
      pdf.line(colX.cod, y, colX.cod, y + alturaLinha)
      pdf.line(colX.qtd, y, colX.qtd, y + alturaLinha)
      pdf.line(colX.aplic, y, colX.aplic, y + alturaLinha)
      pdf.setTextColor('#E0DAD0')
      pdf.text(String(i), colX.num + colW.num / 2, y + alturaLinha - 2, { align: 'center' })
      y += alturaLinha
    }
    y += 5

    // ---------- autorização ----------
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(9)
    pdf.setTextColor(NAVY)
    pdf.text('AUTORIZAÇÃO DO MESTRE DE OBRAS (OBRIGATÓRIA)', ML, y)
    y += 5
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(8.5)
    pdf.setTextColor('#222222')
    pdf.text('Autorizo a retirada do material acima solicitado.', ML, y)
    y += 12

    const assinLarg = (LARG - 10) / 2
    pdf.setDrawColor('#222222')
    pdf.setLineWidth(0.3)
    pdf.line(ML, y, ML + assinLarg, y)
    pdf.line(ML + assinLarg + 10, y, ML + assinLarg + 10 + assinLarg, y)
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(7.5)
    pdf.setTextColor(CINZA)
    pdf.text('MESTRE DE OBRAS / ENCARREGADO', ML + assinLarg / 2, y + 4, { align: 'center' })
    pdf.text('ENGENHEIRO RESPONSÁVEL', ML + assinLarg + 10 + assinLarg / 2, y + 4, { align: 'center' })

    // borda externa da ficha
    pdf.setDrawColor('#E0DAD0')
    pdf.setLineWidth(0.4)
    pdf.rect(ML, topo, LARG, altura)
  }

  const total = d.numeroFinal - d.numeroInicial + 1
  const alturaFicha = (H - 20 - 12) / 2 // duas fichas por página, respeitando margem de rodapé
  const espacoEntreFichas = 8

  for (let i = 0; i < total; i++) {
    const numero = d.numeroInicial + i
    const posicaoNaPagina = i % 2
    if (posicaoNaPagina === 0) {
      if (i > 0) pdf.addPage()
    }
    const topo = 10 + posicaoNaPagina * (alturaFicha + espacoEntreFichas)
    desenharFicha(topo, alturaFicha, numero)
  }

  rodape()

  const nomeArquivo = `Requisicoes_${String(d.numeroInicial).padStart(5, '0')}_a_${String(d.numeroFinal).padStart(5, '0')}.pdf`
  pdf.save(nomeArquivo)
}
