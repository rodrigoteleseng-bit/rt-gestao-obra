import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { ObraProvider } from './contexts/ObraContext'
import Layout from './components/Layout'
import Login from './pages/Login'
import NovaSenha from './pages/NovaSenha'
import Dashboard from './pages/Dashboard'
import Usuarios from './pages/Usuarios'
import EmConstrucao from './pages/EmConstrucao'

function RotaProtegida({ children }: { children: React.ReactNode }) {
  const { perfil, loading } = useAuth()
  if (loading) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100dvh', fontFamily: 'Inter, sans-serif', color: '#6c757d' }}>Carregando…</div>
  if (!perfil) return <Navigate to="/login" replace />
  return <>{children}</>
}

function AppRoutes() {
  const { perfil } = useAuth()

  return (
    <Routes>
      <Route path="/login" element={perfil ? <Navigate to="/dashboard" replace /> : <Login />} />
      <Route path="/nova-senha" element={<NovaSenha />} />
      <Route path="/" element={<RotaProtegida><ObraProvider><Layout /></ObraProvider></RotaProtegida>}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="usuarios" element={<Usuarios />} />
        <Route path="avanco" element={<EmConstrucao modulo="Avanço Físico" fase={2} />} />
        <Route path="rdo" element={<EmConstrucao modulo="RDO" fase={4} />} />
        <Route path="financeiro" element={<EmConstrucao modulo="Financeiro" fase={3} />} />
        <Route path="compras" element={<EmConstrucao modulo="Compras" fase={6} />} />
        <Route path="almoxarifado" element={<EmConstrucao modulo="Almoxarifado" fase={6} />} />
        <Route path="pendencias" element={<EmConstrucao modulo="Pendências" fase={5} />} />
      </Route>
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  )
}
