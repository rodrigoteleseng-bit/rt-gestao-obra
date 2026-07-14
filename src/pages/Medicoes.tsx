import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useObra } from '../contexts/ObraContext'
import { supabase, type StatusMedicao } from '../lib/supabase'
import { STATUS_MEDICAO_LABEL } from './MedicaoForm'
import styles from './Medicoes.module.css'

interface MedicaoLista {
  id: string
  numero: number
  status: StatusMedicao
  valor_liquido: number
  contrato_id: string
  contratos: { numero: string; empreiteiros: { nome: string } | null } | null
}

export default function Medicoes() {
  const { perfil } = useAuth()
  const { obraAtiva } = useObra()
  const navigate = useNavigate()

  const [medicoes, setMedicoes] = useState<MedicaoLista[]>([])
  const [carregando, setCarregando] = useState(true)
  const [filtroStatus, setFiltroStatus] = useState<StatusMedicao | ''>('')

  useEffect(() => {
    if (!obraAtiva) return
    setCarregando(true)
    supabase.from('medicoes')
      .select('id, numero, status, valor_liquido, contrato_id, contratos!inner(numero, obra_id, empreiteiros(nome))')
      .eq('ativo', true)
      .eq('contratos.obra_id', obraAtiva.id)
      .order('criado_em', { ascending: false })
      .then(({ data }) => {
        setMedicoes((data ?? []) as unknown as MedicaoLista[])
        setCarregando(false)
      })
  }, [obraAtiva])

  const filtradas = useMemo(() => medicoes.filter(m => !filtroStatus || m.status === filtroStatus), [medicoes, filtroStatus])

  if (perfil?.papel === 'cliente') {
    return <div className={styles.page}><p className={styles.vazio}>Módulo de uso interno da equipe.</p></div>
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1>Medições</h1>
          <p className={styles.sub}>Medições de todos os contratos com empreiteiros.</p>
        </div>
      </div>

      <div className={styles.filtros}>
        <select className={styles.selectFiltro} value={filtroStatus}
          onChange={e => setFiltroStatus(e.target.value as StatusMedicao | '')}>
          <option value="">Todos os status</option>
          <option value="rascunho">Rascunho</option>
          <option value="aprovada">Aprovada</option>
        </select>
      </div>

      {carregando && <p className={styles.vazio}>Carregando…</p>}
      {!carregando && filtradas.length === 0 && (
        <p className={styles.vazio}>{medicoes.length === 0 ? 'Nenhuma medição registrada.' : 'Nenhuma medição com esse filtro.'}</p>
      )}

      {filtradas.map(m => (
        <button key={m.id} className={styles.card} onClick={() => navigate(`/contratos/${m.contrato_id}/medicoes/${m.id}`)}>
          <div className={styles.cardTopo}>
            <span className={styles.cardNumero}>{m.contratos?.numero} — {m.numero}ª medição</span>
            <span className={`${styles.chip} ${styles[`chip_${m.status}`]}`}>{STATUS_MEDICAO_LABEL[m.status]}</span>
          </div>
          <div className={styles.cardDesc}>{m.contratos?.empreiteiros?.nome ?? '—'}</div>
          <div className={styles.cardRodape}>
            <span>R$ {m.valor_liquido.toFixed(2)}</span>
          </div>
        </button>
      ))}
    </div>
  )
}
