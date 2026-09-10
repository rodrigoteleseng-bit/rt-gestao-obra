import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useObra } from '../contexts/ObraContext'
import { supabase, type CtPlanta } from '../lib/supabase'
import styles from './ControleTecnologicoPlantas.module.css'

function nomeArquivoStorage(nome: string): string {
  const partes = nome.split('.')
  const extensao = partes.length > 1 ? `.${partes.pop()}` : ''
  const base = (partes.join('.') || 'arquivo')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 80) || 'arquivo'
  const extLimpa = extensao
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9.]/g, '')
    .slice(0, 16)
  return `${base}${extLimpa}`.toLowerCase()
}

export default function ControleTecnologicoPlantas() {
  const { perfil, temModulo } = useAuth()
  const { obraAtiva } = useObra()
  const navigate = useNavigate()
  const podeEditar = perfil?.papel === 'admin' || temModulo('controle_tecnologico')

  const [plantas, setPlantas] = useState<CtPlanta[]>([])
  const [carregando, setCarregando] = useState(true)
  const [nome, setNome] = useState('')
  const [reutilizavel, setReutilizavel] = useState(false)
  const [arquivo, setArquivo] = useState<File | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)

  useEffect(() => { carregar() }, [obraAtiva])

  function carregar() {
    if (!obraAtiva) return
    setCarregando(true)
    supabase.from('ct_plantas').select('*').eq('obra_id', obraAtiva.id).eq('ativo', true).order('nome')
      .then(({ data }) => { setPlantas(data ?? []); setCarregando(false) })
  }

  async function criar() {
    if (!obraAtiva) return
    if (!nome.trim()) { setMsg({ tipo: 'erro', texto: 'Informe o nome da planta.' }); return }
    if (!arquivo) { setMsg({ tipo: 'erro', texto: 'Selecione o PDF da planta.' }); return }
    setSalvando(true)
    setMsg(null)
    const { converterPdfParaImagem } = await import('../lib/pdfParaImagem')
    let imagemBlob: Blob
    try {
      imagemBlob = await converterPdfParaImagem(arquivo)
    } catch (e) {
      setSalvando(false)
      setMsg({ tipo: 'erro', texto: e instanceof Error ? e.message : 'Falha ao converter o PDF.' })
      return
    }
    const base = `${obraAtiva.id}/${crypto.randomUUID()}-${nomeArquivoStorage(arquivo.name)}`
    const pdfPath = `${base}.pdf`
    const imagemPath = `${base}.png`
    const [upPdf, upImg] = await Promise.all([
      supabase.storage.from('controle-tecnologico').upload(pdfPath, arquivo),
      supabase.storage.from('controle-tecnologico').upload(imagemPath, imagemBlob),
    ])
    if (upPdf.error || upImg.error) {
      setSalvando(false)
      setMsg({ tipo: 'erro', texto: `Falha no envio: ${upPdf.error?.message ?? upImg.error?.message}` })
      return
    }
    const { error } = await supabase.from('ct_plantas').insert({
      obra_id: obraAtiva.id, nome: nome.trim(), reutilizavel, pdf_path: pdfPath, imagem_path: imagemPath,
    })
    setSalvando(false)
    if (error) {
      setMsg({ tipo: 'erro', texto: `Erro ao cadastrar: ${error.message}` })
      return
    }
    setNome(''); setReutilizavel(false); setArquivo(null)
    setMsg({ tipo: 'ok', texto: 'Planta cadastrada.' })
    carregar()
  }

  async function inativar(planta: CtPlanta) {
    const { error } = await supabase.from('ct_plantas').update({ ativo: false }).eq('id', planta.id)
    if (error) { setMsg({ tipo: 'erro', texto: `Erro ao inativar: ${error.message}` }); return }
    carregar()
  }

  if (perfil?.papel === 'cliente') {
    return <div className={styles.page}><p className={styles.vazio}>Módulo de uso interno da equipe.</p></div>
  }

  return (
    <div className={styles.page}>
      <button className={styles.voltar} onClick={() => navigate('/controle-tecnologico')}>← Controle Tecnológico</button>
      <h1>Plantas</h1>
      <p className={styles.sub}>Catálogo de plantas pra pintar direto no app.</p>

      {podeEditar && (
        <div className={styles.bloco}>
          <div className={styles.campos}>
            <label className={styles.campo}>
              Nome *
              <input value={nome} onChange={e => setNome(e.target.value)} placeholder="Ex.: Laje Térreo" />
            </label>
            <label className={styles.campo}>
              PDF da planta *
              <input type="file" accept="application/pdf" onChange={e => setArquivo(e.target.files?.[0] ?? null)} />
            </label>
            <label className={styles.checkReutilizavel}>
              <input type="checkbox" checked={reutilizavel} onChange={e => setReutilizavel(e.target.checked)} />
              Reutilizável (pede identificação do pavimento a cada uso)
            </label>
          </div>
          {msg && <p className={msg.tipo === 'ok' ? styles.msgOk : styles.msgErro}>{msg.texto}</p>}
          <button className={styles.btnPrincipal} onClick={criar} disabled={salvando} style={{ marginTop: 12 }}>
            {salvando ? 'Enviando…' : '+ Cadastrar planta'}
          </button>
        </div>
      )}

      {carregando && <p className={styles.vazio}>Carregando…</p>}
      {!carregando && plantas.length === 0 && <p className={styles.vazio}>Nenhuma planta cadastrada.</p>}
      {plantas.map(p => (
        <div key={p.id} className={styles.card}>
          <div className={styles.cardTopo}>
            <div className={styles.cardNome}>{p.nome}</div>
            {podeEditar && <button className={styles.btnInativar} onClick={() => inativar(p)}>Inativar</button>}
          </div>
          {p.reutilizavel && <div className={styles.cardMeta}>♻️ Reutilizável</div>}
        </div>
      ))}
    </div>
  )
}
