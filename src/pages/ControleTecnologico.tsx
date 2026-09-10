import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useObra } from '../contexts/ObraContext'
import { supabase, type CtConcretagem, type StatusConcretagem, type Unidade } from '../lib/supabase'
import styles from './ControleTecnologico.module.css'

export const STATUS_CONCRETAGEM_LABEL: Record<StatusConcretagem, string> = {
  aberta: 'Aberta',
  finalizada: 'Finalizada',
}

function fmtData(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`
}

export default function ControleTecnologico() {
  const { perfil, temModulo } = useAuth()
  const { obraAtiva } = useObra()
  const navigate = useNavigate()
  const podeEditar = perfil?.papel === 'admin' || temModulo('controle_tecnologico')

  const [concretagens, setConcretagens] = useState<CtConcretagem[]>([])
  const [unidades, setUnidades] = useState<Unidade[]>([])
  const [carregando, setCarregando] = useState(true)
  const [filtroStatus, setFiltroStatus] = useState<StatusConcretagem | ''>('')

  useEffect(() => {
    if (!obraAtiva) return
    setCarregando(true)
    Promise.all([
      supabase.from('ct_concretagens').select('*').eq('obra_id', obraAtiva.id).eq('ativo', true)
        .order('data', { ascending: false }),
      supabase.from('unidades').select('*').eq('obra_id', obraAtiva.id).order('ordem'),
    ]).then(([c, u]) => {
      setConcretagens(c.data ?? [])
      setUnidades(u.data ?? [])
      setCarregando(false)
    })
  }, [obraAtiva])

  const nomeUnidade = useMemo(() => new Map(unidades.map(u => [u.id, u.nome])), [unidades])

  const filtradas = useMemo(() => {
    return concretagens.filter(c => !filtroStatus || c.status === filtroStatus)
  }, [concretagens, filtroStatus])

  if (perfil?.papel === 'cliente') {
    return <div className={styles.page}><p className={styles.vazio}>Módulo de uso interno da equipe.</p></div>
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1>Controle Tecnológico</h1>
          <p className={styles.sub}>Concreto usinado — caminhões, amostras e laudos de ruptura.</p>
        </div>
        {podeEditar && (
          <div className={styles.acoesHeader}>
            <button className={styles.btnSecundario} onClick={() => navigate('/controle-tecnologico/plantas')}>🗂️ Plantas</button>
            <button className={styles.btnNova} onClick={() => navigate('/controle-tecnologico/nova')}>+ Nova concretagem</button>
          </div>
        )}
      </div>

      <div className={styles.filtros}>
        <select className={styles.selectFiltro} value={filtroStatus}
          onChange={e => setFiltroStatus(e.target.value as StatusConcretagem | '')}>
          <option value="">Todos os status</option>
          {(Object.keys(STATUS_CONCRETAGEM_LABEL) as StatusConcretagem[]).map(s => (
            <option key={s} value={s}>{STATUS_CONCRETAGEM_LABEL[s]}</option>
          ))}
        </select>
      </div>

      {carregando && <p className={styles.vazio}>Carregando…</p>}
      {!carregando && filtradas.length === 0 && (
        <p className={styles.vazio}>{concretagens.length === 0 ? 'Nenhuma concretagem registrada.' : 'Nenhuma concretagem com esse filtro.'}</p>
      )}

      {filtradas.map(c => (
        <button key={c.id} className={styles.card} onClick={() => navigate(`/controle-tecnologico/${c.id}`)}>
          <div className={styles.cardTopo}>
            <span className={styles.cardData}>{fmtData(c.data)}</span>
            <span className={`${styles.chip} ${styles[`chip_${c.status}`]}`}>{STATUS_CONCRETAGEM_LABEL[c.status]}</span>
          </div>
          <div className={styles.cardDesc}>{nomeUnidade.get(c.unidade_id) ?? '—'}</div>
        </button>
      ))}
    </div>
  )
}
