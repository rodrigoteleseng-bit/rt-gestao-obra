import { createContext, useContext } from 'react'

export interface DialogOptions {
  titulo: string
  mensagem: string
  confirmarTexto?: string
  cancelarTexto?: string
  perigoso?: boolean
  campo?: {
    rotulo: string
    placeholder?: string
  }
}

export interface ConfirmDialogContextValue {
  confirmar: (opcoes: DialogOptions) => Promise<boolean>
  solicitarTexto: (opcoes: DialogOptions & { campo: NonNullable<DialogOptions['campo']> }) => Promise<string | null>
}

export const ConfirmDialogContext = createContext<ConfirmDialogContextValue | null>(null)

export function useConfirmDialog() {
  const contexto = useContext(ConfirmDialogContext)
  if (!contexto) throw new Error('useConfirmDialog precisa estar dentro de ConfirmDialogProvider')
  return contexto
}
