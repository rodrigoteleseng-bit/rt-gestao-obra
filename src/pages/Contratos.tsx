import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useObra } from '../contexts/ObraContext'
import { supabase, type Contrato, type Empreiteiro, type StatusContrato } from '../lib/supabase'
import { formatarMoeda } from '../lib/formato'
import styles from './Contratos.module.css'

export const STATUS_LABEL: Record<StatusContrato, string> = {
  rascunho: 'Rascunho',
  ativo: 'Ativo',
  encerrado: 'Encerrado',
}

export default function Contratos() {
  const { perfil, temModulo } = useAuth()
  const { obraAtiva } = useObra()
  const navigate = useNavigate()
  const podeEditar = perfil?.papel === 'admin' || temModulo('contratos')

  const [contratos, setContratos] = useState<Contrato[]>([])
  const [empreiteiros, setEmpreiteiros] = useState<Empreiteiro[]>([])
  const [carregando, setCarregando] = useState(true)
  const [filtroStatus, setFiltroStatus] = useState<StatusContrato | ''>('')
  const [filtroEmpreiteiro, setFiltroEmpreiteiro] = useState('')

  useEffect(() => {
    if (!obraAtiva) return
    setCarregando(true)
    Promise.all([
      supabase.from('contratos').select('*').eq('obra_id', obraAtiva.id).eq('ativo', true)
        .order('numero', { ascending: false }),
      supabase.from('empreiteiros').select('*').eq('ativo', true).order('nome'),
    ]).then(([c, e]) => {
      setContratos(c.data ?? [])
      setEmpreiteiros(e.data ?? [])
      setCarregando(false)
    })
  }, [obraAtiva])

  const nomeEmpreiteiro = useMemo(() => new Map(empreiteiros.map(e => [e.id, e.nome])), [empreiteiros])

  const filtrados = useMemo(() => {
    return contratos.filter(c =>
      (!filtroStatus || c.status === filtroStatus) &&
      (!filtroEmpreiteiro || c.empreiteiro_id === filtroEmpreiteiro)
    )
  }, [contratos, filtroStatus, filtroEmpreiteiro])

  if (perfil?.papel === 'cliente') {
    return <div className={styles.page}><p className={styles.vazio}>Módulo de uso interno da equipe.</p></div>
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1>Contratos</h1>
          <p className={styles.sub}>Contratos com empreiteiros por serviço — base para as Medições.</p>
        </div>
        <div className={styles.acoesHeader}>
          <button className={styles.btnSecundario} onClick={() => navigate('/empreiteiros')}>Empreiteiros</button>
          {podeEditar && (
            <button className={styles.btnNova} onClick={() => navigate('/contratos/novo')}>+ Novo contrato</button>
          )}
        </div>
      </div>

      <div className={styles.filtros}>
        <select className={styles.selectFiltro} value={filtroStatus}
          onChange={e => setFiltroStatus(e.target.value as StatusContrato | '')}>
          <option value="">Todos os status</option>
          {(Object.keys(STATUS_LABEL) as StatusContrato[]).map(s => (
            <option key={s} value={s}>{STATUS_LABEL[s]}</option>
          ))}
        </select>
        <select className={styles.selectFiltro} value={filtroEmpreiteiro}
          onChange={e => setFiltroEmpreiteiro(e.target.value)}>
          <option value="">Todos os empreiteiros</option>
          {empreiteiros.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}
        </select>
      </div>

      {carregando && <p className={styles.vazio}>Carregando…</p>}
      {!carregando && filtrados.length === 0 && (
        <p className={styles.vazio}>{contratos.length === 0 ? 'Nenhum contrato registrado.' : 'Nenhum contrato com esses filtros.'}</p>
      )}

      {filtrados.map(c => (
        <button key={c.id} className={styles.card} onClick={() => navigate(`/contratos/${c.id}`)}>
          <div className={styles.cardTopo}>
            <span className={styles.cardNumero}>{c.numero}</span>
            <span className={`${styles.chip} ${styles[`chip_${c.status}`]}`}>{STATUS_LABEL[c.status]}</span>
          </div>
          <div className={styles.cardDesc}>{nomeEmpreiteiro.get(c.empreiteiro_id) ?? '—'} — {c.objeto}</div>
          <div className={styles.cardRodape}>
            <span>R$ {formatarMoeda(c.valor_total)}</span>
          </div>
        </button>
      ))}
    </div>
  )
}
