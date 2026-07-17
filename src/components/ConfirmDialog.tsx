import { useCallback, useEffect, useRef, useState } from 'react'
import { ConfirmDialogContext, type DialogOptions } from './ConfirmDialogContext'
import styles from './ConfirmDialog.module.css'

interface DialogRequest extends DialogOptions {
  resolve: (valor: boolean | string | null) => void
}

export function ConfirmDialogProvider({ children }: { children: React.ReactNode }) {
  const [pedido, setPedido] = useState<DialogRequest | null>(null)
  const [texto, setTexto] = useState('')
  const confirmarRef = useRef<HTMLButtonElement | null>(null)
  const origemFocoRef = useRef<HTMLElement | null>(null)

  const abrir = useCallback((opcoes: DialogOptions) => new Promise<boolean | string | null>(resolve => {
    origemFocoRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setTexto('')
    setPedido({ ...opcoes, resolve })
  }), [])

  const confirmar = useCallback(async (opcoes: DialogOptions) => Boolean(await abrir(opcoes)), [abrir])
  const solicitarTexto = useCallback(async (opcoes: DialogOptions & { campo: NonNullable<DialogOptions['campo']> }) => {
    const resposta = await abrir(opcoes)
    return typeof resposta === 'string' ? resposta : null
  }, [abrir])

  const fechar = useCallback((valor: boolean | string | null) => {
    if (!pedido) return
    pedido.resolve(valor)
    setPedido(null)
    window.setTimeout(() => origemFocoRef.current?.focus(), 0)
  }, [pedido])

  useEffect(() => {
    if (!pedido) return
    const anterior = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    if (!pedido.campo) confirmarRef.current?.focus()
    const aoTeclar = (event: KeyboardEvent) => {
      if (event.key === 'Escape') fechar(pedido.campo ? null : false)
    }
    window.addEventListener('keydown', aoTeclar)
    return () => {
      document.body.style.overflow = anterior
      window.removeEventListener('keydown', aoTeclar)
    }
  }, [pedido, fechar])

  function concluir() {
    if (!pedido) return
    if (pedido.campo) {
      const valor = texto.trim()
      if (!valor) return
      fechar(valor)
      return
    }
    fechar(true)
  }

  return (
    <ConfirmDialogContext.Provider value={{ confirmar, solicitarTexto }}>
      {children}
      {pedido && (
        <div className={styles.fundo} onMouseDown={event => {
          if (event.target === event.currentTarget) fechar(pedido.campo ? null : false)
        }}>
          <section className={styles.dialogo} role="dialog" aria-modal="true" aria-labelledby="confirm-dialog-title">
            <h2 id="confirm-dialog-title">{pedido.titulo}</h2>
            <p>{pedido.mensagem}</p>
            {pedido.campo && (
              <label className={styles.campo}>
                {pedido.campo.rotulo}
                <textarea
                  autoFocus
                  value={texto}
                  onChange={event => setTexto(event.target.value)}
                  placeholder={pedido.campo.placeholder}
                  rows={3}
                />
              </label>
            )}
            <div className={styles.acoes}>
              <button className={styles.cancelar} onClick={() => fechar(pedido.campo ? null : false)}>
                {pedido.cancelarTexto ?? 'Voltar'}
              </button>
              <button
                ref={confirmarRef}
                className={pedido.perigoso ? styles.perigoso : styles.confirmar}
                onClick={concluir}
                disabled={Boolean(pedido.campo && !texto.trim())}
              >
                {pedido.confirmarTexto ?? 'Confirmar'}
              </button>
            </div>
          </section>
        </div>
      )}
    </ConfirmDialogContext.Provider>
  )
}
