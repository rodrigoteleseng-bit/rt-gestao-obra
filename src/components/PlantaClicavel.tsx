import { useRef, useState } from 'react'
import type { ProducaoParede } from '../lib/supabase'
import styles from './PlantaClicavel.module.css'

export type ZonaDesenhada = { pos_x: number; pos_y: number; largura: number; altura_px: number }
export type SaldoParede = { alvenaria: number | null; rebocoA: number | null; rebocoB: number | null }
export type RotuloAjustado = { pos_x: number; pos_y: number; rotacao: number }

type Props = {
  imagemUrl: string
  paredes: ProducaoParede[]
  modo: 'desenhar' | 'selecionar'
  onDesenhar?: (zona: ZonaDesenhada) => void
  onSelecionar?: (parede: ProducaoParede) => void
  onMoverRotulo?: (paredeId: string, dados: RotuloAjustado) => void
  saldoPorParede?: Map<string, SaldoParede>
}

const LEVANTA_ROTULO_PADRAO = 3

function rotuloPadrao(parede: ProducaoParede): RotuloAjustado {
  return {
    pos_x: parede.rotulo_pos_x ?? parede.pos_x,
    pos_y: parede.rotulo_pos_y ?? Math.max(0, parede.pos_y - LEVANTA_ROTULO_PADRAO),
    rotacao: parede.rotulo_rotacao,
  }
}

export default function PlantaClicavel({
  imagemUrl, paredes, modo, onDesenhar, onSelecionar, onMoverRotulo, saldoPorParede,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [inicio, setInicio] = useState<{ x: number; y: number } | null>(null)
  const [atual, setAtual] = useState<{ x: number; y: number } | null>(null)
  const [rotulosLocais, setRotulosLocais] = useState<Record<string, RotuloAjustado>>({})
  const [arrastandoRotulo, setArrastandoRotulo] = useState<string | null>(null)
  const [girandoRotulo, setGirandoRotulo] = useState<{ paredeId: string; centro: { x: number; y: number } } | null>(null)

  function posicaoPercentual(x: number, y: number): { x: number; y: number } {
    const retangulo = containerRef.current!.getBoundingClientRect()
    return {
      x: Math.min(100, Math.max(0, ((x - retangulo.left) / retangulo.width) * 100)),
      y: Math.min(100, Math.max(0, ((y - retangulo.top) / retangulo.height) * 100)),
    }
  }

  function rotuloAtual(parede: ProducaoParede): RotuloAjustado {
    return rotulosLocais[parede.id] ?? rotuloPadrao(parede)
  }

  function aoPressionar(evento: React.PointerEvent) {
    if (modo !== 'desenhar') return
    const ponto = posicaoPercentual(evento.clientX, evento.clientY)
    setInicio(ponto)
    setAtual(ponto)
  }

  function aoMover(evento: React.PointerEvent) {
    if (arrastandoRotulo) {
      setRotulosLocais((atual) => ({
        ...atual,
        [arrastandoRotulo]: { ...(atual[arrastandoRotulo] ?? rotuloAtual(paredes.find((p) => p.id === arrastandoRotulo)!)), ...posicaoPercentual(evento.clientX, evento.clientY) },
      }))
      return
    }
    if (girandoRotulo) {
      const { paredeId, centro } = girandoRotulo
      const angulo = Math.round((Math.atan2(evento.clientY - centro.y, evento.clientX - centro.x) * 180) / Math.PI)
      setRotulosLocais((atual) => ({
        ...atual,
        [paredeId]: { ...(atual[paredeId] ?? rotuloAtual(paredes.find((p) => p.id === paredeId)!)), rotacao: angulo },
      }))
      return
    }
    if (modo !== 'desenhar' || !inicio) return
    setAtual(posicaoPercentual(evento.clientX, evento.clientY))
  }

  function aoSoltar() {
    if (arrastandoRotulo) {
      const dados = rotulosLocais[arrastandoRotulo]
      if (dados) onMoverRotulo?.(arrastandoRotulo, dados)
      setArrastandoRotulo(null)
      return
    }
    if (girandoRotulo) {
      const dados = rotulosLocais[girandoRotulo.paredeId]
      if (dados) onMoverRotulo?.(girandoRotulo.paredeId, dados)
      setGirandoRotulo(null)
      return
    }
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

  function aoPressionarRotulo(evento: React.PointerEvent, paredeId: string) {
    if (modo !== 'desenhar' || !onMoverRotulo) return
    evento.stopPropagation()
    setArrastandoRotulo(paredeId)
  }

  function aoPressionarAlca(evento: React.PointerEvent, parede: ProducaoParede) {
    if (modo !== 'desenhar' || !onMoverRotulo) return
    evento.stopPropagation()
    const retangulo = (evento.currentTarget as HTMLElement).closest(`[data-rotulo-parede]`)!.getBoundingClientRect()
    setGirandoRotulo({
      paredeId: parede.id,
      centro: { x: retangulo.left + retangulo.width / 2, y: retangulo.top + retangulo.height / 2 },
    })
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
      onPointerLeave={aoSoltar}
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
          />
        )
      })}
      {paredes.map((parede) => {
        const rotulo = rotuloAtual(parede)
        const arrastavel = modo === 'desenhar' && !!onMoverRotulo
        return (
          <div
            key={`rotulo-${parede.id}`}
            data-rotulo-parede={parede.id}
            className={`${styles.rotulo} ${arrastavel ? styles.rotuloArrastavel : ''}`}
            style={{ left: `${rotulo.pos_x}%`, top: `${rotulo.pos_y}%`, transform: `rotate(${rotulo.rotacao}deg)` }}
            onPointerDown={(e) => aoPressionarRotulo(e, parede.id)}
          >
            {parede.nome}
            {arrastavel && (
              <span className={styles.alcaGirar} onPointerDown={(e) => aoPressionarAlca(e, parede)} />
            )}
          </div>
        )
      })}
      {zonaAtual && <div className={styles.arrastando} style={zonaAtual} />}
    </div>
  )
}
