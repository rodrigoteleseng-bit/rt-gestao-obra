import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useObra } from '../contexts/ObraContext'
import { useConfirmDialog } from '../components/ConfirmDialogContext'
import { supabase, type Etapa, type PerfilUsuario, type PrioridadeTarefa, type Servico, type StatusTarefa, type Tarefa, type TarefaComentario, type Unidade } from '../lib/supabase'
import { dataHoje } from '../lib/almoxarifado'
import styles from './Tarefas.module.css'

const STATUS_LABEL: Record<StatusTarefa, string> = { aberta: 'Aberta', em_andamento: 'Em andamento', concluida: 'Concluída', cancelada: 'Cancelada' }
const PRIORIDADE_LABEL: Record<PrioridadeTarefa, string> = { baixa: 'Baixa', normal: 'Normal', alta: 'Alta', urgente: 'Urgente' }
const STATUS_ATIVOS: StatusTarefa[] = ['aberta', 'em_andamento']
const fmtData = (iso: string) => iso ? new Date(iso + 'T00:00:00').toLocaleDateString('pt-BR') : '-'
const nomeCurto = (perfil?: PerfilUsuario | null) => perfil ? (perfil.nome || perfil.email) : 'Sem responsável'

export default function Tarefas() {
  const { perfil, temModulo } = useAuth()
  const { obraAtiva } = useObra()
  const { confirmar, solicitarTexto } = useConfirmDialog()
  const podeEditar = perfil?.papel === 'admin' || temModulo('tarefas')
  const cliente = perfil?.papel === 'cliente'

  const [tarefas, setTarefas] = useState<Tarefa[]>([])
  const [comentarios, setComentarios] = useState<TarefaComentario[]>([])
  const [usuarios, setUsuarios] = useState<PerfilUsuario[]>([])
  const [unidades, setUnidades] = useState<Unidade[]>([])
  const [etapas, setEtapas] = useState<Etapa[]>([])
  const [servicos, setServicos] = useState<Servico[]>([])
  const [selecionadaId, setSelecionadaId] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [salvando, setSalvando] = useState(false)
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)
  const [filtroStatus, setFiltroStatus] = useState<StatusTarefa | ''>('')
  const [filtroResp, setFiltroResp] = useState('')
  const [filtroPrioridade, setFiltroPrioridade] = useState<PrioridadeTarefa | ''>('')
  const [filtroAtrasadas, setFiltroAtrasadas] = useState(false)
  const [filtroMinhas, setFiltroMinhas] = useState(false)
  const [busca, setBusca] = useState('')
  const [formAberto, setFormAberto] = useState(false)
  const [editandoId, setEditandoId] = useState<string | null>(null)
  const [titulo, setTitulo] = useState('')
  const [descricao, setDescricao] = useState('')
  const [responsavelId, setResponsavelId] = useState('')
  const [prazo, setPrazo] = useState('')
  const [prioridade, setPrioridade] = useState<PrioridadeTarefa>('normal')
  const [unidadeId, setUnidadeId] = useState('')
  const [etapaId, setEtapaId] = useState('')
  const [servicoId, setServicoId] = useState('')
  const [comentarioNovo, setComentarioNovo] = useState('')

  const usuarioPorId = useMemo(() => new Map(usuarios.map(u => [u.id, u])), [usuarios])
  const unidadePorId = useMemo(() => new Map(unidades.map(u => [u.id, u])), [unidades])
  const etapaPorId = useMemo(() => new Map(etapas.map(e => [e.id, e])), [etapas])
  const servicoPorId = useMemo(() => new Map(servicos.map(s => [s.id, s])), [servicos])
  const selecionada = tarefas.find(t => t.id === selecionadaId) ?? tarefas[0] ?? null

  function vencida(t: Tarefa) { return STATUS_ATIVOS.includes(t.status) && t.prazo < dataHoje() }

  async function carregar() {
    if (!obraAtiva || cliente) { setCarregando(false); return }
    setCarregando(true); setMsg(null)
    const [tarefasResp, usuariosResp, unidadesResp] = await Promise.all([
      supabase.from('tarefas').select('*').eq('obra_id', obraAtiva.id).eq('ativo', true),
      supabase.from('perfis_usuario').select('*').eq('ativo', true).neq('papel', 'cliente').order('nome'),
      supabase.from('unidades').select('*').eq('obra_id', obraAtiva.id).eq('ativo', true).order('ordem'),
    ])
    if (tarefasResp.error) setMsg({ tipo: 'erro', texto: 'Erro ao carregar tarefas: ' + tarefasResp.error.message })
    setTarefas((tarefasResp.data ?? []) as Tarefa[])
    setUsuarios((usuariosResp.data ?? []) as PerfilUsuario[])
    setUnidades((unidadesResp.data ?? []) as Unidade[])
    const unidadeIds = (unidadesResp.data ?? []).map(u => u.id)
    if (unidadeIds.length > 0) {
      const etapasResp = await supabase.from('etapas').select('*').in('unidade_id', unidadeIds).eq('ativo', true).order('ordem')
      const etapasLista = (etapasResp.data ?? []) as Etapa[]
      setEtapas(etapasLista)
      const etapaIds = etapasLista.map(e => e.id)
      if (etapaIds.length > 0) {
        const servicosResp = await supabase.from('servicos').select('*').in('etapa_id', etapaIds).eq('ativo', true).order('nome')
        setServicos((servicosResp.data ?? []) as Servico[])
      } else setServicos([])
    } else { setEtapas([]); setServicos([]) }
    setCarregando(false)
  }

  useEffect(() => { carregar() }, [obraAtiva?.id, cliente])
  useEffect(() => {
    if (!selecionada) { setComentarios([]); return }
    supabase.from('tarefas_comentarios').select('*').eq('tarefa_id', selecionada.id).order('criado_em', { ascending: false })
      .then(({ data, error }) => { if (error) setMsg({ tipo: 'erro', texto: 'Erro ao carregar comentários: ' + error.message }); setComentarios((data ?? []) as TarefaComentario[]) })
  }, [selecionada?.id])
  useEffect(() => { if (selecionadaId && !tarefas.some(t => t.id === selecionadaId)) setSelecionadaId(null) }, [tarefas, selecionadaId])

  const etapasFiltradas = useMemo(() => etapas.filter(e => !unidadeId || e.unidade_id === unidadeId), [etapas, unidadeId])
  const servicosFiltrados = useMemo(() => servicos.filter(s => !etapaId || s.etapa_id === etapaId), [servicos, etapaId])
  const filtradas = useMemo(() => {
    const termo = busca.trim().toLocaleLowerCase('pt-BR')
    return tarefas.filter(t => (!filtroStatus || t.status === filtroStatus) && (!filtroResp || (filtroResp === '__sem__' ? !t.responsavel_id : t.responsavel_id === filtroResp)) && (!filtroPrioridade || t.prioridade === filtroPrioridade) && (!filtroAtrasadas || vencida(t)) && (!filtroMinhas || t.responsavel_id === perfil?.id) && (!termo || t.titulo.toLocaleLowerCase('pt-BR').includes(termo) || (t.descricao ?? '').toLocaleLowerCase('pt-BR').includes(termo))).sort((a, b) => {
      const va = vencida(a) ? 1 : 0; const vb = vencida(b) ? 1 : 0
      if (va !== vb) return vb - va
      if (a.status !== b.status) return STATUS_ATIVOS.includes(a.status) ? -1 : 1
      if (a.prazo !== b.prazo) return a.prazo.localeCompare(b.prazo)
      return b.criado_em.localeCompare(a.criado_em)
    })
  }, [tarefas, filtroStatus, filtroResp, filtroPrioridade, filtroAtrasadas, filtroMinhas, busca, perfil?.id])
  const contagem = useMemo(() => ({ aberta: tarefas.filter(t => t.status === 'aberta').length, em_andamento: tarefas.filter(t => t.status === 'em_andamento').length, concluida: tarefas.filter(t => t.status === 'concluida').length, cancelada: tarefas.filter(t => t.status === 'cancelada').length, atrasadas: tarefas.filter(vencida).length }), [tarefas])

  function abrirNovo() { setEditandoId(null); setTitulo(''); setDescricao(''); setResponsavelId(''); setPrazo(''); setPrioridade('normal'); setUnidadeId(''); setEtapaId(''); setServicoId(''); setFormAberto(true); setMsg(null) }
  function abrirEdicao(t: Tarefa) { setEditandoId(t.id); setTitulo(t.titulo); setDescricao(t.descricao ?? ''); setResponsavelId(t.responsavel_id ?? ''); setPrazo(t.prazo); setPrioridade(t.prioridade); setUnidadeId(t.unidade_id ?? ''); setEtapaId(t.etapa_id ?? ''); setServicoId(t.servico_id ?? ''); setFormAberto(true); setMsg(null) }

  async function salvarTarefa() {
    if (!obraAtiva) return
    if (!titulo.trim()) { setMsg({ tipo: 'erro', texto: 'Informe o título da tarefa.' }); return }
    if (!prazo) { setMsg({ tipo: 'erro', texto: 'Informe o prazo da tarefa.' }); return }
    setSalvando(true); setMsg(null)
    const dados = { titulo: titulo.trim(), descricao: descricao.trim() || null, responsavel_id: responsavelId || null, prazo, prioridade, unidade_id: unidadeId || null, etapa_id: etapaId || null, servico_id: servicoId || null }
    const { error } = editandoId ? await supabase.from('tarefas').update(dados).eq('id', editandoId) : await supabase.from('tarefas').insert({ ...dados, obra_id: obraAtiva.id })
    setSalvando(false)
    if (error) { setMsg({ tipo: 'erro', texto: 'Erro ao salvar tarefa: ' + error.message }); return }
    setMsg({ tipo: 'ok', texto: editandoId ? 'Tarefa atualizada.' : 'Tarefa criada.' }); setFormAberto(false); await carregar()
  }

  async function alterarStatus(t: Tarefa, status: StatusTarefa) {
    let motivo_cancelamento: string | null = null
    if (status === 'cancelada') {
      const motivo = await solicitarTexto({ titulo: 'Cancelar tarefa', mensagem: 'Informe o motivo do cancelamento. Esse registro ficará no histórico.', confirmarTexto: 'Cancelar tarefa', cancelarTexto: 'Voltar', perigoso: true, campo: { rotulo: 'Motivo', placeholder: 'Ex.: Escopo deixou de existir' } })
      if (!motivo) return
      motivo_cancelamento = motivo
    }
    const { error } = await supabase.from('tarefas').update({ status, motivo_cancelamento }).eq('id', t.id)
    if (error) { setMsg({ tipo: 'erro', texto: 'Erro ao alterar status: ' + error.message }); return }
    setMsg({ tipo: 'ok', texto: 'Status atualizado.' }); await carregar()
  }

  async function arquivar(t: Tarefa) {
    const ok = await confirmar({ titulo: 'Arquivar tarefa', mensagem: 'A tarefa será inativada e preservada no banco para rastreabilidade.', confirmarTexto: 'Arquivar', cancelarTexto: 'Voltar', perigoso: true })
    if (!ok) return
    const { error } = await supabase.from('tarefas').update({ ativo: false }).eq('id', t.id)
    if (error) { setMsg({ tipo: 'erro', texto: 'Erro ao arquivar: ' + error.message }); return }
    setMsg({ tipo: 'ok', texto: 'Tarefa arquivada.' }); await carregar()
  }

  async function adicionarComentario() {
    if (!selecionada || !comentarioNovo.trim()) return
    const { error } = await supabase.from('tarefas_comentarios').insert({ tarefa_id: selecionada.id, tipo: 'comentario', comentario: comentarioNovo.trim() })
    if (error) { setMsg({ tipo: 'erro', texto: 'Erro ao comentar: ' + error.message }); return }
    setComentarioNovo('')
    const { data } = await supabase.from('tarefas_comentarios').select('*').eq('tarefa_id', selecionada.id).order('criado_em', { ascending: false })
    setComentarios((data ?? []) as TarefaComentario[])
  }
  function podeConcluir(t: Tarefa) { return podeEditar && STATUS_ATIVOS.includes(t.status) && (perfil?.papel === 'admin' || t.responsavel_id === perfil?.id) }
  function podeEditarDados(t: Tarefa) { return podeEditar && STATUS_ATIVOS.includes(t.status) }

  if (cliente) return <div className={styles.page}><p className={styles.vazio}>Módulo de uso interno da equipe de obra.</p></div>
  if (!podeEditar) return <div className={styles.page}><p className={styles.vazio}>Você não tem permissão para acessar Tarefas.</p></div>

  return <div className={styles.page}>
    <div className={styles.header}><div><h1>Tarefas</h1><p className={styles.sub}>Ações avulsas da obra com prazo, responsável, histórico e controle de status.</p></div><button className={styles.btnPrimario} onClick={abrirNovo}>+ Nova tarefa</button></div>
    {msg && <p className={msg.tipo === 'ok' ? styles.msgOk : styles.msgErro}>{msg.texto}</p>}
    <div className={styles.contadores}>{(['aberta', 'em_andamento', 'concluida', 'cancelada'] as StatusTarefa[]).map(status => <button key={status} className={styles.contador} onClick={() => setFiltroStatus(filtroStatus === status ? '' : status)}><span className={styles.contNum}>{contagem[status]}</span><span className={styles.contLabel}>{STATUS_LABEL[status]}</span></button>)}<button className={styles.contador + ' ' + styles.contAtraso} onClick={() => setFiltroAtrasadas(v => !v)}><span className={styles.contNum}>{contagem.atrasadas}</span><span className={styles.contLabel}>Atrasadas</span></button></div>
    {formAberto && <section className={styles.formulario}><div className={styles.formHeader}><h2>{editandoId ? 'Editar tarefa' : 'Nova tarefa'}</h2><button className={styles.btnTexto} onClick={() => setFormAberto(false)}>Fechar</button></div><div className={styles.campos}><label className={styles.campo}>Título *<input value={titulo} onChange={e => setTitulo(e.target.value)} placeholder="Ex.: Conferir entrega dos blocos" /></label><label className={styles.campo}>Descrição<textarea value={descricao} onChange={e => setDescricao(e.target.value)} placeholder="Detalhe o que precisa ser feito" /></label><div className={styles.linha3}><label className={styles.campo}>Responsável<select value={responsavelId} onChange={e => setResponsavelId(e.target.value)}><option value="">Sem responsável definido</option>{usuarios.map(u => <option key={u.id} value={u.id}>{nomeCurto(u)}</option>)}</select></label><label className={styles.campo}>Prazo *<input type="date" value={prazo} onChange={e => setPrazo(e.target.value)} /></label><label className={styles.campo}>Prioridade<select value={prioridade} onChange={e => setPrioridade(e.target.value as PrioridadeTarefa)}>{(Object.keys(PRIORIDADE_LABEL) as PrioridadeTarefa[]).map(p => <option key={p} value={p}>{PRIORIDADE_LABEL[p]}</option>)}</select></label></div><div className={styles.linha3}><label className={styles.campo}>Unidade<select value={unidadeId} onChange={e => { setUnidadeId(e.target.value); setEtapaId(''); setServicoId('') }}><option value="">Sem vínculo</option>{unidades.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}</select></label><label className={styles.campo}>Etapa<select value={etapaId} onChange={e => { setEtapaId(e.target.value); setServicoId('') }}><option value="">Sem vínculo</option>{etapasFiltradas.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}</select></label><label className={styles.campo}>Serviço<select value={servicoId} onChange={e => setServicoId(e.target.value)}><option value="">Sem vínculo</option>{servicosFiltrados.map(s => <option key={s.id} value={s.id}>{s.nome}</option>)}</select></label></div></div><div className={styles.acoesForm}><button className={styles.btnPrimario} onClick={salvarTarefa} disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar tarefa'}</button><button className={styles.btnSecundario} onClick={() => setFormAberto(false)}>Cancelar</button></div></section>}
    <div className={styles.filtros}><input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar por título ou descrição" /><select value={filtroStatus} onChange={e => setFiltroStatus(e.target.value as StatusTarefa | '')}><option value="">Todos os status</option>{(Object.keys(STATUS_LABEL) as StatusTarefa[]).map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select><select value={filtroResp} onChange={e => setFiltroResp(e.target.value)}><option value="">Todos os responsáveis</option><option value="__sem__">Sem responsável</option>{usuarios.map(u => <option key={u.id} value={u.id}>{nomeCurto(u)}</option>)}</select><select value={filtroPrioridade} onChange={e => setFiltroPrioridade(e.target.value as PrioridadeTarefa | '')}><option value="">Todas as prioridades</option>{(Object.keys(PRIORIDADE_LABEL) as PrioridadeTarefa[]).map(p => <option key={p} value={p}>{PRIORIDADE_LABEL[p]}</option>)}</select><label className={styles.check}><input type="checkbox" checked={filtroMinhas} onChange={e => setFiltroMinhas(e.target.checked)} /> Minhas</label><label className={styles.check}><input type="checkbox" checked={filtroAtrasadas} onChange={e => setFiltroAtrasadas(e.target.checked)} /> Atrasadas</label></div>
    <div className={styles.conteudo}><section className={styles.lista}>{carregando && <p className={styles.vazio}>Carregando…</p>}{!carregando && filtradas.length === 0 && <p className={styles.vazio}>{tarefas.length === 0 ? 'Nenhuma tarefa registrada.' : 'Nenhuma tarefa com esses filtros.'}</p>}{filtradas.map(t => <button key={t.id} className={styles.card + ' ' + (selecionada?.id === t.id ? styles.cardAtivo : '') + ' ' + (vencida(t) ? styles.cardVencida : '')} onClick={() => setSelecionadaId(t.id)}><div className={styles.cardTopo}><span className={styles.cardTitulo}>{t.titulo}</span><span className={styles.chip + ' ' + styles['chip_' + t.status]}>{STATUS_LABEL[t.status]}</span></div><div className={styles.cardMeta}>{PRIORIDADE_LABEL[t.prioridade]} · {nomeCurto(usuarioPorId.get(t.responsavel_id ?? ''))}</div><div className={styles.cardRodape}><span className={vencida(t) ? styles.prazoVencido : ''}>Prazo: {fmtData(t.prazo)}</span></div></button>)}</section><section className={styles.detalhe}>{!selecionada ? <p className={styles.vazio}>Selecione uma tarefa.</p> : <><div className={styles.detalheTopo}><div><h2>{selecionada.titulo}</h2><p>{selecionada.descricao ?? 'Sem descrição.'}</p></div><span className={styles.chip + ' ' + styles['chip_' + selecionada.status]}>{STATUS_LABEL[selecionada.status]}</span></div><div className={styles.metaGrid}><span><b>Responsável</b>{nomeCurto(usuarioPorId.get(selecionada.responsavel_id ?? ''))}</span><span><b>Prazo</b>{fmtData(selecionada.prazo)}</span><span><b>Prioridade</b>{PRIORIDADE_LABEL[selecionada.prioridade]}</span><span><b>Unidade</b>{selecionada.unidade_id ? unidadePorId.get(selecionada.unidade_id)?.nome ?? '-' : '-'}</span><span><b>Etapa</b>{selecionada.etapa_id ? etapaPorId.get(selecionada.etapa_id)?.nome ?? '-' : '-'}</span><span><b>Serviço</b>{selecionada.servico_id ? servicoPorId.get(selecionada.servico_id)?.nome ?? '-' : '-'}</span></div><div className={styles.acoesStatus}>{selecionada.status === 'aberta' && <button className={styles.btnSecundario} onClick={() => alterarStatus(selecionada, 'em_andamento')}>Iniciar</button>}{podeConcluir(selecionada) && <button className={styles.btnPrimario} onClick={() => alterarStatus(selecionada, 'concluida')}>Concluir</button>}{STATUS_ATIVOS.includes(selecionada.status) && <button className={styles.btnPerigo} onClick={() => alterarStatus(selecionada, 'cancelada')}>Cancelar</button>}{perfil?.papel === 'admin' && ['concluida', 'cancelada'].includes(selecionada.status) && <button className={styles.btnSecundario} onClick={() => alterarStatus(selecionada, 'aberta')}>Reabrir</button>}{podeEditarDados(selecionada) && <button className={styles.btnSecundario} onClick={() => abrirEdicao(selecionada)}>Editar</button>}<button className={styles.btnTextoPerigo} onClick={() => arquivar(selecionada)}>Arquivar</button></div><div className={styles.comentarioBox}><textarea value={comentarioNovo} onChange={e => setComentarioNovo(e.target.value)} placeholder="Adicionar comentário" /><button className={styles.btnSecundario} onClick={adicionarComentario} disabled={!comentarioNovo.trim()}>Comentar</button></div><h3>Histórico</h3><div className={styles.historico}>{comentarios.length === 0 && <p className={styles.vazio}>Sem comentários.</p>}{comentarios.map(c => <div key={c.id} className={styles.evento}><div><b>{c.tipo}</b> · {usuarioPorId.get(c.criado_por)?.nome ?? 'Sistema'} · {new Date(c.criado_em).toLocaleString('pt-BR')}</div><p>{c.comentario}</p></div>)}</div></>}</section></div>
  </div>
}
