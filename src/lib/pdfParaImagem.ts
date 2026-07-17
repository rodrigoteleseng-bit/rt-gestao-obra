import * as pdfjsLib from 'pdfjs-dist'
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker

export async function converterPdfParaImagem(arquivo: File): Promise<Blob> {
  const buffer = await arquivo.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise
  const pagina = await pdf.getPage(1)
  const viewport = pagina.getViewport({ scale: 2 })
  const canvas = document.createElement('canvas')
  canvas.width = viewport.width
  canvas.height = viewport.height
  const contexto = canvas.getContext('2d')
  if (!contexto) throw new Error('Não foi possível preparar a conversão do PDF.')
  await pagina.render({ canvasContext: contexto, viewport, canvas }).promise
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('Falha ao gerar a imagem da planta.'))
    }, 'image/png')
  })
}
