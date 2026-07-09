import { useEffect, useState } from 'react'
import { useObra } from '../contexts/ObraContext'
import { supabase, type RdoFoto } from '../lib/supabase'
import styles from './Galeria.module.css'

interface FotoGaleria extends RdoFoto {
  rdoData: string
  rdoNumero: number
}

interface GrupoDia {
  data: string
  rdoNumero: number
  fotos: FotoGaleria[]
}

const MESES = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']

function fmtGeo(lat: number | null, lng: number | null, prec: number | null): string {
  if (lat === null || lng === null) return 'sem GPS'
  return `${lat.toFixed(6)}, ${lng.toFixed(6)}${prec !== null ? ` (±${prec} m)` : ''}`
}

export default function Galeria() {
  const { obraAtiva } = useObra()
  const [grupos, setGrupos] = useState<GrupoDia[]>([])
  const [carregando, setCarregando] = useState(true)
  const [abertos, setAbertos] = useState<Set<string>>(new Set())
  const [urls, setUrls] = useState<Map<string, string>>(new Map())
  const [ampliada, setAmpliada] = useState<{
    url: string
    legenda: string | null
    geo: string
    capturada_em: string
  } | null>(null)

  useEffect(() => {
    if (!obraAtiva) return
    carregar()
  }, [obraAtiva])

  async function carregar() {
    setCarregando(true)

    const { data: rdos } = await supabase
      .from('rdos')
      .select('id, data, numero')
      .eq('obra_id', obraAtiva!.id)
      .eq('ativo', true)

    if (!rdos?.length) { setCarregando(false); return }

    const rdoMap = new Map(rdos.map(r => [r.id, r as { id: string; data: string; numero: number }]))
    const rdoIds = [...rdoMap.keys()]

    const { data: fotos } = await supabase
      .from('rdo_fotos')
      .select('*')
      .in('rdo_id', rdoIds)
      .eq('ativo', true)
      .order('capturada_em', { ascending: false })

    if (!fotos?.length) { setCarregando(false); return }

    const fotosExt: FotoGaleria[] = fotos.map(f => ({
      ...f,
      rdoData: rdoMap.get(f.rdo_id)?.data ?? f.capturada_em.slice(0, 10),
      rdoNumero: rdoMap.get(f.rdo_id)?.numero ?? 0,
    }))

    // Agrupa por rdoData
    const mapaGrupos = new Map<string, GrupoDia>()
    for (const f of fotosExt) {
      if (!mapaGrupos.has(f.rdoData)) {
        mapaGrupos.set(f.rdoData, { data: f.rdoData, rdoNumero: f.rdoNumero, fotos: [] })
      }
      mapaGrupos.get(f.rdoData)!.fotos.push(f)
    }

    const sorted = [...mapaGrupos.values()].sort((a, b) => b.data.localeCompare(a.data))
    setGrupos(sorted)

    // Abre o dia mais recente automaticamente
    if (sorted.length > 0) {
      const primeiro = sorted[0]
      setAbertos(new Set([primeiro.data]))
      await gerarUrls(primeiro.fotos, new Map())
    }

    setCarregando(false)
  }

  async function gerarUrls(fotos: FotoGaleria[], urlsAtuais: Map<string, string>) {
    const novas = new Map<string, string>()
    await Promise.all(
      fotos
        .filter(f => !urlsAtuais.has(f.path))
        .map(async f => {
          const { data } = await supabase.storage.from('rdo').createSignedUrl(f.path, 3600)
          if (data) novas.set(f.path, data.signedUrl)
        })
    )
    if (novas.size > 0) {
      setUrls(prev => new Map([...prev, ...novas]))
    }
  }

  async function toggleDia(grupo: GrupoDia) {
    const key = grupo.data
    setAbertos(prev => {
      const n = new Set(prev)
      if (n.has(key)) { n.delete(key); return n }
      n.add(key)
      return n
    })
    if (!abertos.has(key)) {
      await gerarUrls(grupo.fotos, urls)
    }
  }

  function abrirFoto(f: FotoGaleria) {
    const url = urls.get(f.path)
    if (!url) return
    const dt = new Date(f.capturada_em)
    const capturada = `${dt.toLocaleDateString('pt-BR')} ${dt.toLocaleTimeString('pt-BR')}`
    setAmpliada({ url, legenda: f.legenda, geo: fmtGeo(f.lat, f.lng, f.precisao_m), capturada_em: capturada })
  }

  const totalFotos = grupos.reduce((s, g) => s + g.fotos.length, 0)

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1>Galeria de Fotos</h1>
          <p className={styles.sub}>
            {carregando
              ? 'Carregando…'
              : totalFotos === 0
                ? 'Nenhuma foto ainda.'
                : `${totalFotos} foto${totalFotos !== 1 ? 's' : ''} em ${grupos.length} dia${grupos.length !== 1 ? 's' : ''}`}
          </p>
        </div>
      </div>

      {!carregando && grupos.length === 0 && (
        <p className={styles.vazio}>
          Nenhuma foto registrada ainda. As fotos anexadas no RDO aparecem aqui automaticamente, organizadas por dia.
        </p>
      )}

      {grupos.map(g => {
        const aberto = abertos.has(g.data)
        const mesNome = MESES[parseInt(g.data.slice(5, 7)) - 1]
        const diaNum = g.data.slice(8, 10)
        const ano = g.data.slice(0, 4)

        return (
          <div key={g.data} className={styles.grupoDia}>
            <button className={styles.headerDia} onClick={() => toggleDia(g)}>
              <span className={styles.dataBadge}>
                <span className={styles.diaN}>{diaNum}</span>
                <span className={styles.mesAno}>{mesNome} {ano}</span>
              </span>
              <span className={styles.rdoLabel}>RDO Nº {String(g.rdoNumero).padStart(3, '0')}</span>
              <span className={styles.contagem}>{g.fotos.length} foto{g.fotos.length !== 1 ? 's' : ''}</span>
              <span className={styles.chevron}>{aberto ? '▲' : '▼'}</span>
            </button>

            {aberto && (
              <div className={styles.gradeWrapper}>
                <div className={styles.grade}>
                  {g.fotos.map(f => {
                    const url = urls.get(f.path)
                    return (
                      <button
                        key={f.id}
                        className={styles.thumbWrap}
                        onClick={() => abrirFoto(f)}
                        disabled={!url}
                        title={f.legenda ?? undefined}
                      >
                        {url
                          ? <img src={url} alt={f.legenda ?? `Foto RDO ${g.rdoNumero}`} className={styles.thumb} />
                          : <div className={styles.thumbPlaceholder}>⏳</div>
                        }
                        {f.legenda && <span className={styles.thumbLegenda}>{f.legenda}</span>}
                        {f.lat !== null && <span className={styles.thumbGps}>📍</span>}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        )
      })}

      {ampliada && (
        <div className={styles.modal} onClick={() => setAmpliada(null)}>
          <div className={styles.modalConteudo} onClick={e => e.stopPropagation()}>
            <button className={styles.modalFechar} onClick={() => setAmpliada(null)}>✕</button>
            <img src={ampliada.url} alt={ampliada.legenda ?? 'Foto'} className={styles.modalImg} />
            <div className={styles.modalInfo}>
              {ampliada.legenda && <p className={styles.modalLegenda}>{ampliada.legenda}</p>}
              <p className={styles.modalMeta}>🕐 {ampliada.capturada_em}</p>
              <p className={styles.modalMeta}>📍 {ampliada.geo}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
