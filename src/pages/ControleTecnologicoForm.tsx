import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useObra } from '../contexts/ObraContext'
import { supabase, type CtCaminhao, type CtConcretagem, type Unidade } from '../lib/supabase'
import { STATUS_CONCRETAGEM_LABEL } from './ControleTecnologico'
import styles from './ControleTecnologicoForm.module.css'

function nomeArquivoStorage(nome: string): string {
  const partes = nome.split('.')
  const extensao = partes.length > 1 ? `.${partes.pop()}` : ''
  const base = (partes.join('.') || 'arquivo')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 80) || 'arquivo'
  const extLimpa = extensao
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9.]/g, '')
    .slice(0, 16)
  return `${base}${extLimpa}`.toLowerCase()
}

function fmtHoraCurta(iso: string | null): string {
  if (!iso) return '\u2014'
  return new Date(iso).toLocaleString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

function fmtSlumpSolicitado(nominal: number | null, tolerancia: number | null): string {
  if (nominal === null) return '\u2014'
  return tolerancia ? `${nominal}\u00b1${tolerancia}` : `${nominal}`
}

export default function ControleTecnologicoForm() {
  const { id } = useParams()
  const nova = id === 'nova'
  const navigate = useNavigate()
  const { perfil, temModulo } = useAuth()
  const { obraAtiva } = useObra()
  const podeEditar = perfil?.papel === 'admin' || temModulo('controle_tecnologico')

  const [unidades, setUnidades] = useState<Unidade[]>([])
  const [unidadeId, setUnidadeId] = useState('')
  const [data, setData] = useState(() => new Date().toISOString().slice(0, 10))
  const [arquivo, setArquivo] = useState<File | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)

  const [concretagem, setConcretagem] = useState<CtConcretagem | null>(null)
  const [carregando, setCarregando] = useState(!nova)

  const [caminhoes, setCaminhoes] = useState<CtCaminhao[]>([])
  const [mostrarFormCaminhao, setMostrarFormCaminhao] = useState(false)
  const [fFornecedor, setFFornecedor] = useState('')
  const [fNf, setFNf] = useState('')
  const [fAmostra, setFAmostra] = useState('')
  const [fLacre, setFLacre] = useState('')
  const [fVolume, setFVolume] = useState('')
  const [fSlumpSolicitado, setFSlumpSolicitado] = useState('')
  const [fSlumpTolerancia, setFSlumpTolerancia] = useState('')
  const [fSlumpMedido, setFSlumpMedido] = useState('')
  const [fHoraSaida, setFHoraSaida] = useState('')
  const [fHoraChegada, setFHoraChegada] = useState('')
  const [fHoraInicioDescarga, setFHoraInicioDescarga] = useState('')
  const [fHoraFimDescarga, setFHoraFimDescarga] = useState('')
  const [fCor, setFCor] = useState('#C49A7A')
  const [salvandoCaminhao, setSalvandoCaminhao] = useState(false)
  const [msgCaminhao, setMsgCaminhao] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)
  const [finalizando, setFinalizando] = useState(false)

  const [caminhaoLaudoId, setCaminhaoLaudoId] = useState<string | null>(null)
  const [arquivoLaudo, setArquivoLaudo] = useState<File | null>(null)
  const [enviandoLaudo, setEnviandoLaudo] = useState(false)
  const [urlsLaudo, setUrlsLaudo] = useState<Map<string, string>>(new Map())

  useEffect(() => {
    if (!obraAtiva) return
    supabase.from('unidades').select('*').eq('obra_id', obraAtiva.id).order('ordem')
      .then(({ data }) => setUnidades(data ?? []))
  }, [obraAtiva])

  useEffect(() => {
    if (nova || !id) return
    setCarregando(true)
    supabase.from('ct_concretagens').select('*').eq('id', id).single()
      .then(({ data }) => {
        setConcretagem(data ?? null)
        setCarregando(false)
        if (data) carregarCaminhoes(data.id)
      })
  }, [id, nova])

  async function carregarCaminhoes(concretagemId: string) {
    const { data } = await supabase.from('ct_caminhoes').select('*')
      .eq('concretagem_id', concretagemId).eq('ativo', true)
      .order('criado_em')
    setCaminhoes(data ?? [])
  }

  useEffect(() => {
    let cancelado = false
    async function carregarUrls() {
      const novasUrls = new Map<string, string>()
      await Promise.all(caminhoes.map(async c => {
        if (!c.laudo_url) return
        const { data } = await supabase.storage.from('controle-tecnologico').createSignedUrl(c.laudo_url, 3600)
        if (data) novasUrls.set(c.laudo_url, data.signedUrl)
      }))
      if (!cancelado) setUrlsLaudo(novasUrls)
    }
    carregarUrls()
    return () => { cancelado = true }
  }, [caminhoes])

  function horaOuNulo(valorHora: string, dataConcretagem: string): string | null {
    return valorHora ? new Date(`${dataConcretagem}T${valorHora}`).toISOString() : null
  }

  async function lancarCaminhao() {
    if (!concretagem) return
    if (!fFornecedor.trim() || !fNf.trim() || !fAmostra.trim() || !fLacre.trim() || !fVolume) {
      setMsgCaminhao({ tipo: 'erro', texto: 'Preencha fornecedor, NF, amostra, lacre e volume.' })
      return
    }
    setSalvandoCaminhao(true)
    setMsgCaminhao(null)
    const { error } = await supabase.from('ct_caminhoes').insert({
      concretagem_id: concretagem.id,
      fornecedor: fFornecedor.trim(),
      nf: fNf.trim(),
      numero_amostra: fAmostra.trim(),
      numero_lacre: fLacre.trim(),
      volume_m3: Number(fVolume),
      slump_solicitado_cm: fSlumpSolicitado ? Number(fSlumpSolicitado) : null,
      slump_tolerancia_cm: fSlumpTolerancia ? Number(fSlumpTolerancia) : null,
      slump_medido_cm: fSlumpMedido ? Number(fSlumpMedido) : null,
      hora_saida_usina: horaOuNulo(fHoraSaida, concretagem.data),
      hora_chegada_obra: horaOuNulo(fHoraChegada, concretagem.data),
      hora_inicio_descarga: horaOuNulo(fHoraInicioDescarga, concretagem.data),
      hora_fim_descarga: horaOuNulo(fHoraFimDescarga, concretagem.data),
      cor: fCor,
    })
    setSalvandoCaminhao(false)
    if (error) {
      setMsgCaminhao({ tipo: 'erro', texto: `Erro ao lançar caminhão: ${error.message}` })
      return
    }
    setFFornecedor(''); setFNf(''); setFAmostra(''); setFLacre(''); setFVolume('')
    setFSlumpSolicitado(''); setFSlumpTolerancia(''); setFSlumpMedido('')
    setFHoraSaida(''); setFHoraChegada(''); setFHoraInicioDescarga(''); setFHoraFimDescarga('')
    setFCor('#C49A7A')
    setMostrarFormCaminhao(false)
    carregarCaminhoes(concretagem.id)
  }

  async function finalizarConcretagem() {
    if (!concretagem) return
    setFinalizando(true)
    const { error } = await supabase.from('ct_concretagens').update({
      status: 'finalizada', finalizada_por: perfil?.id, finalizada_em: new Date().toISOString(),
    }).eq('id', concretagem.id)
    setFinalizando(false)
    if (error) { setMsgCaminhao({ tipo: 'erro', texto: `Erro ao finalizar: ${error.message}` }); return }
    setConcretagem(prev => prev ? { ...prev, status: 'finalizada' } : prev)
  }

  async function enviarLaudo(caminhao: CtCaminhao) {
    if (!arquivoLaudo || !obraAtiva) return
    setEnviandoLaudo(true)
    const path = `${obraAtiva.id}/${crypto.randomUUID()}-${nomeArquivoStorage(arquivoLaudo.name)}`
    const { error: eUp } = await supabase.storage.from('controle-tecnologico').upload(path, arquivoLaudo)
    if (eUp) {
      setEnviandoLaudo(false)
      setMsgCaminhao({ tipo: 'erro', texto: `Falha no envio do laudo: ${eUp.message}` })
      return
    }
    const { error } = await supabase.from('ct_caminhoes').update({
      laudo_url: path, laudo_anexado_em: new Date().toISOString(),
    }).eq('id', caminhao.id)
    setEnviandoLaudo(false)
    if (error) {
      setMsgCaminhao({ tipo: 'erro', texto: `Falha ao registrar o laudo: ${error.message}` })
      return
    }
    setArquivoLaudo(null)
    if (concretagem) carregarCaminhoes(concretagem.id)
  }

  async function validarLaudo(caminhao: CtCaminhao, aprovado: boolean) {
    const { error } = await supabase.from('ct_caminhoes').update({
      status_laudo: aprovado ? 'aprovado' : 'reprovado',
      validado_por: perfil?.id, validado_em: new Date().toISOString(),
    }).eq('id', caminhao.id)
    if (error) {
      setMsgCaminhao({ tipo: 'erro', texto: `Falha ao validar: ${error.message}` })
      return
    }
    setCaminhaoLaudoId(null)
    if (concretagem) carregarCaminhoes(concretagem.id)
  }

  async function imprimir() {
    if (!concretagem || !obraAtiva) return
    const { gerarPdfConcretagem } = await import('../lib/controleTecnologicoPdf')
    const { data: obraRow } = await supabase.from('obras')
      .select('nome, logo_url, rodape_pdf').eq('id', obraAtiva.id).maybeSingle()
    const { carregarIdentidadeObra } = await import('../lib/pdfBranding')
    const identidade = await carregarIdentidadeObra(obraRow)
    const nomeUnidadeAtual = unidades.find(u => u.id === concretagem.unidade_id)?.nome ?? '—'
    gerarPdfConcretagem({
      concretagem, caminhoes, identidade,
      obraNome: obraRow?.nome ?? '—',
      unidadeNome: nomeUnidadeAtual,
    })
  }

  async function criar() {
    if (!obraAtiva) return
    if (!unidadeId) { setMsg({ tipo: 'erro', texto: 'Selecione a Unidade.' }); return }
    if (!arquivo) { setMsg({ tipo: 'erro', texto: 'Anexe a foto ou o PDF do mapa de concretagem.' }); return }
    setSalvando(true)
    setMsg(null)
    const path = `${obraAtiva.id}/${crypto.randomUUID()}-${nomeArquivoStorage(arquivo.name)}`
    const { error: eUp } = await supabase.storage.from('controle-tecnologico').upload(path, arquivo)
    if (eUp) {
      setSalvando(false)
      setMsg({ tipo: 'erro', texto: `Falha no envio do arquivo: ${eUp.message}` })
      return
    }
    const { data: nova_, error } = await supabase.from('ct_concretagens').insert({
      obra_id: obraAtiva.id,
      unidade_id: unidadeId,
      anexo_url: path,
      data,
    }).select().single()
    setSalvando(false)
    if (error || !nova_) {
      setMsg({ tipo: 'erro', texto: `Erro ao criar concretagem: ${error?.message}` })
      return
    }
    navigate(`/controle-tecnologico/${nova_.id}`, { replace: true })
  }

  if (perfil?.papel === 'cliente') {
    return <div className={styles.page}><p className={styles.vazio}>Módulo de uso interno da equipe.</p></div>
  }
  if (nova && !podeEditar) {
    return <div className={styles.page}><p className={styles.vazio}>Você não tem permissão para criar concretagens.</p></div>
  }

  if (nova) {
    return (
      <div className={styles.page}>
        <button className={styles.voltar} onClick={() => navigate('/controle-tecnologico')}>← Controle Tecnológico</button>
        <h1>Nova concretagem</h1>
        <div className={styles.bloco}>
          <label className={styles.campo}>
            Unidade *
            <select value={unidadeId} onChange={e => setUnidadeId(e.target.value)}>
              <option value="">Selecione…</option>
              {unidades.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}
            </select>
          </label>
          <label className={styles.campo}>
            Data *
            <input type="date" value={data} onChange={e => setData(e.target.value)} />
          </label>
          <label className={styles.campo}>
            Mapa de concretagem — foto ou PDF já marcado *
            <input type="file" accept="application/pdf,image/*" onChange={e => setArquivo(e.target.files?.[0] ?? null)} />
          </label>
        </div>
        {msg && <p className={msg.tipo === 'ok' ? styles.msgOk : styles.msgErro}>{msg.texto}</p>}
        <button className={styles.btnPrincipal} onClick={criar} disabled={salvando}>
          {salvando ? 'Criando…' : 'Criar concretagem'}
        </button>
      </div>
    )
  }

  if (carregando) return <div className={styles.page}><p className={styles.vazio}>Carregando…</p></div>
  if (!concretagem) return <div className={styles.page}><p className={styles.vazio}>Concretagem não encontrada.</p></div>

  return (
    <div className={styles.page}>
      <button className={styles.voltar} onClick={() => navigate('/controle-tecnologico')}>← Controle Tecnológico</button>
      <div className={styles.header}>
        <h1>{concretagem.data.slice(8, 10)}/{concretagem.data.slice(5, 7)}/{concretagem.data.slice(0, 4)}</h1>
        <span className={styles.chip}>{STATUS_CONCRETAGEM_LABEL[concretagem.status]}</span>
      </div>
      <div className={styles.bloco}>
        <div className={styles.header} style={{ marginBottom: 10 }}>
          <h2 style={{ margin: 0, fontSize: 14, color: 'var(--navy)' }}>Caminhões</h2>
          {podeEditar && concretagem.status === 'aberta' && (
            <button className={styles.btnSecundario} onClick={() => setMostrarFormCaminhao(v => !v)}>
              {mostrarFormCaminhao ? 'Cancelar' : '+ Lançar caminhão'}
            </button>
          )}
        </div>

        {mostrarFormCaminhao && (
          <div className={styles.formCaminhao}>
            <label className={styles.campo}>Fornecedor (usina) *
              <input value={fFornecedor} onChange={e => setFFornecedor(e.target.value)} /></label>
            <label className={styles.campo}>NF *
              <input value={fNf} onChange={e => setFNf(e.target.value)} /></label>
            <label className={styles.campo}>Nº da amostra (laboratório) *
              <input value={fAmostra} onChange={e => setFAmostra(e.target.value)} /></label>
            <label className={styles.campo}>Número do lacre (betoneira) *
              <input value={fLacre} onChange={e => setFLacre(e.target.value)} /></label>
            <label className={styles.campo}>Volume (m³) *
              <input type="number" min="0" step="0.1" value={fVolume} onChange={e => setFVolume(e.target.value)} /></label>
            <div className={styles.parCampos}>
              <label className={styles.campo}>Slump nominal (cm)
                <input type="number" min="0" step="0.5" value={fSlumpSolicitado} onChange={e => setFSlumpSolicitado(e.target.value)} /></label>
              <label className={styles.campo}>Tolerância (± cm)
                <input type="number" min="0" step="0.5" value={fSlumpTolerancia} onChange={e => setFSlumpTolerancia(e.target.value)} /></label>
            </div>
            <label className={styles.campo}>Slump medido (cm)
              <input type="number" min="0" step="0.5" value={fSlumpMedido} onChange={e => setFSlumpMedido(e.target.value)} /></label>
            <label className={styles.campo}>Saída da usina
              <input type="time" value={fHoraSaida} onChange={e => setFHoraSaida(e.target.value)} /></label>
            <label className={styles.campo}>Chegada na obra
              <input type="time" value={fHoraChegada} onChange={e => setFHoraChegada(e.target.value)} /></label>
            <label className={styles.campo}>Início da descarga
              <input type="time" value={fHoraInicioDescarga} onChange={e => setFHoraInicioDescarga(e.target.value)} /></label>
            <label className={styles.campo}>Fim da descarga
              <input type="time" value={fHoraFimDescarga} onChange={e => setFHoraFimDescarga(e.target.value)} /></label>
            <label className={styles.campo}>Cor (legenda)
              <input type="color" value={fCor} onChange={e => setFCor(e.target.value)} /></label>
            {msgCaminhao && <p className={msgCaminhao.tipo === 'ok' ? styles.msgOk : styles.msgErro}>{msgCaminhao.texto}</p>}
            <button className={styles.btnPrincipal} onClick={lancarCaminhao} disabled={salvandoCaminhao}>
              {salvandoCaminhao ? 'Salvando…' : 'Lançar caminhão'}
            </button>
          </div>
        )}

        {caminhoes.length === 0 && !mostrarFormCaminhao && <p className={styles.vazio}>Nenhum caminhão lançado.</p>}
        {caminhoes.map(c => (
          <div key={c.id} className={styles.caminhaoItem}>
            <span className={styles.caminhaoCor} style={{ background: c.cor }} />
            <div className={styles.caminhaoInfo}>
              <strong>{c.fornecedor}</strong> — NF {c.nf} · Amostra {c.numero_amostra} · Lacre {c.numero_lacre} · {c.volume_m3} m³
              <div className={styles.caminhaoDetalhe}>
                Slump: {fmtSlumpSolicitado(c.slump_solicitado_cm, c.slump_tolerancia_cm)} cm (solicitado) / {c.slump_medido_cm ?? '—'} cm (medido)
              </div>
              <div className={styles.caminhaoDetalhe}>
                Saída {fmtHoraCurta(c.hora_saida_usina)} · Chegada {fmtHoraCurta(c.hora_chegada_obra)} · Início desc. {fmtHoraCurta(c.hora_inicio_descarga)} · Fim desc. {fmtHoraCurta(c.hora_fim_descarga)}
              </div>
              <div className={`${styles.caminhaoMeta} ${styles[`laudo_${c.status_laudo}`]}`}>
                Laudo: {c.status_laudo}
                {c.laudo_url && urlsLaudo.get(c.laudo_url) && (
                  <> · <a className={styles.anexoLink} href={urlsLaudo.get(c.laudo_url)} target="_blank" rel="noreferrer">📎 ver laudo</a></>
                )}
              </div>
              {perfil?.papel === 'admin' && c.status_laudo === 'pendente' && (
                caminhaoLaudoId === c.id ? (
                  <div className={styles.laudoForm}>
                    <input type="file" accept="application/pdf,image/*" onChange={e => setArquivoLaudo(e.target.files?.[0] ?? null)} />
                    <button className={styles.btnSecundario} onClick={() => enviarLaudo(c)} disabled={enviandoLaudo || !arquivoLaudo}>
                      {enviandoLaudo ? 'Enviando…' : 'Anexar laudo'}
                    </button>
                  </div>
                ) : (
                  <button className={styles.btnSecundario} onClick={() => setCaminhaoLaudoId(c.id)}>Anexar laudo</button>
                )
              )}
              {perfil?.papel === 'admin' && c.status_laudo === 'pendente' && c.laudo_url && (
                <div className={styles.laudoForm}>
                  <button className={styles.btnPrincipal} onClick={() => validarLaudo(c, true)}>Aprovar</button>
                  <button className={styles.btnPerigo} onClick={() => validarLaudo(c, false)}>Reprovar</button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {concretagem.status === 'aberta' && podeEditar && (
        <div className={styles.bloco}>
          <button className={styles.btnPrincipal} onClick={finalizarConcretagem} disabled={finalizando || caminhoes.length === 0}>
            {finalizando ? 'Finalizando…' : 'Finalizar concretagem'}
          </button>
        </div>
      )}

      {concretagem.status === 'finalizada' && (
        <div className={styles.bloco}>
          <button className={styles.btnSecundario} onClick={imprimir}>🖨️ Imprimir PDF</button>
        </div>
      )}
    </div>
  )
}
