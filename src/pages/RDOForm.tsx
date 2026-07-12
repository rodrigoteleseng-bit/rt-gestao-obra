import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useObra } from '../contexts/ObraContext'
import {
  supabase, type Rdo, type RdoAtividade, type RdoEfetivo, type RdoFoto, type RdoAudio,
  type Unidade, type CronogramaTarefa, type AvancoFisico, type CondicaoClima,
  type EfetivoChamada, type Trabalhador,
} from '../lib/supabase'
import { obterPosicao, sha256Hex, carimbarFoto, fmtCoord, fmtDuracao } from '../lib/rdo'
import { agruparPresencasComoEfetivo } from '../lib/efetivo'
import styles from './RDO.module.css'

const fmtData = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`
const CLIMAS: { valor: CondicaoClima; rotulo: string; icone: string }[] = [
  { valor: 'claro', rotulo: 'Claro', icone: '☀️' },
  { valor: 'nublado', rotulo: 'Nublado', icone: '☁️' },
  { valor: 'chuvoso', rotulo: 'Chuvoso', icone: '🌧️' },
]
const FUNCOES_SUGERIDAS = ['Pedreiro', 'Servente', 'Carpinteiro', 'Armador', 'Eletricista', 'Encanador', 'Pintor', 'Gesseiro', 'Mestre de obras', 'Encarregado']

interface AvancoDoDia extends AvancoFisico {
  tarefaNome: string
  unidadeNome: string
}

interface FvsDoDia {
  id: string
  codigo: string
  nome: string
  unidadeNome: string
  resultado: string
}

const RESULTADO_FVS_LABEL: Record<string, string> = {
  aprovada: 'Aprovada',
  aprovada_restricao: 'Aprovada c/ restrição',
  reprovada: 'Reprovada',
}

export default function RDOForm() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { perfil, temModulo } = useAuth()
  const { obraAtiva } = useObra()
  const podeEditarModulo = perfil?.papel === 'admin' || temModulo('rdo')

  const [rdo, setRdo] = useState<Rdo | null>(null)
  const [atividades, setAtividades] = useState<RdoAtividade[]>([])
  const [efetivo, setEfetivo] = useState<RdoEfetivo[]>([])
  const [chamadaDia, setChamadaDia] = useState<EfetivoChamada | null>(null)
  const [fotos, setFotos] = useState<RdoFoto[]>([])
  const [audios, setAudios] = useState<RdoAudio[]>([])
  const [avancosDia, setAvancosDia] = useState<AvancoDoDia[]>([])
  const [fvsDia, setFvsDia] = useState<FvsDoDia[]>([])
  const [unidades, setUnidades] = useState<Unidade[]>([])
  const [urls, setUrls] = useState<Map<string, string>>(new Map())
  const [carregando, setCarregando] = useState(true)
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)
  const [salvando, setSalvando] = useState(false)

  // campos do cabeçalho (estado local; persistidos em "Salvar" e na assinatura)
  const [horario, setHorario] = useState('')
  const [climaManha, setClimaManha] = useState<CondicaoClima | null>(null)
  const [manhaTrab, setManhaTrab] = useState<boolean | null>(null)
  const [climaTarde, setClimaTarde] = useState<CondicaoClima | null>(null)
  const [tardeTrab, setTardeTrab] = useState<boolean | null>(null)
  const [acidente, setAcidente] = useState(false)
  const [acidenteDesc, setAcidenteDesc] = useState('')
  const [obs, setObs] = useState('')

  // formulários de adição
  // funcaoSel: null = mostrando a lista de funções; nome = função clicada; '' = "outra função" (digita)
  const [funcaoSel, setFuncaoSel] = useState<string | null>(null)
  const [novoEfetivo, setNovoEfetivo] = useState({ funcao: '', quantidade: '', empresa: '' })
  const [novaAtividade, setNovaAtividade] = useState({ unidade: '', tarefa: '', descricao: '' })
  const [tarefasUnidade, setTarefasUnidade] = useState<CronogramaTarefa[]>([])

  // áudio
  const [gravando, setGravando] = useState(false)
  const gravadorRef = useRef<MediaRecorder | null>(null)
  const inicioGravacaoRef = useRef<number>(0)

  // ditado
  const [ditando, setDitando] = useState(false)
  const reconhecimentoRef = useRef<{ stop: () => void } | null>(null)

  // assinatura
  const [assinando, setAssinando] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const desenhouRef = useRef(false)
  const [nomeAssinante, setNomeAssinante] = useState('')

  const [gerandoPdf, setGerandoPdf] = useState(false)

  const rascunho = rdo?.status === 'rascunho'
  const podeEditar = podeEditarModulo && rascunho

  useEffect(() => { if (id) carregar(id) }, [id])

  async function carregar(rdoId: string) {
    setCarregando(true)
    const { data: r } = await supabase.from('rdos').select('*').eq('id', rdoId).single()
    if (!r) { setCarregando(false); return }
    setRdo(r)
    setHorario(r.horario_inicio?.slice(0, 5) ?? '')
    setClimaManha(r.clima_manha)
    setManhaTrab(r.clima_manha_trabalhavel)
    setClimaTarde(r.clima_tarde)
    setTardeTrab(r.clima_tarde_trabalhavel)
    setAcidente(r.acidente)
    setAcidenteDesc(r.acidente_descricao ?? '')
    setObs(r.observacoes ?? '')
    setNomeAssinante(perfil?.nome ?? '')

    const [ativ, efet, fts, auds, unis] = await Promise.all([
      supabase.from('rdo_atividades').select('*').eq('rdo_id', rdoId).eq('ativo', true).order('ordem'),
      supabase.from('rdo_efetivo').select('*').eq('rdo_id', rdoId).eq('ativo', true).order('criado_em'),
      supabase.from('rdo_fotos').select('*').eq('rdo_id', rdoId).eq('ativo', true).order('capturada_em'),
      supabase.from('rdo_audios').select('*').eq('rdo_id', rdoId).eq('ativo', true).order('gravado_em'),
      supabase.from('unidades').select('*').eq('obra_id', r.obra_id).order('ordem'),
    ])
    setAtividades(ativ.data ?? [])
    setEfetivo(efet.data ?? [])
    setFotos(fts.data ?? [])
    setAudios(auds.data ?? [])
    setUnidades(unis.data ?? [])

    // Fase 7: se já existe chamada nominal de presença para a data do RDO,
    // ela passa a ser a fonte de verdade do efetivo (substitui o efet.data
    // acima). Sem chamada para a data, o comportamento permanece o de hoje
    // (efetivo vem de rdo_efetivo, editável manualmente).
    // Só se aplica a RDO em rascunho: um RDO assinado é imutável, então o
    // efetivo fica congelado no que foi assinado (rdo_efetivo) mesmo que a
    // chamada daquele dia seja criada/editada depois da assinatura.
    if (r.status === 'rascunho') {
      const { data: chamada } = await supabase.from('efetivo_chamadas').select('*')
        .eq('obra_id', r.obra_id).eq('data', r.data).maybeSingle()
      setChamadaDia(chamada ?? null)
      if (chamada) {
        const { data: pres } = await supabase.from('efetivo_presencas')
          .select('presente, trabalhadores(id, nome, funcao, empresa, obra_id, ativo, criado_por, criado_em, data_admissao)')
          .eq('chamada_id', chamada.id)
        // embed to-one via Postgrest; sem generics Database, TS infere array — trabalhador_id é UNIQUE por FK simples, sempre 1 objeto
        const comTrabalhador = ((pres ?? []) as unknown as { presente: boolean; trabalhadores: Trabalhador | null }[])
          .filter(p => p.trabalhadores)
          .map(p => ({ trabalhador: p.trabalhadores as Trabalhador, presente: p.presente }))
        setEfetivo(agruparPresencasComoEfetivo(comTrabalhador))
      }
    } else {
      setChamadaDia(null)
    }

    // avanços físicos lançados com data de referência = dia do RDO
    const { data: avs } = await supabase.from('avancos_fisicos').select('*')
      .eq('ativo', true).eq('data_referencia', r.data)
    const lista = avs ?? []
    if (lista.length > 0) {
      const ids = [...new Set(lista.map(a => a.tarefa_id))]
      const { data: tars } = await supabase.from('cronograma_tarefas')
        .select('id, nome, unidade_id').in('id', ids)
      const porId = new Map((tars ?? []).map(t => [t.id, t]))
      const nomesU = new Map((unis.data ?? []).map(u => [u.id, u.nome]))
      setAvancosDia(lista.map(a => {
        const t = porId.get(a.tarefa_id)
        return { ...a, tarefaNome: t?.nome ?? '?', unidadeNome: nomesU.get(t?.unidade_id ?? '') ?? '?' }
      }))
    } else setAvancosDia([])

    // FVS cujas verificações foram concluídas no dia do RDO (fuso local: dia inteiro)
    const { data: verifs } = await supabase.from('fvs_verificacoes')
      .select('fvs_id, resultado, concluida_em')
      .not('concluida_em', 'is', null)
      .gte('concluida_em', `${r.data}T00:00:00`)
      .lte('concluida_em', `${r.data}T23:59:59.999`)
    if (verifs && verifs.length > 0) {
      const fvsIds = [...new Set(verifs.map(v => v.fvs_id))]
      const { data: fvsRows } = await supabase.from('fvs')
        .select('id, unidade_id, modelo_id').in('id', fvsIds).eq('obra_id', r.obra_id)
      const modeloIds = [...new Set((fvsRows ?? []).map(f => f.modelo_id))]
      const { data: mods } = await supabase.from('fvs_modelos').select('id, codigo, nome').in('id', modeloIds)
      const modMap = new Map((mods ?? []).map(m => [m.id, m]))
      const nomesU = new Map((unis.data ?? []).map(u => [u.id, u.nome]))
      const fvsMap = new Map((fvsRows ?? []).map(f => [f.id, f]))
      setFvsDia(verifs.map(v => {
        const f = fvsMap.get(v.fvs_id)
        const m = f ? modMap.get(f.modelo_id) : undefined
        return {
          id: v.fvs_id,
          codigo: m?.codigo ?? '?',
          nome: m?.nome ?? '?',
          unidadeNome: nomesU.get(f?.unidade_id ?? '') ?? '?',
          resultado: v.resultado ?? '',
        }
      }))
    } else setFvsDia([])

    // URLs assinadas de fotos e áudios
    const paths = [...(fts.data ?? []).map(f => f.path), ...(auds.data ?? []).map(a => a.path)]
    if (paths.length > 0) {
      const novo = new Map<string, string>()
      await Promise.all(paths.map(async p => {
        const { data } = await supabase.storage.from('rdo').createSignedUrl(p, 3600)
        if (data) novo.set(p, data.signedUrl)
      }))
      setUrls(novo)
    }
    setCarregando(false)
  }

  async function salvarCabecalho(extra?: Partial<Rdo>): Promise<boolean> {
    if (!rdo) return false
    setSalvando(true)
    const { error } = await supabase.from('rdos').update({
      horario_inicio: horario || null,
      clima_manha: climaManha,
      clima_manha_trabalhavel: manhaTrab,
      clima_tarde: climaTarde,
      clima_tarde_trabalhavel: tardeTrab,
      acidente,
      acidente_descricao: acidente ? (acidenteDesc || null) : null,
      observacoes: obs || null,
      ...extra,
    }).eq('id', rdo.id)
    setSalvando(false)
    if (error) { setMsg({ tipo: 'erro', texto: `Erro ao salvar: ${error.message}` }); return false }
    return true
  }

  // ---------- efetivo ----------
  async function addEfetivo() {
    if (!rdo) return
    const funcao = (funcaoSel || novoEfetivo.funcao).trim()
    const qtd = Number(novoEfetivo.quantidade)
    if (!funcao || isNaN(qtd) || qtd <= 0) return
    const { data, error } = await supabase.from('rdo_efetivo').insert({
      rdo_id: rdo.id, funcao, quantidade: qtd,
      empresa: novoEfetivo.empresa.trim() || null,
    }).select().single()
    if (error) { setMsg({ tipo: 'erro', texto: error.message }); return }
    setEfetivo(prev => [...prev, data])
    setNovoEfetivo({ funcao: '', quantidade: '', empresa: '' })
    setFuncaoSel(null)
  }
  async function removerEfetivo(eId: string) {
    await supabase.from('rdo_efetivo').update({ ativo: false }).eq('id', eId)
    setEfetivo(prev => prev.filter(e => e.id !== eId))
  }

  // ---------- atividades ----------
  useEffect(() => {
    if (!novaAtividade.unidade) { setTarefasUnidade([]); return }
    supabase.from('cronograma_tarefas').select('*')
      .eq('unidade_id', novaAtividade.unidade).eq('ativo', true).eq('resumo', false).order('ordem')
      .then(({ data }) => setTarefasUnidade(data ?? []))
  }, [novaAtividade.unidade])

  async function addAtividade() {
    if (!rdo || !novaAtividade.unidade || !novaAtividade.descricao.trim()) return
    const { data, error } = await supabase.from('rdo_atividades').insert({
      rdo_id: rdo.id, unidade_id: novaAtividade.unidade,
      tarefa_id: novaAtividade.tarefa || null,
      descricao: novaAtividade.descricao.trim(),
      ordem: atividades.length,
    }).select().single()
    if (error) { setMsg({ tipo: 'erro', texto: error.message }); return }
    setAtividades(prev => [...prev, data])
    setNovaAtividade({ unidade: novaAtividade.unidade, tarefa: '', descricao: '' })
  }
  async function removerAtividade(aId: string) {
    await supabase.from('rdo_atividades').update({ ativo: false }).eq('id', aId)
    setAtividades(prev => prev.filter(a => a.id !== aId))
  }

  // ---------- fotos ----------
  // Recebe File[] já copiado — a FileList original é "viva" e esvazia
  // quando o input é limpo, o que fazia a foto não anexar.
  async function anexarFotos(files: File[]) {
    if (!rdo || !obraAtiva || files.length === 0) return
    setMsg({ tipo: 'ok', texto: `Anexando ${files.length} foto${files.length > 1 ? 's' : ''}…` })
    const geo = await obterPosicao()
    let anexadas = 0
    for (const arquivo of files) {
      try {
        const capturadaEm = new Date()
        const blob = await carimbarFoto(arquivo, obraAtiva.nome, geo, capturadaEm)
        const hash = await sha256Hex(blob)
        const path = `${rdo.obra_id}/${rdo.data}/${crypto.randomUUID()}.jpg`
        const { error: eUp } = await supabase.storage.from('rdo').upload(path, blob, { contentType: 'image/jpeg' })
        if (eUp) throw new Error(eUp.message)
        const { data, error } = await supabase.from('rdo_fotos').insert({
          rdo_id: rdo.id, path, lat: geo.lat, lng: geo.lng, precisao_m: geo.precisao,
          capturada_em: capturadaEm.toISOString(), hash_sha256: hash,
        }).select().single()
        if (error) throw new Error(error.message)
        const { data: su } = await supabase.storage.from('rdo').createSignedUrl(path, 3600)
        if (su) setUrls(prev => new Map(prev).set(path, su.signedUrl))
        setFotos(prev => [...prev, data])
        anexadas++
      } catch (e) {
        setMsg({ tipo: 'erro', texto: `Erro na foto: ${e instanceof Error ? e.message : e}` })
        return
      }
    }
    setMsg({
      tipo: geo.lat === null ? 'erro' : 'ok',
      texto: geo.lat === null
        ? `${anexadas} foto${anexadas > 1 ? 's' : ''} anexada${anexadas > 1 ? 's' : ''} SEM GPS (permissão de localização negada) — o carimbo registra "sem GPS".`
        : `${anexadas} foto${anexadas > 1 ? 's' : ''} anexada${anexadas > 1 ? 's' : ''} com carimbo de data/hora/GPS.`,
    })
  }
  async function legendarFoto(f: RdoFoto, legenda: string) {
    await supabase.from('rdo_fotos').update({ legenda: legenda || null }).eq('id', f.id)
    setFotos(prev => prev.map(x => x.id === f.id ? { ...x, legenda } : x))
  }
  async function removerFoto(fId: string) {
    await supabase.from('rdo_fotos').update({ ativo: false }).eq('id', fId)
    setFotos(prev => prev.filter(f => f.id !== fId))
  }

  // ---------- áudio ----------
  async function alternarGravacao() {
    if (gravando) {
      gravadorRef.current?.stop()
      setGravando(false)
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const rec = new MediaRecorder(stream)
      const pedacos: Blob[] = []
      rec.ondataavailable = e => pedacos.push(e.data)
      rec.onstop = async () => {
        stream.getTracks().forEach(t => t.stop())
        if (!rdo) return
        const blob = new Blob(pedacos, { type: rec.mimeType || 'audio/webm' })
        const duracao = Math.round((Date.now() - inicioGravacaoRef.current) / 100) / 10
        const hash = await sha256Hex(blob)
        const path = `${rdo.obra_id}/${rdo.data}/${crypto.randomUUID()}.webm`
        const { error: eUp } = await supabase.storage.from('rdo').upload(path, blob, { contentType: blob.type })
        if (eUp) { setMsg({ tipo: 'erro', texto: `Erro no áudio: ${eUp.message}` }); return }
        const { data, error } = await supabase.from('rdo_audios').insert({
          rdo_id: rdo.id, path, duracao_seg: duracao,
          gravado_em: new Date(inicioGravacaoRef.current).toISOString(), hash_sha256: hash,
        }).select().single()
        if (error) { setMsg({ tipo: 'erro', texto: error.message }); return }
        const { data: su } = await supabase.storage.from('rdo').createSignedUrl(path, 3600)
        if (su) setUrls(prev => new Map(prev).set(path, su.signedUrl))
        setAudios(prev => [...prev, data])
      }
      inicioGravacaoRef.current = Date.now()
      rec.start()
      gravadorRef.current = rec
      setGravando(true)
    } catch {
      setMsg({ tipo: 'erro', texto: 'Microfone indisponível ou permissão negada.' })
    }
  }
  async function removerAudio(aId: string) {
    await supabase.from('rdo_audios').update({ ativo: false }).eq('id', aId)
    setAudios(prev => prev.filter(a => a.id !== aId))
  }

  // ---------- ditado por voz ----------
  function alternarDitado() {
    if (ditando) { reconhecimentoRef.current?.stop(); setDitando(false); return }
    const SR = (window as unknown as { SpeechRecognition?: new () => unknown; webkitSpeechRecognition?: new () => unknown })
    const Ctor = SR.SpeechRecognition ?? SR.webkitSpeechRecognition
    if (!Ctor) { setMsg({ tipo: 'erro', texto: 'Ditado por voz não disponível neste navegador (use o Chrome).' }); return }
    const rec = new (Ctor as new () => {
      lang: string; continuous: boolean; interimResults: boolean
      onresult: ((e: { resultIndex: number; results: { isFinal: boolean; 0: { transcript: string } }[] }) => void) | null
      onend: (() => void) | null; start: () => void; stop: () => void
    })()
    rec.lang = 'pt-BR'
    rec.continuous = true
    rec.interimResults = false
    rec.onresult = e => {
      let texto = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) texto += e.results[i][0].transcript
      }
      if (texto) setObs(prev => (prev ? prev + ' ' : '') + texto.trim())
    }
    rec.onend = () => setDitando(false)
    rec.start()
    reconhecimentoRef.current = rec
    setDitando(true)
  }

  // ---------- assinatura ----------
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

  // Fase 7: quando o efetivo em tela vem da chamada de presença, ele é
  // sintético (agrupado a partir de efetivo_presencas) e nunca foi gravado
  // em rdo_efetivo. Sem isso, o RDO assinado (documento imutável) congela
  // com efetivo vazio, mesmo tendo pessoas presentes na chamada do dia.
  async function materializarEfetivoDaChamada() {
    if (!rdo || !chamadaDia || efetivo.length === 0) return true
    // Desativa lançamentos manuais pré-existentes deste RDO antes de gravar
    // as linhas da chamada — evita duplicar efetivo ativo (manual + chamada)
    // no documento assinado (imutável).
    const { error: eDesativa } = await supabase.from('rdo_efetivo')
      .update({ ativo: false }).eq('rdo_id', rdo.id).eq('ativo', true)
    if (eDesativa) {
      setMsg({ tipo: 'erro', texto: `Erro ao consolidar efetivo: ${eDesativa.message}` })
      return false
    }
    const { error } = await supabase.from('rdo_efetivo').insert(
      efetivo.map(e => ({ rdo_id: rdo.id, funcao: e.funcao, quantidade: e.quantidade, empresa: e.empresa }))
    )
    if (error) {
      setMsg({ tipo: 'erro', texto: `Erro ao registrar efetivo da chamada: ${error.message}` })
      return false
    }
    return true
  }

  async function assinarFechar() {
    if (!rdo || !desenhouRef.current || !nomeAssinante.trim()) {
      setMsg({ tipo: 'erro', texto: 'Desenhe a assinatura e confirme o nome antes de fechar.' })
      return
    }
    setSalvando(true)
    const materializou = await materializarEfetivoDaChamada()
    if (!materializou) { setSalvando(false); return }
    const geo = await obterPosicao()
    const ok = await salvarCabecalho({
      status: 'assinado',
      assinatura_imagem: canvasRef.current!.toDataURL('image/png'),
      assinado_por_nome: nomeAssinante.trim(),
      assinado_em: new Date().toISOString(),
      assinatura_lat: geo.lat,
      assinatura_lng: geo.lng,
      assinatura_precisao_m: geo.precisao,
    })
    setSalvando(false)
    if (ok) {
      setAssinando(false)
      setMsg({ tipo: 'ok', texto: 'RDO assinado e fechado. Nenhuma alteração é mais possível.' })
      await carregar(rdo.id)
    }
  }

  // ---------- PDF ----------
  async function baixarPdf() {
    if (!rdo || !obraAtiva) return
    setGerandoPdf(true)
    try {
      const { gerarPdfRdo } = await import('../lib/rdoPdf')
      await gerarPdfRdo({
        rdo: { ...rdo, horario_inicio: horario || rdo.horario_inicio, observacoes: obs || rdo.observacoes },
        obraNome: obraAtiva.nome,
        atividades, efetivo, fotos, audios, avancosDia, fvsDia, unidades,
      })
    } catch (e) {
      setMsg({ tipo: 'erro', texto: `Erro ao gerar PDF: ${e instanceof Error ? e.message : e}` })
    }
    setGerandoPdf(false)
  }

  if (carregando) return <div className={styles.page}><p className={styles.carregando}>Carregando RDO…</p></div>
  if (!rdo) return <div className={styles.page}><p className={styles.vazio}>RDO não encontrado.</p></div>

  const nomeUnidade = (uid: string | null) => unidades.find(u => u.id === uid)?.nome ?? '—'

  return (
    <div className={styles.page}>
      <button className={styles.voltar} onClick={() => navigate('/rdo')}>← RDOs</button>

      <div className={styles.header}>
        <div>
          <h1>RDO Nº {String(rdo.numero).padStart(3, '0')} — {fmtData(rdo.data)}</h1>
          <p className={styles.sub}>
            {rdo.status === 'assinado'
              ? `Assinado por ${rdo.assinado_por_nome} em ${new Date(rdo.assinado_em!).toLocaleString('pt-BR')} · ${fmtCoord(rdo.assinatura_lat, rdo.assinatura_lng, rdo.assinatura_precisao_m)}`
              : 'Rascunho — preencha e assine para fechar o dia.'}
          </p>
        </div>
        <span className={rdo.status === 'assinado' ? styles.chipAssinado : styles.chipRascunho}>
          {rdo.status === 'assinado' ? 'Assinado' : 'Rascunho'}
        </span>
      </div>

      {/* Cabeçalho do dia */}
      <section className={styles.bloco}>
        <h2>Dia de trabalho</h2>
        <div className={styles.linhaCampos}>
          <label className={styles.campo}>
            Início dos trabalhos
            <input type="time" value={horario} disabled={!podeEditar} onChange={e => setHorario(e.target.value)} />
          </label>
        </div>
        {(['manha', 'tarde'] as const).map(periodo => {
          const cond = periodo === 'manha' ? climaManha : climaTarde
          const trab = periodo === 'manha' ? manhaTrab : tardeTrab
          const setCond = periodo === 'manha' ? setClimaManha : setClimaTarde
          const setTrab = periodo === 'manha' ? setManhaTrab : setTardeTrab
          return (
            <div key={periodo} className={styles.climaLinha}>
              <span className={styles.climaRotulo}>{periodo === 'manha' ? 'Manhã' : 'Tarde'}</span>
              {CLIMAS.map(c => (
                <button
                  key={c.valor} disabled={!podeEditar}
                  className={cond === c.valor ? styles.climaBtnAtivo : styles.climaBtn}
                  onClick={() => setCond(c.valor)}
                >
                  {c.icone} {c.rotulo}
                </button>
              ))}
              <button
                disabled={!podeEditar}
                className={trab === true ? styles.trabBtnSim : trab === false ? styles.trabBtnNao : styles.climaBtn}
                onClick={() => setTrab(trab === null ? true : trab === true ? false : null)}
                title="Alterna: trabalhável / não trabalhável / não informado"
              >
                {trab === true ? '✓ Trabalhável' : trab === false ? '✗ Não trabalhável' : 'Trabalhável?'}
              </button>
            </div>
          )
        })}
      </section>

      {/* Efetivo */}
      <section className={styles.bloco}>
        <h2>Efetivo do dia {efetivo.length > 0 && <span className={styles.totalEfetivo}>({efetivo.reduce((a, e) => a + e.quantidade, 0)} pessoas)</span>}</h2>
        {!chamadaDia && podeEditar && (
          <p className={styles.avisoPendentes}>
            Chamada do dia ainda não feita. <button className={styles.btnRemover} onClick={() => navigate('/efetivo')}>Fazer chamada</button>
          </p>
        )}
        {chamadaDia && podeEditar && (
          <p className={styles.subBloco}>
            Efetivo vindo da chamada de presença do dia. <button className={styles.btnRemover} onClick={() => navigate('/efetivo')}>Editar chamada</button>
          </p>
        )}
        {efetivo.map(e => (
          <div key={e.id} className={styles.itemLinha}>
            <span className={styles.itemTexto}><strong>{e.quantidade}×</strong> {e.funcao}{e.empresa ? ` — ${e.empresa}` : ''}</span>
            {podeEditar && !chamadaDia && <button className={styles.btnRemover} onClick={() => removerEfetivo(e.id)}>✕</button>}
          </div>
        ))}
        {podeEditar && !chamadaDia && funcaoSel === null && (
          <div className={styles.chipsFuncoes}>
            {FUNCOES_SUGERIDAS.map(f => (
              <button key={f} className={styles.chipFuncao} onClick={() => { setFuncaoSel(f); setNovoEfetivo({ funcao: '', quantidade: '', empresa: '' }) }}>
                {f}
              </button>
            ))}
            <button className={styles.chipFuncaoOutra} onClick={() => { setFuncaoSel(''); setNovoEfetivo({ funcao: '', quantidade: '', empresa: '' }) }}>
              + Outra função
            </button>
          </div>
        )}
        {podeEditar && !chamadaDia && funcaoSel !== null && (
          <div className={styles.linhaCampos}>
            {funcaoSel === ''
              ? <input autoFocus placeholder="Função" value={novoEfetivo.funcao}
                  onChange={e => setNovoEfetivo(prev => ({ ...prev, funcao: e.target.value }))} className={styles.inputMedio} />
              : <span className={styles.funcaoEscolhida}>{funcaoSel}</span>}
            <input type="number" min={1} inputMode="numeric" placeholder="Qtd" autoFocus={funcaoSel !== ''}
              value={novoEfetivo.quantidade}
              onChange={e => setNovoEfetivo(prev => ({ ...prev, quantidade: e.target.value }))}
              onKeyDown={e => { if (e.key === 'Enter') addEfetivo() }}
              className={styles.inputCurto} />
            <input placeholder="Empresa (opcional)" value={novoEfetivo.empresa}
              onChange={e => setNovoEfetivo(prev => ({ ...prev, empresa: e.target.value }))} className={styles.inputMedio} />
            <button className={styles.btnAdd} onClick={addEfetivo}>+ Adicionar</button>
            <button className={styles.btnRemover} onClick={() => setFuncaoSel(null)}>Cancelar</button>
          </div>
        )}
      </section>

      {/* Serviços do dia */}
      <section className={styles.bloco}>
        <h2>Serviços executados</h2>
        {avancosDia.length > 0 && (
          <>
            <p className={styles.subBloco}>Lançados no Avanço Físico nesta data (automático):</p>
            {avancosDia.map(a => (
              <div key={a.id} className={styles.itemLinha}>
                <span className={styles.itemTexto}>
                  📊 {a.unidadeNome} — {a.tarefaNome}: <strong>{a.quantidade !== null ? `${a.quantidade} → ` : ''}{a.percentual}%</strong>
                </span>
              </div>
            ))}
          </>
        )}
        {atividades.map(a => (
          <div key={a.id} className={styles.itemLinha}>
            <span className={styles.itemTexto}>🔨 {nomeUnidade(a.unidade_id)} — {a.descricao}</span>
            {podeEditar && <button className={styles.btnRemover} onClick={() => removerAtividade(a.id)}>✕</button>}
          </div>
        ))}
        {avancosDia.length === 0 && atividades.length === 0 && <p className={styles.vazio}>Nenhum serviço registrado neste dia.</p>}
        {podeEditar && (
          <div className={styles.linhaCampos}>
            <select value={novaAtividade.unidade} className={styles.inputMedio}
              onChange={e => setNovaAtividade(prev => ({ ...prev, unidade: e.target.value, tarefa: '' }))}>
              <option value="">Unidade…</option>
              {unidades.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}
            </select>
            <select value={novaAtividade.tarefa} className={styles.inputMedio} disabled={!novaAtividade.unidade}
              onChange={e => setNovaAtividade(prev => ({ ...prev, tarefa: e.target.value }))}>
              <option value="">Tarefa do cronograma (opcional)…</option>
              {tarefasUnidade.map(t => <option key={t.id} value={t.id}>{t.nome}</option>)}
            </select>
            <input placeholder="Descrição do serviço" value={novaAtividade.descricao} className={styles.inputLongo}
              onChange={e => setNovaAtividade(prev => ({ ...prev, descricao: e.target.value }))} />
            <button className={styles.btnAdd} onClick={addAtividade}>+ Adicionar</button>
          </div>
        )}
      </section>

      {/* FVS do dia (automático) */}
      {fvsDia.length > 0 && (
        <section className={styles.bloco}>
          <h2>Qualidade — FVS do dia</h2>
          <p className={styles.subBloco}>Fichas de verificação concluídas nesta data (automático):</p>
          {fvsDia.map(f => (
            <div key={`${f.id}-${f.resultado}`} className={styles.itemLinha}>
              <span className={styles.itemTexto}>
                ✅ {f.codigo} {f.nome} — {f.unidadeNome}: <strong>{RESULTADO_FVS_LABEL[f.resultado] ?? f.resultado}</strong>
              </span>
            </div>
          ))}
        </section>
      )}

      {/* Acidentes */}
      <section className={styles.bloco}>
        <h2>Acidentes</h2>
        <div className={styles.linhaCampos}>
          <button disabled={!podeEditar} className={!acidente ? styles.trabBtnSim : styles.climaBtn} onClick={() => setAcidente(false)}>Sem acidentes</button>
          <button disabled={!podeEditar} className={acidente ? styles.trabBtnNao : styles.climaBtn} onClick={() => setAcidente(true)}>⚠ Houve acidente</button>
        </div>
        {acidente && (
          <textarea
            className={styles.textarea} placeholder="Descreva o acidente (obrigatório)…"
            value={acidenteDesc} disabled={!podeEditar} onChange={e => setAcidenteDesc(e.target.value)}
          />
        )}
      </section>

      {/* Fotos */}
      <section className={styles.bloco}>
        <h2>Fotos ({fotos.length})</h2>
        <p className={styles.subBloco}>Cada foto sai carimbada com data, hora e GPS, e recebe hash de integridade.</p>
        {podeEditar && (
          <label className={styles.btnFoto}>
            📷 Tirar / anexar fotos
            <input type="file" accept="image/*" capture="environment" multiple hidden
              onChange={e => {
                const arquivos = Array.from(e.target.files ?? [])
                e.target.value = ''
                anexarFotos(arquivos)
              }} />
          </label>
        )}
        <div className={styles.gradeFotos}>
          {fotos.map(f => (
            <figure key={f.id} className={styles.foto}>
              {urls.get(f.path)
                ? <img src={urls.get(f.path)} alt={f.legenda ?? 'Foto do RDO'} />
                : <div className={styles.fotoPlaceholder}>…</div>}
              <figcaption>
                {new Date(f.capturada_em).toLocaleTimeString('pt-BR').slice(0, 5)} · {fmtCoord(f.lat, f.lng, f.precisao_m)}
                {podeEditar ? (
                  <input
                    className={styles.legendaInput} placeholder="legenda…" defaultValue={f.legenda ?? ''}
                    onBlur={e => legendarFoto(f, e.target.value.trim())}
                  />
                ) : (f.legenda && <span className={styles.legendaTexto}>{f.legenda}</span>)}
              </figcaption>
              {podeEditar && <button className={styles.btnRemoverFoto} onClick={() => removerFoto(f.id)}>✕</button>}
            </figure>
          ))}
        </div>
      </section>

      {/* Observações + áudio */}
      <section className={styles.bloco}>
        <h2>Observações</h2>
        <textarea
          className={styles.textarea} placeholder="Observações do dia…"
          value={obs} disabled={!podeEditar} onChange={e => setObs(e.target.value)}
        />
        {podeEditar && (
          <div className={styles.linhaCampos}>
            <button className={ditando ? styles.btnGravando : styles.btnAdd} onClick={alternarDitado}>
              {ditando ? '⏹ Parar ditado' : '🎤 Ditar texto'}
            </button>
            <button className={gravando ? styles.btnGravando : styles.btnAdd} onClick={alternarGravacao}>
              {gravando ? '⏹ Parar e anexar áudio' : '🎙️ Gravar áudio anexo'}
            </button>
          </div>
        )}
        {audios.map((a, i) => (
          <div key={a.id} className={styles.itemLinha}>
            <span className={styles.itemTexto}>🎙️ Áudio {i + 1} · {fmtDuracao(a.duracao_seg)} · {new Date(a.gravado_em).toLocaleTimeString('pt-BR').slice(0, 5)}</span>
            {urls.get(a.path) && <audio controls src={urls.get(a.path)} className={styles.player} />}
            {podeEditar && <button className={styles.btnRemover} onClick={() => removerAudio(a.id)}>✕</button>}
          </div>
        ))}
      </section>

      {msg && <p className={msg.tipo === 'ok' ? styles.msgOk : styles.msgErro}>{msg.texto}</p>}

      {/* Ações */}
      <div className={styles.acoes}>
        <button className={styles.btnPdf} onClick={baixarPdf} disabled={gerandoPdf}>
          {gerandoPdf ? 'Gerando…' : `⬇ PDF${rascunho ? ' (rascunho)' : ''}`}
        </button>
        {podeEditar && !assinando && (
          <>
            <button className={styles.btnSalvarRascunho} onClick={async () => { if (await salvarCabecalho()) setMsg({ tipo: 'ok', texto: 'Rascunho salvo.' }) }} disabled={salvando}>
              {salvando ? 'Salvando…' : 'Salvar rascunho'}
            </button>
            <button className={styles.btnAssinar} onClick={() => setAssinando(true)}>✍ Assinar e fechar</button>
          </>
        )}
      </div>

      {assinando && (
        <section className={styles.blocoAssinatura}>
          <h2>Assinatura digital</h2>
          <p className={styles.subBloco}>
            Ao assinar, o RDO é fechado em definitivo (data/hora e localização da assinatura são registradas). Nada mais poderá ser alterado.
          </p>
          <input
            className={styles.inputLongo} placeholder="Nome do responsável"
            value={nomeAssinante} onChange={e => setNomeAssinante(e.target.value)}
          />
          <canvas ref={canvasRef} width={600} height={200} className={styles.canvasAssinatura} />
          <div className={styles.linhaCampos}>
            <button className={styles.btnAdd} onClick={limparAssinatura}>Limpar</button>
            <button className={styles.btnAdd} onClick={() => setAssinando(false)}>Cancelar</button>
            <button className={styles.btnAssinar} onClick={assinarFechar} disabled={salvando}>
              {salvando ? 'Fechando…' : 'Confirmar assinatura e fechar'}
            </button>
          </div>
        </section>
      )}
    </div>
  )
}
