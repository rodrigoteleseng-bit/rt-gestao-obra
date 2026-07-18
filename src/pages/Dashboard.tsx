import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useObra } from '../contexts/ObraContext'
import { supabase, type Rdo } from '../lib/supabase'
import { dataLocalISO, dataHoje, diasEntre } from '../lib/almoxarifado'
import styles from './Dashboard.module.css'

function calcularSemana(dataInicio: string, dataFimPrevista: string): { atual: number; total: number } {
  const hoje = dataHoje()
  const diasDesdeInicio = diasEntre(dataInicio, hoje)
  const diasTotais = diasEntre(dataInicio, dataFimPrevista)
  const atual = Math.max(1, Math.floor(diasDesdeInicio / 7) + 1)
  const total = Math.max(atual, Math.ceil(diasTotais / 7))
  return { atual, total }
}

function formatarDataExtenso(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString('pt-BR', {
    weekday: 'long', day: '2-digit', month: 'long',
  })
}

interface FerramentaAtraso {
  emprestimoId: string
  nomeFerramenta: string
  retiradoPor: string
  dias: number
}

interface ChamadaHoje {
  feita: boolean
  presentes: number
  total: number
}

interface RdoHojeResumo {
  status: Rdo['status']
  climaManha: Rdo['clima_manha']
  climaTarde: Rdo['clima_tarde']
  fotos: { url: string; legenda: string | null }[]
}

interface SubModulo {
  label: string
  icon: string
  path: string
  sempre?: boolean    // acessível a todos os papéis
  moduloKey?: string  // chave de permissão individual (sobrepõe a do card pai)
}

interface CardModulo {
  key: string
  label: string
  icon: string
  desc: string
  path?: string
  subs?: SubModulo[]
  multiKey?: string[] // card ativo se o usuário tiver QUALQUER uma dessas chaves
}

const CARDS_MODULOS: CardModulo[] = [
  {
    key: 'avanco', label: 'Avanço Físico', icon: '📊', desc: 'Cronograma e progresso da obra',
    subs: [
      { label: 'Cronograma', icon: '📅', path: '/cronograma', sempre: true },
      { label: 'Lançar avanço', icon: '✏️', path: '/avanco' },
    ],
  },
  {
    key: 'rdo', label: 'RDO', icon: '📋', desc: 'Relatório diário, galeria e efetivo',
    subs: [
      { label: 'Relatório Diário', icon: '📋', path: '/rdo' },
      { label: 'Galeria de Fotos', icon: '🖼️', path: '/galeria', sempre: true },
      { label: 'Efetivo', icon: '👷', path: '/efetivo', moduloKey: 'efetivo' },
    ],
  },
  {
    key: 'suprimentos', label: 'Suprimentos', icon: '📦', desc: 'Compras e almoxarifado',
    multiKey: ['compras', 'almoxarifado'],
    subs: [
      { label: 'Compras', icon: '🛒', path: '/compras', moduloKey: 'compras' },
      { label: 'Almoxarifado', icon: '📦', path: '/almoxarifado', moduloKey: 'almoxarifado' },
    ],
  },
  {
    key: 'producao', label: 'Produção', icon: '🏗️', desc: 'Contratos, medições e produção própria',
    multiKey: ['contratos', 'medicoes'],
    subs: [
      { label: 'Contratos', icon: '📝', path: '/contratos', moduloKey: 'contratos' },
      { label: 'Medições', icon: '📏', path: '/medicoes', moduloKey: 'medicoes' },
      { label: 'Produção própria', icon: '👷', path: '/producao', moduloKey: 'medicoes' },
    ],
  },
  {
    key: 'qualidade', label: 'Qualidade', icon: '🏷️', desc: 'FVS, checklists e pendências de obra',
    multiKey: ['fvs', 'pendencias'],
    subs: [
      { label: 'FVS / Checklists', icon: '✅', path: '/fvs', moduloKey: 'fvs' },
      { label: 'Pendências', icon: '⚠️', path: '/pendencias', moduloKey: 'pendencias' },
    ],
  },
]

export default function Dashboard() {
  const { perfil, temModulo } = useAuth()
  const { obraAtiva: obra } = useObra()
  const navigate = useNavigate()
  const [cardAberto, setCardAberto] = useState<string | null>(null)
  const [ferramentasAtraso, setFerramentasAtraso] = useState<FerramentaAtraso[]>([])
  const [chamadaHoje, setChamadaHoje] = useState<ChamadaHoje | null>(null)
  const [pedidosAguardando, setPedidosAguardando] = useState(0)
  const [pendenciasAbertas, setPendenciasAbertas] = useState(0)
  const [rdoHoje, setRdoHoje] = useState<RdoHojeResumo | null>(null)
  const veRdo = temModulo('rdo')

  useEffect(() => {
    if (!obra || !veRdo) {
      setRdoHoje(null)
      return
    }
    supabase.from('rdos').select('id, status, clima_manha, clima_tarde')
      .eq('obra_id', obra.id).eq('data', dataHoje()).eq('ativo', true).maybeSingle()
      .then(async ({ data: rdo }) => {
        if (!rdo) {
          setRdoHoje(null)
          return
        }
        const { data: fotos } = await supabase.from('rdo_fotos')
          .select('path, legenda, capturada_em')
          .eq('rdo_id', rdo.id).eq('ativo', true)
          .order('capturada_em', { ascending: false })
          .limit(2)
        const fotosComUrl = await Promise.all(
          (fotos ?? []).map(async f => {
            const { data } = await supabase.storage.from('rdo').createSignedUrl(f.path, 3600)
            return { url: data?.signedUrl ?? '', legenda: f.legenda }
          })
        )
        setRdoHoje({
          status: rdo.status,
          climaManha: rdo.clima_manha,
          climaTarde: rdo.clima_tarde,
          fotos: fotosComUrl.filter(f => f.url),
        })
      })
  }, [obra, veRdo])

  const vePainelAlmoxarifado = perfil?.papel !== 'cliente' && temModulo('almoxarifado')

  useEffect(() => {
    if (!obra || !vePainelAlmoxarifado) {
      setFerramentasAtraso([])
      return
    }
    type LinhaEmprestimo = {
      id: string
      retirado_por: string
      retirada_em: string
      ferramentas: { nome: string; obra_id: string } | null
    }
    supabase.from('ferramenta_emprestimos')
      .select('id, retirado_por, retirada_em, ferramentas!inner(nome, obra_id)')
      .eq('ferramentas.obra_id', obra.id)
      .is('devolvida_em', null)
      .then(({ data }) => {
        const hoje = dataHoje()
        const linhas = (data ?? []) as unknown as LinhaEmprestimo[]
        const atrasadas: FerramentaAtraso[] = linhas
          .map(e => ({
            emprestimoId: e.id,
            nomeFerramenta: e.ferramentas?.nome ?? '?',
            retiradoPor: e.retirado_por,
            dataRetirada: dataLocalISO(new Date(e.retirada_em)),
          }))
          .filter(e => e.dataRetirada < hoje)
          .map(e => ({
            emprestimoId: e.emprestimoId,
            nomeFerramenta: e.nomeFerramenta,
            retiradoPor: e.retiradoPor,
            dias: diasEntre(e.dataRetirada, hoje),
          }))
        setFerramentasAtraso(atrasadas)
      })
  }, [obra, vePainelAlmoxarifado])

  const veCompras = perfil?.papel !== 'cliente' && temModulo('compras')

  useEffect(() => {
    if (!obra || !veCompras) {
      setPedidosAguardando(0)
      return
    }
    supabase.from('pedidos_compra')
      .select('id', { count: 'exact', head: true })
      .eq('obra_id', obra.id)
      .eq('status', 'em_cotacao')
      .eq('ativo', true)
      .then(({ count }) => setPedidosAguardando(count ?? 0))
  }, [obra, veCompras])

  const vePendencias = perfil?.papel !== 'cliente' && temModulo('pendencias')

  useEffect(() => {
    if (!obra || !vePendencias) {
      setPendenciasAbertas(0)
      return
    }
    supabase.from('pendencias')
      .select('id', { count: 'exact', head: true })
      .eq('obra_id', obra.id)
      .in('status', ['aberta', 'em_correcao'])
      .eq('ativo', true)
      .then(({ count }) => setPendenciasAbertas(count ?? 0))
  }, [obra, vePendencias])

  const veEfetivo = perfil?.papel !== 'cliente' && temModulo('efetivo')

  useEffect(() => {
    if (!obra || !veEfetivo) {
      setChamadaHoje(null)
      return
    }
    supabase.from('trabalhadores').select('id').eq('obra_id', obra.id).eq('ativo', true)
      .then(({ data: trabalhadores }) => {
        const total = trabalhadores?.length ?? 0
        if (total === 0) {
          setChamadaHoje(null)
          return
        }
        supabase.from('efetivo_chamadas').select('id').eq('obra_id', obra.id).eq('data', dataHoje()).maybeSingle()
          .then(({ data: chamada }) => {
            if (!chamada) {
              setChamadaHoje({ feita: false, presentes: 0, total })
              return
            }
            supabase.from('efetivo_presencas').select('presente').eq('chamada_id', chamada.id).eq('presente', true)
              .then(({ data: presencas }) => {
                setChamadaHoje({ feita: true, presentes: presencas?.length ?? 0, total })
              })
          })
      })
  }, [obra, veEfetivo])

  return (
    <div className={styles.page}>
      {obra && (
        <div className={styles.hero}>
          <div className={styles.heroData}>{formatarDataExtenso(dataHoje())}</div>
          <h1>Olá, {perfil?.nome?.split(' ')[0]}</h1>
          <div className={styles.heroObra}>{obra.nome} — {obra.cidade}{obra.cidade && obra.estado ? ' — ' : ''}{obra.estado}</div>
          {obra.data_inicio && obra.data_fim_prevista && (
            <div className={styles.heroMetricas}>
              <div className={styles.heroMet}>
                <div className={styles.heroLab}>Prazo</div>
                <div className={styles.heroVal}>{new Date(obra.data_fim_prevista + 'T00:00:00').toLocaleDateString('pt-BR')}</div>
              </div>
              <div className={styles.heroMet}>
                <div className={styles.heroLab}>Semana</div>
                <div className={styles.heroVal}>
                  {calcularSemana(obra.data_inicio, obra.data_fim_prevista).atual}/{calcularSemana(obra.data_inicio, obra.data_fim_prevista).total}
                </div>
              </div>
              <div className={styles.heroMet}>
                <div className={styles.heroLab}>Restam</div>
                <div className={styles.heroVal}>{Math.max(0, diasEntre(dataHoje(), obra.data_fim_prevista))}d</div>
              </div>
            </div>
          )}
        </div>
      )}

      <div className={styles.kpis}>
        {veEfetivo && chamadaHoje && (
          <button className={`${styles.kpi} ${styles.kpiEfetivo}`} onClick={() => navigate('/efetivo')}>
            <div className={styles.kpiNum}>{chamadaHoje.presentes}<span className={styles.kpiNumSub}>/{chamadaHoje.total}</span></div>
            <div className={styles.kpiLab}>Efetivo hoje</div>
            <div className={styles.kpiDet}>{chamadaHoje.feita ? 'chamada feita' : 'chamada não feita'}</div>
          </button>
        )}
        {veCompras && (
          <button className={`${styles.kpi} ${styles.kpiPedidos}`} onClick={() => navigate('/compras')}>
            <div className={styles.kpiNum}>{pedidosAguardando}</div>
            <div className={styles.kpiLab}>Pedidos</div>
            <div className={styles.kpiDet}>aguardando aprovação</div>
          </button>
        )}
        {vePendencias && (
          <button className={`${styles.kpi} ${styles.kpiPend}`} onClick={() => navigate('/pendencias')}>
            <div className={styles.kpiNum}>{pendenciasAbertas}</div>
            <div className={styles.kpiLab}>Pendências</div>
            <div className={styles.kpiDet}>abertas na obra</div>
          </button>
        )}
        {ferramentasAtraso.length > 0 && (
          <button className={`${styles.kpi} ${styles.kpiAlerta}`} onClick={() => navigate('/almoxarifado')}>
            <div className={styles.kpiNum}>{ferramentasAtraso.length}</div>
            <div className={styles.kpiLab}>Ferramenta{ferramentasAtraso.length > 1 ? 's' : ''}</div>
            <div className={styles.kpiDet}>não devolvida{ferramentasAtraso.length > 1 ? 's' : ''} — {ferramentasAtraso[0].nomeFerramenta}{ferramentasAtraso.length > 1 ? ` e mais ${ferramentasAtraso.length - 1}` : ''}</div>
          </button>
        )}
      </div>

      {veRdo && (
        <>
          <h2 className={styles.secaoTitulo}>RDO de hoje</h2>
          {rdoHoje ? (
            <div className={styles.widget}>
              <div className={styles.widgetHead}>
                <b>Relatório Diário</b>
                <span className={`${styles.widgetBadge} ${rdoHoje.status === 'assinado' ? styles.badgeOk : styles.badgeRascunho}`}>
                  {rdoHoje.status === 'assinado' ? 'Assinado' : 'Rascunho'}
                </span>
              </div>
              {(rdoHoje.climaManha || rdoHoje.climaTarde) && (
                <div className={styles.widgetClima}>
                  {rdoHoje.climaManha && <span>Manhã: <b>{rdoHoje.climaManha}</b></span>}
                  {rdoHoje.climaTarde && <span>Tarde: <b>{rdoHoje.climaTarde}</b></span>}
                </div>
              )}
              {rdoHoje.fotos.length > 0 && (
                <div className={styles.widgetFotos}>
                  {rdoHoje.fotos.map((f, i) => (
                    <img key={i} src={f.url} alt={f.legenda ?? 'Foto do RDO'} className={styles.widgetFoto} />
                  ))}
                </div>
              )}
              <button className={styles.widgetVer} onClick={() => navigate('/rdo')}>Abrir RDO →</button>
            </div>
          ) : (
            <div className={styles.widget}>
              <p className={styles.widgetVazio}>Nenhum RDO lançado hoje ainda.</p>
              <button className={styles.widgetVer} onClick={() => navigate('/rdo')}>Lançar RDO →</button>
            </div>
          )}
        </>
      )}

      <h2 className={styles.secaoTitulo}>Módulos</h2>
      <div className={styles.grid}>
        {CARDS_MODULOS.map(m => {
          // card ativo se tem a chave principal OU qualquer chave do multiKey
          const temAcessoModulo = m.multiKey
            ? m.multiKey.some(k => temModulo(k))
            : temModulo(m.key)
          // sub visível se: sempre=true, ou tem chave individual, ou tem acesso ao card pai
          const subsVisiveis = (m.subs ?? []).filter(s =>
            s.sempre || (s.moduloKey ? temModulo(s.moduloKey) : temAcessoModulo)
          )
          const ativo = temAcessoModulo || subsVisiveis.length > 0
          const aberto = cardAberto === m.key

          function onClickCard() {
            if (!ativo) return
            if (m.subs) setCardAberto(aberto ? null : m.key)
            else if (m.path) navigate(m.path)
          }

          return (
            <div
              key={m.key}
              className={`${styles.card} ${ativo ? styles.cardAtivo : styles.cardBloqueado} ${ativo ? styles.cardClicavel : ''}`}
              onClick={onClickCard}
              role={ativo ? 'button' : undefined}
              tabIndex={ativo ? 0 : undefined}
              onKeyDown={e => { if (e.key === 'Enter') onClickCard() }}
            >
              <div className={styles.cardIcon}>{m.icon}</div>
              <div className={styles.cardNome}>{m.label}</div>
              <div className={styles.cardDesc}>{m.desc}</div>
              {!ativo && <div className={styles.cardLock}>Sem acesso</div>}
              {ativo && m.subs && (
                <div className={styles.cardSeta}>{aberto ? '▾' : '▸'}</div>
              )}
              {aberto && subsVisiveis.length > 0 && (
                <div className={styles.subLista}>
                  {subsVisiveis.map(s => (
                    <button
                      key={s.path}
                      className={styles.subBtn}
                      onClick={e => { e.stopPropagation(); navigate(s.path) }}
                    >
                      <span>{s.icon}</span> {s.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )
        })}
        {perfil?.papel === 'admin' && (
          <div
            className={`${styles.card} ${styles.cardAtivo} ${styles.cardClicavel}`}
            onClick={() => navigate('/dados-obra')}
            role="button"
            tabIndex={0}
            onKeyDown={e => { if (e.key === 'Enter') navigate('/dados-obra') }}
          >
            <div className={styles.cardIcon}>🏗️</div>
            <div className={styles.cardNome}>Dados da Obra</div>
            <div className={styles.cardDesc}>Cadastro, endereço, datas e status</div>
          </div>
        )}
        {(perfil?.papel === 'admin' || perfil?.papel === 'cliente' || temModulo('definicoes')) && (
          <div
            className={`${styles.card} ${styles.cardAtivo} ${styles.cardClicavel}`}
            onClick={() => navigate('/definicoes')}
            role="button"
            tabIndex={0}
            onKeyDown={e => { if (e.key === 'Enter') navigate('/definicoes') }}
          >
            <div className={styles.cardIcon}>📐</div>
            <div className={styles.cardNome}>Definições de Projeto</div>
            <div className={styles.cardDesc}>Decisões pendentes do cliente</div>
          </div>
        )}
      </div>

      <div className={styles.futuro}>
        <b>Em preparação:</b> Financeiro (Fase 3), Projetos, Planejamento (lookahead/PPC) e Tarefas.
      </div>

      <p className={styles.versao}>Fase 0 — Fundação · v0.1 · Dados de {new Date().toLocaleDateString('pt-BR')}</p>
    </div>
  )
}
