import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { supabase, type Empreiteiro } from '../lib/supabase'
import styles from './Empreiteiros.module.css'

export default function Empreiteiros() {
  const { perfil, temModulo } = useAuth()
  const navigate = useNavigate()
  const podeEditar = perfil?.papel === 'admin' || temModulo('contratos')

  const [empreiteiros, setEmpreiteiros] = useState<Empreiteiro[]>([])
  const [carregando, setCarregando] = useState(true)
  const [nome, setNome] = useState('')
  const [documento, setDocumento] = useState('')
  const [contato, setContato] = useState('')
  const [especialidade, setEspecialidade] = useState('')
  const [pix, setPix] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)

  useEffect(() => { carregar() }, [])

  function carregar() {
    setCarregando(true)
    supabase.from('empreiteiros').select('*').eq('ativo', true).order('nome')
      .then(({ data }) => { setEmpreiteiros(data ?? []); setCarregando(false) })
  }

  async function criar() {
    if (!nome.trim()) {
      setMsg({ tipo: 'erro', texto: 'Informe o nome do empreiteiro.' })
      return
    }
    setSalvando(true)
    setMsg(null)
    const { error } = await supabase.from('empreiteiros').insert({
      nome: nome.trim(),
      documento: documento.trim() || null,
      contato: contato.trim() || null,
      especialidade: especialidade.trim() || null,
      pix: pix.trim() || null,
    })
    setSalvando(false)
    if (error) {
      setMsg({ tipo: 'erro', texto: `Erro ao criar: ${error.message}` })
      return
    }
    setNome(''); setDocumento(''); setContato(''); setEspecialidade(''); setPix('')
    setMsg({ tipo: 'ok', texto: 'Empreiteiro cadastrado.' })
    carregar()
  }

  if (perfil?.papel === 'cliente') {
    return <div className={styles.page}><p className={styles.vazio}>Módulo de uso interno da equipe.</p></div>
  }

  return (
    <div className={styles.page}>
      <button className={styles.voltar} onClick={() => navigate('/contratos')}>← Contratos</button>
      <h1>Empreiteiros</h1>
      <p className={styles.sub}>Cadastro reaproveitável entre contratos.</p>

      {podeEditar && (
        <div className={styles.bloco}>
          <div className={styles.campos}>
            <label className={styles.campo}>
              Nome *
              <input value={nome} onChange={e => setNome(e.target.value)} placeholder="Ex.: José Hidráulica Ltda" />
            </label>
            <div className={styles.linha}>
              <label className={styles.campo}>
                CPF/CNPJ
                <input value={documento} onChange={e => setDocumento(e.target.value)} placeholder="Opcional" />
              </label>
              <label className={styles.campo}>
                Contato
                <input value={contato} onChange={e => setContato(e.target.value)} placeholder="Telefone, e-mail…" />
              </label>
            </div>
            <div className={styles.linha}>
              <label className={styles.campo}>
                Especialidade
                <input value={especialidade} onChange={e => setEspecialidade(e.target.value)} placeholder="Ex.: Hidráulica" />
              </label>
              <label className={styles.campo}>
                Chave PIX
                <input value={pix} onChange={e => setPix(e.target.value)} placeholder="Opcional" />
              </label>
            </div>
          </div>
          {msg && <p className={msg.tipo === 'ok' ? styles.msgOk : styles.msgErro}>{msg.texto}</p>}
          <button className={styles.btnPrincipal} onClick={criar} disabled={salvando} style={{ marginTop: 12 }}>
            {salvando ? 'Salvando…' : '+ Cadastrar empreiteiro'}
          </button>
        </div>
      )}

      {carregando && <p className={styles.vazio}>Carregando…</p>}
      {!carregando && empreiteiros.length === 0 && <p className={styles.vazio}>Nenhum empreiteiro cadastrado.</p>}
      {empreiteiros.map(e => (
        <div key={e.id} className={styles.card}>
          <div className={styles.cardNome}>{e.nome}</div>
          <div className={styles.cardMeta}>
            {e.especialidade && <span>🔧 {e.especialidade}</span>}
            {e.contato && <span>📞 {e.contato}</span>}
            {e.documento && <span>🧾 {e.documento}</span>}
          </div>
        </div>
      ))}
    </div>
  )
}
