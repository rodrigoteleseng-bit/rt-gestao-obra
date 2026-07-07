import { useEffect, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useObra } from '../contexts/ObraContext'
import { supabase, type Unidade } from '../lib/supabase'
import styles from './Dashboard.module.css'

const CARDS_MODULOS = [
  { key: 'avanco', label: 'Avanço Físico', icon: '📊', desc: 'Progresso por unidade e serviço', path: '/avanco' },
  { key: 'rdo', label: 'RDO', icon: '📋', desc: 'Relatório Diário de Obra', path: '/rdo' },
  { key: 'financeiro', label: 'Financeiro', icon: '💰', desc: 'Notas fiscais e gastos', path: '/financeiro' },
  { key: 'compras', label: 'Compras', icon: '🛒', desc: 'Pedidos e cotações', path: '/compras' },
  { key: 'almoxarifado', label: 'Almoxarifado', icon: '📦', desc: 'Materiais e ferramentas', path: '/almoxarifado' },
  { key: 'pendencias', label: 'Pendências', icon: '⚠️', desc: 'Por unidade e serviço', path: '/pendencias' },
]

export default function Dashboard() {
  const { perfil, temModulo } = useAuth()
  const { obraAtiva: obra } = useObra()
  const [unidades, setUnidades] = useState<Unidade[]>([])

  useEffect(() => {
    if (!obra) {
      setUnidades([])
      return
    }
    supabase.from('unidades').select('*').eq('obra_id', obra.id).order('ordem')
      .then(({ data }) => setUnidades(data ?? []))
  }, [obra])

  const sobrados = unidades.filter(u => u.tipo === 'sobrado')

  return (
    <div className={styles.page}>
      <div className={styles.boas_vindas}>
        <h1>Olá, {perfil?.nome?.split(' ')[0]} 👋</h1>
        <p>Bem-vindo ao painel de gestão de obra da RT Engenharia.</p>
      </div>

      {obra && (
        <div className={styles.obraCard}>
          <div className={styles.obraHeader}>
            <div>
              <div className={styles.obraLabel}>Obra ativa</div>
              <div className={styles.obraNome}>{obra.nome}</div>
              <div className={styles.obraEndereco}>{obra.cidade} — {obra.estado}</div>
            </div>
            <div className={styles.obraBadge}>{obra.status}</div>
          </div>
          <div className={styles.obraStats}>
            <div className={styles.stat}>
              <div className={styles.statNum}>{sobrados.length}</div>
              <div className={styles.statLabel}>Sobrados</div>
            </div>
            <div className={styles.stat}>
              <div className={styles.statNum}>{unidades.length}</div>
              <div className={styles.statLabel}>Unidades total</div>
            </div>
            <div className={styles.stat}>
              <div className={styles.statNum}>—</div>
              <div className={styles.statLabel}>% concluído</div>
            </div>
          </div>
        </div>
      )}

      <h2 className={styles.secaoTitulo}>Módulos</h2>
      <div className={styles.grid}>
        {CARDS_MODULOS.map(m => {
          const ativo = temModulo(m.key)
          return (
            <div
              key={m.key}
              className={`${styles.card} ${ativo ? styles.cardAtivo : styles.cardBloqueado}`}
            >
              <div className={styles.cardIcon}>{m.icon}</div>
              <div className={styles.cardNome}>{m.label}</div>
              <div className={styles.cardDesc}>{m.desc}</div>
              {!ativo && <div className={styles.cardLock}>Sem acesso</div>}
            </div>
          )
        })}
      </div>

      <p className={styles.versao}>Fase 0 — Fundação · v0.1 · Dados de {new Date().toLocaleDateString('pt-BR')}</p>
    </div>
  )
}
