import { useEffect, useMemo, useState } from 'react'
import { useObra } from '../contexts/ObraContext'
import { supabase, type Unidade, type Etapa, type Servico } from '../lib/supabase'
import styles from './Orcamento.module.css'

const fmtBRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const fmtNum = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 4 })

type RespostaPaginada<T> = { data: T[] | null; count?: number | null; error?: { message: string } | null }

async function paginado<T>(monta: (de: number, ate: number, contar: boolean) => PromiseLike<RespostaPaginada<T>>): Promise<T[]> {
  const PAGINA = 1000
  const primeira = await monta(0, PAGINA - 1, true)
  if (primeira.error) throw new Error(primeira.error.message)

  const todos = [...(primeira.data ?? [])]
  const total = primeira.count ?? todos.length
  const consultas: PromiseLike<RespostaPaginada<T>>[] = []
  for (let de = PAGINA; de < total; de += PAGINA) {
    consultas.push(monta(de, Math.min(de + PAGINA - 1, total - 1), false))
  }
  const lotes = await Promise.all(consultas)
  for (const lote of lotes) {
    if (lote.error) throw new Error(lote.error.message)
    todos.push(...(lote.data ?? []))
  }
  return todos
}

function moeda(v: number | null | undefined) {
  return v === null || v === undefined ? '—' : fmtBRL.format(v)
}

export default function Orcamento() {
  const { obraAtiva } = useObra()
  const [unidades, setUnidades] = useState<Unidade[]>([])
  const [etapas, setEtapas] = useState<Etapa[]>([])
  const [servicos, setServicos] = useState<Servico[]>([])
  const [carregando, setCarregando] = useState(true)
  const [busca, setBusca] = useState('')
  const [unidadesAbertas, setUnidadesAbertas] = useState<Set<string>>(new Set())
  const [etapasAbertas, setEtapasAbertas] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!obraAtiva) return
    carregar(obraAtiva.id)
  }, [obraAtiva])

  async function carregar(obraId: string) {
    setCarregando(true)

    const { data: unis, error: erroUnidades } = await supabase
      .from('unidades')
      .select('id,obra_id,nome,tipo,ordem')
      .eq('obra_id', obraId)
      .order('ordem')
    if (erroUnidades) throw new Error(erroUnidades.message)
    const listaUnidades = unis ?? []
    setUnidades(listaUnidades)

    if (listaUnidades.length === 0) {
      setEtapas([])
      setServicos([])
      setCarregando(false)
      return
    }

    const uniIds = listaUnidades.map(u => u.id)
    const { data: etps, error: erroEtapas } = await supabase
      .from('etapas')
      .select('id,unidade_id,nome,codigo,ordem,placeholder')
      .in('unidade_id', uniIds)
      .eq('placeholder', false)
      .order('ordem')
    if (erroEtapas) throw new Error(erroEtapas.message)
    const listaEtapas = etps ?? []
    setEtapas(listaEtapas)

    const etapaIds = listaEtapas.map(e => e.id)
    const todos = etapaIds.length === 0
      ? []
      : await paginado<Servico>((de, ate, contar) =>
        supabase
          .from('servicos')
          .select('id,etapa_id,codigo,nome,grupo,und,quant,valor_unit,total,ativo', contar ? { count: 'exact' } : undefined)
          .eq('ativo', true)
          .in('etapa_id', etapaIds)
          .order('codigo')
          .range(de, ate))
    setServicos(todos)
    setCarregando(false)
  }

  const buscaNorm = busca.trim().toLowerCase()

  const arvore = useMemo(() => {
    const servicosPorEtapa = new Map<string, Servico[]>()
    for (const s of servicos) {
      if (buscaNorm && !(
        s.nome.toLowerCase().includes(buscaNorm) ||
        (s.codigo ?? '').toLowerCase().includes(buscaNorm) ||
        (s.grupo ?? '').toLowerCase().includes(buscaNorm)
      )) continue
      const lista = servicosPorEtapa.get(s.etapa_id) ?? []
      lista.push(s)
      servicosPorEtapa.set(s.etapa_id, lista)
    }

    return unidades.map(u => {
      const etapasDaUnidade = etapas
        .filter(e => e.unidade_id === u.id)
        .map(e => {
          const svcs = servicosPorEtapa.get(e.id) ?? []
          const total = svcs.reduce((acc, s) => acc + (s.total ?? 0), 0)
          return { etapa: e, servicos: svcs, total }
        })
        .filter(e => e.servicos.length > 0)
      const total = etapasDaUnidade.reduce((acc, e) => acc + e.total, 0)
      return { unidade: u, etapas: etapasDaUnidade, total }
    }).filter(u => u.etapas.length > 0)
  }, [unidades, etapas, servicos, buscaNorm])

  const totalObra = arvore.reduce((acc, u) => acc + u.total, 0)

  function toggle(set: Set<string>, id: string, setter: (s: Set<string>) => void) {
    const novo = new Set(set)
    if (novo.has(id)) novo.delete(id)
    else novo.add(id)
    setter(novo)
  }

  // Com busca ativa, expande tudo que tem resultado
  const expandirTudo = buscaNorm.length > 0

  if (carregando) {
    return <div className={styles.page}><p className={styles.carregando}>Carregando orçamento…</p></div>
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1>Orçamento</h1>
          <p className={styles.sub}>
            Orçamento base importado da planilha analítica. Somente leitura — alterações exigem nova importação pelo admin.
          </p>
        </div>
        <div className={styles.totalObra}>
          <span className={styles.totalLabel}>Total da obra</span>
          <span className={styles.totalValor}>{moeda(totalObra)}</span>
        </div>
      </div>

      <input
        type="search"
        className={styles.busca}
        placeholder="Buscar serviço, código ou grupo…"
        value={busca}
        onChange={e => setBusca(e.target.value)}
      />

      {arvore.length === 0 && (
        <p className={styles.vazio}>
          {buscaNorm ? 'Nenhum serviço encontrado para a busca.' : 'Nenhum orçamento cadastrado para esta obra.'}
        </p>
      )}

      {arvore.map(({ unidade, etapas: etps, total }) => {
        const aberta = expandirTudo || unidadesAbertas.has(unidade.id)
        return (
          <div key={unidade.id} className={styles.unidade}>
            <button
              className={styles.unidadeHeader}
              onClick={() => toggle(unidadesAbertas, unidade.id, setUnidadesAbertas)}
            >
              <span className={styles.seta}>{aberta ? '▾' : '▸'}</span>
              <span className={styles.unidadeNome}>{unidade.nome}</span>
              <span className={styles.unidadeTotal}>{moeda(total)}</span>
            </button>

            {aberta && etps.map(({ etapa, servicos: svcs, total: totalEtapa }) => {
              const etapaAberta = expandirTudo || etapasAbertas.has(etapa.id)
              return (
                <div key={etapa.id} className={styles.etapa}>
                  <button
                    className={styles.etapaHeader}
                    onClick={() => toggle(etapasAbertas, etapa.id, setEtapasAbertas)}
                  >
                    <span className={styles.seta}>{etapaAberta ? '▾' : '▸'}</span>
                    <span className={styles.etapaCodigo}>{etapa.codigo}</span>
                    <span className={styles.etapaNome}>{etapa.nome}</span>
                    <span className={styles.etapaInfo}>{svcs.length} serviço{svcs.length !== 1 ? 's' : ''}</span>
                    <span className={styles.etapaTotal}>{moeda(totalEtapa)}</span>
                  </button>

                  {etapaAberta && (
                    <div className={styles.tabelaWrap}>
                      <table className={styles.tabela}>
                        <thead>
                          <tr>
                            <th>Código</th>
                            <th>Serviço</th>
                            <th>Und</th>
                            <th className={styles.num}>Quant.</th>
                            <th className={styles.num}>Valor unit.</th>
                            <th className={styles.num}>Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {svcs.map(s => (
                            <tr key={s.id}>
                              <td className={styles.codigo}>{s.codigo}</td>
                              <td>
                                {s.nome}
                                {s.grupo && <span className={styles.grupo}>{s.grupo}</span>}
                              </td>
                              <td>{s.und}</td>
                              <td className={styles.num}>{s.quant !== null ? fmtNum.format(s.quant) : '—'}</td>
                              <td className={styles.num}>{moeda(s.valor_unit)}</td>
                              <td className={`${styles.num} ${styles.totalCell}`}>{moeda(s.total)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}
