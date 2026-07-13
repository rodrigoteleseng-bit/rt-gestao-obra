import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useObra } from '../contexts/ObraContext'
import { supabase, type Obra, type StatusObra } from '../lib/supabase'
import styles from './DadosObra.module.css'

const LABEL_STATUS: Record<StatusObra, string> = {
  ativa: 'Ativa',
  pausada: 'Pausada',
  concluida: 'Concluída',
  arquivada: 'Arquivada',
}

export default function DadosObra() {
  const { perfil } = useAuth()
  const { obraAtiva } = useObra()
  const navigate = useNavigate()

  const [obras, setObras] = useState<Obra[]>([])
  const [carregando, setCarregando] = useState(true)

  useEffect(() => { carregar() }, [])

  function carregar() {
    setCarregando(true)
    supabase.from('obras').select('*').eq('ativo', true).order('nome')
      .then(({ data }) => { setObras(data ?? []); setCarregando(false) })
  }

  if (perfil?.papel !== 'admin') {
    return <div className={styles.page}><p className={styles.vazio}>Acesso restrito ao administrador.</p></div>
  }

  return (
    <div className={styles.page}>
      <button className={styles.btnSecundario} onClick={() => navigate('/dashboard')} style={{ marginBottom: 12 }}>← Início</button>
      <h1>Dados da Obra</h1>
      <p className={styles.sub}>Cadastro e edição das obras da RT Engenharia.</p>

      <div className={styles.topo}>
        <span />
        <button className={styles.btnPrincipal}>+ Nova obra</button>
      </div>

      {carregando && <p className={styles.vazio}>Carregando…</p>}
      {!carregando && obras.length === 0 && <p className={styles.vazio}>Nenhuma obra cadastrada.</p>}
      {obras.map(o => (
        <div key={o.id} className={styles.card}>
          <div className={styles.cardInfo}>
            <div className={styles.cardNome}>
              {o.nome}
              {o.id === obraAtiva?.id && <span className={styles.selo}>Ativa</span>}
              <span className={`${styles.badge} ${o.status === 'ativa' ? styles.badgeAtiva : ''}`}>{LABEL_STATUS[o.status]}</span>
            </div>
            <div className={styles.cardMeta}>
              {(o.cidade || o.estado) && <span>📍 {o.cidade}{o.cidade && o.estado ? ' — ' : ''}{o.estado}</span>}
              {o.data_fim_prevista && <span>🏁 Previsão: {new Date(o.data_fim_prevista + 'T00:00:00').toLocaleDateString('pt-BR')}</span>}
            </div>
          </div>
          <button className={styles.btnSecundario}>Editar</button>
        </div>
      ))}
    </div>
  )
}
