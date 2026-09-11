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
  const [formAberto, setFormAberto] = useState(false)
  const [editandoId, setEditandoId] = useState<string | null>(null)
  const [nome, setNome] = useState('')
  const [documento, setDocumento] = useState('')
  const [contato, setContato] = useState('')
  const [especialidade, setEspecialidade] = useState('')
  const [pix, setPix] = useState('')
  const [banco, setBanco] = useState('')
  const [agencia, setAgencia] = useState('')
  const [conta, setConta] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)

  useEffect(() => { carregar() }, [])

  function carregar() {
    setCarregando(true)
    supabase.from('empreiteiros').select('*').eq('ativo', true).order('nome')
      .then(({ data }) => { setEmpreiteiros(data ?? []); setCarregando(false) })
  }

  function abrirNovo() {
    setEditandoId(null)
    setNome(''); setDocumento(''); setContato(''); setEspecialidade('')
    setPix(''); setBanco(''); setAgencia(''); setConta('')
    setMsg(null)
    setFormAberto(true)
  }

  function abrirEdicao(e: Empreiteiro) {
    setEditandoId(e.id)
    setNome(e.nome)
    setDocumento(e.documento ?? '')
    setContato(e.contato ?? '')
    setEspecialidade(e.especialidade ?? '')
    setPix(e.pix ?? '')
    setBanco(e.banco ?? '')
    setAgencia(e.agencia ?? '')
    setConta(e.conta ?? '')
    setMsg(null)
    setFormAberto(true)
  }

  async function salvar() {
    if (!nome.trim()) {
      setMsg({ tipo: 'erro', texto: 'Informe o nome do empreiteiro.' })
      return
    }
    setSalvando(true)
    setMsg(null)
    const dados = {
      nome: nome.trim(),
      documento: documento.trim() || null,
      contato: contato.trim() || null,
      especialidade: especialidade.trim() || null,
      pix: pix.trim() || null,
      banco: banco.trim() || null,
      agencia: agencia.trim() || null,
      conta: conta.trim() || null,
    }
    const { error } = editandoId
      ? await supabase.from('empreiteiros').update(dados).eq('id', editandoId)
      : await supabase.from('empreiteiros').insert(dados)
    setSalvando(false)
    if (error) {
      setMsg({ tipo: 'erro', texto: `Erro ao salvar: ${error.message}` })
      return
    }
    setMsg({ tipo: 'ok', texto: editandoId ? 'Empreiteiro atualizado.' : 'Empreiteiro cadastrado.' })
    setFormAberto(false)
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

      {podeEditar && !formAberto && (
        <button className={styles.btnPrincipal} onClick={abrirNovo} style={{ marginBottom: 16 }}>
          + Cadastrar empreiteiro
        </button>
      )}

      {podeEditar && formAberto && (
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
            <label className={styles.campo}>
              Especialidade
              <input value={especialidade} onChange={e => setEspecialidade(e.target.value)} placeholder="Ex.: Hidráulica" />
            </label>
            <div className={styles.linha}>
              <label className={styles.campo}>
                Banco
                <input value={banco} onChange={e => setBanco(e.target.value)} placeholder="Opcional" />
              </label>
              <label className={styles.campo}>
                Agência
                <input value={agencia} onChange={e => setAgencia(e.target.value)} placeholder="Opcional" />
              </label>
            </div>
            <div className={styles.linha}>
              <label className={styles.campo}>
                Conta
                <input value={conta} onChange={e => setConta(e.target.value)} placeholder="Opcional" />
              </label>
              <label className={styles.campo}>
                Chave PIX
                <input value={pix} onChange={e => setPix(e.target.value)} placeholder="Opcional" />
              </label>
            </div>
          </div>
          {msg && <p className={msg.tipo === 'ok' ? styles.msgOk : styles.msgErro}>{msg.texto}</p>}
          <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
            <button className={styles.btnPrincipal} onClick={salvar} disabled={salvando}>
              {salvando ? 'Salvando…' : editandoId ? 'Salvar alterações' : '+ Cadastrar empreiteiro'}
            </button>
            <button className={styles.btnSecundario} onClick={() => setFormAberto(false)}>Cancelar</button>
          </div>
        </div>
      )}

      {carregando && <p className={styles.vazio}>Carregando…</p>}
      {!carregando && empreiteiros.length === 0 && <p className={styles.vazio}>Nenhum empreiteiro cadastrado.</p>}
      {empreiteiros.map(e => (
        <div key={e.id} className={styles.card}>
          <div className={styles.cardInfo}>
            <div className={styles.cardNome}>{e.nome}</div>
            <div className={styles.cardMeta}>
              {e.especialidade && <span>🔧 {e.especialidade}</span>}
              {e.contato && <span>📞 {e.contato}</span>}
              {e.documento && <span>🧾 {e.documento}</span>}
              {e.pix && <span>💳 PIX cadastrado</span>}
            </div>
          </div>
          {podeEditar && <button className={styles.btnSecundario} onClick={() => abrirEdicao(e)}>Editar</button>}
        </div>
      ))}
    </div>
  )
}
