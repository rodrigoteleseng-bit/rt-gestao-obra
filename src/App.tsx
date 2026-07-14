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
import Galeria from './pages/Galeria'
import Pendencias from './pages/Pendencias'
import PendenciaForm from './pages/PendenciaForm'
import Fornecedores from './pages/Fornecedores'
import Empreiteiros from './pages/Empreiteiros'
import DadosObra from './pages/DadosObra'
import Definicoes from './pages/Definicoes'
import Compras from './pages/Compras'
import Contratos from './pages/Contratos'
import ContratoForm from './pages/ContratoForm'
import MedicaoForm from './pages/MedicaoForm'
import Medicoes from './pages/Medicoes'
import CompraForm from './pages/CompraForm'
import FvsPage from './pages/Fvs'
import FvsForm from './pages/FvsForm'
import Almoxarifado from './pages/Almoxarifado'
import Efetivo from './pages/Efetivo'
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
        <Route path="dados-obra" element={<DadosObra />} />
        <Route path="orcamento" element={<Orcamento />} />
        <Route path="cronograma" element={<Cronograma />} />
        <Route path="avanco" element={<Avanco />} />
        <Route path="rdo" element={<RDO />} />
        <Route path="rdo/:id" element={<RDOForm />} />
        <Route path="financeiro" element={<EmConstrucao modulo="Financeiro" fase={3} />} />
        <Route path="compras" element={<Compras />} />
        <Route path="compras/:id" element={<CompraForm />} />
        <Route path="almoxarifado" element={<Almoxarifado />} />
        <Route path="pendencias" element={<Pendencias />} />
        <Route path="pendencias/:id" element={<PendenciaForm />} />
        <Route path="definicoes" element={<Definicoes />} />
        <Route path="fornecedores" element={<Fornecedores />} />
        <Route path="empreiteiros" element={<Empreiteiros />} />
        <Route path="medicoes" element={<Medicoes />} />
        <Route path="contratos" element={<Contratos />} />
        <Route path="contratos/:id" element={<ContratoForm />} />
        <Route path="contratos/:contratoId/medicoes/:medicaoId" element={<MedicaoForm />} />
        <Route path="fvs" element={<FvsPage />} />
        <Route path="fvs/:id" element={<FvsForm />} />
        <Route path="galeria" element={<Galeria />} />
        <Route path="efetivo" element={<Efetivo />} />
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
