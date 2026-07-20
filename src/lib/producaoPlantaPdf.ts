import { jsPDF } from 'jspdf'
import type { ProducaoParede } from './supabase'

export interface DadosPlantaPdf {
  imagemUrl: string
  paredes: ProducaoParede[]
  pavimentoLabel: string
  escalaFonte: number
}

function rotuloDaParede(p: ProducaoParede) {
  return {
    pos_x: p.rotulo_pos_x ?? p.pos_x,
    pos_y: p.rotulo_pos_y ?? Math.max(0, p.pos_y - 3),
    rotacao: p.rotulo_rotacao,
    escala: p.rotulo_escala,
  }
}

export async function gerarPdfPlanta(d: DadosPlantaPdf) {
  const resp = await fetch(d.imagemUrl)
  if (!resp.ok) throw new Error('Não foi possível baixar a imagem da planta.')
  const blob = await resp.blob()
  const objectUrl = URL.createObjectURL(blob)
  try {
    const img = new Image()
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('Não foi possível carregar a imagem da planta.'))
      img.src = objectUrl
    })

    const escala = 2
    const canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth * escala
    canvas.height = img.naturalHeight * escala
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Não foi possível preparar o desenho da planta.')
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)

    for (const parede of d.paredes) {
      const rotulo = rotuloDaParede(parede)
      const x = (rotulo.pos_x / 100) * canvas.width
      const y = (rotulo.pos_y / 100) * canvas.height
      const fonte = 11 * rotulo.escala * escala * d.escalaFonte
      ctx.save()
      ctx.translate(x, y)
      ctx.rotate((rotulo.rotacao * Math.PI) / 180)
      ctx.font = `bold ${fonte}px Arial, sans-serif`
      ctx.textBaseline = 'middle'
      const largura = ctx.measureText(parede.nome).width
      const padX = 5 * rotulo.escala * escala * d.escalaFonte
      const altura = fonte * 1.6
      const raio = 4 * rotulo.escala * escala * d.escalaFonte
      ctx.fillStyle = '#ffffff'
      ctx.beginPath()
      if (typeof ctx.roundRect === 'function') ctx.roundRect(-padX / 2, -altura / 2, largura + padX, altura, raio)
      else ctx.rect(-padX / 2, -altura / 2, largura + padX, altura)
      ctx.fill()
      ctx.fillStyle = '#1A3248'
      ctx.fillText(parede.nome, 0, 1)
      ctx.restore()
    }

    const dataUrl = canvas.toDataURL('image/png')
    const orientacao = canvas.width > canvas.height ? 'landscape' : 'portrait'
    const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: orientacao })
    const pageW = pdf.internal.pageSize.getWidth()
    const pageH = pdf.internal.pageSize.getHeight()
    const margem = 10
    const margemTopo = 16
    const areaW = pageW - margem * 2
    const areaH = pageH - margemTopo - margem
    const aspecto = canvas.width / canvas.height
    let imgW = areaW
    let imgH = imgW / aspecto
    if (imgH > areaH) { imgH = areaH; imgW = imgH * aspecto }
    const offX = margem + (areaW - imgW) / 2
    const offY = margemTopo + (areaH - imgH) / 2

    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(11)
    pdf.setTextColor('#1A3248')
    pdf.text(`Planta — ${d.pavimentoLabel}`, margem, 10)
    pdf.addImage(dataUrl, 'PNG', offX, offY, imgW, imgH)
    pdf.save(`Planta - ${d.pavimentoLabel}.pdf`)
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}
