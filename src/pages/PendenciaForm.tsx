import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useObra } from '../contexts/ObraContext'
import {
  supabase, type Pendencia, type PendenciaEvento, type PendenciaFoto,
  type Unidade, type CronogramaTarefa, type StatusPendencia,
} from '../lib/supabase'
import { obterPosicao, sha256Hex, carimbarFoto, fmtCoord, type Geo } from '../lib/rdo'
import { STATUS_LABEL } from './Pendencias'
import styles from './Pendencias.module.css'

const fmtDataHora = (iso: string) => {
  const d = new Date(iso)
  return `${d.toLocaleDateString('pt-BR')} ${d.toLocaleTimeString('pt-BR').slice(0, 5)}`
}

interface FotoStaged {
  blob: Blob
  hash: string
  geo: Geo
  capturadaEm: Date
  previewUrl: string
}

export default function PendenciaForm() {
  const { id } = useParams()
  const nova = id === 'nova'
  const navigate = useNavigate()
  const { perfil, temModulo } = useAuth()
  const { obraAtiva } = useObra()
  const podeEditar = perfil?.papel === 'admin' || temModulo('pendencias')
  const ehAdmin = perfil?.papel === 'admin'

  // detalhe
  const [pendencia, setPendencia] = useState<Pendencia | null>(null)
  const [eventos, setEventos] = useState<PendenciaEvento[]>([])
  const [fotos, setFotos] = useState<PendenciaFoto[]>([])
  const [urls, setUrls] = useState<Map<string, string>>(new Map())
  const [autores, setAutores] = useState<Map<string, string>>(new Map())
  const [carregando, setCarregando] = useState(!nova)

  // formulário (nova) + campos compartilhados
  const [unidades, setUnidades] = useState<Unidade[]>([])
  const [tarefasUnidade, setTarefasUnidade] = useState<CronogramaTarefa[]>([])
  const [unidadeSel, setUnidadeSel] = useState('')
  const [tarefaSel, setTarefaSel] = useState('')
  const [descricao, setDescricao] = useState('')
  const [responsavel, setResponsavel] = useState('')
  const [prazo, setPrazo] = useState('')
  const [fotosStaged, setFotosStaged] = useState<FotoStaged[]>([])

  const [comentario, setComentario] = useState('')
  const [editandoResp, setEditandoResp] = useState(false)
  const [respNovo, setRespNovo] = useState('')
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [anexando, setAnexando] = useState(false)

  useEffect(() => {
    if (!obraAtiva) return
    supabase.from('unidades').select('*').eq('obra_id', obraAtiva.id).order('ordem')
      .then(({ data }) => setUnidades(data ?? []))
  }, [obraAtiva])

  useEffect(() => {
    if (!unidadeSel) { setTarefasUnidade([]); return }
    supabase.from('cronograma_tarefas').select('*')
      .eq('unidade_id', unidadeSel).eq('ativo', true).eq('resumo', false).order('ordem')
      .then(({ data }) => setTarefasUnidade(data ?? []))
  }, [unidadeSel])

  useEffect(() => {
    if (!nova && id) carregar(id)
  }, [id, nova])

  async function carregar(pId: string) {
    setCarregando(true)
    const [{ data: p }, { data: evs }, { data: fts }] = await Promise.all([
      supabase.from('pendencias').select('*').eq('id', pId).single(),
      supabase.from('pendencia_eventos').select('*').eq('pendencia_id', pId).order('criado_em'),
      supabase.from('pendencia_fotos').select('*').eq('pendencia_id', pId).eq('ativo', true).order('criado_em'),
    ])
    if (!p) { setCarregando(false); return }
    setPendencia(p)
    setUnidadeSel(p.unidade_id)
    setTarefaSel(p.tarefa_id ?? '')
    setEventos(evs ?? [])
    setFotos(fts ?? [])

    const idsAutores = [...new Set([(p as Pendencia).criado_por, ...(evs ?? []).map(e => e.criado_por)])]
    const { data: perfis } = await supabase.from('perfis_usuario').select('id, nome').in('id', idsAutores)
    setAutores(new Map((perfis ?? []).map(u => [u.id, u.nome])))

    const novasUrls = new Map<string, string>()
    await Promise.all((fts ?? []).map(async f => {
      const { data } = await supabase.storage.from('pendencias').createSignedUrl(f.path, 3600)
      if (data) novasUrls.set(f.path, data.signedUrl)
    }))
    setUrls(novasUrls)
    setCarregando(false)
  }

  // ---------- fotos ----------
  async function processarFotos(arquivos: File[]) {
    if (!obraAtiva || arquivos.length === 0) return
    setAnexando(true)
    setMsg(null)
    try {
      const geo = await obterPosicao()
      for (const arquivo of arquivos) {
        const capturadaEm = new Date()
        const blob = await carimbarFoto(arquivo, obraAtiva.nome, geo, capturadaEm)
        const hash = await sha256Hex(blob)
        if (nova) {
          setFotosStaged(prev => [...prev, { blob, hash, geo, capturadaEm, previewUrl: URL.createObjectURL(blob) }])
        } else if (pendencia) {
          await subirFoto(pendencia, blob, hash, geo, capturadaEm)
        }
      }
    } catch {
      setMsg({ tipo: 'erro', texto: 'Falha ao processar a foto. Tente novamente.' })
    }
    setAnexando(false)
  }

  async function subirFoto(p: Pendencia, blob: Blob, hash: string, geo: Geo, capturadaEm: Date) {
    const path = `${p.obra_id}/${p.id}/${crypto.randomUUID()}.jpg`
    const { error: eUp } = await supabase.storage.from('pendencias').upload(path, blob, { contentType: 'image/jpeg' })
    if (eUp) { setMsg({ tipo: 'erro', texto: `Falha no envio da foto: ${eUp.message}` }); return }
    const { data: foto, error } = await supabase.from('pendencia_fotos').insert({
      pendencia_id: p.id, path,
      lat: geo.lat, lng: geo.lng, precisao_m: geo.precisao,
      capturada_em: capturadaEm.toISOString(), hash_sha256: hash,
    }).select().single()
    if (error) { setMsg({ tipo: 'erro', texto: `Falha ao registrar a foto: ${error.message}` }); return }
    setFotos(prev => [...prev, foto])
    const { data: su } = await supabase.storage.from('pendencias').createSignedUrl(path, 3600)
    if (su) setUrls(prev => new Map(prev).set(path, su.signedUrl))
  }

  // ---------- criação ----------
  async function criar() {
    if (!obraAtiva || !unidadeSel || !descricao.trim()) {
      setMsg({ tipo: 'erro', texto: 'Preencha ao menos a unidade e a descrição.' })
      return
    }
    setSalvando(true)
    setMsg(null)
    const { data: pendenciaId, error } = await supabase.rpc('criar_pendencia_com_evento', {
      p_obra: obraAtiva.id,
      p_unidade: unidadeSel,
      p_tarefa: tarefaSel || null,
      p_descricao: descricao.trim(),
      p_responsavel: responsavel.trim() || null,
      p_prazo: prazo || null,
    })
    if (error || !pendenciaId) {
      setSalvando(false)
      setMsg({ tipo: 'erro', texto: `Erro ao criar: ${error?.message ?? 'retorno inválido'}` })
      return
    }
    const { data: p, error: erroLeitura } = await supabase.from('pendencias').select('*').eq('id', pendenciaId).single()
    if (erroLeitura || !p) {
      setSalvando(false)
      setMsg({ tipo: 'erro', texto: `Pendência criada, mas não foi possível abrir o detalhe: ${erroLeitura?.message ?? 'erro desconhecido'}` })
      return
    }
    for (const f of fotosStaged) {
      await subirFoto(p, f.blob, f.hash, f.geo, f.capturadaEm)
    }
    setSalvando(false)
    navigate(`/pendencias/${p.id}`, { replace: true })
  }

  // ---------- transições de status ----------
  async function mudarStatus(novoStatus: StatusPendencia) {
    if (!pendencia) return
    setSalvando(true)
    setMsg(null)
    const { error } = await supabase.rpc('atualizar_status_pendencia_com_evento', {
      p_pendencia: pendencia.id,
      p_status: novoStatus,
      p_comentario: comentario.trim() || null,
    })
    if (error) {
      setSalvando(false)
      setMsg({ tipo: 'erro', texto: error?.message ?? 'Sem permissão para alterar esta pendência.' })
      return
    }
    setComentario('')
    setSalvando(false)
    await carregar(pendencia.id)
    setMsg({ tipo: 'ok', texto: `Status atualizado: ${STATUS_LABEL[novoStatus]}.` })
  }

  // ---------- responsável (editável enquanto a pendência estiver ativa) ----------
  async function salvarResponsavel() {
    if (!pendencia) return
    setSalvando(true)
    setMsg(null)
    const { data, error } = await supabase.from('pendencias')
      .update({ responsavel: respNovo.trim() || null }).eq('id', pendencia.id).select()
    setSalvando(false)
    if (error || !data || data.length === 0) {
      setMsg({ tipo: 'erro', texto: error?.message ?? 'Sem permissão para alterar esta pendência.' })
      return
    }
    setPendencia(data[0])
    setEditandoResp(false)
    setMsg({ tipo: 'ok', texto: 'Responsável atualizado.' })
  }

  const nomeUnidade = unidades.find(u => u.id === unidadeSel)?.nome ?? '?'
  const nomeTarefa = tarefasUnidade.find(t => t.id === tarefaSel)?.nome

  if (perfil?.papel === 'cliente') {
    return <div className={styles.page}><p className={styles.vazio}>Módulo de uso interno da equipe.</p></div>
  }

  if (!nova && carregando) {
    return <div className={styles.page}><p className={styles.vazio}>Carregando…</p></div>
  }

  if (!nova && !pendencia) {
    return <div className={styles.page}><p className={styles.vazio}>Pendência não encontrada.</p></div>
  }

  const inputFoto = (
    <label className={styles.btnFoto}>
      📷 {anexando ? 'Processando…' : 'Anexar fotos'}
      <input
        type="file" accept="image/*" capture="environment" multiple hidden
        disabled={anexando}
        onChange={e => {
          const arquivos = Array.from(e.target.files ?? [])
          e.target.value = ''
          processarFotos(arquivos)
        }}
      />
    </label>
  )

  // ══════════ NOVA ══════════
  if (nova) {
    return (
      <div className={styles.page}>
        <button className={styles.voltar} onClick={() => navigate('/pendencias')}>← Pendências</button>
        <h1>Nova pendência</h1>

        <div className={styles.bloco}>
          <div className={styles.campos}>
            <label className={styles.campo}>
              Unidade *
              <select value={unidadeSel} onChange={e => { setUnidadeSel(e.target.value); setTarefaSel('') }}>
                <option value="">Selecione…</option>
                {unidades.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}
              </select>
            </label>
            <label className={styles.campo}>
              Tarefa do cronograma (opcional)
              <select value={tarefaSel} onChange={e => setTarefaSel(e.target.value)} disabled={!unidadeSel}>
                <option value="">Nenhuma</option>
                {tarefasUnidade.map(t => <option key={t.id} value={t.id}>{t.nome}</option>)}
              </select>
            </label>
            <label className={styles.campo}>
              Descrição do problema *
              <textarea value={descricao} onChange={e => setDescricao(e.target.value)}
                placeholder="Ex.: trinca na parede da sala, reboco descolando…" rows={3} />
            </label>
            <label className={styles.campo}>
              Responsável pela correção
              <input value={responsavel} onChange={e => setResponsavel(e.target.value)}
                placeholder="Nome do mestre, empreiteiro…" />
            </label>
            <label className={styles.campo}>
              Prazo
              <input type="date" value={prazo} onChange={e => setPrazo(e.target.value)} />
            </label>
          </div>
        </div>

        <div className={styles.bloco}>
          <h2>Fotos do problema</h2>
          <p className={styles.subBloco}>Carimbadas com data, hora e GPS — mesma segurança do RDO.</p>
          {inputFoto}
          {fotosStaged.length > 0 && (
            <div className={styles.gradeFotos}>
              {fotosStaged.map((f, i) => (
                <figure key={i} className={styles.foto}>
                  <img src={f.previewUrl} alt={`Foto ${i + 1}`} />
                  <figcaption>{fmtCoord(f.geo.lat, f.geo.lng, f.geo.precisao)}</figcaption>
                  <button className={styles.btnRemoverFoto}
                    onClick={() => setFotosStaged(prev => prev.filter((_, j) => j !== i))}>✕</button>
                </figure>
              ))}
            </div>
          )}
        </div>

        {msg && <p className={msg.tipo === 'ok' ? styles.msgOk : styles.msgErro}>{msg.texto}</p>}
        <button className={styles.btnPrincipal} onClick={criar} disabled={salvando}>
          {salvando ? 'Criando…' : 'Criar pendência'}
        </button>
      </div>
    )
  }

  // ══════════ DETALHE ══════════
  const p = pendencia!
  const podeMudarStatus = podeEditar && (p.status !== 'resolvida' || ehAdmin)

  return (
    <div className={styles.page}>
      <button className={styles.voltar} onClick={() => navigate('/pendencias')}>← Pendências</button>

      <div className={styles.header}>
        <h1>{nomeUnidade}</h1>
        <span className={`${styles.chip} ${styles[`chip_${p.status}`]}`}>{STATUS_LABEL[p.status]}</span>
      </div>

      <div className={styles.bloco}>
        <p className={styles.descDetalhe}>{p.descricao}</p>
        <div className={styles.metaLista}>
          {nomeTarefa && <span>🔗 {nomeTarefa}</span>}
          {!editandoResp && p.responsavel && (
            <span>
              👤 {p.responsavel}
              {podeMudarStatus && (
                <button className={styles.btnRespEditar} disabled={salvando}
                  onClick={() => { setRespNovo(p.responsavel ?? ''); setEditandoResp(true) }}>✎</button>
              )}
            </span>
          )}
          {!editandoResp && !p.responsavel && podeMudarStatus && (
            <button className={styles.btnRespDefinir} disabled={salvando}
              onClick={() => { setRespNovo(''); setEditandoResp(true) }}>
              👤 definir responsável
            </button>
          )}
          {editandoResp && (
            <span className={styles.respEdicao}>
              <input value={respNovo} onChange={e => setRespNovo(e.target.value)}
                placeholder="Responsável pela correção" autoFocus
                onKeyDown={e => { if (e.key === 'Enter') salvarResponsavel() }} />
              <button className={styles.btnRespSalvar} onClick={salvarResponsavel} disabled={salvando}>✓</button>
              <button className={styles.btnRespCancelar} onClick={() => setEditandoResp(false)} disabled={salvando}>✕</button>
            </span>
          )}
          {p.prazo && <span>📅 prazo {p.prazo.slice(8, 10)}/{p.prazo.slice(5, 7)}/{p.prazo.slice(0, 4)}</span>}
          <span>✍ {autores.get(p.criado_por) ?? '?'} em {fmtDataHora(p.criado_em)}</span>
        </div>
      </div>

      <div className={styles.bloco}>
        <h2>Fotos ({fotos.length})</h2>
        {podeEditar && inputFoto}
        {fotos.length === 0 && !podeEditar && <p className={styles.subBloco}>Sem fotos.</p>}
        {fotos.length > 0 && (
          <div className={styles.gradeFotos}>
            {fotos.map(f => (
              <figure key={f.id} className={styles.foto}>
                {urls.get(f.path)
                  ? <img src={urls.get(f.path)} alt={f.legenda ?? 'Foto da pendência'} />
                  : <div className={styles.fotoPlaceholder}>⏳</div>}
                <figcaption>
                  {fmtDataHora(f.capturada_em)} · {fmtCoord(f.lat, f.lng, f.precisao_m)}
                </figcaption>
              </figure>
            ))}
          </div>
        )}
      </div>

      {podeMudarStatus && (
        <div className={styles.blocoAcao}>
          <h2>Atualizar status</h2>
          <textarea
            className={styles.comentario}
            value={comentario}
            onChange={e => setComentario(e.target.value)}
            placeholder="Comentário (opcional) — fica registrado no histórico"
            rows={2}
          />
          <div className={styles.acoes}>
            {p.status === 'aberta' && (
              <>
                <button className={styles.btnCorrecao} onClick={() => mudarStatus('em_correcao')} disabled={salvando}>
                  ▶ Iniciar correção
                </button>
                <button className={styles.btnResolver} onClick={() => mudarStatus('resolvida')} disabled={salvando}>
                  ✓ Marcar resolvida
                </button>
              </>
            )}
            {p.status === 'em_correcao' && (
              <button className={styles.btnResolver} onClick={() => mudarStatus('resolvida')} disabled={salvando}>
                ✓ Marcar resolvida
              </button>
            )}
            {p.status === 'resolvida' && ehAdmin && (
              <button className={styles.btnReabrir} onClick={() => mudarStatus('aberta')} disabled={salvando}>
                ↻ Reabrir
              </button>
            )}
          </div>
        </div>
      )}

      {msg && <p className={msg.tipo === 'ok' ? styles.msgOk : styles.msgErro}>{msg.texto}</p>}

      <div className={styles.bloco}>
        <h2>Histórico</h2>
        <div className={styles.timeline}>
          {eventos.map(ev => (
            <div key={ev.id} className={styles.evento}>
              <span className={`${styles.dotEvento} ${styles[`dot_${ev.status}`]}`} />
              <div>
                <div className={styles.eventoTitulo}>
                  {STATUS_LABEL[ev.status]}
                  <span className={styles.eventoMeta}> — {autores.get(ev.criado_por) ?? '?'} · {fmtDataHora(ev.criado_em)}</span>
                </div>
                {ev.comentario && <div className={styles.eventoComentario}>{ev.comentario}</div>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
