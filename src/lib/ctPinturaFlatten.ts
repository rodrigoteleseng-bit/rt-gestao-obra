// Achata a planta + a pintura de cada caminhão num canvas só, pra virar a
// página 1 do PDF do Controle Tecnológico quando a concretagem usa planta do
// catálogo em vez de anexo (ver docs/superpowers/specs/2026-09-10-ct-pintura-fase2-design.md §9).
import { supabase, type CtCaminhao } from './supabase'
import type { ImagemAnexo } from './pdfParaImagem'

async function carregarImagem(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Não foi possível carregar uma das camadas da pintura.'))
    img.src = url
  })
}

export async function achatarPlantaEPinturas(
  planta: { imagem_path: string },
  caminhoes: CtCaminhao[],
): Promise<ImagemAnexo> {
  const { data: plantaBlob, error } = await supabase.storage.from('controle-tecnologico').download(planta.imagem_path)
  if (error || !plantaBlob) {
    throw new Error(`Não foi possível baixar a planta: ${error?.message ?? 'arquivo não encontrado'}`)
  }
  const plantaUrl = URL.createObjectURL(plantaBlob)
  try {
    const imgPlanta = await carregarImagem(plantaUrl)
    const canvas = document.createElement('canvas')
    canvas.width = imgPlanta.naturalWidth
    canvas.height = imgPlanta.naturalHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Não foi possível preparar o achatamento da planta.')
    ctx.drawImage(imgPlanta, 0, 0)

    for (const c of caminhoes) {
      if (!c.pintura_url) continue
      const { data: camadaBlob, error: eCamada } = await supabase.storage.from('controle-tecnologico').download(c.pintura_url)
      if (eCamada || !camadaBlob) {
        throw new Error(`Não foi possível baixar a pintura de um dos caminhões: ${eCamada?.message ?? 'arquivo não encontrado'}`)
      }
      const camadaUrl = URL.createObjectURL(camadaBlob)
      try {
        const imgCamada = await carregarImagem(camadaUrl)
        ctx.drawImage(imgCamada, 0, 0, canvas.width, canvas.height)
      } finally {
        URL.revokeObjectURL(camadaUrl)
      }
    }

    return { dataUrl: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height }
  } finally {
    URL.revokeObjectURL(plantaUrl)
  }
}
