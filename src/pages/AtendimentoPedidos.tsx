import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useObra } from '../contexts/ObraContext'
import { dataHoje } from '../lib/almoxarifado'
import { supabase, type FerramentaLocacao, type PedidoCompra, type PedidoCompraItem } from '../lib/supabase'
import styles from './AtendimentoPedidos.module.css'

type Mensagem = { tipo: 'ok' | 'erro'; texto: string } | null
type Filtro = '' | 'material' | 'servico' | 'locacao'

const NATUREZA_LABEL = { material: 'Material', servico: 'Serviço', locacao: 'Locação' } as const

function quantidadeAtendida(item: PedidoCompraItem) {
  return item.natureza === 'material' ? item.quantidade_recebida : item.quantidade_executada
}

function formatarQuantidade(qtd: number, und: string | null) {
  return `${qtd} ${und ?? 'un.'}`
}

export default function AtendimentoPedidos() {
  const { perfil, temModulo } = useAuth()
  const { obraAtiva } = useObra()
  const navigate = useNavigate()
  const podeAtender = perfil?.papel === 'admin' || temModulo('atendimento_pedidos')
  const [pedidos, setPedidos] = useState<PedidoCompra[]>([])
  const [itens, setItens] = useState<PedidoCompraItem[]>([])
  const [locacoes, setLocacoes] = useState<FerramentaLocacao[]>([])
  const [devolvidos, setDevolvidos] = useState<Map<string, number>>(new Map())
  const [carregando, setCarregando] = useState(true)
  const [filtro, setFiltro] = useState<Filtro>('')
  const [busca, setBusca] = useState('')
  const [itemExecutando, setItemExecutando] = useState<PedidoCompraItem | null>(null)
  const [itemLocando, setItemLocando] = useState<PedidoCompraItem | null>(null)
  const [msg, setMsg] = useState<Mensagem>(null)

  async function carregar() {
    if (!obraAtiva || !podeAtender) return
    setCarregando(true)
    const { data: listaPedidos, error: erroPedidos } = await supabase.from('pedidos_compra').select('*')
      .eq('obra_id', obraAtiva.id).eq('ativo', true)
      .in('status', ['enviado', 'recebido_parcial', 'recebido_total'])
      .order('numero', { ascending: false })
    if (erroPedidos) {
      setMsg({ tipo: 'erro', texto: `Não foi possível carregar os pedidos: ${erroPedidos.message}` })
      setCarregando(false)
      return
    }
    const idsPedidos = (listaPedidos ?? []).map(p => p.id)
    if (idsPedidos.length === 0) {
      setPedidos([]); setItens([]); setLocacoes([]); setDevolvidos(new Map()); setCarregando(false)
      return
    }
    const { data: listaItens, error: erroItens } = await supabase.from('pedidos_compra_itens').select('*')
      .in('pedido_id', idsPedidos).eq('ativo', true).order('criado_em')
    if (erroItens) {
      setMsg({ tipo: 'erro', texto: `Não foi possível carregar os itens: ${erroItens.message}` })
      setCarregando(false)
      return
    }
    const idsLocacao = (listaItens ?? []).filter(i => i.natureza === 'locacao').map(i => i.id)
    const { data: listaLocacoes, error: erroLocacoes } = idsLocacao.length
      ? await supabase.from('ferramenta_locacoes').select('*').in('pedido_item_id', idsLocacao).eq('ativo', true)
      : { data: [], error: null }
    if (erroLocacoes) {
      setMsg({ tipo: 'erro', texto: `Não foi possível carregar as locações: ${erroLocacoes.message}` })
      setCarregando(false)
      return
    }
    const abertas = (listaLocacoes ?? []).filter(l => !l.data_entregue).map(l => l.id)
    const { data: listaDevolucoes, error: erroDevolucoes } = abertas.length
      ? await supabase.from('ferramenta_locacoes_devolucoes').select('locacao_id, quantidade').in('locacao_id', abertas)
      : { data: [], error: null }
    if (erroDevolucoes) {
      setMsg({ tipo: 'erro', texto: `Não foi possível carregar as devoluções: ${erroDevolucoes.message}` })
      setCarregando(false)
      return
    }
    const mapa = new Map<string, number>()
    for (const devolucao of listaDevolucoes ?? []) mapa.set(devolucao.locacao_id, (mapa.get(devolucao.locacao_id) ?? 0) + devolucao.quantidade)
    setPedidos(listaPedidos ?? []); setItens(listaItens ?? []); setLocacoes(listaLocacoes ?? []); setDevolvidos(mapa); setCarregando(false)
  }

  useEffect(() => { carregar() }, [obraAtiva, podeAtender])

  const pedidoPorId = useMemo(() => new Map(pedidos.map(p => [p.id, p])), [pedidos])
  const locacaoPorItemId = useMemo(() => new Map(locacoes.filter(l => l.pedido_item_id).map(l => [l.pedido_item_id!, l])), [locacoes])
  const linhas = useMemo(() => {
    const termo = busca.trim().toLowerCase()
    return itens.filter(item => {
      const pedido = pedidoPorId.get(item.pedido_id)
      return (!filtro || item.natureza === filtro)
        && (!termo || item.descricao_item.toLowerCase().includes(termo) || String(pedido?.numero).includes(termo))
    })
  }, [itens, pedidoPorId, filtro, busca])

  if (!podeAtender) return <div className={styles.page}><p className={styles.vazio}>Você não tem acesso ao Atendimento de pedidos.</p></div>

  return <div className={styles.page}>
    <div className={styles.header}>
      <div><h1>Atendimento de pedidos</h1><p className={styles.sub}>Confirme serviços e locações. Materiais continuam sendo recebidos pelo Almoxarifado.</p></div>
      <button className={styles.btnSecundario} onClick={carregar}>Atualizar</button>
    </div>
    <div className={styles.filtros}>
      <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar pedido ou item…" />
      <select value={filtro} onChange={e => setFiltro(e.target.value as Filtro)}>
        <option value="">Todas as naturezas</option><option value="material">Material</option><option value="servico">Serviço</option><option value="locacao">Locação</option>
      </select>
    </div>
    {msg && <p className={msg.tipo === 'ok' ? styles.msgOk : styles.msgErro}>{msg.texto}</p>}
    {carregando && <p className={styles.vazio}>Carregando…</p>}
    {!carregando && linhas.length === 0 && <p className={styles.vazio}>Não há itens de pedidos abertos para atendimento.</p>}
    <div className={styles.lista}>
      {linhas.map(item => {
        const pedido = pedidoPorId.get(item.pedido_id)
        const atendida = quantidadeAtendida(item)
        const saldo = Math.max(0, item.quantidade_pedida - atendida)
        const locacao = item.natureza === 'locacao' ? locacaoPorItemId.get(item.id) : undefined
        const devolvido = locacao ? devolvidos.get(locacao.id) ?? 0 : 0
        return <article key={item.id} className={styles.card}>
          <div className={styles.cardTopo}><span className={`${styles.natureza} ${styles[`natureza_${item.natureza}`]}`}>{NATUREZA_LABEL[item.natureza]}</span><span>PC-{String(pedido?.numero ?? 0).padStart(3, '0')}</span></div>
          <h2>{item.descricao_item}</h2>
          <p>{formatarQuantidade(atendida, item.und)} atendido de {formatarQuantidade(item.quantidade_pedida, item.und)} · saldo {formatarQuantidade(saldo, item.und)}</p>
          {item.natureza === 'material' && <button className={styles.btnSecundario} onClick={() => navigate('/almoxarifado')}>Receber no Almoxarifado →</button>}
          {item.natureza === 'servico' && (saldo > 0 ? <button className={styles.btnPrincipal} onClick={() => setItemExecutando(item)}>Registrar execução</button> : <span className={styles.concluido}>✓ Serviço executado integralmente</span>)}
          {item.natureza === 'locacao' && (!locacao ? <button className={styles.btnPrincipal} onClick={() => setItemLocando(item)}>Registrar chegada</button> : locacao.data_entregue ? <span className={styles.concluido}>✓ Locação encerrada em {locacao.data_entregue.split('-').reverse().join('/')}</span> : <div className={styles.acoes}><span className={styles.emOperacao}>Em operação · {devolvido} de {locacao.quantidade} devolvido</span><button className={styles.btnSecundario} onClick={() => navegarParaLocacao(navigate)}>Abrir Aluguéis →</button><button className={styles.btnPrincipal} onClick={() => registrarDevolucao(locacao, locacao.quantidade - devolvido, carregar, setMsg)}>Registrar entrega</button></div>)}
        </article>
      })}
    </div>
    {itemExecutando && <PainelExecucao item={itemExecutando} onFechar={() => setItemExecutando(null)} onSucesso={async texto => { setItemExecutando(null); setMsg({ tipo: 'ok', texto }); await carregar() }} />}
    {itemLocando && <PainelLocacao item={itemLocando} obraId={obraAtiva?.id ?? ''} onFechar={() => setItemLocando(null)} onSucesso={async texto => { setItemLocando(null); setMsg({ tipo: 'ok', texto }); await carregar() }} />}
  </div>
}

function navegarParaLocacao(navigate: ReturnType<typeof useNavigate>) { navigate('/almoxarifado') }

async function registrarDevolucao(locacao: FerramentaLocacao, saldo: number, recarregar: () => Promise<void>, setMsg: (m: Mensagem) => void) {
  if (saldo <= 0) return
  const { error } = await supabase.from('ferramenta_locacoes_devolucoes').insert({ locacao_id: locacao.id, quantidade: saldo })
  if (error) { setMsg({ tipo: 'erro', texto: `Falha ao registrar entrega: ${error.message}` }); return }
  setMsg({ tipo: 'ok', texto: 'Entrega registrada.' }); await recarregar()
}

function PainelExecucao({ item, onFechar, onSucesso }: { item: PedidoCompraItem; onFechar: () => void; onSucesso: (texto: string) => void }) {
  const saldo = item.quantidade_pedida - item.quantidade_executada
  const [quantidade, setQuantidade] = useState(String(saldo))
  const [data, setData] = useState(dataHoje())
  const [observacao, setObservacao] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  async function salvar() {
    const qtd = Number(quantidade)
    if (!Number.isFinite(qtd) || qtd <= 0 || qtd > saldo) { setErro(`Informe quantidade maior que zero e até o saldo (${saldo}).`); return }
    if (!data) { setErro('Informe a data da execução.'); return }
    setSalvando(true); setErro('')
    const { error } = await supabase.from('pedido_item_execucoes').insert({ pedido_item_id: item.id, quantidade: qtd, data_execucao: data, observacao: observacao.trim() || null })
    setSalvando(false)
    if (error) { setErro(error.message); return }
    onSucesso('Execução registrada e saldo atualizado.')
  }
  return <div className={styles.overlay} role="dialog" aria-modal="true" aria-label="Registrar execução"><div className={styles.painel}><h2>Registrar execução</h2><p>{item.descricao_item} · saldo: {formatarQuantidade(saldo, item.und)}</p><label>Quantidade executada<input type="number" min="0.0001" max={saldo} step="0.01" value={quantidade} onChange={e => setQuantidade(e.target.value)} /></label><label>Data da execução<input type="date" value={data} onChange={e => setData(e.target.value)} /></label><label>Observação<textarea value={observacao} onChange={e => setObservacao(e.target.value)} placeholder="Ex.: viagem realizada para transporte de brita" /></label>{erro && <p className={styles.msgErro}>{erro}</p>}<div className={styles.acoes}><button className={styles.btnSecundario} onClick={onFechar}>Cancelar</button><button className={styles.btnPrincipal} disabled={salvando} onClick={salvar}>{salvando ? 'Registrando…' : 'Confirmar execução'}</button></div></div></div>
}

function PainelLocacao({ item, obraId, onFechar, onSucesso }: { item: PedidoCompraItem; obraId: string; onFechar: () => void; onSucesso: (texto: string) => void }) {
  const [locadora, setLocadora] = useState('')
  const [modalidade, setModalidade] = useState<'horaria' | 'diaria' | 'semanal' | 'mensal'>('diaria')
  const [quantidade, setQuantidade] = useState(String(item.quantidade_pedida))
  const [chegada, setChegada] = useState(dataHoje())
  const [entrega, setEntrega] = useState('')
  const [observacao, setObservacao] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  async function salvar() {
    if (!locadora.trim() || !chegada || !entrega) { setErro('Informe locadora, chegada e entrega prevista.'); return }
    if (entrega < chegada) { setErro('A entrega prevista não pode ser anterior à chegada.'); return }
    const qtd = Number(quantidade)
    if (!Number.isFinite(qtd) || qtd <= 0 || qtd > item.quantidade_pedida || (modalidade !== 'horaria' && !Number.isInteger(qtd))) { setErro(modalidade === 'horaria' ? `Informe horas trabalhadas maior que zero e até o saldo (${item.quantidade_pedida}). Pode usar fração.` : `Informe quantidade inteira maior que zero e até o saldo (${item.quantidade_pedida}).`); return }
    setSalvando(true); setErro('')
    const { error } = await supabase.from('ferramenta_locacoes').insert({ obra_id: obraId, pedido_item_id: item.id, nome_equipamento: item.descricao_item, quantidade: qtd, locadora: locadora.trim(), modalidade, data_chegada: chegada, data_entrega_prevista: entrega, observacao: observacao.trim() || null })
    setSalvando(false)
    if (error) { setErro(error.message); return }
    onSucesso('Locação iniciada e vinculada ao pedido.')
  }
  return <div className={styles.overlay} role="dialog" aria-modal="true" aria-label="Registrar chegada da locação"><div className={styles.painel}><h2>Registrar chegada</h2><p>{item.descricao_item} · saldo do pedido: {formatarQuantidade(item.quantidade_pedida, item.und)}</p><label>Locadora<input value={locadora} onChange={e => setLocadora(e.target.value)} /></label><label>Modalidade<select value={modalidade} onChange={e => setModalidade(e.target.value as typeof modalidade)}><option value="horaria">Por horas</option><option value="diaria">Diária</option><option value="semanal">Semanal</option><option value="mensal">Mensal</option></select></label><label>{modalidade === 'horaria' ? 'Horas trabalhadas' : 'Quantidade'}<input type="number" min="0.01" max={item.quantidade_pedida} step={modalidade === 'horaria' ? '0.01' : '1'} value={quantidade} onChange={e => setQuantidade(e.target.value)} /></label><label>Chegada real<input type="date" value={chegada} onChange={e => setChegada(e.target.value)} /></label><label>Entrega prevista<input type="date" value={entrega} onChange={e => setEntrega(e.target.value)} /></label><label>Observação<textarea value={observacao} onChange={e => setObservacao(e.target.value)} /></label>{erro && <p className={styles.msgErro}>{erro}</p>}<div className={styles.acoes}><button className={styles.btnSecundario} onClick={onFechar}>Cancelar</button><button className={styles.btnPrincipal} disabled={salvando} onClick={salvar}>{salvando ? 'Iniciando…' : 'Iniciar locação'}</button></div></div></div>
}
