import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useObra } from '../contexts/ObraContext'
import {
  supabase, type Unidade, type CronogramaTarefa, type CronogramaPrevisto, type AvancoFisico,
} from '../lib/supabase'
import { percentuaisAtuais, hojeISO } from '../lib/cronograma'
import styles from './Avanco.module.css'

const fmtData = (iso: string | null | undefined) =>
  iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(2, 4)}` : '—'
const fmtNum = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 2 })

const UNIDADES_MEDIDA = ['m', 'm²', 'm³', 'unid.', 'kg', 'vb', 'pt', 'conj.']

// % a partir da quantidade executada ÷ total (limitado a 100)
function pctDaQuantidade(q: number, total: number): number {
  return Math.min(100, Math.round((q / total) * 10000) / 100)
}

function parseNum(v: string): number {
  return Number(v.replace(/\./g, '').replace(',', '.'))
}

interface Grupo {
  chave: string
  rotulo: string
  folhas: CronogramaTarefa[]
}

export default function Avanco() {
  const { perfil, temModulo } = useAuth()
  const { obraAtiva } = useObra()
  const podeLancar = perfil?.papel === 'admin' || temModulo('avanco')

  const [unidades, setUnidades] = useState<Unidade[]>([])
  const [unidadeId, setUnidadeId] = useState('')
  const [tarefas, setTarefas] = useState<CronogramaTarefa[]>([])
  const [previstos, setPrevistos] = useState<Map<string, CronogramaPrevisto>>(new Map())
  const [atuais, setAtuais] = useState<Map<string, AvancoFisico>>(new Map())
  const [valores, setValores] = useState<Map<string, string>>(new Map())   // % direto (tarefa sem total)
  const [qtds, setQtds] = useState<Map<string, string>>(new Map())         // quantidade executada
  const [obs, setObs] = useState<Map<string, string>>(new Map())
  const [defQuant, setDefQuant] = useState<Map<string, { q: string; u: string }>>(new Map()) // mini-form do total
  const [dataRef, setDataRef] = useState(hojeISO())
  const [carregando, setCarregando] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)
  const [gruposAbertos, setGruposAbertos] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!obraAtiva) return
    supabase.from('unidades').select('*').eq('obra_id', obraAtiva.id).order('ordem')
      .then(({ data }) => setUnidades(data ?? []))
  }, [obraAtiva])

  useEffect(() => {
    if (!unidadeId) { setTarefas([]); return }
    carregarUnidade(unidadeId)
  }, [unidadeId])

  async function carregarUnidade(uid: string) {
    setCarregando(true)
    setMsg(null)
    const { data: tars } = await supabase
      .from('cronograma_tarefas').select('*')
      .eq('unidade_id', uid).eq('ativo', true).order('ordem')
    const lista = tars ?? []
    setTarefas(lista)

    const ids = lista.map(t => t.id)
    if (ids.length === 0) {
      setPrevistos(new Map()); setAtuais(new Map()); setCarregando(false)
      return
    }
    const [{ data: prevs }, { data: avs }] = await Promise.all([
      supabase.from('cronograma_previsto').select('*').in('tarefa_id', ids),
      supabase.from('avancos_fisicos').select('*').in('tarefa_id', ids).eq('ativo', true),
    ])
    setPrevistos(new Map((prevs ?? []).map(p => [p.tarefa_id, p])))
    setAtuais(percentuaisAtuais(avs ?? []))
    setValores(new Map())
    setQtds(new Map())
    setObs(new Map())
    setDefQuant(new Map())
    setCarregando(false)
  }

  // Agrupa folhas pelo caminho de ancestrais (sem a raiz quando ela é única)
  const grupos: Grupo[] = useMemo(() => {
    const porId = new Map(tarefas.map(t => [t.id, t]))
    const raizes = tarefas.filter(t => !t.parent_id || !porId.has(t.parent_id))
    const raizUnica = raizes.length === 1 ? raizes[0].id : null
    const mapa = new Map<string, Grupo>()
    for (const t of tarefas) {
      if (t.resumo) continue
      const caminho: CronogramaTarefa[] = []
      let p = t.parent_id ? porId.get(t.parent_id) : undefined
      while (p) {
        caminho.unshift(p)
        p = p.parent_id ? porId.get(p.parent_id) : undefined
      }
      const semRaiz = raizUnica ? caminho.filter(c => c.id !== raizUnica) : caminho
      const rotulo = semRaiz.map(c => c.nome).join(' › ') || (caminho[caminho.length - 1]?.nome ?? 'Geral')
      const chave = semRaiz.map(c => c.id).join('/') || 'geral'
      const g: Grupo = mapa.get(chave) ?? { chave, rotulo, folhas: [] }
      g.folhas.push(t)
      mapa.set(chave, g)
    }
    return [...mapa.values()]
  }, [tarefas])

  // Novo % de uma tarefa a partir dos inputs (null = sem alteração; NaN = inválido)
  function novoPct(t: CronogramaTarefa): { pct: number; qtd: number | null } | 'invalido' | null {
    if (t.quant_total) {
      const v = qtds.get(t.id) ?? ''
      if (v.trim() === '') return null
      const q = parseNum(v)
      if (isNaN(q) || q < 0 || q > t.quant_total) return 'invalido'
      return { pct: pctDaQuantidade(q, t.quant_total), qtd: q }
    }
    const v = valores.get(t.id) ?? ''
    if (v.trim() === '') return null
    const pct = parseNum(v)
    if (isNaN(pct) || pct < 0 || pct > 100) return 'invalido'
    return { pct, qtd: null }
  }

  const { alterados, invalidos } = useMemo(() => {
    const lista: { tarefa: CronogramaTarefa; pct: number; qtd: number | null }[] = []
    let inv = 0
    for (const t of tarefas) {
      if (t.resumo) continue
      const r = novoPct(t)
      if (r === null) continue
      if (r === 'invalido') { inv++; continue }
      const atual = atuais.get(t.id)
      const pctAtual = atual?.percentual ?? 0
      const qtdAtual = atual?.quantidade ?? null
      if (r.pct !== pctAtual || (r.qtd !== null && r.qtd !== qtdAtual)) {
        lista.push({ tarefa: t, pct: r.pct, qtd: r.qtd })
      }
    }
    return { alterados: lista, invalidos: inv }
  }, [tarefas, valores, qtds, atuais])

  async function salvar() {
    if (alterados.length === 0 || salvando) return
    setSalvando(true)
    setMsg(null)
    const linhas = alterados.map(({ tarefa, pct, qtd }) => ({
      tarefa_id: tarefa.id,
      data_referencia: dataRef,
      percentual: pct,
      quantidade: qtd,
      observacao: obs.get(tarefa.id)?.trim() || null,
    }))
    const { error } = await supabase.from('avancos_fisicos').insert(linhas)
    setSalvando(false)
    if (error) {
      setMsg({ tipo: 'erro', texto: `Erro ao salvar: ${error.message}` })
      return
    }
    setMsg({ tipo: 'ok', texto: `${linhas.length} lançamento${linhas.length !== 1 ? 's' : ''} salvo${linhas.length !== 1 ? 's' : ''} em ${fmtData(dataRef)}.` })
    await carregarUnidade(unidadeId)
  }

  async function salvarQuantidadeTotal(t: CronogramaTarefa) {
    const form = defQuant.get(t.id)
    if (!form) return
    const q = parseNum(form.q)
    const u = form.u.trim()
    if (isNaN(q) || q <= 0 || !u) {
      setMsg({ tipo: 'erro', texto: 'Informe quantidade total maior que zero e a unidade.' })
      return
    }
    const { error } = await supabase.rpc('definir_quantidade_tarefa', {
      p_tarefa: t.id, p_quant: q, p_und: u,
    })
    if (error) {
      setMsg({ tipo: 'erro', texto: `Erro ao definir quantidade: ${error.message}` })
      return
    }
    setMsg(null)
    setTarefas(prev => prev.map(x => x.id === t.id ? { ...x, quant_total: q, und: u } : x))
    setDefQuant(prev => { const novo = new Map(prev); novo.delete(t.id); return novo })
  }

  function setValor(id: string, v: string) {
    setValores(prev => new Map(prev).set(id, v))
  }
  function setQtd(id: string, v: string) {
    setQtds(prev => new Map(prev).set(id, v))
  }
  function setObsItem(id: string, v: string) {
    setObs(prev => new Map(prev).set(id, v))
  }
  function abrirDefQuant(t: CronogramaTarefa) {
    setDefQuant(prev => new Map(prev).set(t.id, {
      q: t.quant_total ? String(t.quant_total).replace('.', ',') : '',
      u: t.und ?? '',
    }))
  }
  function setDefCampo(id: string, campo: 'q' | 'u', v: string) {
    setDefQuant(prev => {
      const novo = new Map(prev)
      const atual = novo.get(id) ?? { q: '', u: '' }
      novo.set(id, { ...atual, [campo]: v })
      return novo
    })
  }
  function toggleGrupo(chave: string) {
    setGruposAbertos(prev => {
      const novo = new Set(prev)
      if (novo.has(chave)) novo.delete(chave)
      else novo.add(chave)
      return novo
    })
  }

  if (!podeLancar) {
    return (
      <div className={styles.page}>
        <h1>Avanço Físico</h1>
        <p className={styles.aviso}>
          Seu perfil não tem permissão para lançar avanço. O acompanhamento está disponível na tela Cronograma.
        </p>
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <h1>Avanço Físico</h1>
      <p className={styles.sub}>
        Medição por quantidade (m, m², m³, unid.) com % calculado automaticamente. Na 1ª medição de uma tarefa, defina a quantidade total. Cada lançamento grava autor e data/hora — nada é sobrescrito.
      </p>

      <div className={styles.filtros}>
        <select className={styles.select} value={unidadeId} onChange={e => setUnidadeId(e.target.value)}>
          <option value="">Selecione a unidade…</option>
          {unidades.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}
        </select>
        <label className={styles.dataLabel}>
          Semana de referência
          <input type="date" className={styles.data} value={dataRef} max={hojeISO()} onChange={e => setDataRef(e.target.value)} />
        </label>
      </div>

      {carregando && <p className={styles.carregando}>Carregando tarefas…</p>}
      {!carregando && unidadeId && grupos.length === 0 && (
        <p className={styles.vazio}>Nenhuma tarefa de cronograma para esta unidade.</p>
      )}

      {!carregando && grupos.map(g => {
        const aberto = gruposAbertos.has(g.chave)
        const lancadas = g.folhas.filter(f => (atuais.get(f.id)?.percentual ?? 0) >= 100).length
        return (
          <div key={g.chave} className={styles.grupo}>
            <button className={styles.grupoHeader} onClick={() => toggleGrupo(g.chave)}>
              <span className={styles.seta}>{aberto ? '▾' : '▸'}</span>
              <span className={styles.grupoNome}>{g.rotulo}</span>
              <span className={styles.grupoInfo}>{lancadas}/{g.folhas.length} concluídas</span>
            </button>
            {aberto && g.folhas.map(f => {
              const prev = previstos.get(f.id)
              const atual = atuais.get(f.id)
              const form = defQuant.get(f.id)
              const r = novoPct(f)
              const invalido = r === 'invalido'

              return (
                <div key={f.id} className={styles.item}>
                  <div className={styles.itemInfo}>
                    <span className={styles.itemNome}>{f.nome}</span>
                    <span className={styles.itemDatas}>
                      {fmtData(prev?.inicio)} – {fmtData(prev?.fim)}
                      {atual && (
                        <> · último: {atual.quantidade !== null && f.quant_total
                          ? `${fmtNum(atual.quantidade)} ${f.und} (${fmtNum(atual.percentual)}%)`
                          : `${fmtNum(atual.percentual)}%`} em {fmtData(atual.data_referencia)}</>
                      )}
                    </span>
                  </div>

                  {form ? (
                    // Mini-form: definir/corrigir a quantidade total da tarefa
                    <div className={styles.itemCampos}>
                      <span className={styles.defLabel}>Total previsto:</span>
                      <input
                        type="text" inputMode="decimal" className={styles.inputQtd}
                        placeholder="quant." value={form.q}
                        onChange={e => setDefCampo(f.id, 'q', e.target.value)}
                      />
                      <input
                        type="text" list="unidades-medida" className={styles.inputUnd}
                        placeholder="und" value={form.u}
                        onChange={e => setDefCampo(f.id, 'u', e.target.value)}
                      />
                      <button className={styles.btnDefOk} onClick={() => salvarQuantidadeTotal(f)}>Salvar total</button>
                      <button
                        className={styles.btnDefCancela}
                        onClick={() => setDefQuant(prevMap => { const novo = new Map(prevMap); novo.delete(f.id); return novo })}
                      >
                        Cancelar
                      </button>
                    </div>
                  ) : f.quant_total ? (
                    // Medição por quantidade
                    <div className={styles.itemCampos}>
                      <span className={styles.atual}>{fmtNum(atual?.quantidade ?? 0)}</span>
                      <span className={styles.setaPct}>→</span>
                      <input
                        type="text" inputMode="decimal"
                        className={`${styles.inputQtd} ${invalido ? styles.inputInvalido : ''}`}
                        placeholder="quant." value={qtds.get(f.id) ?? ''}
                        onChange={e => setQtd(f.id, e.target.value)}
                      />
                      <span className={styles.totalInfo}>
                        de {fmtNum(f.quant_total)} {f.und}
                        {r && r !== 'invalido' && <strong className={styles.pctCalc}> = {fmtNum(r.pct)}%</strong>}
                      </span>
                      <button
                        className={styles.btn100}
                        onClick={() => setQtd(f.id, String(f.quant_total).replace('.', ','))}
                        title="Executado 100%"
                      >
                        Total
                      </button>
                      <button className={styles.btnEditTotal} onClick={() => abrirDefQuant(f)} title="Corrigir quantidade total">✎</button>
                      <input
                        type="text" className={styles.inputObs} placeholder="obs. (opcional)"
                        value={obs.get(f.id) ?? ''} onChange={e => setObsItem(f.id, e.target.value)}
                      />
                    </div>
                  ) : (
                    // Sem quantidade total definida: % direto + botão para definir
                    <div className={styles.itemCampos}>
                      <span className={styles.atual}>{fmtNum(atual?.percentual ?? 0)}%</span>
                      <span className={styles.setaPct}>→</span>
                      <input
                        type="text" inputMode="decimal"
                        className={`${styles.inputPct} ${invalido ? styles.inputInvalido : ''}`}
                        placeholder="%" value={valores.get(f.id) ?? ''}
                        onChange={e => setValor(f.id, e.target.value)}
                      />
                      <button className={styles.btn100} onClick={() => setValor(f.id, '100')}>100</button>
                      <button className={styles.btnDefinir} onClick={() => abrirDefQuant(f)}>
                        📏 Medir por quantidade
                      </button>
                      <input
                        type="text" className={styles.inputObs} placeholder="obs. (opcional)"
                        value={obs.get(f.id) ?? ''} onChange={e => setObsItem(f.id, e.target.value)}
                      />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )
      })}

      <datalist id="unidades-medida">
        {UNIDADES_MEDIDA.map(u => <option key={u} value={u} />)}
      </datalist>

      {msg && <p className={msg.tipo === 'ok' ? styles.msgOk : styles.msgErro}>{msg.texto}</p>}

      {unidadeId && (
        <div className={styles.rodape}>
          {invalidos > 0 && (
            <span className={styles.msgErro}>
              {invalidos} valor{invalidos !== 1 ? 'es' : ''} inválido{invalidos !== 1 ? 's' : ''} (acima do total ou fora de 0–100)
            </span>
          )}
          <button
            className={styles.btnSalvar}
            disabled={alterados.length === 0 || invalidos > 0 || salvando}
            onClick={salvar}
          >
            {salvando ? 'Salvando…' : `Salvar ${alterados.length > 0 ? alterados.length + ' ' : ''}lançamento${alterados.length !== 1 ? 's' : ''}`}
          </button>
        </div>
      )}
    </div>
  )
}
