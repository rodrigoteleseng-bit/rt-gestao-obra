import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useObra } from '../contexts/ObraContext'
import { supabase, type Obra, type StatusObra } from '../lib/supabase'
import styles from './DadosObra.module.css'

const LABEL_STATUS: Record<StatusObra, string> = {
  ativa: 'Ativa',
  pausada: 'Pausada',
  concluida: 'Concluída',
  arquivada: 'Arquivada',
}

export default function DadosObra() {
  const { perfil } = useAuth()
  const { obraAtiva } = useObra()
  const navigate = useNavigate()

  const [obras, setObras] = useState<Obra[]>([])
  const [carregando, setCarregando] = useState(true)
  const [formAberto, setFormAberto] = useState(false)
  const [editandoId, setEditandoId] = useState<string | null>(null)
  const [nome, setNome] = useState('')
  const [descricao, setDescricao] = useState('')
  const [endereco, setEndereco] = useState('')
  const [cidade, setCidade] = useState('')
  const [estado, setEstado] = useState('')
  const [dataInicio, setDataInicio] = useState('')
  const [dataFimPrevista, setDataFimPrevista] = useState('')
  const [status, setStatus] = useState<StatusObra>('ativa')
  const [salvando, setSalvando] = useState(false)
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)

  useEffect(() => { carregar() }, [])

  function carregar() {
    setCarregando(true)
    supabase.from('obras').select('*').eq('ativo', true).order('nome')
      .then(({ data }) => { setObras(data ?? []); setCarregando(false) })
  }

  function abrirNovo() {
    setEditandoId(null)
    setNome(''); setDescricao(''); setEndereco(''); setCidade(''); setEstado('')
    setDataInicio(''); setDataFimPrevista(''); setStatus('ativa')
    setMsg(null)
    setFormAberto(true)
  }

  function abrirEdicao(o: Obra) {
    setEditandoId(o.id)
    setNome(o.nome)
    setDescricao(o.descricao ?? '')
    setEndereco(o.endereco ?? '')
    setCidade(o.cidade ?? '')
    setEstado(o.estado ?? '')
    setDataInicio(o.data_inicio ?? '')
    setDataFimPrevista(o.data_fim_prevista ?? '')
    setStatus(o.status)
    setMsg(null)
    setFormAberto(true)
  }

  async function salvar() {
    if (!nome.trim()) {
      setMsg({ tipo: 'erro', texto: 'Informe o nome da obra.' })
      return
    }
    setSalvando(true)
    setMsg(null)
    const dados = {
      nome: nome.trim(),
      descricao: descricao.trim() || null,
      endereco: endereco.trim() || null,
      cidade: cidade.trim() || null,
      estado: estado.trim().toUpperCase() || null,
      data_inicio: dataInicio || null,
      data_fim_prevista: dataFimPrevista || null,
      status,
    }
    const { error } = editandoId
      ? await supabase.from('obras').update(dados).eq('id', editandoId)
      : await supabase.from('obras').insert({ ...dados, criado_por: perfil?.id })
    setSalvando(false)
    if (error) {
      setMsg({ tipo: 'erro', texto: `Erro ao salvar: ${error.message}` })
      return
    }
    setMsg({ tipo: 'ok', texto: editandoId ? 'Obra atualizada.' : 'Obra cadastrada.' })
    setFormAberto(false)
    carregar()
  }

  if (perfil?.papel !== 'admin') {
    return <div className={styles.page}><p className={styles.vazio}>Acesso restrito ao administrador.</p></div>
  }

  return (
    <div className={styles.page}>
      <button className={styles.btnSecundario} onClick={() => navigate('/dashboard')} style={{ marginBottom: 12 }}>← Início</button>
      <h1>Dados da Obra</h1>
      <p className={styles.sub}>Cadastro e edição das obras da RT Engenharia.</p>

      <div className={styles.topo}>
        <span />
        <button className={styles.btnPrincipal} onClick={abrirNovo}>+ Nova obra</button>
      </div>

      {formAberto && (
        <div className={styles.bloco}>
          <div className={styles.campos}>
            <label className={styles.campo}>
              Nome *
              <input value={nome} onChange={e => setNome(e.target.value)} placeholder="Ex.: Tharsos Imperial" />
            </label>
            <label className={styles.campo}>
              Descrição
              <textarea value={descricao} onChange={e => setDescricao(e.target.value)} placeholder="Opcional" />
            </label>
            <label className={styles.campo}>
              Endereço
              <input value={endereco} onChange={e => setEndereco(e.target.value)} placeholder="Opcional" />
            </label>
            <div className={styles.linha}>
              <label className={styles.campo}>
                Cidade
                <input value={cidade} onChange={e => setCidade(e.target.value)} placeholder="Opcional" />
              </label>
              <label className={styles.campo}>
                Estado
                <input value={estado} onChange={e => setEstado(e.target.value)} maxLength={2} placeholder="GO" />
              </label>
            </div>
            <div className={styles.linha}>
              <label className={styles.campo}>
                Data de início
                <input type="date" value={dataInicio} onChange={e => setDataInicio(e.target.value)} />
              </label>
              <label className={styles.campo}>
                Previsão de término
                <input type="date" value={dataFimPrevista} onChange={e => setDataFimPrevista(e.target.value)} />
              </label>
            </div>
            <label className={styles.campo}>
              Status
              <select value={status} onChange={e => setStatus(e.target.value as StatusObra)}>
                <option value="ativa">Ativa</option>
                <option value="pausada">Pausada</option>
                <option value="concluida">Concluída</option>
                <option value="arquivada">Arquivada</option>
              </select>
            </label>
          </div>
          {msg && <p className={msg.tipo === 'ok' ? styles.msgOk : styles.msgErro}>{msg.texto}</p>}
          <div className={styles.acoesForm}>
            <button className={styles.btnPrincipal} onClick={salvar} disabled={salvando}>
              {salvando ? 'Salvando…' : editandoId ? 'Salvar alterações' : '+ Cadastrar obra'}
            </button>
            <button className={styles.btnSecundario} onClick={() => setFormAberto(false)}>Cancelar</button>
          </div>
        </div>
      )}

      {carregando && <p className={styles.vazio}>Carregando…</p>}
      {!carregando && obras.length === 0 && <p className={styles.vazio}>Nenhuma obra cadastrada.</p>}
      {obras.map(o => (
        <div key={o.id} className={styles.card}>
          <div className={styles.cardInfo}>
            <div className={styles.cardNome}>
              {o.nome}
              {o.id === obraAtiva?.id && <span className={styles.selo}>Ativa</span>}
              <span className={`${styles.badge} ${o.status === 'ativa' ? styles.badgeAtiva : ''}`}>{LABEL_STATUS[o.status]}</span>
            </div>
            <div className={styles.cardMeta}>
              {(o.cidade || o.estado) && <span>📍 {o.cidade}{o.cidade && o.estado ? ' — ' : ''}{o.estado}</span>}
              {o.data_fim_prevista && <span>🏁 Previsão: {new Date(o.data_fim_prevista + 'T00:00:00').toLocaleDateString('pt-BR')}</span>}
            </div>
          </div>
          <button className={styles.btnSecundario} onClick={() => abrirEdicao(o)}>Editar</button>
        </div>
      ))}
    </div>
  )
}
