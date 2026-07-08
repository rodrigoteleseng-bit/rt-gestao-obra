// Helpers do RDO: geolocalização, hash de integridade, carimbo de foto.

export interface Geo {
  lat: number | null
  lng: number | null
  precisao: number | null
}

// Posição atual do GPS; resolve com nulls se negado/indisponível (nunca inventa).
export function obterPosicao(timeoutMs = 8000): Promise<Geo> {
  return new Promise(resolve => {
    if (!('geolocation' in navigator)) return resolve({ lat: null, lng: null, precisao: null })
    navigator.geolocation.getCurrentPosition(
      p => resolve({
        lat: Math.round(p.coords.latitude * 1e7) / 1e7,
        lng: Math.round(p.coords.longitude * 1e7) / 1e7,
        precisao: Math.round(p.coords.accuracy * 10) / 10,
      }),
      () => resolve({ lat: null, lng: null, precisao: null }),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 30000 },
    )
  })
}

export async function sha256Hex(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer()
  const hash = await crypto.subtle.digest('SHA-256', buf)
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('')
}

export function fmtCoord(lat: number | null, lng: number | null, precisao: number | null): string {
  if (lat === null || lng === null) return 'sem GPS'
  return `${lat.toFixed(6)}, ${lng.toFixed(6)}${precisao !== null ? ` (±${precisao} m)` : ''}`
}

// Redimensiona a foto (máx. 1600 px) e queima o carimbo de segurança no
// rodapé: obra · data/hora da captura · coordenadas GPS (ou "sem GPS").
export async function carimbarFoto(
  arquivo: File,
  obraNome: string,
  geo: Geo,
  capturadaEm: Date,
): Promise<Blob> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(arquivo)
    const el = new Image()
    el.onload = () => { URL.revokeObjectURL(url); resolve(el) }
    el.onerror = reject
    el.src = url
  })

  const MAX = 1600
  const escala = Math.min(1, MAX / Math.max(img.width, img.height))
  const w = Math.round(img.width * escala)
  const h = Math.round(img.height * escala)

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(img, 0, 0, w, h)

  // Tarja do carimbo
  const fs = Math.max(13, Math.round(w * 0.021))
  const pad = Math.round(fs * 0.55)
  const linhas = [
    `${obraNome} — RT Engenharia`,
    `${capturadaEm.toLocaleDateString('pt-BR')} ${capturadaEm.toLocaleTimeString('pt-BR')} · ${fmtCoord(geo.lat, geo.lng, geo.precisao)}`,
  ]
  const alturaTarja = linhas.length * (fs * 1.35) + pad * 2
  ctx.fillStyle = 'rgba(15, 23, 42, 0.72)'
  ctx.fillRect(0, h - alturaTarja, w, alturaTarja)
  ctx.fillStyle = '#ffffff'
  ctx.font = `600 ${fs}px Inter, Arial, sans-serif`
  ctx.textBaseline = 'top'
  linhas.forEach((l, i) => {
    ctx.fillText(l, pad, h - alturaTarja + pad + i * fs * 1.35, w - pad * 2)
  })

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(b => b ? resolve(b) : reject(new Error('falha ao gerar imagem')), 'image/jpeg', 0.85)
  })
}

export function fmtDuracao(seg: number | null | undefined): string {
  if (seg === null || seg === undefined) return ''
  const s = Math.round(seg)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
