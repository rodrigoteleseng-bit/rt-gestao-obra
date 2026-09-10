import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useObra } from '../contexts/ObraContext'
import { supabase, type CtConcretagem, type Unidade } from '../lib/supabase'
import { STATUS_CONCRETAGEM_LABEL } from './ControleTecnologico'
import styles from './ControleTecnologicoForm.module.css'

function nomeArquivoStorage(nome: string): string {
  const partes = nome.split('.')
  const extensao = partes.length > 1 ? `.${partes.pop()}` : ''
  const base = (partes.join('.') || 'arquivo')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 80) || 'arquivo'
  const extLimpa = extensao
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9.]/g, '')
    .slice(0, 16)
  return `${base}${extLimpa}`.toLowerCase()
}

export default function ControleTecnologicoForm() {
  const { id } = useParams()
  const nova = id === 'nova'
  const navigate = useNavigate()
  const { perfil, temModulo } = useAuth()
  const { obraAtiva } = useObra()
  const podeEditar = perfil?.papel === 'admin' || temModulo('controle_tecnologico')

  const [unidades, setUnidades] = useState<Unidade[]>([])
  const [unidadeId, setUnidadeId] = useState('')
  const [data, setData] = useState(() => new Date().toISOString().slice(0, 10))
  const [arquivo, setArquivo] = useState<File | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)

  const [concretagem, setConcretagem] = useState<CtConcretagem | null>(null)
  const [carregando, setCarregando] = useState(!nova)

  useEffect(() => {
    if (!obraAtiva) return
    supabase.from('unidades').select('*').eq('obra_id', obraAtiva.id).order('ordem')
      .then(({ data }) => setUnidades(data ?? []))
  }, [obraAtiva])

  useEffect(() => {
    if (nova || !id) return
    setCarregando(true)
    supabase.from('ct_concretagens').select('*').eq('id', id).single()
      .then(({ data }) => { setConcretagem(data ?? null); setCarregando(false) })
  }, [id, nova])

  async function criar() {
    if (!obraAtiva) return
    if (!unidadeId) { setMsg({ tipo: 'erro', texto: 'Selecione a Unidade.' }); return }
    if (!arquivo) { setMsg({ tipo: 'erro', texto: 'Anexe a foto ou o PDF do mapa de concretagem.' }); return }
    setSalvando(true)
    setMsg(null)
    const path = `${obraAtiva.id}/${crypto.randomUUID()}-${nomeArquivoStorage(arquivo.name)}`
    const { error: eUp } = await supabase.storage.from('controle-tecnologico').upload(path, arquivo)
    if (eUp) {
      setSalvando(false)
      setMsg({ tipo: 'erro', texto: `Falha no envio do arquivo: ${eUp.message}` })
      return
    }
    const { data: nova_, error } = await supabase.from('ct_concretagens').insert({
      obra_id: obraAtiva.id,
      unidade_id: unidadeId,
      anexo_url: path,
      data,
    }).select().single()
    setSalvando(false)
    if (error || !nova_) {
      setMsg({ tipo: 'erro', texto: `Erro ao criar concretagem: ${error?.message}` })
      return
    }
    navigate(`/controle-tecnologico/${nova_.id}`, { replace: true })
  }

  if (perfil?.papel === 'cliente') {
    return <div className={styles.page}><p className={styles.vazio}>Módulo de uso interno da equipe.</p></div>
  }
  if (nova && !podeEditar) {
    return <div className={styles.page}><p className={styles.vazio}>Você não tem permissão para criar concretagens.</p></div>
  }

  if (nova) {
    return (
      <div className={styles.page}>
        <button className={styles.voltar} onClick={() => navigate('/controle-tecnologico')}>← Controle Tecnológico</button>
        <h1>Nova concretagem</h1>
        <div className={styles.bloco}>
          <label className={styles.campo}>
            Unidade *
            <select value={unidadeId} onChange={e => setUnidadeId(e.target.value)}>
              <option value="">Selecione…</option>
              {unidades.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}
            </select>
          </label>
          <label className={styles.campo}>
            Data *
            <input type="date" value={data} onChange={e => setData(e.target.value)} />
          </label>
          <label className={styles.campo}>
            Mapa de concretagem — foto ou PDF já marcado *
            <input type="file" accept="application/pdf,image/*" onChange={e => setArquivo(e.target.files?.[0] ?? null)} />
          </label>
        </div>
        {msg && <p className={msg.tipo === 'ok' ? styles.msgOk : styles.msgErro}>{msg.texto}</p>}
        <button className={styles.btnPrincipal} onClick={criar} disabled={salvando}>
          {salvando ? 'Criando…' : 'Criar concretagem'}
        </button>
      </div>
    )
  }

  if (carregando) return <div className={styles.page}><p className={styles.vazio}>Carregando…</p></div>
  if (!concretagem) return <div className={styles.page}><p className={styles.vazio}>Concretagem não encontrada.</p></div>

  return (
    <div className={styles.page}>
      <button className={styles.voltar} onClick={() => navigate('/controle-tecnologico')}>← Controle Tecnológico</button>
      <div className={styles.header}>
        <h1>{concretagem.data.slice(8, 10)}/{concretagem.data.slice(5, 7)}/{concretagem.data.slice(0, 4)}</h1>
        <span className={styles.chip}>{STATUS_CONCRETAGEM_LABEL[concretagem.status]}</span>
      </div>
      {/* Task 4 adiciona aqui: lista de caminhões, "+ Lançar caminhão", "Finalizar concretagem" e o PDF. */}
      {/* Task 5 adiciona aqui: acompanhamento/validação do laudo por caminhão. */}
    </div>
  )
}
