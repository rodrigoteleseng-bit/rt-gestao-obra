import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useObra } from '../contexts/ObraContext'
import { supabase, type Fornecedor, type OrdemServico, type Servico } from '../lib/supabase'
import { formatarMoeda } from '../lib/formato'
import styles from './Fornecedores.module.css'

const hoje = () => new Date().toISOString().slice(0, 10)

export default function OrdensServico() {
  const { perfil, temModulo } = useAuth()
  const { obraAtiva } = useObra()
  const navigate = useNavigate()
  const podeEditar = perfil?.papel === 'admin' || temModulo('compras')
  const [ordens, setOrdens] = useState<OrdemServico[]>([])
  const [fornecedores, setFornecedores] = useState<Fornecedor[]>([])
  const [servicos, setServicos] = useState<Servico[]>([])
  const [fornecedorId, setFornecedorId] = useState('')
  const [servicoId, setServicoId] = useState('')
  const [descricao, setDescricao] = useState('')
  const [valor, setValor] = useState('')
  const [vencimento, setVencimento] = useState('')
  const [executado, setExecutado] = useState(false)
  const [dataExecucao, setDataExecucao] = useState(hoje())
  const [justificativa, setJustificativa] = useState('')
  const [arquivo, setArquivo] = useState<File | null>(null)
  const [msg, setMsg] = useState('')
  const [salvando, setSalvando] = useState(false)

  const carregar = async () => {
    if (!obraAtiva) return
    const [{ data: os }, { data: forn }, { data: srv }] = await Promise.all([
      supabase.from('ordens_servico').select('*').eq('obra_id', obraAtiva.id).eq('ativo', true).order('numero', { ascending: false }),
      supabase.from('fornecedores').select('*').eq('ativo', true).order('nome'),
      supabase.from('servicos').select('*').eq('ativo', true).order('codigo'),
    ])
    setOrdens(os ?? []); setFornecedores(forn ?? []); setServicos(srv ?? [])
  }
  useEffect(() => { carregar() }, [obraAtiva])

  async function criar() {
    if (!obraAtiva || !fornecedorId || !descricao.trim() || !valor || (executado && !justificativa.trim())) {
      setMsg('Informe fornecedor, descrição, valor e, para serviço já executado, a justificativa.')
      return
    }
    setSalvando(true); setMsg('')
    const { data: ordem, error } = await supabase.from('ordens_servico').insert({
      obra_id: obraAtiva.id, fornecedor_id: fornecedorId, servico_id: servicoId || null,
      descricao: descricao.trim(), valor: Number(valor), data_vencimento: vencimento || null,
      servico_ja_executado: executado, data_execucao: executado ? dataExecucao : null,
      justificativa_regularizacao: executado ? justificativa.trim() : null,
      status: executado ? 'executada' : 'emitida',
    }).select().single()
    if (error || !ordem) { setMsg(`Erro ao emitir: ${error?.message ?? 'sem retorno'}`); setSalvando(false); return }
    if (arquivo) {
      const path = `${obraAtiva.id}/${ordem.id}/${arquivo.name.replace(/[^a-zA-Z0-9._-]/g, '-')}`
      const up = await supabase.storage.from('ordens-servico').upload(path, arquivo)
      if (up.error) setMsg(`OS emitida, mas o anexo não foi enviado: ${up.error.message}`)
      else await supabase.from('ordem_servico_documentos').insert({ ordem_servico_id: ordem.id, tipo: 'nota_fiscal', path, nome_original: arquivo.name })
    }
    setFornecedorId(''); setServicoId(''); setDescricao(''); setValor(''); setVencimento(''); setExecutado(false); setJustificativa(''); setArquivo(null)
    setMsg(`OS-${String(ordem.numero).padStart(3, '0')} emitida e enviada ao Financeiro como conta a pagar.`)
    setSalvando(false); carregar()
  }

  if (perfil?.papel === 'cliente') return <div className={styles.page}><p className={styles.vazio}>Módulo de uso interno da equipe.</p></div>
  return <div className={styles.page}>
    <button className={styles.voltar} onClick={() => navigate('/compras')}>← Compras</button>
    <h1>Pedido de Serviço</h1>
    <p className={styles.sub}>Ordens de serviço (OS) com fornecedor definido e envio automático para o Financeiro.</p>
    {podeEditar && <div className={styles.bloco}>
      <div className={styles.campos}>
        <label className={styles.campo}>Fornecedor *<select value={fornecedorId} onChange={e => setFornecedorId(e.target.value)}><option value="">Selecione…</option>{fornecedores.map(f => <option key={f.id} value={f.id}>{f.nome} — {f.telefone || f.contato || 'sem telefone'}{f.email ? ` · ${f.email}` : ''}</option>)}</select></label>
        <label className={styles.campo}>Item do orçamento <select value={servicoId} onChange={e => setServicoId(e.target.value)}><option value="">A classificar posteriormente</option>{servicos.map(s => <option key={s.id} value={s.id}>{s.codigo ? `${s.codigo} — ` : ''}{s.nome}</option>)}</select></label>
        <label className={styles.campo}>Descrição / escopo do serviço *<textarea value={descricao} onChange={e => setDescricao(e.target.value)} rows={4} placeholder="Ex.: levantamento topográfico planialtimétrico…" /></label>
        <div className={styles.linha}><label className={styles.campo}>Valor contratado (R$) *<input type="number" min="0.01" step="0.01" value={valor} onChange={e => setValor(e.target.value)} /></label><label className={styles.campo}>Data prevista de pagamento<input type="date" value={vencimento} onChange={e => setVencimento(e.target.value)} /></label></div>
        <label className={styles.campo}><input type="checkbox" checked={executado} onChange={e => setExecutado(e.target.checked)} /> Serviço já executado</label>
        {executado && <><label className={styles.campo}>Data real de execução *<input type="date" value={dataExecucao} onChange={e => setDataExecucao(e.target.value)} /></label><label className={styles.campo}>Justificativa da regularização *<textarea value={justificativa} onChange={e => setJustificativa(e.target.value)} rows={2} /></label></>}
        <label className={styles.campo}>NF, recibo ou documento recebido<input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={e => setArquivo(e.target.files?.[0] ?? null)} /></label>
      </div>
      {msg && <p className={styles.msgOk}>{msg}</p>}<button className={styles.btnPrincipal} onClick={criar} disabled={salvando}>{salvando ? 'Emitindo…' : 'Emitir Pedido de Serviço'}</button>
    </div>}
    {ordens.map(o => <div className={styles.card} key={o.id}><div className={styles.cardNome}>OS-{String(o.numero).padStart(3, '0')} — R$ {formatarMoeda(o.valor)}</div><div className={styles.cardMeta}><span>{o.descricao}</span><span>{o.status === 'executada' ? `Executado em ${o.data_execucao}` : 'Emitida'}</span>{o.data_vencimento && <span>Pagamento: {o.data_vencimento}</span>}</div></div>)}
  </div>
}
