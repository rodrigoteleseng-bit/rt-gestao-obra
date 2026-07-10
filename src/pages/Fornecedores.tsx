import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { supabase, type Fornecedor } from '../lib/supabase'
import styles from './Fornecedores.module.css'

export default function Fornecedores() {
  const { perfil, temModulo } = useAuth()
  const navigate = useNavigate()
  const podeEditar = perfil?.papel === 'admin' || temModulo('compras')

  const [fornecedores, setFornecedores] = useState<Fornecedor[]>([])
  const [carregando, setCarregando] = useState(true)
  const [nome, setNome] = useState('')
  const [contato, setContato] = useState('')
  const [cnpj, setCnpj] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)

  useEffect(() => { carregar() }, [])

  function carregar() {
    setCarregando(true)
    supabase.from('fornecedores').select('*').eq('ativo', true).order('nome')
      .then(({ data }) => { setFornecedores(data ?? []); setCarregando(false) })
  }

  async function criar() {
    if (!nome.trim()) {
      setMsg({ tipo: 'erro', texto: 'Informe o nome do fornecedor.' })
      return
    }
    setSalvando(true)
    setMsg(null)
    const { error } = await supabase.from('fornecedores').insert({
      nome: nome.trim(),
      contato: contato.trim() || null,
      cnpj: cnpj.trim() || null,
    })
    setSalvando(false)
    if (error) {
      setMsg({ tipo: 'erro', texto: `Erro ao criar: ${error.message}` })
      return
    }
    setNome(''); setContato(''); setCnpj('')
    setMsg({ tipo: 'ok', texto: 'Fornecedor cadastrado.' })
    carregar()
  }

  if (perfil?.papel === 'cliente') {
    return <div className={styles.page}><p className={styles.vazio}>Módulo de uso interno da equipe.</p></div>
  }

  return (
    <div className={styles.page}>
      <button className={styles.voltar} onClick={() => navigate('/compras')}>← Compras</button>
      <h1>Fornecedores</h1>
      <p className={styles.sub}>Cadastro reaproveitável entre pedidos de compra.</p>

      {podeEditar && (
        <div className={styles.bloco}>
          <div className={styles.campos}>
            <label className={styles.campo}>
              Nome *
              <input value={nome} onChange={e => setNome(e.target.value)} placeholder="Ex.: Casa do Construtor" />
            </label>
            <div className={styles.linha}>
              <label className={styles.campo}>
                Contato
                <input value={contato} onChange={e => setContato(e.target.value)} placeholder="Telefone, e-mail…" />
              </label>
              <label className={styles.campo}>
                CNPJ
                <input value={cnpj} onChange={e => setCnpj(e.target.value)} placeholder="Opcional" />
              </label>
            </div>
          </div>
          {msg && <p className={msg.tipo === 'ok' ? styles.msgOk : styles.msgErro}>{msg.texto}</p>}
          <button className={styles.btnPrincipal} onClick={criar} disabled={salvando} style={{ marginTop: 12 }}>
            {salvando ? 'Salvando…' : '+ Cadastrar fornecedor'}
          </button>
        </div>
      )}

      {carregando && <p className={styles.vazio}>Carregando…</p>}
      {!carregando && fornecedores.length === 0 && <p className={styles.vazio}>Nenhum fornecedor cadastrado.</p>}
      {fornecedores.map(f => (
        <div key={f.id} className={styles.card}>
          <div className={styles.cardNome}>{f.nome}</div>
          <div className={styles.cardMeta}>
            {f.contato && <span>📞 {f.contato}</span>}
            {f.cnpj && <span>🧾 {f.cnpj}</span>}
          </div>
        </div>
      ))}
    </div>
  )
}
