import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useObra } from '../contexts/ObraContext'
import { supabase, type Rdo } from '../lib/supabase'
import { hojeISO } from '../lib/cronograma'
import styles from './RDO.module.css'

const fmtData = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`

export default function RDO() {
  const { perfil, temModulo } = useAuth()
  const { obraAtiva } = useObra()
  const navigate = useNavigate()
  const podeEditar = perfil?.papel === 'admin' || temModulo('rdo')

  const [rdos, setRdos] = useState<Rdo[]>([])
  const [carregando, setCarregando] = useState(true)
  const [criando, setCriando] = useState(false)
  const [erro, setErro] = useState('')

  useEffect(() => {
    if (!obraAtiva) return
    setCarregando(true)
    supabase.from('rdos').select('*').eq('obra_id', obraAtiva.id).eq('ativo', true)
      .order('data', { ascending: false })
      .then(({ data }) => { setRdos(data ?? []); setCarregando(false) })
  }, [obraAtiva])

  const hoje = hojeISO()
  const rdoHoje = rdos.find(r => r.data === hoje)

  async function abrirHoje() {
    if (!obraAtiva || criando) return
    if (rdoHoje) { navigate(`/rdo/${rdoHoje.id}`); return }
    setCriando(true)
    setErro('')
    const numero = rdos.reduce((m, r) => Math.max(m, r.numero), 0) + 1
    const { data, error } = await supabase.from('rdos')
      .insert({ obra_id: obraAtiva.id, numero, data: hoje })
      .select().single()
    setCriando(false)
    if (error) { setErro(`Erro ao criar RDO: ${error.message}`); return }
    navigate(`/rdo/${data.id}`)
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1>RDO — Relatório Diário de Obra</h1>
          <p className={styles.sub}>Um relatório por dia, com numeração sequencial. Assinado = fechado, nada mais se altera.</p>
        </div>
        {podeEditar && (
          <button className={styles.btnHoje} onClick={abrirHoje} disabled={criando}>
            {criando ? 'Criando…' : rdoHoje ? (rdoHoje.status === 'assinado' ? 'Ver RDO de hoje' : 'Continuar RDO de hoje') : '+ RDO de hoje'}
          </button>
        )}
      </div>

      {erro && <p className={styles.msgErro}>{erro}</p>}
      {carregando && <p className={styles.carregando}>Carregando…</p>}
      {!carregando && rdos.length === 0 && <p className={styles.vazio}>Nenhum RDO registrado ainda.</p>}

      {rdos.map(r => (
        <button key={r.id} className={styles.itemLista} onClick={() => navigate(`/rdo/${r.id}`)}>
          <span className={styles.numero}>Nº {String(r.numero).padStart(3, '0')}</span>
          <span className={styles.data}>{fmtData(r.data)}</span>
          <span className={r.status === 'assinado' ? styles.chipAssinado : styles.chipRascunho}>
            {r.status === 'assinado' ? 'Assinado' : 'Rascunho'}
          </span>
          {r.acidente && <span className={styles.chipAcidente}>⚠ acidente</span>}
        </button>
      ))}
    </div>
  )
}
