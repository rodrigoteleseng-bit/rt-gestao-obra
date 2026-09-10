import * as pdfjsLib from 'pdfjs-dist'
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker

export async function converterPdfParaImagem(arquivo: Blob): Promise<Blob> {
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

export interface ImagemAnexo {
  dataUrl: string
  width: number
  height: number
}

function ehPdf(nomeArquivo: string): boolean {
  return nomeArquivo.toLowerCase().endsWith('.pdf')
}

async function blobParaDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as string)
    r.onerror = reject
    r.readAsDataURL(blob)
  })
}

// Normaliza QUALQUER formato de imagem que o navegador consiga decodificar
// (JPEG, PNG, WEBP, HEIC quando suportado) para PNG via canvas — evita
// depender dos formatos nativos que o jsPDF aceita (só JPEG/PNG confiáveis).
async function normalizarImagemParaPng(blob: Blob): Promise<ImagemAnexo> {
  const url = URL.createObjectURL(blob)
  try {
    const img = new Image()
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('Não foi possível carregar a imagem do anexo.'))
      img.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth
    canvas.height = img.naturalHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Não foi possível preparar a conversão da imagem.')
    ctx.drawImage(img, 0, 0)
    return { dataUrl: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height }
  } finally {
    URL.revokeObjectURL(url)
  }
}

// Devolve o anexo (PDF de 1 página ou foto) já pronto pra `pdf.addImage`,
// com as dimensões naturais — necessárias pra decidir a orientação da
// página e encaixar a imagem sem distorcer (ver desenharPaginaMapa em
// controleTecnologicoPdf.ts).
export async function prepararImagemAnexo(blob: Blob, nomeArquivo: string): Promise<ImagemAnexo> {
  if (ehPdf(nomeArquivo)) {
    const pngBlob = await converterPdfParaImagem(blob)
    const dataUrl = await blobParaDataUrl(pngBlob)
    return normalizarImagemParaPng(await (await fetch(dataUrl)).blob())
  }
  return normalizarImagemParaPng(blob)
}
