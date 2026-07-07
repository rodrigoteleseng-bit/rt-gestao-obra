import { useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useObra } from '../contexts/ObraContext'
import { logout } from '../lib/auth'
import styles from './Layout.module.css'

const MODULOS = [
  { key: 'dashboard', label: 'Início', icon: '🏠', path: '/dashboard', sempre: true },
  { key: 'avanco', label: 'Avanço Físico', icon: '📊', path: '/avanco' },
  { key: 'rdo', label: 'RDO', icon: '📋', path: '/rdo' },
  { key: 'financeiro', label: 'Financeiro', icon: '💰', path: '/financeiro' },
  { key: 'compras', label: 'Compras', icon: '🛒', path: '/compras' },
  { key: 'almoxarifado', label: 'Almoxarifado', icon: '📦', path: '/almoxarifado' },
  { key: 'pendencias', label: 'Pendências', icon: '⚠️', path: '/pendencias' },
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

  const modulosVisiveis = MODULOS.filter(m => m.sempre || temModulo(m.key))

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
          {modulosVisiveis.map(m => (
            <NavLink
              key={m.key}
              to={m.path}
              className={({ isActive }) => `${styles.navItem} ${isActive ? styles.ativo : ''}`}
              onClick={() => setMenuAberto(false)}
            >
              <span className={styles.navIcon}>{m.icon}</span>
              <span>{m.label}</span>
            </NavLink>
          ))}

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
