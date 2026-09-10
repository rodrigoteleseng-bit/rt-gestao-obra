// Geração do PDF da medição de empreiteiro com identidade RT Engenharia
// (jsPDF, client-side), paisagem. Cabeçalho em 3 colunas (Obra / Contrato /
// Medição), tabela com quantidade e valor acumulados por item, resumo em
// destaque (bruto/retenção/líquido) seguido do acumulado do contrato inteiro
// (com % sobre o valor total) e assinatura de empreiteiro + fiscal RT. Esse
// bloco final (assinaturas + resumo + acumulado) nunca quebra no meio: se não
// sobrar espaço confortável na página, ele inteiro vai para a próxima.
import { jsPDF } from 'jspdf'
import type { Contrato, Medicao } from './supabase'
import { formatarMoeda } from './formato'
import { carregarIdentidadeObra, larguraProporcional, type IdentidadeMarca } from './pdfBranding'

const NAVY = '#1A3248'
const TERRACOTA = '#C49A7A'
const CINZA = '#6c757d'
const PRETO = '#222222'

export interface ItemPdfMedicao {
  servicoCodigo: string
  servicoNome: string
  unidadeNome: string
  und: string
  quantidadeContratada: number
  jaAprovado: number
  quantidadePeriodo: number
  valorUnitario: number
}

export interface DeducaoPdfMedicao {
  descricao: string
  quantidade: number
  valorUnitario: number
  valorTotal: number
}

export interface DadosPdfMedicao {
  contrato: Contrato
  medicao: Medicao
  empreiteiroNome: string
  obraNome: string
  nomeEmpreendimento: string | null
  enderecoObra: string | null
  cidadeObra: string | null
  estadoObra: string | null
  cnpjObra: string | null
  cnoObra: string | null
  enderecoEscritorioObra: string | null
  cepObra: string | null
  emailObra: string | null
  identidade: IdentidadeMarca
  responsavelNome: string
  responsavelEmail: string
  responsavelTelefone: string | null
  itens: ItemPdfMedicao[]
  deducoes: DeducaoPdfMedicao[]
  // Acompanhamento do contrato inteiro (soma de todas as medições aprovadas,
  // incluindo esta) — mesmo cálculo já usado no painel do Contrato e no final
  // da tela de Medição, repetido aqui pra constar no documento impresso.
  totalBrutoContrato: number
  totalRetidoContrato: number
  totalLiquidoContrato: number
}

function fmtData(iso: string | null): string {
  if (!iso) return '—'
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`
}

function fmtDataHora(iso: string | null): string {
  if (!iso) return '—'
  return fmtData(iso.slice(0, 10))
}

function formatarEnderecoObra(endereco: string | null, cidade: string | null, estado: string | null): string | null {
  const cidadeEstado = [cidade, estado].filter((v): v is string => Boolean(v)).join(' - ')
  const partes = [endereco, cidadeEstado].filter((v): v is string => Boolean(v))
  return partes.length > 0 ? partes.join(', ') : null
}

export function gerarPdfMedicao(d: DadosPdfMedicao): void {
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' })
  const W = 297
  const H = 210
  const ML = 14
  const MR = 14
  const LARG = W - ML - MR
  const LIMITE_CONTEUDO = 190 // abaixo disso, quebra a tabela pra próxima página
  const LIMITE_RODAPE = 196   // onde a faixa de rodapé começa
  const LARG_DESC_DEDUCAO = 168 // largura da coluna de descrição na tabela de deduções
  // Altura real da tabela de deduções dentro do bloco final — soma o
  // cabeçalho, cada linha (com quebra de texto, mesma fórmula da tabela
  // de itens) e a linha de total. Zero quando não há deduções, então o
  // bloco final volta exatamente ao tamanho de antes.
  function alturaTabelaDeducoes(): number {
    if (d.deducoes.length === 0) return 0
    const alturaLinhas = d.deducoes.reduce((soma, ded) => {
      const linhas = pdf.splitTextToSize(ded.descricao, LARG_DESC_DEDUCAO) as string[]
      return soma + Math.max(linhas.length, 1) * 4.2 + 2.5
    }, 0)
    return 5 + 7 + alturaLinhas + 7 // margem superior + cabeçalho + linhas + linha de total
  }
  const ALTURA_BLOCO_FINAL = 68 + alturaTabelaDeducoes() // assinaturas + resumo + acumulado (~58mm) + folga (~10mm) + deduções, se houver
  const BLOCO_FINAL_Y = LIMITE_RODAPE - ALTURA_BLOCO_FINAL // posição fixa — o bloco final sempre começa aqui, travado no rodapé
  const medXxx = `MED-${String(d.medicao.numero).padStart(3, '0')}`
  let y = 0

  function rodape() {
    const total = pdf.getNumberOfPages()
    for (let i = 1; i <= total; i++) {
      pdf.setPage(i)
      pdf.setDrawColor(TERRACOTA)
      pdf.setLineWidth(0.5)
      pdf.line(ML, LIMITE_RODAPE, W - MR, LIMITE_RODAPE)
      pdf.setFontSize(7.5)
      pdf.setTextColor(CINZA)
      pdf.setFont('helvetica', 'normal')
      pdf.text(d.identidade.rodapeTexto, ML, LIMITE_RODAPE + 5)
      pdf.text(`Página ${i} de ${total}`, W - MR, LIMITE_RODAPE + 5, { align: 'right' })
    }
  }

  function novaPagina() {
    pdf.addPage()
    y = 16
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(8)
    pdf.setTextColor(CINZA)
    pdf.text(`${medXxx} — continuação`, ML, y)
    y += 8
  }

  function precisaLinha(mm: number) {
    if (y + mm > LIMITE_CONTEUDO) {
      novaPagina()
      cabecalhoTabela()
    }
  }

  function precisaEspaco(mm: number) {
    if (y + mm > LIMITE_CONTEUDO) novaPagina()
  }

  // ---------- cabeçalho ----------
  pdf.setFillColor(NAVY)
  pdf.rect(0, 0, W, 30, 'F')
  pdf.setFillColor(TERRACOTA)
  pdf.rect(0, 30, W, 1.4, 'F')
  pdf.setTextColor('#ffffff')
  if (d.identidade.logoBase64) {
    const alturaLogo = 22
    const larguraLogo = larguraProporcional(pdf, d.identidade.logoBase64, alturaLogo)
    pdf.addImage(d.identidade.logoBase64, 'PNG', ML, 4, larguraLogo, alturaLogo)
  } else {
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(17)
    pdf.text('RT ENGENHARIA', ML, 13)
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(8.5)
    pdf.setTextColor('#B8D4E8')
    pdf.text('Inteligência Aplicada', ML, 18.5)
  }
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(15)
  pdf.setTextColor('#ffffff')
  pdf.text(medXxx, W - MR, 13, { align: 'right' })
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(9)
  pdf.setTextColor('#D0AE95')
  pdf.text(`MEDIÇÃO · ${d.contrato.numero}`, W - MR, 19, { align: 'right' })
  y = 39

  // ---------- título da obra — grande, centralizado ----------
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(16)
  pdf.setTextColor(NAVY)
  const tituloObra = d.nomeEmpreendimento ? `${d.obraNome} — ${d.nomeEmpreendimento}` : d.obraNome
  pdf.text(tituloObra, W / 2, y, { align: 'center' })
  y += 6
  pdf.setDrawColor('#ddd3c4')
  pdf.setLineWidth(0.3)
  pdf.line(ML, y, W - MR, y)
  y += 6

  // ---------- informações gerais — 3 colunas (Obra / Contrato / Medição) ----------
  const yColunas = y
  const colLarg = LARG / 3
  const colunaX = [ML, ML + colLarg, ML + colLarg * 2]

  const largColuna = colLarg - 8

  // Quebra cada linha dentro da largura da coluna (empreiteiro/objeto podem
  // ser longos) e devolve a altura final ocupada, pra dimensionar as
  // divisórias e o y seguinte pela coluna mais alta das 3.
  function coluna(x: number, rotulo: string, linhas: string[]): number {
    let yc = yColunas
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(7)
    pdf.setTextColor(TERRACOTA)
    pdf.text(rotulo.toUpperCase(), x, yc)
    yc += 5
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(9)
    pdf.setTextColor('#333333')
    for (const linha of linhas) {
      const quebradas = pdf.splitTextToSize(linha, largColuna) as string[]
      pdf.text(quebradas, x, yc)
      yc += quebradas.length * 4.3
    }
    return yc
  }

  const endereco = formatarEnderecoObra(d.enderecoObra, d.cidadeObra, d.estadoObra)
  const linhaResponsavel = d.responsavelTelefone
    ? `Lançado por: ${d.responsavelNome} · ${d.responsavelTelefone}`
    : `Lançado por: ${d.responsavelNome}`
  const fimCol0 = coluna(colunaX[0], 'Obra', [
    ...(endereco ? [`Endereço: ${endereco}`] : []),
    linhaResponsavel,
  ])
  const fimCol1 = coluna(colunaX[1], 'Contrato', [
    `Empreiteiro: ${d.empreiteiroNome}`,
    `Contrato: ${d.contrato.numero}`,
    `Objeto: ${d.contrato.objeto}`,
  ])
  const fimCol2 = coluna(colunaX[2], 'Medição', [
    `Medição Nº: ${medXxx}`,
    `Período: ${fmtData(d.medicao.data_inicio)} a ${fmtData(d.medicao.data_fim)}`,
    `Data: ${fmtDataHora(d.medicao.aprovada_em)}`,
  ])
  const fimColunas = Math.max(fimCol0, fimCol1, fimCol2)

  pdf.setDrawColor('#ddd3c4')
  pdf.setLineWidth(0.3)
  pdf.line(colunaX[1], yColunas - 4, colunaX[1], fimColunas + 1)
  pdf.line(colunaX[2], yColunas - 4, colunaX[2], fimColunas + 1)

  y = fimColunas + 4
  pdf.setDrawColor('#ddd3c4')
  pdf.line(ML, y, W - MR, y)
  y += 6

  // ---------- tabela de itens ----------
  const colX = {
    item: ML, servico: ML + 16, unidade: ML + 87, und: ML + 109, precoUnit: ML + 121,
    qtdContrat: ML + 143, qtdMedicao: ML + 161, qtdAcum: ML + 179,
    valorPrevisto: ML + 197, valorMedicao: ML + 221, valorAcum: ML + 245,
  }
  const colW = {
    item: 16, servico: 71, unidade: 22, und: 12, precoUnit: 22,
    qtdContrat: 18, qtdMedicao: 18, qtdAcum: 18, valorPrevisto: 24, valorMedicao: 24, valorAcum: 24,
  }

  function centro(col: keyof typeof colX) { return colX[col] + colW[col] / 2 }

  function cabecalhoTabela() {
    pdf.setFillColor('#F0EBE3')
    pdf.rect(ML, y, LARG, 7, 'F')
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(7)
    pdf.setTextColor(NAVY)
    pdf.text('ITEM', colX.item + 1, y + 4.7)
    pdf.text('SERVIÇO', colX.servico + 1, y + 4.7)
    pdf.text('UNIDADE', colX.unidade + 1, y + 4.7)
    pdf.text('UND.', centro('und'), y + 4.7, { align: 'center' })
    pdf.text('PREÇO UNIT.', centro('precoUnit'), y + 4.7, { align: 'center' })
    pdf.text('QTD. CONTRAT.', centro('qtdContrat'), y + 4.7, { align: 'center' })
    pdf.text('QTD. MEDIÇÃO', centro('qtdMedicao'), y + 4.7, { align: 'center' })
    pdf.text('QTD. ACUM.', centro('qtdAcum'), y + 4.7, { align: 'center' })
    pdf.text('VALOR PREVISTO', centro('valorPrevisto'), y + 4.7, { align: 'center' })
    pdf.text('VALOR MEDIÇÃO', centro('valorMedicao'), y + 4.7, { align: 'center' })
    pdf.text('VALOR ACUM.', centro('valorAcum'), y + 4.7, { align: 'center' })
    y += 7
  }

  cabecalhoTabela()

  let brutoItens = 0
  for (const it of d.itens) {
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(8.5)
    const linhasServico = pdf.splitTextToSize(
      it.servicoNome, colW.servico - 2
    ) as string[]
    const alturaLinha = Math.max(linhasServico.length, 1) * 4.2 + 2.5
    const qtdAcumulada = it.jaAprovado + it.quantidadePeriodo
    const valorMedicao = it.quantidadePeriodo * it.valorUnitario
    const valorPrevisto = it.quantidadeContratada * it.valorUnitario
    const valorAcum = qtdAcumulada * it.valorUnitario
    brutoItens += valorMedicao

    precisaLinha(alturaLinha)
    pdf.setDrawColor('#E0DAD0')
    pdf.setLineWidth(0.2)
    pdf.line(ML, y, W - MR, y)

    pdf.setTextColor(PRETO)
    pdf.text(it.servicoCodigo || '—', colX.item + 1, y + 4.2)
    pdf.text(linhasServico, colX.servico + 1, y + 4.2)
    pdf.text(it.unidadeNome, colX.unidade + 1, y + 4.2)
    pdf.setTextColor(CINZA)
    pdf.text(it.und || '—', centro('und'), y + 4.2, { align: 'center' })
    pdf.setTextColor(PRETO)
    pdf.text(`R$ ${formatarMoeda(it.valorUnitario)}`, centro('precoUnit'), y + 4.2, { align: 'center' })
    pdf.text(`${it.quantidadeContratada}`, centro('qtdContrat'), y + 4.2, { align: 'center' })
    pdf.text(`${it.quantidadePeriodo}`, centro('qtdMedicao'), y + 4.2, { align: 'center' })
    pdf.text(`${qtdAcumulada}`, centro('qtdAcum'), y + 4.2, { align: 'center' })
    pdf.text(`R$ ${formatarMoeda(valorPrevisto)}`, centro('valorPrevisto'), y + 4.2, { align: 'center' })
    pdf.text(`R$ ${formatarMoeda(valorMedicao)}`, centro('valorMedicao'), y + 4.2, { align: 'center' })
    pdf.text(`R$ ${formatarMoeda(valorAcum)}`, centro('valorAcum'), y + 4.2, { align: 'center' })
    y += alturaLinha
  }
  pdf.setDrawColor('#E0DAD0')
  pdf.line(ML, y, W - MR, y)
  y += 8

  // ---------- bloco final: assinaturas + resumo + acumulado (atômico) ----------
  // Sempre travado no rodapé (mesma posição em qualquer página) — se a
  // tabela já passou desse ponto, o bloco inteiro vai pra próxima página;
  // senão, "sobe" pro y fixo mesmo com a tabela terminando bem antes.
  if (y > BLOCO_FINAL_Y) novaPagina()
  y = BLOCO_FINAL_Y

  // assinaturas
  const meioAssinatura = ML + LARG / 2
  const largAssinatura = LARG / 2 - 20
  pdf.setDrawColor('#999999')
  pdf.setLineWidth(0.3)
  pdf.line(ML + 10, y, ML + 10 + largAssinatura, y)
  pdf.line(meioAssinatura + 10, y, meioAssinatura + 10 + largAssinatura, y)
  y += 4.5
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(8.5)
  pdf.setTextColor(NAVY)
  pdf.text(d.empreiteiroNome, ML + 10 + largAssinatura / 2, y, { align: 'center' })
  pdf.text(d.responsavelNome, meioAssinatura + 10 + largAssinatura / 2, y, { align: 'center' })
  y += 4
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(7.5)
  pdf.setTextColor(CINZA)
  pdf.text('Empreiteiro', ML + 10 + largAssinatura / 2, y, { align: 'center' })
  pdf.text('Fiscal RT Engenharia', meioAssinatura + 10 + largAssinatura / 2, y, { align: 'center' })
  y += 9

  // resumo desta medição, em destaque
  // Medição aprovada é registro permanente: o resumo impresso usa
  // sempre o valor persistido (valor_bruto/retido/liquido), mantido
  // pelo trigger recalcular_valor_medicao — nunca o recomputo a partir
  // dos itens, que soma floats do JS ("arredonda a soma") enquanto o
  // banco soma valor_total_item já arredondado por item ("soma de
  // arredondados"), podendo divergir por centavos. Em rascunho não há
  // valor definitivo ainda, então o PDF recomputa a partir dos itens
  // passados (mesmo cálculo já usado linha a linha acima).
  const aprovada = d.medicao.status === 'aprovada'
  const retencaoPct = d.contrato.retencao_pct ?? 0
  const bruto = aprovada ? d.medicao.valor_bruto : brutoItens
  const retido = aprovada ? d.medicao.valor_retido : Math.round(brutoItens * retencaoPct) / 100
  const totalDeducoes = d.deducoes.reduce((s, ded) => s + ded.valorTotal, 0)
  const liquido = aprovada ? d.medicao.valor_liquido : bruto - retido - totalDeducoes

  const alturaDestaque = 18
  pdf.setFillColor(NAVY)
  pdf.rect(ML, y, LARG, alturaDestaque, 'F')
  const largTile = LARG / 3
  const tiles: [string, string, string][] = [
    ['VALOR BRUTO', `R$ ${formatarMoeda(bruto)}`, '#ffffff'],
    [`RETENÇÃO (${retencaoPct}%)`, `- R$ ${formatarMoeda(retido)}`, '#ffffff'],
    ['VALOR LÍQUIDO', `R$ ${formatarMoeda(liquido)}`, '#cfe8d6'],
  ]
  tiles.forEach(([rotulo, valor, cor], i) => {
    const xTile = ML + largTile * i + 8
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(7.5)
    pdf.setTextColor('#D0AE95')
    pdf.text(rotulo, xTile, y + 7)
    pdf.setFontSize(13)
    pdf.setTextColor(cor)
    pdf.text(valor, xTile, y + 14)
    if (i > 0) {
      pdf.setDrawColor(255, 255, 255)
      pdf.setLineWidth(0.15)
      pdf.line(ML + largTile * i, y + 3, ML + largTile * i, y + alturaDestaque - 3)
    }
  })
  y += alturaDestaque + 5

  // ---------- deduções desta medição, se houver ----------
  if (d.deducoes.length > 0) {
    y += 5
    const colXDed = { descricao: ML, quantidade: ML + 184, valorUnitario: ML + 212, valorTotal: ML + 246 }
    pdf.setFillColor('#F0EBE3')
    pdf.rect(ML, y, LARG, 7, 'F')
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(7)
    pdf.setTextColor(NAVY)
    pdf.text('DEDUÇÕES', colXDed.descricao + 1, y + 4.7)
    pdf.text('QTD.', colXDed.quantidade + 14, y + 4.7, { align: 'center' })
    pdf.text('VALOR UNIT.', colXDed.valorUnitario + 17, y + 4.7, { align: 'center' })
    pdf.text('VALOR TOTAL', W - MR - 18, y + 4.7, { align: 'center' })
    y += 7

    for (const ded of d.deducoes) {
      pdf.setFont('helvetica', 'normal')
      pdf.setFontSize(8.5)
      const linhasDesc = pdf.splitTextToSize(ded.descricao, LARG_DESC_DEDUCAO) as string[]
      const alturaLinha = Math.max(linhasDesc.length, 1) * 4.2 + 2.5
      pdf.setDrawColor('#E0DAD0')
      pdf.setLineWidth(0.2)
      pdf.line(ML, y, W - MR, y)
      pdf.setTextColor(PRETO)
      pdf.text(linhasDesc, colXDed.descricao + 1, y + 4.2)
      pdf.text(`${ded.quantidade}`, colXDed.quantidade + 14, y + 4.2, { align: 'center' })
      pdf.text(`R$ ${formatarMoeda(ded.valorUnitario)}`, colXDed.valorUnitario + 17, y + 4.2, { align: 'center' })
      pdf.text(`R$ ${formatarMoeda(ded.valorTotal)}`, W - MR - 18, y + 4.2, { align: 'center' })
      y += alturaLinha
    }
    pdf.setDrawColor('#E0DAD0')
    pdf.line(ML, y, W - MR, y)
    y += 5
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(9.5)
    pdf.setTextColor(NAVY)
    pdf.text('Total de Deduções', ML, y)
    pdf.text(`R$ ${formatarMoeda(totalDeducoes)}`, W - MR, y, { align: 'right' })
    y += 2
  }

  // acumulado do contrato inteiro
  const valorTotalContrato = d.contrato.valor_total
  const pctBruto = valorTotalContrato > 0 ? (d.totalBrutoContrato / valorTotalContrato) * 100 : 0
  const pctRetido = valorTotalContrato > 0 ? (d.totalRetidoContrato / valorTotalContrato) * 100 : 0
  const pctLiquido = valorTotalContrato > 0 ? (d.totalLiquidoContrato / valorTotalContrato) * 100 : 0

  function linhaAcumulada(rotulo: string, valor: number, pct: number, destaque: boolean) {
    pdf.setFont('helvetica', destaque ? 'bold' : 'normal')
    pdf.setFontSize(destaque ? 10 : 9.5)
    pdf.setTextColor(destaque ? NAVY : '#333333')
    pdf.text(rotulo, ML, y)
    pdf.text(`R$ ${formatarMoeda(valor)}`, W - MR - 32, y, { align: 'right' })
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(8.5)
    pdf.setTextColor(CINZA)
    pdf.text(`${pct.toFixed(1)}% do contrato`, W - MR, y, { align: 'right' })
    y += destaque ? 6.5 : 5.5
  }

  linhaAcumulada('Valor total medido (líquido + retenção), com esta medição', d.totalBrutoContrato, pctBruto, true)
  linhaAcumulada('Retenção acumulada do contrato', d.totalRetidoContrato, pctRetido, false)
  linhaAcumulada('Valor líquido pago acumulado do contrato', d.totalLiquidoContrato, pctLiquido, false)

  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(7)
  pdf.setTextColor('#8a8a8a')
  const nota = pdf.splitTextToSize(
    `% em relação ao valor total do contrato (R$ ${formatarMoeda(valorTotalContrato)}). Soma de todas as medições aprovadas deste contrato, incluindo esta.`,
    LARG
  ) as string[]
  pdf.text(nota, ML, y)

  // ---------- dados para emissão de nota fiscal ----------
  const camposNF: [string, string][] = [
    ['Empresa', d.nomeEmpreendimento ?? d.obraNome],
    ['CNPJ', d.cnpjObra ?? '—'],
    ['Endereço', d.enderecoEscritorioObra ?? '—'],
    ['CEP', d.cepObra ?? '—'],
    ['E-mail', d.emailObra ?? '—'],
    ['CNO', d.cnoObra ?? '—'],
  ]
  precisaEspaco(8 + camposNF.length * 5.5)
  y += 8
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(10)
  pdf.setTextColor(NAVY)
  pdf.text('DADOS PARA EMISSÃO DE NOTA FISCAL', ML, y)
  y += 6
  for (const [rotulo, valor] of camposNF) {
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(8.5)
    pdf.setTextColor(TERRACOTA)
    pdf.text(`${rotulo}:`, ML, y)
    pdf.setFont('helvetica', 'normal')
    pdf.setTextColor('#333333')
    pdf.text(valor, ML + 28, y)
    y += 5.5
  }

  rodape()
  pdf.save(`${d.contrato.numero} - ${medXxx} - ${d.empreiteiroNome}.pdf`)
}
