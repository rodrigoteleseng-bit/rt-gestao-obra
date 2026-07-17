import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useObra } from '../contexts/ObraContext'
import {
  supabase, type Fvs, type FvsModelo, type FvsModeloItem, type FvsVerificacao,
  type FvsResposta, type FvsFoto, type Unidade, type CronogramaTarefa, type StatusFvs, type RespostaFvs,
} from '../lib/supabase'
import { obterPosicao, sha256Hex, carimbarFoto, fmtCoord } from '../lib/rdo'
import { STATUS_FVS_LABEL } from './Fvs'
import styles from './Fvs.module.css'

const fmtDataHora = (iso: string) => {
  const d = new Date(iso)
  return `${d.toLocaleDateString('pt-BR')} ${d.toLocaleTimeString('pt-BR').slice(0, 5)}`
}

export default function FvsForm() {
  const { id } = useParams()
  const nova = id === 'nova'
  const navigate = useNavigate()
  const { perfil, temModulo } = useAuth()
  const { obraAtiva } = useObra()
  const podeEditar = perfil?.papel === 'admin' || temModulo('fvs')

  // criação
  const [modelos, setModelos] = useState<FvsModelo[]>([])
  const [unidades, setUnidades] = useState<Unidade[]>([])
  const [tarefasUnidade, setTarefasUnidade] = useState<CronogramaTarefa[]>([])
  const [modeloSel, setModeloSel] = useState('')
  const [unidadeSel, setUnidadeSel] = useState('')
  const [tarefaSel, setTarefaSel] = useState('')
  const [local, setLocal] = useState('')
  const [empreiteiro, setEmpreiteiro] = useState('')

  // detalhe
  const [fvs, setFvs] = useState<Fvs | null>(null)
  const [modelo, setModelo] = useState<FvsModelo | null>(null)
  const [itens, setItens] = useState<FvsModeloItem[]>([])
  const [verificacoes, setVerificacoes] = useState<FvsVerificacao[]>([])
  const [respostas, setRespostas] = useState<Map<string, FvsResposta>>(new Map()) // item_id -> resposta (rodada atual)
  const [fotos, setFotos] = useState<FvsFoto[]>([])              // fotos da rodada aberta
  const [urls, setUrls] = useState<Map<string, string>>(new Map())
  const [anexandoItem, setAnexandoItem] = useState<string | null>(null)
  const [autores, setAutores] = useState<Map<string, string>>(new Map())
  const [obsFinal, setObsFinal] = useState('')

  // assinatura da conclusão
  const [assinando, setAssinando] = useState<StatusFvs | null>(null) // resultado escolhido aguardando assinatura
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const desenhouRef = useRef(false)
  const [nomeAssinante, setNomeAssinante] = useState('')
  const [respPendencia, setRespPendencia] = useState('') // responsável pelas pendências dos itens NC

  const [carregando, setCarregando] = useState(!nova)
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [gerandoPdf, setGerandoPdf] = useState(false)

  useEffect(() => {
    if (!obraAtiva) return
    supabase.from('fvs_modelos').select('*').eq('ativo', true).order('ordem').then(({ data }) => setModelos(data ?? []))
    supabase.from('unidades').select('*').eq('obra_id', obraAtiva.id).order('ordem').then(({ data }) => setUnidades(data ?? []))
  }, [obraAtiva])

  useEffect(() => {
    if (!unidadeSel) { setTarefasUnidade([]); return }
    supabase.from('cronograma_tarefas').select('*')
      .eq('unidade_id', unidadeSel).eq('ativo', true).eq('resumo', false).order('ordem')
      .then(({ data }) => setTarefasUnidade(data ?? []))
  }, [unidadeSel])

  useEffect(() => { if (!nova && id) carregar(id) }, [id, nova])
  useEffect(() => { if (perfil?.nome) setNomeAssinante(perfil.nome) }, [perfil])

  async function carregar(fvsId: string) {
    setCarregando(true)
    const { data: f } = await supabase.from('fvs').select('*').eq('id', fvsId).single()
    if (!f) { setCarregando(false); return }
    setFvs(f)
    const [{ data: mod }, { data: its }, { data: vers }] = await Promise.all([
      supabase.from('fvs_modelos').select('*').eq('id', f.modelo_id).single(),
      supabase.from('fvs_modelo_itens').select('*').eq('modelo_id', f.modelo_id).eq('ativo', true).order('ordem'),
      supabase.from('fvs_verificacoes').select('*').eq('fvs_id', fvsId).order('numero'),
    ])
    setModelo(mod)
    setItens(its ?? [])
    setVerificacoes(vers ?? [])

    // rodada atual = a que está sem resultado (aberta); senão a última
    const abertas = (vers ?? []).filter(v => v.resultado === null)
    const atual = abertas[0] ?? (vers ?? [])[(vers ?? []).length - 1]
    if (atual) {
      const { data: resp } = await supabase.from('fvs_respostas').select('*').eq('verificacao_id', atual.id)
      setRespostas(new Map((resp ?? []).map(r => [r.item_id, r])))
      // fotos da rodada atual
      const { data: fts } = await supabase.from('fvs_fotos').select('*')
        .eq('verificacao_id', atual.id).eq('ativo', true).order('criado_em')
      setFotos(fts ?? [])
      if (fts && fts.length > 0) {
        const novo = new Map<string, string>()
        await Promise.all(fts.map(async ft => {
          const { data } = await supabase.storage.from('fvs').createSignedUrl(ft.path, 3600)
          if (data) novo.set(ft.path, data.signedUrl)
        }))
        setUrls(novo)
      }
    }

    const idsAutores = [...new Set([f.criado_por, ...(vers ?? []).map(v => v.concluida_por).filter(Boolean) as string[]])]
    if (idsAutores.length) {
      const { data: perfis } = await supabase.from('perfis_usuario').select('id, nome').in('id', idsAutores)
      setAutores(new Map((perfis ?? []).map(u => [u.id, u.nome])))
    }
    setCarregando(false)
  }

  // rodada aberta atual (objeto)
  const rodadaAberta = useMemo(() => verificacoes.find(v => v.resultado === null) ?? null, [verificacoes])

  async function criar() {
    if (!obraAtiva || !modeloSel || !unidadeSel) {
      setMsg({ tipo: 'erro', texto: 'Selecione ao menos o modelo de FVS e a unidade.' })
      return
    }
    setSalvando(true)
    setMsg(null)
    const { data: f, error } = await supabase.from('fvs').insert({
      obra_id: obraAtiva.id, modelo_id: modeloSel, unidade_id: unidadeSel,
      tarefa_id: tarefaSel || null, local_ambiente: local.trim() || null,
      equipe_empreiteiro: empreiteiro.trim() || null,
    }).select().single()
    if (error || !f) { setSalvando(false); setMsg({ tipo: 'erro', texto: `Erro ao criar: ${error?.message}` }); return }
    const { error: erroVerificacao } = await supabase.from('fvs_verificacoes').insert({ fvs_id: f.id, numero: 1 })
    if (erroVerificacao) {
      setSalvando(false)
      setMsg({ tipo: 'erro', texto: `A FVS foi criada, mas a primeira verificação não foi aberta: ${erroVerificacao.message}` })
      return
    }
    setSalvando(false)
    navigate(`/fvs/${f.id}`, { replace: true })
  }

  // marca resposta de um item (upsert na rodada aberta)
  async function responder(itemId: string, resposta: RespostaFvs) {
    if (!rodadaAberta) return
    const existente = respostas.get(itemId)
    // otimista
    setRespostas(prev => {
      const n = new Map(prev)
      n.set(itemId, { ...(existente ?? { id: '', verificacao_id: rodadaAberta.id, item_id: itemId, observacao: null }), resposta } as FvsResposta)
      return n
    })
    if (existente?.id) {
      const { error } = await supabase.from('fvs_respostas').update({ resposta }).eq('id', existente.id)
      if (error) {
        setRespostas(prev => {
          const n = new Map(prev)
          n.set(itemId, existente)
          return n
        })
        setMsg({ tipo: 'erro', texto: `Não foi possível salvar a resposta: ${error.message}` })
      }
    } else {
      const { data, error } = await supabase.from('fvs_respostas')
        .insert({ verificacao_id: rodadaAberta.id, item_id: itemId, resposta }).select().single()
      if (error || !data) {
        setRespostas(prev => {
          const n = new Map(prev)
          n.delete(itemId)
          return n
        })
        setMsg({ tipo: 'erro', texto: `Não foi possível salvar a resposta: ${error?.message ?? 'erro desconhecido'}` })
        return
      }
      setRespostas(prev => new Map(prev).set(itemId, data))
    }
  }

  async function salvarObsItem(itemId: string, observacao: string) {
    const r = respostas.get(itemId)
    if (!r?.id) return
    const { error } = await supabase.from('fvs_respostas').update({ observacao: observacao || null }).eq('id', r.id)
    if (error) {
      setMsg({ tipo: 'erro', texto: `Não foi possível salvar a observação: ${error.message}` })
      return
    }
    setRespostas(prev => new Map(prev).set(itemId, { ...r, observacao: observacao || null }))
  }

  // anexa uma foto (carimbada com GPS/data/hora + hash) a um item
  async function anexarFotoItem(itemId: string, arquivos: File[]) {
    if (!fvs || !rodadaAberta || !obraAtiva || arquivos.length === 0) return
    setAnexandoItem(itemId)
    setMsg(null)
    try {
      const geo = await obterPosicao()
      for (const arquivo of arquivos) {
        const capturadaEm = new Date()
        const blob = await carimbarFoto(arquivo, obraAtiva.nome, geo, capturadaEm)
        const hash = await sha256Hex(blob)
        const path = `${fvs.obra_id}/${fvs.id}/${crypto.randomUUID()}.jpg`
        const { error: eUp } = await supabase.storage.from('fvs').upload(path, blob, { contentType: 'image/jpeg' })
        if (eUp) { setMsg({ tipo: 'erro', texto: `Falha no envio da foto: ${eUp.message}` }); break }
        const { data: foto, error } = await supabase.from('fvs_fotos').insert({
          fvs_id: fvs.id, verificacao_id: rodadaAberta.id, item_id: itemId, path,
          lat: geo.lat, lng: geo.lng, precisao_m: geo.precisao,
          capturada_em: capturadaEm.toISOString(), hash_sha256: hash,
        }).select().single()
        if (error) { setMsg({ tipo: 'erro', texto: `Falha ao registrar a foto: ${error.message}` }); break }
        setFotos(prev => [...prev, foto])
        const { data: su } = await supabase.storage.from('fvs').createSignedUrl(path, 3600)
        if (su) setUrls(prev => new Map(prev).set(path, su.signedUrl))
      }
    } catch {
      setMsg({ tipo: 'erro', texto: 'Falha ao processar a foto. Tente novamente.' })
    }
    setAnexandoItem(null)
  }

  async function removerFoto(fotoId: string, path: string) {
    const { error } = await supabase.from('fvs_fotos').update({ ativo: false }).eq('id', fotoId)
    if (error) {
      setMsg({ tipo: 'erro', texto: `Não foi possível remover a foto: ${error.message}` })
      return
    }
    setFotos(prev => prev.filter(f => f.id !== fotoId))
    setUrls(prev => { const n = new Map(prev); n.delete(path); return n })
  }

  const totalItens = itens.length
  // "conferidos" = com decisão final (C/NC/NA). 'aguardando' e sem-resposta ainda não contam.
  const conferidos = itens.filter(i => { const r = respostas.get(i.id)?.resposta; return r === 'c' || r === 'nc' || r === 'na' }).length
  const aguardando = itens.filter(i => respostas.get(i.id)?.resposta === 'aguardando').length
  const semResposta = itens.filter(i => !respostas.has(i.id)).length
  const faltaConferir = aguardando + semResposta
  const qtdNC = itens.filter(i => respostas.get(i.id)?.resposta === 'nc').length
  const itensComFoto = new Set(fotos.map(f => f.item_id))
  const ncSemFoto = itens.filter(i => respostas.get(i.id)?.resposta === 'nc' && !itensComFoto.has(i.id)).length

  // passo 1: escolhe o resultado → abre o painel de assinatura
  function concluir(resultado: StatusFvs) {
    if (!fvs || !rodadaAberta) return
    if (faltaConferir > 0) {
      setMsg({ tipo: 'erro', texto: `Ainda há ${faltaConferir} item(ns) aguardando conferência. Marque C, NC ou NA em todos antes de fechar.` })
      return
    }
    setMsg(null)
    setAssinando(resultado)
    setTimeout(() => document.getElementById('fvs-assinatura')?.scrollIntoView({ behavior: 'smooth' }), 50)
  }

  // canvas de assinatura (ativo enquanto assinando !== null)
  useEffect(() => {
    if (!assinando) return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!
    ctx.strokeStyle = '#1A3248'
    ctx.lineWidth = 2.2
    ctx.lineCap = 'round'
    let tracando = false
    function pos(e: PointerEvent) {
      const r = canvas!.getBoundingClientRect()
      return { x: (e.clientX - r.left) * (canvas!.width / r.width), y: (e.clientY - r.top) * (canvas!.height / r.height) }
    }
    function down(e: PointerEvent) { tracando = true; desenhouRef.current = true; const p = pos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); e.preventDefault() }
    function move(e: PointerEvent) { if (!tracando) return; const p = pos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); e.preventDefault() }
    function up() { tracando = false }
    canvas.addEventListener('pointerdown', down)
    canvas.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      canvas.removeEventListener('pointerdown', down)
      canvas.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [assinando])

  function limparAssinatura() {
    const c = canvasRef.current
    if (c) c.getContext('2d')!.clearRect(0, 0, c.width, c.height)
    desenhouRef.current = false
  }

  // passo 2: valida assinatura e conclui via RPC
  async function confirmarAssinatura() {
    if (!fvs || !rodadaAberta || !assinando) return
    if (!desenhouRef.current || !nomeAssinante.trim()) {
      setMsg({ tipo: 'erro', texto: 'Desenhe a assinatura e confirme o nome do responsável.' })
      return
    }
    setSalvando(true)
    setMsg(null)
    const geo = await obterPosicao()
    const { data, error } = await supabase.rpc('concluir_verificacao_fvs', {
      p_verificacao: rodadaAberta.id, p_resultado: assinando, p_observacao: obsFinal.trim() || null,
      p_assinatura: canvasRef.current!.toDataURL('image/png'), p_assinante: nomeAssinante.trim(),
      p_lat: geo.lat, p_lng: geo.lng, p_precisao: geo.precisao,
      p_responsavel: respPendencia.trim() || null,
    })
    setSalvando(false)
    if (error) { setMsg({ tipo: 'erro', texto: error.message }); return }
    const nPend = data as number
    const resultadoLabel = STATUS_FVS_LABEL[assinando]
    setObsFinal('')
    setRespPendencia('')
    setAssinando(null)
    desenhouRef.current = false
    await carregar(fvs.id)
    setMsg({ tipo: 'ok', texto: nPend > 0
      ? `Verificação assinada e concluída: ${resultadoLabel}. ${nPend} pendência(s) aberta(s) automaticamente.`
      : `Verificação assinada e concluída: ${resultadoLabel}.` })
  }

  async function novaRodada() {
    if (!fvs) return
    setSalvando(true)
    const { error } = await supabase.rpc('nova_verificacao_fvs', { p_fvs: fvs.id })
    setSalvando(false)
    if (error) { setMsg({ tipo: 'erro', texto: error.message }); return }
    await carregar(fvs.id)
  }

  async function excluirFvs() {
    if (!fvs) return
    if (!window.confirm('Excluir esta FVS? Ela sai das listagens e do mapa da qualidade, e as pendências que ela gerou são inativadas. O registro é mantido no banco (exclusão lógica). Use apenas para fichas salvas por engano.')) return
    setSalvando(true)
    const { error } = await supabase.rpc('excluir_fvs', { p_fvs: fvs.id })
    setSalvando(false)
    if (error) { setMsg({ tipo: 'erro', texto: error.message }); return }
    navigate('/fvs')
  }

  async function gerarPdf() {
    if (!fvs || !modelo || !obraAtiva) return
    setGerandoPdf(true)
    setMsg(null)
    try {
      const { data: fotos } = await supabase.from('fvs_fotos')
        .select('*').eq('fvs_id', fvs.id).eq('ativo', true).order('criado_em')
      const { gerarPdfFvs } = await import('../lib/fvsPdf')
      await gerarPdfFvs({
        fvs, modelo, itens, verificacoes,
        obraNome: obraAtiva.nome,
        unidadeNome: unidades.find(u => u.id === fvs.unidade_id)?.nome ?? '—',
        tarefaNome: tarefasUnidade.find(t => t.id === fvs.tarefa_id)?.nome ?? null,
        autores, fotos: fotos ?? [],
      })
    } catch (e) {
      setMsg({ tipo: 'erro', texto: `Erro ao gerar PDF: ${e instanceof Error ? e.message : e}` })
    }
    setGerandoPdf(false)
  }

  if (perfil?.papel === 'cliente') {
    return <div className={styles.page}><p className={styles.vazio}>Módulo de uso interno da equipe.</p></div>
  }

  // ══════════ NOVA ══════════
  if (nova) {
    const mSel = modelos.find(m => m.id === modeloSel)
    return (
      <div className={styles.page}>
        <button className={styles.voltar} onClick={() => navigate('/fvs')}>← FVS</button>
        <h1>Nova FVS</h1>
        <div className={styles.bloco}>
          <div className={styles.campos}>
            <label className={styles.campo}>
              Modelo de verificação *
              <select value={modeloSel} onChange={e => setModeloSel(e.target.value)}>
                <option value="">Selecione o serviço…</option>
                {modelos.map(m => <option key={m.id} value={m.id}>{m.codigo} — {m.nome}</option>)}
              </select>
            </label>
            {mSel?.objetivo && <p className={styles.objetivo}>{mSel.objetivo}</p>}
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
              Local / ambiente (opcional)
              <input value={local} onChange={e => setLocal(e.target.value)} placeholder="Ex.: Pav. Térreo, banheiro suíte" />
            </label>
            <label className={styles.campo}>
              Equipe / empreiteiro (opcional)
              <input value={empreiteiro} onChange={e => setEmpreiteiro(e.target.value)} placeholder="Nome da equipe responsável" />
            </label>
          </div>
        </div>
        {msg && <p className={msg.tipo === 'ok' ? styles.msgOk : styles.msgErro}>{msg.texto}</p>}
        <button className={styles.btnPrincipal} onClick={criar} disabled={salvando}>
          {salvando ? 'Criando…' : 'Iniciar verificação'}
        </button>
      </div>
    )
  }

  if (carregando) return <div className={styles.page}><p className={styles.vazio}>Carregando…</p></div>
  if (!fvs || !modelo) return <div className={styles.page}><p className={styles.vazio}>FVS não encontrada.</p></div>

  const unidadeNome = unidades.find(u => u.id === fvs.unidade_id)?.nome ?? '?'
  const secoes = [...new Set(itens.map(i => i.secao))]
  const editavel = podeEditar && !!rodadaAberta

  return (
    <div className={styles.page}>
      <button className={styles.voltar} onClick={() => navigate('/fvs')}>← FVS</button>
      <div className={styles.header}>
        <div>
          <h1>{modelo.codigo} — {modelo.nome}</h1>
          <p className={styles.sub}>{unidadeNome}{fvs.local_ambiente ? ` · ${fvs.local_ambiente}` : ''}{fvs.equipe_empreiteiro ? ` · ${fvs.equipe_empreiteiro}` : ''}</p>
        </div>
        <div className={styles.headerAcoes}>
          <span className={`${styles.chip} ${styles[`chip_${fvs.status}`]}`}>{STATUS_FVS_LABEL[fvs.status]}</span>
          <button className={styles.btnPdf} onClick={gerarPdf} disabled={gerandoPdf}>
            {gerandoPdf ? 'Gerando…' : '📄 Gerar PDF'}
          </button>
        </div>
      </div>

      {modelo.criterios_aceitacao && (
        <div className={styles.criterios}><strong>Critérios de aceitação:</strong> {modelo.criterios_aceitacao}</div>
      )}

      {editavel && (
        <div className={styles.progresso}>
          Verificação nº {rodadaAberta!.numero} · {conferidos}/{totalItens} conferidos
          {qtdNC > 0 && <span className={styles.progressoNC}> · {qtdNC} não conforme</span>}
          {faltaConferir > 0 && <span className={styles.progressoAG}> · {faltaConferir} aguardando conferência</span>}
        </div>
      )}

      {editavel && faltaConferir > 0 && (
        <p className={styles.dicaParcial}>
          💡 Pode conferir por partes: marque os serviços já prontos e deixe os demais como <strong>Aguardando</strong>.
          Suas respostas são salvas automaticamente — feche o app e volte outro dia. A conferência só é fechada e assinada quando todos os itens tiverem C, NC ou NA.
        </p>
      )}

      {/* legenda das respostas */}
      <div className={styles.legendaResp}>
        <span><strong className={styles.legC}>C</strong> = Conforme</span>
        <span><strong className={styles.legNC}>NC</strong> = Não conforme</span>
        <span><strong className={styles.legNA}>NA</strong> = Não aplicável</span>
        <span><strong className={styles.legAG}>AG</strong> = Aguardando conferência</span>
      </div>

      {/* itens agrupados por seção */}
      {secoes.map(secao => (
        <div key={secao} className={styles.bloco}>
          <h2>{secao}</h2>
          {itens.filter(i => i.secao === secao).map(item => {
            const r = respostas.get(item.id)
            return (
              <div key={item.id} className={styles.itemLinha}>
                <div className={styles.itemTexto}>
                  {item.texto}
                  {item.criterio && <span className={styles.itemCriterio}> — {item.criterio}</span>}
                </div>
                <div className={styles.respostaBtns}>
                  {(['c', 'nc', 'na', 'aguardando'] as RespostaFvs[]).map(op => (
                    <button key={op}
                      className={`${styles.rBtn} ${r?.resposta === op ? styles[`rBtn_${op}_ativo`] : ''}`}
                      onClick={() => editavel && responder(item.id, op)}
                      disabled={!editavel}>
                      {op === 'c' ? 'C' : op === 'nc' ? 'NC' : op === 'na' ? 'NA' : 'AG'}
                    </button>
                  ))}
                </div>
                {r?.resposta === 'nc' && (
                  <>
                    <input className={styles.itemObs} defaultValue={r.observacao ?? ''}
                      placeholder="O que está errado? (vira descrição da pendência)"
                      onBlur={e => salvarObsItem(item.id, e.target.value)} disabled={!editavel} />
                    <div className={styles.itemFotos}>
                      {editavel && (
                        <label className={styles.btnFotoItem}>
                          📷 {anexandoItem === item.id ? 'Processando…' : 'Anexar foto do problema'}
                          <input type="file" accept="image/*" capture="environment" multiple hidden
                            disabled={anexandoItem === item.id}
                            onChange={e => { const a = Array.from(e.target.files ?? []); e.target.value = ''; anexarFotoItem(item.id, a) }} />
                        </label>
                      )}
                      {fotos.filter(f => f.item_id === item.id).length > 0 && (
                        <div className={styles.miniFotos}>
                          {fotos.filter(f => f.item_id === item.id).map(f => (
                            <figure key={f.id} className={styles.miniFoto}>
                              {urls.get(f.path)
                                ? <img src={urls.get(f.path)} alt="Foto do item não conforme" />
                                : <div className={styles.miniPlaceholder}>⏳</div>}
                              {editavel && <button className={styles.miniRemover} onClick={() => removerFoto(f.id, f.path)}>✕</button>}
                            </figure>
                          ))}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            )
          })}
        </div>
      ))}

      {msg && <p className={msg.tipo === 'ok' ? styles.msgOk : styles.msgErro}>{msg.texto}</p>}

      {/* salvar parcial — some quando tudo está conferido */}
      {editavel && faltaConferir > 0 && (
        <div className={styles.blocoAcao}>
          <h2>Conferência em andamento</h2>
          <p className={styles.subBloco}>
            {conferidos} de {totalItens} itens conferidos · {faltaConferir} aguardando. As respostas já estão salvas.
          </p>
          <button className={styles.btnPrincipal} onClick={() => navigate('/fvs')} disabled={salvando}>
            💾 Salvar e continuar depois
          </button>
        </div>
      )}

      {/* ações de conclusão — só quando tudo conferido */}
      {editavel && !assinando && faltaConferir === 0 && (
        <div className={styles.blocoAcao}>
          <h2>Fechar e assinar — verificação nº {rodadaAberta!.numero}</h2>
          <textarea className={styles.comentario} value={obsFinal} onChange={e => setObsFinal(e.target.value)}
            placeholder="Observação geral da verificação (opcional)" rows={2} />
          <div className={styles.acoes}>
            <button className={styles.btnAprovar} onClick={() => concluir('aprovada')} disabled={salvando || qtdNC > 0}
              title={qtdNC > 0 ? 'Há itens não conformes — use Reprovar ou Aprovar com restrição' : ''}>
              ✓ Aprovar
            </button>
            <button className={styles.btnRestricao} onClick={() => concluir('aprovada_restricao')} disabled={salvando}>
              ⚠ Aprovar com restrição
            </button>
            <button className={styles.btnReprovar} onClick={() => concluir('reprovada')} disabled={salvando}>
              ✕ Reprovar
            </button>
          </div>
          {qtdNC > 0 && <p className={styles.avisoNC}>{qtdNC} item(ns) NC gerará(ão) pendência automática ao concluir.</p>}
          {ncSemFoto > 0 && <p className={styles.avisoFoto}>📷 {ncSemFoto} item(ns) não conforme ainda sem foto — recomendado anexar antes de concluir.</p>}
          <p className={styles.avisoFoto}>✍ Ao concluir, você assina digitalmente o resultado.</p>
        </div>
      )}

      {/* painel de assinatura */}
      {editavel && assinando && (
        <div id="fvs-assinatura" className={styles.blocoAcao}>
          <h2>Assinar — {STATUS_FVS_LABEL[assinando]}</h2>
          <p className={styles.subBloco}>
            Assinatura do responsável pela verificação. Data/hora e localização (GPS) são registradas. A verificação fica imutável.
          </p>
          <label className={styles.campo}>
            Nome do responsável
            <input value={nomeAssinante} onChange={e => setNomeAssinante(e.target.value)} placeholder="Quem está verificando" />
          </label>
          {qtdNC > 0 && (
            <label className={styles.campo}>
              Responsável pela correção das pendências ({qtdNC} item(ns) NC)
              <input value={respPendencia} onChange={e => setRespPendencia(e.target.value)}
                placeholder="Ex.: empreiteiro de alvenaria, João" />
            </label>
          )}
          <canvas ref={canvasRef} width={600} height={200} className={styles.canvasAssinatura} />
          <div className={styles.acoes}>
            <button className={styles.btnAdd} onClick={limparAssinatura} disabled={salvando}>Limpar</button>
            <button className={styles.btnCancelarAssin} onClick={() => { setAssinando(null); limparAssinatura() }} disabled={salvando}>Cancelar</button>
            <button className={styles.btnAssinar} onClick={confirmarAssinatura} disabled={salvando}>
              {salvando ? 'Assinando…' : '✓ Assinar e concluir'}
            </button>
          </div>
        </div>
      )}

      {/* FVS reprovada sem rodada aberta → botão nova verificação */}
      {podeEditar && !rodadaAberta && fvs.status === 'reprovada' && (
        <button className={styles.btnPrincipal} onClick={novaRodada} disabled={salvando}>
          ↻ Nova verificação (após correção)
        </button>
      )}

      {/* histórico de rodadas */}
      <div className={styles.bloco}>
        <h2>Histórico de verificações</h2>
        <div className={styles.timeline}>
          {verificacoes.map(v => (
            <div key={v.id} className={styles.evento}>
              <span className={`${styles.dotEvento} ${v.resultado ? styles[`dot_${v.resultado}`] : styles.dot_aberta}`} />
              <div>
                <div className={styles.eventoTitulo}>
                  Verificação nº {v.numero} — {v.resultado ? STATUS_FVS_LABEL[v.resultado] : 'em andamento'}
                  {v.concluida_em && v.concluida_por && (
                    <span className={styles.eventoMeta}> · {autores.get(v.concluida_por) ?? '?'} · {fmtDataHora(v.concluida_em)}</span>
                  )}
                </div>
                {v.observacao && <div className={styles.eventoComentario}>{v.observacao}</div>}
                {v.assinatura_imagem && (
                  <div className={styles.assinaturaHist}>
                    <img src={v.assinatura_imagem} alt="Assinatura" className={styles.assinaturaImg} />
                    <span className={styles.assinaturaLegenda}>
                      ✍ {v.assinado_por_nome}
                      {v.assinatura_lat !== null && ` · ${fmtCoord(v.assinatura_lat, v.assinatura_lng, v.assinatura_precisao_m)}`}
                    </span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* exclusão — só admin */}
      {perfil?.papel === 'admin' && (
        <div className={styles.zonaAdmin}>
          <button className={styles.btnExcluir} onClick={excluirFvs} disabled={salvando}>
            🗑 Excluir esta FVS
          </button>
          <span className={styles.zonaAdminNota}>Exclusão lógica (admin) — para fichas salvas por engano.</span>
        </div>
      )}
    </div>
  )
}
