import { useRef, useState } from 'react'
import type { ProducaoParede } from '../lib/supabase'
import styles from './PlantaClicavel.module.css'

export type ZonaDesenhada = { pos_x: number; pos_y: number; largura: number; altura_px: number }
export type SaldoParede = { alvenaria: number | null; rebocoA: number | null; rebocoB: number | null }

type Props = {
  imagemUrl: string
  paredes: ProducaoParede[]
  modo: 'desenhar' | 'selecionar'
  onDesenhar?: (zona: ZonaDesenhada) => void
  onSelecionar?: (parede: ProducaoParede) => void
  saldoPorParede?: Map<string, SaldoParede>
}

export default function PlantaClicavel({
  imagemUrl, paredes, modo, onDesenhar, onSelecionar, saldoPorParede,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [inicio, setInicio] = useState<{ x: number; y: number } | null>(null)
  const [atual, setAtual] = useState<{ x: number; y: number } | null>(null)

  function posicaoPercentual(evento: React.PointerEvent): { x: number; y: number } {
    const retangulo = containerRef.current!.getBoundingClientRect()
    return {
      x: ((evento.clientX - retangulo.left) / retangulo.width) * 100,
      y: ((evento.clientY - retangulo.top) / retangulo.height) * 100,
    }
  }

  function aoPressionar(evento: React.PointerEvent) {
    if (modo !== 'desenhar') return
    const ponto = posicaoPercentual(evento)
    setInicio(ponto)
    setAtual(ponto)
  }

  function aoMover(evento: React.PointerEvent) {
    if (modo !== 'desenhar' || !inicio) return
    setAtual(posicaoPercentual(evento))
  }

  function aoSoltar() {
    if (modo !== 'desenhar' || !inicio || !atual || !onDesenhar) {
      setInicio(null)
      setAtual(null)
      return
    }
    const zona: ZonaDesenhada = {
      pos_x: Math.min(inicio.x, atual.x),
      pos_y: Math.min(inicio.y, atual.y),
      largura: Math.abs(atual.x - inicio.x),
      altura_px: Math.abs(atual.y - inicio.y),
    }
    setInicio(null)
    setAtual(null)
    if (zona.largura > 0.5 && zona.altura_px > 0.5) onDesenhar(zona)
  }

  const zonaAtual = inicio && atual ? {
    left: `${Math.min(inicio.x, atual.x)}%`, top: `${Math.min(inicio.y, atual.y)}%`,
    width: `${Math.abs(atual.x - inicio.x)}%`, height: `${Math.abs(atual.y - inicio.y)}%`,
  } : null

  return (
    <div
      ref={containerRef}
      className={styles.container}
      onPointerDown={aoPressionar}
      onPointerMove={aoMover}
      onPointerUp={aoSoltar}
    >
      <img src={imagemUrl} alt="Planta" className={styles.imagem} draggable={false} />
      {paredes.map((parede) => {
        const saldo = saldoPorParede?.get(parede.id)
        const concluida = saldo != null
          && (parede.meta_alvenaria_m2 == null || (saldo.alvenaria !== null && saldo.alvenaria <= 0))
          && (parede.meta_reboco_a_m2 == null || (saldo.rebocoA !== null && saldo.rebocoA <= 0))
          && (parede.meta_reboco_b_m2 == null || (saldo.rebocoB !== null && saldo.rebocoB <= 0))
        return (
          <div
            key={parede.id}
            className={`${styles.faixa} ${concluida ? styles.faixaConcluida : ''}`}
            style={{
              left: `${parede.pos_x}%`, top: `${parede.pos_y}%`,
              width: `${parede.largura}%`, height: `${parede.altura_px}%`,
            }}
            onClick={() => modo === 'selecionar' && onSelecionar?.(parede)}
          >
            <span className={styles.rotulo}>{parede.nome}</span>
          </div>
        )
      })}
      {zonaAtual && <div className={styles.arrastando} style={zonaAtual} />}
    </div>
  )
}