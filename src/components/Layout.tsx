import { useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useObra } from '../contexts/ObraContext'
import { logout } from '../lib/auth'
import styles from './Layout.module.css'

type NavLink = {
  type: 'link'
  key: string
  label: string
  icon: string
  path: string
  sempre?: boolean
  sub?: boolean       // item indentado sob um grupo
}
type NavSection = {
  type: 'section'
  label: string
  showIfAny: string[] // mostra se usuário tem QUALQUER uma dessas chaves (admin sempre vê)
}
type NavItem = NavLink | NavSection

const MODULOS: NavItem[] = [
  { type: 'link', key: 'dashboard', label: 'Início',        icon: '🏠', path: '/dashboard', sempre: true },
  { type: 'link', key: 'orcamento', label: 'Orçamento',     icon: '📐', path: '/orcamento', sempre: true },
  { type: 'link', key: 'cronograma', label: 'Cronograma',   icon: '📅', path: '/cronograma', sempre: true },
  { type: 'link', key: 'avanco',    label: 'Avanço Físico', icon: '📊', path: '/avanco' },
  // ── RDO ─────────────────────────────────────────────
  { type: 'section', label: 'RDO', showIfAny: ['rdo', 'galeria', 'efetivo'] },
  { type: 'link', key: 'rdo',     label: 'Relatório Diário', icon: '📋', path: '/rdo' },
  { type: 'link', key: 'galeria', label: 'Galeria',          icon: '🖼️', path: '/galeria', sempre: true, sub: true },
  { type: 'link', key: 'efetivo', label: 'Efetivo',          icon: '👷', path: '/efetivo', sub: true },
  // ── Financeiro / Suprimentos ─────────────────────────
  { type: 'link', key: 'financeiro',   label: 'Financeiro',   icon: '💰', path: '/financeiro' },
  { type: 'link', key: 'compras',      label: 'Compras',      icon: '🛒', path: '/compras' },
  { type: 'link', key: 'almoxarifado', label: 'Almoxarifado', icon: '📦', path: '/almoxarifado' },
  { type: 'link', key: 'medicoes',     label: 'Medições',     icon: '📏', path: '/medicoes' },
  { type: 'link', key: 'medicoes',     label: 'Produção própria', icon: '👷', path: '/producao', sub: true },
  { type: 'link', key: 'contratos',    label: 'Contratos',    icon: '📝', path: '/contratos' },
  // ── Qualidade ────────────────────────────────────────
  { type: 'section', label: 'Qualidade', showIfAny: ['fvs', 'pendencias'] },
  { type: 'link', key: 'fvs',       label: 'FVS / Checklists', icon: '✅', path: '/fvs',       sub: true },
  { type: 'link', key: 'pendencias', label: 'Pendências',       icon: '⚠️', path: '/pendencias', sub: true },
  // ─────────────────────────────────────────────────────
  { type: 'link', key: 'alertas', label: 'Alertas', icon: '🔔', path: '/alertas' },
]

export default function Layout() {
  const { perfil, temModulo } = useAuth()
  const { obras, obraAtiva, selecionarObra } = useObra()
  const navigate = useNavigate()
  const [menuAberto, setMenuAberto] = useState(false)

  async function handleLogout() {
    await logout()
    navigate('/login')
  }

  function itemVisivel(item: NavItem): boolean {
    if (item.type === 'section') {
      return perfil?.papel === 'admin' || item.showIfAny.some(k => temModulo(k))
    }
    return item.sempre === true || temModulo(item.key)
  }

  const modulosVisiveis = MODULOS.filter(itemVisivel)

  return (
    <div className={styles.app}>
      {/* Sidebar desktop */}
      <aside className={`${styles.sidebar} ${menuAberto ? styles.aberto : ''}`}>
        <div className={styles.sidebarHeader}>
          <div className={styles.logoIcon}>RT</div>
          <div>
            <div className={styles.logoNome}>RT Engenharia</div>
            <div className={styles.logoTagline}>Inteligência Aplicada</div>
          </div>
        </div>

        <nav className={styles.nav}>
          {modulosVisiveis.map((item, idx) => {
            if (item.type === 'section') {
              return (
                <div key={`section-${idx}`} className={styles.navSection}>
                  {item.label}
                </div>
              )
            }
            return (
              <NavLink
                key={item.key}
                to={item.path}
                className={({ isActive }) =>
                  `${styles.navItem} ${item.sub ? styles.navSub : ''} ${isActive ? styles.ativo : ''}`
                }
                onClick={() => setMenuAberto(false)}
              >
                <span className={styles.navIcon}>{item.icon}</span>
                <span>{item.label}</span>
              </NavLink>
            )
          })}

          {perfil?.papel === 'admin' && (
            <NavLink
              to="/usuarios"
              className={({ isActive }) => `${styles.navItem} ${isActive ? styles.ativo : ''}`}
              onClick={() => setMenuAberto(false)}
            >
              <span className={styles.navIcon}>👥</span>
              <span>Usuários</span>
            </NavLink>
          )}
        </nav>

        <div className={styles.sidebarFooter}>
          <div className={styles.usuarioInfo}>
            <div className={styles.usuarioNome}>{perfil?.nome}</div>
            <div className={styles.usuarioPapel}>{perfil?.papel}</div>
          </div>
          <button className={styles.btnSair} onClick={handleLogout} title="Sair">
            ⏏
          </button>
        </div>
      </aside>

      {/* Overlay mobile */}
      {menuAberto && (
        <div className={styles.overlay} onClick={() => setMenuAberto(false)} />
      )}

      {/* Conteúdo principal */}
      <div className={styles.main}>
        <header className={styles.topbar}>
          <button
            className={styles.btnMenu}
            onClick={() => setMenuAberto(!menuAberto)}
            aria-label="Menu"
          >
            ☰
          </button>
          {obras.length > 1 ? (
            <select
              className={styles.obraSelect}
              value={obraAtiva?.id ?? ''}
              onChange={e => selecionarObra(e.target.value)}
              aria-label="Selecionar obra"
            >
              {obras.map(o => (
                <option key={o.id} value={o.id}>{o.nome}</option>
              ))}
            </select>
          ) : (
            <span className={styles.obraNome}>{obraAtiva?.nome ?? '—'}</span>
          )}
        </header>
        <main className={styles.conteudo}>
          <Outlet />
        </main>
      </div>
    </div>
  )
}
