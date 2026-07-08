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
  const [valores, setValores] = useState<Map<string, string>>(new Map())
  const [obs, setObs] = useState<Map<string, string>>(new Map())
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
    setObs(new Map())
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

  const alterados = useMemo(() => {
    const lista: { tarefa: CronogramaTarefa; pct: number }[] = []
    for (const [id, v] of valores) {
      if (v.trim() === '') continue
      const pct = Number(v.replace(',', '.'))
      if (isNaN(pct) || pct < 0 || pct > 100) continue
      const atual = atuais.get(id)?.percentual ?? 0
      if (pct !== atual) {
        const t = tarefas.find(x => x.id === id)
        if (t) lista.push({ tarefa: t, pct })
      }
    }
    return lista
  }, [valores, atuais, tarefas])

  const invalidos = useMemo(() => {
    let n = 0
    for (const v of valores.values()) {
      if (v.trim() === '') continue
      const pct = Number(v.replace(',', '.'))
      if (isNaN(pct) || pct < 0 || pct > 100) n++
    }
    return n
  }, [valores])

  async function salvar() {
    if (alterados.length === 0 || salvando) return
    setSalvando(true)
    setMsg(null)
    const linhas = alterados.map(({ tarefa, pct }) => ({
      tarefa_id: tarefa.id,
      data_referencia: dataRef,
      percentual: pct,
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

  function setValor(id: string, v: string) {
    setValores(prev => new Map(prev).set(id, v))
  }
  function setObsItem(id: string, v: string) {
    setObs(prev => new Map(prev).set(id, v))
  }
  function toggleGrupo(chave: string) {
    const novo = new Set(gruposAbertos)
    if (novo.has(chave)) novo.delete(chave)
    else novo.add(chave)
    setGruposAbertos(novo)
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
        Lançamento semanal do % acumulado por tarefa. Cada lançamento grava autor e data/hora — nada é sobrescrito.
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
              const valor = valores.get(f.id) ?? ''
              const pctNum = valor.trim() === '' ? null : Number(valor.replace(',', '.'))
              const invalido = pctNum !== null && (isNaN(pctNum) || pctNum < 0 || pctNum > 100)
              return (
                <div key={f.id} className={styles.item}>
                  <div className={styles.itemInfo}>
                    <span className={styles.itemNome}>{f.nome}</span>
                    <span className={styles.itemDatas}>
                      {fmtData(prev?.inicio)} – {fmtData(prev?.fim)}
                      {atual && <> · último: {atual.percentual}% em {fmtData(atual.data_referencia)}</>}
                    </span>
                  </div>
                  <div className={styles.itemCampos}>
                    <span className={styles.atual}>{atual?.percentual ?? 0}%</span>
                    <span className={styles.setaPct}>→</span>
                    <input
                      type="number" min={0} max={100} inputMode="decimal"
                      className={`${styles.inputPct} ${invalido ? styles.inputInvalido : ''}`}
                      placeholder="%" value={valor}
                      onChange={e => setValor(f.id, e.target.value)}
                    />
                    <button className={styles.btn100} onClick={() => setValor(f.id, '100')}>100</button>
                    <input
                      type="text" className={styles.inputObs} placeholder="obs. (opcional)"
                      value={obs.get(f.id) ?? ''} onChange={e => setObsItem(f.id, e.target.value)}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        )
      })}

      {msg && <p className={msg.tipo === 'ok' ? styles.msgOk : styles.msgErro}>{msg.texto}</p>}

      {unidadeId && (
        <div className={styles.rodape}>
          {invalidos > 0 && <span className={styles.msgErro}>{invalidos} valor{invalidos !== 1 ? 'es' : ''} fora de 0–100</span>}
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
