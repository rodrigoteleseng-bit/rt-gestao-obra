import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useObra } from '../contexts/ObraContext'
import { supabase, type Unidade } from '../lib/supabase'
import styles from './Dashboard.module.css'

interface SubModulo {
  label: string
  icon: string
  path: string
  sempre?: boolean    // acessível a todos os papéis
  moduloKey?: string  // chave de permissão individual (sobrepõe a do card pai)
}

interface CardModulo {
  key: string
  label: string
  icon: string
  desc: string
  path?: string
  subs?: SubModulo[]
  multiKey?: string[] // card ativo se o usuário tiver QUALQUER uma dessas chaves
}

const CARDS_MODULOS: CardModulo[] = [
  {
    key: 'avanco', label: 'Avanço Físico', icon: '📊', desc: 'Cronograma e progresso da obra',
    subs: [
      { label: 'Cronograma', icon: '📅', path: '/cronograma', sempre: true },
      { label: 'Lançar avanço', icon: '✏️', path: '/avanco' },
    ],
  },
  {
    key: 'rdo', label: 'RDO', icon: '📋', desc: 'Relatório diário, galeria e efetivo',
    subs: [
      { label: 'Relatório Diário', icon: '📋', path: '/rdo' },
      { label: 'Galeria de Fotos', icon: '🖼️', path: '/galeria', sempre: true },
      { label: 'Efetivo', icon: '👷', path: '/efetivo', moduloKey: 'efetivo' },
    ],
  },
  { key: 'financeiro', label: 'Financeiro', icon: '💰', desc: 'Notas fiscais e gastos', path: '/financeiro' },
  { key: 'compras', label: 'Compras', icon: '🛒', desc: 'Pedidos e cotações', path: '/compras' },
  { key: 'almoxarifado', label: 'Almoxarifado', icon: '📦', desc: 'Materiais e ferramentas', path: '/almoxarifado' },
  {
    key: 'qualidade', label: 'Qualidade', icon: '🏷️', desc: 'FVS, checklists e pendências de obra',
    multiKey: ['fvs', 'pendencias'],
    subs: [
      { label: 'FVS / Checklists', icon: '✅', path: '/fvs', moduloKey: 'fvs' },
      { label: 'Pendências', icon: '⚠️', path: '/pendencias', moduloKey: 'pendencias' },
    ],
  },
]

export default function Dashboard() {
  const { perfil, temModulo } = useAuth()
  const { obraAtiva: obra } = useObra()
  const navigate = useNavigate()
  const [unidades, setUnidades] = useState<Unidade[]>([])
  const [cardAberto, setCardAberto] = useState<string | null>(null)

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
          // card ativo se tem a chave principal OU qualquer chave do multiKey
          const temAcessoModulo = m.multiKey
            ? m.multiKey.some(k => temModulo(k))
            : temModulo(m.key)
          // sub visível se: sempre=true, ou tem chave individual, ou tem acesso ao card pai
          const subsVisiveis = (m.subs ?? []).filter(s =>
            s.sempre || (s.moduloKey ? temModulo(s.moduloKey) : temAcessoModulo)
          )
          const ativo = temAcessoModulo || subsVisiveis.length > 0
          const aberto = cardAberto === m.key

          function onClickCard() {
            if (!ativo) return
            if (m.subs) setCardAberto(aberto ? null : m.key)
            else if (m.path) navigate(m.path)
          }

          return (
            <div
              key={m.key}
              className={`${styles.card} ${ativo ? styles.cardAtivo : styles.cardBloqueado} ${ativo ? styles.cardClicavel : ''}`}
              onClick={onClickCard}
              role={ativo ? 'button' : undefined}
              tabIndex={ativo ? 0 : undefined}
              onKeyDown={e => { if (e.key === 'Enter') onClickCard() }}
            >
              <div className={styles.cardIcon}>{m.icon}</div>
              <div className={styles.cardNome}>{m.label}</div>
              <div className={styles.cardDesc}>{m.desc}</div>
              {!ativo && <div className={styles.cardLock}>Sem acesso</div>}
              {ativo && m.subs && (
                <div className={styles.cardSeta}>{aberto ? '▾' : '▸'}</div>
              )}
              {aberto && subsVisiveis.length > 0 && (
                <div className={styles.subLista}>
                  {subsVisiveis.map(s => (
                    <button
                      key={s.path}
                      className={styles.subBtn}
                      onClick={e => { e.stopPropagation(); navigate(s.path) }}
                    >
                      <span>{s.icon}</span> {s.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <p className={styles.versao}>Fase 0 — Fundação · v0.1 · Dados de {new Date().toLocaleDateString('pt-BR')}</p>
    </div>
  )
}
