import { useEffect, useRef, useState } from 'react'
import type { Unidade, Etapa, Servico } from '../lib/supabase'
import styles from './AplicacaoCascata.module.css'

interface AplicacaoCascataProps {
  unidades: Unidade[]
  etapas: Etapa[]
  servicos: Servico[]
  servicoId: string | null
  onSelecionar: (servicoId: string | null) => void
}

function rotuloEtapa(e: Etapa): string {
  return `${e.codigo ?? ''} ${e.nome}`.trim()
}

function rotuloServico(s: Servico): string {
  return `${s.codigo ?? ''} ${s.nome}`.trim()
}

export default function AplicacaoCascata({ unidades, etapas, servicos, servicoId, onSelecionar }: AplicacaoCascataProps) {
  const [unidadeId, setUnidadeId] = useState<string | null>(null)
  const [etapaId, setEtapaId] = useState<string | null>(null)
  const [textoUnidade, setTextoUnidade] = useState('')
  const [textoEtapa, setTextoEtapa] = useState('')
  const [textoServico, setTextoServico] = useState('')
  const [abertoUnidade, setAbertoUnidade] = useState(false)
  const [abertoEtapa, setAbertoEtapa] = useState(false)
  const [abertoServico, setAbertoServico] = useState(false)
  const inicializado = useRef(false)

  // Deriva a seleção inicial (Unidade/Etapa a partir do servico_id já salvo) só uma vez —
  // espera os dados carregarem se ainda não chegaram (evita apagar a digitação do usuário
  // depois que ele já começou a navegar na cascata).
  useEffect(() => {
    if (inicializado.current) return
    if (servicoId) {
      const s = servicos.find(sv => sv.id === servicoId)
      if (!s) return
      const e = etapas.find(et => et.id === s.etapa_id)
      const u = e ? unidades.find(un => un.id === e.unidade_id) : undefined
      inicializado.current = true
      setUnidadeId(u?.id ?? null)
      setEtapaId(e?.id ?? null)
      setTextoUnidade(u?.nome ?? '')
      setTextoEtapa(e ? rotuloEtapa(e) : '')
      setTextoServico(rotuloServico(s))
    } else {
      inicializado.current = true
    }
  }, [servicoId, servicos, etapas, unidades])

  function unidadesFiltradas(): Unidade[] {
    const t = textoUnidade.trim().toLowerCase()
    if (!t) return unidades
    return unidades.filter(u => u.nome.toLowerCase().includes(t))
  }

  function etapasFiltradas(): Etapa[] {
    if (!unidadeId) return []
    const daUnidade = etapas.filter(e => e.unidade_id === unidadeId)
    const t = textoEtapa.trim().toLowerCase()
    if (!t) return daUnidade
    return daUnidade.filter(e => e.nome.toLowerCase().includes(t) || (e.codigo ?? '').toLowerCase().includes(t))
  }

  function servicosFiltrados(): Servico[] {
    if (!etapaId) return []
    const daEtapa = servicos.filter(s => s.etapa_id === etapaId)
    const t = textoServico.trim().toLowerCase()
    if (!t) return daEtapa
    return daEtapa.filter(s => s.nome.toLowerCase().includes(t) || (s.codigo ?? '').toLowerCase().includes(t))
  }

  function mudarTextoUnidade(v: string) {
    setTextoUnidade(v)
    setAbertoUnidade(true)
    if (unidadeId !== null) {
      setUnidadeId(null)
      setEtapaId(null)
      setTextoEtapa('')
      setTextoServico('')
    }
    if (servicoId !== null) onSelecionar(null)
  }

  function selecionarUnidade(u: Unidade) {
    setUnidadeId(u.id)
    setTextoUnidade(u.nome)
    setAbertoUnidade(false)
    setEtapaId(null)
    setTextoEtapa('')
    setTextoServico('')
    if (servicoId !== null) onSelecionar(null)
  }

  function mudarTextoEtapa(v: string) {
    setTextoEtapa(v)
    setAbertoEtapa(true)
    if (etapaId !== null) {
      setEtapaId(null)
      setTextoServico('')
    }
    if (servicoId !== null) onSelecionar(null)
  }

  function selecionarEtapa(e: Etapa) {
    setEtapaId(e.id)
    setTextoEtapa(rotuloEtapa(e))
    setAbertoEtapa(false)
    setTextoServico('')
    if (servicoId !== null) onSelecionar(null)
  }

  function mudarTextoServico(v: string) {
    setTextoServico(v)
    setAbertoServico(true)
    if (servicoId !== null) onSelecionar(null)
  }

  function selecionarServico(s: Servico) {
    setTextoServico(rotuloServico(s))
    setAbertoServico(false)
    onSelecionar(s.id)
  }

  const servicoAtual = servicoId ? servicos.find(s => s.id === servicoId) : undefined
  const sugestoesUnidade = abertoUnidade ? unidadesFiltradas() : []
  const sugestoesEtapa = abertoEtapa ? etapasFiltradas() : []
  const sugestoesServico = abertoServico ? servicosFiltrados() : []

  return (
    <div className={styles.wrap}>
      Aplicação
      <div className={styles.nivel}>
        <div className={styles.autocompleteWrap}>
          <input
            value={textoUnidade}
            onChange={ev => mudarTextoUnidade(ev.target.value)}
            onFocus={() => setAbertoUnidade(true)}
            onBlur={() => setTimeout(() => setAbertoUnidade(false), 150)}
            placeholder="Unidade — Sobrado, Portaria, Área Comum…"
          />
          {sugestoesUnidade.length > 0 && (
            <div className={styles.sugestoes}>
              {sugestoesUnidade.map(u => (
                <button key={u.id} type="button" className={styles.sugestao} onMouseDown={() => selecionarUnidade(u)}>
                  {u.nome}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className={styles.nivel}>
        <div className={styles.autocompleteWrap}>
          <input
            value={textoEtapa}
            disabled={!unidadeId}
            onChange={ev => mudarTextoEtapa(ev.target.value)}
            onFocus={() => unidadeId && setAbertoEtapa(true)}
            onBlur={() => setTimeout(() => setAbertoEtapa(false), 150)}
            placeholder={unidadeId ? 'Etapa — Fundação, Alvenaria…' : 'Selecione a Unidade primeiro'}
          />
          {sugestoesEtapa.length > 0 && (
            <div className={styles.sugestoes}>
              {sugestoesEtapa.map(e => (
                <button key={e.id} type="button" className={styles.sugestao} onMouseDown={() => selecionarEtapa(e)}>
                  {e.codigo && <span className={styles.sugestaoCodigo}>{e.codigo}</span>}{e.nome}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className={styles.nivel}>
        <div className={styles.autocompleteWrap}>
          <input
            value={textoServico}
            disabled={!etapaId}
            onChange={ev => mudarTextoServico(ev.target.value)}
            onFocus={() => etapaId && setAbertoServico(true)}
            onBlur={() => setTimeout(() => setAbertoServico(false), 150)}
            placeholder={etapaId ? 'Serviço — ex.: chapisco' : 'Selecione a Etapa primeiro'}
          />
          {sugestoesServico.length > 0 && (
            <div className={styles.sugestoes}>
              {sugestoesServico.map(s => (
                <button key={s.id} type="button" className={styles.sugestao} onMouseDown={() => selecionarServico(s)}>
                  <span className={styles.sugestaoCodigo}>{s.codigo}</span>{s.nome}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      {servicoAtual
        ? <span className={styles.vinculoOk}>✓ {rotuloServico(servicoAtual)}</span>
        : <span className={styles.vinculoAusente}>⚠ sem vínculo — vai para "a classificar"</span>}
    </div>
  )
}
