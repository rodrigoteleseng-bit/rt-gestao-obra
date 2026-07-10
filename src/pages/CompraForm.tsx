import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useObra } from '../contexts/ObraContext'
import { useAuth } from '../contexts/AuthContext'
import { supabase, type Servico, type PedidoCompra, type PedidoCompraItem, type Cotacao, type CotacaoItem, type Fornecedor } from '../lib/supabase'
import { STATUS_LABEL } from './Compras'
import styles from './CompraForm.module.css'

interface ItemNovo {
  chave: string
  servico_id: string | null
  servicoLabel: string
  descricao_item: string
  quantidade_pedida: string
  und: string
  data_necessaria: string
  urgente: boolean
  buscaAberta: boolean
}

function itemVazio(): ItemNovo {
  return {
    chave: crypto.randomUUID(),
    servico_id: null,
    servicoLabel: '',
    descricao_item: '',
    quantidade_pedida: '',
    und: '',
    data_necessaria: '',
    urgente: false,
    buscaAberta: false,
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
  const [carregandoPedido, setCarregandoPedido] = useState(!novo)

  useEffect(() => {
    if (!novo && id) carregarPedido(id)
  }, [id, novo])

  async function carregarPedido(pedidoId: string) {
    setCarregandoPedido(true)
    const [{ data: p }, { data: its }, { data: cots }, { data: forns }] = await Promise.all([
      supabase.from('pedidos_compra').select('*').eq('id', pedidoId).single(),
      supabase.from('pedidos_compra_itens').select('*').eq('pedido_id', pedidoId).eq('ativo', true).order('criado_em'),
      supabase.from('cotacoes').select('*').eq('pedido_id', pedidoId).order('criado_em'),
      supabase.from('fornecedores').select('*').eq('ativo', true).order('nome'),
    ])
    setPedido(p ?? null)
    setItensPedido(its ?? [])
    setCotacoes(cots ?? [])
    setFornecedores(forns ?? [])
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
    if (t.length < 2) return []
    return servicos.filter(s => s.nome.toLowerCase().includes(t) || (s.codigo ?? '').toLowerCase().includes(t)).slice(0, 8)
  }

  function atualizarItem(chave: string, patch: Partial<ItemNovo>) {
    setItens(prev => prev.map(it => it.chave === chave ? { ...it, ...patch } : it))
  }

  function escolherServico(chave: string, s: Servico) {
    atualizarItem(chave, {
      servico_id: s.id,
      servicoLabel: `${s.codigo ?? ''} ${s.nome}`.trim(),
      descricao_item: s.nome,
      und: s.und ?? '',
      buscaAberta: false,
    })
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
        fornecedores={fornecedores} onRecarregar={() => carregarPedido(pedido.id)}
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
          const sugestoes = it.buscaAberta ? sugestoesPara(it.descricao_item) : []
          return (
            <div key={it.chave} className={styles.itemLinha}>
              {itens.length > 1 && (
                <button className={styles.btnRemoverItem} onClick={() => removerItem(it.chave)}>✕</button>
              )}
              <div className={styles.itemGrid}>
                <div className={styles.campo}>
                  Insumo *
                  <div className={styles.autocompleteWrap}>
                    <input
                      value={it.descricao_item}
                      onChange={e => atualizarItem(it.chave, {
                        descricao_item: e.target.value, servico_id: null, buscaAberta: true,
                      })}
                      onFocus={() => atualizarItem(it.chave, { buscaAberta: true })}
                      onBlur={() => setTimeout(() => atualizarItem(it.chave, { buscaAberta: false }), 150)}
                      placeholder="Ex.: bloco cerâmico 14x19x29"
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
                    ? <span className={styles.vinculoOk}>✓ vinculado ao orçamento</span>
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
                  Necessário até
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
  onRecarregar: () => void
}

function DetalhePedido({ pedido, itens, cotacoes, cotacoesItens, fornecedores, onRecarregar }: DetalhePedidoProps) {
  const navigate = useNavigate()
  const { perfil, temModulo } = useAuth()
  const podeEditar = perfil?.papel === 'admin' || temModulo('compras')
  const ehAdmin = perfil?.papel === 'admin'

  const [fornecedorSel, setFornecedorSel] = useState('')
  const [condicaoPagamento, setCondicaoPagamento] = useState('')
  const [prazoEntrega, setPrazoEntrega] = useState('')
  const [precos, setPrecos] = useState<Record<string, string>>({})
  const [arquivo, setArquivo] = useState<File | null>(null)
  const [salvandoCotacao, setSalvandoCotacao] = useState(false)
  const [msgCotacao, setMsgCotacao] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)

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
    if (pedido.status === 'rascunho') {
      await supabase.from('pedidos_compra').update({ status: 'em_cotacao' }).eq('id', pedido.id)
    }
    setSalvandoCotacao(false)
    setFornecedorSel(''); setCondicaoPagamento(''); setPrazoEntrega(''); setPrecos({}); setArquivo(null)
    setMsgCotacao({ tipo: 'ok', texto: 'Cotação registrada.' })
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

  const nomeFornecedor = (id: string) => fornecedores.find(f => f.id === id)?.nome ?? '?'

  return (
    <div className={styles.page}>
      <button className={styles.voltar} onClick={() => navigate('/compras')}>← Compras</button>
      <div className={styles.header}>
        <h1>Pedido {String(pedido.numero).padStart(3, '0')}</h1>
        <span className={`${styles.chip}`}>{STATUS_LABEL[pedido.status]}</span>
      </div>
      {pedido.descricao && <p className={styles.metaLista}>{pedido.descricao}</p>}

      <div className={styles.bloco}>
        <h2>Itens do pedido</h2>
        <table className={styles.tabelaComparativa}>
          <thead>
            <tr>
              <th>Item</th><th>Qtd.</th><th>Necessário até</th>
              {cotacoes.map(c => <th key={c.id}>{nomeFornecedor(c.fornecedor_id)}</th>)}
            </tr>
          </thead>
          <tbody>
            {itens.map(it => (
              <tr key={it.id}>
                <td>{it.urgente && '⚡ '}{it.descricao_item}</td>
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
                          {ehAdmin && pedido.status !== 'aprovado' && (
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

      {podeEditar && pedido.status !== 'aprovado' && !['encerrado', 'cancelado'].includes(pedido.status) && (
        <div className={styles.bloco}>
          <h2>Registrar cotação de fornecedor</h2>
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
    </div>
  )
}
