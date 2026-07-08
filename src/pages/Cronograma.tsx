import { useEffect, useMemo, useState } from 'react'
import { useObra } from '../contexts/ObraContext'
import { supabase, type Unidade } from '../lib/supabase'
import {
  carregarCronograma, percentuaisAtuais, montarArvore, statusTarefa, hojeISO,
  type DadosCronograma, type NoCronograma, type StatusTarefa,
} from '../lib/cronograma'
import styles from './Cronograma.module.css'

const fmtData = (iso: string | null | undefined) =>
  iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(2, 4)}` : '—'
const fmtPct = (v: number) => `${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`

const STATUS_LABEL: Record<StatusTarefa, string> = {
  concluida: 'Concluída', atrasada: 'Atrasada', andamento: 'Em andamento', prevista: 'Prevista',
}

type Aba = 'arvore' | 'curva' | 'atrasadas'

export default function Cronograma() {
  const { obraAtiva } = useObra()
  const [dados, setDados] = useState<DadosCronograma | null>(null)
  const [unidades, setUnidades] = useState<Unidade[]>([])
  const [carregando, setCarregando] = useState(true)
  const [aba, setAba] = useState<Aba>('arvore')
  const [busca, setBusca] = useState('')
  const [filtroUnidade, setFiltroUnidade] = useState('')
  const [filtroStatus, setFiltroStatus] = useState('')
  const [abertos, setAbertos] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!obraAtiva) return
    setCarregando(true)
    Promise.all([
      carregarCronograma(obraAtiva.id),
      supabase.from('unidades').select('*').eq('obra_id', obraAtiva.id).order('ordem').then(r => r.data ?? []),
    ]).then(([d, u]) => {
      setDados(d)
      setUnidades(u)
      setCarregando(false)
    })
  }, [obraAtiva])

  const hoje = hojeISO()

  const calculado = useMemo(() => {
    if (!dados) return null
    const pcts = percentuaisAtuais(dados.avancos)
    const arvore = montarArvore(dados.tarefas, dados.previstoPorTarefa, pcts)
    return { pcts, arvore }
  }, [dados])

  if (carregando || !dados || !calculado) {
    return <div className={styles.page}><p className={styles.carregando}>Carregando cronograma…</p></div>
  }
  if (!dados.versao) {
    return (
      <div className={styles.page}>
        <h1>Cronograma</h1>
        <p className={styles.vazio}>Nenhuma baseline importada para esta obra.</p>
      </div>
    )
  }

  const { pcts, arvore } = calculado

  // Agregado geral da obra (peso = duração prevista)
  let pesoTotal = 0
  let execTotal = 0
  for (const raizes of arvore.values()) for (const r of raizes) { pesoTotal += r.peso; execTotal += r.peso * r.percentual }
  const pctObra = pesoTotal > 0 ? execTotal / pesoTotal : 0

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1>Cronograma</h1>
          <p className={styles.sub}>
            Baseline: {dados.versao.nome} (v{dados.versao.versao}). Previsto do MS Project; executado lançado semanalmente em Avanço Físico.
          </p>
        </div>
        <div className={styles.pctObra}>
          <span className={styles.pctLabel}>Avanço físico da obra</span>
          <span className={styles.pctValor}>{fmtPct(pctObra)}</span>
        </div>
      </div>

      <div className={styles.abas}>
        <button className={aba === 'arvore' ? styles.abaAtiva : styles.aba} onClick={() => setAba('arvore')}>Tarefas</button>
        <button className={aba === 'curva' ? styles.abaAtiva : styles.aba} onClick={() => setAba('curva')}>Curva S</button>
        <button className={aba === 'atrasadas' ? styles.abaAtiva : styles.aba} onClick={() => setAba('atrasadas')}>
          Atrasadas
        </button>
      </div>

      {aba === 'arvore' && (
        <Arvore
          unidades={unidades} arvore={arvore} hoje={hoje}
          busca={busca} setBusca={setBusca}
          filtroUnidade={filtroUnidade} setFiltroUnidade={setFiltroUnidade}
          filtroStatus={filtroStatus} setFiltroStatus={setFiltroStatus}
          abertos={abertos} setAbertos={setAbertos}
        />
      )}
      {aba === 'curva' && <CurvaS dados={dados} arvore={arvore} hoje={hoje} pctObra={pctObra} />}
      {aba === 'atrasadas' && <Atrasadas unidades={unidades} arvore={arvore} hoje={hoje} />}
    </div>
  )
}

// ---------- Aba Tarefas (árvore) ----------

function Arvore(props: {
  unidades: Unidade[]
  arvore: Map<string, NoCronograma[]>
  hoje: string
  busca: string; setBusca: (v: string) => void
  filtroUnidade: string; setFiltroUnidade: (v: string) => void
  filtroStatus: string; setFiltroStatus: (v: string) => void
  abertos: Set<string>; setAbertos: (s: Set<string>) => void
}) {
  const { unidades, arvore, hoje, busca, setBusca, filtroUnidade, setFiltroUnidade, filtroStatus, setFiltroStatus, abertos, setAbertos } = props
  const buscaNorm = busca.trim().toLowerCase()

  function correspondeFiltro(no: NoCronograma): boolean {
    const st = statusTarefa(no, hoje)
    if (filtroStatus && st !== filtroStatus) return false
    if (buscaNorm && !no.tarefa.nome.toLowerCase().includes(buscaNorm)) return false
    return true
  }
  // Um nó aparece se ele ou algum descendente corresponde ao filtro
  function visivel(no: NoCronograma): boolean {
    if (correspondeFiltro(no)) return true
    return no.filhos.some(visivel)
  }

  const temFiltro = buscaNorm.length > 0 || filtroStatus.length > 0

  function toggle(id: string) {
    const novo = new Set(abertos)
    if (novo.has(id)) novo.delete(id)
    else novo.add(id)
    setAbertos(novo)
  }

  function Linha({ no, prof }: { no: NoCronograma; prof: number }) {
    if (temFiltro && !visivel(no)) return null
    const st = statusTarefa(no, hoje)
    const aberto = temFiltro || abertos.has(no.tarefa.id)
    const temFilhos = no.filhos.length > 0
    return (
      <>
        <div
          className={`${styles.linha} ${temFilhos ? styles.linhaResumo : ''}`}
          style={{ paddingLeft: 12 + prof * 18 }}
          onClick={temFilhos ? () => toggle(no.tarefa.id) : undefined}
          role={temFilhos ? 'button' : undefined}
        >
          <span className={styles.seta}>{temFilhos ? (aberto ? '▾' : '▸') : ''}</span>
          <span className={`${styles.dot} ${styles['dot_' + st]}`} title={STATUS_LABEL[st]} />
          <span className={styles.linhaNome}>{no.tarefa.nome}</span>
          <span className={styles.linhaDatas}>
            {fmtData(no.previsto?.inicio)} – {fmtData(no.previsto?.fim)}
          </span>
          <span className={styles.linhaPct}>
            <span className={styles.barra}><span className={styles.barraFill} style={{ width: `${Math.min(no.percentual, 100)}%` }} /></span>
            {fmtPct(no.percentual)}
          </span>
          <span className={`${styles.chip} ${styles['chip_' + st]}`}>{STATUS_LABEL[st]}</span>
        </div>
        {aberto && no.filhos.map(f => <Linha key={f.tarefa.id} no={f} prof={prof + 1} />)}
      </>
    )
  }

  return (
    <>
      <div className={styles.filtros}>
        <input
          type="search" className={styles.busca} placeholder="Buscar tarefa…"
          value={busca} onChange={e => setBusca(e.target.value)}
        />
        <select className={styles.select} value={filtroUnidade} onChange={e => setFiltroUnidade(e.target.value)}>
          <option value="">Todas as unidades</option>
          {unidades.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}
        </select>
        <select className={styles.select} value={filtroStatus} onChange={e => setFiltroStatus(e.target.value)}>
          <option value="">Todos os status</option>
          <option value="atrasada">Atrasadas</option>
          <option value="andamento">Em andamento</option>
          <option value="prevista">Previstas</option>
          <option value="concluida">Concluídas</option>
        </select>
      </div>

      {unidades
        .filter(u => arvore.has(u.id) && (!filtroUnidade || u.id === filtroUnidade))
        .map(u => {
          const raizes = arvore.get(u.id)!
          const peso = raizes.reduce((a, r) => a + r.peso, 0)
          const exec = raizes.reduce((a, r) => a + r.peso * r.percentual, 0)
          const pct = peso > 0 ? exec / peso : 0
          const visiveis = temFiltro ? raizes.filter(visivel) : raizes
          if (temFiltro && visiveis.length === 0) return null
          return (
            <div key={u.id} className={styles.unidade}>
              <div className={styles.unidadeHeader}>
                <span className={styles.unidadeNome}>{u.nome}</span>
                {raizes[0]?.tarefa.grupo_ataque && (
                  <span className={styles.grupoAtaque}>{raizes[0].tarefa.grupo_ataque}</span>
                )}
                <span className={styles.linhaPct}>
                  <span className={styles.barra}><span className={styles.barraFill} style={{ width: `${Math.min(pct, 100)}%` }} /></span>
                  {fmtPct(pct)}
                </span>
              </div>
              {visiveis.map(r => <Linha key={r.tarefa.id} no={r} prof={0} />)}
            </div>
          )
        })}
    </>
  )
}

// ---------- Aba Curva S ----------

function CurvaS({ dados, arvore, hoje, pctObra }: {
  dados: DadosCronograma
  arvore: Map<string, NoCronograma[]>
  hoje: string
  pctObra: number
}) {
  const curva = useMemo(() => {
    // Folhas com previsto
    const folhas: NoCronograma[] = []
    const coletar = (no: NoCronograma) => {
      if (no.filhos.length === 0) { if (no.previsto) folhas.push(no) }
      else no.filhos.forEach(coletar)
    }
    for (const raizes of arvore.values()) raizes.forEach(coletar)
    if (folhas.length === 0) return null

    const pesoTotal = folhas.reduce((a, f) => a + f.peso, 0)

    // Histórico de avanço por tarefa, ordenado por data de referência
    const histPorTarefa = new Map<string, { data: string; pct: number }[]>()
    for (const a of [...dados.avancos].sort((x, y) =>
      x.data_referencia === y.data_referencia
        ? x.criado_em.localeCompare(y.criado_em)
        : x.data_referencia.localeCompare(y.data_referencia))) {
      const lista = histPorTarefa.get(a.tarefa_id) ?? []
      lista.push({ data: a.data_referencia, pct: a.percentual })
      histPorTarefa.set(a.tarefa_id, lista)
    }

    const inicioObra = folhas.reduce((a, f) => f.previsto!.inicio < a ? f.previsto!.inicio : a, '9999')
    const fimObra = folhas.reduce((a, f) => f.previsto!.fim > a ? f.previsto!.fim : a, '0000')

    const DIA = 86_400_000
    const t0 = Date.parse(inicioObra)
    const t1 = Date.parse(fimObra)
    const pontos: { data: string; previsto: number; realizado: number | null }[] = []
    for (let t = t0; ; t += 7 * DIA) {
      const clampT = Math.min(t, t1)
      const dataISO = new Date(clampT).toISOString().slice(0, 10)
      let prev = 0
      let real = 0
      for (const f of folhas) {
        const pi = Date.parse(f.previsto!.inicio)
        const pf = Date.parse(f.previsto!.fim)
        const frac = clampT >= pf ? 1 : clampT <= pi ? 0 : (clampT - pi) / (pf - pi)
        prev += f.peso * frac
        if (dataISO <= hoje) {
          const hist = histPorTarefa.get(f.tarefa.id)
          if (hist) {
            let pct = 0
            for (const h of hist) { if (h.data <= dataISO) pct = h.pct; else break }
            real += f.peso * pct / 100
          }
        }
      }
      pontos.push({
        data: dataISO,
        previsto: (prev / pesoTotal) * 100,
        realizado: dataISO <= hoje ? (real / pesoTotal) * 100 : null,
      })
      if (t >= t1) break
    }
    return { pontos, folhas: folhas.length, pesoTotal }
  }, [dados, arvore, hoje])

  if (!curva) return <p className={styles.vazio}>Sem tarefas com previsão para calcular a curva.</p>

  const { pontos } = curva
  const pontosPassados = pontos.filter(p => p.data <= hoje)
  const previstoHoje = pontosPassados[pontosPassados.length - 1]?.previsto ?? 0
  const desvio = pctObra - previstoHoje

  // Gráfico SVG
  const W = 820, H = 320, ML = 44, MR = 16, MT = 16, MB = 40
  const x = (i: number) => ML + (i / (pontos.length - 1)) * (W - ML - MR)
  const y = (v: number) => MT + (1 - v / 100) * (H - MT - MB)
  const pathPrevisto = pontos.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.previsto).toFixed(1)}`).join('')
  const reais = pontos.map((p, i) => ({ p, i })).filter(({ p }) => p.realizado !== null)
  const pathReal = reais.map(({ p, i }, k) => `${k === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.realizado!).toFixed(1)}`).join('')
  const idxHoje = reais.length > 0 ? reais[reais.length - 1].i : -1

  // Marcas de eixo X: janeiro e julho de cada ano
  const marcas = pontos
    .map((p, i) => ({ p, i }))
    .filter(({ p }, k, arr) => {
      const mes = p.data.slice(0, 7)
      return k === 0 || (mes !== arr[k - 1].p.data.slice(0, 7) && ['01', '04', '07', '10'].includes(p.data.slice(5, 7)))
    })

  const ultimoLancamento = dados.avancos.length > 0
    ? dados.avancos.reduce((a, b) => a.criado_em > b.criado_em ? a : b)
    : null

  return (
    <>
      <div className={styles.cards}>
        <div className={styles.card}>
          <span className={styles.cardLabel}>Previsto até hoje</span>
          <span className={styles.cardValor}>{fmtPct(previstoHoje)}</span>
        </div>
        <div className={styles.card}>
          <span className={styles.cardLabel}>Realizado</span>
          <span className={styles.cardValor}>{fmtPct(pctObra)}</span>
        </div>
        <div className={`${styles.card} ${desvio < 0 ? styles.cardRuim : styles.cardBom}`}>
          <span className={styles.cardLabel}>Desvio</span>
          <span className={styles.cardValor}>{desvio >= 0 ? '+' : ''}{fmtPct(desvio)}</span>
        </div>
      </div>

      <div className={styles.graficoWrap}>
        <svg viewBox={`0 0 ${W} ${H}`} className={styles.grafico} role="img" aria-label="Curva S física: previsto x realizado">
          {[0, 25, 50, 75, 100].map(v => (
            <g key={v}>
              <line x1={ML} y1={y(v)} x2={W - MR} y2={y(v)} className={styles.grade} />
              <text x={ML - 8} y={y(v) + 4} className={styles.eixoY}>{v}%</text>
            </g>
          ))}
          {marcas.map(({ p, i }) => (
            <text key={p.data} x={x(i)} y={H - MB + 18} className={styles.eixoX}>
              {p.data.slice(5, 7)}/{p.data.slice(2, 4)}
            </text>
          ))}
          {idxHoje >= 0 && (
            <line x1={x(idxHoje)} y1={MT} x2={x(idxHoje)} y2={H - MB} className={styles.linhaHoje} />
          )}
          <path d={pathPrevisto} className={styles.curvaPrevisto} />
          {pathReal && <path d={pathReal} className={styles.curvaReal} />}
        </svg>
        <div className={styles.legenda}>
          <span><span className={styles.legPrevisto} /> Previsto (baseline v{dados.versao?.versao})</span>
          <span><span className={styles.legReal} /> Realizado</span>
        </div>
      </div>

      <details className={styles.fonte}>
        <summary>De onde vêm estes números</summary>
        <ul>
          <li><strong>Previsto:</strong> baseline "{dados.versao?.nome}" importada do MS Project — soma das durações previstas das {curva.folhas.toLocaleString('pt-BR')} tarefas-folha, distribuídas linearmente entre o início e o fim previstos de cada uma.</li>
          <li><strong>Peso de cada tarefa:</strong> duração prevista em horas [estimado — passa a ser o valor (R$) do orçamento quando o de-para cronograma ↔ orçamento for feito na Fase 3].</li>
          <li><strong>Realizado:</strong> {dados.avancos.length.toLocaleString('pt-BR')} lançamento{dados.avancos.length !== 1 ? 's' : ''} ativo{dados.avancos.length !== 1 ? 's' : ''} de avanço físico{ultimoLancamento ? ` (último em ${fmtData(ultimoLancamento.data_referencia)})` : ''} — % acumulado de cada tarefa-folha × peso da tarefa.</li>
          <li>Todo lançamento grava autor, data/hora e tarefa — o histórico completo está na tela Avanço Físico.</li>
        </ul>
      </details>
    </>
  )
}

// ---------- Aba Atrasadas ----------

function Atrasadas({ unidades, arvore, hoje }: {
  unidades: Unidade[]
  arvore: Map<string, NoCronograma[]>
  hoje: string
}) {
  const nomesUnidade = new Map(unidades.map(u => [u.id, u.nome]))
  const atrasadas: { no: NoCronograma; dias: number; caminho: string }[] = []

  function coletar(no: NoCronograma, caminho: string[]) {
    if (no.filhos.length === 0) {
      if (statusTarefa(no, hoje) === 'atrasada') {
        const dias = Math.round((Date.parse(hoje) - Date.parse(no.previsto!.fim)) / 86_400_000)
        atrasadas.push({ no, dias, caminho: caminho.join(' › ') })
      }
    } else {
      no.filhos.forEach(f => coletar(f, [...caminho, no.tarefa.nome]))
    }
  }
  for (const [unidadeId, raizes] of arvore) {
    raizes.forEach(r => coletar(r, [nomesUnidade.get(unidadeId) ?? '?']))
  }
  atrasadas.sort((a, b) => b.dias - a.dias)

  if (atrasadas.length === 0) {
    return <p className={styles.vazio}>Nenhuma tarefa atrasada. 👍</p>
  }

  return (
    <div className={styles.tabelaWrap}>
      <p className={styles.sub}>
        Tarefas-folha com fim previsto anterior a hoje e avanço abaixo de 100%. Fonte: baseline vigente + lançamentos de avanço.
      </p>
      <table className={styles.tabela}>
        <thead>
          <tr>
            <th>Tarefa</th>
            <th>Onde</th>
            <th>Fim previsto</th>
            <th className={styles.num}>Dias de atraso</th>
            <th className={styles.num}>% atual</th>
          </tr>
        </thead>
        <tbody>
          {atrasadas.map(({ no, dias, caminho }) => (
            <tr key={no.tarefa.id}>
              <td>{no.tarefa.nome}</td>
              <td className={styles.caminho}>{caminho}</td>
              <td>{fmtData(no.previsto!.fim)}</td>
              <td className={`${styles.num} ${styles.atrasoDias}`}>{dias}</td>
              <td className={styles.num}>{fmtPct(no.percentual)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
