import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { supabase, type Obra } from '../lib/supabase'

interface ObraContextType {
  obras: Obra[]
  obraAtiva: Obra | null
  selecionarObra: (id: string) => void
  carregando: boolean
  recarregar: () => void
}

const ObraContext = createContext<ObraContextType>({
  obras: [],
  obraAtiva: null,
  selecionarObra: () => {},
  carregando: true,
  recarregar: () => {},
})

const STORAGE_KEY = 'rt-obra-ativa'

export function ObraProvider({ children }: { children: ReactNode }) {
  const [obras, setObras] = useState<Obra[]>([])
  const [obraAtiva, setObraAtiva] = useState<Obra | null>(null)
  const [carregando, setCarregando] = useState(true)

  function carregarObras(usarLocalStorage: boolean) {
    supabase
      .from('obras')
      .select('*')
      .in('status', ['ativa', 'pausada'])
      .order('nome')
      .then(({ data }) => {
        const lista = data ?? []
        setObras(lista)
        setObraAtiva(prev => {
          const salva = usarLocalStorage ? localStorage.getItem(STORAGE_KEY) : (prev?.id ?? null)
          return lista.find(o => o.id === salva) ?? lista[0] ?? null
        })
        setCarregando(false)
      })
  }

  useEffect(() => {
    carregarObras(true)
  }, [])

  function selecionarObra(id: string) {
    const obra = obras.find(o => o.id === id)
    if (obra) {
      setObraAtiva(obra)
      localStorage.setItem(STORAGE_KEY, obra.id)
    }
  }

  function recarregar() {
    carregarObras(false)
  }

  return (
    <ObraContext.Provider value={{ obras, obraAtiva, selecionarObra, carregando, recarregar }}>
      {children}
    </ObraContext.Provider>
  )
}

export const useObra = () => useContext(ObraContext)
