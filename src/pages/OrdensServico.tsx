import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useObra } from '../contexts/ObraContext'
import { supabase, type Fornecedor, type OrdemServico, type Servico } from '../lib/supabase'
import { formatarMoeda } from '../lib/formato'
import { carregarIdentidadeObra, larguraProporcional } from '../lib/pdfBranding'
import styles from './Fornecedores.module.css'

const hoje = () => new Date().toISOString().slice(0, 10)

export default function OrdensServico() {
  const { perfil, temModulo } = useAuth()
  const { obraAtiva } = useObra()
  const navigate = useNavigate()
  const podeEditar = perfil?.papel === 'admin' || temModulo('compras')
  const [ordens, setOrdens] = useState<OrdemServico[]>([])
  const [modo, setModo] = useState<'escolha' | 'orcamento' | 'ordem'>('escolha')
  const [fornecedores, setFornecedores] = useState<Fornecedor[]>([])
  const [servicos, setServicos] = useState<Servico[]>([])
  const [fornecedorId, setFornecedorId] = useState('')
  const [servicoId, setServicoId] = useState('')
  const [buscaServico, setBuscaServico] = useState('')
  const [mostrarSugestoes, setMostrarSugestoes] = useState(false)
  const [descricao, setDescricao] = useState('')
  const [valor, setValor] = useState('')
  const [vencimento, setVencimento] = useState('')
  const [executado, setExecutado] = useState(false)
  const [dataExecucao, setDataExecucao] = useState(hoje())
  const [justificativa, setJustificativa] = useState('')
  const [arquivo, setArquivo] = useState<File | null>(null)
  const [msg, setMsg] = useState('')
  const [salvando, setSalvando] = useState(false)

  async function carregar() {
    if (!obraAtiva) return
    const [{ data: os }, { data: forn }, { data: srv }] = await Promise.all([
      supabase.from('ordens_servico').select('*').eq('obra_id', obraAtiva.id).eq('ativo', true).order('numero', { ascending: false }),
      supabase.from('fornecedores').select('*').eq('ativo', true).order('nome'),
      supabase.from('servicos').select('*').eq('ativo', true).order('codigo'),
    ])
    setOrdens(os ?? [])
    setFornecedores(forn ?? [])
    setServicos(srv ?? [])
  }
  useEffect(() => { void carregar() }, [obraAtiva])

  const sugestoesServico = servicos.filter(s => `${s.codigo ?? ''} ${s.nome}`.toLowerCase().includes(buscaServico.trim().toLowerCase())).slice(0, 12)

  function selecionarServico(s: Servico) {
    setServicoId(s.id)
    setBuscaServico(`${s.codigo ? `${s.codigo} — ` : ''}${s.nome}`)
    setMostrarSugestoes(false)
  }

  async function criar() {
    if (!obraAtiva || !fornecedorId || !descricao.trim() || !valor || (executado && !justificativa.trim())) {
      setMsg('Informe fornecedor, descrição, valor e, se já executado, a justificativa.')
      return
    }
    setSalvando(true)
    setMsg('')
    const { data: ordem, error } = await supabase.from('ordens_servico').insert({
      obra_id: obraAtiva.id,
      tipo: 'ordem_compra',
      fornecedor_id: fornecedorId,
      servico_id: servicoId || null,
      descricao: descricao.trim(),
      valor: Number(valor),
      data_vencimento: vencimento || null,
      servico_ja_executado: executado,
      data_execucao: executado ? dataExecucao : null,
      justificativa_regularizacao: executado ? justificativa.trim() : null,
      status: executado ? 'executada' : 'emitida',
    }).select().single()
    if (error || !ordem) {
      setMsg(`Erro ao emitir: ${error?.message ?? 'sem retorno'}`)
      setSalvando(false)
      return
    }
    if (arquivo) {
      const nomeSeguro = arquivo.name.replace(/[^a-zA-Z0-9._-]/g, '-')
      const path = `${obraAtiva.id}/${ordem.id}/${nomeSeguro}`
      const upload = await supabase.storage.from('ordens-servico').upload(path, arquivo)
      if (upload.error) setMsg(`OS emitida, mas o anexo não foi enviado: ${upload.error.message}`)
      else await supabase.from('ordem_servico_documentos').insert({ ordem_servico_id: ordem.id, tipo: 'nota_fiscal', path, nome_original: arquivo.name })
    }
    setFornecedorId(''); setServicoId(''); setBuscaServico(''); setDescricao(''); setValor(''); setVencimento(''); setExecutado(false); setJustificativa(''); setArquivo(null)
    setMsg(`OS-${String(ordem.numero).padStart(3, '0')} emitida e enviada ao Financeiro como conta a pagar.`)
    setSalvando(false)
    void carregar()
  }

  async function solicitarOrcamento() {
    if (!obraAtiva || !descricao.trim()) {
      setMsg('Descreva o serviço que deseja cotar.')
      return
    }
    setSalvando(true)
    setMsg('')
    const { data: pedido, error } = await supabase.from('ordens_servico').insert({
      obra_id: obraAtiva.id,
      tipo: 'orcamento',
      fornecedor_id: null,
      servico_id: servicoId || null,
      descricao: descricao.trim(),
      valor: null,
      data_vencimento: null,
      servico_ja_executado: false,
      data_execucao: null,
      justificativa_regularizacao: null,
      status: 'emitida',
    }).select().single()
    if (error || !pedido) {
      setMsg(`Erro ao enviar para orçamento: ${error?.message ?? 'sem retorno'}`)
      setSalvando(false)
      return
    }
    setDescricao('')
    setBuscaServico('')
    setServicoId('')
    setMsg(`Solicitação OS-${String(pedido.numero).padStart(3, '0')} enviada ao departamento de compras para cotação.`)
    setSalvando(false)
    void carregar()
  }

  async function baixarPdf(ordem: OrdemServico) {
    if (!obraAtiva) return
    const [{ jsPDF }, { data: obra }, identidade] = await Promise.all([
      import('jspdf'),
      supabase.from('obras').select('nome, nome_empreendimento, endereco, cidade, estado').eq('id', ordem.obra_id).maybeSingle(),
      carregarIdentidadeObra(obraAtiva),
    ])
    const fornecedor = fornecedores.find(f => f.id === ordem.fornecedor_id)
    const pdf = new jsPDF({ unit: 'mm', format: 'a4' })
    const largura = 210
    const margem = 16
    pdf.setFillColor('#1A3248'); pdf.rect(0, 0, largura, 34, 'F')
    pdf.setFillColor('#C49A7A'); pdf.rect(0, 34, largura, 1.5, 'F')
    if (identidade.logoBase64) {
      const h = 23
      pdf.addImage(identidade.logoBase64, 'PNG', margem, 5, larguraProporcional(pdf, identidade.logoBase64, h), h)
    } else {
      pdf.setTextColor('#ffffff'); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(17); pdf.text('RT ENGENHARIA', margem, 15)
      pdf.setTextColor('#B8D4E8'); pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8.5); pdf.text('Inteligência Aplicada', margem, 21)
    }
    pdf.setTextColor('#ffffff'); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(11); pdf.text(ordem.tipo === 'orcamento' ? 'SOLICITAÇÃO DE ORÇAMENTO' : 'PEDIDO DE SERVIÇO', largura - margem, 13, { align: 'right' })
    pdf.setTextColor('#D0AE95'); pdf.setFontSize(12); pdf.text(`OS-${String(ordem.numero).padStart(3, '0')}`, largura - margem, 22, { align: 'right' })
    let y = 47
    const tituloObra = obra?.nome_empreendimento ? `${obra.nome} — ${obra.nome_empreendimento}` : (obra?.nome ?? obraAtiva.nome)
    pdf.setTextColor('#1A3248'); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(14); pdf.text(tituloObra, margem, y); y += 8
    const endereco = [obra?.endereco, [obra?.cidade, obra?.estado].filter(Boolean).join(' - ')].filter(Boolean).join(', ')
    if (endereco) {
      pdf.setTextColor('#6c757d'); pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); pdf.text(endereco, margem, y); y += 8
    }
    pdf.setDrawColor('#E0DAD0'); pdf.line(margem, y, largura - margem, y); y += 9
    const campo = (rotulo: string, valorCampo: string) => {
      if (y > 265) { pdf.addPage(); y = 20 }
      pdf.setFont('helvetica', 'bold'); pdf.setTextColor('#6c757d'); pdf.setFontSize(9); pdf.text(rotulo.toUpperCase(), margem, y)
      y += 5; pdf.setFont('helvetica', 'normal'); pdf.setTextColor('#222222'); pdf.setFontSize(11)
      const linhas = pdf.splitTextToSize(valorCampo || '—', largura - margem * 2) as string[]
      pdf.text(linhas, margem, y); y += linhas.length * 5 + 5
    }
    if (ordem.tipo === 'ordem_compra') {
      campo('Fornecedor', fornecedor?.nome ?? 'Fornecedor')
      if (fornecedor?.telefone) campo('Telefone', fornecedor.telefone)
      if (fornecedor?.email) campo('E-mail', fornecedor.email)
    }
    campo('Serviço / escopo', ordem.descricao)
    const servico = servicos.find(s => s.id === ordem.servico_id)
    campo('Referência do orçamento', servico ? `${servico.codigo ? `${servico.codigo} — ` : ''}${servico.nome}` : 'A classificar')
    if (ordem.tipo === 'ordem_compra') {
      campo('Valor contratado', ordem.valor === null ? '—' : `R$ ${formatarMoeda(ordem.valor)}`)
      campo('Data prevista para pagamento', ordem.data_vencimento ? ordem.data_vencimento.split('-').reverse().join('/') : 'A definir')
    }
    if (ordem.tipo === 'ordem_compra' && ordem.servico_ja_executado) {
      campo('Data de execução', ordem.data_execucao ? ordem.data_execucao.split('-').reverse().join('/') : '—')
      campo('Regularização', ordem.justificativa_regularizacao ?? '')
    }
    pdf.setDrawColor('#C49A7A'); pdf.line(margem, 280, largura - margem, 280)
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(7.5); pdf.setTextColor('#6c757d'); pdf.text(identidade.rodapeTexto, margem, 286)
    pdf.save(`OS-${String(ordem.numero).padStart(3, '0')} - ${tituloObra}.pdf`)
  }

  if (perfil?.papel === 'cliente') return <div className={styles.page}><p className={styles.vazio}>Módulo de uso interno da equipe.</p></div>
  return <div className={styles.page}>
    <button className={styles.voltar} onClick={() => navigate('/compras')}>← Compras</button>
    <h1>Pedido de Serviço</h1>
    <p className={styles.sub}>Escolha se o Compras deve cotar o serviço ou se a negociação já está definida.</p>
    {podeEditar && modo === 'escolha' && <div className={styles.bloco}>
      <h2>Como deseja seguir?</h2>
      <div className={styles.linha}>
        <button className={styles.btnSecundario} onClick={() => setModo('orcamento')}>Orçar serviço</button>
        <button className={styles.btnPrincipal} onClick={() => setModo('ordem')}>Gerar ordem de compra do serviço</button>
      </div>
      <p className={styles.sub}>Para orçamento, informe apenas o serviço desejado. Para ordem direta, informe fornecedor e valor negociado.</p>
    </div>}
    {podeEditar && modo === 'orcamento' && <div className={styles.bloco}>
      <button className={styles.voltar} onClick={() => setModo('escolha')}>← Voltar às opções</button>
      <h2>Solicitar orçamento de serviço</h2>
      <p className={styles.sub}>Informe o serviço desejado. Não é necessário escolher fornecedor nem informar valor.</p>
      <div className={styles.campos}>
        <label className={styles.campo}>Descrição do serviço a cotar *<textarea value={descricao} onChange={e => setDescricao(e.target.value)} rows={4} placeholder="Descreva o serviço que o departamento de compras deve cotar…" /></label>
        <label className={styles.campo}>Referência no orçamento (opcional)
          <input value={buscaServico} onChange={e => { setBuscaServico(e.target.value); setServicoId(''); setMostrarSugestoes(true) }} onFocus={() => setMostrarSugestoes(true)} onBlur={() => setTimeout(() => setMostrarSugestoes(false), 150)} placeholder="Digite o código ou nome do item" />
          {mostrarSugestoes && buscaServico.trim() && <div className={styles.sugestoes}>{sugestoesServico.map(s => <button type="button" key={s.id} onMouseDown={() => selecionarServico(s)}>{s.codigo ? `${s.codigo} — ` : ''}{s.nome}</button>)}</div>}
        </label>
      </div>
      {msg && <p className={styles.msgErro}>{msg}</p>}
      <button className={styles.btnPrincipal} onClick={() => void solicitarOrcamento()} disabled={salvando}>{salvando ? 'Enviando…' : 'Enviar para cotação'}</button>
    </div>}
    {podeEditar && modo === 'ordem' && <div className={styles.bloco}>
      <button className={styles.voltar} onClick={() => setModo('escolha')}>← Voltar às opções</button>
      <h2>Gerar ordem de compra do serviço</h2>
      <div className={styles.campos}>
        <label className={styles.campo}>Fornecedor *<select value={fornecedorId} onChange={e => setFornecedorId(e.target.value)}><option value="">Selecione…</option>{fornecedores.map(f => <option key={f.id} value={f.id}>{f.nome} — {f.telefone || f.contato || 'sem telefone'}{f.email ? ` · ${f.email}` : ''}</option>)}</select></label>
        <label className={styles.campo}>Item do orçamento
          <input value={buscaServico} onChange={e => { setBuscaServico(e.target.value); setServicoId(''); setMostrarSugestoes(true) }} onFocus={() => setMostrarSugestoes(true)} onBlur={() => setTimeout(() => setMostrarSugestoes(false), 150)} placeholder="Comece pelo código ou nome do item" />
          {mostrarSugestoes && buscaServico.trim() && <div className={styles.sugestoes}>{sugestoesServico.map(s => <button type="button" key={s.id} onMouseDown={() => selecionarServico(s)}>{s.codigo ? `${s.codigo} — ` : ''}{s.nome}</button>)}</div>}
          {!servicoId && <small>A classificação é opcional; sem seleção, irá para “a classificar”.</small>}
        </label>
        <label className={styles.campo}>Descrição / escopo do serviço *<textarea value={descricao} onChange={e => setDescricao(e.target.value)} rows={4} placeholder="Ex.: levantamento topográfico planialtimétrico…" /></label>
        <div className={styles.linha}><label className={styles.campo}>Valor contratado (R$) *<input type="number" min="0.01" step="0.01" value={valor} onChange={e => setValor(e.target.value)} /></label><label className={styles.campo}>Data prevista de pagamento<input type="date" value={vencimento} onChange={e => setVencimento(e.target.value)} /></label></div>
        <label className={styles.campo}><input type="checkbox" checked={executado} onChange={e => setExecutado(e.target.checked)} /> Serviço já executado</label>
        {executado && <><label className={styles.campo}>Data real de execução *<input type="date" value={dataExecucao} onChange={e => setDataExecucao(e.target.value)} /></label><label className={styles.campo}>Justificativa da regularização *<textarea value={justificativa} onChange={e => setJustificativa(e.target.value)} rows={2} /></label></>}
        <label className={styles.campo}>NF, recibo ou documento recebido<input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={e => setArquivo(e.target.files?.[0] ?? null)} /></label>
      </div>
      {msg && <p className={styles.msgOk}>{msg}</p>}<button className={styles.btnPrincipal} onClick={criar} disabled={salvando}>{salvando ? 'Emitindo…' : 'Emitir Pedido de Serviço'}</button>
    </div>}
    {ordens.map(o => <div className={styles.card} key={o.id}>
      <div className={styles.cardNome}>OS-{String(o.numero).padStart(3, '0')} — {o.tipo === 'orcamento' ? 'Aguardando cotação' : `R$ ${formatarMoeda(o.valor ?? 0)}`}</div>
      <div className={styles.cardMeta}><span>{o.descricao}</span><span>{o.tipo === 'orcamento' ? 'Solicitação para o departamento de compras' : o.status === 'executada' ? `Executado em ${o.data_execucao}` : 'Ordem emitida'}</span>{o.data_vencimento && <span>Pagamento: {o.data_vencimento}</span>}</div>
      <button type="button" className={styles.btnPrincipal} onClick={() => void baixarPdf(o)}>Baixar PDF</button>
    </div>)}
  </div>
}
