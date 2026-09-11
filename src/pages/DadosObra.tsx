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
  const { obraAtiva, recarregar } = useObra()
  const navigate = useNavigate()

  const [obras, setObras] = useState<Obra[]>([])
  const [carregando, setCarregando] = useState(true)
  const [formAberto, setFormAberto] = useState(false)
  const [editandoId, setEditandoId] = useState<string | null>(null)
  const [nome, setNome] = useState('')
  const [descricao, setDescricao] = useState('')
  const [nomeEmpreendimento, setNomeEmpreendimento] = useState('')
  const [razaoSocial, setRazaoSocial] = useState('')
  const [endereco, setEndereco] = useState('')
  const [cidade, setCidade] = useState('')
  const [estado, setEstado] = useState('')
  const [cnpj, setCnpj] = useState('')
  const [cnoObra, setCnoObra] = useState('')
  const [enderecoEscritorio, setEnderecoEscritorio] = useState('')
  const [cep, setCep] = useState('')
  const [email, setEmail] = useState('')
  const [engenheiroObraNome, setEngenheiroObraNome] = useState('')
  const [engenheiroObraCrea, setEngenheiroObraCrea] = useState('')
  const [dataInicio, setDataInicio] = useState('')
  const [dataFimPrevista, setDataFimPrevista] = useState('')
  const [status, setStatus] = useState<StatusObra>('ativa')
  const [logoUrl, setLogoUrl] = useState<string | null>(null)
  const [rodapePdf, setRodapePdf] = useState('')
  const [logoArquivo, setLogoArquivo] = useState<File | null>(null)
  const [enviandoLogo, setEnviandoLogo] = useState(false)
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
    setNome(''); setDescricao(''); setNomeEmpreendimento(''); setRazaoSocial(''); setEndereco(''); setCidade(''); setEstado('')
    setCnpj(''); setCnoObra(''); setEnderecoEscritorio(''); setCep(''); setEmail('')
    setEngenheiroObraNome(''); setEngenheiroObraCrea('')
    setDataInicio(''); setDataFimPrevista(''); setStatus('ativa')
    setLogoUrl(null); setRodapePdf(''); setLogoArquivo(null)
    setMsg(null)
    setFormAberto(true)
  }

  function abrirEdicao(o: Obra) {
    setEditandoId(o.id)
    setNome(o.nome)
    setDescricao(o.descricao ?? '')
    setNomeEmpreendimento(o.nome_empreendimento ?? '')
    setRazaoSocial(o.razao_social ?? '')
    setEndereco(o.endereco ?? '')
    setCidade(o.cidade ?? '')
    setEstado(o.estado ?? '')
    setCnpj(o.cnpj ?? '')
    setCnoObra(o.cno_obra ?? '')
    setEnderecoEscritorio(o.endereco_escritorio ?? '')
    setCep(o.cep ?? '')
    setEmail(o.email ?? '')
    setEngenheiroObraNome(o.engenheiro_obra_nome ?? '')
    setEngenheiroObraCrea(o.engenheiro_obra_crea ?? '')
    setDataInicio(o.data_inicio ?? '')
    setDataFimPrevista(o.data_fim_prevista ?? '')
    setStatus(o.status)
    setLogoUrl(o.logo_url)
    setRodapePdf(o.rodape_pdf ?? '')
    setLogoArquivo(null)
    setMsg(null)
    setFormAberto(true)
  }

  async function salvar() {
    if (!nome.trim()) {
      setMsg({ tipo: 'erro', texto: 'Informe o nome da obra.' })
      return
    }
    if (logoArquivo && !rodapePdf.trim()) {
      setMsg({ tipo: 'erro', texto: 'Informe o texto do rodapé junto com a logo.' })
      return
    }
    setSalvando(true)
    setMsg(null)

    let novoLogoUrl = logoUrl
    if (logoArquivo && editandoId) {
      setEnviandoLogo(true)
      const caminho = `${editandoId}/logo.png`
      const { error: erroUpload } = await supabase.storage
        .from('obras-logos')
        .upload(caminho, logoArquivo, { upsert: true, contentType: 'image/png' })
      setEnviandoLogo(false)
      if (erroUpload) {
        setSalvando(false)
        setMsg({ tipo: 'erro', texto: `Erro ao enviar a logo: ${erroUpload.message}` })
        return
      }
      novoLogoUrl = caminho
    }

    const dados = {
      nome: nome.trim(),
      descricao: descricao.trim() || null,
      nome_empreendimento: nomeEmpreendimento.trim() || null,
      razao_social: razaoSocial.trim() || null,
      endereco: endereco.trim() || null,
      cidade: cidade.trim() || null,
      estado: estado.trim().toUpperCase() || null,
      cnpj: cnpj.trim() || null,
      cno_obra: cnoObra.trim() || null,
      endereco_escritorio: enderecoEscritorio.trim() || null,
      cep: cep.trim() || null,
      email: email.trim() || null,
      engenheiro_obra_nome: engenheiroObraNome.trim() || null,
      engenheiro_obra_crea: engenheiroObraCrea.trim() || null,
      data_inicio: dataInicio || null,
      data_fim_prevista: dataFimPrevista || null,
      status,
      logo_url: novoLogoUrl,
      rodape_pdf: rodapePdf.trim() || null,
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
    recarregar()
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
              Endereço Obra
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
            <label className={styles.campo}>
              Razão Social (para o quadro de emissão de Nota Fiscal)
              <input value={razaoSocial} onChange={e => setRazaoSocial(e.target.value)} placeholder="Opcional" />
            </label>
            <div className={styles.linha}>
              <label className={styles.campo}>
                CNPJ
                <input value={cnpj} onChange={e => setCnpj(e.target.value)} placeholder="Opcional" />
              </label>
              <label className={styles.campo}>
                CNO Obra
                <input value={cnoObra} onChange={e => setCnoObra(e.target.value)} placeholder="Opcional" />
              </label>
            </div>
            <div className={styles.linha}>
              <label className={styles.campo}>
                Endereço Escritório
                <input value={enderecoEscritorio} onChange={e => setEnderecoEscritorio(e.target.value)} placeholder="Opcional" />
              </label>
              <label className={styles.campo}>
                CEP
                <input value={cep} onChange={e => setCep(e.target.value)} placeholder="Opcional" />
              </label>
            </div>
            <label className={styles.campo}>
              Email
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="Opcional" />
            </label>
            <label className={styles.campo}>
              Nome do empreendimento (comercial, se diferente do nome da obra)
              <input
                value={nomeEmpreendimento}
                onChange={e => setNomeEmpreendimento(e.target.value)}
                placeholder="Ex.: Residencial Azaleia"
              />
            </label>
            <div className={styles.linha}>
              <label className={styles.campo}>
                Engenheiro da Obra
                <input value={engenheiroObraNome} onChange={e => setEngenheiroObraNome(e.target.value)} placeholder="Ex.: Rodrigo Teles Silva" />
              </label>
              <label className={styles.campo}>
                CREA
                <input value={engenheiroObraCrea} onChange={e => setEngenheiroObraCrea(e.target.value)} placeholder="Ex.: 1018712895 D/GO" />
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
            {editandoId && (
              <>
                <label className={styles.campo}>
                  Logo para os PDFs desta obra (PNG, fundo transparente)
                  <input
                    type="file"
                    accept="image/png"
                    onChange={e => setLogoArquivo(e.target.files?.[0] ?? null)}
                  />
                  {logoUrl && !logoArquivo && <small>Já existe uma logo cadastrada — escolher um arquivo novo substitui.</small>}
                  {enviandoLogo && <small>Enviando…</small>}
                </label>
                <label className={styles.campo}>
                  Texto do rodapé dos PDFs (deixe vazio para usar o padrão RT Engenharia)
                  <input
                    value={rodapePdf}
                    onChange={e => setRodapePdf(e.target.value)}
                    placeholder="Ex.: ENGEFER - Eng. Civil Rodrigo Teles - CREA 1018712895 D/GO"
                  />
                </label>
              </>
            )}
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
