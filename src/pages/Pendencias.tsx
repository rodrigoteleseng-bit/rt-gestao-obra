import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useObra } from '../contexts/ObraContext'
import { supabase, type Pendencia, type Unidade, type StatusPendencia } from '../lib/supabase'
import { hojeISO } from '../lib/cronograma'
import styles from './Pendencias.module.css'

const fmtData = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`

export const STATUS_LABEL: Record<StatusPendencia, string> = {
  aberta: 'Aberta',
  em_correcao: 'Em correção',
  resolvida: 'Resolvida',
}

export default function Pendencias() {
  const { perfil, temModulo } = useAuth()
  const { obraAtiva } = useObra()
  const navigate = useNavigate()
  const podeEditar = perfil?.papel === 'admin' || temModulo('pendencias')

  const [pendencias, setPendencias] = useState<Pendencia[]>([])
  const [unidades, setUnidades] = useState<Unidade[]>([])
  const [carregando, setCarregando] = useState(true)
  const [filtroUnidade, setFiltroUnidade] = useState('')
  const [filtroStatus, setFiltroStatus] = useState<StatusPendencia | ''>('')

  useEffect(() => {
    if (!obraAtiva) return
    setCarregando(true)
    Promise.all([
      supabase.from('pendencias').select('*').eq('obra_id', obraAtiva.id).eq('ativo', true),
      supabase.from('unidades').select('*').eq('obra_id', obraAtiva.id).order('ordem'),
    ]).then(([p, u]) => {
      setPendencias(p.data ?? [])
      setUnidades(u.data ?? [])
      setCarregando(false)
    })
  }, [obraAtiva])

  const hoje = hojeISO()
  const nomeUnidade = useMemo(() => new Map(unidades.map(u => [u.id, u.nome])), [unidades])

  function vencida(p: Pendencia): boolean {
    return p.status !== 'resolvida' && p.prazo !== null && p.prazo < hoje
  }

  function diasVencida(p: Pendencia): number {
    if (!p.prazo) return 0
    return Math.round((new Date(hoje).getTime() - new Date(p.prazo).getTime()) / 86400000)
  }

  const filtradas = useMemo(() => {
    const lista = pendencias.filter(p =>
      (!filtroUnidade || p.unidade_id === filtroUnidade) &&
      (!filtroStatus || p.status === filtroStatus)
    )
    // vencidas primeiro, depois por prazo mais próximo, depois mais recentes
    return lista.sort((a, b) => {
      const va = vencida(a) ? 1 : 0
      const vb = vencida(b) ? 1 : 0
      if (va !== vb) return vb - va
      if (a.prazo && b.prazo && a.prazo !== b.prazo) return a.prazo.localeCompare(b.prazo)
      if (a.prazo && !b.prazo) return -1
      if (!a.prazo && b.prazo) return 1
      return b.criado_em.localeCompare(a.criado_em)
    })
  }, [pendencias, filtroUnidade, filtroStatus, hoje])

  const contagem = useMemo(() => ({
    aberta: pendencias.filter(p => p.status === 'aberta').length,
    em_correcao: pendencias.filter(p => p.status === 'em_correcao').length,
    resolvida: pendencias.filter(p => p.status === 'resolvida').length,
  }), [pendencias])

  if (perfil?.papel === 'cliente') {
    return (
      <div className={styles.page}>
        <h1>Pendências</h1>
        <p className={styles.vazio}>Este módulo é de uso interno da equipe de obra.</p>
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1>Pendências</h1>
          <p className={styles.sub}>Problemas de qualidade por unidade — quem resolve, até quando, com fotos.</p>
        </div>
        {podeEditar && (
          <button className={styles.btnNova} onClick={() => navigate('/pendencias/nova')}>
            + Nova pendência
          </button>
        )}
      </div>

      <div className={styles.contadores}>
        {(['aberta', 'em_correcao', 'resolvida'] as StatusPendencia[]).map(s => (
          <button
            key={s}
            className={`${styles.contador} ${styles[`cont_${s}`]} ${filtroStatus === s ? styles.contAtivo : ''}`}
            onClick={() => setFiltroStatus(filtroStatus === s ? '' : s)}
          >
            <span className={styles.contNum}>{contagem[s]}</span>
            <span className={styles.contLabel}>{STATUS_LABEL[s]}{contagem[s] !== 1 && s !== 'em_correcao' ? 's' : ''}</span>
          </button>
        ))}
      </div>

      <div className={styles.filtros}>
        <select value={filtroUnidade} onChange={e => setFiltroUnidade(e.target.value)} className={styles.selectFiltro}>
          <option value="">Todas as unidades</option>
          {unidades.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}
        </select>
      </div>

      {carregando && <p className={styles.vazio}>Carregando…</p>}
      {!carregando && filtradas.length === 0 && (
        <p className={styles.vazio}>
          {pendencias.length === 0 ? 'Nenhuma pendência registrada.' : 'Nenhuma pendência com esses filtros.'}
        </p>
      )}

      {filtradas.map(p => (
        <button key={p.id} className={`${styles.card} ${vencida(p) ? styles.cardVencida : ''}`}
          onClick={() => navigate(`/pendencias/${p.id}`)}>
          <div className={styles.cardTopo}>
            <span className={styles.cardUnidade}>{nomeUnidade.get(p.unidade_id) ?? '?'}</span>
            <span className={`${styles.chip} ${styles[`chip_${p.status}`]}`}>{STATUS_LABEL[p.status]}</span>
          </div>
          <div className={styles.cardDesc}>{p.descricao}</div>
          <div className={styles.cardRodape}>
            {p.responsavel && <span>👤 {p.responsavel}</span>}
            {p.prazo && (
              <span className={vencida(p) ? styles.prazoVencido : ''}>
                📅 {fmtData(p.prazo)}{vencida(p) && ` — vencida há ${diasVencida(p)} dia${diasVencida(p) !== 1 ? 's' : ''}`}
              </span>
            )}
          </div>
        </button>
      ))}
    </div>
  )
}
