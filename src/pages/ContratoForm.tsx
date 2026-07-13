import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useObra } from '../contexts/ObraContext'
import { useAuth } from '../contexts/AuthContext'
import {
  supabase, type Servico, type Unidade, type Empreiteiro,
  type Contrato, type ContratoItem,
} from '../lib/supabase'
import { STATUS_LABEL } from './Contratos'
import styles from './ContratoForm.module.css'

interface ItemNovo {
  chave: string
  servico_id: string | null
  servicoCodigo: string
  buscaAplicacao: string
  buscaAberta: boolean
  unidade_id: string
  quantidade: string
  valor_unitario: string
}

function itemVazio(): ItemNovo {
  return {
    chave: crypto.randomUUID(),
    servico_id: null,
    servicoCodigo: '',
    buscaAplicacao: '',
    buscaAberta: false,
    unidade_id: '',
    quantidade: '',
    valor_unitario: '',
  }
}

interface ItemEditavel extends ItemNovo {
  id: string | null
  removido: boolean
}

function itemEditVazio(): ItemEditavel {
  return { ...itemVazio(), id: null, removido: false }
}

// Supabase limita 1000 linhas por consulta — pagina até trazer tudo
async function carregarTodosServicos(): Promise<Servico[]> {
  const todos: Servico[] = []
  const PAGINA = 1000
  for (let de = 0; ; de += PAGINA) {
    const { data } = await supabase.from('servicos').select('*').eq('ativo', true).order('codigo')
      .range(de, de + PAGINA - 1)
    const lote = data ?? []
    todos.push(...lote)
    if (lote.length < PAGINA) break
  }
  return todos
}

export default function ContratoForm() {
  const { id } = useParams()
  const novo = id === 'novo'
  const navigate = useNavigate()
  const { obraAtiva } = useObra()
  const { perfil, temModulo } = useAuth()
  const podeEditar = perfil?.papel === 'admin' || temModulo('contratos')

  const [servicos, setServicos] = useState<Servico[]>([])
  const [unidades, setUnidades] = useState<Unidade[]>([])
  const [empreiteiros, setEmpreiteiros] = useState<Empreiteiro[]>([])

  const [empreiteiroId, setEmpreiteiroId] = useState('')
  const [objeto, setObjeto] = useState('')
  const [condicaoPagamento, setCondicaoPagamento] = useState('')
  const [retencaoPct, setRetencaoPct] = useState('')
  const [itens, setItens] = useState<ItemNovo[]>([itemVazio()])
  const [salvando, setSalvando] = useState(false)
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)

  const [contrato, setContrato] = useState<Contrato | null>(null)
  const [itensContrato, setItensContrato] = useState<ContratoItem[]>([])
  const [carregandoContrato, setCarregandoContrato] = useState(!novo)

  useEffect(() => {
    Promise.all([
      carregarTodosServicos(),
      supabase.from('empreiteiros').select('*').eq('ativo', true).order('nome'),
    ]).then(([svcs, e]) => {
      setServicos(svcs)
      setEmpreiteiros(e.data ?? [])
    })
  }, [])

  useEffect(() => {
    if (!obraAtiva) return
    supabase.from('unidades').select('*').eq('obra_id', obraAtiva.id).order('ordem')
      .then(({ data }) => setUnidades(data ?? []))
  }, [obraAtiva])

  useEffect(() => {
    if (!novo && id) carregarContrato(id)
  }, [id, novo])

  async function carregarContrato(contratoId: string) {
    setCarregandoContrato(true)
    const [{ data: c }, { data: its }] = await Promise.all([
      supabase.from('contratos').select('*').eq('id', contratoId).single(),
      supabase.from('contratos_itens').select('*').eq('contrato_id', contratoId).eq('ativo', true).order('criado_em'),
    ])
    setContrato(c ?? null)
    setItensContrato(its ?? [])
    setCarregandoContrato(false)
  }

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
      buscaAberta: false,
    } : it))
  }

  function removerItem(chave: string) {
    setItens(prev => prev.length > 1 ? prev.filter(it => it.chave !== chave) : prev)
  }

  async function criar() {
    if (!obraAtiva) return
    if (!empreiteiroId) {
      setMsg({ tipo: 'erro', texto: 'Selecione o empreiteiro.' })
      return
    }
    if (!objeto.trim()) {
      setMsg({ tipo: 'erro', texto: 'Informe o objeto do contrato.' })
      return
    }
    const itensValidos = itens.filter(it =>
      it.servico_id && it.unidade_id && Number(it.quantidade) > 0 && Number(it.valor_unitario) > 0
    )
    if (itensValidos.length === 0) {
      setMsg({ tipo: 'erro', texto: 'Adicione ao menos um item com serviço, unidade, quantidade e valor unitário.' })
      return
    }
    setSalvando(true)
    setMsg(null)
    const { data: novoContrato, error } = await supabase.from('contratos').insert({
      obra_id: obraAtiva.id,
      empreiteiro_id: empreiteiroId,
      objeto: objeto.trim(),
      condicao_pagamento: condicaoPagamento.trim() || null,
      retencao_pct: retencaoPct ? Number(retencaoPct) : null,
    }).select().single()
    if (error || !novoContrato) {
      setSalvando(false)
      setMsg({ tipo: 'erro', texto: `Erro ao criar contrato: ${error?.message}` })
      return
    }
    const { error: eItens } = await supabase.from('contratos_itens').insert(
      itensValidos.map(it => ({
        contrato_id: novoContrato.id,
        servico_id: it.servico_id,
        unidade_id: it.unidade_id,
        quantidade: Number(it.quantidade),
        valor_unitario: Number(it.valor_unitario),
        valor_total: Number(it.quantidade) * Number(it.valor_unitario),
      }))
    )
    setSalvando(false)
    if (eItens) {
      setMsg({ tipo: 'erro', texto: `Contrato criado, mas falhou ao salvar itens: ${eItens.message}` })
      return
    }
    navigate(`/contratos/${novoContrato.id}`, { replace: true })
  }

  if (perfil?.papel === 'cliente') {
    return <div className={styles.page}><p className={styles.vazio}>Módulo de uso interno da equipe.</p></div>
  }

  if (!novo) {
    if (carregandoContrato) return <div className={styles.page}><p className={styles.vazio}>Carregando…</p></div>
    if (!contrato) return <div className={styles.page}><p className={styles.vazio}>Contrato não encontrado.</p></div>
    return (
      <DetalheContrato
        contrato={contrato} itens={itensContrato} servicos={servicos} unidades={unidades} empreiteiros={empreiteiros}
        podeEditar={podeEditar} ehAdmin={perfil?.papel === 'admin'} perfilId={perfil?.id}
        onRecarregar={() => carregarContrato(contrato.id)}
      />
    )
  }

  if (!podeEditar) {
    return <div className={styles.page}><p className={styles.vazio}>Você não tem permissão para criar contratos.</p></div>
  }

  return (
    <div className={styles.page}>
      <button className={styles.voltar} onClick={() => navigate('/contratos')}>← Contratos</button>
      <h1>Novo contrato</h1>

      <div className={styles.bloco}>
        <label className={styles.campo}>
          Empreiteiro *
          <select value={empreiteiroId} onChange={e => setEmpreiteiroId(e.target.value)}>
            <option value="">Selecione…</option>
            {empreiteiros.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}
          </select>
        </label>
        <label className={styles.campo}>
          Objeto *
          <input value={objeto} onChange={e => setObjeto(e.target.value)}
            placeholder="Ex.: Hidráulica — 13 sobrados" />
        </label>
        <div className={styles.linha2}>
          <label className={styles.campo}>
            Condição de pagamento
            <input value={condicaoPagamento} onChange={e => setCondicaoPagamento(e.target.value)}
              placeholder="Ex.: medição quinzenal, 30 dias" />
          </label>
          <label className={styles.campo}>
            Retenção (%)
            <input type="number" min="0" max="100" step="0.1" value={retencaoPct}
              onChange={e => setRetencaoPct(e.target.value)} placeholder="Opcional" />
          </label>
        </div>
      </div>

      <div className={styles.bloco}>
        <h2>Itens</h2>
        {itens.map(it => {
          const sugestoes = it.buscaAberta ? sugestoesPara(it.buscaAplicacao) : []
          const servicoOrcado = servicos.find(s => s.id === it.servico_id)
          return (
            <div key={it.chave} className={styles.itemLinha}>
              {itens.length > 1 && (
                <button className={styles.btnRemoverItem} onClick={() => removerItem(it.chave)}>✕</button>
              )}
              <div className={styles.itemGrid}>
                <div className={styles.campo}>
                  Serviço *
                  <div className={styles.autocompleteWrap}>
                    <input
                      value={it.buscaAplicacao}
                      onChange={e => atualizarItem(it.chave, {
                        buscaAplicacao: e.target.value, servico_id: null, servicoCodigo: '', buscaAberta: true,
                      })}
                      onFocus={() => atualizarItem(it.chave, { buscaAberta: true })}
                      onBlur={() => setTimeout(() => atualizarItem(it.chave, { buscaAberta: false }), 150)}
                      placeholder="Ex.: hidráulica"
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
                    ? <span className={styles.vinculoOk}>✓ {it.servicoCodigo}{servicoOrcado?.valor_unit != null ? ` — orçado R$ ${servicoOrcado.valor_unit.toFixed(2)}` : ''}</span>
                    : <span className={styles.vinculoAusente}>⚠ selecione um serviço do orçamento</span>}
                </div>
                <label className={styles.campo}>
                  Unidade *
                  <select value={it.unidade_id} onChange={e => atualizarItem(it.chave, { unidade_id: e.target.value })}>
                    <option value="">Selecione…</option>
                    {unidades.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}
                  </select>
                </label>
                <label className={styles.campo}>
                  Quantidade *
                  <input type="number" min="0" step="0.0001" value={it.quantidade}
                    onChange={e => atualizarItem(it.chave, { quantidade: e.target.value })} />
                </label>
                <label className={styles.campo}>
                  Valor unit. (R$) *
                  <input type="number" min="0" step="0.01" value={it.valor_unitario}
                    onChange={e => atualizarItem(it.chave, { valor_unitario: e.target.value })} />
                </label>
              </div>
            </div>
          )
        })}
        <button className={styles.btnAddItem} onClick={() => setItens(prev => [...prev, itemVazio()])}>+ Adicionar item</button>
      </div>

      {msg && <p className={msg.tipo === 'ok' ? styles.msgOk : styles.msgErro}>{msg.texto}</p>}
      <button className={styles.btnPrincipal} onClick={criar} disabled={salvando}>
        {salvando ? 'Salvando…' : 'Criar contrato'}
      </button>
    </div>
  )
}

interface DetalheContratoProps {
  contrato: Contrato
  itens: ContratoItem[]
  servicos: Servico[]
  unidades: Unidade[]
  empreiteiros: Empreiteiro[]
  podeEditar: boolean
  ehAdmin: boolean
  perfilId: string | undefined
  onRecarregar: () => void
}

function DetalheContrato({ contrato, itens, servicos, unidades, empreiteiros, podeEditar, ehAdmin, perfilId, onRecarregar }: DetalheContratoProps) {
  const navigate = useNavigate()
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)
  const [processando, setProcessando] = useState(false)

  const [editando, setEditando] = useState(false)
  const [itensEdit, setItensEdit] = useState<ItemEditavel[]>([])
  const [salvandoItens, setSalvandoItens] = useState(false)

  const nomeServico = new Map(servicos.map(s => [s.id, s]))
  const nomeUnidade = new Map(unidades.map(u => [u.id, u.nome]))
  const empreiteiro = empreiteiros.find(e => e.id === contrato.empreiteiro_id)

  const podeEditarItens = podeEditar && contrato.status === 'rascunho'

  function abrirEdicaoItens() {
    setItensEdit(itens.map(it => {
      const s = nomeServico.get(it.servico_id)
      return {
        id: it.id,
        chave: it.id,
        servico_id: it.servico_id,
        servicoCodigo: s?.codigo || s?.nome || '',
        buscaAplicacao: `${s?.codigo ?? ''} ${s?.nome ?? ''}`.trim(),
        buscaAberta: false,
        unidade_id: it.unidade_id,
        quantidade: String(it.quantidade),
        valor_unitario: String(it.valor_unitario),
        removido: false,
      }
    }))
    setEditando(true)
  }

  function sugestoesPara(texto: string): Servico[] {
    const t = texto.trim().toLowerCase()
    if (!t) return servicos
    return servicos.filter(s => s.nome.toLowerCase().includes(t) || (s.codigo ?? '').toLowerCase().includes(t))
  }

  function atualizarItemEdit(chave: string, patch: Partial<ItemEditavel>) {
    setItensEdit(prev => prev.map(it => it.chave === chave ? { ...it, ...patch } : it))
  }

  function escolherServicoEdit(chave: string, s: Servico) {
    setItensEdit(prev => prev.map(it => it.chave === chave ? {
      ...it, servico_id: s.id, servicoCodigo: s.codigo || s.nome,
      buscaAplicacao: `${s.codigo ?? ''} ${s.nome}`.trim(), buscaAberta: false,
    } : it))
  }

  async function salvarItens() {
    setSalvandoItens(true)
    setMsg(null)
    for (const it of itensEdit) {
      if (it.removido) {
        if (it.id) {
          const { error } = await supabase.from('contratos_itens').update({ ativo: false }).eq('id', it.id)
          if (error) { setSalvandoItens(false); setMsg({ tipo: 'erro', texto: `Erro ao remover item: ${error.message}` }); return }
        }
        continue
      }
      if (!it.servico_id || !it.unidade_id || !(Number(it.quantidade) > 0) || !(Number(it.valor_unitario) > 0)) continue
      const valores = {
        servico_id: it.servico_id,
        unidade_id: it.unidade_id,
        quantidade: Number(it.quantidade),
        valor_unitario: Number(it.valor_unitario),
        valor_total: Number(it.quantidade) * Number(it.valor_unitario),
      }
      const { error } = it.id
        ? await supabase.from('contratos_itens').update(valores).eq('id', it.id)
        : await supabase.from('contratos_itens').insert({ ...valores, contrato_id: contrato.id })
      if (error) { setSalvandoItens(false); setMsg({ tipo: 'erro', texto: `Erro ao salvar item: ${error.message}` }); return }
    }
    setSalvandoItens(false)
    setEditando(false)
    onRecarregar()
  }

  async function ativarContrato() {
    setProcessando(true)
    const { error } = await supabase.from('contratos').update({
      status: 'ativo', ativado_por: perfilId, ativado_em: new Date().toISOString(),
    }).eq('id', contrato.id)
    setProcessando(false)
    if (error) { setMsg({ tipo: 'erro', texto: `Erro ao ativar: ${error.message}` }); return }
    onRecarregar()
  }

  async function encerrarContrato() {
    if (!confirm('Encerrar este contrato? Ele deixará de aceitar alterações.')) return
    setProcessando(true)
    const { error } = await supabase.from('contratos').update({
      status: 'encerrado', encerrado_por: perfilId, encerrado_em: new Date().toISOString(),
    }).eq('id', contrato.id)
    setProcessando(false)
    if (error) { setMsg({ tipo: 'erro', texto: `Erro ao encerrar: ${error.message}` }); return }
    onRecarregar()
  }

  return (
    <div className={styles.page}>
      <button className={styles.voltar} onClick={() => navigate('/contratos')}>← Contratos</button>
      <div className={styles.header}>
        <h1>{contrato.numero}</h1>
        <span className={`${styles.chip} ${styles[`chip_${contrato.status}`]}`}>{STATUS_LABEL[contrato.status]}</span>
      </div>

      <div className={styles.bloco}>
        <div className={styles.metaLista}>
          <span>👷 {empreiteiro?.nome ?? '—'}</span>
          {contrato.condicao_pagamento && <span>💳 {contrato.condicao_pagamento}</span>}
          {contrato.retencao_pct != null && <span>🔒 Retenção {contrato.retencao_pct}%</span>}
        </div>
        <p>{contrato.objeto}</p>
        <p><strong>Valor total: R$ {contrato.valor_total.toFixed(2)}</strong></p>
      </div>

      {ehAdmin && contrato.status === 'rascunho' && (
        <div className={styles.bloco}>
          <button className={styles.btnPrincipal} onClick={ativarContrato} disabled={processando}>
            {processando ? 'Ativando…' : 'Ativar contrato'}
          </button>
        </div>
      )}
      {ehAdmin && contrato.status === 'ativo' && (
        <div className={styles.bloco}>
          <button className={styles.btnSecundario} onClick={encerrarContrato} disabled={processando}>
            {processando ? 'Encerrando…' : 'Encerrar contrato'}
          </button>
        </div>
      )}

      {msg && <p className={msg.tipo === 'ok' ? styles.msgOk : styles.msgErro}>{msg.texto}</p>}

      <div className={styles.bloco}>
        <h2>Itens</h2>
        {!editando && (
          <>
            <table className={styles.tabelaComparativa}>
              <thead>
                <tr><th>Serviço</th><th>Unidade</th><th>Qtd.</th><th>Valor unit.</th><th>Valor total</th><th>Orçado (unit.)</th></tr>
              </thead>
              <tbody>
                {itens.map(it => {
                  const s = nomeServico.get(it.servico_id)
                  return (
                    <tr key={it.id}>
                      <td>{s?.codigo ? `${s.codigo} — ` : ''}{s?.nome ?? '—'}</td>
                      <td>{nomeUnidade.get(it.unidade_id) ?? '—'}</td>
                      <td>{it.quantidade}</td>
                      <td>R$ {it.valor_unitario.toFixed(2)}</td>
                      <td>R$ {it.valor_total.toFixed(2)}</td>
                      <td>{s?.valor_unit != null ? `R$ ${s.valor_unit.toFixed(2)}` : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {podeEditarItens && (
              <button className={styles.btnSecundario} onClick={abrirEdicaoItens} style={{ marginTop: 10 }}>Editar itens</button>
            )}
          </>
        )}

        {editando && (
          <>
            {itensEdit.filter(it => !it.removido).map(it => {
              const sugestoes = it.buscaAberta ? sugestoesPara(it.buscaAplicacao) : []
              return (
                <div key={it.chave} className={styles.itemLinha}>
                  <button className={styles.btnRemoverItem} onClick={() => atualizarItemEdit(it.chave, { removido: true })}>✕</button>
                  <div className={styles.itemGrid}>
                    <div className={styles.campo}>
                      Serviço *
                      <div className={styles.autocompleteWrap}>
                        <input
                          value={it.buscaAplicacao}
                          onChange={e => atualizarItemEdit(it.chave, {
                            buscaAplicacao: e.target.value, servico_id: null, servicoCodigo: '', buscaAberta: true,
                          })}
                          onFocus={() => atualizarItemEdit(it.chave, { buscaAberta: true })}
                          onBlur={() => setTimeout(() => atualizarItemEdit(it.chave, { buscaAberta: false }), 150)}
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
                        ? <span className={styles.vinculoOk}>✓ {it.servicoCodigo}</span>
                        : <span className={styles.vinculoAusente}>⚠ selecione um serviço</span>}
                    </div>
                    <label className={styles.campo}>
                      Unidade *
                      <select value={it.unidade_id} onChange={e => atualizarItemEdit(it.chave, { unidade_id: e.target.value })}>
                        <option value="">Selecione…</option>
                        {unidades.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}
                      </select>
                    </label>
                    <label className={styles.campo}>
                      Quantidade *
                      <input type="number" min="0" step="0.0001" value={it.quantidade}
                        onChange={e => atualizarItemEdit(it.chave, { quantidade: e.target.value })} />
                    </label>
                    <label className={styles.campo}>
                      Valor unit. (R$) *
                      <input type="number" min="0" step="0.01" value={it.valor_unitario}
                        onChange={e => atualizarItemEdit(it.chave, { valor_unitario: e.target.value })} />
                    </label>
                  </div>
                </div>
              )
            })}
            <button className={styles.btnAddItem} onClick={() => setItensEdit(prev => [...prev, itemEditVazio()])}>+ Adicionar item</button>
            <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
              <button className={styles.btnPrincipal} onClick={salvarItens} disabled={salvandoItens}>
                {salvandoItens ? 'Salvando…' : 'Salvar itens'}
              </button>
              <button className={styles.btnSecundario} onClick={() => setEditando(false)}>Cancelar</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
