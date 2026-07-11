import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useObra } from '../contexts/ObraContext'
import { useAuth } from '../contexts/AuthContext'
import { supabase, type Servico, type PedidoCompra, type PedidoCompraItem, type Cotacao, type CotacaoItem, type Fornecedor, type RecebimentoNf } from '../lib/supabase'
import { STATUS_LABEL } from './Compras'
import styles from './CompraForm.module.css'

interface ItemNovo {
  chave: string
  descricao_item: string
  servico_id: string | null
  servicoCodigo: string
  buscaAplicacao: string
  quantidade_pedida: string
  und: string
  data_necessaria: string
  urgente: boolean
  buscaAberta: boolean
}

function itemVazio(): ItemNovo {
  return {
    chave: crypto.randomUUID(),
    descricao_item: '',
    servico_id: null,
    servicoCodigo: '',
    buscaAplicacao: '',
    quantidade_pedida: '',
    und: '',
    data_necessaria: '',
    urgente: false,
    buscaAberta: false,
  }
}

interface ItemEditavel {
  id: string | null
  chave: string
  descricao_item: string
  servico_id: string | null
  buscaAplicacao: string
  quantidade_pedida: string
  und: string
  data_necessaria: string
  urgente: boolean
  buscaAberta: boolean
  removido: boolean
}

function itemEditVazio(): ItemEditavel {
  return {
    id: null,
    chave: crypto.randomUUID(),
    descricao_item: '',
    servico_id: null,
    buscaAplicacao: '',
    quantidade_pedida: '',
    und: '',
    data_necessaria: '',
    urgente: false,
    buscaAberta: false,
    removido: false,
  }
}

export default function CompraForm() {
  const { id } = useParams()
  const novo = id === 'novo'
  const navigate = useNavigate()
  const { obraAtiva } = useObra()
  const { perfil } = useAuth()

  const [servicos, setServicos] = useState<Servico[]>([])
  const [descricao, setDescricao] = useState('')
  const [itens, setItens] = useState<ItemNovo[]>([itemVazio()])
  const [salvando, setSalvando] = useState(false)
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)

  const [pedido, setPedido] = useState<PedidoCompra | null>(null)
  const [itensPedido, setItensPedido] = useState<PedidoCompraItem[]>([])
  const [cotacoes, setCotacoes] = useState<Cotacao[]>([])
  const [cotacoesItens, setCotacoesItens] = useState<CotacaoItem[]>([])
  const [fornecedores, setFornecedores] = useState<Fornecedor[]>([])
  const [recebimentos, setRecebimentos] = useState<RecebimentoNf[]>([])
  const [carregandoPedido, setCarregandoPedido] = useState(!novo)

  useEffect(() => {
    if (!novo && id) carregarPedido(id)
  }, [id, novo])

  async function carregarPedido(pedidoId: string) {
    setCarregandoPedido(true)
    const [{ data: p }, { data: its }, { data: cots }, { data: forns }, { data: recs }] = await Promise.all([
      supabase.from('pedidos_compra').select('*').eq('id', pedidoId).single(),
      supabase.from('pedidos_compra_itens').select('*').eq('pedido_id', pedidoId).eq('ativo', true).order('criado_em'),
      supabase.from('cotacoes').select('*').eq('pedido_id', pedidoId).order('criado_em'),
      supabase.from('fornecedores').select('*').eq('ativo', true).order('nome'),
      supabase.from('recebimentos_nf').select('*').eq('pedido_id', pedidoId).order('criado_em'),
    ])
    setPedido(p ?? null)
    setItensPedido(its ?? [])
    setCotacoes(cots ?? [])
    setFornecedores(forns ?? [])
    setRecebimentos(recs ?? [])
    if (cots && cots.length > 0) {
      const { data: coti } = await supabase.from('cotacoes_itens').select('*').in('cotacao_id', cots.map(c => c.id))
      setCotacoesItens(coti ?? [])
    } else {
      setCotacoesItens([])
    }
    setCarregandoPedido(false)
  }

  useEffect(() => {
    supabase.from('servicos').select('*').eq('ativo', true).order('codigo')
      .then(({ data }) => setServicos(data ?? []))
  }, [])

  function sugestoesPara(texto: string): Servico[] {
    const t = texto.trim().toLowerCase()
    if (!t) return servicos
    return servicos.filter(s => s.nome.toLowerCase().includes(t) || (s.codigo ?? '').toLowerCase().includes(t))
  }

  function atualizarItem(chave: string, patch: Partial<ItemNovo>) {
    setItens(prev => prev.map(it => it.chave === chave ? { ...it, ...patch } : it))
  }

  function escolherServico(chave: string, s: Servico) {
    setItens(prev => prev.map(it => it.chave === chave ? {
      ...it,
      servico_id: s.id,
      servicoCodigo: s.codigo || s.nome,
      buscaAplicacao: `${s.codigo ?? ''} ${s.nome}`.trim(),
      und: it.und.trim() || s.und || '',
      buscaAberta: false,
    } : it))
  }

  function removerItem(chave: string) {
    setItens(prev => prev.length > 1 ? prev.filter(it => it.chave !== chave) : prev)
  }

  async function criar() {
    if (!obraAtiva || !perfil) return
    const itensValidos = itens.filter(it => it.descricao_item.trim() && Number(it.quantidade_pedida) > 0)
    if (itensValidos.length === 0) {
      setMsg({ tipo: 'erro', texto: 'Adicione ao menos um item com descrição e quantidade.' })
      return
    }
    setSalvando(true)
    setMsg(null)
    const { data: pedido, error } = await supabase.from('pedidos_compra').insert({
      obra_id: obraAtiva.id,
      descricao: descricao.trim() || null,
    }).select().single()
    if (error || !pedido) {
      setSalvando(false)
      setMsg({ tipo: 'erro', texto: `Erro ao criar pedido: ${error?.message}` })
      return
    }
    const { error: eItens } = await supabase.from('pedidos_compra_itens').insert(
      itensValidos.map(it => ({
        pedido_id: pedido.id,
        servico_id: it.servico_id,
        descricao_item: it.descricao_item.trim(),
        quantidade_pedida: Number(it.quantidade_pedida),
        und: it.und.trim() || null,
        data_necessaria: it.data_necessaria || null,
        urgente: it.urgente,
      }))
    )
    setSalvando(false)
    if (eItens) {
      setMsg({ tipo: 'erro', texto: `Pedido criado, mas falhou ao salvar itens: ${eItens.message}` })
      return
    }
    navigate(`/compras/${pedido.id}`, { replace: true })
  }

  if (!novo) {
    if (carregandoPedido) return <div className={styles.page}><p className={styles.vazio}>Carregando…</p></div>
    if (!pedido) return <div className={styles.page}><p className={styles.vazio}>Pedido não encontrado.</p></div>
    return (
      <DetalhePedido
        pedido={pedido} itens={itensPedido} cotacoes={cotacoes} cotacoesItens={cotacoesItens}
        fornecedores={fornecedores} recebimentos={recebimentos} servicos={servicos}
        obraNome={obraAtiva?.nome ?? '—'} onRecarregar={() => carregarPedido(pedido.id)}
      />
    )
  }

  return (
    <div className={styles.page}>
      <button className={styles.voltar} onClick={() => navigate('/compras')}>← Compras</button>
      <h1>Novo pedido de compra</h1>

      <div className={styles.bloco}>
        <label className={styles.campo}>
          Descrição do pedido
          <input value={descricao} onChange={e => setDescricao(e.target.value)}
            placeholder="Ex.: Lista de material — fundação Sobrado 04" />
        </label>
      </div>

      <div className={styles.bloco}>
        <h2>Itens</h2>
        {itens.map(it => {
          const sugestoes = it.buscaAberta ? sugestoesPara(it.buscaAplicacao) : []
          return (
            <div key={it.chave} className={styles.itemLinha}>
              {itens.length > 1 && (
                <button className={styles.btnRemoverItem} onClick={() => removerItem(it.chave)}>✕</button>
              )}
              <div className={styles.itemGrid}>
                <label className={styles.campo}>
                  Item *
                  <input
                    value={it.descricao_item}
                    onChange={e => atualizarItem(it.chave, { descricao_item: e.target.value })}
                    placeholder="Ex.: areia"
                  />
                </label>
                <div className={styles.campo}>
                  Aplicação
                  <div className={styles.autocompleteWrap}>
                    <input
                      value={it.buscaAplicacao}
                      onChange={e => atualizarItem(it.chave, {
                        buscaAplicacao: e.target.value, servico_id: null, servicoCodigo: '', buscaAberta: true,
                      })}
                      onFocus={() => atualizarItem(it.chave, { buscaAberta: true })}
                      onBlur={() => setTimeout(() => atualizarItem(it.chave, { buscaAberta: false }), 150)}
                      placeholder="Ex.: chapisco"
                    />
                    {sugestoes.length > 0 && (
                      <div className={styles.sugestoes}>
                        {sugestoes.map(s => (
                          <button key={s.id} className={styles.sugestao}
                            onMouseDown={() => escolherServico(it.chave, s)}>
                            <span className={styles.sugestaoCodigo}>{s.codigo}</span>{s.nome}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  {it.servico_id
                    ? <span className={styles.vinculoOk}>✓ {it.servicoCodigo}</span>
                    : <span className={styles.vinculoAusente}>⚠ sem vínculo — vai para "a classificar"</span>}
                </div>
                <label className={styles.campo}>
                  Quantidade *
                  <input type="number" min="0" step="0.01" value={it.quantidade_pedida}
                    onChange={e => atualizarItem(it.chave, { quantidade_pedida: e.target.value })} />
                </label>
                <label className={styles.campo}>
                  Und.
                  <input value={it.und} onChange={e => atualizarItem(it.chave, { und: e.target.value })} placeholder="un, m³, sc…" />
                </label>
                <label className={styles.campo}>
                  Data na Obra
                  <input type="date" value={it.data_necessaria}
                    onChange={e => atualizarItem(it.chave, { data_necessaria: e.target.value })} />
                </label>
              </div>
              <label className={styles.checkUrgente}>
                <input type="checkbox" checked={it.urgente}
                  onChange={e => atualizarItem(it.chave, { urgente: e.target.checked })} />
                ⚡ Urgente — precisamos o mais rápido possível
              </label>
            </div>
          )
        })}
        <button className={styles.btnAddItem} onClick={() => setItens(prev => [...prev, itemVazio()])}>
          + Adicionar item
        </button>
      </div>

      {msg && <p className={msg.tipo === 'ok' ? styles.msgOk : styles.msgErro}>{msg.texto}</p>}
      <button className={styles.btnPrincipal} onClick={criar} disabled={salvando}>
        {salvando ? 'Criando…' : 'Criar pedido'}
      </button>
    </div>
  )
}

interface DetalhePedidoProps {
  pedido: PedidoCompra
  itens: PedidoCompraItem[]
  cotacoes: Cotacao[]
  cotacoesItens: CotacaoItem[]
  fornecedores: Fornecedor[]
  recebimentos: RecebimentoNf[]
  servicos: Servico[]
  obraNome: string
  onRecarregar: () => void
}

function DetalhePedido({ pedido, itens, cotacoes, cotacoesItens, fornecedores, recebimentos, servicos, obraNome, onRecarregar }: DetalhePedidoProps) {
  const navigate = useNavigate()
  const { perfil, temModulo } = useAuth()
  const podeEditar = perfil?.papel === 'admin' || temModulo('compras')
  const ehAdmin = perfil?.papel === 'admin'
  const [gerandoPdf, setGerandoPdf] = useState(false)

  function codigoAplicacao(servicoId: string | null): string {
    if (!servicoId) return '—'
    const s = servicos.find(sv => sv.id === servicoId)
    return s?.codigo || s?.nome || '—'
  }

  // ---------- edição de itens (só enquanto o pedido está em rascunho) ----------
  const podeEditarItens = podeEditar && pedido.status === 'rascunho'

  const [itensEdit, setItensEdit] = useState<ItemEditavel[]>([])
  const [salvandoItens, setSalvandoItens] = useState(false)
  const [msgItens, setMsgItens] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)

  useEffect(() => {
    if (!podeEditarItens) return
    setItensEdit(itens.map(it => ({
      id: it.id,
      chave: it.id,
      descricao_item: it.descricao_item,
      servico_id: it.servico_id,
      buscaAplicacao: it.servico_id ? codigoAplicacao(it.servico_id) : '',
      quantidade_pedida: String(it.quantidade_pedida),
      und: it.und ?? '',
      data_necessaria: it.data_necessaria ?? '',
      urgente: it.urgente,
      buscaAberta: false,
      removido: false,
    })))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itens, podeEditarItens])

  function sugestoesParaEdit(texto: string): Servico[] {
    const t = texto.trim().toLowerCase()
    if (!t) return servicos
    return servicos.filter(s => s.nome.toLowerCase().includes(t) || (s.codigo ?? '').toLowerCase().includes(t))
  }

  function atualizarItemEdit(chave: string, patch: Partial<ItemEditavel>) {
    setItensEdit(prev => prev.map(it => it.chave === chave ? { ...it, ...patch } : it))
  }

  function escolherServicoEdit(chave: string, s: Servico) {
    setItensEdit(prev => prev.map(it => it.chave === chave ? {
      ...it,
      servico_id: s.id,
      buscaAplicacao: `${s.codigo ?? ''} ${s.nome}`.trim(),
      und: it.und.trim() || s.und || '',
      buscaAberta: false,
    } : it))
  }

  function removerItemEdit(chave: string) {
    setItensEdit(prev => {
      const alvo = prev.find(it => it.chave === chave)
      if (!alvo) return prev
      if (alvo.id === null) return prev.filter(it => it.chave !== chave)
      return prev.map(it => it.chave === chave ? { ...it, removido: true } : it)
    })
  }

  function adicionarItemEdit() {
    setItensEdit(prev => [...prev, itemEditVazio()])
  }

  async function salvarItensEditados() {
    const ativos = itensEdit.filter(it => !it.removido)
    const validos = ativos.filter(it => it.descricao_item.trim() && Number(it.quantidade_pedida) > 0)
    if (validos.length === 0) {
      setMsgItens({ tipo: 'erro', texto: 'O pedido precisa de ao menos um item com descrição e quantidade.' })
      return
    }
    setSalvandoItens(true)
    setMsgItens(null)

    for (const it of itensEdit.filter(it => it.removido && it.id)) {
      const { error } = await supabase.from('pedidos_compra_itens').update({ ativo: false }).eq('id', it.id!)
      if (error) {
        setSalvandoItens(false)
        setMsgItens({ tipo: 'erro', texto: `Falha ao remover "${it.descricao_item}": ${error.message}` })
        return
      }
    }

    for (const it of validos.filter(it => it.id)) {
      const { error } = await supabase.from('pedidos_compra_itens').update({
        descricao_item: it.descricao_item.trim(),
        servico_id: it.servico_id,
        quantidade_pedida: Number(it.quantidade_pedida),
        und: it.und.trim() || null,
        data_necessaria: it.data_necessaria || null,
        urgente: it.urgente,
      }).eq('id', it.id!)
      if (error) {
        setSalvandoItens(false)
        setMsgItens({ tipo: 'erro', texto: `Falha ao salvar "${it.descricao_item}": ${error.message}` })
        return
      }
    }

    const novos = validos.filter(it => !it.id)
    if (novos.length > 0) {
      const { error } = await supabase.from('pedidos_compra_itens').insert(novos.map(it => ({
        pedido_id: pedido.id,
        servico_id: it.servico_id,
        descricao_item: it.descricao_item.trim(),
        quantidade_pedida: Number(it.quantidade_pedida),
        und: it.und.trim() || null,
        data_necessaria: it.data_necessaria || null,
        urgente: it.urgente,
      })))
      if (error) {
        setSalvandoItens(false)
        setMsgItens({ tipo: 'erro', texto: `Falha ao adicionar novos itens: ${error.message}` })
        return
      }
    }

    setSalvandoItens(false)
    setMsgItens({ tipo: 'ok', texto: 'Itens atualizados.' })
    onRecarregar()
  }

  async function baixarPdf() {
    setGerandoPdf(true)
    try {
      const { gerarPdfPedido } = await import('../lib/comprasPdf')
      gerarPdfPedido({ pedido, itens, obraNome, servicos })
    } finally {
      setGerandoPdf(false)
    }
  }

  const [fornecedorSel, setFornecedorSel] = useState('')
  const [condicaoPagamento, setCondicaoPagamento] = useState('')
  const [prazoEntrega, setPrazoEntrega] = useState('')
  const [precos, setPrecos] = useState<Record<string, string>>({})
  const [arquivo, setArquivo] = useState<File | null>(null)
  const [salvandoCotacao, setSalvandoCotacao] = useState(false)
  const [msgCotacao, setMsgCotacao] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)
  const [msgImportacao, setMsgImportacao] = useState<string | null>(null)
  const [urlsAnexos, setUrlsAnexos] = useState<Map<string, string>>(new Map())

  function parseCsv(texto: string): string[][] {
    return texto.split(/\r?\n/).filter(l => l.trim().length > 0).map(linha => {
      const campos: string[] = []
      let atual = ''
      let dentroAspas = false
      for (let i = 0; i < linha.length; i++) {
        const c = linha[i]
        if (c === '"') {
          if (dentroAspas && linha[i + 1] === '"') { atual += '"'; i++ }
          else dentroAspas = !dentroAspas
        } else if (c === ',' && !dentroAspas) {
          campos.push(atual); atual = ''
        } else {
          atual += c
        }
      }
      campos.push(atual)
      return campos.map(c => c.trim())
    })
  }

  async function importarCsv(arquivoCsv: File) {
    const texto = await arquivoCsv.text()
    const linhas = parseCsv(texto)
    if (linhas.length < 2) {
      setMsgImportacao('CSV vazio ou sem linhas de item.')
      return
    }
    const header = linhas[0].map(h => h.toLowerCase())
    const idx = {
      fornecedor: header.indexOf('fornecedor'),
      condicao: header.indexOf('condicao_pagamento'),
      prazo: header.indexOf('prazo_entrega_dias'),
      item: header.indexOf('item'),
      preco: header.indexOf('preco_unitario'),
    }
    if (Object.values(idx).some(i => i === -1)) {
      setMsgImportacao('Cabeçalho do CSV não reconhecido. Esperado: fornecedor,condicao_pagamento,prazo_entrega_dias,item,preco_unitario')
      return
    }
    const linhasDados = linhas.slice(1)

    const nomeFornecedorCsv = (linhasDados[0][idx.fornecedor] ?? '').trim()
    const matchFornecedor = fornecedores.find(f => f.nome.trim().toLowerCase() === nomeFornecedorCsv.toLowerCase())
    if (matchFornecedor) setFornecedorSel(matchFornecedor.id)
    if (linhasDados[0][idx.condicao]) setCondicaoPagamento(linhasDados[0][idx.condicao].trim())
    if (linhasDados[0][idx.prazo]) setPrazoEntrega(linhasDados[0][idx.prazo].trim())

    const novosPrecos: Record<string, string> = {}
    const semCorrespondencia: string[] = []
    for (const linha of linhasDados) {
      const nomeItem = (linha[idx.item] ?? '').trim()
      const preco = (linha[idx.preco] ?? '').trim()
      if (!nomeItem || !preco) continue
      const nomeItemLower = nomeItem.toLowerCase()
      const itemPedido = itens.find(it =>
        it.descricao_item.toLowerCase().includes(nomeItemLower) || nomeItemLower.includes(it.descricao_item.toLowerCase())
      )
      if (itemPedido) novosPrecos[itemPedido.id] = preco
      else semCorrespondencia.push(nomeItem)
    }
    setPrecos(prev => ({ ...prev, ...novosPrecos }))

    const partes = [`${Object.keys(novosPrecos).length} de ${linhasDados.length} item(ns) do CSV preenchidos automaticamente.`]
    if (nomeFornecedorCsv && !matchFornecedor) partes.push(`Fornecedor "${nomeFornecedorCsv}" não encontrado no cadastro — selecione manualmente.`)
    if (semCorrespondencia.length > 0) partes.push(`Sem correspondência no pedido: ${semCorrespondencia.join(', ')}.`)
    setMsgImportacao(partes.join(' '))
  }

  useEffect(() => {
    let cancelado = false
    async function carregarUrls() {
      const novasUrls = new Map<string, string>()
      await Promise.all([
        ...cotacoes.map(async c => {
          if (!c.anexo_url) return
          const { data } = await supabase.storage.from('cotacoes-nf').createSignedUrl(c.anexo_url, 3600)
          if (data) novasUrls.set(c.anexo_url, data.signedUrl)
        }),
        ...recebimentos.map(async r => {
          if (!r.anexo_nf_url) return
          const { data } = await supabase.storage.from('cotacoes-nf').createSignedUrl(r.anexo_nf_url, 3600)
          if (data) novasUrls.set(r.anexo_nf_url, data.signedUrl)
        }),
      ])
      if (!cancelado) setUrlsAnexos(novasUrls)
    }
    carregarUrls()
    return () => { cancelado = true }
  }, [cotacoes, recebimentos])

  function precoDe(cotacaoId: string, itemId: string): number | null {
    const ci = cotacoesItens.find(c => c.cotacao_id === cotacaoId && c.pedido_item_id === itemId)
    return ci ? ci.preco_unitario : null
  }

  function idDoItemCotacao(cotacaoId: string, itemId: string): string | null {
    return cotacoesItens.find(c => c.cotacao_id === cotacaoId && c.pedido_item_id === itemId)?.id ?? null
  }

  async function registrarCotacao() {
    if (!fornecedorSel || !arquivo) {
      setMsgCotacao({ tipo: 'erro', texto: 'Escolha o fornecedor e anexe o orçamento dele.' })
      return
    }
    const itensComPreco = itens.filter(it => Number(precos[it.id]) > 0)
    if (itensComPreco.length === 0) {
      setMsgCotacao({ tipo: 'erro', texto: 'Informe o preço de ao menos um item.' })
      return
    }
    setSalvandoCotacao(true)
    setMsgCotacao(null)
    const path = `${pedido.id}/${crypto.randomUUID()}-${arquivo.name}`
    const { error: eUp } = await supabase.storage.from('cotacoes-nf').upload(path, arquivo)
    if (eUp) {
      setSalvandoCotacao(false)
      setMsgCotacao({ tipo: 'erro', texto: `Falha no envio do anexo: ${eUp.message}` })
      return
    }
    const { data: cot, error } = await supabase.from('cotacoes').insert({
      pedido_id: pedido.id,
      fornecedor_id: fornecedorSel,
      condicao_pagamento: condicaoPagamento.trim() || null,
      prazo_entrega_dias: prazoEntrega ? Number(prazoEntrega) : null,
      anexo_url: path,
    }).select().single()
    if (error || !cot) {
      setSalvandoCotacao(false)
      setMsgCotacao({ tipo: 'erro', texto: `Erro ao registrar cotação: ${error?.message}` })
      return
    }
    const { error: eItens } = await supabase.from('cotacoes_itens').insert(
      itensComPreco.map(it => ({ cotacao_id: cot.id, pedido_item_id: it.id, preco_unitario: Number(precos[it.id]) }))
    )
    if (eItens) {
      setSalvandoCotacao(false)
      setMsgCotacao({ tipo: 'erro', texto: `Cotação criada, mas falhou ao salvar os preços dos itens: ${eItens.message}` })
      return
    }
    let statusMsg: { tipo: 'ok' | 'erro'; texto: string } = { tipo: 'ok', texto: 'Cotação registrada.' }
    if (pedido.status === 'rascunho') {
      const { error: eStatus } = await supabase.from('pedidos_compra').update({ status: 'em_cotacao' }).eq('id', pedido.id)
      if (eStatus) {
        statusMsg = { tipo: 'erro', texto: `Cotação registrada, mas falhou ao atualizar o status do pedido: ${eStatus.message}` }
      }
    }
    setSalvandoCotacao(false)
    setFornecedorSel(''); setCondicaoPagamento(''); setPrazoEntrega(''); setPrecos({}); setArquivo(null)
    setMsgCotacao(statusMsg)
    onRecarregar()
  }

  async function marcarVencedor(itemId: string, cotacaoItemId: string | null) {
    const { error } = await supabase.from('pedidos_compra_itens')
      .update({ cotacao_item_vencedora_id: cotacaoItemId }).eq('id', itemId)
    if (error) {
      alert(`Falha ao definir o vencedor: ${error.message}`)
      return
    }
    onRecarregar()
  }

  async function aprovarPedido() {
    const todosComVencedor = itens.every(it => it.cotacao_item_vencedora_id !== null)
    if (!todosComVencedor) {
      alert('Defina o vencedor de todos os itens antes de aprovar.')
      return
    }
    const { error } = await supabase.from('pedidos_compra').update({
      status: 'aprovado', aprovado_por: perfil?.id, aprovado_em: new Date().toISOString(),
    }).eq('id', pedido.id)
    if (error) {
      alert(`Falha ao aprovar o pedido: ${error.message}`)
      return
    }
    onRecarregar()
  }

  const [arquivoNf, setArquivoNf] = useState<File | null>(null)
  const [obsNf, setObsNf] = useState('')
  const [salvandoRecebimento, setSalvandoRecebimento] = useState(false)
  const [msgRecebimento, setMsgRecebimento] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)
  const [motivoCancelamento, setMotivoCancelamento] = useState('')
  const [mostrarCancelar, setMostrarCancelar] = useState(false)

  async function marcarEnviado() {
    const { error } = await supabase.from('pedidos_compra').update({ status: 'enviado' }).eq('id', pedido.id)
    if (error) {
      setMsgRecebimento({ tipo: 'erro', texto: `Falha ao marcar como enviado: ${error.message}` })
      return
    }
    setMsgRecebimento(null)
    onRecarregar()
  }

  async function registrarNf() {
    if (!arquivoNf) {
      setMsgRecebimento({ tipo: 'erro', texto: 'Anexe a nota fiscal.' })
      return
    }
    setSalvandoRecebimento(true)
    setMsgRecebimento(null)
    const path = `${pedido.id}/nf-${crypto.randomUUID()}-${arquivoNf.name}`
    const { error: eUp } = await supabase.storage.from('cotacoes-nf').upload(path, arquivoNf)
    if (eUp) {
      setSalvandoRecebimento(false)
      setMsgRecebimento({ tipo: 'erro', texto: `Falha no envio da NF: ${eUp.message}` })
      return
    }
    const { error } = await supabase.from('recebimentos_nf').insert({
      pedido_id: pedido.id, anexo_nf_url: path, observacao: obsNf.trim() || null,
    })
    if (error) {
      setSalvandoRecebimento(false)
      setMsgRecebimento({ tipo: 'erro', texto: `Falha ao registrar a NF: ${error.message}` })
      return
    }
    if (['recebido_parcial', 'recebido_total'].includes(pedido.status)) {
      const { error: eStatus } = await supabase.from('pedidos_compra').update({ status: 'conferido_nf' }).eq('id', pedido.id)
      if (eStatus) {
        setSalvandoRecebimento(false)
        setMsgRecebimento({ tipo: 'erro', texto: `NF registrada, mas falhou ao atualizar o status do pedido: ${eStatus.message}` })
        onRecarregar()
        return
      }
    }
    setSalvandoRecebimento(false)
    setArquivoNf(null); setObsNf('')
    setMsgRecebimento({ tipo: 'ok', texto: 'NF registrada.' })
    onRecarregar()
  }

  async function cancelarPedido() {
    if (!motivoCancelamento.trim()) {
      alert('Informe o motivo do cancelamento.')
      return
    }
    const { error } = await supabase.from('pedidos_compra').update({
      status: 'cancelado', motivo_cancelamento: motivoCancelamento.trim(),
    }).eq('id', pedido.id)
    if (error) {
      alert(`Falha ao cancelar o pedido: ${error.message}`)
      return
    }
    onRecarregar()
  }

  async function encerrarPedido() {
    const { error } = await supabase.from('pedidos_compra').update({ status: 'encerrado' }).eq('id', pedido.id)
    if (error) {
      alert(`Falha ao encerrar o pedido: ${error.message}`)
      return
    }
    onRecarregar()
  }

  function divergencia(it: PedidoCompraItem): boolean {
    return it.quantidade_recebida > 0 && it.quantidade_recebida !== it.quantidade_pedida
  }

  function precoVencedorDoItem(it: PedidoCompraItem): number | null {
    if (!it.cotacao_item_vencedora_id) return null
    const ci = cotacoesItens.find(c => c.id === it.cotacao_item_vencedora_id)
    return ci ? ci.preco_unitario : null
  }

  const nomeFornecedor = (id: string) => fornecedores.find(f => f.id === id)?.nome ?? '?'

  return (
    <div className={styles.page}>
      <button className={styles.voltar} onClick={() => navigate('/compras')}>← Compras</button>
      <div className={styles.header}>
        <h1>Pedido {String(pedido.numero).padStart(3, '0')}</h1>
        <span className={`${styles.chip} ${styles[`chip_${pedido.status}`]}`}>{STATUS_LABEL[pedido.status]}</span>
      </div>
      {pedido.descricao && <p className={styles.metaLista}>{pedido.descricao}</p>}

      <button className={styles.btnSecundario} onClick={baixarPdf} disabled={gerandoPdf}>
        {gerandoPdf ? 'Gerando…' : '📄 Gerar PDF'}
      </button>

      {podeEditarItens ? (
        <div className={styles.bloco}>
          <h2>Itens do pedido (rascunho — editável)</h2>
          {itensEdit.filter(it => !it.removido).map(it => {
            const sugestoes = it.buscaAberta ? sugestoesParaEdit(it.buscaAplicacao) : []
            return (
              <div key={it.chave} className={styles.itemLinha}>
                <button className={styles.btnRemoverItem} onClick={() => removerItemEdit(it.chave)}>✕</button>
                <div className={styles.itemGrid}>
                  <label className={styles.campo}>
                    Item *
                    <input value={it.descricao_item}
                      onChange={e => atualizarItemEdit(it.chave, { descricao_item: e.target.value })}
                      placeholder="Ex.: areia" />
                  </label>
                  <div className={styles.campo}>
                    Aplicação
                    <div className={styles.autocompleteWrap}>
                      <input
                        value={it.buscaAplicacao}
                        onChange={e => atualizarItemEdit(it.chave, {
                          buscaAplicacao: e.target.value, servico_id: null, buscaAberta: true,
                        })}
                        onFocus={() => atualizarItemEdit(it.chave, { buscaAberta: true })}
                        onBlur={() => setTimeout(() => atualizarItemEdit(it.chave, { buscaAberta: false }), 150)}
                        placeholder="Ex.: chapisco"
                      />
                      {sugestoes.length > 0 && (
                        <div className={styles.sugestoes}>
                          {sugestoes.map(s => (
                            <button key={s.id} className={styles.sugestao}
                              onMouseDown={() => escolherServicoEdit(it.chave, s)}>
                              <span className={styles.sugestaoCodigo}>{s.codigo}</span>{s.nome}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    {it.servico_id
                      ? <span className={styles.vinculoOk}>✓ {codigoAplicacao(it.servico_id)}</span>
                      : <span className={styles.vinculoAusente}>⚠ sem vínculo — vai para "a classificar"</span>}
                  </div>
                  <label className={styles.campo}>
                    Quantidade *
                    <input type="number" min="0" step="0.01" value={it.quantidade_pedida}
                      onChange={e => atualizarItemEdit(it.chave, { quantidade_pedida: e.target.value })} />
                  </label>
                  <label className={styles.campo}>
                    Und.
                    <input value={it.und} onChange={e => atualizarItemEdit(it.chave, { und: e.target.value })} placeholder="un, m³, sc…" />
                  </label>
                  <label className={styles.campo}>
                    Data na Obra
                    <input type="date" value={it.data_necessaria}
                      onChange={e => atualizarItemEdit(it.chave, { data_necessaria: e.target.value })} />
                  </label>
                </div>
                <label className={styles.checkUrgente}>
                  <input type="checkbox" checked={it.urgente}
                    onChange={e => atualizarItemEdit(it.chave, { urgente: e.target.checked })} />
                  ⚡ Urgente — precisamos o mais rápido possível
                </label>
              </div>
            )
          })}
          <button className={styles.btnAddItem} onClick={adicionarItemEdit}>+ Adicionar item</button>
          {msgItens && <p className={msgItens.tipo === 'ok' ? styles.msgOk : styles.msgErro}>{msgItens.texto}</p>}
          <button className={styles.btnPrincipal} onClick={salvarItensEditados} disabled={salvandoItens} style={{ marginTop: 12 }}>
            {salvandoItens ? 'Salvando…' : 'Salvar alterações'}
          </button>
        </div>
      ) : (
        <div className={styles.bloco}>
          <h2>Itens do pedido</h2>
          <table className={styles.tabelaComparativa}>
            <thead>
              <tr>
                <th>Item</th><th>Aplicação</th><th>Qtd.</th><th>Data na Obra</th>
                {cotacoes.map(c => (
                  <th key={c.id}>
                    {nomeFornecedor(c.fornecedor_id)}
                    {c.anexo_url && urlsAnexos.get(c.anexo_url) && (
                      <div>
                        <a className={styles.anexoLink} href={urlsAnexos.get(c.anexo_url)} target="_blank" rel="noreferrer">
                          📎 anexo
                        </a>
                      </div>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {itens.map(it => (
                <tr key={it.id}>
                  <td>{it.urgente && '⚡ '}{it.descricao_item}</td>
                  <td>{codigoAplicacao(it.servico_id)}</td>
                  <td>{it.quantidade_pedida} {it.und}</td>
                  <td>{it.data_necessaria ?? '—'}</td>
                  {cotacoes.map(c => {
                    const preco = precoDe(c.id, it.id)
                    const cotItemId = idDoItemCotacao(c.id, it.id)
                    const vencedor = it.cotacao_item_vencedora_id !== null && cotItemId === it.cotacao_item_vencedora_id
                    return (
                      <td key={c.id}>
                        {preco !== null ? (
                          <>
                            <span className={vencedor ? styles.precoVencedor : ''}>R$ {preco.toFixed(2)}</span>
                            {ehAdmin && pedido.status === 'em_cotacao' && (
                              <div>
                                <button
                                  className={`${styles.btnVencedor} ${vencedor ? styles.ativo : ''}`}
                                  onClick={() => marcarVencedor(it.id, vencedor ? null : cotItemId)}
                                >
                                  {vencedor ? '✓ vencedor' : 'marcar vencedor'}
                                </button>
                              </div>
                            )}
                          </>
                        ) : '—'}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {podeEditar && pedido.status !== 'aprovado' && !['encerrado', 'cancelado'].includes(pedido.status) && (
        <div className={styles.bloco}>
          <h2>Registrar cotação de fornecedor</h2>
          <label className={styles.campo}>
            Importar CSV (skill "leitura-cotacao-fornecedor")
            <input type="file" accept=".csv,text/csv"
              onChange={e => {
                const f = e.target.files?.[0]
                e.target.value = ''
                if (f) importarCsv(f)
              }} />
          </label>
          {msgImportacao && <p className={styles.msgInfo}>{msgImportacao}</p>}
          <div className={styles.linha2}>
            <label className={styles.campo}>
              Fornecedor *
              <select value={fornecedorSel} onChange={e => setFornecedorSel(e.target.value)}>
                <option value="">Selecione…</option>
                {fornecedores.map(f => <option key={f.id} value={f.id}>{f.nome}</option>)}
              </select>
            </label>
            <label className={styles.campo}>
              Condição de pagamento
              <input value={condicaoPagamento} onChange={e => setCondicaoPagamento(e.target.value)} placeholder="Ex.: 30 dias" />
            </label>
            <label className={styles.campo}>
              Prazo de entrega (dias)
              <input type="number" min="0" value={prazoEntrega} onChange={e => setPrazoEntrega(e.target.value)} />
            </label>
          </div>
          <div className={styles.fornecedorForm}>
            {itens.map(it => (
              <label key={it.id} className={styles.campo}>
                Preço unitário — {it.descricao_item} ({it.und})
                <input type="number" min="0" step="0.01" value={precos[it.id] ?? ''}
                  onChange={e => setPrecos(prev => ({ ...prev, [it.id]: e.target.value }))} />
              </label>
            ))}
            <label className={styles.campo}>
              Anexo do orçamento do fornecedor (PDF/foto) *
              <input type="file" accept="application/pdf,image/*" onChange={e => setArquivo(e.target.files?.[0] ?? null)} />
            </label>
          </div>
          {msgCotacao && <p className={msgCotacao.tipo === 'ok' ? styles.msgOk : styles.msgErro}>{msgCotacao.texto}</p>}
          <button className={styles.btnPrincipal} onClick={registrarCotacao} disabled={salvandoCotacao}>
            {salvandoCotacao ? 'Salvando…' : 'Registrar cotação'}
          </button>
        </div>
      )}

      {ehAdmin && pedido.status === 'em_cotacao' && (
        <div className={styles.bloco}>
          <button className={styles.btnPrincipal} onClick={aprovarPedido}>Aprovar pedido</button>
        </div>
      )}

      {ehAdmin && pedido.status === 'aprovado' && (
        <div className={styles.bloco}>
          <button className={styles.btnPrincipal} onClick={marcarEnviado}>Marcar como enviado ao fornecedor</button>
        </div>
      )}

      {podeEditar && ['enviado', 'recebido_parcial'].includes(pedido.status) && (
        <div className={styles.bloco}>
          <h2>Recebimento</h2>
          {itens.map(it => (
            <p key={it.id} className={styles.metaLista}>
              {it.descricao_item} — pedido {it.quantidade_pedida} {it.und}, recebido até agora {it.quantidade_recebida}
              {divergencia(it) && <span className={styles.msgErro}> (divergência)</span>}
            </p>
          ))}
          <p className={styles.msgInfo}>Recebimento é lançado pela Entrada do Almoxarifado.</p>
          <button className={styles.btnSecundario} onClick={() => navigate('/almoxarifado')}>Ir para o Almoxarifado</button>
        </div>
      )}

      {podeEditar && ['recebido_parcial', 'recebido_total'].includes(pedido.status) && (
        <div className={styles.bloco}>
          <h2>Conferência com nota fiscal</h2>
          <label className={styles.campo}>
            Nota fiscal (PDF/foto) *
            <input type="file" accept="application/pdf,image/*" onChange={e => setArquivoNf(e.target.files?.[0] ?? null)} />
          </label>
          <label className={styles.campo}>
            Observação
            <input value={obsNf} onChange={e => setObsNf(e.target.value)} placeholder="Ex.: NF 12345, entrega em duas notas…" />
          </label>
          {msgRecebimento && <p className={msgRecebimento.tipo === 'ok' ? styles.msgOk : styles.msgErro}>{msgRecebimento.texto}</p>}
          <button className={styles.btnPrincipal} onClick={registrarNf} disabled={salvandoRecebimento}>
            {salvandoRecebimento ? 'Salvando…' : 'Anexar NF e conferir'}
          </button>
        </div>
      )}

      {recebimentos.length > 0 && (
        <div className={styles.bloco}>
          <h2>Notas fiscais anexadas ({recebimentos.length})</h2>
          {recebimentos.map(r => (
            <p key={r.id} className={styles.metaLista}>
              {r.observacao || 'NF sem observação'} — {new Date(r.criado_em).toLocaleDateString('pt-BR')}
              {r.anexo_nf_url && urlsAnexos.get(r.anexo_nf_url) && (
                <a className={styles.anexoLink} href={urlsAnexos.get(r.anexo_nf_url)} target="_blank" rel="noreferrer">
                  📎 abrir NF
                </a>
              )}
            </p>
          ))}
        </div>
      )}

      {perfil?.papel !== 'cliente' && ['recebido_parcial', 'recebido_total', 'conferido_nf', 'encerrado'].includes(pedido.status) && (
        <div className={styles.bloco}>
          <h2>Conferência tripla (aprovado × almoxarifado × NF)</h2>
          <table className={styles.tabelaComparativa}>
            <thead>
              <tr>
                <th>Item</th>
                <th>Aprovado</th>
                <th>Almoxarifado</th>
                <th>NF</th>
                <th>Conferência</th>
              </tr>
            </thead>
            <tbody>
              {itens.map(it => {
                const preco = precoVencedorDoItem(it)
                const valorAprovado = preco !== null ? it.quantidade_pedida * preco : null
                const valorAlmoxarifado = preco !== null ? it.quantidade_recebida * preco : null
                const nfAnexada = recebimentos.length > 0

                const avisos: string[] = []
                if (it.quantidade_recebida !== it.quantidade_pedida) {
                  avisos.push(`recebido no almoxarifado (${it.quantidade_recebida} ${it.und}) ≠ aprovado (${it.quantidade_pedida} ${it.und})`)
                }
                if (it.valor_recebido !== null && valorAprovado !== null && it.valor_recebido !== valorAprovado) {
                  avisos.push(`valor da NF (R$ ${it.valor_recebido.toFixed(2)}) ≠ valor aprovado (R$ ${valorAprovado.toFixed(2)})`)
                }
                const diverge = avisos.length > 0

                return (
                  <tr key={it.id} className={diverge ? styles.linhaDivergente : ''}>
                    <td>{it.descricao_item}</td>
                    <td>
                      {it.quantidade_pedida} {it.und}
                      {preco !== null ? <div>R$ {preco.toFixed(2)}/{it.und} — total R$ {valorAprovado!.toFixed(2)}</div>
                        : <div className={styles.msgInfo}>preço vencedor não definido</div>}
                    </td>
                    <td>
                      {it.quantidade_recebida} {it.und}
                      {valorAlmoxarifado !== null && <div>~R$ {valorAlmoxarifado.toFixed(2)} (a preço aprovado)</div>}
                    </td>
                    <td>
                      {nfAnexada
                        ? (it.valor_recebido !== null ? <>R$ {it.valor_recebido.toFixed(2)}</> : <span className={styles.msgInfo}>NF anexada — valor por item não informado</span>)
                        : <span className={styles.msgInfo}>sem NF anexada ainda</span>}
                    </td>
                    <td>
                      {diverge
                        ? <span className={styles.msgErro}>⚠ {avisos.join('; ')}</span>
                        : <span className={styles.msgOk}>✓ conferido</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {ehAdmin && pedido.status === 'conferido_nf' && (
        <div className={styles.bloco}>
          <button className={styles.btnPrincipal} onClick={encerrarPedido}>Encerrar pedido</button>
        </div>
      )}

      {pedido.status === 'cancelado' && pedido.motivo_cancelamento && (
        <div className={styles.bloco}>
          <h2>Motivo do cancelamento</h2>
          <p>{pedido.motivo_cancelamento}</p>
        </div>
      )}

      {ehAdmin && !['encerrado', 'cancelado'].includes(pedido.status) && (
        <div className={styles.bloco}>
          {!mostrarCancelar ? (
            <button className={styles.btnSecundario} onClick={() => setMostrarCancelar(true)}>Cancelar pedido</button>
          ) : (
            <>
              <label className={styles.campo}>
                Motivo do cancelamento *
                <input value={motivoCancelamento} onChange={e => setMotivoCancelamento(e.target.value)} />
              </label>
              <button className={styles.btnSecundario} onClick={cancelarPedido}>Confirmar cancelamento</button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
