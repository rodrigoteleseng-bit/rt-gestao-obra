import { useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useObra } from '../contexts/ObraContext'
import { logout } from '../lib/auth'
import styles from './Layout.module.css'

type NavLinkItem = {
  type: 'link'
  key: string
  label: string
  icon: string
  path: string
  sempre?: boolean
  match?: string[]
  exato?: boolean
}

type NavGroupItem = {
  type: 'group'
  key: string
  label: string
  icon: string
  items: NavLinkItem[]
}

type NavItem = NavLinkItem | NavGroupItem

const MODULOS: NavItem[] = [
  { type: 'link', key: 'dashboard', label: 'Início', icon: '🏠', path: '/dashboard', sempre: true },
  { type: 'link', key: 'orcamento', label: 'Orçamento', icon: '📐', path: '/orcamento', sempre: true },
  {
    type: 'group', key: 'avanco', label: 'Avanço Físico', icon: '📊', items: [
      { type: 'link', key: 'cronograma', label: 'Cronograma', icon: '📅', path: '/cronograma', sempre: true },
      { type: 'link', key: 'avanco', label: 'Lançar avanço', icon: '✏️', path: '/avanco' },
    ],
  },
  {
    type: 'group', key: 'rdo', label: 'RDO', icon: '📋', items: [
      { type: 'link', key: 'rdo', label: 'Relatório Diário', icon: '📋', path: '/rdo' },
      { type: 'link', key: 'galeria', label: 'Galeria', icon: '🖼️', path: '/galeria', sempre: true },
      { type: 'link', key: 'efetivo', label: 'Efetivo', icon: '👷', path: '/efetivo' },
    ],
  },
  {
    type: 'group', key: 'suprimentos', label: 'Suprimentos', icon: '📦', items: [
      { type: 'link', key: 'compras', label: 'Compras', icon: '🛒', path: '/compras' },
      { type: 'link', key: 'almoxarifado', label: 'Almoxarifado', icon: '📦', path: '/almoxarifado' },
    ],
  },
  {
    type: 'group', key: 'producao', label: 'Produção', icon: '🏗️', items: [
      { type: 'link', key: 'contratos', label: 'Contratos', icon: '📝', path: '/contratos', match: ['/contratos'] },
      { type: 'link', key: 'medicoes', label: 'Medições', icon: '📏', path: '/medicoes', match: ['/medicoes'], exato: true },
      { type: 'link', key: 'medicoes', label: 'Produção própria', icon: '👷', path: '/producao', match: ['/producao', '/medicoes/producao'] },
    ],
  },
  {
    type: 'group', key: 'qualidade', label: 'Qualidade', icon: '🏷️', items: [
      { type: 'link', key: 'fvs', label: 'FVS / Checklists', icon: '✅', path: '/fvs' },
      { type: 'link', key: 'pendencias', label: 'Pendências', icon: '⚠️', path: '/pendencias' },
    ],
  },
  { type: 'link', key: 'tarefas', label: 'Tarefas', icon: '☑️', path: '/tarefas' },
  { type: 'link', key: 'financeiro', label: 'Financeiro', icon: '💰', path: '/financeiro' },
  { type: 'link', key: 'alertas', label: 'Alertas', icon: '🔔', path: '/alertas' },
]

export default function Layout() {
  const { perfil, temModulo } = useAuth()
  const { obras, obraAtiva, selecionarObra } = useObra()
  const navigate = useNavigate()
  const location = useLocation()
  const [menuAberto, setMenuAberto] = useState(false)
  const [gruposFechados, setGruposFechados] = useState<Set<string>>(new Set())

  async function handleLogout() {
    await logout()
    navigate('/login')
  }

  function linkVisivel(item: NavLinkItem): boolean {
    return perfil?.papel === 'admin' || item.sempre === true || temModulo(item.key)
  }

  function grupoVisivel(item: NavGroupItem): boolean {
    return item.items.some(linkVisivel)
  }

  function itemVisivel(item: NavItem): boolean {
    return item.type === 'group' ? grupoVisivel(item) : linkVisivel(item)
  }

  function linkAtivo(item: NavLinkItem): boolean {
    const caminhos = item.match ?? [item.path]
    return caminhos.some(caminho => item.exato ? location.pathname === caminho : location.pathname === caminho || location.pathname.startsWith(`${caminho}/`))
  }

  function alternarGrupo(key: string) {
    setGruposFechados(atual => {
      const novo = new Set(atual)
      if (novo.has(key)) novo.delete(key)
      else novo.add(key)
      return novo
    })
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
          {modulosVisiveis.map(item => {
            if (item.type === 'group') {
              const filhosVisiveis = item.items.filter(linkVisivel)
              const fechado = gruposFechados.has(item.key)
              const ativo = filhosVisiveis.some(linkAtivo)
              return (
                <div key={item.key} className={styles.navGroup}>
                  <button
                    type="button"
                    className={`${styles.navGroupHeader} ${ativo ? styles.navGroupAtivo : ''}`}
                    onClick={() => alternarGrupo(item.key)}
                    aria-expanded={!fechado}
                  >
                    <span className={styles.navIcon}>{item.icon}</span>
                    <span>{item.label}</span>
                    <span className={styles.navChevron}>{fechado ? '▸' : '▾'}</span>
                  </button>
                  {!fechado && (
                    <div className={styles.navGroupItems}>
                      {filhosVisiveis.map(filho => (
                        <NavLink
                          key={`${item.key}-${filho.path}`}
                          to={filho.path}
                          className={({ isActive }) =>
                            `${styles.navItem} ${styles.navSub} ${(isActive || linkAtivo(filho)) ? styles.ativo : ''}`
                          }
                          onClick={() => setMenuAberto(false)}
                        >
                          <span className={styles.navIcon}>{filho.icon}</span>
                          <span>{filho.label}</span>
                        </NavLink>
                      ))}
                    </div>
                  )}
                </div>
              )
            }
            return (
              <NavLink
                key={item.key}
                to={item.path}
                className={({ isActive }) => `${styles.navItem} ${isActive ? styles.ativo : ''}`}
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
