import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useObra } from '../contexts/ObraContext'
import { supabase, type DefinicaoProjeto, type Unidade, type StatusDefinicao } from '../lib/supabase'
import { hojeISO } from '../lib/cronograma'
import styles from './Definicoes.module.css'

const fmtData = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`

const STATUS_LABEL: Record<StatusDefinicao, string> = {
  pendente: 'Pendente',
  resolvida: 'Resolvida',
}

export default function Definicoes() {
  const { perfil, temModulo } = useAuth()
  const { obraAtiva } = useObra()
  const podeEditar = perfil?.papel === 'admin' || temModulo('definicoes')

  const [definicoes, setDefinicoes] = useState<DefinicaoProjeto[]>([])
  const [unidades, setUnidades] = useState<Unidade[]>([])
  const [carregando, setCarregando] = useState(true)
  const [filtroUnidade, setFiltroUnidade] = useState('')
  const [filtroStatus, setFiltroStatus] = useState<StatusDefinicao | ''>('')
  const [filtroResp, setFiltroResp] = useState('')

  const [formAberto, setFormAberto] = useState(false)
  const [editandoId, setEditandoId] = useState<string | null>(null)
  const [titulo, setTitulo] = useState('')
  const [unidadeSel, setUnidadeSel] = useState('')
  const [localAmbiente, setLocalAmbiente] = useState('')
  const [descricao, setDescricao] = useState('')
  const [responsavel, setResponsavel] = useState('')
  const [prazo, setPrazo] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)

  const [resolvendoId, setResolvendoId] = useState<string | null>(null)
  const [decisaoTexto, setDecisaoTexto] = useState('')
  const [resolvendo, setResolvendo] = useState(false)

  function carregar() {
    if (!obraAtiva) return
    setCarregando(true)
    Promise.all([
      supabase.from('definicoes_projeto').select('*').eq('obra_id', obraAtiva.id).eq('ativo', true),
      supabase.from('unidades').select('*').eq('obra_id', obraAtiva.id).order('ordem'),
    ]).then(([d, u]) => {
      setDefinicoes(d.data ?? [])
      setUnidades(u.data ?? [])
      setCarregando(false)
    })
  }

  useEffect(carregar, [obraAtiva])

  const hoje = hojeISO()
  const nomeUnidade = useMemo(() => new Map(unidades.map(u => [u.id, u.nome])), [unidades])

  function vencida(d: DefinicaoProjeto): boolean {
    return d.status === 'pendente' && d.prazo !== null && d.prazo < hoje
  }

  const responsaveis = useMemo(
    () => [...new Set(definicoes.map(d => d.responsavel).filter((r): r is string => !!r))]
      .sort((a, b) => a.localeCompare(b, 'pt-BR')),
    [definicoes]
  )

  const filtradas = useMemo(() => {
    const lista = definicoes.filter(d =>
      (!filtroUnidade || d.unidade_id === filtroUnidade) &&
      (!filtroStatus || d.status === filtroStatus) &&
      (!filtroResp || (filtroResp === '__sem__' ? !d.responsavel : d.responsavel === filtroResp))
    )
    return lista.sort((a, b) => {
      const va = vencida(a) ? 1 : 0
      const vb = vencida(b) ? 1 : 0
      if (va !== vb) return vb - va
      if (a.prazo && b.prazo && a.prazo !== b.prazo) return a.prazo.localeCompare(b.prazo)
      if (a.prazo && !b.prazo) return -1
      if (!a.prazo && b.prazo) return 1
      return b.criado_em.localeCompare(a.criado_em)
    })
  }, [definicoes, filtroUnidade, filtroStatus, filtroResp, hoje])

  const contagem = useMemo(() => ({
    pendente: definicoes.filter(d => d.status === 'pendente').length,
    resolvida: definicoes.filter(d => d.status === 'resolvida').length,
  }), [definicoes])

  function abrirNovo() {
    setEditandoId(null)
    setTitulo(''); setUnidadeSel(''); setLocalAmbiente(''); setDescricao(''); setResponsavel(''); setPrazo('')
    setMsg(null)
    setFormAberto(true)
  }

  function abrirEdicao(d: DefinicaoProjeto) {
    setEditandoId(d.id)
    setTitulo(d.titulo)
    setUnidadeSel(d.unidade_id ?? '')
    setLocalAmbiente(d.local_ambiente ?? '')
    setDescricao(d.descricao ?? '')
    setResponsavel(d.responsavel ?? '')
    setPrazo(d.prazo ?? '')
    setMsg(null)
    setFormAberto(true)
  }

  async function salvar() {
    if (!obraAtiva) return
    if (!titulo.trim()) {
      setMsg({ tipo: 'erro', texto: 'Informe o título da decisão.' })
      return
    }
    setSalvando(true)
    setMsg(null)
    const dados = {
      titulo: titulo.trim(),
      unidade_id: unidadeSel || null,
      local_ambiente: localAmbiente.trim() || null,
      descricao: descricao.trim() || null,
      responsavel: responsavel.trim() || null,
      prazo: prazo || null,
    }
    const { error } = editandoId
      ? await supabase.from('definicoes_projeto').update(dados).eq('id', editandoId)
      : await supabase.from('definicoes_projeto').insert({ ...dados, obra_id: obraAtiva.id })
    setSalvando(false)
    if (error) {
      setMsg({ tipo: 'erro', texto: `Erro ao salvar: ${error.message}` })
      return
    }
    setMsg({ tipo: 'ok', texto: editandoId ? 'Definição atualizada.' : 'Definição cadastrada.' })
    setFormAberto(false)
    carregar()
  }

  function abrirResolver(id: string) {
    setResolvendoId(id)
    setDecisaoTexto('')
  }

  async function confirmarResolucao(id: string) {
    setResolvendo(true)
    const { error } = await supabase.from('definicoes_projeto').update({
      status: 'resolvida',
      decisao: decisaoTexto.trim() || null,
      resolvida_em: new Date().toISOString(),
      resolvida_por: perfil?.id,
    }).eq('id', id)
    setResolvendo(false)
    if (error) {
      setMsg({ tipo: 'erro', texto: `Erro ao resolver: ${error.message}` })
      return
    }
    setResolvendoId(null)
    carregar()
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1>Definições de Projeto</h1>
          <p className={styles.sub}>Decisões pendentes do cliente — acabamento, cor, modelo — com prazo e responsável.</p>
        </div>
        {podeEditar && (
          <button className={styles.btnNova} onClick={abrirNovo}>+ Nova definição</button>
        )}
      </div>

      {podeEditar && formAberto && (
        <div className={styles.bloco}>
          <div className={styles.campos}>
            <label className={styles.campo}>
              Título *
              <input value={titulo} onChange={e => setTitulo(e.target.value)} placeholder="Ex.: Cor da telha cerâmica" />
            </label>
            <div className={styles.linha2}>
              <label className={styles.campo}>
                Unidade (opcional)
                <select value={unidadeSel} onChange={e => setUnidadeSel(e.target.value)}>
                  <option value="">Sem vínculo — decisão geral da obra</option>
                  {unidades.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}
                </select>
              </label>
              <label className={styles.campo}>
                Local/Ambiente
                <input value={localAmbiente} onChange={e => setLocalAmbiente(e.target.value)} placeholder="Ex.: Banheiro suíte" />
              </label>
            </div>
            <label className={styles.campo}>
              Descrição
              <textarea value={descricao} onChange={e => setDescricao(e.target.value)} placeholder="Contexto da decisão" />
            </label>
            <div className={styles.linha2}>
              <label className={styles.campo}>
                Responsável
                <input value={responsavel} onChange={e => setResponsavel(e.target.value)} placeholder="Quem precisa decidir" />
              </label>
              <label className={styles.campo}>
                Prazo
                <input type="date" value={prazo} onChange={e => setPrazo(e.target.value)} />
              </label>
            </div>
          </div>
          {msg && <p className={msg.tipo === 'ok' ? styles.msgOk : styles.msgErro}>{msg.texto}</p>}
          <div className={styles.acoesForm}>
            <button className={styles.btnNova} onClick={salvar} disabled={salvando}>
              {salvando ? 'Salvando…' : editandoId ? 'Salvar alterações' : '+ Cadastrar definição'}
            </button>
            <button className={styles.btnSecundario} onClick={() => setFormAberto(false)}>Cancelar</button>
          </div>
        </div>
      )}

      <div className={styles.contadores}>
        {(['pendente', 'resolvida'] as StatusDefinicao[]).map(s => (
          <button
            key={s}
            className={`${styles.contador} ${styles[`cont_${s}`]} ${filtroStatus === s ? styles.contAtivo : ''}`}
            onClick={() => setFiltroStatus(filtroStatus === s ? '' : s)}
          >
            <span className={styles.contNum}>{contagem[s]}</span>
            <span className={styles.contLabel}>{STATUS_LABEL[s]}s</span>
          </button>
        ))}
      </div>

      <div className={styles.filtros}>
        <select value={filtroUnidade} onChange={e => setFiltroUnidade(e.target.value)} className={styles.selectFiltro}>
          <option value="">Todas as unidades</option>
          {unidades.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}
        </select>
        <select value={filtroResp} onChange={e => setFiltroResp(e.target.value)} className={styles.selectFiltro}>
          <option value="">Todos os responsáveis</option>
          <option value="__sem__">Sem responsável</option>
          {responsaveis.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
      </div>

      {carregando && <p className={styles.vazio}>Carregando…</p>}
      {!carregando && filtradas.length === 0 && (
        <p className={styles.vazio}>
          {definicoes.length === 0 ? 'Nenhuma definição registrada.' : 'Nenhuma definição com esses filtros.'}
        </p>
      )}

      {filtradas.map(d => (
        <div key={d.id} className={`${styles.card} ${vencida(d) ? styles.cardVencida : ''}`}>
          <div className={styles.cardTopo}>
            <span className={styles.cardTitulo}>{d.titulo}</span>
            <span className={`${styles.chip} ${styles[`chip_${d.status}`]}`}>{STATUS_LABEL[d.status]}</span>
          </div>
          {(d.unidade_id || d.local_ambiente) && (
            <div className={styles.cardMeta}>
              {d.unidade_id && (nomeUnidade.get(d.unidade_id) ?? '?')}
              {d.unidade_id && d.local_ambiente ? ' — ' : ''}
              {d.local_ambiente}
            </div>
          )}
          {d.descricao && <div className={styles.cardDesc}>{d.descricao}</div>}
          {d.status === 'resolvida' && d.decisao && (
            <div className={styles.cardDesc}><strong>Decisão:</strong> {d.decisao}</div>
          )}
          <div className={styles.cardRodape}>
            {d.responsavel && <span>👤 {d.responsavel}</span>}
            {d.prazo && (
              <span className={vencida(d) ? styles.prazoVencido : ''}>
                📅 {fmtData(d.prazo)}
              </span>
            )}
          </div>
          {podeEditar && (
            <div className={styles.acoesForm} style={{ marginTop: 8 }}>
              <button className={styles.btnSecundario} onClick={() => abrirEdicao(d)}>Editar</button>
              {d.status === 'pendente' && (
                <button className={styles.btnResolver} onClick={() => abrirResolver(d.id)}>Marcar como resolvida</button>
              )}
            </div>
          )}
          {resolvendoId === d.id && (
            <div className={styles.blocoResolver}>
              <label className={styles.campo}>
                O que foi decidido?
                <textarea value={decisaoTexto} onChange={e => setDecisaoTexto(e.target.value)} placeholder="Ex.: Cliente escolheu porcelanato branco 60x60" />
              </label>
              <div className={styles.acoesForm}>
                <button className={styles.btnResolver} onClick={() => confirmarResolucao(d.id)} disabled={resolvendo}>
                  {resolvendo ? 'Salvando…' : 'Confirmar resolução'}
                </button>
                <button className={styles.btnSecundario} onClick={() => setResolvendoId(null)}>Cancelar</button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
