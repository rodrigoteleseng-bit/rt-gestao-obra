import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useObra } from '../contexts/ObraContext'
import { supabase, type Fvs, type FvsModelo, type Unidade, type StatusFvs } from '../lib/supabase'
import styles from './Fvs.module.css'

export const STATUS_FVS_LABEL: Record<StatusFvs, string> = {
  em_andamento: 'Em andamento',
  aprovada: 'Aprovada',
  aprovada_restricao: 'Aprovada c/ restrição',
  reprovada: 'Reprovada',
}

const fmtData = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`

interface FvsComRel extends Fvs {
  modeloCodigo: string
  modeloNome: string
  modeloOrdem: number
  unidadeNome: string
}

export default function FvsPage() {
  const { perfil, temModulo } = useAuth()
  const { obraAtiva } = useObra()
  const navigate = useNavigate()
  const podeEditar = perfil?.papel === 'admin' || temModulo('fvs')

  const [fvsList, setFvsList] = useState<FvsComRel[]>([])
  const [modelos, setModelos] = useState<FvsModelo[]>([])
  const [unidades, setUnidades] = useState<Unidade[]>([])
  const [carregando, setCarregando] = useState(true)
  const [aba, setAba] = useState<'lista' | 'mapa'>('lista')
  const [filtroUnidade, setFiltroUnidade] = useState('')
  const [filtroStatus, setFiltroStatus] = useState<StatusFvs | ''>('')

  useEffect(() => {
    if (!obraAtiva) return
    carregar()
  }, [obraAtiva])

  async function carregar() {
    setCarregando(true)
    const [f, m, u] = await Promise.all([
      supabase.from('fvs').select('*').eq('obra_id', obraAtiva!.id).eq('ativo', true).order('criado_em', { ascending: false }),
      supabase.from('fvs_modelos').select('*').eq('ativo', true).order('ordem'),
      supabase.from('unidades').select('*').eq('obra_id', obraAtiva!.id).order('ordem'),
    ])
    const modelosMap = new Map((m.data ?? []).map(x => [x.id, x]))
    const unidadesMap = new Map((u.data ?? []).map(x => [x.id, x]))
    setModelos(m.data ?? [])
    setUnidades(u.data ?? [])
    setFvsList((f.data ?? []).map(x => {
      const mod = modelosMap.get(x.modelo_id)
      return {
        ...x,
        modeloCodigo: mod?.codigo ?? '?',
        modeloNome: mod?.nome ?? '?',
        modeloOrdem: mod?.ordem ?? 0,
        unidadeNome: unidadesMap.get(x.unidade_id)?.nome ?? '?',
      }
    }))
    setCarregando(false)
  }

  const contagem = useMemo(() => ({
    em_andamento: fvsList.filter(f => f.status === 'em_andamento').length,
    reprovada: fvsList.filter(f => f.status === 'reprovada').length,
    aprovada_restricao: fvsList.filter(f => f.status === 'aprovada_restricao').length,
    aprovada: fvsList.filter(f => f.status === 'aprovada').length,
  }), [fvsList])

  const filtradas = useMemo(() => fvsList.filter(f =>
    (!filtroUnidade || f.unidade_id === filtroUnidade) &&
    (!filtroStatus || f.status === filtroStatus)
  ), [fvsList, filtroUnidade, filtroStatus])

  if (perfil?.papel === 'cliente') {
    return (
      <div className={styles.page}>
        <h1>Qualidade — FVS</h1>
        <p className={styles.vazio}>Este módulo é de uso interno da equipe de obra.</p>
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1>FVS — Fichas de Verificação de Serviço</h1>
          <p className={styles.sub}>Checklist de qualidade por serviço, aplicado unidade a unidade. Item não conforme abre pendência automática.</p>
        </div>
        {podeEditar && (
          <button className={styles.btnNova} onClick={() => navigate('/fvs/nova')}>+ Nova FVS</button>
        )}
      </div>

      <div className={styles.abas}>
        <button className={aba === 'lista' ? styles.abaAtiva : styles.aba} onClick={() => setAba('lista')}>Fichas</button>
        <button className={aba === 'mapa' ? styles.abaAtiva : styles.aba} onClick={() => setAba('mapa')}>Mapa da qualidade</button>
      </div>

      {carregando && <p className={styles.vazio}>Carregando…</p>}

      {!carregando && aba === 'lista' && (
        <>
          <div className={styles.contadores}>
            {(['em_andamento', 'reprovada', 'aprovada_restricao', 'aprovada'] as StatusFvs[]).map(s => (
              <button key={s} className={`${styles.contador} ${styles[`cont_${s}`]} ${filtroStatus === s ? styles.contAtivo : ''}`}
                onClick={() => setFiltroStatus(filtroStatus === s ? '' : s)}>
                <span className={styles.contNum}>{contagem[s]}</span>
                <span className={styles.contLabel}>{STATUS_FVS_LABEL[s]}</span>
              </button>
            ))}
          </div>

          <div className={styles.filtros}>
            <select value={filtroUnidade} onChange={e => setFiltroUnidade(e.target.value)} className={styles.selectFiltro}>
              <option value="">Todas as unidades</option>
              {unidades.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}
            </select>
          </div>

          {filtradas.length === 0 && (
            <p className={styles.vazio}>{fvsList.length === 0 ? 'Nenhuma FVS aplicada ainda.' : 'Nenhuma FVS com esses filtros.'}</p>
          )}

          {filtradas.map(f => (
            <button key={f.id} className={styles.card} onClick={() => navigate(`/fvs/${f.id}`)}>
              <div className={styles.cardTopo}>
                <span className={styles.cardCodigo}>{f.modeloCodigo}</span>
                <span className={styles.cardUnidade}>{f.unidadeNome}</span>
                <span className={`${styles.chip} ${styles[`chip_${f.status}`]}`}>{STATUS_FVS_LABEL[f.status]}</span>
              </div>
              <div className={styles.cardNome}>{f.modeloNome}{f.local_ambiente ? ` · ${f.local_ambiente}` : ''}</div>
              <div className={styles.cardRodape}>Aberta em {fmtData(f.criado_em)}</div>
            </button>
          ))}
        </>
      )}

      {!carregando && aba === 'mapa' && (
        <MapaQualidade fvsList={fvsList} modelos={modelos} unidades={unidades}
          onCelula={(fvsId) => fvsId && navigate(`/fvs/${fvsId}`)} />
      )}
    </div>
  )
}

// Grade serviço × unidade com bolinhas de status
function MapaQualidade({ fvsList, modelos, unidades, onCelula }: {
  fvsList: FvsComRel[]
  modelos: FvsModelo[]
  unidades: Unidade[]
  onCelula: (fvsId: string | null) => void
}) {
  // só sobrados + portaria/área comum, na ordem de cadastro
  const unidadesMapa = unidades
  // prioridade de status por célula: reprovada > em_andamento > restrição > aprovada
  const peso: Record<StatusFvs, number> = { reprovada: 4, em_andamento: 3, aprovada_restricao: 2, aprovada: 1 }

  const porCelula = useMemo(() => {
    const m = new Map<string, FvsComRel>()
    for (const f of fvsList) {
      const key = `${f.modelo_id}|${f.unidade_id}`
      const atual = m.get(key)
      if (!atual || peso[f.status] > peso[atual.status]) m.set(key, f)
    }
    return m
  }, [fvsList])

  const simbolo: Record<StatusFvs, string> = {
    aprovada: '🟢', aprovada_restricao: '🟡', reprovada: '🔴', em_andamento: '🔵',
  }

  return (
    <div className={styles.mapaWrap}>
      <div className={styles.legenda}>
        <span>🟢 Aprovada</span><span>🟡 Restrição</span><span>🔴 Reprovada</span><span>🔵 Em andamento</span><span>⚪ Não feita</span>
      </div>
      <div className={styles.mapaScroll}>
        <table className={styles.mapa}>
          <thead>
            <tr>
              <th className={styles.mapaCantoTh}>Serviço</th>
              {unidadesMapa.map(u => (
                <th key={u.id} className={styles.mapaUnidadeTh}><span>{u.nome}</span></th>
              ))}
            </tr>
          </thead>
          <tbody>
            {modelos.map(mod => (
              <tr key={mod.id}>
                <td className={styles.mapaServicoTd} title={mod.nome}>
                  <strong>{mod.codigo}</strong> {mod.nome}
                </td>
                {unidadesMapa.map(u => {
                  const f = porCelula.get(`${mod.id}|${u.id}`)
                  return (
                    <td key={u.id} className={styles.mapaCelula}
                      onClick={() => onCelula(f?.id ?? null)}
                      style={{ cursor: f ? 'pointer' : 'default' }}
                      title={f ? STATUS_FVS_LABEL[f.status] : 'Não feita'}>
                      {f ? simbolo[f.status] : <span className={styles.vazioCelula}>⚪</span>}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
