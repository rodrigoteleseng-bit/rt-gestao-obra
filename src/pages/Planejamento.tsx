import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useObra } from '../contexts/ObraContext'
import { useConfirmDialog } from '../components/ConfirmDialogContext'
import { supabase, type CategoriaRestricao, type PerfilUsuario, type PlanejamentoCompromisso, type PlanejamentoSemana, type Restricao, type StatusRestricao } from '../lib/supabase'
import { paginado, fatiar, etapaAncestralPorTarefa, type RespostaPaginada } from '../lib/cronograma'
import styles from './Planejamento.module.css'

type Msg = { tipo: 'ok' | 'erro'; texto: string } | null
type Aba = 'semanal' | 'calendario' | 'mensal' | 'trimestral'

interface TarefaCronograma {
  id: string
  nome: string
  unidade_id: string | null
  resumo: boolean
  unidades: { nome: string } | null
}

interface MarcoEtapa {
  nome: string
  dataFim: string | null
  percentualMedio: number
}

interface TarefaArvoreNo {
  id: string
  nome: string
  parent_id: string | null
  unidade_id: string | null
  resumo: boolean
}

interface UnidadeSimples {
  id: string
  nome: string
}

interface CompromissoView {
  compromisso: PlanejamentoCompromisso
  tarefaNome: string
  unidadeNome: string
  etapaNome: string
  statusClasse: string
  statusTexto: string
}

interface GrupoCompromissos {
  unidade: string
  etapas: { etapa: string; itens: CompromissoView[] }[]
}

export const CATEGORIA_LABEL: Record<CategoriaRestricao, string> = {
  material: 'Material',
  mao_de_obra: 'Mão de obra',
  projeto_documentacao: 'Projeto/documentação',
  decisao_pendente: 'Decisão pendente',
  equipamento: 'Equipamento',
  financeiro: 'Financeiro',
  servico_predecessor: 'Serviço predecessor',
  clima: 'Clima',
}

const fmtData = (iso?: string | null) => iso ? new Date(iso + 'T00:00:00').toLocaleDateString('pt-BR') : '-'
const fmtPct = (valor?: number | null) => valor == null ? '-' : `${valor.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`
const hojeISO = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const dataLocal = (iso: string) => new Date(iso + 'T00:00:00')
const isoLocal = (data: Date) => `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}-${String(data.getDate()).padStart(2, '0')}`
const adicionarDias = (iso: string, dias: number) => {
  const d = dataLocal(iso)
  d.setDate(d.getDate() + dias)
  return isoLocal(d)
}

export default function Planejamento() {
  const { perfil, temModulo } = useAuth()
  const { obraAtiva } = useObra()
  const { confirmar } = useConfirmDialog()
  const podeEditar = perfil?.papel === 'admin' || (perfil?.papel === 'equipe' && temModulo('planejamento'))
  const semPermissao = !podeEditar

  const [aba, setAba] = useState<Aba>('semanal')
  const [carregando, setCarregando] = useState(true)
  const [msg, setMsg] = useState<Msg>(null)
  const [salvando, setSalvando] = useState(false)

  const [tarefas, setTarefas] = useState<TarefaCronograma[]>([])
  const [usuarios, setUsuarios] = useState<PerfilUsuario[]>([])
  const [restricoes, setRestricoes] = useState<Restricao[]>([])

  const [filtroCategoria, setFiltroCategoria] = useState<CategoriaRestricao | ''>('')
  const [filtroStatus, setFiltroStatus] = useState<StatusRestricao | ''>('')

  const [formAberto, setFormAberto] = useState(false)
  const [buscaTarefa, setBuscaTarefa] = useState('')
  const [tarefaId, setTarefaId] = useState('')
  const [categoria, setCategoria] = useState<CategoriaRestricao>('material')
  const [responsavelId, setResponsavelId] = useState('')
  const [prazo, setPrazo] = useState('')
  const [observacao, setObservacao] = useState('')

  const [semanas, setSemanas] = useState<PlanejamentoSemana[]>([])
  const [semanaSelecionadaId, setSemanaSelecionadaId] = useState<string | null>(null)
  const [compromissos, setCompromissos] = useState<PlanejamentoCompromisso[]>([])
  const [compromissosCalendario, setCompromissosCalendario] = useState<PlanejamentoCompromisso[]>([])
  const [percentuaisAtuais, setPercentuaisAtuais] = useState<Record<string, number>>({})
  const [avancoDiasPorTarefa, setAvancoDiasPorTarefa] = useState<Record<string, string[]>>({})
  const [marcos, setMarcos] = useState<MarcoEtapa[]>([])

  const [novaSemanaInicio, setNovaSemanaInicio] = useState('')
  const [novaSemanaFim, setNovaSemanaFim] = useState('')
  const [formCompromissoAberto, setFormCompromissoAberto] = useState(false)
  const [tarefaCompromissoId, setTarefaCompromissoId] = useState('')
  const [metaPercentual, setMetaPercentual] = useState('')
  const [gerandoGantt, setGerandoGantt] = useState(false)
  const [mesCalendario, setMesCalendario] = useState(() => hojeISO().slice(0, 7))

  const [unidadesObra, setUnidadesObra] = useState<UnidadeSimples[]>([])
  const [todasTarefas, setTodasTarefas] = useState<TarefaArvoreNo[]>([])
  const [unidadeArvoreId, setUnidadeArvoreId] = useState('')
  const [nosAbertos, setNosAbertos] = useState<Set<string>>(new Set())

  const tarefaPorId = useMemo(() => new Map(tarefas.map(t => [t.id, t])), [tarefas])
  const usuarioPorId = useMemo(() => new Map(usuarios.map(u => [u.id, u])), [usuarios])
  // etapa_id de cronograma_tarefas nunca foi preenchido na importação do MS
  // Project — deriva a etapa subindo a árvore até o filho direto da raiz da
  // unidade (achado em 20/07/2026 ao investigar Linha de Balanço/Gantt vazios).
  const etapaPorTarefaId = useMemo(() => etapaAncestralPorTarefa(todasTarefas), [todasTarefas])

  const tarefasAbertasPorId = useMemo(() => {
    const abertas = new Set<string>()
    for (const r of restricoes) if (r.status === 'aberta') abertas.add(r.tarefa_id)
    return abertas
  }, [restricoes])

  const tarefasFiltradas = useMemo(() => {
    const termo = buscaTarefa.trim().toLowerCase()
    if (!termo) return tarefas.slice(0, 30)
    return tarefas.filter(t => t.nome.toLowerCase().includes(termo)).slice(0, 30)
  }, [tarefas, buscaTarefa])

  const restricoesFiltradas = useMemo(() => {
    return restricoes
      .filter(r => (!filtroCategoria || r.categoria === filtroCategoria) && (!filtroStatus || r.status === filtroStatus))
      .sort((a, b) => a.prazo.localeCompare(b.prazo))
  }, [restricoes, filtroCategoria, filtroStatus])

  async function carregar() {
    if (!obraAtiva || semPermissao) { setCarregando(false); return }
    setCarregando(true)
    setMsg(null)
    // cronograma_tarefas passa de 1000 linhas nesta obra (2816 no total, 1933
    // só as folhas) — o Supabase corta silenciosamente em 1000 por resposta
    // sem paginar, então usa o mesmo helper já usado no Cronograma (Fase 2).
    try {
      const [tarefasLista, todasTarefasLista] = await Promise.all([
        paginado<TarefaCronograma>((de, ate, contar) =>
          supabase.from('cronograma_tarefas')
            .select('id, nome, unidade_id, resumo, unidades(nome)', contar ? { count: 'exact' } : undefined)
            .eq('obra_id', obraAtiva.id).eq('ativo', true).eq('resumo', false).order('nome')
            .range(de, ate) as unknown as PromiseLike<RespostaPaginada<TarefaCronograma>>),
        paginado<TarefaArvoreNo>((de, ate, contar) =>
          supabase.from('cronograma_tarefas')
            .select('id, nome, parent_id, unidade_id, resumo', contar ? { count: 'exact' } : undefined)
            .eq('obra_id', obraAtiva.id).eq('ativo', true).order('ordem')
            .range(de, ate) as unknown as PromiseLike<RespostaPaginada<TarefaArvoreNo>>),
      ])
      setTarefas(tarefasLista)
      setTodasTarefas(todasTarefasLista)
    } catch (erro) {
      setMsg({ tipo: 'erro', texto: 'Erro ao carregar tarefas do cronograma: ' + (erro as Error).message })
    }
    const [usuariosResp, restricoesResp, unidadesResp] = await Promise.all([
      supabase.from('perfis_usuario').select('*').eq('ativo', true).neq('papel', 'cliente').order('nome'),
      supabase.from('restricoes').select('*').eq('obra_id', obraAtiva.id).eq('ativo', true).order('prazo'),
      supabase.from('unidades').select('id, nome').eq('obra_id', obraAtiva.id).eq('ativo', true).order('ordem'),
    ])
    if (usuariosResp.error) setMsg({ tipo: 'erro', texto: 'Erro ao carregar usuários: ' + usuariosResp.error.message })
    else setUsuarios(usuariosResp.data ?? [])
    if (restricoesResp.error) setMsg({ tipo: 'erro', texto: 'Erro ao carregar restrições: ' + restricoesResp.error.message })
    else setRestricoes(restricoesResp.data ?? [])
    if (unidadesResp.error) setMsg({ tipo: 'erro', texto: 'Erro ao carregar unidades: ' + unidadesResp.error.message })
    else setUnidadesObra(unidadesResp.data ?? [])
    const semanasResp = await supabase.from('planejamento_semanas').select('*').eq('obra_id', obraAtiva.id).eq('ativo', true).order('data_inicio', { ascending: false })
    if (semanasResp.error) setMsg({ tipo: 'erro', texto: 'Erro ao carregar semanas: ' + semanasResp.error.message })
    else {
      const lista = semanasResp.data ?? []
      setSemanas(lista)
      if (!semanaSelecionadaId && lista.length > 0) setSemanaSelecionadaId(lista[0].id)
      if (lista.length > 0) {
        const compCalendarioResp = await supabase.from('planejamento_compromissos').select('*').eq('ativo', true).in('semana_id', lista.map(s => s.id))
        if (compCalendarioResp.error) setMsg({ tipo: 'erro', texto: 'Erro ao carregar compromissos do calendário: ' + compCalendarioResp.error.message })
        else setCompromissosCalendario(compCalendarioResp.data ?? [])
      } else {
        setCompromissosCalendario([])
      }
    }
    setCarregando(false)
  }

  useEffect(() => { carregar() }, [obraAtiva?.id, semPermissao])

  async function carregarCompromissos(semanaId: string) {
    const compResp = await supabase.from('planejamento_compromissos').select('*').eq('semana_id', semanaId).eq('ativo', true)
    if (compResp.error) { setMsg({ tipo: 'erro', texto: 'Erro ao carregar compromissos: ' + compResp.error.message }); return }
    setCompromissos(compResp.data ?? [])
  }

  useEffect(() => { if (semanaSelecionadaId) carregarCompromissos(semanaSelecionadaId) }, [semanaSelecionadaId])

  useEffect(() => {
    if (tarefas.length === 0) return
    // avancos_fisicos cresce a cada lançamento semanal — pode passar de 1000
    // linhas com o tempo, mesmo com poucas tarefas. Paginado + em lotes de
    // 500 ids (mesmo padrão de src/lib/cronograma.ts), pra não montar um
    // filtro "in" gigante numa unica chamada.
    const ids = tarefas.map(t => t.id)
    Promise.all(fatiar(ids, 500).map(lote =>
      paginado<{ tarefa_id: string; percentual: number; data_referencia: string }>((de, ate, contar) =>
        supabase.from('avancos_fisicos')
          .select('tarefa_id, percentual, data_referencia', contar ? { count: 'exact' } : undefined)
          .eq('ativo', true).in('tarefa_id', lote).order('data_referencia', { ascending: false })
          .range(de, ate) as unknown as PromiseLike<RespostaPaginada<{ tarefa_id: string; percentual: number; data_referencia: string }>>),
    )).then(lotes => {
      const atuais: Record<string, number> = {}
      const diasPorTarefa: Record<string, Set<string>> = {}
      for (const lote of lotes) for (const row of lote) {
        if (!(row.tarefa_id in atuais)) atuais[row.tarefa_id] = row.percentual
        const dias = diasPorTarefa[row.tarefa_id] ?? new Set<string>()
        dias.add(row.data_referencia)
        diasPorTarefa[row.tarefa_id] = dias
      }
      setPercentuaisAtuais(atuais)
      setAvancoDiasPorTarefa(Object.fromEntries(Object.entries(diasPorTarefa).map(([id, dias]) => [id, [...dias].sort()])))
    }).catch(erro => setMsg({ tipo: 'erro', texto: 'Erro ao carregar avanço físico: ' + (erro as Error).message }))
  }, [tarefas])

  useEffect(() => {
    if (!obraAtiva || tarefas.length === 0) { setMarcos([]); return }
    async function carregarMarcos() {
      const versaoResp = await supabase.from('cronograma_versoes').select('id').eq('obra_id', obraAtiva!.id).eq('vigente', true).eq('ativo', true).maybeSingle()
      if (!versaoResp.data) { setMarcos([]); return }
      let previstoLista: { tarefa_id: string; fim: string }[] = []
      try {
        previstoLista = await paginado<{ tarefa_id: string; fim: string }>((de, ate, contar) =>
          supabase.from('cronograma_previsto')
            .select('tarefa_id, fim', contar ? { count: 'exact' } : undefined)
            .eq('versao_id', versaoResp.data!.id)
            .range(de, ate) as unknown as PromiseLike<RespostaPaginada<{ tarefa_id: string; fim: string }>>)
      } catch (erro) {
        setMsg({ tipo: 'erro', texto: 'Erro ao carregar datas previstas: ' + (erro as Error).message })
        return
      }
      const fimPorTarefa = new Map(previstoLista.map(p => [p.tarefa_id, p.fim]))

      const porEtapa = new Map<string, string[]>()
      for (const t of tarefas) {
        const nomeEtapa = etapaPorTarefaId.get(t.id)
        if (!nomeEtapa) continue
        const atual = porEtapa.get(nomeEtapa) ?? []
        atual.push(t.id)
        porEtapa.set(nomeEtapa, atual)
      }

      const lista: MarcoEtapa[] = []
      for (const [nome, tarefaIds] of porEtapa) {
        const datasFim = tarefaIds.map(id => fimPorTarefa.get(id)).filter((d): d is string => !!d)
        const dataFim = datasFim.length > 0 ? datasFim.sort()[datasFim.length - 1] : null
        const percentuais = tarefaIds.map(id => percentuaisAtuais[id] ?? 0)
        const percentualMedio = percentuais.length > 0 ? Math.round(percentuais.reduce((a, b) => a + b, 0) / percentuais.length) : 0
        lista.push({ nome, dataFim, percentualMedio })
      }
      lista.sort((a, b) => (a.dataFim ?? '9999-99-99').localeCompare(b.dataFim ?? '9999-99-99'))
      setMarcos(lista)
    }
    carregarMarcos()
  }, [obraAtiva, tarefas, percentuaisAtuais, etapaPorTarefaId])

  const semanaSelecionada = semanas.find(s => s.id === semanaSelecionadaId) ?? null
  const jaComprometidasPorId = useMemo(() => new Set(compromissos.map(c => c.tarefa_id)), [compromissos])

  const arvoreCronograma = useMemo(() => {
    const filhosPorPai = new Map<string, TarefaArvoreNo[]>()
    const raizesPorUnidade = new Map<string, TarefaArvoreNo[]>()
    for (const t of todasTarefas) {
      if (t.parent_id) {
        const lista = filhosPorPai.get(t.parent_id) ?? []
        lista.push(t)
        filhosPorPai.set(t.parent_id, lista)
      } else if (t.unidade_id) {
        const lista = raizesPorUnidade.get(t.unidade_id) ?? []
        lista.push(t)
        raizesPorUnidade.set(t.unidade_id, lista)
      }
    }
    return { filhosPorPai, raizesPorUnidade }
  }, [todasTarefas])

  const hoje = hojeISO()

  const compromissosView = useMemo<CompromissoView[]>(() => {
    return compromissos.map(c => {
      const tarefa = tarefaPorId.get(c.tarefa_id)
      const cumprido = c.cumprido === true
      const naoCumprido = c.cumprido === false
      return {
        compromisso: c,
        tarefaNome: tarefa?.nome ?? 'Tarefa não encontrada',
        unidadeNome: tarefa?.unidades?.nome ?? 'Sem unidade',
        etapaNome: etapaPorTarefaId.get(c.tarefa_id) ?? 'Sem etapa',
        statusClasse: cumprido ? styles.chipResolvida : naoCumprido ? styles.chipAberta : styles.chip,
        statusTexto: c.cumprido == null ? 'Pendente' : cumprido ? 'Cumprida' : 'Não cumprida',
      }
    })
  }, [compromissos, tarefaPorId, etapaPorTarefaId])

  const compromissosCalendarioView = useMemo<CompromissoView[]>(() => {
    return compromissosCalendario.map(c => {
      const tarefa = tarefaPorId.get(c.tarefa_id)
      const cumprido = c.cumprido === true
      const naoCumprido = c.cumprido === false
      return {
        compromisso: c,
        tarefaNome: tarefa?.nome ?? 'Tarefa não encontrada',
        unidadeNome: tarefa?.unidades?.nome ?? 'Sem unidade',
        etapaNome: etapaPorTarefaId.get(c.tarefa_id) ?? 'Sem etapa',
        statusClasse: cumprido ? styles.chipResolvida : naoCumprido ? styles.chipAberta : styles.chip,
        statusTexto: c.cumprido == null ? 'Pendente' : cumprido ? 'Cumprida' : 'Não cumprida',
      }
    })
  }, [compromissosCalendario, tarefaPorId, etapaPorTarefaId])

  const resumoSemana = useMemo(() => {
    const total = compromissos.length
    const cumpridas = compromissos.filter(c => c.cumprido === true).length
    const naoCumpridas = compromissos.filter(c => c.cumprido === false).length
    const pendentes = total - cumpridas - naoCumpridas
    const semMotivo = compromissos.filter(c => c.cumprido === false && !c.motivo_categoria).length
    const restritas = compromissos.filter(c => tarefasAbertasPorId.has(c.tarefa_id)).length
    const ppcCalculado = total > 0 ? Math.round((cumpridas / total) * 100) : null
    return { total, cumpridas, naoCumpridas, pendentes, semMotivo, restritas, ppcCalculado }
  }, [compromissos, tarefasAbertasPorId])

  const compromissosAgrupados = useMemo<GrupoCompromissos[]>(() => {
    const porUnidade = new Map<string, Map<string, CompromissoView[]>>()
    for (const item of compromissosView) {
      const etapas = porUnidade.get(item.unidadeNome) ?? new Map<string, CompromissoView[]>()
      const itens = etapas.get(item.etapaNome) ?? []
      itens.push(item)
      etapas.set(item.etapaNome, itens)
      porUnidade.set(item.unidadeNome, etapas)
    }
    return [...porUnidade.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([unidade, etapas]) => ({
      unidade,
      etapas: [...etapas.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([etapa, itens]) => ({
        etapa,
        itens: itens.sort((a, b) => a.tarefaNome.localeCompare(b.tarefaNome)),
      })),
    }))
  }, [compromissosView])

  const restricoesDaSemana = useMemo(() => {
    if (!semanaSelecionada) return []
    return restricoes
      .filter(r => r.status === 'aberta' && r.prazo >= semanaSelecionada.data_inicio && r.prazo <= semanaSelecionada.data_fim)
      .sort((a, b) => a.prazo.localeCompare(b.prazo))
  }, [restricoes, semanaSelecionada])

  const restricoesVencidas = useMemo(() => {
    return restricoes
      .filter(r => r.status === 'aberta' && r.prazo < hoje)
      .sort((a, b) => a.prazo.localeCompare(b.prazo))
  }, [restricoes, hoje])

  const calendario = useMemo(() => {
    const [ano, mes] = mesCalendario.split('-').map(Number)
    const primeiro = new Date(ano, mes - 1, 1)
    const inicio = new Date(primeiro)
    const deslocamentoSegunda = (primeiro.getDay() + 6) % 7
    inicio.setDate(primeiro.getDate() - deslocamentoSegunda)
    const dias = Array.from({ length: 42 }, (_, i) => {
      const data = new Date(inicio)
      data.setDate(inicio.getDate() + i)
      const iso = isoLocal(data)
      const semanasDoDia = semanas.filter(s => iso >= s.data_inicio && iso <= s.data_fim)
      const compromissosDoDia = compromissosCalendarioView.filter(item => semanasDoDia.some(s => s.id === item.compromisso.semana_id))
      const restricoesDoDia = restricoes.filter(r => r.status === 'aberta' && r.prazo === iso)
      const avancosDoDia = compromissosDoDia.filter(item => avancoDiasPorTarefa[item.compromisso.tarefa_id]?.includes(iso))
      return {
        iso,
        dia: data.getDate(),
        foraDoMes: data.getMonth() !== mes - 1,
        hoje: iso === hoje,
        semanas: semanasDoDia,
        compromissos: compromissosDoDia,
        restricoes: restricoesDoDia,
        avancos: avancosDoDia,
      }
    })
    return dias
  }, [mesCalendario, semanas, compromissosCalendarioView, restricoes, avancoDiasPorTarefa, hoje])

  function mudarMes(delta: number) {
    const [ano, mes] = mesCalendario.split('-').map(Number)
    const d = new Date(ano, mes - 1 + delta, 1)
    setMesCalendario(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }

  function limparForm() {
    setBuscaTarefa('')
    setTarefaId('')
    setCategoria('material')
    setResponsavelId('')
    setPrazo('')
    setObservacao('')
  }

  async function salvarRestricao() {
    setMsg(null)
    if (!obraAtiva) return setMsg({ tipo: 'erro', texto: 'Selecione uma obra.' })
    if (!tarefaId) return setMsg({ tipo: 'erro', texto: 'Selecione a tarefa do cronograma.' })
    if (!prazo) return setMsg({ tipo: 'erro', texto: 'Informe o prazo.' })
    setSalvando(true)
    const { error } = await supabase.from('restricoes').insert({
      obra_id: obraAtiva.id,
      tarefa_id: tarefaId,
      categoria,
      responsavel_id: responsavelId || null,
      prazo,
      observacao: observacao.trim() || null,
    })
    setSalvando(false)
    if (error) return setMsg({ tipo: 'erro', texto: 'Erro ao cadastrar restrição: ' + error.message })
    limparForm()
    setFormAberto(false)
    setMsg({ tipo: 'ok', texto: 'Restrição cadastrada.' })
    await carregar()
  }

  async function resolverRestricao(r: Restricao) {
    setMsg(null)
    setSalvando(true)
    const { error } = await supabase.from('restricoes').update({ status: 'resolvida', resolvida_por: perfil?.id, resolvida_em: new Date().toISOString() }).eq('id', r.id)
    setSalvando(false)
    if (error) return setMsg({ tipo: 'erro', texto: 'Erro ao resolver restrição: ' + error.message })
    setMsg({ tipo: 'ok', texto: 'Restrição marcada como resolvida.' })
    await carregar()
  }

  async function criarSemana() {
    setMsg(null)
    if (!obraAtiva) return
    if (!novaSemanaInicio || !novaSemanaFim) return setMsg({ tipo: 'erro', texto: 'Informe início e fim da semana.' })
    setSalvando(true)
    const { data, error } = await supabase.from('planejamento_semanas').insert({ obra_id: obraAtiva.id, data_inicio: novaSemanaInicio, data_fim: novaSemanaFim }).select('*').single()
    setSalvando(false)
    if (error) return setMsg({ tipo: 'erro', texto: 'Erro ao criar semana: ' + error.message })
    setNovaSemanaInicio('')
    setNovaSemanaFim('')
    setMsg({ tipo: 'ok', texto: 'Semana criada.' })
    await carregar()
    if (data) setSemanaSelecionadaId(data.id)
  }

  async function adicionarCompromisso() {
    setMsg(null)
    if (!semanaSelecionada) return setMsg({ tipo: 'erro', texto: 'Selecione uma semana.' })
    if (!tarefaCompromissoId) return setMsg({ tipo: 'erro', texto: 'Selecione a tarefa.' })
    const meta = Number(metaPercentual)
    const inicio = percentuaisAtuais[tarefaCompromissoId] ?? 0
    if (!meta || meta <= inicio || meta > 100) return setMsg({ tipo: 'erro', texto: 'Meta precisa ser maior que o % atual (' + inicio + '%) e no máximo 100.' })
    setSalvando(true)
    const { error } = await supabase.from('planejamento_compromissos').insert({
      semana_id: semanaSelecionada.id,
      tarefa_id: tarefaCompromissoId,
      percentual_inicio: inicio,
      meta_percentual: meta,
    })
    setSalvando(false)
    if (error) return setMsg({ tipo: 'erro', texto: 'Erro ao comprometer tarefa: ' + error.message })
    setTarefaCompromissoId('')
    setMetaPercentual('')
    setFormCompromissoAberto(false)
    setMsg({ tipo: 'ok', texto: 'Tarefa comprometida na semana.' })
    await carregar()
    await carregarCompromissos(semanaSelecionada.id)
  }

  async function atualizarMotivo(c: PlanejamentoCompromisso, motivoCategoria: CategoriaRestricao, motivoObservacao: string) {
    setSalvando(true)
    const { error } = await supabase.from('planejamento_compromissos').update({ motivo_categoria: motivoCategoria, motivo_observacao: motivoObservacao.trim() || null }).eq('id', c.id)
    setSalvando(false)
    if (error) return setMsg({ tipo: 'erro', texto: 'Erro ao salvar motivo: ' + error.message })
    if (semanaSelecionada) await carregarCompromissos(semanaSelecionada.id)
  }

  async function excluirCompromisso(c: PlanejamentoCompromisso) {
    const nome = tarefaPorId.get(c.tarefa_id)?.nome ?? 'esta tarefa'
    const ok = await confirmar({
      titulo: 'Excluir compromisso',
      mensagem: `Remover o compromisso de "${nome}" desta semana? Essa ação não pode ser desfeita.`,
      confirmarTexto: 'Excluir',
      perigoso: true,
    })
    if (!ok) return
    setMsg(null)
    setSalvando(true)
    const { error } = await supabase.from('planejamento_compromissos').update({ ativo: false }).eq('id', c.id)
    setSalvando(false)
    if (error) return setMsg({ tipo: 'erro', texto: 'Erro ao excluir compromisso: ' + error.message })
    setMsg({ tipo: 'ok', texto: 'Compromisso excluído.' })
    await carregar()
    if (semanaSelecionada) await carregarCompromissos(semanaSelecionada.id)
  }

  async function calcularFechamento() {
    if (!semanaSelecionada) return
    setMsg(null)
    setSalvando(true)
    const { error } = await supabase.rpc('calcular_fechamento_semana', { p_semana: semanaSelecionada.id })
    setSalvando(false)
    if (error) return setMsg({ tipo: 'erro', texto: 'Erro ao calcular fechamento: ' + error.message })
    setMsg({ tipo: 'ok', texto: 'Fechamento calculado. Confira os não cumpridos antes de fechar.' })
    await carregarCompromissos(semanaSelecionada.id)
  }

  async function fecharSemana() {
    if (!semanaSelecionada) return
    setMsg(null)
    setSalvando(true)
    const { error } = await supabase.rpc('fechar_semana_planejamento', { p_semana: semanaSelecionada.id })
    setSalvando(false)
    if (error) return setMsg({ tipo: 'erro', texto: 'Erro ao fechar semana: ' + error.message })
    setMsg({ tipo: 'ok', texto: 'Semana fechada.' })
    await carregar()
    await carregarCompromissos(semanaSelecionada.id)
  }

  async function fecharPlanejamento() {
    if (!semanaSelecionada) return
    setMsg(null)
    setSalvando(true)
    const { error } = await supabase.rpc('fechar_planejamento_semana', { p_semana: semanaSelecionada.id })
    setSalvando(false)
    if (error) return setMsg({ tipo: 'erro', texto: 'Erro ao fechar planejamento: ' + error.message })
    setMsg({ tipo: 'ok', texto: 'Planejamento fechado. Nenhuma tarefa nova pode ser comprometida nesta semana.' })
    await carregar()
    await carregarCompromissos(semanaSelecionada.id)
  }

  async function reabrirPlanejamento() {
    if (!semanaSelecionada) return
    setMsg(null)
    setSalvando(true)
    const { error } = await supabase.rpc('reabrir_planejamento_semana', { p_semana: semanaSelecionada.id })
    setSalvando(false)
    if (error) return setMsg({ tipo: 'erro', texto: 'Erro ao reabrir planejamento: ' + error.message })
    setMsg({ tipo: 'ok', texto: 'Planejamento reaberto.' })
    await carregar()
    await carregarCompromissos(semanaSelecionada.id)
  }

  async function gerarGantt() {
    if (!obraAtiva || !semanaSelecionada) return
    setGerandoGantt(true)
    setMsg(null)
    try {
      const { gerarPdfGanttPlanejamento } = await import('../lib/ganttPlanejamentoPdf')
      await gerarPdfGanttPlanejamento(obraAtiva.id, semanaSelecionada.id)
    } catch (erro) {
      setMsg({ tipo: 'erro', texto: `Erro ao gerar Gantt: ${(erro as Error).message}` })
    }
    setGerandoGantt(false)
  }

  async function levarParaProximaSemana(c: PlanejamentoCompromisso) {
    if (!semanaSelecionada) return
    setMsg(null)
    setSalvando(true)
    const proxima = semanas
      .filter(s => s.data_inicio > semanaSelecionada.data_fim)
      .sort((a, b) => a.data_inicio.localeCompare(b.data_inicio))[0]
    if (!proxima) {
      setSalvando(false)
      return setMsg({ tipo: 'erro', texto: 'Crie a semana seguinte antes de levar essa tarefa pra frente.' })
    }
    const jaExisteResp = await supabase.from('planejamento_compromissos').select('id').eq('semana_id', proxima.id).eq('tarefa_id', c.tarefa_id).eq('ativo', true).maybeSingle()
    if (jaExisteResp.data) {
      setSalvando(false)
      return setMsg({ tipo: 'erro', texto: 'Essa tarefa já está comprometida na semana seguinte.' })
    }
    const inicio = percentuaisAtuais[c.tarefa_id] ?? c.percentual_fim ?? 0
    if (c.meta_percentual <= inicio) {
      setSalvando(false)
      return setMsg({ tipo: 'erro', texto: 'A tarefa já atingiu a meta anterior — comprometa manualmente com uma meta nova na semana seguinte.' })
    }
    const { error } = await supabase.from('planejamento_compromissos').insert({
      semana_id: proxima.id,
      tarefa_id: c.tarefa_id,
      percentual_inicio: inicio,
      meta_percentual: c.meta_percentual,
    })
    setSalvando(false)
    if (error) return setMsg({ tipo: 'erro', texto: 'Erro ao levar tarefa pra próxima semana: ' + error.message })
    setMsg({ tipo: 'ok', texto: 'Tarefa levada pra semana de ' + fmtData(proxima.data_inicio) + ' a ' + fmtData(proxima.data_fim) + '.' })
    await carregar()
  }

  if (semPermissao) return <div className={styles.page}><h1>Planejamento</h1><div className={styles.msgErro}>Você não tem permissão para acessar Planejamento.</div></div>

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div><h1>Planejamento</h1><p className={styles.sub}>Restrições, compromisso semanal e marcos do cronograma.</p></div>
      </div>
      {msg && <div className={msg.tipo === 'ok' ? styles.msgOk : styles.msgErro}>{msg.texto}</div>}

      <div className={styles.abas}>
        <button className={[styles.aba, aba === 'semanal' ? styles.abaAtiva : ''].filter(Boolean).join(' ')} onClick={() => setAba('semanal')}>Semanal</button>
        <button className={[styles.aba, aba === 'calendario' ? styles.abaAtiva : ''].filter(Boolean).join(' ')} onClick={() => setAba('calendario')}>Calendário</button>
        <button className={[styles.aba, aba === 'mensal' ? styles.abaAtiva : ''].filter(Boolean).join(' ')} onClick={() => setAba('mensal')}>Mensal</button>
        <button className={[styles.aba, aba === 'trimestral' ? styles.abaAtiva : ''].filter(Boolean).join(' ')} onClick={() => setAba('trimestral')}>Trimestral</button>
      </div>

      {carregando ? <div className={styles.vazio}>Carregando...</div> : aba === 'mensal' && <>
        <div className={styles.header}>
          <div />
          <button className={styles.btnPrimario} onClick={() => setFormAberto(v => !v)}>{formAberto ? 'Fechar' : 'Nova restrição'}</button>
        </div>

        {formAberto && (
          <div className={styles.formulario}>
            <div className={styles.formHeader}><h2>Nova restrição</h2></div>
            <div className={styles.campos}>
              <label className={styles.campo}>Buscar tarefa do cronograma<input value={buscaTarefa} onChange={e => setBuscaTarefa(e.target.value)} placeholder="Digite o nome da tarefa" /></label>
              <label className={styles.campo}>Tarefa<select value={tarefaId} onChange={e => setTarefaId(e.target.value)}><option value="">Selecione</option>{tarefasFiltradas.map(t => <option key={t.id} value={t.id}>{t.nome}{etapaPorTarefaId.get(t.id) ? ' - ' + etapaPorTarefaId.get(t.id) : ''}</option>)}</select></label>
              <div className={styles.linha3}>
                <label className={styles.campo}>Categoria<select value={categoria} onChange={e => setCategoria(e.target.value as CategoriaRestricao)}>{(Object.keys(CATEGORIA_LABEL) as CategoriaRestricao[]).map(c => <option key={c} value={c}>{CATEGORIA_LABEL[c]}</option>)}</select></label>
                <label className={styles.campo}>Responsável<select value={responsavelId} onChange={e => setResponsavelId(e.target.value)}><option value="">Sem responsável definido</option>{usuarios.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}</select></label>
                <label className={styles.campo}>Prazo<input type="date" value={prazo} onChange={e => setPrazo(e.target.value)} /></label>
              </div>
              <label className={styles.campo}>Observação<textarea value={observacao} onChange={e => setObservacao(e.target.value)} /></label>
            </div>
            <div className={styles.acoesForm}><button className={styles.btnPrimario} disabled={salvando} onClick={salvarRestricao}>{salvando ? 'Salvando...' : 'Salvar restrição'}</button><button className={styles.btnSecundario} onClick={() => { limparForm(); setFormAberto(false) }}>Cancelar</button></div>
          </div>
        )}

        <div className={styles.filtros}>
          <select value={filtroCategoria} onChange={e => setFiltroCategoria(e.target.value as CategoriaRestricao | '')}><option value="">Todas as categorias</option>{(Object.keys(CATEGORIA_LABEL) as CategoriaRestricao[]).map(c => <option key={c} value={c}>{CATEGORIA_LABEL[c]}</option>)}</select>
          <select value={filtroStatus} onChange={e => setFiltroStatus(e.target.value as StatusRestricao | '')}><option value="">Todos os status</option><option value="aberta">Aberta</option><option value="resolvida">Resolvida</option></select>
        </div>

        {restricoesFiltradas.length === 0 ? <div className={styles.vazio}>Nenhuma restrição encontrada.</div> : (
          <table className={styles.tabela}>
            <thead><tr><th>Tarefa</th><th>Categoria</th><th>Responsável</th><th>Prazo</th><th>Status</th><th></th></tr></thead>
            <tbody>{restricoesFiltradas.map(r => {
              const tarefa = tarefaPorId.get(r.tarefa_id)
              return (
                <tr key={r.id}>
                  <td data-label="Tarefa">{tarefa?.nome ?? 'Tarefa não encontrada'}</td>
                  <td data-label="Categoria">{CATEGORIA_LABEL[r.categoria]}</td>
                  <td data-label="Responsável">{r.responsavel_id ? usuarioPorId.get(r.responsavel_id)?.nome ?? '-' : '-'}</td>
                  <td data-label="Prazo">{fmtData(r.prazo)}</td>
                  <td data-label="Status"><span className={[styles.chip, r.status === 'aberta' ? styles.chipAberta : styles.chipResolvida].join(' ')}>{r.status === 'aberta' ? 'Aberta' : 'Resolvida'}</span></td>
                  <td data-label="">{r.status === 'aberta' && <button className={styles.btnSecundario} disabled={salvando} onClick={() => resolverRestricao(r)}>Resolver</button>}</td>
                </tr>
              )
            })}</tbody>
          </table>
        )}
      </>}

      {!carregando && aba === 'semanal' && <>
        <div className={styles.filtros}>
          <select value={semanaSelecionadaId ?? ''} onChange={e => setSemanaSelecionadaId(e.target.value || null)}>
            <option value="">Selecione uma semana</option>
            {semanas.map(s => <option key={s.id} value={s.id}>{fmtData(s.data_inicio)} a {fmtData(s.data_fim)} {s.status === 'fechada' ? '(fechada, PPC ' + s.ppc + '%)' : s.status === 'planejada' ? '(planejamento fechado)' : ''}</option>)}
          </select>
        </div>

        <div className={styles.formulario}>
          <div className={styles.formHeader}><h2>Nova semana</h2></div>
          <div className={styles.linha2}>
            <label className={styles.campo}>Início<input type="date" value={novaSemanaInicio} onChange={e => setNovaSemanaInicio(e.target.value)} /></label>
            <label className={styles.campo}>Fim<input type="date" value={novaSemanaFim} onChange={e => setNovaSemanaFim(e.target.value)} /></label>
          </div>
          <div className={styles.acoesForm}><button className={styles.btnPrimario} disabled={salvando} onClick={criarSemana}>Criar semana</button></div>
        </div>

        {!semanaSelecionada ? <div className={styles.vazio}>Selecione ou crie uma semana.</div> : <>
          <div className={styles.resumoSemana}>
            <div className={styles.resumoPrincipal}>
              <span className={styles.resumoLabel}>Semana selecionada</span>
              <strong>{fmtData(semanaSelecionada.data_inicio)} a {fmtData(semanaSelecionada.data_fim)}</strong>
              <span className={styles.resumoStatus}>{semanaSelecionada.status === 'aberta' ? 'Aberta' : semanaSelecionada.status === 'planejada' ? 'Planejamento fechado' : 'Fechada'}</span>
            </div>
            <div className={styles.resumoCards}>
              <div><span>Compromissos</span><strong>{resumoSemana.total}</strong></div>
              <div><span>Cumpridas</span><strong>{resumoSemana.cumpridas}</strong></div>
              <div><span>Não cumpridas</span><strong>{resumoSemana.naoCumpridas}</strong></div>
              <div><span>Pendentes</span><strong>{resumoSemana.pendentes}</strong></div>
              <div><span>PPC</span><strong>{fmtPct(semanaSelecionada.ppc ?? resumoSemana.ppcCalculado)}</strong></div>
              <div className={resumoSemana.semMotivo > 0 ? styles.alertaCard : ''}><span>Sem motivo</span><strong>{resumoSemana.semMotivo}</strong></div>
            </div>
          </div>

          {(restricoesVencidas.length > 0 || restricoesDaSemana.length > 0 || resumoSemana.restritas > 0) && (
            <div className={styles.alertasPlanejamento}>
              {restricoesVencidas.length > 0 && <span>{restricoesVencidas.length} restrição{restricoesVencidas.length !== 1 ? 'ões vencidas' : ' vencida'}</span>}
              {restricoesDaSemana.length > 0 && <span>{restricoesDaSemana.length} restrição{restricoesDaSemana.length !== 1 ? 'ões vencem' : ' vence'} nesta semana</span>}
              {resumoSemana.restritas > 0 && <span>{resumoSemana.restritas} tarefa{resumoSemana.restritas !== 1 ? 's comprometidas têm' : ' comprometida tem'} restrição aberta</span>}
            </div>
          )}

          {semanaSelecionada.status === 'aberta' && (
            <div className={styles.acoesForm}>
              <button className={styles.btnSecundario} onClick={() => setFormCompromissoAberto(v => !v)}>{formCompromissoAberto ? 'Fechar' : 'Comprometer tarefa'}</button>
              <button className={styles.btnSecundario} disabled={salvando} onClick={fecharPlanejamento}>Fechar planejamento</button>
            </div>
          )}

          {semanaSelecionada.status === 'planejada' && (
            <div className={styles.acoesForm}>
              <div className={styles.msgOk}>Planejamento fechado. Nenhuma tarefa nova pode ser comprometida.</div>
              {perfil?.papel === 'admin' && <button className={styles.btnSecundario} disabled={salvando} onClick={reabrirPlanejamento}>Reabrir planejamento</button>}
            </div>
          )}

          {(semanaSelecionada.status === 'aberta' || semanaSelecionada.status === 'planejada') && (
            <div className={styles.acoesForm}>
              <button className={styles.btnSecundario} disabled={salvando} onClick={calcularFechamento}>Calcular fechamento</button>
              {perfil?.papel === 'admin' && <button className={styles.btnPrimario} disabled={salvando} onClick={fecharSemana}>Fechar semana</button>}
            </div>
          )}

          {formCompromissoAberto && semanaSelecionada.status === 'aberta' && (
            <div className={styles.formulario}>
              <div className={styles.formHeader}><h2>Comprometer tarefa</h2></div>
              <div className={styles.campos}>
                <label className={styles.campo}>Unidade
                  <select value={unidadeArvoreId} onChange={e => { setUnidadeArvoreId(e.target.value); setTarefaCompromissoId('') }}>
                    <option value="">Selecione</option>
                    {unidadesObra.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}
                  </select>
                </label>
                {unidadeArvoreId && (
                  <div className={styles.arvore}>
                    {(arvoreCronograma.raizesPorUnidade.get(unidadeArvoreId) ?? []).map(no => (
                      <NoArvoreCompromisso
                        key={no.id}
                        no={no}
                        profundidade={0}
                        filhosPorPai={arvoreCronograma.filhosPorPai}
                        restritas={tarefasAbertasPorId}
                        comprometidas={jaComprometidasPorId}
                        percentuais={percentuaisAtuais}
                        selecionadoId={tarefaCompromissoId}
                        onSelecionar={setTarefaCompromissoId}
                        abertos={nosAbertos}
                        onToggle={id => setNosAbertos(atual => {
                          const novo = new Set(atual)
                          if (novo.has(id)) novo.delete(id); else novo.add(id)
                          return novo
                        })}
                      />
                    ))}
                  </div>
                )}
                {tarefaCompromissoId && (
                  <div className={styles.msgOk}>Selecionada: {tarefaPorId.get(tarefaCompromissoId)?.nome ?? 'tarefa'} (atual: {percentuaisAtuais[tarefaCompromissoId] ?? 0}%)</div>
                )}
                <label className={styles.campo}>Meta de % pro fim da semana<input type="number" min={0} max={100} value={metaPercentual} onChange={e => setMetaPercentual(e.target.value)} /></label>
              </div>
              <div className={styles.acoesForm}><button className={styles.btnPrimario} disabled={salvando || !tarefaCompromissoId} onClick={adicionarCompromisso}>Comprometer</button></div>
            </div>
          )}

          {semanaSelecionada.status === 'fechada' && <div className={styles.msgOk}>Semana fechada. PPC: {semanaSelecionada.ppc}%</div>}

          {(semanaSelecionada.status === 'planejada' || semanaSelecionada.status === 'fechada') && (
            <div className={styles.filtros}>
              <button className={styles.btnSecundario} disabled={gerandoGantt} onClick={gerarGantt}>
                {gerandoGantt ? 'Gerando...' : 'Gantt do planejamento (semana atual + seguinte)'}
              </button>
            </div>
          )}

          {compromissos.length === 0 ? <div className={styles.vazio}>Nenhuma tarefa comprometida nesta semana.</div> : (
            <div className={styles.gruposSemana}>
              {compromissosAgrupados.map(grupo => (
                <section key={grupo.unidade} className={styles.grupoUnidade}>
                  <div className={styles.grupoUnidadeHeader}>
                    <strong>{grupo.unidade}</strong>
                    <span>{grupo.etapas.reduce((total, etapa) => total + etapa.itens.length, 0)} tarefa(s)</span>
                  </div>
                  {grupo.etapas.map(etapa => (
                    <div key={etapa.etapa} className={styles.grupoEtapa}>
                      <h3>{etapa.etapa}</h3>
                      <div className={styles.listaCompromissos}>
                        {etapa.itens.map(item => {
                          const c = item.compromisso
                          return (
                            <article key={c.id} className={styles.compromissoCard}>
                              <div className={styles.compromissoTopo}>
                                <strong>{item.tarefaNome}</strong>
                                <span className={[styles.chip, item.statusClasse].join(' ')}>{item.statusTexto}</span>
                              </div>
                              <div className={styles.compromissoMetricas}>
                                <span><b>Início</b>{fmtPct(c.percentual_inicio)}</span>
                                <span><b>Meta</b>{fmtPct(c.meta_percentual)}</span>
                                <span><b>Real</b>{fmtPct(c.percentual_fim)}</span>
                                <span><b>Avanço lançado</b>{avancoDiasPorTarefa[c.tarefa_id]?.length ?? 0} dia(s)</span>
                              </div>
                              <div className={styles.compromissoRodape}>
                                {c.cumprido === false && semanaSelecionada.status !== 'fechada' ? (
                                  <select value={c.motivo_categoria ?? ''} onChange={e => { if (e.target.value) atualizarMotivo(c, e.target.value as CategoriaRestricao, c.motivo_observacao ?? '') }}>
                                    <option value="">Selecione o motivo</option>
                                    {(Object.keys(CATEGORIA_LABEL) as CategoriaRestricao[]).map(cat => <option key={cat} value={cat}>{CATEGORIA_LABEL[cat]}</option>)}
                                  </select>
                                ) : <span>{c.motivo_categoria ? CATEGORIA_LABEL[c.motivo_categoria] : 'Sem motivo registrado'}</span>}
                                {semanaSelecionada.status !== 'fechada' ? (
                                  <button className={styles.btnPerigo} disabled={salvando} onClick={() => excluirCompromisso(c)}>Excluir</button>
                                ) : c.cumprido === false ? (
                                  <button className={styles.btnSecundario} disabled={salvando} onClick={() => levarParaProximaSemana(c)}>Levar pra próxima semana</button>
                                ) : null}
                              </div>
                            </article>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </section>
              ))}
            </div>
          )}
        </>}
      </>}

      {!carregando && aba === 'calendario' && <>
        <div className={styles.calendarioTopo}>
          <button className={styles.btnSecundario} onClick={() => mudarMes(-1)}>Mês anterior</button>
          <h2>{dataLocal(mesCalendario + '-01').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}</h2>
          <button className={styles.btnSecundario} onClick={() => mudarMes(1)}>Próximo mês</button>
        </div>
        <div className={styles.calendario}>
          {['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'].map(dia => <div key={dia} className={styles.diaSemana}>{dia}</div>)}
          {calendario.map(dia => (
            <div key={dia.iso} className={[styles.diaCalendario, dia.foraDoMes ? styles.diaFora : '', dia.hoje ? styles.diaHoje : ''].filter(Boolean).join(' ')}>
              <div className={styles.diaTopo}>
                <strong>{dia.dia}</strong>
                {dia.semanas.map(s => s.status === 'fechada' && s.ppc != null ? <span key={s.id}>PPC {s.ppc}%</span> : null)}
              </div>
              <div className={styles.diaConteudo}>
                {dia.restricoes.slice(0, 2).map(r => (
                  <div key={r.id} className={styles.eventoRestricao}>
                    {CATEGORIA_LABEL[r.categoria]}: {tarefaPorId.get(r.tarefa_id)?.nome ?? 'tarefa'}
                  </div>
                ))}
                {dia.avancos.slice(0, 2).map(item => (
                  <div key={'avanco-' + item.compromisso.id} className={styles.eventoAvanco}>
                    Avanço: {item.unidadeNome} - {item.tarefaNome}
                  </div>
                ))}
                {dia.compromissos.slice(0, 3).map(item => (
                  <div key={item.compromisso.id} className={styles.eventoCompromisso}>
                    {item.unidadeNome}: {item.tarefaNome}
                  </div>
                ))}
                {dia.compromissos.length > 3 && <div className={styles.eventoMais}>+{dia.compromissos.length - 3} compromisso(s)</div>}
              </div>
            </div>
          ))}
        </div>
      </>}

      {!carregando && aba === 'trimestral' && <>
        {marcos.length === 0 ? <div className={styles.vazio}>Nenhuma versão vigente do cronograma encontrada para esta obra.</div> : (
          <table className={styles.tabela}>
            <thead><tr><th>Etapa</th><th>Previsão de término</th><th>Avanço médio</th></tr></thead>
            <tbody>{marcos.map(m => (
              <tr key={m.nome}>
                <td data-label="Etapa">{m.nome}</td>
                <td data-label="Previsão de término">{m.dataFim ? fmtData(m.dataFim) : 'Sem data prevista'}</td>
                <td data-label="Avanço médio">{m.percentualMedio}%</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </>}
    </div>
  )
}

function NoArvoreCompromisso({
  no, profundidade, filhosPorPai, restritas, comprometidas, percentuais, selecionadoId, onSelecionar, abertos, onToggle,
}: {
  no: TarefaArvoreNo
  profundidade: number
  filhosPorPai: Map<string, TarefaArvoreNo[]>
  restritas: Set<string>
  comprometidas: Set<string>
  percentuais: Record<string, number>
  selecionadoId: string
  onSelecionar: (id: string) => void
  abertos: Set<string>
  onToggle: (id: string) => void
}) {
  const filhos = filhosPorPai.get(no.id) ?? []
  const temFilhos = filhos.length > 0

  if (temFilhos) {
    const aberto = abertos.has(no.id)
    return (
      <div>
        <div className={styles.noArvore} style={{ paddingLeft: 10 + profundidade * 16 }} onClick={() => onToggle(no.id)} role="button" tabIndex={0}>
          {aberto ? '▾' : '▸'} {no.nome}
        </div>
        {aberto && filhos.map(f => (
          <NoArvoreCompromisso
            key={f.id} no={f} profundidade={profundidade + 1} filhosPorPai={filhosPorPai}
            restritas={restritas} comprometidas={comprometidas} percentuais={percentuais}
            selecionadoId={selecionadoId} onSelecionar={onSelecionar} abertos={abertos} onToggle={onToggle}
          />
        ))}
      </div>
    )
  }

  const restrita = restritas.has(no.id)
  const comprometida = comprometidas.has(no.id)
  const bloqueada = restrita || comprometida
  const selecionada = selecionadoId === no.id
  return (
    <div
      className={[styles.noArvoreFolha, selecionada ? styles.noArvoreFolhaSelecionada : '', bloqueada ? styles.noArvoreFolhaBloqueada : ''].filter(Boolean).join(' ')}
      style={{ paddingLeft: 26 + profundidade * 16 }}
      onClick={() => !bloqueada && onSelecionar(no.id)}
      role="button"
      tabIndex={bloqueada ? undefined : 0}
    >
      {no.nome}{' '}
      {bloqueada
        ? <span className={styles.noArvoreMeta}>({restrita ? 'restrição aberta' : 'já comprometida'})</span>
        : <span className={styles.noArvoreMeta}>(atual: {percentuais[no.id] ?? 0}%)</span>}
    </div>
  )
}
