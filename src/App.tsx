import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { ObraProvider } from './contexts/ObraContext'
import Layout from './components/Layout'
import Login from './pages/Login'
import NovaSenha from './pages/NovaSenha'
import Dashboard from './pages/Dashboard'
import Usuarios from './pages/Usuarios'
import Orcamento from './pages/Orcamento'
import Cronograma from './pages/Cronograma'
import Avanco from './pages/Avanco'
import RDO from './pages/RDO'
import RDOForm from './pages/RDOForm'
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
        <Route path="orcamento" element={<Orcamento />} />
        <Route path="cronograma" element={<Cronograma />} />
        <Route path="avanco" element={<Avanco />} />
        <Route path="rdo" element={<RDO />} />
        <Route path="rdo/:id" element={<RDOForm />} />
        <Route path="financeiro" element={<EmConstrucao modulo="Financeiro" fase={3} />} />
        <Route path="compras" element={<EmConstrucao modulo="Compras" fase={6} />} />
        <Route path="almoxarifado" element={<EmConstrucao modulo="Almoxarifado" fase={6} />} />
        <Route path="pendencias" element={<EmConstrucao modulo="Pendências" fase={5} />} />
        <Route path="medicoes" element={<EmConstrucao modulo="Medições de Empreiteiros" fase={7} />} />
        <Route path="contratos" element={<EmConstrucao modulo="Controle de Contratos" fase={7} />} />
        <Route path="fvs" element={<EmConstrucao modulo="Qualidade (FVS)" fase={7} />} />
        <Route path="galeria" element={<EmConstrucao modulo="Galeria de Fotos" fase={7} />} />
        <Route path="efetivo" element={<EmConstrucao modulo="Gestão de Efetivo" fase={7} />} />
        <Route path="alertas" element={<EmConstrucao modulo="Alertas" fase={7} />} />
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
