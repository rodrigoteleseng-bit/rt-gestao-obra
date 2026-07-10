import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useObra } from '../contexts/ObraContext'
import { useAuth } from '../contexts/AuthContext'
import { supabase, type Servico } from '../lib/supabase'
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
    // Detalhe/edição de pedido existente — implementado nas Tasks 6–8.
    return <div className={styles.page}><p className={styles.vazio}>Carregando pedido…</p></div>
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
