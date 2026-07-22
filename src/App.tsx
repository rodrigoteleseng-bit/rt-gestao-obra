import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { ObraProvider } from './contexts/ObraContext'
import Layout from './components/Layout'
import { ConfirmDialogProvider } from './components/ConfirmDialog'
import Login from './pages/Login'
import NovaSenha from './pages/NovaSenha'

const Dashboard = lazy(() => import('./pages/Dashboard'))
const Usuarios = lazy(() => import('./pages/Usuarios'))
const Orcamento = lazy(() => import('./pages/Orcamento'))
const Cronograma = lazy(() => import('./pages/Cronograma'))
const Avanco = lazy(() => import('./pages/Avanco'))
const RDO = lazy(() => import('./pages/RDO'))
const RDOForm = lazy(() => import('./pages/RDOForm'))
const Galeria = lazy(() => import('./pages/Galeria'))
const Pendencias = lazy(() => import('./pages/Pendencias'))
const PendenciaForm = lazy(() => import('./pages/PendenciaForm'))
const Fornecedores = lazy(() => import('./pages/Fornecedores'))
const Empreiteiros = lazy(() => import('./pages/Empreiteiros'))
const DadosObra = lazy(() => import('./pages/DadosObra'))
const Definicoes = lazy(() => import('./pages/Definicoes'))
const Compras = lazy(() => import('./pages/Compras'))
const Contratos = lazy(() => import('./pages/Contratos'))
const ContratoForm = lazy(() => import('./pages/ContratoForm'))
const MedicaoForm = lazy(() => import('./pages/MedicaoForm'))
const Medicoes = lazy(() => import('./pages/Medicoes'))
const CompraForm = lazy(() => import('./pages/CompraForm'))
const FvsPage = lazy(() => import('./pages/Fvs'))
const FvsForm = lazy(() => import('./pages/FvsForm'))
const Almoxarifado = lazy(() => import('./pages/Almoxarifado'))
const Efetivo = lazy(() => import('./pages/Efetivo'))
const Producao = lazy(() => import('./pages/Producao'))
const Tarefas = lazy(() => import('./pages/Tarefas'))
const Planejamento = lazy(() => import('./pages/Planejamento'))
const Projetos = lazy(() => import('./pages/Projetos'))
const ProducaoMedicaoForm = lazy(() => import('./pages/ProducaoMedicaoForm'))
const Financeiro = lazy(() => import('./pages/Financeiro'))
const EmConstrucao = lazy(() => import('./pages/EmConstrucao'))

const carregandoPagina = (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '50dvh', fontFamily: 'Inter, sans-serif', color: '#6c757d' }}>
    Carregando…
  </div>
)

function RotaProtegida({ children }: { children: React.ReactNode }) {
  const { perfil, loading } = useAuth()
  if (loading) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100dvh', fontFamily: 'Inter, sans-serif', color: '#6c757d' }}>Carregando…</div>
  if (!perfil) return <Navigate to="/login" replace />
  return <>{children}</>
}

function AppRoutes() {
  const { perfil } = useAuth()

  return (
    <Suspense fallback={carregandoPagina}>
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
        <Route path="financeiro" element={<Financeiro />} />
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
        <Route path="producao" element={<Producao />} />
        <Route path="tarefas" element={<Tarefas />} />
        <Route path="planejamento" element={<Planejamento />} />
        <Route path="projetos" element={<Projetos />} />
        <Route path="medicoes/producao/:id" element={<ProducaoMedicaoForm />} />
        <Route path="alertas" element={<EmConstrucao modulo="Alertas" fase={7} />} />
      </Route>
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </Suspense>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <ConfirmDialogProvider>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </ConfirmDialogProvider>
    </BrowserRouter>
  )
}
