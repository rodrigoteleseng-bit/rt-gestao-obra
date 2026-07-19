import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useObra } from '../contexts/ObraContext'
import { useConfirmDialog } from '../components/ConfirmDialogContext'
import { supabase, type ProjetoDocumento, type ProjetoPasta, type ProjetoRevisao } from '../lib/supabase'
import styles from './Projetos.module.css'

type Msg = { tipo: 'ok' | 'erro'; texto: string } | null
type RevisoesPorDocumento = Record<string, ProjetoRevisao[]>

const PASTA_NOVA = '__nova__'
const fmtDataHora = (iso?: string | null) => iso ? new Date(iso).toLocaleString('pt-BR') : '-'
const arquivoPdfValido = (file: File | null) => !!file && file.type === 'application/pdf'

function erroNomeDuplicado(error: { code?: string; message?: string } | null) {
  const msg = (error?.message ?? '').toLowerCase()
  return error?.code === '23505' || msg.includes('duplicate') || msg.includes('idx_projetos_pastas_nome_unico') || msg.includes('unique')
}

export default function Projetos() {
  const { perfil, temModulo } = useAuth()
  const { obraAtiva } = useObra()
  const { confirmar } = useConfirmDialog()
  const podeEditar = perfil?.papel === 'admin' || (perfil?.papel === 'equipe' && temModulo('projetos'))
  const cliente = perfil?.papel === 'cliente'
  const semPermissao = !cliente && !podeEditar

  const [documentos, setDocumentos] = useState<ProjetoDocumento[]>([])
  const [pastas, setPastas] = useState<ProjetoPasta[]>([])
  const [revisoes, setRevisoes] = useState<RevisoesPorDocumento>({})
  const [selecionadoId, setSelecionadoId] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [salvando, setSalvando] = useState(false)
  const [msg, setMsg] = useState<Msg>(null)
  const [busca, setBusca] = useState('')
  const [filtroPasta, setFiltroPasta] = useState('')
  const [novoAberto, setNovoAberto] = useState(false)
  const [novoTitulo, setNovoTitulo] = useState('')
  const [novoPastaId, setNovoPastaId] = useState('')
  const [novoNomePasta, setNovoNomePasta] = useState('')
  const [novaDescricao, setNovaDescricao] = useState('')
  const [novaRevisao, setNovaRevisao] = useState('')
  const [novoArquivo, setNovoArquivo] = useState<File | null>(null)
  const [novoArquivoKey, setNovoArquivoKey] = useState(0)
  const [revisaoAberta, setRevisaoAberta] = useState(false)
  const [revisaoCodigo, setRevisaoCodigo] = useState('')
  const [revisaoObservacao, setRevisaoObservacao] = useState('')
  const [revisaoArquivo, setRevisaoArquivo] = useState<File | null>(null)
  const [revisaoArquivoKey, setRevisaoArquivoKey] = useState(0)
  const [editando, setEditando] = useState(false)
  const [editTitulo, setEditTitulo] = useState('')
  const [editPastaId, setEditPastaId] = useState('')
  const [editDescricao, setEditDescricao] = useState('')
  const [gerenciarPastas, setGerenciarPastas] = useState(false)
  const [renomeandoId, setRenomeandoId] = useState<string | null>(null)
  const [renomeandoNome, setRenomeandoNome] = useState('')

  const pastasAtivas = useMemo(() => pastas.filter(p => p.ativo), [pastas])
  const pastaPorId = useMemo(() => new Map(pastas.map(p => [p.id, p])), [pastas])

  const documentosFiltrados = useMemo(() => {
    const termo = busca.trim().toLowerCase()
    return documentos.filter(doc => {
      const batePasta = !filtroPasta || doc.pasta_id === filtroPasta
      const bateBusca = !termo
        || doc.titulo.toLowerCase().includes(termo)
        || (doc.descricao ?? '').toLowerCase().includes(termo)
      return batePasta && bateBusca
    })
  }, [documentos, filtroPasta, busca])

  const selecionado = documentosFiltrados.find(d => d.id === selecionadoId) ?? null
  const pastasEdicao = useMemo(() => {
    if (!selecionado) return pastasAtivas
    return pastas.filter(p => p.ativo || p.id === selecionado.pasta_id)
  }, [pastas, pastasAtivas, selecionado?.id, selecionado?.pasta_id])
  const revisoesSelecionadas = selecionado ? (revisoes[selecionado.id] ?? []) : []
  const revisaoAtual = revisoesSelecionadas.find(r => r.atual) ?? null
  const revisoesHistoricas = revisoesSelecionadas.filter(r => !r.atual)
  const mostrarConteudo = !!filtroPasta || busca.trim().length > 0

  async function carregar() {
    if (!obraAtiva || semPermissao) {
      setCarregando(false)
      return
    }
    setCarregando(true)
    setMsg(null)
    const [docsResp, pastasResp] = await Promise.all([
      supabase.from('projetos_documentos').select('*').eq('obra_id', obraAtiva.id).eq('ativo', true).order('titulo'),
      supabase.from('projetos_pastas').select('*').eq('obra_id', obraAtiva.id).order('nome'),
    ])
    if (docsResp.error) {
      setMsg({ tipo: 'erro', texto: 'Erro ao carregar projetos: ' + docsResp.error.message })
      setDocumentos([])
      setRevisoes({})
      setPastas([])
      setCarregando(false)
      return
    }
    if (pastasResp.error) {
      setMsg({ tipo: 'erro', texto: 'Erro ao carregar pastas: ' + pastasResp.error.message })
      setPastas([])
    } else {
      setPastas((pastasResp.data ?? []) as ProjetoPasta[])
    }
    const lista = (docsResp.data ?? []) as ProjetoDocumento[]
    setDocumentos(lista)
    const ids = lista.map(d => d.id)
    if (ids.length === 0) {
      setRevisoes({})
      setCarregando(false)
      return
    }
    const revisoesResp = await supabase.from('projetos_revisoes').select('*').in('documento_id', ids).order('criado_em', { ascending: false })
    if (revisoesResp.error) {
      setMsg({ tipo: 'erro', texto: 'Documentos carregados, mas houve erro ao carregar revisões: ' + revisoesResp.error.message })
      setRevisoes({})
    } else {
      const agrupadas: RevisoesPorDocumento = {}
      for (const rev of (revisoesResp.data ?? []) as ProjetoRevisao[]) agrupadas[rev.documento_id] = [...(agrupadas[rev.documento_id] ?? []), rev]
      setRevisoes(agrupadas)
    }
    setCarregando(false)
  }

  useEffect(() => { carregar() }, [obraAtiva?.id, semPermissao])

  function nomePasta(id: string) {
    return pastaPorId.get(id)?.nome ?? 'Pasta não encontrada'
  }

  function limparNovo() {
    setNovoTitulo('')
    setNovoPastaId('')
    setNovoNomePasta('')
    setNovaDescricao('')
    setNovaRevisao('')
    setNovoArquivo(null)
    setNovoArquivoKey(k => k + 1)
  }

  function limparNovaRevisao() {
    setRevisaoCodigo('')
    setRevisaoObservacao('')
    setRevisaoArquivo(null)
    setRevisaoArquivoKey(k => k + 1)
  }

  function iniciarEdicao(doc: ProjetoDocumento) {
    setEditTitulo(doc.titulo)
    setEditPastaId(doc.pasta_id)
    setEditDescricao(doc.descricao ?? '')
    setEditando(true)
  }

  async function resolverPastaDocumento() {
    if (!obraAtiva) throw new Error('Selecione uma obra antes de cadastrar o documento.')
    if (novoPastaId && novoPastaId !== PASTA_NOVA) return { pastaId: novoPastaId, reaproveitada: false }
    if (!novoNomePasta.trim()) throw new Error('Informe o nome da nova pasta.')

    const nome = novoNomePasta.trim()
    const insertResp = await supabase.from('projetos_pastas').insert({ obra_id: obraAtiva.id, nome }).select('*').single()
    if (!insertResp.error && insertResp.data) return { pastaId: (insertResp.data as ProjetoPasta).id, reaproveitada: false }
    const erroInsert = insertResp.error
    if (!erroInsert) throw new Error('Erro ao criar pasta: resposta sem pasta criada.')
    if (!erroNomeDuplicado(erroInsert)) throw new Error('Erro ao criar pasta: ' + erroInsert.message)

    const existenteResp = await supabase
      .from('projetos_pastas')
      .select('*')
      .eq('obra_id', obraAtiva.id)
      .eq('ativo', true)
      .ilike('nome', nome)
      .limit(1)
      .maybeSingle()
    if (existenteResp.error || !existenteResp.data) throw new Error('A pasta já existia, mas não foi possível reaproveitá-la: ' + (existenteResp.error?.message ?? 'pasta não encontrada'))
    return { pastaId: (existenteResp.data as ProjetoPasta).id, reaproveitada: true }
  }

  async function salvarNovo(e: FormEvent) {
    e.preventDefault()
    setMsg(null)
    if (!obraAtiva) return setMsg({ tipo: 'erro', texto: 'Selecione uma obra antes de cadastrar o documento.' })
    if (!novoTitulo.trim()) return setMsg({ tipo: 'erro', texto: 'Informe o título do documento.' })
    if (!novoPastaId) return setMsg({ tipo: 'erro', texto: 'Selecione uma pasta ou crie uma nova.' })
    if (novoPastaId === PASTA_NOVA && !novoNomePasta.trim()) return setMsg({ tipo: 'erro', texto: 'Informe o nome da nova pasta.' })
    if (!novaRevisao.trim()) return setMsg({ tipo: 'erro', texto: 'Informe o código da revisão.' })
    if (!arquivoPdfValido(novoArquivo)) return setMsg({ tipo: 'erro', texto: 'Selecione um arquivo PDF válido.' })
    setSalvando(true)

    let pastaResolvida: { pastaId: string; reaproveitada: boolean }
    try {
      pastaResolvida = await resolverPastaDocumento()
    } catch (err) {
      setSalvando(false)
      return setMsg({ tipo: 'erro', texto: err instanceof Error ? err.message : 'Erro ao resolver pasta do documento.' })
    }

    const docResp = await supabase.from('projetos_documentos').insert({ obra_id: obraAtiva.id, titulo: novoTitulo.trim(), pasta_id: pastaResolvida.pastaId, descricao: novaDescricao.trim() || null }).select('*').single()
    if (docResp.error || !docResp.data) {
      setSalvando(false)
      return setMsg({ tipo: 'erro', texto: 'Erro ao criar documento: ' + (docResp.error?.message ?? 'registro não retornado') })
    }
    const documento = docResp.data as ProjetoDocumento
    const pathArquivo = obraAtiva.id + '/' + documento.id + '/' + Date.now() + '.pdf'
    const uploadResp = await supabase.storage.from('projetos').upload(pathArquivo, novoArquivo as File, { contentType: 'application/pdf' })
    if (uploadResp.error) {
      setSalvando(false)
      setSelecionadoId(documento.id)
      await carregar()
      return setMsg({ tipo: 'erro', texto: 'Documento criado, mas falhou o upload do PDF: ' + uploadResp.error.message })
    }
    const revResp = await supabase.from('projetos_revisoes').insert({ documento_id: documento.id, revisao: novaRevisao.trim(), path: uploadResp.data.path }).select('*').single()
    setSalvando(false)
    setSelecionadoId(documento.id)
    if (revResp.error) {
      await carregar()
      return setMsg({ tipo: 'erro', texto: 'PDF enviado, mas falhou o registro da revisão: ' + revResp.error.message })
    }
    limparNovo()
    setNovoAberto(false)
    setMsg({ tipo: 'ok', texto: pastaResolvida.reaproveitada ? 'Documento cadastrado. A pasta informada já existia e foi reaproveitada.' : 'Documento cadastrado com a primeira revisão.' })
    await carregar()
  }

  async function salvarNovaRevisao(e: FormEvent) {
    e.preventDefault()
    setMsg(null)
    if (!obraAtiva || !selecionado) return setMsg({ tipo: 'erro', texto: 'Selecione um documento antes de subir uma revisão.' })
    if (!revisaoCodigo.trim()) return setMsg({ tipo: 'erro', texto: 'Informe o código da revisão.' })
    if (!arquivoPdfValido(revisaoArquivo)) return setMsg({ tipo: 'erro', texto: 'Selecione um arquivo PDF válido.' })
    setSalvando(true)
    const pathArquivo = obraAtiva.id + '/' + selecionado.id + '/' + Date.now() + '.pdf'
    const uploadResp = await supabase.storage.from('projetos').upload(pathArquivo, revisaoArquivo as File, { contentType: 'application/pdf' })
    if (uploadResp.error) {
      setSalvando(false)
      return setMsg({ tipo: 'erro', texto: 'Erro ao enviar PDF da revisão: ' + uploadResp.error.message })
    }
    const revResp = await supabase.from('projetos_revisoes').insert({ documento_id: selecionado.id, revisao: revisaoCodigo.trim(), observacao: revisaoObservacao.trim() || null, path: uploadResp.data.path })
    setSalvando(false)
    if (revResp.error) return setMsg({ tipo: 'erro', texto: 'PDF enviado, mas falhou o registro da revisão: ' + revResp.error.message })
    limparNovaRevisao()
    setRevisaoAberta(false)
    setMsg({ tipo: 'ok', texto: 'Nova revisão cadastrada como atual.' })
    await carregar()
  }

  async function salvarEdicao(e: FormEvent) {
    e.preventDefault()
    setMsg(null)
    if (!selecionado) return
    if (!editTitulo.trim()) return setMsg({ tipo: 'erro', texto: 'Informe o título do documento.' })
    if (!editPastaId) return setMsg({ tipo: 'erro', texto: 'Selecione a pasta do documento.' })
    setSalvando(true)
    const { error } = await supabase.from('projetos_documentos').update({ titulo: editTitulo.trim(), pasta_id: editPastaId, descricao: editDescricao.trim() || null }).eq('id', selecionado.id)
    setSalvando(false)
    if (error) return setMsg({ tipo: 'erro', texto: 'Erro ao editar documento: ' + error.message })
    setEditando(false)
    setMsg({ tipo: 'ok', texto: 'Documento atualizado.' })
    await carregar()
  }

  async function salvarRenomearPasta(pasta: ProjetoPasta) {
    setMsg(null)
    if (!renomeandoNome.trim()) return setMsg({ tipo: 'erro', texto: 'Informe o nome da pasta.' })
    setSalvando(true)
    const { error } = await supabase.from('projetos_pastas').update({ nome: renomeandoNome.trim() }).eq('id', pasta.id)
    setSalvando(false)
    if (error) return setMsg({ tipo: 'erro', texto: erroNomeDuplicado(error) ? 'Já existe uma pasta com esse nome.' : 'Erro ao renomear pasta: ' + error.message })
    setRenomeandoId(null)
    setRenomeandoNome('')
    setMsg({ tipo: 'ok', texto: 'Pasta renomeada.' })
    await carregar()
  }

  async function inativarPasta(pasta: ProjetoPasta) {
    const ok = await confirmar({ titulo: 'Inativar pasta', mensagem: 'Os documentos desta pasta continuam preservados e visíveis para quem edita o módulo Projetos.', confirmarTexto: 'Inativar', perigoso: true })
    if (!ok) return
    setSalvando(true)
    const { error } = await supabase.from('projetos_pastas').update({ ativo: false }).eq('id', pasta.id)
    setSalvando(false)
    if (error) return setMsg({ tipo: 'erro', texto: 'Erro ao inativar pasta: ' + error.message })
    if (filtroPasta === pasta.id) setFiltroPasta('')
    setMsg({ tipo: 'ok', texto: 'Pasta inativada.' })
    await carregar()
  }

  async function inativarDocumento() {
    if (!selecionado) return
    const ok = await confirmar({ titulo: 'Inativar documento', mensagem: 'O documento deixará de aparecer na lista, mas todas as revisões serão preservadas no banco e no storage.', confirmarTexto: 'Inativar', perigoso: true })
    if (!ok) return
    setSalvando(true)
    const { error } = await supabase.from('projetos_documentos').update({ ativo: false }).eq('id', selecionado.id)
    setSalvando(false)
    if (error) return setMsg({ tipo: 'erro', texto: 'Erro ao inativar documento: ' + error.message })
    setSelecionadoId(null)
    setMsg({ tipo: 'ok', texto: 'Documento inativado.' })
    await carregar()
  }

  async function abrirRevisao(rev: ProjetoRevisao) {
    setMsg(null)
    const { data, error } = await supabase.storage.from('projetos').createSignedUrl(rev.path, 300)
    if (error || !data?.signedUrl) return setMsg({ tipo: 'erro', texto: 'Erro ao abrir PDF: ' + (error?.message ?? 'URL não retornada') })
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer')
  }

  if (semPermissao) return <div className={styles.page}><h1>Projetos</h1><div className={styles.msgErro}>Você não tem permissão para acessar Projetos.</div></div>

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div><h1>Projetos</h1><p className={styles.sub}>Repositório versionado de projetos executivos, memoriais e documentos administrativos da obra.</p></div>
        {podeEditar && <div className={styles.headerAcoes}><button className={styles.btnSecundario} onClick={() => setGerenciarPastas(v => !v)}>{gerenciarPastas ? 'Fechar pastas' : 'Gerenciar pastas'}</button><button className={styles.btnPrimario} onClick={() => setNovoAberto(v => !v)}>{novoAberto ? 'Fechar' : 'Novo documento'}</button></div>}
      </div>
      {msg && <div className={msg.tipo === 'ok' ? styles.msgOk : styles.msgErro}>{msg.texto}</div>}

      {gerenciarPastas && podeEditar && (
        <div className={styles.formulario}>
          <div className={styles.formHeader}><h2>Pastas</h2></div>
          {pastasAtivas.length === 0 ? <div className={styles.vazioInterno}>Nenhuma pasta ativa.</div> : <div className={styles.pastasLista}>{pastasAtivas.map(pasta => <div key={pasta.id} className={styles.pastaLinha}>{renomeandoId === pasta.id ? <><input value={renomeandoNome} onChange={e => setRenomeandoNome(e.target.value)} /><button className={styles.btnPrimario} disabled={salvando} onClick={() => salvarRenomearPasta(pasta)}>Salvar</button><button className={styles.btnSecundario} onClick={() => { setRenomeandoId(null); setRenomeandoNome('') }}>Cancelar</button></> : <><span>{pasta.nome}</span><button className={styles.btnSecundario} onClick={() => { setRenomeandoId(pasta.id); setRenomeandoNome(pasta.nome) }}>Renomear</button><button className={styles.btnPerigo} onClick={() => inativarPasta(pasta)}>Inativar</button></>}</div>)}</div>}
        </div>
      )}

      {novoAberto && podeEditar && (
        <form className={styles.formulario} onSubmit={salvarNovo}>
          <div className={styles.formHeader}><h2>Novo documento</h2></div>
          <div className={styles.campos}>
            <label className={styles.campo}>Título<input value={novoTitulo} onChange={e => setNovoTitulo(e.target.value)} /></label>
            <div className={styles.linha2}>
              <label className={styles.campo}>Pasta<select value={novoPastaId} onChange={e => setNovoPastaId(e.target.value)}><option value="">Selecione</option>{pastasAtivas.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}<option value={PASTA_NOVA}>+ Nova pasta</option></select></label>
              <label className={styles.campo}>Revisão<input value={novaRevisao} onChange={e => setNovaRevisao(e.target.value)} placeholder="R00" /></label>
            </div>
            {novoPastaId === PASTA_NOVA && <label className={styles.campo}>Nome da nova pasta<input value={novoNomePasta} onChange={e => setNovoNomePasta(e.target.value)} placeholder="Ex.: Estrutura" /></label>}
            <label className={styles.campo}>Descrição<textarea value={novaDescricao} onChange={e => setNovaDescricao(e.target.value)} /></label>
            <label className={styles.campo}>Arquivo PDF<input key={novoArquivoKey} type="file" accept="application/pdf" onChange={e => setNovoArquivo(e.target.files?.[0] ?? null)} /></label>
          </div>
          <div className={styles.acoesForm}><button className={styles.btnPrimario} disabled={salvando}>{salvando ? 'Salvando...' : 'Salvar documento'}</button><button type="button" className={styles.btnSecundario} onClick={() => { limparNovo(); setNovoAberto(false) }}>Cancelar</button></div>
        </form>
      )}

      <div className={styles.filtros}>
        <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar por título" />
        <select value={filtroPasta} onChange={e => setFiltroPasta(e.target.value)}><option value="">Selecione uma pasta</option>{pastasAtivas.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}</select>
      </div>

      {carregando ? <div className={styles.vazio}>Carregando projetos...</div> : documentos.length === 0 ? <div className={styles.vazio}>Nenhum documento cadastrado.</div> : !mostrarConteudo ? <div className={styles.vazio}>Selecione uma pasta para ver os documentos.</div> : documentosFiltrados.length === 0 ? <div className={styles.vazio}>Nenhum documento encontrado para os filtros.</div> : (
        <div className={styles.conteudo}>{documentosFiltrados.map(doc => {
          const atual = (revisoes[doc.id] ?? []).find(r => r.atual)
          const expandido = selecionadoId === doc.id
          const alternarExpansao = () => {
            setSelecionadoId(expandido ? null : doc.id)
            setEditando(false)
            setRevisaoAberta(false)
          }
          return (
            <div key={doc.id} className={[styles.card, expandido ? styles.cardAtivo : ''].filter(Boolean).join(' ')}>
              <div
                role="button"
                tabIndex={0}
                className={styles.cardCabecalho}
                onClick={alternarExpansao}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); alternarExpansao() } }}
              >
                <div className={styles.cardTopo}><span className={styles.cardTitulo}>{doc.titulo}</span><span className={styles.chip}>{nomePasta(doc.pasta_id)}</span></div>
                <div className={styles.cardMeta}>
                  <span>{atual ? 'Atual: ' + atual.revisao + ' • ' + fmtDataHora(atual.criado_em) : 'Sem revisão registrada'}</span>
                  {atual && <button type="button" className={styles.btnAbrirCard} onClick={e => { e.stopPropagation(); abrirRevisao(atual) }}>Abrir</button>}
                </div>
                {!expandido && doc.descricao && <div className={styles.cardDescricao}>{doc.descricao}</div>}
              </div>
              {expandido && selecionado && (
                <div className={styles.detalhe}>
                  <div className={styles.detalheTopo}><div><h2>{selecionado.titulo}</h2><span className={styles.chip}>{nomePasta(selecionado.pasta_id)}</span></div>{podeEditar && <div className={styles.acoesLinha}><button className={styles.btnSecundario} onClick={() => iniciarEdicao(selecionado)}>Editar</button><button className={styles.btnPerigo} onClick={inativarDocumento}>Inativar</button></div>}</div>
                  {selecionado.descricao && <p className={styles.descricao}>{selecionado.descricao}</p>}
                  {editando && podeEditar && <form className={styles.box} onSubmit={salvarEdicao}><div className={styles.campos}><label className={styles.campo}>Título<input value={editTitulo} onChange={e => setEditTitulo(e.target.value)} /></label><label className={styles.campo}>Pasta<select value={editPastaId} onChange={e => setEditPastaId(e.target.value)}>{pastasEdicao.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}</select></label><label className={styles.campo}>Descrição<textarea value={editDescricao} onChange={e => setEditDescricao(e.target.value)} /></label></div><div className={styles.acoesForm}><button className={styles.btnPrimario} disabled={salvando}>Salvar edição</button><button type="button" className={styles.btnSecundario} onClick={() => setEditando(false)}>Cancelar</button></div></form>}
                  <div className={styles.revisaoAtual}><h3>Revisão atual</h3>{revisaoAtual ? <div className={styles.revisaoLinha}><div><b>{revisaoAtual.revisao}</b><span>{fmtDataHora(revisaoAtual.criado_em)}</span>{revisaoAtual.observacao && <p>{revisaoAtual.observacao}</p>}</div><button className={styles.btnPrimario} onClick={() => abrirRevisao(revisaoAtual)}>Abrir</button></div> : <p>Nenhuma revisão registrada para este documento.</p>}</div>
                  {podeEditar && <button className={styles.btnSecundario} onClick={() => setRevisaoAberta(v => !v)}>{revisaoAberta ? 'Fechar revisão' : 'Nova revisão'}</button>}
                  {revisaoAberta && podeEditar && <form className={styles.box} onSubmit={salvarNovaRevisao}><div className={styles.campos}><label className={styles.campo}>Revisão<input value={revisaoCodigo} onChange={e => setRevisaoCodigo(e.target.value)} placeholder="R01" /></label><label className={styles.campo}>Observação<textarea value={revisaoObservacao} onChange={e => setRevisaoObservacao(e.target.value)} /></label><label className={styles.campo}>Arquivo PDF<input key={revisaoArquivoKey} type="file" accept="application/pdf" onChange={e => setRevisaoArquivo(e.target.files?.[0] ?? null)} /></label></div><div className={styles.acoesForm}><button className={styles.btnPrimario} disabled={salvando}>Salvar revisão</button><button type="button" className={styles.btnSecundario} onClick={() => { limparNovaRevisao(); setRevisaoAberta(false) }}>Cancelar</button></div></form>}
                  <div className={styles.historico}><h3>Histórico de revisões</h3>{revisoesHistoricas.length === 0 ? <p>Nenhuma revisão anterior.</p> : revisoesHistoricas.map(rev => <div key={rev.id} className={styles.revisaoLinha}><div><b>{rev.revisao}</b><span>{fmtDataHora(rev.criado_em)}</span>{rev.observacao && <p>{rev.observacao}</p>}</div><button className={styles.btnSecundario} onClick={() => abrirRevisao(rev)}>Abrir</button></div>)}</div>
                </div>
              )}
            </div>
          )
        })}</div>
      )}
    </div>
  )
}
