import { jsPDF } from 'jspdf'
import type { Obra } from './supabase'
import type { ResultadoSolucao } from './estudosViabilidade'
import { carregarIdentidadeObra, larguraProporcional, type IdentidadeMarca } from './pdfBranding'

const NAVY = '#1A3248'
const TERRACOTA = '#C49A7A'
const CINZA = '#687780'
const AZUL_INSUMOS = '#1A6A8B'
const VERDE_MAO_OBRA = '#579363'
const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

type DadosPdfEstudo = {
  obra: Obra | null; titulo: string; area: number; fonte: string; data: string; decisao: string | null
  solucaoEscolhidaNome: string | null; aprovadoEm: string | null; aprovadoPorNome: string | null; resultados: ResultadoSolucao[]
}

function formatarData(data: string) { return data ? `${data.slice(8, 10)}/${data.slice(5, 7)}/${data.slice(0, 4)}` : 'Não informada' }
function formatarDataHora(data: string | null) { return data ? new Date(data).toLocaleString('pt-BR') : 'Não registrada' }

function desenharCabecalho(pdf: jsPDF, identidade: IdentidadeMarca, titulo: string) {
  const W = 210; const ML = 14; const MR = 14
  pdf.setFillColor(NAVY); pdf.rect(0, 0, W, 30, 'F')
  pdf.setFillColor(TERRACOTA); pdf.rect(0, 30, W, 1.4, 'F')
  if (identidade.logoBase64) {
    const altura = 22
    pdf.addImage(identidade.logoBase64, 'PNG', ML, 4, larguraProporcional(pdf, identidade.logoBase64, altura), altura)
  } else {
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(17); pdf.setTextColor('#ffffff'); pdf.text(identidade.nomeMarca, ML, 13)
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8.5); pdf.setTextColor('#B8D4E8'); pdf.text(identidade.tagline, ML, 18.5)
  }
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(11); pdf.setTextColor('#ffffff'); pdf.text('ESTUDO DE VIABILIDADE', W - MR, 12, { align: 'right' })
  pdf.setFontSize(9); pdf.setTextColor('#D0AE95'); pdf.text('APROVADO', W - MR, 18.5, { align: 'right' })
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7.5); pdf.setTextColor('#B8D4E8'); pdf.text(titulo, W - MR, 24, { align: 'right', maxWidth: 95 })
}

function desenharRodape(pdf: jsPDF, identidade: IdentidadeMarca) {
  const W = 210; const ML = 14; const MR = 14; const total = pdf.getNumberOfPages()
  for (let pagina = 1; pagina <= total; pagina++) {
    pdf.setPage(pagina); pdf.setDrawColor(TERRACOTA); pdf.setLineWidth(.5); pdf.line(ML, 285, W - MR, 285)
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7.5); pdf.setTextColor(CINZA)
    pdf.text(identidade.rodapeTexto, ML, 290); pdf.text(`Página ${pagina} de ${total}`, W - MR, 290, { align: 'right' })
  }
}

function desenharSetor(pdf: jsPDF, x: number, y: number, raio: number, inicio: number, fim: number, cor: string) {
  const passos = Math.max(3, Math.ceil(Math.abs(fim - inicio) / (Math.PI / 18)))
  const pontos: [number, number][] = []
  for (let passo = 0; passo <= passos; passo++) {
    const angulo = inicio + (fim - inicio) * passo / passos
    pontos.push([raio * Math.cos(angulo), raio * Math.sin(angulo)])
  }
  const linhas: [number, number][] = [pontos[0], ...pontos.slice(1).map((ponto, indice) => [ponto[0] - pontos[indice][0], ponto[1] - pontos[indice][1]] as [number, number])]
  pdf.setFillColor(cor); pdf.lines(linhas, x, y, [1, 1], 'F', true)
}

export async function gerarPdfEstudoViabilidade(dados: DadosPdfEstudo) {
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' })
  const W = 210; const ML = 14; const MR = 14; const LARGURA = W - ML - MR
  const identidade = await carregarIdentidadeObra(dados.obra)
  const validos = dados.resultados.filter(resultado => resultado.totalM2 !== null)
  let y = 39

  function secao(titulo: string) {
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(9); pdf.setTextColor(TERRACOTA); pdf.text(titulo, ML, y)
    y += 4; pdf.setDrawColor('#DCE4E8'); pdf.setLineWidth(.25); pdf.line(ML, y, W - MR, y); y += 6
  }
  function novaPagina() { pdf.addPage(); desenharCabecalho(pdf, identidade, dados.titulo); y = 39 }
  function garantir(altura: number) { if (y + altura > 279) novaPagina() }

  desenharCabecalho(pdf, identidade, dados.titulo)
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(14); pdf.setTextColor(NAVY); pdf.text(dados.titulo, ML, y)
  y += 6; pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); pdf.setTextColor(CINZA)
  pdf.text(`${dados.obra?.nome ?? 'Obra não identificada'} · Área analisada: ${dados.area.toLocaleString('pt-BR')} m²`, ML, y)
  y += 5; pdf.text(`Fonte dos custos: ${dados.fonte || 'Não informada'} · Referência: ${formatarData(dados.data)}`, ML, y)
  y += 5; pdf.text(`Aprovado em: ${formatarDataHora(dados.aprovadoEm)} · Aprovado por: ${dados.aprovadoPorNome ?? 'Não registrado'}`, ML, y)
  y += 9

  const nomeEscolhido = dados.solucaoEscolhidaNome ?? 'Não registrada neste estudo'
  const linhasNomeEscolhido = pdf.splitTextToSize(nomeEscolhido, LARGURA - 10)
  const alturaEscolha = Math.max(18, 9 + linhasNomeEscolhido.length * 4.5)
  garantir(alturaEscolha + 15)
  secao('DECISÃO DE EXECUÇÃO')
  pdf.setFillColor('#EEF7ED'); pdf.roundedRect(ML, y, LARGURA, alturaEscolha, 2, 2, 'F')
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(9); pdf.setTextColor('#356C3B'); pdf.text('SOLUÇÃO ESCOLHIDA', ML + 5, y + 6)
  pdf.setFontSize(11); pdf.setTextColor(NAVY); pdf.text(linhasNomeEscolhido, ML + 5, y + 12)
  const justificativa = dados.decisao ? pdf.splitTextToSize(dados.decisao, LARGURA - 10) : ['Sem justificativa registrada.']
  y += alturaEscolha + 7
  secao('JUSTIFICATIVA TÉCNICA')
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8.5); pdf.setTextColor('#50606B')
  for (const linha of justificativa) {
    garantir(5)
    pdf.text(linha, ML, y)
    y += 4.2
  }
  y += 4

  garantir(47)
  secao('COMPOSIÇÃO DE CUSTOS POR SOLUÇÃO')
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); pdf.setTextColor(CINZA)
  pdf.setFillColor(AZUL_INSUMOS); pdf.roundedRect(ML, y - 3, 3, 3, .5, .5, 'F'); pdf.text('Insumos', ML + 5, y)
  pdf.setFillColor(VERDE_MAO_OBRA); pdf.roundedRect(ML + 28, y - 3, 3, 3, .5, .5, 'F'); pdf.text('Mão de obra', ML + 33, y); y += 5

  for (const resultado of validos) {
    garantir(42)
    const insumos = resultado.custoBloco + (resultado.custoArgamassa ?? 0)
    const maoObra = resultado.custoAplicacao
    const total = resultado.totalM2 ?? 0
    const percentualInsumos = total ? insumos / total : 0
    const maiorImpacto = maoObra > insumos ? 'Mão de obra' : 'Insumos'
    pdf.setFillColor('#F8FAFA'); pdf.setDrawColor('#DCE4E8'); pdf.roundedRect(ML, y, LARGURA, 36, 2, 2, 'FD')
    desenharSetor(pdf, ML + 19, y + 18, 12, -Math.PI / 2, -Math.PI / 2 + 2 * Math.PI * percentualInsumos, AZUL_INSUMOS)
    desenharSetor(pdf, ML + 19, y + 18, 12, -Math.PI / 2 + 2 * Math.PI * percentualInsumos, Math.PI * 1.5, VERDE_MAO_OBRA)
    pdf.setFillColor('#F8FAFA'); pdf.circle(ML + 19, y + 18, 4.5, 'F')
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(9); pdf.setTextColor(NAVY); pdf.text(pdf.splitTextToSize(resultado.nome, 117).slice(0, 2), ML + 38, y + 8)
    pdf.setFontSize(11); pdf.text(`${moeda.format(total)}/m²`, W - MR - 4, y + 8, { align: 'right' })
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); pdf.setTextColor(CINZA); pdf.text(`${moeda.format(total * dados.area)} na área analisada`, W - MR - 4, y + 13, { align: 'right' })
    const larguraBarra = 108
    pdf.setFillColor('#E8EDEF'); pdf.roundedRect(ML + 38, y + 18, larguraBarra, 5, 1.5, 1.5, 'F')
    pdf.setFillColor(AZUL_INSUMOS); pdf.roundedRect(ML + 38, y + 18, larguraBarra * percentualInsumos, 5, 1.5, 1.5, 'F')
    pdf.setFillColor(VERDE_MAO_OBRA); pdf.roundedRect(ML + 38 + larguraBarra * percentualInsumos, y + 18, larguraBarra * (1 - percentualInsumos), 5, 1.5, 1.5, 'F')
    pdf.setFontSize(8); pdf.setTextColor(AZUL_INSUMOS); pdf.text(`Insumos: ${moeda.format(insumos)}/m²`, ML + 38, y + 29)
    pdf.setTextColor(VERDE_MAO_OBRA); pdf.text(`Mão de obra: ${moeda.format(maoObra)}/m²`, ML + 87, y + 29)
    pdf.setFont('helvetica', 'bold'); pdf.setTextColor('#50606B'); pdf.text(`Maior impacto: ${maiorImpacto}`, W - MR - 4, y + 29, { align: 'right' })
    y += 42
  }
  if (!validos.length) { pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); pdf.setTextColor(CINZA); pdf.text('Não há soluções com custos completos para apresentar.', ML, y) }
  desenharRodape(pdf, identidade)
  pdf.save(`Estudo de viabilidade - ${dados.titulo.replace(/[\\/:*?"<>|]/g, '-').slice(0, 60)}.pdf`)
}
