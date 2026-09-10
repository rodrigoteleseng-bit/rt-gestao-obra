import { useEffect, useRef, useState } from 'react'
import styles from './FerramentaPintura.module.css'

export type Espessura = 'fino' | 'medio' | 'grosso'
export type FerramentaAtiva = 'pincel' | 'borracha'

export interface CamadaTravada {
  id: string
  url: string
}

interface Props {
  imagemPlantaUrl: string
  camadasTravadas: CamadaTravada[]
  corAtual: string
  pinturaExistenteUrl: string | null
  onSalvar: (blob: Blob) => void
  onCancelar: () => void
  salvando: boolean
}

interface EstadoPinch {
  distancia: number
  zoom: number
  contentX: number
  contentY: number
}

const ZOOM_MIN = 1
const ZOOM_MAX = 6

function larguraPincel(espessura: Espessura, canvasWidth: number): number {
  const fracao = espessura === 'fino' ? 0.003 : espessura === 'medio' ? 0.008 : 0.015
  return canvasWidth * fracao
}

export default function FerramentaPintura({
  imagemPlantaUrl, camadasTravadas, corAtual, pinturaExistenteUrl, onSalvar, onCancelar, salvando,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const [dimensoes, setDimensoes] = useState<{ largura: number; altura: number } | null>(null)
  const [pronto, setPronto] = useState(false)
  const [ferramenta, setFerramenta] = useState<FerramentaAtiva>('pincel')
  const [espessura, setEspessura] = useState<Espessura>('medio')
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })

  const pointersAtivos = useRef(new Map<number, { x: number; y: number }>())
  const desenhando = useRef(false)
  const ultimoPonto = useRef<{ x: number; y: number } | null>(null)
  const pinchInicioRef = useRef<EstadoPinch | null>(null)
  const zoomRef = useRef(zoom)
  const panRef = useRef(pan)
  zoomRef.current = zoom
  panRef.current = pan

  // Mede a imagem da planta separado do <img> visível — evita depender de
  // onLoad num elemento que só existe depois que as dimensões já são conhecidas.
  useEffect(() => {
    let cancelado = false
    const img = new Image()
    img.onload = () => { if (!cancelado) setDimensoes({ largura: img.naturalWidth, altura: img.naturalHeight }) }
    img.src = imagemPlantaUrl
    return () => { cancelado = true }
  }, [imagemPlantaUrl])

  // Dimensiona o canvas assim que a planta é medida — só reage a `dimensoes`
  // para não apagar o canvas (canvas.width/height sempre limpa o desenho) se
  // pinturaExistenteUrl mudar sozinha num componente já montado (ex.: signed
  // URL reemitida apontando pro mesmo arquivo).
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !dimensoes) return
    canvas.width = dimensoes.largura
    canvas.height = dimensoes.altura
  }, [dimensoes])

  // Uma vez que o canvas existe com o tamanho certo, pré-carrega a pintura
  // existente (modo "corrigir") antes de liberar novos traços.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !dimensoes) return
    setPronto(false)
    if (!pinturaExistenteUrl) { setPronto(true); return }
    let cancelado = false
    const img = new Image()
    img.onload = () => {
      if (cancelado) return
      const ctx = canvas.getContext('2d')
      ctx?.drawImage(img, 0, 0, canvas.width, canvas.height)
      setPronto(true)
    }
    img.src = pinturaExistenteUrl
    return () => { cancelado = true }
  }, [dimensoes, pinturaExistenteUrl])

  function paraCoordenadaCanvas(clientX: number, clientY: number): { x: number; y: number } {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    return {
      x: ((clientX - rect.left) / rect.width) * canvas.width,
      y: ((clientY - rect.top) / rect.height) * canvas.height,
    }
  }

  function desenharLinha(de: { x: number; y: number }, para: { x: number; y: number }) {
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')!
    ctx.globalCompositeOperation = ferramenta === 'borracha' ? 'destination-out' : 'source-over'
    ctx.strokeStyle = corAtual
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.lineWidth = larguraPincel(espessura, canvas.width)
    ctx.beginPath()
    ctx.moveTo(de.x, de.y)
    ctx.lineTo(para.x, para.y)
    ctx.stroke()
  }

  function aoPressionar(e: React.PointerEvent) {
    if (!pronto) return
    canvasRef.current?.setPointerCapture(e.pointerId)
    pointersAtivos.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

    if (pointersAtivos.current.size === 2) {
      desenhando.current = false
      ultimoPonto.current = null
      const pontos = [...pointersAtivos.current.values()]
      const rect = containerRef.current!.getBoundingClientRect()
      const midX = (pontos[0].x + pontos[1].x) / 2 - rect.left
      const midY = (pontos[0].y + pontos[1].y) / 2 - rect.top
      pinchInicioRef.current = {
        distancia: Math.hypot(pontos[1].x - pontos[0].x, pontos[1].y - pontos[0].y),
        zoom: zoomRef.current,
        contentX: (midX - panRef.current.x) / zoomRef.current,
        contentY: (midY - panRef.current.y) / zoomRef.current,
      }
    } else if (pointersAtivos.current.size === 1) {
      desenhando.current = true
      const p = paraCoordenadaCanvas(e.clientX, e.clientY)
      ultimoPonto.current = p
      desenharLinha(p, p) // deixa um ponto mesmo sem arrastar
    }
  }

  function aoMover(e: React.PointerEvent) {
    if (!pronto) return
    if (!pointersAtivos.current.has(e.pointerId)) return
    pointersAtivos.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

    if (pointersAtivos.current.size === 2 && pinchInicioRef.current) {
      const pontos = [...pointersAtivos.current.values()]
      const distAtual = Math.hypot(pontos[1].x - pontos[0].x, pontos[1].y - pontos[0].y)
      const rect = containerRef.current!.getBoundingClientRect()
      const midX = (pontos[0].x + pontos[1].x) / 2 - rect.left
      const midY = (pontos[0].y + pontos[1].y) / 2 - rect.top
      const { distancia, zoom: zoomInicial, contentX, contentY } = pinchInicioRef.current
      const novoZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoomInicial * (distAtual / distancia)))
      setZoom(novoZoom)
      setPan({ x: midX - contentX * novoZoom, y: midY - contentY * novoZoom })
      return
    }
    if (pointersAtivos.current.size === 1 && desenhando.current && ultimoPonto.current) {
      const p = paraCoordenadaCanvas(e.clientX, e.clientY)
      desenharLinha(ultimoPonto.current, p)
      ultimoPonto.current = p
    }
  }

  function aoSoltar(e: React.PointerEvent) {
    pointersAtivos.current.delete(e.pointerId)
    desenhando.current = false
    ultimoPonto.current = null
    pinchInicioRef.current = null
  }

  function aplicarZoomBotao(delta: number) {
    const novoZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom + delta))
    const rect = containerRef.current!.getBoundingClientRect()
    const midX = rect.width / 2
    const midY = rect.height / 2
    const contentX = (midX - pan.x) / zoom
    const contentY = (midY - pan.y) / zoom
    setZoom(novoZoom)
    setPan({ x: midX - contentX * novoZoom, y: midY - contentY * novoZoom })
  }

  function salvar() {
    canvasRef.current!.toBlob(blob => { if (blob) onSalvar(blob) }, 'image/png')
  }

  return (
    <div className={styles.overlay}>
      <div className={styles.barraFerramentas}>
        <button className={ferramenta === 'pincel' ? styles.btnAtivo : styles.btn} onClick={() => setFerramenta('pincel')}>🖌️ Pincel</button>
        <button className={ferramenta === 'borracha' ? styles.btnAtivo : styles.btn} onClick={() => setFerramenta('borracha')}>🧼 Borracha</button>
        <select className={styles.selectEspessura} value={espessura} onChange={e => setEspessura(e.target.value as Espessura)}>
          <option value="fino">Fino</option>
          <option value="medio">Médio</option>
          <option value="grosso">Grosso</option>
        </select>
        <button className={styles.btn} onClick={() => aplicarZoomBotao(-0.5)} aria-label="Diminuir zoom">−</button>
        <button className={styles.btn} onClick={() => aplicarZoomBotao(0.5)} aria-label="Aumentar zoom">+</button>
      </div>

      <div
        ref={containerRef}
        className={styles.viewport}
        onPointerDown={aoPressionar}
        onPointerMove={aoMover}
        onPointerUp={aoSoltar}
        onPointerCancel={aoSoltar}
      >
        {!dimensoes && <p className={styles.carregando}>Carregando planta…</p>}
        {dimensoes && (
          <div
            className={styles.conteudo}
            style={{
              width: dimensoes.largura, height: dimensoes.altura,
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            }}
          >
            <img src={imagemPlantaUrl} alt="Planta" className={styles.imagemPlanta} draggable={false} />
            {camadasTravadas.map(c => (
              <img key={c.id} src={c.url} alt="" className={styles.camadaTravada} draggable={false} />
            ))}
            <canvas ref={canvasRef} className={styles.canvasAtivo} />
          </div>
        )}
      </div>

      <div className={styles.barraAcoes}>
        <button className={styles.btnCancelar} onClick={onCancelar} disabled={salvando}>Cancelar</button>
        <button className={styles.btnSalvar} onClick={salvar} disabled={salvando || !pronto}>
          {salvando ? 'Salvando…' : 'Salvar pintura'}
        </button>
      </div>
    </div>
  )
}
