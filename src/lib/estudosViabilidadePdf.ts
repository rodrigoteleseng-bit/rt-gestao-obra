import { jsPDF } from 'jspdf'
import type { ResultadoSolucao } from './estudosViabilidade'

const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

export function gerarPdfEstudoViabilidade(dados: { titulo: string; area: number; fonte: string; data: string; decisao: string | null; resultados: ResultadoSolucao[] }) {
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' })
  let y = 18
  pdf.setTextColor(26, 50, 72); pdf.setFontSize(17); pdf.text('RT ENGENHARIA', 15, y)
  y += 8; pdf.setFontSize(11); pdf.text('Estudo de viabilidade — retrato aprovado', 15, y)
  y += 10; pdf.setTextColor(45, 60, 70); pdf.setFontSize(13); pdf.text(dados.titulo, 15, y)
  y += 7; pdf.setFontSize(9); pdf.text(`Área: ${dados.area.toLocaleString('pt-BR')} m²`, 15, y)
  y += 5; pdf.text(`Fonte dos custos: ${dados.fonte || 'Não informada'} · Referência: ${dados.data || 'Não informada'}`, 15, y)
  y += 10; pdf.setFontSize(10); pdf.setTextColor(26, 50, 72); pdf.text('COMPARATIVO', 15, y)
  y += 6; pdf.setTextColor(45, 60, 70); pdf.setFontSize(8)
  for (const r of dados.resultados) {
    const total = r.totalM2 === null ? 'Pendente' : `${moeda.format(r.totalM2)}/m² · ${moeda.format(r.totalArea ?? 0)}`
    pdf.text(`${r.nome}: ${total}`, 15, y); y += 5
  }
  if (dados.decisao) { y += 5; pdf.setTextColor(26, 50, 72); pdf.setFontSize(10); pdf.text('DECISÃO TÉCNICA', 15, y); y += 6; pdf.setTextColor(45, 60, 70); pdf.setFontSize(9); pdf.text(pdf.splitTextToSize(dados.decisao, 180), 15, y) }
  pdf.save(`Estudo de viabilidade - ${dados.titulo.replace(/[\\/:*?"<>|]/g, '-').slice(0, 60)}.pdf`)
}
