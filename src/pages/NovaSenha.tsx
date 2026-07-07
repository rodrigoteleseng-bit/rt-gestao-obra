import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import styles from './Login.module.css'

export default function NovaSenha() {
  const [senha, setSenha] = useState('')
  const [confirma, setConfirma] = useState('')
  const [erro, setErro] = useState('')
  const [loading, setLoading] = useState(false)
  const [sessaoOk, setSessaoOk] = useState<boolean | null>(null)
  const navigate = useNavigate()

  useEffect(() => {
    // O link de convite/recuperação autentica via token na URL;
    // aguarda o Supabase processar antes de liberar o formulário
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) setSessaoOk(true)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSessaoOk(!!session)
    })
    const timeout = setTimeout(() => setSessaoOk(prev => prev ?? false), 4000)
    return () => { subscription.unsubscribe(); clearTimeout(timeout) }
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setErro('')
    if (senha.length < 8) {
      setErro('A senha deve ter pelo menos 8 caracteres.')
      return
    }
    if (senha !== confirma) {
      setErro('As senhas não conferem.')
      return
    }
    setLoading(true)
    const { error } = await supabase.auth.updateUser({ password: senha })
    setLoading(false)
    if (error) {
      setErro('Não foi possível salvar a senha. Tente novamente ou peça um novo convite.')
      return
    }
    navigate('/dashboard')
  }

  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <div className={styles.logo}>
          <div className={styles.logoIcon}>RT</div>
          <div>
            <div className={styles.logoNome}>RT Engenharia</div>
            <div className={styles.logoTagline}>Inteligência Aplicada</div>
          </div>
        </div>

        <h1 className={styles.titulo}>Definir senha</h1>

        {sessaoOk === null && <p>Validando seu convite…</p>}

        {sessaoOk === false && (
          <p className={styles.erro}>
            Link inválido ou expirado. Peça ao administrador um novo convite.
          </p>
        )}

        {sessaoOk && (
          <form onSubmit={handleSubmit} className={styles.form}>
            <div className={styles.campo}>
              <label htmlFor="senha">Nova senha</label>
              <input
                id="senha"
                type="password"
                value={senha}
                onChange={e => setSenha(e.target.value)}
                required
                autoComplete="new-password"
                placeholder="mínimo 8 caracteres"
              />
            </div>
            <div className={styles.campo}>
              <label htmlFor="confirma">Confirmar senha</label>
              <input
                id="confirma"
                type="password"
                value={confirma}
                onChange={e => setConfirma(e.target.value)}
                required
                autoComplete="new-password"
                placeholder="repita a senha"
              />
            </div>
            {erro && <p className={styles.erro}>{erro}</p>}
            <button type="submit" className={styles.btnPrimario} disabled={loading}>
              {loading ? 'Salvando…' : 'Salvar e entrar'}
            </button>
          </form>
        )}
      </div>
      <p className={styles.versao}>v0.1 — Fase 0 Fundação</p>
    </div>
  )
}
