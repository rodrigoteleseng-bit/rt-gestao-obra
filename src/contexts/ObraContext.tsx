import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { supabase, type Obra } from '../lib/supabase'

interface ObraContextType {
  obras: Obra[]
  obraAtiva: Obra | null
  selecionarObra: (id: string) => void
  carregando: boolean
}

const ObraContext = createContext<ObraContextType>({
  obras: [],
  obraAtiva: null,
  selecionarObra: () => {},
  carregando: true,
})

const STORAGE_KEY = 'rt-obra-ativa'

export function ObraProvider({ children }: { children: ReactNode }) {
  const [obras, setObras] = useState<Obra[]>([])
  const [obraAtiva, setObraAtiva] = useState<Obra | null>(null)
  const [carregando, setCarregando] = useState(true)

  useEffect(() => {
    supabase
      .from('obras')
      .select('*')
      .in('status', ['ativa', 'pausada'])
      .order('nome')
      .then(({ data }) => {
        const lista = data ?? []
        setObras(lista)
        const salva = localStorage.getItem(STORAGE_KEY)
        const inicial = lista.find(o => o.id === salva) ?? lista[0] ?? null
        setObraAtiva(inicial)
        setCarregando(false)
      })
  }, [])

  function selecionarObra(id: string) {
    const obra = obras.find(o => o.id === id)
    if (obra) {
      setObraAtiva(obra)
      localStorage.setItem(STORAGE_KEY, obra.id)
    }
  }

  return (
    <ObraContext.Provider value={{ obras, obraAtiva, selecionarObra, carregando }}>
      {children}
    </ObraContext.Provider>
  )
}

export const useObra = () => useContext(ObraContext)
