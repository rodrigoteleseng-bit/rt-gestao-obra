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

interface EstadoPan {
  panX: number
  panY: number
  pointerX: number
  pointerY: number
}

// Opacidade do pincel — deixa o croqui visível por baixo da cor enquanto
// pinta. Ajustado pro Rodrigo de 50% pra 25% (mais claro ainda) depois do
// primeiro teste real. A borracha continua em opacidade 1 (apaga de
// verdade, não só "clareia").
const OPACIDADE_PINCEL = 0.25

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
  const [modo, setModo] = useState<'desenhar' | 'mover'>('desenhar')
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })

  const pointersAtivos = useRef(new Map<number, { x: number; y: number }>())
  const desenhando = useRef(false)
  const ultimoPonto = useRef<{ x: number; y: number } | null>(null)
  const pinchInicioRef = useRef<EstadoPinch | null>(null)
  const panInicioRef = useRef<EstadoPan | null>(null)
  const zoomRef = useRef(zoom)
  const panRef = useRef(pan)
  zoomRef.current = zoom
  panRef.current = pan

  // Limites de zoom são dinâmicos: ZOOM_MIN é a escala que encaixa a planta
  // inteira na janela (calculada quando a imagem carrega, ver efeito abaixo)
  // — nunca um valor fixo, já que a resolução da planta varia muito (PDF
  // renderizado em escala 2 costuma ser bem maior que a tela).
  const zoomLimitesRef = useRef({ min: 1, max: 6 })

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
  //
  // No mesmo passo, calcula o zoom que encaixa a planta inteira na janela
  // (nunca abre já cortada) e centraliza — o zoom mínimo passa a ser esse
  // encaixe, não mais um valor fixo, e o zoom máximo é 8x a partir dele.
  useEffect(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container || !dimensoes) return
    canvas.width = dimensoes.largura
    canvas.height = dimensoes.altura

    const rect = container.getBoundingClientRect()
    const escalaEncaixe = Math.min(rect.width / dimensoes.largura, rect.height / dimensoes.altura)
    zoomLimitesRef.current = { min: escalaEncaixe, max: escalaEncaixe * 8 }
    setZoom(escalaEncaixe)
    setPan({
      x: (rect.width - dimensoes.largura * escalaEncaixe) / 2,
      y: (rect.height - dimensoes.altura * escalaEncaixe) / 2,
    })
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
    // Sem isso, desenhar essa imagem (de outro domínio — URL assinada do
    // Supabase Storage) no canvas "contamina" o canvas: os traços continuam
    // funcionando normalmente, mas toBlob() (usado em salvar()) passa a
    // devolver null silenciosamente, sem erro nenhum — exatamente o "clico
    // em Salvar e não acontece nada" só ao reabrir uma pintura existente,
    // já que é o único caminho que desenha uma imagem externa no canvas.
    img.crossOrigin = 'anonymous'
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
    ctx.globalAlpha = ferramenta === 'borracha' ? 1 : OPACIDADE_PINCEL
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
    canvasRef.current?.setPointerCapture(e.pointerId)
    pointersAtivos.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

    if (pointersAtivos.current.size === 2) {
      desenhando.current = false
      ultimoPonto.current = null
      panInicioRef.current = null
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
      if (modo === 'mover') {
        panInicioRef.current = {
          panX: panRef.current.x, panY: panRef.current.y,
          pointerX: e.clientX, pointerY: e.clientY,
        }
        return
      }
      if (!pronto) return
      desenhando.current = true
      const p = paraCoordenadaCanvas(e.clientX, e.clientY)
      ultimoPonto.current = p
      desenharLinha(p, p) // deixa um ponto mesmo sem arrastar
    }
  }

  function aoMover(e: React.PointerEvent) {
    if (!pointersAtivos.current.has(e.pointerId)) return
    pointersAtivos.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

    if (pointersAtivos.current.size === 2 && pinchInicioRef.current) {
      const pontos = [...pointersAtivos.current.values()]
      const distAtual = Math.hypot(pontos[1].x - pontos[0].x, pontos[1].y - pontos[0].y)
      const rect = containerRef.current!.getBoundingClientRect()
      const midX = (pontos[0].x + pontos[1].x) / 2 - rect.left
      const midY = (pontos[0].y + pontos[1].y) / 2 - rect.top
      const { distancia, zoom: zoomInicial, contentX, contentY } = pinchInicioRef.current
      const { min, max } = zoomLimitesRef.current
      const novoZoom = Math.min(max, Math.max(min, zoomInicial * (distAtual / distancia)))
      setZoom(novoZoom)
      setPan({ x: midX - contentX * novoZoom, y: midY - contentY * novoZoom })
      return
    }
    if (pointersAtivos.current.size === 1 && panInicioRef.current) {
      const { panX, panY, pointerX, pointerY } = panInicioRef.current
      setPan({ x: panX + (e.clientX - pointerX), y: panY + (e.clientY - pointerY) })
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
    panInicioRef.current = null
  }

  // Multiplicativo (não aditivo): o intervalo de zoom agora é dinâmico
  // (calculado a partir do encaixe da planta), então um passo fixo em valor
  // absoluto ficaria grande demais numa planta pequena e pequeno demais
  // numa grande — uma porcentagem do zoom atual funciona nos dois casos.
  function aplicarZoomBotao(fator: number) {
    const { min, max } = zoomLimitesRef.current
    const novoZoom = Math.min(max, Math.max(min, zoom * fator))
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
        <button className={modo === 'desenhar' && ferramenta === 'pincel' ? styles.btnAtivo : styles.btn} onClick={() => { setModo('desenhar'); setFerramenta('pincel') }}>🖌️ Pincel</button>
        <button className={modo === 'desenhar' && ferramenta === 'borracha' ? styles.btnAtivo : styles.btn} onClick={() => { setModo('desenhar'); setFerramenta('borracha') }}>🧼 Borracha</button>
        <select className={styles.selectEspessura} value={espessura} onChange={e => setEspessura(e.target.value as Espessura)}>
          <option value="fino">Fino</option>
          <option value="medio">Médio</option>
          <option value="grosso">Grosso</option>
        </select>
        <button className={modo === 'mover' ? styles.btnAtivo : styles.btn} onClick={() => setModo(m => m === 'mover' ? 'desenhar' : 'mover')}>✋ Mover</button>
        <button className={styles.btn} onClick={() => aplicarZoomBotao(0.8)} aria-label="Diminuir zoom">−</button>
        <button className={styles.btn} onClick={() => aplicarZoomBotao(1.25)} aria-label="Aumentar zoom">+</button>
      </div>

      <div
        ref={containerRef}
        className={
          modo === 'mover' ? `${styles.viewport} ${styles.viewportMover}`
          : ferramenta === 'borracha' ? `${styles.viewport} ${styles.viewportBorracha}`
          : styles.viewport
        }
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
