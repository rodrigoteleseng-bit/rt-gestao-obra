import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useObra } from '../contexts/ObraContext'
import { supabase, type CategoriaRestricao, type PerfilUsuario, type Restricao, type StatusRestricao } from '../lib/supabase'
import styles from './Planejamento.module.css'

type Msg = { tipo: 'ok' | 'erro'; texto: string } | null
type Aba = 'mensal' | 'semanal' | 'trimestral'

interface TarefaCronograma {
  id: string
  nome: string
  etapa_id: string | null
  unidade_id: string | null
  resumo: boolean
  etapas: { nome: string } | null
  unidades: { nome: string } | null
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

export default function Planejamento() {
  const { perfil, temModulo } = useAuth()
  const { obraAtiva } = useObra()
  const podeEditar = perfil?.papel === 'admin' || (perfil?.papel === 'equipe' && temModulo('planejamento'))
  const semPermissao = !podeEditar

  const [aba, setAba] = useState<Aba>('mensal')
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

  const tarefaPorId = useMemo(() => new Map(tarefas.map(t => [t.id, t])), [tarefas])
  const usuarioPorId = useMemo(() => new Map(usuarios.map(u => [u.id, u])), [usuarios])

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
    const [tarefasResp, usuariosResp, restricoesResp] = await Promise.all([
      supabase.from('cronograma_tarefas').select('id, nome, etapa_id, unidade_id, resumo, etapas(nome), unidades(nome)').eq('obra_id', obraAtiva.id).eq('ativo', true).eq('resumo', false).order('nome'),
      supabase.from('perfis_usuario').select('*').eq('ativo', true).neq('papel', 'cliente').order('nome'),
      supabase.from('restricoes').select('*').eq('obra_id', obraAtiva.id).eq('ativo', true).order('prazo'),
    ])
    if (tarefasResp.error) setMsg({ tipo: 'erro', texto: 'Erro ao carregar tarefas do cronograma: ' + tarefasResp.error.message })
    else setTarefas((tarefasResp.data ?? []) as unknown as TarefaCronograma[])
    if (usuariosResp.error) setMsg({ tipo: 'erro', texto: 'Erro ao carregar usuários: ' + usuariosResp.error.message })
    else setUsuarios(usuariosResp.data ?? [])
    if (restricoesResp.error) setMsg({ tipo: 'erro', texto: 'Erro ao carregar restrições: ' + restricoesResp.error.message })
    else setRestricoes(restricoesResp.data ?? [])
    setCarregando(false)
  }

  useEffect(() => { carregar() }, [obraAtiva?.id, semPermissao])

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

  if (semPermissao) return <div className={styles.page}><h1>Planejamento</h1><div className={styles.msgErro}>Você não tem permissão para acessar Planejamento.</div></div>

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div><h1>Planejamento</h1><p className={styles.sub}>Restrições, compromisso semanal e marcos do cronograma.</p></div>
      </div>
      {msg && <div className={msg.tipo === 'ok' ? styles.msgOk : styles.msgErro}>{msg.texto}</div>}

      <div className={styles.abas}>
        <button className={[styles.aba, aba === 'mensal' ? styles.abaAtiva : ''].filter(Boolean).join(' ')} onClick={() => setAba('mensal')}>Mensal</button>
        <button className={[styles.aba, aba === 'semanal' ? styles.abaAtiva : ''].filter(Boolean).join(' ')} onClick={() => setAba('semanal')}>Semanal</button>
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
              <label className={styles.campo}>Tarefa<select value={tarefaId} onChange={e => setTarefaId(e.target.value)}><option value="">Selecione</option>{tarefasFiltradas.map(t => <option key={t.id} value={t.id}>{t.nome}{t.etapas ? ' - ' + t.etapas.nome : ''}</option>)}</select></label>
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
    </div>
  )
}
