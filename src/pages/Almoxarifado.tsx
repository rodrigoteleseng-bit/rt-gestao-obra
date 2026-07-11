import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useObra } from '../contexts/ObraContext'
import {
  supabase, type Material, type CategoriaMaterial, type EstoqueMovimento, type Unidade,
  type PedidoCompra, type PedidoCompraItem, type CronogramaTarefa, type RequisicaoBloco,
  type Ferramenta, type FerramentaEmprestimo,
} from '../lib/supabase'
import { gerarPdfBlocoRequisicoes } from '../lib/requisicoesPdf'
import { dataLocalISO, dataHoje, diasEntre } from '../lib/almoxarifado'
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
      {aba === 'ferramentas' && <AbaFerramentas />}
      {aba === 'requisicoes' && <AbaRequisicoes />}
    </div>
  )
}

function EmBreve({ texto }: { texto: string }) {
  return <p className={styles.vazio}>{texto}</p>
}

// ---------- Requisições: blocos de PDF pré-numerados ----------

function AbaRequisicoes() {
  const { obraAtiva } = useObra()

  const [blocos, setBlocos] = useState<RequisicaoBloco[]>([])
  const [autores, setAutores] = useState<Map<string, string>>(new Map())
  const [carregando, setCarregando] = useState(true)

  const [quantidade, setQuantidade] = useState('50')
  const [gerando, setGerando] = useState(false)
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)

  async function carregarBlocos() {
    if (!obraAtiva) return
    setCarregando(true)
    const { data } = await supabase.from('requisicoes_blocos').select('*')
      .eq('obra_id', obraAtiva.id).order('criado_em', { ascending: false })
    const lista = data ?? []
    setBlocos(lista)
    const ids = [...new Set(lista.map(b => b.criado_por))]
    if (ids.length) {
      const { data: perfis } = await supabase.from('perfis_usuario').select('id, nome').in('id', ids)
      setAutores(new Map((perfis ?? []).map(u => [u.id, u.nome])))
    } else {
      setAutores(new Map())
    }
    setCarregando(false)
  }

  useEffect(() => { carregarBlocos() }, [obraAtiva])

  async function gerarBloco() {
    if (!obraAtiva) return
    const qtd = Number(quantidade)
    if (!qtd || qtd <= 0) {
      setMsg({ tipo: 'erro', texto: 'Informe uma quantidade maior que zero.' })
      return
    }
    if (qtd > 500) {
      setMsg({ tipo: 'erro', texto: 'Quantidade deve ser entre 1 e 500.' })
      return
    }
    setGerando(true)
    setMsg(null)
    const { data, error } = await supabase.rpc('gerar_bloco_requisicoes', { p_obra: obraAtiva.id, p_qtd: qtd })
    setGerando(false)
    if (error) {
      setMsg({ tipo: 'erro', texto: error.message })
      return
    }
    const faixa = Array.isArray(data) ? data[0] : data
    if (!faixa) {
      setMsg({ tipo: 'erro', texto: 'Falha inesperada ao gerar o bloco.' })
      return
    }
    gerarPdfBlocoRequisicoes({
      obraNome: obraAtiva.nome,
      numeroInicial: faixa.numero_inicial,
      numeroFinal: faixa.numero_final,
    })
    setMsg({
      tipo: 'ok',
      texto: `Bloco ${String(faixa.numero_inicial).padStart(5, '0')} a ${String(faixa.numero_final).padStart(5, '0')} gerado.`,
    })
    await carregarBlocos()
  }

  function baixarBloco(b: RequisicaoBloco) {
    if (!obraAtiva) return
    gerarPdfBlocoRequisicoes({
      obraNome: obraAtiva.nome,
      numeroInicial: b.numero_inicial,
      numeroFinal: b.numero_final,
    })
  }

  return (
    <div>
      <div className={styles.painelForm} style={{ marginBottom: 20 }}>
        <h2 style={{ marginBottom: 8 }}>Gerar bloco de requisições</h2>
        <p className={styles.sub}>
          Gera folhas de requisição em branco, numeradas em sequência (00001, 00002…), para impressão e uso manual na obra.
        </p>
        <div className={styles.linha2}>
          <label className={styles.campo}>
            Quantidade de folhas (1 a 500)
            <input type="number" min="1" max="500" step="1" value={quantidade}
              onChange={e => setQuantidade(e.target.value)} />
          </label>
        </div>
        {msg && <p className={msg.tipo === 'ok' ? styles.msgOk : styles.msgErro}>{msg.texto}</p>}
        <button className={styles.btnPrincipal} onClick={gerarBloco} disabled={gerando}>
          {gerando ? 'Gerando…' : 'Gerar bloco'}
        </button>
      </div>

      <h2 style={{ marginBottom: 8 }}>Blocos gerados</h2>
      {carregando && <p className={styles.vazio}>Carregando…</p>}
      {!carregando && blocos.length === 0 && <p className={styles.vazio}>Nenhum bloco gerado ainda.</p>}
      {!carregando && blocos.length > 0 && (
        <div className={styles.lista}>
          {blocos.map(b => (
            <div key={b.id} className={styles.linha}>
              <div className={styles.linhaInfo}>
                <div className={styles.linhaTopo}>
                  <span className={styles.linhaCodigo}>
                    {String(b.numero_inicial).padStart(5, '0')}–{String(b.numero_final).padStart(5, '0')}
                  </span>
                </div>
                <div className={styles.linhaDesc}>
                  {autores.get(b.criado_por) ?? '?'} · {fmtDataHora(b.criado_em)}
                </div>
              </div>
              <button className={styles.btnSecundario} onClick={() => baixarBloco(b)}>⬇ PDF</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
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
  const [mostrarSaida, setMostrarSaida] = useState(false)
  const [mostrarRequisicao, setMostrarRequisicao] = useState(false)

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
        <button className={styles.btnSecundario} onClick={() => setMostrarSaida(true)}>− Saída avulsa</button>
        <button className={styles.btnSecundario} onClick={() => setMostrarRequisicao(true)}>📋 Lançar requisição</button>
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

      {mostrarSaida && (
        <PainelSaida
          materiais={materiais}
          saldos={saldos}
          unidades={unidades}
          onFechar={() => setMostrarSaida(false)}
          onSucesso={async () => {
            await recarregarSaldos()
            setMostrarSaida(false)
            setMsg({ tipo: 'ok', texto: 'Saída registrada.' })
          }}
        />
      )}

      {mostrarRequisicao && (
        <PainelRequisicao
          materiais={materiais}
          saldos={saldos}
          unidades={unidades}
          onFechar={() => setMostrarRequisicao(false)}
          onSucesso={async (numero) => {
            await recarregarSaldos()
            setMostrarRequisicao(false)
            setMsg({ tipo: 'ok', texto: `Requisição ${String(numero).padStart(5, '0')} lançada.` })
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

// ---------- Ferramentas: empréstimo, devolução e atraso ----------

type EstadoFerramenta = 'disponivel' | 'emprestada' | 'atraso'
type FiltroEstadoFerramenta = '' | EstadoFerramenta

const ESTADO_LABEL: Record<EstadoFerramenta, string> = {
  disponivel: 'Disponível',
  emprestada: 'Emprestada',
  atraso: 'Em atraso',
}

function estadoDoEmprestimo(emprestimo: FerramentaEmprestimo | undefined): { estado: EstadoFerramenta; dias: number } {
  if (!emprestimo) return { estado: 'disponivel', dias: 0 }
  const dataRetirada = dataLocalISO(new Date(emprestimo.retirada_em))
  const hoje = dataHoje()
  const dias = diasEntre(dataRetirada, hoje)
  return { estado: dataRetirada < hoje ? 'atraso' : 'emprestada', dias }
}

function AbaFerramentas() {
  const { perfil } = useAuth()
  const { obraAtiva } = useObra()

  const [ferramentas, setFerramentas] = useState<Ferramenta[]>([])
  const [emprestimosAbertos, setEmprestimosAbertos] = useState<Map<string, FerramentaEmprestimo>>(new Map())
  const [unidades, setUnidades] = useState<Unidade[]>([])
  const [carregando, setCarregando] = useState(true)

  const [busca, setBusca] = useState('')
  const [filtroEstado, setFiltroEstado] = useState<FiltroEstadoFerramenta>('')

  const [mostrarNova, setMostrarNova] = useState(false)
  const [ferramentaEmprestando, setFerramentaEmprestando] = useState<Ferramenta | null>(null)
  const [ferramentaSel, setFerramentaSel] = useState<Ferramenta | null>(null)
  const [historico, setHistorico] = useState<FerramentaEmprestimo[]>([])
  const [autores, setAutores] = useState<Map<string, string>>(new Map())
  const [carregandoHistorico, setCarregandoHistorico] = useState(false)

  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)

  async function carregar() {
    if (!obraAtiva) return
    setCarregando(true)
    const [f, e, u] = await Promise.all([
      supabase.from('ferramentas').select('*').eq('obra_id', obraAtiva.id).eq('ativo', true).order('nome'),
      supabase.from('ferramenta_emprestimos').select('*').is('devolvida_em', null),
      supabase.from('unidades').select('*').eq('obra_id', obraAtiva.id).order('ordem'),
    ])
    setFerramentas(f.data ?? [])
    setEmprestimosAbertos(new Map((e.data ?? []).map(em => [em.ferramenta_id, em])))
    setUnidades(u.data ?? [])
    setCarregando(false)
  }

  useEffect(() => { carregar() }, [obraAtiva])

  const nomeUnidade = useMemo(() => new Map(unidades.map(u => [u.id, u.nome])), [unidades])

  const linhas = useMemo(() => {
    const termo = busca.trim().toLowerCase()
    return ferramentas
      .map(f => {
        const emprestimo = emprestimosAbertos.get(f.id)
        const { estado, dias } = estadoDoEmprestimo(emprestimo)
        return { ferramenta: f, emprestimo, estado, dias }
      })
      .filter(l =>
        (!termo || l.ferramenta.nome.toLowerCase().includes(termo)) &&
        (!filtroEstado || l.estado === filtroEstado)
      )
      .sort((a, b) => {
        const peso: Record<EstadoFerramenta, number> = { atraso: 0, emprestada: 1, disponivel: 2 }
        if (peso[a.estado] !== peso[b.estado]) return peso[a.estado] - peso[b.estado]
        return a.ferramenta.nome.localeCompare(b.ferramenta.nome)
      })
  }, [ferramentas, emprestimosAbertos, busca, filtroEstado])

  function ferramentaCriada(f: Ferramenta) {
    setFerramentas(prev => [...prev, f].sort((a, b) => a.nome.localeCompare(b.nome)))
  }

  async function abrirHistorico(f: Ferramenta) {
    setFerramentaSel(f)
    setMsg(null)
    setCarregandoHistorico(true)
    const { data: hist } = await supabase.from('ferramenta_emprestimos').select('*')
      .eq('ferramenta_id', f.id).order('retirada_em', { ascending: false })
    setHistorico(hist ?? [])
    const ids = [...new Set((hist ?? []).map(h => h.devolvida_recebida_por).filter((id): id is string => !!id))]
    if (ids.length) {
      const { data: perfis } = await supabase.from('perfis_usuario').select('id, nome').in('id', ids)
      setAutores(new Map((perfis ?? []).map(u => [u.id, u.nome])))
    } else {
      setAutores(new Map())
    }
    setCarregandoHistorico(false)
  }

  async function devolver(emprestimo: FerramentaEmprestimo) {
    if (!perfil) return
    if (!window.confirm('Confirma a devolução desta ferramenta?')) return
    setMsg(null)
    const { data, error } = await supabase.from('ferramenta_emprestimos')
      .update({ devolvida_em: new Date().toISOString(), devolvida_recebida_por: perfil.id })
      .eq('id', emprestimo.id).is('devolvida_em', null).select()
    if (error || !data || data.length === 0) {
      setMsg({ tipo: 'erro', texto: error?.message ?? 'Este empréstimo já foi devolvido por outra pessoa.' })
      await carregar()
      return
    }
    await carregar()
    setMsg({ tipo: 'ok', texto: 'Devolução registrada.' })
    if (ferramentaSel?.id === emprestimo.ferramenta_id) await abrirHistorico(ferramentaSel)
  }

  return (
    <div>
      <div className={styles.topoAcoes}>
        <button className={styles.btnPrincipal} onClick={() => setMostrarNova(true)}>+ Nova ferramenta</button>
      </div>

      {mostrarNova && (
        <PainelNovaFerramenta
          onFechar={() => setMostrarNova(false)}
          onSucesso={(f) => {
            ferramentaCriada(f)
            setMostrarNova(false)
            setMsg({ tipo: 'ok', texto: 'Ferramenta cadastrada.' })
          }}
        />
      )}

      {ferramentaEmprestando && (
        <PainelEmprestimo
          ferramenta={ferramentaEmprestando}
          unidades={unidades}
          onFechar={() => setFerramentaEmprestando(null)}
          onSucesso={async () => {
            setFerramentaEmprestando(null)
            await carregar()
            setMsg({ tipo: 'ok', texto: 'Empréstimo registrado.' })
          }}
        />
      )}

      <div className={styles.filtros}>
        <input className={styles.busca} value={busca} onChange={e => setBusca(e.target.value)}
          placeholder="Buscar ferramenta pelo nome…" />
        <select className={styles.selectFiltro} value={filtroEstado} onChange={e => setFiltroEstado(e.target.value as FiltroEstadoFerramenta)}>
          <option value="">Todos os estados</option>
          <option value="disponivel">Disponível</option>
          <option value="emprestada">Emprestada</option>
          <option value="atraso">Em atraso</option>
        </select>
      </div>

      {msg && !ferramentaSel && <p className={msg.tipo === 'ok' ? styles.msgOk : styles.msgErro}>{msg.texto}</p>}

      {carregando && <p className={styles.vazio}>Carregando…</p>}
      {!carregando && linhas.length === 0 && (
        <p className={styles.vazio}>
          {ferramentas.length === 0 ? 'Nenhuma ferramenta cadastrada.' : 'Nenhuma ferramenta com esses filtros.'}
        </p>
      )}

      {!carregando && linhas.length > 0 && (
        <div className={styles.lista}>
          {linhas.map(({ ferramenta: f, emprestimo, estado, dias }) => (
            <div key={f.id} className={`${styles.linha} ${ferramentaSel?.id === f.id ? styles.linhaAtiva : ''}`}
              onClick={() => abrirHistorico(f)}>
              <div className={styles.linhaInfo}>
                <div className={styles.linhaTopo}>
                  <span className={styles.linhaNome}>{f.nome}</span>
                </div>
                {f.descricao && <div className={styles.linhaDesc}>{f.descricao}</div>}
                {emprestimo && (
                  <div className={styles.linhaDesc}>
                    {emprestimo.retirado_por}
                    {emprestimo.unidade_id ? ` · ${nomeUnidade.get(emprestimo.unidade_id) ?? '?'}` : ''}
                    {estado === 'atraso' ? ` · há ${dias} dia${dias === 1 ? '' : 's'}` : ' · desde hoje'}
                  </div>
                )}
              </div>
              <div className={styles.linhaMeta}>
                <span className={`${styles.chip} ${styles[`chip_${estado}`]}`}>{ESTADO_LABEL[estado]}</span>
                {estado === 'disponivel' && (
                  <button className={styles.btnSecundario} onClick={(e) => { e.stopPropagation(); setFerramentaEmprestando(f) }}>
                    Emprestar
                  </button>
                )}
                {emprestimo && (
                  <button className={styles.btnSecundario} onClick={(e) => { e.stopPropagation(); devolver(emprestimo) }}>
                    Devolver
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {ferramentaSel && (
        <div className={styles.painelExtrato}>
          <div className={styles.painelHeader}>
            <h2>{ferramentaSel.nome} — histórico</h2>
            <button className={styles.btnFechar} onClick={() => setFerramentaSel(null)}>✕</button>
          </div>

          {carregandoHistorico && <p className={styles.vazio}>Carregando histórico…</p>}
          {!carregandoHistorico && historico.length === 0 && <p className={styles.vazio}>Nenhum empréstimo registrado.</p>}

          {msg && <p className={msg.tipo === 'ok' ? styles.msgOk : styles.msgErro}>{msg.texto}</p>}

          {!carregandoHistorico && historico.length > 0 && (
            <div className={styles.timeline}>
              {historico.map(h => (
                <div key={h.id} className={styles.movLinha}>
                  <div className={styles.movTopo}>
                    <span className={`${styles.chip} ${styles[`chip_${h.devolvida_em ? 'devolvida' : 'aberto'}`]}`}>
                      {h.devolvida_em ? 'Devolvida' : 'Em aberto'}
                    </span>
                  </div>
                  <div className={styles.movDetalhes}>
                    <span>Retirado por: {h.retirado_por}</span>
                    {h.unidade_id && <span>Destino: {nomeUnidade.get(h.unidade_id) ?? '?'}</span>}
                    {h.observacao && <span>Obs.: {h.observacao}</span>}
                  </div>
                  <div className={styles.movRodape}>
                    <span>
                      Retirada: {fmtDataHora(h.retirada_em)}
                      {h.devolvida_em ? ` · Devolvida: ${fmtDataHora(h.devolvida_em)} (recebido por ${autores.get(h.devolvida_recebida_por ?? '') ?? '?'})` : ''}
                    </span>
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

interface PainelNovaFerramentaProps {
  onFechar: () => void
  onSucesso: (f: Ferramenta) => void
}

function PainelNovaFerramenta({ onFechar, onSucesso }: PainelNovaFerramentaProps) {
  const { obraAtiva } = useObra()
  const [nome, setNome] = useState('')
  const [descricao, setDescricao] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)

  async function salvar() {
    if (!obraAtiva) return
    if (!nome.trim()) {
      setMsg({ tipo: 'erro', texto: 'Informe o nome da ferramenta.' })
      return
    }
    setSalvando(true)
    setMsg(null)
    const { data, error } = await supabase.from('ferramentas').insert({
      obra_id: obraAtiva.id,
      nome: nome.trim(),
      descricao: descricao.trim() || null,
    }).select().single()
    setSalvando(false)
    if (error || !data) {
      setMsg({ tipo: 'erro', texto: `Falha ao cadastrar: ${error?.message}` })
      return
    }
    onSucesso(data)
  }

  return (
    <div className={styles.painelForm}>
      <div className={styles.painelHeader}>
        <h2>Nova ferramenta</h2>
        <button className={styles.btnFechar} onClick={onFechar}>✕</button>
      </div>
      <div className={styles.linha2}>
        <label className={styles.campo}>
          Nome *
          <input value={nome} onChange={e => setNome(e.target.value)} placeholder="Ex.: Furadeira 01" />
        </label>
        <label className={styles.campo}>
          Descrição
          <input value={descricao} onChange={e => setDescricao(e.target.value)} placeholder="Opcional" />
        </label>
      </div>
      {msg && <p className={msg.tipo === 'ok' ? styles.msgOk : styles.msgErro}>{msg.texto}</p>}
      <button className={styles.btnPrincipal} onClick={salvar} disabled={salvando}>
        {salvando ? 'Salvando…' : 'Cadastrar ferramenta'}
      </button>
    </div>
  )
}

interface PainelEmprestimoProps {
  ferramenta: Ferramenta
  unidades: Unidade[]
  onFechar: () => void
  onSucesso: () => void
}

function PainelEmprestimo({ ferramenta, unidades, onFechar, onSucesso }: PainelEmprestimoProps) {
  const [retiradoPor, setRetiradoPor] = useState('')
  const [unidadeId, setUnidadeId] = useState('')
  const [observacao, setObservacao] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)

  async function salvar() {
    if (!retiradoPor.trim()) {
      setMsg({ tipo: 'erro', texto: 'Informe quem levou a ferramenta.' })
      return
    }
    setSalvando(true)
    setMsg(null)
    const { error } = await supabase.from('ferramenta_emprestimos').insert({
      ferramenta_id: ferramenta.id,
      retirado_por: retiradoPor.trim(),
      unidade_id: unidadeId || null,
      observacao: observacao.trim() || null,
    })
    setSalvando(false)
    if (error) {
      const jaEmprestada = error.code === '23505' || (error.message ?? '').includes('unique_emprestimo_aberto')
      setMsg({ tipo: 'erro', texto: jaEmprestada ? 'Ferramenta já emprestada.' : `Falha ao registrar empréstimo: ${error.message}` })
      return
    }
    onSucesso()
  }

  return (
    <div className={styles.painelForm}>
      <div className={styles.painelHeader}>
        <h2>Emprestar — {ferramenta.nome}</h2>
        <button className={styles.btnFechar} onClick={onFechar}>✕</button>
      </div>
      <div className={styles.linha2}>
        <label className={styles.campo}>
          Quem levou *
          <input value={retiradoPor} onChange={e => setRetiradoPor(e.target.value)} placeholder="Nome" />
        </label>
        <label className={styles.campo}>
          Unidade
          <select value={unidadeId} onChange={e => setUnidadeId(e.target.value)}>
            <option value="">Opcional</option>
            {unidades.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}
          </select>
        </label>
        <label className={styles.campo}>
          Observação
          <input value={observacao} onChange={e => setObservacao(e.target.value)} placeholder="Opcional" />
        </label>
      </div>
      {msg && <p className={msg.tipo === 'ok' ? styles.msgOk : styles.msgErro}>{msg.texto}</p>}
      <button className={styles.btnPrincipal} onClick={salvar} disabled={salvando}>
        {salvando ? 'Salvando…' : 'Registrar empréstimo'}
      </button>
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
    const isDuplicidade = (e: { message?: string; code?: string } | null | undefined) =>
      !!e && (e.code === '23505' || (e.message ?? '').includes('duplicate key'))

    async function tentarInserir() {
      const { data: codigo, error: eCodigo } = await supabase.rpc('proximo_codigo_material', { p_obra: obraAtiva!.id })
      if (eCodigo || !codigo) {
        return { novo: null, error: eCodigo, falhaCodigo: true as const }
      }
      const { data: novo, error } = await supabase.from('materiais').insert({
        obra_id: obraAtiva!.id,
        codigo,
        nome: novoNome.trim(),
        und: novoUnd.trim() || 'un',
        categoria: novaCategoria,
      }).select().single()
      return { novo, error, falhaCodigo: false as const }
    }

    let resultado = await tentarInserir()
    if (resultado.falhaCodigo) {
      setSalvandoMaterial(false)
      setMsg({ tipo: 'erro', texto: `Falha ao gerar código: ${resultado.error?.message}` })
      return
    }
    if (resultado.error && isDuplicidade(resultado.error)) {
      resultado = await tentarInserir()
      if (resultado.falhaCodigo) {
        setSalvandoMaterial(false)
        setMsg({ tipo: 'erro', texto: `Falha ao gerar código: ${resultado.error?.message}` })
        return
      }
      if (resultado.error && isDuplicidade(resultado.error)) {
        setSalvandoMaterial(false)
        setMsg({ tipo: 'erro', texto: 'Outro usuário criou um material ao mesmo tempo — tente novamente.' })
        return
      }
    }
    setSalvandoMaterial(false)
    if (resultado.error || !resultado.novo) {
      setMsg({ tipo: 'erro', texto: `Falha ao criar material: ${resultado.error?.message}` })
      return
    }
    onMaterialCriado(resultado.novo)
    escolherMaterial(resultado.novo)
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
            {itensPedido.map(it => {
              const falta = faltaReceber(it)
              const jaRecebido = falta <= 0
              return (
                <option key={it.id} value={it.id} disabled={jaRecebido}>
                  {it.descricao_item} — {jaRecebido ? 'já recebido' : `falta receber ${falta} ${it.und ?? ''}`}
                </option>
              )
            })}
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

// ---------- Saída avulsa ----------

interface PainelSaidaProps {
  materiais: Material[]
  saldos: Map<string, number>
  unidades: Unidade[]
  onFechar: () => void
  onSucesso: () => void
}

function PainelSaida({ materiais, saldos, unidades, onFechar, onSucesso }: PainelSaidaProps) {
  const { obraAtiva } = useObra()

  const [buscaMaterial, setBuscaMaterial] = useState('')
  const [materialId, setMaterialId] = useState<string | null>(null)
  const [sugestoesAbertas, setSugestoesAbertas] = useState(false)

  const [quantidade, setQuantidade] = useState('')
  const [unidadeId, setUnidadeId] = useState('')
  const [retiradoPor, setRetiradoPor] = useState('')
  const [requisicaoNumero, setRequisicaoNumero] = useState('')
  const [tarefaId, setTarefaId] = useState('')
  const [tarefasUnidade, setTarefasUnidade] = useState<CronogramaTarefa[]>([])
  const [aplicacao, setAplicacao] = useState('')
  const [observacao, setObservacao] = useState('')

  const [salvando, setSalvando] = useState(false)
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)

  useEffect(() => {
    setTarefaId('')
    if (!unidadeId) { setTarefasUnidade([]); return }
    supabase.from('cronograma_tarefas').select('*')
      .eq('unidade_id', unidadeId).eq('ativo', true).eq('resumo', false).order('ordem')
      .then(({ data }) => setTarefasUnidade(data ?? []))
  }, [unidadeId])

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

  const materialSelecionado = materialId ? materiais.find(m => m.id === materialId) ?? null : null
  const saldoAtual = materialSelecionado ? saldos.get(materialSelecionado.id) ?? 0 : null

  async function salvar() {
    if (!obraAtiva) return
    if (!materialId) {
      setMsg({ tipo: 'erro', texto: 'Selecione o material.' })
      return
    }
    const qtd = Number(quantidade)
    if (!qtd || qtd <= 0) {
      setMsg({ tipo: 'erro', texto: 'Informe uma quantidade maior que zero.' })
      return
    }
    if (saldoAtual !== null && qtd > saldoAtual) {
      setMsg({ tipo: 'erro', texto: `Saldo insuficiente: saldo atual ${saldoAtual} ${materialSelecionado?.und ?? ''}.` })
      return
    }
    if (!unidadeId) {
      setMsg({ tipo: 'erro', texto: 'Selecione a unidade de destino.' })
      return
    }
    if (!retiradoPor.trim()) {
      setMsg({ tipo: 'erro', texto: 'Informe quem retirou o material.' })
      return
    }
    setSalvando(true)
    setMsg(null)
    const { error } = await supabase.from('estoque_movimentos').insert({
      obra_id: obraAtiva.id,
      material_id: materialId,
      tipo: 'saida',
      quantidade: qtd,
      unidade_id: unidadeId,
      retirado_por: retiradoPor.trim(),
      requisicao_numero: requisicaoNumero ? Number(requisicaoNumero) : null,
      tarefa_id: tarefaId || null,
      aplicacao: aplicacao.trim() || null,
      observacao: observacao.trim() || null,
    })
    setSalvando(false)
    if (error) {
      setMsg({ tipo: 'erro', texto: error.message })
      return
    }
    onSucesso()
  }

  const sugestoes = sugestoesAbertas ? sugestoesMateriais() : []

  return (
    <div className={styles.painelForm}>
      <div className={styles.painelHeader}>
        <h2>Saída avulsa de estoque</h2>
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
        {materialSelecionado
          ? <span className={styles.vinculoOk}>✓ saldo atual: {saldoAtual} {materialSelecionado.und}</span>
          : <span className={styles.vinculoAusente}>⚠ nenhum material selecionado</span>}
      </div>

      <div className={styles.linha2}>
        <label className={styles.campo}>
          Quantidade *
          <input type="number" min="0" step="0.01" max={saldoAtual ?? undefined}
            value={quantidade} onChange={e => setQuantidade(e.target.value)} />
        </label>
        <label className={styles.campo}>
          Unidade destino *
          <select value={unidadeId} onChange={e => setUnidadeId(e.target.value)}>
            <option value="">Selecione…</option>
            {unidades.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}
          </select>
        </label>
        <label className={styles.campo}>
          Quem retirou *
          <input value={retiradoPor} onChange={e => setRetiradoPor(e.target.value)} placeholder="Nome" />
        </label>
      </div>

      <div className={styles.linha2}>
        <label className={styles.campo}>
          Nº requisição
          <input type="number" min="0" step="1" value={requisicaoNumero}
            onChange={e => setRequisicaoNumero(e.target.value)} placeholder="Opcional" />
        </label>
        <label className={styles.campo}>
          Tarefa
          <select value={tarefaId} onChange={e => setTarefaId(e.target.value)} disabled={!unidadeId}>
            <option value="">Opcional</option>
            {tarefasUnidade.map(t => <option key={t.id} value={t.id}>{t.nome}</option>)}
          </select>
        </label>
        <label className={styles.campo}>
          Aplicação
          <input value={aplicacao} onChange={e => setAplicacao(e.target.value)} placeholder="Ex.: reboco fachada" />
        </label>
      </div>

      <label className={styles.campo}>
        Observação
        <input value={observacao} onChange={e => setObservacao(e.target.value)} placeholder="Opcional" />
      </label>

      {msg && <p className={msg.tipo === 'ok' ? styles.msgOk : styles.msgErro}>{msg.texto}</p>}
      <button className={styles.btnPrincipal} onClick={salvar} disabled={salvando}>
        {salvando ? 'Salvando…' : 'Registrar saída'}
      </button>
    </div>
  )
}

// ---------- Lançar requisição preenchida ----------

interface ItemRequisicao {
  chave: string
  buscaMaterial: string
  materialId: string | null
  sugestoesAbertas: boolean
  quantidade: string
  aplicacao: string
  enviado: boolean
}

function itemRequisicaoVazio(): ItemRequisicao {
  return {
    chave: crypto.randomUUID(),
    buscaMaterial: '',
    materialId: null,
    sugestoesAbertas: false,
    quantidade: '',
    aplicacao: '',
    enviado: false,
  }
}

interface PainelRequisicaoProps {
  materiais: Material[]
  saldos: Map<string, number>
  unidades: Unidade[]
  onFechar: () => void
  onSucesso: (numero: number) => void
}

function PainelRequisicao({ materiais, saldos, unidades, onFechar, onSucesso }: PainelRequisicaoProps) {
  const { obraAtiva } = useObra()

  const [requisicaoNumero, setRequisicaoNumero] = useState('')
  const [unidadeId, setUnidadeId] = useState('')
  const [retiradoPor, setRetiradoPor] = useState('')
  const [dataRequisicao, setDataRequisicao] = useState(() => new Date().toISOString().slice(0, 10))

  const [itens, setItens] = useState<ItemRequisicao[]>([itemRequisicaoVazio()])
  const [salvando, setSalvando] = useState(false)
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)

  function atualizarItem(chave: string, patch: Partial<ItemRequisicao>) {
    setItens(prev => prev.map(it => it.chave === chave ? { ...it, ...patch } : it))
  }

  function escolherMaterial(chave: string, m: Material) {
    atualizarItem(chave, { materialId: m.id, buscaMaterial: `${m.codigo} — ${m.nome}`, sugestoesAbertas: false })
  }

  function removerItem(chave: string) {
    setItens(prev => prev.length > 1 ? prev.filter(it => it.chave !== chave) : prev)
  }

  function sugestoesPara(texto: string): Material[] {
    const t = texto.trim().toLowerCase()
    if (!t) return materiais
    return materiais.filter(m => m.nome.toLowerCase().includes(t) || m.codigo.toLowerCase().includes(t))
  }

  function nomeMaterial(id: string | null): string {
    if (!id) return 'material não identificado'
    const m = materiais.find(mm => mm.id === id)
    return m ? `${m.codigo} — ${m.nome}` : 'material não identificado'
  }

  async function salvar() {
    if (!obraAtiva) return
    const numero = Number(requisicaoNumero)
    if (!numero || numero <= 0) {
      setMsg({ tipo: 'erro', texto: 'Informe o número da folha de requisição.' })
      return
    }
    if (!unidadeId) {
      setMsg({ tipo: 'erro', texto: 'Selecione a unidade de destino.' })
      return
    }
    if (!retiradoPor.trim()) {
      setMsg({ tipo: 'erro', texto: 'Informe quem retirou o material.' })
      return
    }
    const pendentes = itens.filter(it => !it.enviado && it.materialId && Number(it.quantidade) > 0)
    if (pendentes.length === 0) {
      setMsg({ tipo: 'erro', texto: 'Adicione ao menos um item com material e quantidade.' })
      return
    }

    setSalvando(true)
    setMsg(null)

    const atualizados = [...itens]
    let erroInfo: { indice: number; nome: string; texto: string } | null = null

    for (let i = 0; i < atualizados.length; i++) {
      const it = atualizados[i]
      if (it.enviado) continue
      if (!it.materialId || !(Number(it.quantidade) > 0)) continue
      const { error } = await supabase.from('estoque_movimentos').insert({
        obra_id: obraAtiva.id,
        material_id: it.materialId,
        tipo: 'saida',
        quantidade: Number(it.quantidade),
        unidade_id: unidadeId,
        retirado_por: retiradoPor.trim(),
        requisicao_numero: numero,
        aplicacao: it.aplicacao.trim() || null,
      })
      if (error) {
        erroInfo = { indice: i, nome: nomeMaterial(it.materialId), texto: error.message }
        break
      }
      atualizados[i] = { ...it, enviado: true }
    }

    setItens(atualizados)
    setSalvando(false)

    const totalEnviados = atualizados.filter(it => it.enviado).length

    if (erroInfo) {
      const posicao = erroInfo.indice + 1
      let prefixo = ''
      if (totalEnviados === 1) prefixo = 'Item 1 lançado; '
      else if (totalEnviados === 2) prefixo = 'Itens 1 e 2 lançados; '
      else if (totalEnviados > 2) prefixo = `Itens 1 a ${totalEnviados} lançados; `
      setMsg({
        tipo: 'erro',
        texto: `${prefixo}item ${posicao} (${erroInfo.nome}) falhou: ${erroInfo.texto}. Os já lançados NÃO são desfeitos — confira o extrato.`,
      })
      return
    }

    onSucesso(numero)
  }

  return (
    <div className={styles.painelForm}>
      <div className={styles.painelHeader}>
        <h2>Lançar requisição preenchida</h2>
        <button className={styles.btnFechar} onClick={onFechar}>✕</button>
      </div>

      <div className={styles.linha2}>
        <label className={styles.campo}>
          Nº da folha *
          <input type="number" min="1" step="1" value={requisicaoNumero}
            onChange={e => setRequisicaoNumero(e.target.value)} placeholder="Ex.: 401" />
        </label>
        <label className={styles.campo}>
          Unidade destino *
          <select value={unidadeId} onChange={e => setUnidadeId(e.target.value)}>
            <option value="">Selecione…</option>
            {unidades.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}
          </select>
        </label>
        <label className={styles.campo}>
          Quem retirou *
          <input value={retiradoPor} onChange={e => setRetiradoPor(e.target.value)} placeholder="Nome" />
        </label>
        <label className={styles.campo}>
          Data
          <input type="date" value={dataRequisicao} onChange={e => setDataRequisicao(e.target.value)} />
        </label>
      </div>

      <div className={styles.blocoAninhado}>
        <h2 style={{ marginBottom: 8 }}>Itens</h2>
        {itens.map(it => {
          const sugestoes = it.sugestoesAbertas ? sugestoesPara(it.buscaMaterial) : []
          const materialSelecionado = it.materialId ? materiais.find(m => m.id === it.materialId) ?? null : null
          const saldoAtual = materialSelecionado ? saldos.get(materialSelecionado.id) ?? null : null
          return (
            <div key={it.chave} className={styles.itemLinhaReq} style={{ opacity: it.enviado ? 0.6 : 1 }}>
              <div className={styles.linha2}>
                <div className={styles.campo}>
                  Material *
                  <div className={styles.autocompleteWrap}>
                    <input
                      value={it.buscaMaterial}
                      disabled={it.enviado}
                      onChange={e => atualizarItem(it.chave, { buscaMaterial: e.target.value, materialId: null, sugestoesAbertas: true })}
                      onFocus={() => atualizarItem(it.chave, { sugestoesAbertas: true })}
                      onBlur={() => setTimeout(() => atualizarItem(it.chave, { sugestoesAbertas: false }), 150)}
                      placeholder="Buscar por código ou nome…"
                    />
                    {sugestoes.length > 0 && (
                      <div className={styles.sugestoes}>
                        {sugestoes.map(m => (
                          <button key={m.id} className={styles.sugestao} onMouseDown={() => escolherMaterial(it.chave, m)}>
                            <span className={styles.sugestaoCodigo}>{m.codigo}</span>{m.nome}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  {materialSelecionado
                    ? <span className={styles.vinculoOk}>✓ saldo atual: {saldoAtual} {materialSelecionado.und}</span>
                    : <span className={styles.vinculoAusente}>⚠ sem material</span>}
                </div>
                <label className={styles.campo}>
                  Quantidade *
                  <input type="number" min="0" step="0.01" value={it.quantidade} disabled={it.enviado}
                    onChange={e => atualizarItem(it.chave, { quantidade: e.target.value })} />
                </label>
                <label className={styles.campo}>
                  Aplicação
                  <input value={it.aplicacao} disabled={it.enviado} placeholder="Opcional"
                    onChange={e => atualizarItem(it.chave, { aplicacao: e.target.value })} />
                </label>
              </div>
              {it.enviado && <span className={styles.vinculoOk}>✓ já lançado</span>}
              {!it.enviado && itens.length > 1 && (
                <button className={styles.btnSecundario} onClick={() => removerItem(it.chave)}>Remover item</button>
              )}
            </div>
          )
        })}
        <button className={styles.btnSecundario} onClick={() => setItens(prev => [...prev, itemRequisicaoVazio()])}>
          + Adicionar item
        </button>
      </div>

      {msg && <p className={msg.tipo === 'ok' ? styles.msgOk : styles.msgErro}>{msg.texto}</p>}
      <button className={styles.btnPrincipal} onClick={salvar} disabled={salvando}>
        {salvando ? 'Salvando…' : 'Lançar requisição'}
      </button>
    </div>
  )
}
