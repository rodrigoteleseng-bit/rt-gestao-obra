import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { login, resetSenha } from '../lib/auth'
import styles from './Login.module.css'

export default function Login() {
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState('')
  const [loading, setLoading] = useState(false)
  const [modoReset, setModoReset] = useState(false)
  const [resetEnviado, setResetEnviado] = useState(false)
  const navigate = useNavigate()

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setErro('')
    setLoading(true)
    try {
      await login(email, senha)
      navigate('/dashboard')
    } catch {
      setErro('E-mail ou senha incorretos.')
    } finally {
      setLoading(false)
    }
  }

  async function handleReset(e: React.FormEvent) {
    e.preventDefault()
    setErro('')
    setLoading(true)
    try {
      await resetSenha(email)
      setResetEnviado(true)
    } catch {
      setErro('Não foi possível enviar o e-mail. Verifique o endereço.')
    } finally {
      setLoading(false)
    }
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

        {!modoReset ? (
          <>
            <h1 className={styles.titulo}>Entrar</h1>
            <form onSubmit={handleLogin} className={styles.form}>
              <div className={styles.campo}>
                <label htmlFor="email">E-mail</label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  placeholder="seu@email.com"
                />
              </div>
              <div className={styles.campo}>
                <label htmlFor="senha">Senha</label>
                <input
                  id="senha"
                  type="password"
                  value={senha}
                  onChange={e => setSenha(e.target.value)}
                  required
                  autoComplete="current-password"
                  placeholder="••••••••"
                />
              </div>
              {erro && <p className={styles.erro}>{erro}</p>}
              <button type="submit" className={styles.btnPrimario} disabled={loading}>
                {loading ? 'Entrando…' : 'Entrar'}
              </button>
            </form>
            <button className={styles.linkBtn} onClick={() => setModoReset(true)}>
              Esqueci minha senha
            </button>
          </>
        ) : (
          <>
            <h1 className={styles.titulo}>Recuperar senha</h1>
            {!resetEnviado ? (
              <form onSubmit={handleReset} className={styles.form}>
                <div className={styles.campo}>
                  <label htmlFor="email-reset">E-mail cadastrado</label>
                  <input
                    id="email-reset"
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    required
                    placeholder="seu@email.com"
                  />
                </div>
                {erro && <p className={styles.erro}>{erro}</p>}
                <button type="submit" className={styles.btnPrimario} disabled={loading}>
                  {loading ? 'Enviando…' : 'Enviar link de recuperação'}
                </button>
              </form>
            ) : (
              <p className={styles.sucesso}>
                Link enviado para <strong>{email}</strong>. Verifique sua caixa de entrada.
              </p>
            )}
            <button className={styles.linkBtn} onClick={() => { setModoReset(false); setResetEnviado(false) }}>
              ← Voltar ao login
            </button>
          </>
        )}
      </div>
      <p className={styles.versao}>v0.1 — Fase 0 Fundação</p>
    </div>
  )
}
