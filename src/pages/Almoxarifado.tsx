import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useObra } from '../contexts/ObraContext'
import {
  supabase, type Material, type CategoriaMaterial, type EstoqueMovimento, type Unidade,
  type PedidoCompra, type PedidoCompraItem,
} from '../lib/supabase'
import styles from './Almoxarifado.module.css'

type Aba = 'estoque' | 'ferramentas' | 'requisicoes'

const CATEGORIA_LABEL: Record<CategoriaMaterial, string> = {
  material: 'Material',
  epi: 'EPI',
  escritorio: 'Escritório',
}

const fmtDataHora = (iso: string) => {
  const d = new Date(iso)
  return `${d.toLocaleDateString('pt-BR')} ${d.toLocaleTimeString('pt-BR').slice(0, 5)}`
}

export default function Almoxarifado() {
  const { perfil } = useAuth()
  const [aba, setAba] = useState<Aba>('estoque')

  if (perfil?.papel === 'cliente') {
    return (
      <div className={styles.page}>
        <h1>Almoxarifado</h1>
        <p className={styles.vazio}>Este módulo é de uso interno da equipe de obra.</p>
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1>Almoxarifado</h1>
          <p className={styles.sub}>Estoque de materiais e EPIs, ferramentas e requisições.</p>
        </div>
      </div>

      <div className={styles.abas}>
        <button className={`${styles.aba} ${aba === 'estoque' ? styles.abaAtiva : ''}`} onClick={() => setAba('estoque')}>
          Estoque
        </button>
        <button className={`${styles.aba} ${aba === 'ferramentas' ? styles.abaAtiva : ''}`} onClick={() => setAba('ferramentas')}>
          Ferramentas
        </button>
        <button className={`${styles.aba} ${aba === 'requisicoes' ? styles.abaAtiva : ''}`} onClick={() => setAba('requisicoes')}>
          Requisições
        </button>
      </div>

      {aba === 'estoque' && <AbaEstoque />}
      {aba === 'ferramentas' && <EmBreve texto="Empréstimo e devolução de ferramentas em breve." />}
      {aba === 'requisicoes' && <EmBreve texto="Blocos de requisição em breve." />}
    </div>
  )
}

function EmBreve({ texto }: { texto: string }) {
  return <p className={styles.vazio}>{texto}</p>
}

function AbaEstoque() {
  const { perfil } = useAuth()
  const { obraAtiva } = useObra()
  const admin = perfil?.papel === 'admin'

  const [materiais, setMateriais] = useState<Material[]>([])
  const [saldos, setSaldos] = useState<Map<string, number>>(new Map())
  const [unidades, setUnidades] = useState<Unidade[]>([])
  const [carregando, setCarregando] = useState(true)

  const [busca, setBusca] = useState('')
  const [filtroCategoria, setFiltroCategoria] = useState<CategoriaMaterial | ''>('')
  const [soAbaixoMinimo, setSoAbaixoMinimo] = useState(false)

  const [materialSel, setMaterialSel] = useState<Material | null>(null)
  const [movimentos, setMovimentos] = useState<EstoqueMovimento[]>([])
  const [autores, setAutores] = useState<Map<string, string>>(new Map())
  const [carregandoExtrato, setCarregandoExtrato] = useState(false)
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)

  const [mostrarEntrada, setMostrarEntrada] = useState(false)

  useEffect(() => {
    if (!obraAtiva) return
    setCarregando(true)
    Promise.all([
      supabase.from('materiais').select('*').eq('obra_id', obraAtiva.id).eq('ativo', true).order('nome'),
      supabase.from('estoque_saldos').select('*'),
      supabase.from('unidades').select('*').eq('obra_id', obraAtiva.id).order('ordem'),
    ]).then(([m, s, u]) => {
      setMateriais(m.data ?? [])
      setSaldos(new Map((s.data ?? []).map((r: { material_id: string; saldo: number }) => [r.material_id, r.saldo])))
      setUnidades(u.data ?? [])
      setCarregando(false)
    })
  }, [obraAtiva])

  const nomeUnidade = useMemo(() => new Map(unidades.map(u => [u.id, u.nome])), [unidades])

  const abaixoMinimo = (m: Material) => m.estoque_minimo !== null && (saldos.get(m.id) ?? 0) < m.estoque_minimo

  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase()
    return materiais.filter(m =>
      (!termo || m.codigo.toLowerCase().includes(termo) || m.nome.toLowerCase().includes(termo)) &&
      (!filtroCategoria || m.categoria === filtroCategoria) &&
      (!soAbaixoMinimo || abaixoMinimo(m))
    )
  }, [materiais, busca, filtroCategoria, soAbaixoMinimo, saldos])

  async function abrirExtrato(m: Material) {
    setMaterialSel(m)
    setMsg(null)
    setCarregandoExtrato(true)
    const { data: movs } = await supabase.from('estoque_movimentos').select('*')
      .eq('material_id', m.id).order('criado_em', { ascending: false })
    setMovimentos(movs ?? [])
    const idsAutores = [...new Set((movs ?? []).map(mv => mv.criado_por))]
    if (idsAutores.length) {
      const { data: perfis } = await supabase.from('perfis_usuario').select('id, nome').in('id', idsAutores)
      setAutores(new Map((perfis ?? []).map(u => [u.id, u.nome])))
    } else {
      setAutores(new Map())
    }
    setCarregandoExtrato(false)
  }

  async function recarregarSaldos() {
    const { data: s } = await supabase.from('estoque_saldos').select('*')
    setSaldos(new Map((s ?? []).map((r: { material_id: string; saldo: number }) => [r.material_id, r.saldo])))
  }

  function materialCriado(m: Material) {
    setMateriais(prev => [...prev, m].sort((a, b) => a.nome.localeCompare(b.nome)))
  }

  async function inativarMovimento(mv: EstoqueMovimento) {
    if (!window.confirm('Inativar este movimento? Ele deixa de contar no saldo, mas o registro é mantido no histórico (exclusão lógica).')) return
    const { error } = await supabase.from('estoque_movimentos').update({ ativo: false }).eq('id', mv.id)
    if (error) { setMsg({ tipo: 'erro', texto: `Erro ao inativar: ${error.message}` }); return }
    // recarrega saldos + extrato do material aberto
    const [{ data: s }, { data: movs }] = await Promise.all([
      supabase.from('estoque_saldos').select('*'),
      materialSel ? supabase.from('estoque_movimentos').select('*').eq('material_id', materialSel.id).order('criado_em', { ascending: false }) : Promise.resolve({ data: null }),
    ])
    setSaldos(new Map((s ?? []).map((r: { material_id: string; saldo: number }) => [r.material_id, r.saldo])))
    if (movs) setMovimentos(movs)
    setMsg({ tipo: 'ok', texto: 'Movimento inativado.' })
  }

  return (
    <div>
      <div className={styles.topoAcoes}>
        <button className={styles.btnPrincipal} onClick={() => setMostrarEntrada(true)}>+ Entrada de material</button>
      </div>

      {mostrarEntrada && (
        <PainelEntrada
          materiais={materiais}
          onFechar={() => setMostrarEntrada(false)}
          onMaterialCriado={materialCriado}
          onSucesso={async () => {
            await recarregarSaldos()
            setMostrarEntrada(false)
            setMsg({ tipo: 'ok', texto: 'Entrada registrada.' })
          }}
        />
      )}

      <div className={styles.filtros}>
        <input className={styles.busca} value={busca} onChange={e => setBusca(e.target.value)}
          placeholder="Buscar por código ou nome…" />
        <select className={styles.selectFiltro} value={filtroCategoria} onChange={e => setFiltroCategoria(e.target.value as CategoriaMaterial | '')}>
          <option value="">Todas as categorias</option>
          <option value="material">Material</option>
          <option value="epi">EPI</option>
          <option value="escritorio">Escritório</option>
        </select>
        <label className={styles.checkFiltro}>
          <input type="checkbox" checked={soAbaixoMinimo} onChange={e => setSoAbaixoMinimo(e.target.checked)} />
          Só abaixo do mínimo
        </label>
      </div>

      {msg && !materialSel && <p className={msg.tipo === 'ok' ? styles.msgOk : styles.msgErro}>{msg.texto}</p>}

      {carregando && <p className={styles.vazio}>Carregando…</p>}
      {!carregando && filtrados.length === 0 && (
        <p className={styles.vazio}>
          {materiais.length === 0 ? 'Nenhum material cadastrado.' : 'Nenhum material com esses filtros.'}
        </p>
      )}

      {!carregando && filtrados.length > 0 && (
        <div className={styles.lista}>
          {filtrados.map(m => {
            const saldo = saldos.get(m.id) ?? 0
            const repor = abaixoMinimo(m)
            return (
              <button key={m.id} className={`${styles.linha} ${materialSel?.id === m.id ? styles.linhaAtiva : ''}`}
                onClick={() => abrirExtrato(m)}>
                <div className={styles.linhaInfo}>
                  <div className={styles.linhaTopo}>
                    <span className={styles.linhaCodigo}>{m.codigo}</span>
                    <span className={styles.linhaNome}>{m.nome}</span>
                  </div>
                  {m.descricao && <div className={styles.linhaDesc}>{m.descricao}</div>}
                </div>
                <div className={styles.linhaMeta}>
                  <span className={`${styles.chip} ${styles[`chip_${m.categoria}`]}`}>{CATEGORIA_LABEL[m.categoria]}</span>
                  <span className={styles.linhaSaldo}>{saldo} {m.und}</span>
                  {repor && <span className={styles.badgeRepor}>⚠ repor</span>}
                </div>
              </button>
            )
          })}
        </div>
      )}

      {materialSel && (
        <div className={styles.painelExtrato}>
          <div className={styles.painelHeader}>
            <h2>{materialSel.codigo} — {materialSel.nome}</h2>
            <button className={styles.btnFechar} onClick={() => setMaterialSel(null)}>✕</button>
          </div>

          {carregandoExtrato && <p className={styles.vazio}>Carregando extrato…</p>}
          {!carregandoExtrato && movimentos.length === 0 && <p className={styles.vazio}>Nenhum movimento registrado.</p>}

          {msg && <p className={msg.tipo === 'ok' ? styles.msgOk : styles.msgErro}>{msg.texto}</p>}

          {!carregandoExtrato && movimentos.length > 0 && (
            <div className={styles.timeline}>
              {movimentos.map(mv => (
                <div key={mv.id} className={`${styles.movLinha} ${!mv.ativo ? styles.movInativo : ''}`}>
                  <div className={styles.movTopo}>
                    <span className={`${styles.chip} ${mv.tipo === 'entrada' ? styles.chip_entrada : styles.chip_saida}`}>
                      {mv.tipo === 'entrada' ? 'Entrada' : 'Saída'}
                    </span>
                    <span className={styles.movQtd}>{mv.quantidade} {materialSel.und}</span>
                    {!mv.ativo && <span className={styles.movInativoTag}>inativado</span>}
                  </div>
                  <div className={styles.movDetalhes}>
                    {mv.requisicao_numero !== null && <span>Req. {String(mv.requisicao_numero).padStart(5, '0')}</span>}
                    {mv.pedido_item_id !== null && <span>Pedido de compra</span>}
                    {mv.unidade_id !== null && <span>Destino: {nomeUnidade.get(mv.unidade_id) ?? '?'}</span>}
                    {mv.retirado_por && <span>Retirado por: {mv.retirado_por}</span>}
                    {mv.aplicacao && <span>Aplicação: {mv.aplicacao}</span>}
                    {mv.observacao && <span>Obs.: {mv.observacao}</span>}
                  </div>
                  <div className={styles.movRodape}>
                    <span>{autores.get(mv.criado_por) ?? '?'} · {fmtDataHora(mv.criado_em)}</span>
                    {admin && mv.ativo && (
                      <button className={styles.btnInativar} onClick={() => inativarMovimento(mv)}>Inativar</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

const PEDIDO_STATUS_VINCULAVEL: PedidoCompra['status'][] = ['aprovado', 'enviado', 'recebido_parcial']

interface PainelEntradaProps {
  materiais: Material[]
  onFechar: () => void
  onMaterialCriado: (m: Material) => void
  onSucesso: () => void
}

function PainelEntrada({ materiais, onFechar, onMaterialCriado, onSucesso }: PainelEntradaProps) {
  const { obraAtiva } = useObra()

  const [buscaMaterial, setBuscaMaterial] = useState('')
  const [materialId, setMaterialId] = useState<string | null>(null)
  const [sugestoesAbertas, setSugestoesAbertas] = useState(false)

  const [criandoMaterial, setCriandoMaterial] = useState(false)
  const [novoNome, setNovoNome] = useState('')
  const [novoUnd, setNovoUnd] = useState('')
  const [novaCategoria, setNovaCategoria] = useState<CategoriaMaterial>('material')
  const [salvandoMaterial, setSalvandoMaterial] = useState(false)

  const [quantidade, setQuantidade] = useState('')
  const [observacao, setObservacao] = useState('')

  const [pedidos, setPedidos] = useState<PedidoCompra[] | null>(null)
  const [pedidoSel, setPedidoSel] = useState('')
  const [itensPedido, setItensPedido] = useState<PedidoCompraItem[]>([])
  const [itemSel, setItemSel] = useState('')
  const [carregandoItens, setCarregandoItens] = useState(false)

  const [salvando, setSalvando] = useState(false)
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)

  useEffect(() => {
    if (!obraAtiva) return
    supabase.from('pedidos_compra').select('*')
      .eq('obra_id', obraAtiva.id).in('status', PEDIDO_STATUS_VINCULAVEL).order('numero')
      .then(({ data }) => setPedidos(data ?? []))
  }, [obraAtiva])

  function sugestoesMateriais(): Material[] {
    const t = buscaMaterial.trim().toLowerCase()
    if (!t) return materiais
    return materiais.filter(m => m.nome.toLowerCase().includes(t) || m.codigo.toLowerCase().includes(t))
  }

  function escolherMaterial(m: Material) {
    setMaterialId(m.id)
    setBuscaMaterial(`${m.codigo} — ${m.nome}`)
    setSugestoesAbertas(false)
  }

  async function criarMaterial() {
    if (!obraAtiva) return
    if (!novoNome.trim()) {
      setMsg({ tipo: 'erro', texto: 'Informe o nome do novo material.' })
      return
    }
    setSalvandoMaterial(true)
    setMsg(null)
    const { data: codigo, error: eCodigo } = await supabase.rpc('proximo_codigo_material', { p_obra: obraAtiva.id })
    if (eCodigo || !codigo) {
      setSalvandoMaterial(false)
      setMsg({ tipo: 'erro', texto: `Falha ao gerar código: ${eCodigo?.message}` })
      return
    }
    const { data: novo, error } = await supabase.from('materiais').insert({
      obra_id: obraAtiva.id,
      codigo,
      nome: novoNome.trim(),
      und: novoUnd.trim() || 'un',
      categoria: novaCategoria,
    }).select().single()
    setSalvandoMaterial(false)
    if (error || !novo) {
      setMsg({ tipo: 'erro', texto: `Falha ao criar material: ${error?.message}` })
      return
    }
    onMaterialCriado(novo)
    escolherMaterial(novo)
    setCriandoMaterial(false)
    setNovoNome(''); setNovoUnd(''); setNovaCategoria('material')
  }

  async function selecionarPedido(pedidoId: string) {
    setPedidoSel(pedidoId)
    setItemSel('')
    setItensPedido([])
    if (!pedidoId) return
    setCarregandoItens(true)
    const { data } = await supabase.from('pedidos_compra_itens').select('*')
      .eq('pedido_id', pedidoId).eq('ativo', true).order('criado_em')
    setItensPedido(data ?? [])
    setCarregandoItens(false)
  }

  function faltaReceber(it: PedidoCompraItem): number {
    return it.quantidade_pedida - it.quantidade_recebida
  }

  async function salvar() {
    if (!obraAtiva) return
    if (!materialId) {
      setMsg({ tipo: 'erro', texto: 'Selecione (ou crie) o material.' })
      return
    }
    const qtd = Number(quantidade)
    if (!qtd || qtd <= 0) {
      setMsg({ tipo: 'erro', texto: 'Informe uma quantidade maior que zero.' })
      return
    }
    setSalvando(true)
    setMsg(null)
    const { error } = await supabase.from('estoque_movimentos').insert({
      obra_id: obraAtiva.id,
      material_id: materialId,
      tipo: 'entrada',
      quantidade: qtd,
      pedido_item_id: itemSel || null,
      observacao: observacao.trim() || null,
    })
    setSalvando(false)
    if (error) {
      setMsg({ tipo: 'erro', texto: `Falha ao registrar entrada: ${error.message}` })
      return
    }
    onSucesso()
  }

  const sugestoes = sugestoesAbertas ? sugestoesMateriais() : []

  return (
    <div className={styles.painelForm}>
      <div className={styles.painelHeader}>
        <h2>Entrada de material</h2>
        <button className={styles.btnFechar} onClick={onFechar}>✕</button>
      </div>

      <div className={styles.campo}>
        Material *
        <div className={styles.autocompleteWrap}>
          <input
            value={buscaMaterial}
            onChange={e => { setBuscaMaterial(e.target.value); setMaterialId(null); setSugestoesAbertas(true) }}
            onFocus={() => setSugestoesAbertas(true)}
            onBlur={() => setTimeout(() => setSugestoesAbertas(false), 150)}
            placeholder="Buscar por código ou nome…"
            disabled={criandoMaterial}
          />
          {sugestoes.length > 0 && (
            <div className={styles.sugestoes}>
              {sugestoes.map(m => (
                <button key={m.id} className={styles.sugestao} onMouseDown={() => escolherMaterial(m)}>
                  <span className={styles.sugestaoCodigo}>{m.codigo}</span>{m.nome}
                </button>
              ))}
            </div>
          )}
        </div>
        {materialId
          ? <span className={styles.vinculoOk}>✓ material selecionado</span>
          : <span className={styles.vinculoAusente}>⚠ nenhum material selecionado</span>}
      </div>

      {!criandoMaterial ? (
        <button className={styles.btnSecundario} onClick={() => setCriandoMaterial(true)} style={{ marginBottom: 12 }}>
          + Criar material
        </button>
      ) : (
        <div className={styles.blocoAninhado}>
          <div className={styles.linha2}>
            <label className={styles.campo}>
              Nome *
              <input value={novoNome} onChange={e => setNovoNome(e.target.value)} placeholder="Ex.: Cimento CP II" />
            </label>
            <label className={styles.campo}>
              Unidade
              <input value={novoUnd} onChange={e => setNovoUnd(e.target.value)} placeholder="sc, kg, un…" />
            </label>
            <label className={styles.campo}>
              Categoria
              <select value={novaCategoria} onChange={e => setNovaCategoria(e.target.value as CategoriaMaterial)}>
                <option value="material">Material</option>
                <option value="epi">EPI</option>
                <option value="escritorio">Escritório</option>
              </select>
            </label>
          </div>
          <div className={styles.acoesInline}>
            <button className={styles.btnSecundario} onClick={() => setCriandoMaterial(false)}>Cancelar</button>
            <button className={styles.btnPrincipal} onClick={criarMaterial} disabled={salvandoMaterial}>
              {salvandoMaterial ? 'Criando…' : 'Criar material'}
            </button>
          </div>
        </div>
      )}

      <div className={styles.linha2}>
        <label className={styles.campo}>
          Quantidade *
          <input type="number" min="0" step="0.01" value={quantidade} onChange={e => setQuantidade(e.target.value)} />
        </label>
        <label className={styles.campo}>
          Observação
          <input value={observacao} onChange={e => setObservacao(e.target.value)} placeholder="Opcional" />
        </label>
      </div>

      <div className={styles.linha2}>
        <label className={styles.campo}>
          Pedido de compra (opcional)
          <select value={pedidoSel} onChange={e => selecionarPedido(e.target.value)}>
            <option value="">Sem vínculo — entrada avulsa</option>
            {(pedidos ?? []).map(p => (
              <option key={p.id} value={p.id}>
                {String(p.numero).padStart(3, '0')}{p.descricao ? ` — ${p.descricao}` : ''}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.campo}>
          Item do pedido
          <select value={itemSel} onChange={e => setItemSel(e.target.value)} disabled={!pedidoSel || carregandoItens}>
            <option value="">{carregandoItens ? 'Carregando…' : 'Selecione…'}</option>
            {itensPedido.map(it => (
              <option key={it.id} value={it.id}>
                {it.descricao_item} — falta receber {faltaReceber(it)} {it.und ?? ''}
              </option>
            ))}
          </select>
        </label>
      </div>

      {msg && <p className={msg.tipo === 'ok' ? styles.msgOk : styles.msgErro}>{msg.texto}</p>}
      <button className={styles.btnPrincipal} onClick={salvar} disabled={salvando}>
        {salvando ? 'Salvando…' : 'Registrar entrada'}
      </button>
    </div>
  )
}
