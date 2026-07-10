import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useObra } from '../contexts/ObraContext'
import { supabase, type PedidoCompra, type PedidoCompraItem, type StatusPedidoCompra } from '../lib/supabase'
import styles from './Compras.module.css'

export const STATUS_LABEL: Record<StatusPedidoCompra, string> = {
  rascunho: 'Rascunho',
  em_cotacao: 'Em cotação',
  aprovado: 'Aprovado',
  enviado: 'Enviado',
  recebido_parcial: 'Recebido parcial',
  recebido_total: 'Recebido total',
  conferido_nf: 'Conferido com NF',
  encerrado: 'Encerrado',
  cancelado: 'Cancelado',
}

export default function Compras() {
  const { perfil, temModulo } = useAuth()
  const { obraAtiva } = useObra()
  const navigate = useNavigate()
  const podeEditar = perfil?.papel === 'admin' || temModulo('compras')

  const [pedidos, setPedidos] = useState<PedidoCompra[]>([])
  const [itensPorPedido, setItensPorPedido] = useState<Map<string, PedidoCompraItem[]>>(new Map())
  const [carregando, setCarregando] = useState(true)
  const [filtroStatus, setFiltroStatus] = useState<StatusPedidoCompra | ''>('')
  const [somenteUrgente, setSomenteUrgente] = useState(false)

  useEffect(() => {
    if (!obraAtiva) return
    setCarregando(true)
    supabase.from('pedidos_compra').select('*').eq('obra_id', obraAtiva.id).eq('ativo', true)
      .order('numero', { ascending: false })
      .then(async ({ data }) => {
        const lista = data ?? []
        setPedidos(lista)
        const { data: itens } = await supabase.from('pedidos_compra_itens').select('*')
          .in('pedido_id', lista.map(p => p.id)).eq('ativo', true)
        const mapa = new Map<string, PedidoCompraItem[]>()
        for (const it of itens ?? []) {
          const arr = mapa.get(it.pedido_id) ?? []
          arr.push(it)
          mapa.set(it.pedido_id, arr)
        }
        setItensPorPedido(mapa)
        setCarregando(false)
      })
  }, [obraAtiva])

  function temItemUrgente(pedidoId: string): boolean {
    return (itensPorPedido.get(pedidoId) ?? []).some(i => i.urgente)
  }

  const filtrados = useMemo(() => {
    return pedidos.filter(p =>
      (!filtroStatus || p.status === filtroStatus) &&
      (!somenteUrgente || temItemUrgente(p.id))
    )
  }, [pedidos, itensPorPedido, filtroStatus, somenteUrgente])

  if (perfil?.papel === 'cliente') {
    return <div className={styles.page}><p className={styles.vazio}>Módulo de uso interno da equipe.</p></div>
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1>Compras</h1>
          <p className={styles.sub}>Pedidos vinculados ao orçamento — cotação, aprovação e recebimento.</p>
        </div>
        <div className={styles.acoesHeader}>
          <button className={styles.btnSecundario} onClick={() => navigate('/fornecedores')}>Fornecedores</button>
          {podeEditar && (
            <button className={styles.btnNova} onClick={() => navigate('/compras/novo')}>+ Novo pedido</button>
          )}
        </div>
      </div>

      <div className={styles.filtros}>
        <select className={styles.selectFiltro} value={filtroStatus}
          onChange={e => setFiltroStatus(e.target.value as StatusPedidoCompra | '')}>
          <option value="">Todos os status</option>
          {(Object.keys(STATUS_LABEL) as StatusPedidoCompra[]).map(s => (
            <option key={s} value={s}>{STATUS_LABEL[s]}</option>
          ))}
        </select>
        <select className={styles.selectFiltro} value={somenteUrgente ? '1' : ''}
          onChange={e => setSomenteUrgente(e.target.value === '1')}>
          <option value="">Todos os pedidos</option>
          <option value="1">Só com item urgente</option>
        </select>
      </div>

      {carregando && <p className={styles.vazio}>Carregando…</p>}
      {!carregando && filtrados.length === 0 && (
        <p className={styles.vazio}>{pedidos.length === 0 ? 'Nenhum pedido registrado.' : 'Nenhum pedido com esses filtros.'}</p>
      )}

      {filtrados.map(p => (
        <button key={p.id} className={`${styles.card} ${temItemUrgente(p.id) ? styles.cardUrgente : ''}`}
          onClick={() => navigate(`/compras/${p.id}`)}>
          <div className={styles.cardTopo}>
            <span className={styles.cardNumero}>Pedido {String(p.numero).padStart(3, '0')}</span>
            <span className={`${styles.chip} ${styles[`chip_${p.status}`]}`}>{STATUS_LABEL[p.status]}</span>
          </div>
          <div className={styles.cardDesc}>{p.descricao || '(sem descrição)'}</div>
          <div className={styles.cardRodape}>
            <span>{(itensPorPedido.get(p.id) ?? []).length} item(ns)</span>
            {temItemUrgente(p.id) && <span className={styles.urgenteTag}>⚡ urgente</span>}
          </div>
        </button>
      ))}
    </div>
  )
}
