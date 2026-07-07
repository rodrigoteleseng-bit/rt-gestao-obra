import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { supabase, type PerfilUsuario } from '../lib/supabase'
import { getPerfil } from '../lib/auth'

interface AuthContextType {
  perfil: PerfilUsuario | null
  loading: boolean
  temModulo: (modulo: string) => boolean
}

const AuthContext = createContext<AuthContextType>({
  perfil: null,
  loading: true,
  temModulo: () => false,
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const [perfil, setPerfil] = useState<PerfilUsuario | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getPerfil().then(p => {
      setPerfil(p)
      setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event) => {
      if (event === 'SIGNED_IN') {
        const p = await getPerfil()
        setPerfil(p)
      } else if (event === 'SIGNED_OUT') {
        setPerfil(null)
      }
      setLoading(false)
    })

    return () => subscription.unsubscribe()
  }, [])

  function temModulo(modulo: string): boolean {
    if (!perfil) return false
    if (perfil.papel === 'admin') return true
    return perfil.modulos_permitidos.includes(modulo as never)
  }

  return (
    <AuthContext.Provider value={{ perfil, loading, temModulo }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
