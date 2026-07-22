import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useObra } from '../contexts/ObraContext'
import {
  supabase, type Material, type CategoriaMaterial, type EstoqueMovimento, type Unidade,
  type PedidoCompra, type PedidoCompraItem, type CronogramaTarefa, type RequisicaoBloco,
  type Ferramenta, type FerramentaEmprestimo, type FerramentaLocacao,
  type ModalidadeLocacaoFerramenta, type Fornecedor,
} from '../lib/supabase'
import { gerarPdfBlocoRequisicoes } from '../lib/requisicoesPdf'
import { gerarPdfEstoque } from '../lib/estoquePdf'
import { dataLocalISO, dataHoje, diasEntre } from '../lib/almoxarifado'
import { useConfirmDialog } from '../components/ConfirmDialogContext'
import styles from './Almoxarifado.module.css'

type Aba = 'estoque' | 'ferramentas' | 'locacoes' | 'requisicoes'

const CATEGORIA_LABEL: Record<CategoriaMaterial, string> = {
  material: 'Material',
  epi: 'EPI',
  escritorio: 'Escritório',
}

const MODALIDADE_LOCACAO_LABEL: Record<ModalidadeLocacaoFerramenta, string> = {
  diaria: 'Diária',
  semanal: 'Semanal',
  mensal: 'Mensal',
}

const fmtDataHora = (iso: string) => {
  const d = new Date(iso)
  return `${d.toLocaleDateString('pt-BR')} ${d.toLocaleTimeString('pt-BR').slice(0, 5)}`
}
const fmtData = (iso: string) => new Date(iso + 'T00:00:00').toLocaleDateString('pt-BR')

export default function Almoxarifado() {
  const { perfil, temModulo } = useAuth()
  const [aba, setAba] = useState<Aba>('estoque')
  const podeGerirAlmoxarifado = perfil?.papel === 'admin' || (perfil?.papel === 'equipe' && temModulo('almoxarifado'))

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
        {podeGerirAlmoxarifado && (
          <button className={`${styles.aba} ${aba === 'locacoes' ? styles.abaAtiva : ''}`} onClick={() => setAba('locacoes')}>
            Aluguéis
          </button>
        )}
        <button className={`${styles.aba} ${aba === 'requisicoes' ? styles.abaAtiva : ''}`} onClick={() => setAba('requisicoes')}>
          Requisições
        </button>
      </div>

      {aba === 'estoque' && <AbaEstoque />}
      {aba === 'ferramentas' && <AbaFerramentas />}
      {aba === 'locacoes' && podeGerirAlmoxarifado && <AbaLocacoes />}
      {aba === 'requisicoes' && <AbaRequisicoes />}
    </div>
  )
}

function EmBreve({ texto }: { texto: string }) {
  return <p className={styles.vazio}>{texto}</p>
}

// ---------- Aluguel de ferramentas ----------

type EstadoLocacao = 'em_dia' | 'vence_amanha' | 'vence_hoje' | 'vencida' | 'entregue'
type FiltroEstadoLocacao = '' | EstadoLocacao

const ESTADO_LOCACAO_LABEL: Record<EstadoLocacao, string> = {
  em_dia: 'Em dia',
  vence_amanha: 'Vence amanhã',
  vence_hoje: 'Vence hoje',
  vencida: 'Vencida',
  entregue: 'Entregue',
}

function estadoDaLocacao(locacao: FerramentaLocacao): { estado: EstadoLocacao; dias: number } {
  if (locacao.data_entregue) return { estado: 'entregue', dias: 0 }
  const dias = diasEntre(dataHoje(), locacao.data_entrega_prevista)
  if (dias < 0) return { estado: 'vencida', dias: Math.abs(dias) }
  if (dias === 0) return { estado: 'vence_hoje', dias: 0 }
  if (dias === 1) return { estado: 'vence_amanha', dias: 1 }
  return { estado: 'em_dia', dias }
}

function AbaLocacoes() {
  const { confirmar } = useConfirmDialog()
  const { perfil } = useAuth()
  const { obraAtiva } = useObra()

  const [locacoes, setLocacoes] = useState<FerramentaLocacao[]>([])
  const [carregando, setCarregando] = useState(true)
  const [busca, setBusca] = useState('')
  const [filtroEstado, setFiltroEstado] = useState<FiltroEstadoLocacao>('')
  const [mostrarNova, setMostrarNova] = useState(false)
  const [locacaoEditando, setLocacaoEditando] = useState<FerramentaLocacao | null>(null)
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)

  async function carregar() {
    if (!obraAtiva) return
    setCarregando(true)
    const { data, error } = await supabase.from('ferramenta_locacoes').select('*')
      .eq('obra_id', obraAtiva.id).eq('ativo', true).order('data_entrega_prevista')
    setCarregando(false)
    if (error) {
      setMsg({ tipo: 'erro', texto: `Erro ao carregar aluguéis: ${error.message}` })
      return
    }
    setLocacoes(data ?? [])
  }

  useEffect(() => { carregar() }, [obraAtiva])

  const linhas = useMemo(() => {
    const termo = busca.trim().toLowerCase()
    const peso: Record<EstadoLocacao, number> = { vencida: 0, vence_hoje: 1, vence_amanha: 2, em_dia: 3, entregue: 4 }
    return locacoes
      .map(locacao => ({ locacao, ...estadoDaLocacao(locacao) }))
      .filter(l =>
        (!termo || l.locacao.nome_ferramenta.toLowerCase().includes(termo) || l.locacao.locadora.toLowerCase().includes(termo)) &&
        (!filtroEstado || l.estado === filtroEstado)
      )
      .sort((a, b) => {
        if (peso[a.estado] !== peso[b.estado]) return peso[a.estado] - peso[b.estado]
        return a.locacao.data_entrega_prevista.localeCompare(b.locacao.data_entrega_prevista)
      })
  }, [locacoes, busca, filtroEstado])

  const resumoAlertas = useMemo(() => {
    const abertas = locacoes.map(locacao => ({ locacao, ...estadoDaLocacao(locacao) }))
      .filter(l => l.estado === 'vencida' || l.estado === 'vence_hoje' || l.estado === 'vence_amanha')
    return {
      vencidas: abertas.filter(l => l.estado === 'vencida').length,
      hoje: abertas.filter(l => l.estado === 'vence_hoje').length,
      amanha: abertas.filter(l => l.estado === 'vence_amanha').length,
    }
  }, [locacoes])

  async function registrarEntrega(locacao: FerramentaLocacao) {
    if (!perfil) return
    if (!await confirmar({
      titulo: 'Registrar entrega',
      mensagem: `Confirma que "${locacao.nome_ferramenta}" foi entregue para a locadora?`,
      confirmarTexto: 'Registrar entrega',
    })) return
    setMsg(null)
    const { data, error } = await supabase.from('ferramenta_locacoes')
      .update({ data_entregue: dataHoje(), entregue_por: perfil.id, entregue_em: new Date().toISOString() })
      .eq('id', locacao.id).is('data_entregue', null).select()
    if (error || !data || data.length === 0) {
      setMsg({ tipo: 'erro', texto: error?.message ?? 'Esta locação já foi entregue por outra pessoa.' })
      await carregar()
      return
    }
    await carregar()
    setMsg({ tipo: 'ok', texto: 'Entrega registrada.' })
  }

  return (
    <div>
      <div className={styles.topoAcoes}>
        <button className={styles.btnPrincipal} onClick={() => setMostrarNova(true)}>+ Nova locação</button>
      </div>

      {mostrarNova && (
        <PainelLocacao
          onFechar={() => setMostrarNova(false)}
          onSucesso={async () => {
            setMostrarNova(false)
            await carregar()
            setMsg({ tipo: 'ok', texto: 'Locação cadastrada.' })
          }}
        />
      )}

      {locacaoEditando && (
        <PainelLocacao
          locacao={locacaoEditando}
          onFechar={() => setLocacaoEditando(null)}
          onSucesso={async () => {
            setLocacaoEditando(null)
            await carregar()
            setMsg({ tipo: 'ok', texto: 'Locação corrigida.' })
          }}
        />
      )}

      {(resumoAlertas.vencidas > 0 || resumoAlertas.hoje > 0 || resumoAlertas.amanha > 0) && (
        <div className={styles.alertaLocacoes}>
          {resumoAlertas.vencidas > 0 && <span>{resumoAlertas.vencidas} vencida(s)</span>}
          {resumoAlertas.hoje > 0 && <span>{resumoAlertas.hoje} vence(m) hoje</span>}
          {resumoAlertas.amanha > 0 && <span>{resumoAlertas.amanha} vence(m) amanhã</span>}
        </div>
      )}

      <div className={styles.filtros}>
        <input className={styles.busca} value={busca} onChange={e => setBusca(e.target.value)}
          placeholder="Buscar por ferramenta ou locadora…" />
        <select className={styles.selectFiltro} value={filtroEstado} onChange={e => setFiltroEstado(e.target.value as FiltroEstadoLocacao)}>
          <option value="">Todos os estados</option>
          <option value="vencida">Vencida</option>
          <option value="vence_hoje">Vence hoje</option>
          <option value="vence_amanha">Vence amanhã</option>
          <option value="em_dia">Em dia</option>
          <option value="entregue">Entregue</option>
        </select>
      </div>

      {msg && <p className={msg.tipo === 'ok' ? styles.msgOk : styles.msgErro}>{msg.texto}</p>}
      {carregando && <p className={styles.vazio}>Carregando…</p>}
      {!carregando && linhas.length === 0 && (
        <p className={styles.vazio}>
          {locacoes.length === 0 ? 'Nenhuma locação de ferramenta cadastrada.' : 'Nenhuma locação com esses filtros.'}
        </p>
      )}

      {!carregando && linhas.length > 0 && (
        <div className={styles.lista}>
          {linhas.map(({ locacao, estado, dias }) => (
            <div key={locacao.id} className={styles.linha}>
              <div className={styles.linhaInfo}>
                <div className={styles.linhaTopo}>
                  <span className={styles.linhaNome}>{locacao.nome_ferramenta}</span>
                  <span className={`${styles.chip} ${styles[`chip_${estado}`]}`}>{ESTADO_LOCACAO_LABEL[estado]}</span>
                </div>
                <div className={styles.linhaDesc}>
                  {locacao.locadora} · {MODALIDADE_LOCACAO_LABEL[locacao.modalidade]} · chegada {fmtData(locacao.data_chegada)} · entrega {fmtData(locacao.data_entrega_prevista)}
                </div>
                {estado === 'vencida' && <div className={styles.linhaDesc}>Vencida há {dias} dia{dias === 1 ? '' : 's'}.</div>}
                {estado === 'vence_amanha' && <div className={styles.linhaDesc}>Alerta: vence amanhã.</div>}
                {estado === 'vence_hoje' && <div className={styles.linhaDesc}>Alerta: vence hoje.</div>}
                {locacao.data_entregue && <div className={styles.linhaDesc}>Entregue em {fmtData(locacao.data_entregue)}.</div>}
                {locacao.observacao && <div className={styles.linhaDesc}>Obs.: {locacao.observacao}</div>}
              </div>
              <div className={styles.linhaMeta}>
                {!locacao.data_entregue && (
                  <>
                    <button className={styles.btnSecundario} onClick={() => setLocacaoEditando(locacao)}>
                      Editar
                    </button>
                    <button className={styles.btnSecundario} onClick={() => registrarEntrega(locacao)}>
                      Registrar entrega
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

interface PainelLocacaoProps {
  locacao?: FerramentaLocacao
  totalDevolvido?: number
  onFechar: () => void
  onSucesso: () => void
}

function PainelLocacao({ locacao, totalDevolvido = 0, onFechar, onSucesso }: PainelLocacaoProps) {
  const { obraAtiva } = useObra()
  const { perfil } = useAuth()

  const editando = !!locacao
  const [nomeEquipamento, setNomeEquipamento] = useState(locacao?.nome_equipamento ?? '')
  const [quantidade, setQuantidade] = useState(String(locacao?.quantidade ?? 1))
  const [locadora, setLocadora] = useState(locacao?.locadora ?? '')
  const [modalidade, setModalidade] = useState<ModalidadeLocacaoFerramenta>(locacao?.modalidade ?? 'diaria')
  const [dataChegada, setDataChegada] = useState(locacao?.data_chegada ?? dataHoje())
  const [dataEntregaPrevista, setDataEntregaPrevista] = useState(locacao?.data_entrega_prevista ?? '')
  const [observacao, setObservacao] = useState(locacao?.observacao ?? '')
  const [salvando, setSalvando] = useState(false)
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)
  const quantidadeTravada = editando && totalDevolvido > 0

  async function salvar() {
    if (!obraAtiva) return
    if (!nomeEquipamento.trim()) {
      setMsg({ tipo: 'erro', texto: 'Informe o equipamento alugado.' })
      return
    }
    const qtd = Number(quantidade)
    if (!Number.isInteger(qtd) || qtd <= 0) {
      setMsg({ tipo: 'erro', texto: 'Informe uma quantidade inteira maior que zero.' })
      return
    }
    if (!locadora.trim()) {
      setMsg({ tipo: 'erro', texto: 'Informe a locadora.' })
      return
    }
    if (!dataChegada) {
      setMsg({ tipo: 'erro', texto: 'Informe o dia de chegada na obra.' })
      return
    }
    if (!dataEntregaPrevista) {
      setMsg({ tipo: 'erro', texto: 'Informe o dia de entrega previsto.' })
      return
    }
    if (dataEntregaPrevista < dataChegada) {
      setMsg({ tipo: 'erro', texto: 'A entrega prevista não pode ser anterior à chegada na obra.' })
      return
    }
    setSalvando(true)
    setMsg(null)
    const payload = {
      nome_equipamento: nomeEquipamento.trim(),
      quantidade: qtd,
      locadora: locadora.trim(),
      modalidade,
      data_chegada: dataChegada,
      data_entrega_prevista: dataEntregaPrevista,
      observacao: observacao.trim() || null,
    }
    const { data, error } = editando
      ? await supabase.from('ferramenta_locacoes').update({
          ...payload,
          editado_por: perfil?.id ?? null,
          editado_em: new Date().toISOString(),
        }).eq('id', locacao.id).is('data_entregue', null).select()
      : await supabase.from('ferramenta_locacoes').insert({ ...payload, obra_id: obraAtiva.id }).select()
    setSalvando(false)
    if (error || !data || data.length === 0) {
      setMsg({ tipo: 'erro', texto: error?.message ?? 'Esta locação já foi entregue por outra pessoa.' })
      return
    }
    onSucesso()
  }

  return (
    <div className={styles.painelForm}>
      <div className={styles.painelHeader}>
        <h2>{editando ? 'Editar loca��o de equipamento' : 'Nova loca��o de equipamento'}</h2>
        <button className={styles.btnFechar} onClick={onFechar}>✕</button>
      </div>
      <div className={styles.linha2}>
        <label className={styles.campo}>
          Equipamento *
          <input value={nomeEquipamento} onChange={e => setNomeEquipamento(e.target.value)} placeholder="Ex.: Compactador de solo" />
        </label>
        <label className={styles.campo}>
          Quantidade *
          <input type="number" min="1" step="1" value={quantidade}
            onChange={e => setQuantidade(e.target.value)} disabled={quantidadeTravada} />
          {quantidadeTravada && <span className={styles.linhaDesc}>J� tem devolu��o registrada - n�o d� mais pra corrigir a quantidade.</span>}
        </label>
        <label className={styles.campo}>
          Locadora *
          <input value={locadora} onChange={e => setLocadora(e.target.value)} placeholder="Nome da locadora" />
        </label>
        <label className={styles.campo}>
          Modalidade *
          <select value={modalidade} onChange={e => setModalidade(e.target.value as ModalidadeLocacaoFerramenta)}>
            <option value="diaria">Diária</option>
            <option value="semanal">Semanal</option>
            <option value="mensal">Mensal</option>
          </select>
        </label>
      </div>
      <div className={styles.linha2}>
        <label className={styles.campo}>
          Chegada na obra *
          <input type="date" value={dataChegada} onChange={e => setDataChegada(e.target.value)} />
        </label>
        <label className={styles.campo}>
          Entrega prevista *
          <input type="date" value={dataEntregaPrevista} onChange={e => setDataEntregaPrevista(e.target.value)} />
        </label>
        <label className={styles.campo}>
          Observação
          <input value={observacao} onChange={e => setObservacao(e.target.value)} placeholder="Opcional" />
        </label>
      </div>
      {msg && <p className={msg.tipo === 'ok' ? styles.msgOk : styles.msgErro}>{msg.texto}</p>}
      <button className={styles.btnPrincipal} onClick={salvar} disabled={salvando}>
        {salvando ? 'Salvando…' : editando ? 'Salvar correção' : 'Cadastrar locação'}
      </button>
    </div>
  )
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
  const { confirmar } = useConfirmDialog()
  const { perfil } = useAuth()
  const { obraAtiva } = useObra()
  const admin = perfil?.papel === 'admin'

  const [materiais, setMateriais] = useState<Material[]>([])
  const [saldos, setSaldos] = useState<Map<string, number>>(new Map())
  const [unidades, setUnidades] = useState<Unidade[]>([])
  const [fornecedores, setFornecedores] = useState<Fornecedor[]>([])
  const [carregando, setCarregando] = useState(true)

  const [busca, setBusca] = useState('')
  const [filtroCategoria, setFiltroCategoria] = useState<CategoriaMaterial | ''>('')
  const [soAbaixoMinimo, setSoAbaixoMinimo] = useState(false)

  const [materialSel, setMaterialSel] = useState<Material | null>(null)
  const [movimentos, setMovimentos] = useState<EstoqueMovimento[]>([])
  const [autores, setAutores] = useState<Map<string, string>>(new Map())
  const [carregandoExtrato, setCarregandoExtrato] = useState(false)
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)

  const [editandoMovId, setEditandoMovId] = useState<string | null>(null)
  const [editBuscaMaterial, setEditBuscaMaterial] = useState('')
  const [editMaterialId, setEditMaterialId] = useState<string | null>(null)
  const [editSugestoesAbertas, setEditSugestoesAbertas] = useState(false)
  const [editQuantidade, setEditQuantidade] = useState('')
  const [editFornecedorSel, setEditFornecedorSel] = useState('')
  const [editNumeroNf, setEditNumeroNf] = useState('')
  const [salvandoEdicao, setSalvandoEdicao] = useState(false)

  const [mostrarEntrada, setMostrarEntrada] = useState(false)
  const [mostrarSaida, setMostrarSaida] = useState(false)
  const [mostrarRequisicao, setMostrarRequisicao] = useState(false)
  const [menuImpressaoAberto, setMenuImpressaoAberto] = useState(false)

  useEffect(() => {
    if (!obraAtiva) return
    setCarregando(true)
    Promise.all([
      supabase.from('materiais').select('*').eq('obra_id', obraAtiva.id).eq('ativo', true).order('nome'),
      supabase.from('estoque_saldos').select('*'),
      supabase.from('unidades').select('*').eq('obra_id', obraAtiva.id).order('ordem'),
      supabase.from('fornecedores').select('*').eq('ativo', true).order('nome'),
    ]).then(([m, s, u, f]) => {
      setMateriais(m.data ?? [])
      setSaldos(new Map((s.data ?? []).map((r: { material_id: string; saldo: number }) => [r.material_id, r.saldo])))
      setUnidades(u.data ?? [])
      setFornecedores(f.data ?? [])
      setCarregando(false)
    })
  }, [obraAtiva])

  const nomeUnidade = useMemo(() => new Map(unidades.map(u => [u.id, u.nome])), [unidades])
  const nomeFornecedor = useMemo(() => new Map(fornecedores.map(f => [f.id, f.nome])), [fornecedores])

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
    const idsAutores = [...new Set((movs ?? []).flatMap(mv => [mv.criado_por, mv.editado_por]).filter((id): id is string => !!id))]
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

  function imprimirEstoque(categoria: CategoriaMaterial) {
    const itens = materiais
      .filter(m => m.categoria === categoria)
      .sort((a, b) => a.nome.localeCompare(b.nome))
      .map(m => ({ codigo: m.codigo, nome: m.nome, und: m.und, saldo: saldos.get(m.id) ?? 0 }))
    gerarPdfEstoque({
      categoriaLabel: CATEGORIA_LABEL[categoria],
      obraNome: obraAtiva?.nome ?? '',
      itens,
    })
    setMenuImpressaoAberto(false)
  }

  async function inativarMovimento(mv: EstoqueMovimento) {
    if (!await confirmar({
      titulo: 'Inativar movimento',
      mensagem: 'Ele deixará de contar no saldo, mas continuará preservado no histórico como exclusão lógica.',
      confirmarTexto: 'Inativar movimento',
      perigoso: true,
    })) return
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

  function abrirEdicao(mv: EstoqueMovimento) {
    setEditandoMovId(mv.id)
    const m = materiais.find(x => x.id === mv.material_id)
    setEditBuscaMaterial(m ? `${m.codigo} — ${m.nome}` : '')
    setEditMaterialId(mv.material_id)
    setEditQuantidade(String(mv.quantidade))
    setEditFornecedorSel(mv.fornecedor_id ?? '')
    setEditNumeroNf(mv.numero_nf ?? '')
    setMsg(null)
  }

  function fecharEdicao() {
    setEditandoMovId(null)
  }

  function sugestoesMateriaisEdit(): Material[] {
    const t = editBuscaMaterial.trim().toLowerCase()
    if (!t) return materiais
    return materiais.filter(m => m.nome.toLowerCase().includes(t) || m.codigo.toLowerCase().includes(t))
  }

  async function salvarEdicao(mv: EstoqueMovimento) {
    if (!editMaterialId) { setMsg({ tipo: 'erro', texto: 'Selecione o material.' }); return }
    const qtd = Number(editQuantidade)
    if (!qtd || qtd <= 0) { setMsg({ tipo: 'erro', texto: 'Informe uma quantidade maior que zero.' }); return }
    setSalvandoEdicao(true)
    setMsg(null)
    const { data, error } = await supabase.from('estoque_movimentos').update({
      material_id: editMaterialId,
      quantidade: qtd,
      fornecedor_id: editFornecedorSel || null,
      numero_nf: editNumeroNf.trim() || null,
      editado_por: perfil?.id,
      editado_em: new Date().toISOString(),
    }).eq('id', mv.id).select()
    setSalvandoEdicao(false)
    if (error) { setMsg({ tipo: 'erro', texto: `Erro ao editar: ${error.message}` }); return }
    if (!data || data.length === 0) {
      setMsg({ tipo: 'erro', texto: 'Não foi possível salvar — o movimento pode ter sido alterado por outra pessoa.' })
      return
    }
    setEditandoMovId(null)
    await recarregarSaldos()
    if (materialSel) await abrirExtrato(materialSel)
    setMsg({ tipo: 'ok', texto: 'Entrada corrigida.' })
  }

  return (
    <div>
      <div className={styles.topoAcoes}>
        <button className={styles.btnSecundario} onClick={() => setMostrarSaida(true)}>− Saída avulsa</button>
        <button className={styles.btnSecundario} onClick={() => setMostrarRequisicao(true)}>📋 Lançar requisição</button>
        <div className={styles.autocompleteWrap}>
          <button
            className={styles.btnSecundario}
            onClick={() => setMenuImpressaoAberto(a => !a)}
            onBlur={() => setTimeout(() => setMenuImpressaoAberto(false), 150)}
          >
            🖨️ Imprimir estoque
          </button>
          {menuImpressaoAberto && (
            <div className={styles.sugestoes}>
              <button className={styles.sugestao} onMouseDown={() => imprimirEstoque('material')}>Material</button>
              <button className={styles.sugestao} onMouseDown={() => imprimirEstoque('epi')}>EPI</button>
              <button className={styles.sugestao} onMouseDown={() => imprimirEstoque('escritorio')}>Escritório</button>
            </div>
          )}
        </div>
        <button className={styles.btnPrincipal} onClick={() => setMostrarEntrada(true)}>+ Entrada de material</button>
      </div>

      {mostrarEntrada && (
        <PainelEntrada
          materiais={materiais}
          fornecedores={fornecedores}
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
                  {editandoMovId === mv.id ? (
                    <div className={styles.blocoAninhado}>
                      <label className={styles.campo}>
                        Material *
                        <div className={styles.autocompleteWrap}>
                          <input
                            value={editBuscaMaterial}
                            onChange={e => { setEditBuscaMaterial(e.target.value); setEditMaterialId(null); setEditSugestoesAbertas(true) }}
                            onFocus={() => setEditSugestoesAbertas(true)}
                            onBlur={() => setTimeout(() => setEditSugestoesAbertas(false), 150)}
                          />
                          {editSugestoesAbertas && sugestoesMateriaisEdit().length > 0 && (
                            <div className={styles.sugestoes}>
                              {sugestoesMateriaisEdit().map(m => (
                                <button key={m.id} className={styles.sugestao}
                                  onMouseDown={() => { setEditMaterialId(m.id); setEditBuscaMaterial(`${m.codigo} — ${m.nome}`); setEditSugestoesAbertas(false) }}>
                                  <span className={styles.sugestaoCodigo}>{m.codigo}</span>{m.nome}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </label>
                      <div className={styles.linha2}>
                        <label className={styles.campo}>
                          Quantidade *
                          <input type="number" min="0" step="0.01" value={editQuantidade} onChange={e => setEditQuantidade(e.target.value)} />
                        </label>
                        <label className={styles.campo}>
                          Fornecedor
                          <select value={editFornecedorSel} onChange={e => setEditFornecedorSel(e.target.value)}>
                            <option value="">Selecione…</option>
                            {fornecedores.map(f => <option key={f.id} value={f.id}>{f.nome}</option>)}
                          </select>
                        </label>
                      </div>
                      <label className={styles.campo}>
                        Nº da NF
                        <input value={editNumeroNf} onChange={e => setEditNumeroNf(e.target.value)} placeholder="Opcional" />
                      </label>
                      <div className={styles.acoesInline}>
                        <button className={styles.btnSecundario} onClick={fecharEdicao}>Cancelar</button>
                        <button className={styles.btnPrincipal} onClick={() => salvarEdicao(mv)} disabled={salvandoEdicao}>
                          {salvandoEdicao ? 'Salvando…' : 'Salvar'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
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
                        {mv.fornecedor_id !== null && <span>Fornecedor: {nomeFornecedor.get(mv.fornecedor_id) ?? '?'}</span>}
                        {mv.numero_nf && <span>NF: {mv.numero_nf}</span>}
                        {mv.unidade_id !== null && <span>Destino: {nomeUnidade.get(mv.unidade_id) ?? '?'}</span>}
                        {mv.retirado_por && <span>Retirado por: {mv.retirado_por}</span>}
                        {mv.aplicacao && <span>Aplicação: {mv.aplicacao}</span>}
                        {mv.observacao && <span>Obs.: {mv.observacao}</span>}
                        {mv.editado_em && (
                          <span>Corrigido por {autores.get(mv.editado_por ?? '') ?? '?'} em {fmtDataHora(mv.editado_em)}</span>
                        )}
                      </div>
                      <div className={styles.movRodape}>
                        <span>{autores.get(mv.criado_por) ?? '?'} · {fmtDataHora(mv.criado_em)}</span>
                        <div style={{ display: 'flex', gap: 8 }}>
                          {admin && mv.tipo === 'entrada' && mv.ativo && (
                            <button className={styles.btnSecundario} onClick={() => abrirEdicao(mv)}>Editar</button>
                          )}
                          {admin && mv.ativo && (
                            <button className={styles.btnInativar} onClick={() => inativarMovimento(mv)}>Inativar</button>
                          )}
                        </div>
                      </div>
                    </>
                  )}
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
  const { confirmar } = useConfirmDialog()
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
    if (!await confirmar({
      titulo: 'Registrar devolução',
      mensagem: 'Confirma que a ferramenta foi devolvida ao almoxarifado?',
      confirmarTexto: 'Confirmar devolução',
    })) return
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

interface InsumoLinha {
  chave: string
  buscaMaterial: string
  materialId: string | null
  sugestoesAbertas: boolean
  quantidade: string
  itemSel: string
  observacao: string
}

function insumoVazio(): InsumoLinha {
  return {
    chave: crypto.randomUUID(),
    buscaMaterial: '',
    materialId: null,
    sugestoesAbertas: false,
    quantidade: '',
    itemSel: '',
    observacao: '',
  }
}

interface PainelEntradaProps {
  materiais: Material[]
  fornecedores: Fornecedor[]
  onFechar: () => void
  onMaterialCriado: (m: Material) => void
  onSucesso: () => void
}

function PainelEntrada({ materiais, fornecedores, onFechar, onMaterialCriado, onSucesso }: PainelEntradaProps) {
  const { obraAtiva } = useObra()

  const [insumos, setInsumos] = useState<InsumoLinha[]>([insumoVazio()])

  const [criandoMaterialPara, setCriandoMaterialPara] = useState<string | null>(null)
  const [novoNome, setNovoNome] = useState('')
  const [novoUnd, setNovoUnd] = useState('')
  const [novaCategoria, setNovaCategoria] = useState<CategoriaMaterial>('material')
  const [salvandoMaterial, setSalvandoMaterial] = useState(false)

  const [fornecedorSel, setFornecedorSel] = useState('')
  const [numeroNf, setNumeroNf] = useState('')

  const [pedidos, setPedidos] = useState<PedidoCompra[] | null>(null)
  const [pedidoSel, setPedidoSel] = useState('')
  const [itensPedido, setItensPedido] = useState<PedidoCompraItem[]>([])
  const [carregandoItens, setCarregandoItens] = useState(false)

  const [salvando, setSalvando] = useState(false)
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)

  useEffect(() => {
    if (!obraAtiva) return
    supabase.from('pedidos_compra').select('*')
      .eq('obra_id', obraAtiva.id).in('status', PEDIDO_STATUS_VINCULAVEL).order('numero')
      .then(({ data }) => setPedidos(data ?? []))
  }, [obraAtiva])

  function sugestoesMateriais(busca: string): Material[] {
    const t = busca.trim().toLowerCase()
    if (!t) return materiais
    return materiais.filter(m => m.nome.toLowerCase().includes(t) || m.codigo.toLowerCase().includes(t))
  }

  function atualizarInsumo(chave: string, patch: Partial<InsumoLinha>) {
    setInsumos(prev => prev.map(i => i.chave === chave ? { ...i, ...patch } : i))
  }

  function escolherMaterialInsumo(chave: string, m: Material) {
    atualizarInsumo(chave, { materialId: m.id, buscaMaterial: `${m.codigo} — ${m.nome}`, sugestoesAbertas: false })
  }

  function removerInsumo(chave: string) {
    setInsumos(prev => prev.length > 1 ? prev.filter(i => i.chave !== chave) : prev)
  }

  function adicionarInsumo() {
    setInsumos(prev => [...prev, insumoVazio()])
  }

  async function criarMaterial() {
    if (!obraAtiva || !criandoMaterialPara) return
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
    escolherMaterialInsumo(criandoMaterialPara, resultado.novo)
    setCriandoMaterialPara(null)
    setNovoNome(''); setNovoUnd(''); setNovaCategoria('material')
  }

  async function selecionarPedido(pedidoId: string) {
    setPedidoSel(pedidoId)
    setInsumos(prev => prev.map(i => ({ ...i, itemSel: '' })))
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
    const linhasValidas = insumos.filter(i => i.materialId && Number(i.quantidade) > 0)
    if (linhasValidas.length === 0) {
      setMsg({ tipo: 'erro', texto: 'Adicione ao menos um insumo com material e quantidade.' })
      return
    }
    setSalvando(true)
    setMsg(null)
    const { error } = await supabase.from('estoque_movimentos').insert(
      linhasValidas.map(i => ({
        obra_id: obraAtiva.id,
        material_id: i.materialId,
        tipo: 'entrada' as const,
        quantidade: Number(i.quantidade),
        pedido_item_id: i.itemSel || null,
        fornecedor_id: fornecedorSel || null,
        numero_nf: numeroNf.trim() || null,
        observacao: i.observacao.trim() || null,
      }))
    )
    setSalvando(false)
    if (error) {
      setMsg({ tipo: 'erro', texto: `Falha ao registrar entrada: ${error.message}` })
      return
    }
    onSucesso()
  }

  return (
    <div className={styles.painelForm}>
      <div className={styles.painelHeader}>
        <h2>Entrada de material</h2>
        <button className={styles.btnFechar} onClick={onFechar}>✕</button>
      </div>

      <div className={styles.linha2}>
        <label className={styles.campo}>
          Fornecedor (opcional)
          <select value={fornecedorSel} onChange={e => setFornecedorSel(e.target.value)}>
            <option value="">Selecione…</option>
            {fornecedores.map(f => <option key={f.id} value={f.id}>{f.nome}</option>)}
          </select>
        </label>
        <label className={styles.campo}>
          Nº da NF (opcional)
          <input value={numeroNf} onChange={e => setNumeroNf(e.target.value)} placeholder="Ex.: 12345" />
        </label>
      </div>

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

      <h2 style={{ marginTop: 12 }}>Insumos</h2>
      {insumos.map(insumo => {
        const sugestoes = insumo.sugestoesAbertas ? sugestoesMateriais(insumo.buscaMaterial) : []
        return (
          <div key={insumo.chave} className={styles.itemLinhaReq}>
            {insumos.length > 1 && (
              <button className={styles.btnRemoverItem} onClick={() => removerInsumo(insumo.chave)}>✕</button>
            )}
            <div className={styles.campo}>
              Material *
              <div className={styles.autocompleteWrap}>
                <input
                  value={insumo.buscaMaterial}
                  onChange={e => atualizarInsumo(insumo.chave, { buscaMaterial: e.target.value, materialId: null, sugestoesAbertas: true })}
                  onFocus={() => atualizarInsumo(insumo.chave, { sugestoesAbertas: true })}
                  onBlur={() => setTimeout(() => atualizarInsumo(insumo.chave, { sugestoesAbertas: false }), 150)}
                  placeholder="Buscar por código ou nome…"
                  disabled={criandoMaterialPara === insumo.chave}
                />
                {sugestoes.length > 0 && (
                  <div className={styles.sugestoes}>
                    {sugestoes.map(m => (
                      <button key={m.id} className={styles.sugestao} onMouseDown={() => escolherMaterialInsumo(insumo.chave, m)}>
                        <span className={styles.sugestaoCodigo}>{m.codigo}</span>{m.nome}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {insumo.materialId
                ? <span className={styles.vinculoOk}>✓ material selecionado</span>
                : <span className={styles.vinculoAusente}>⚠ nenhum material selecionado</span>}

              {criandoMaterialPara !== insumo.chave ? (
                <button className={styles.btnSecundario} onClick={() => setCriandoMaterialPara(insumo.chave)} style={{ marginTop: 6 }}>
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
                    <button className={styles.btnSecundario} onClick={() => setCriandoMaterialPara(null)}>Cancelar</button>
                    <button className={styles.btnPrincipal} onClick={criarMaterial} disabled={salvandoMaterial}>
                      {salvandoMaterial ? 'Criando…' : 'Criar material'}
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className={styles.linha2}>
              <label className={styles.campo}>
                Quantidade *
                <input type="number" min="0" step="0.01" value={insumo.quantidade}
                  onChange={e => atualizarInsumo(insumo.chave, { quantidade: e.target.value })} />
              </label>
              <label className={styles.campo}>
                Observação
                <input value={insumo.observacao} onChange={e => atualizarInsumo(insumo.chave, { observacao: e.target.value })} placeholder="Opcional" />
              </label>
            </div>

            {pedidoSel && (
              <label className={styles.campo}>
                Item do pedido
                <select value={insumo.itemSel} onChange={e => atualizarInsumo(insumo.chave, { itemSel: e.target.value })} disabled={carregandoItens}>
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
            )}
          </div>
        )
      })}
      <button className={styles.btnAddItem} onClick={adicionarInsumo}>+ Adicionar insumo</button>

      {msg && <p className={msg.tipo === 'ok' ? styles.msgOk : styles.msgErro}>{msg.texto}</p>}
      <button className={styles.btnPrincipal} onClick={salvar} disabled={salvando} style={{ marginTop: 12 }}>
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
