import { useEffect, useMemo, useState } from 'react'
import AplicacaoCascata from '../components/AplicacaoCascata'
import { useAuth } from '../contexts/AuthContext'
import { useObra } from '../contexts/ObraContext'
import { formatarMoeda } from '../lib/formato'
import { supabase, type Etapa, type LancamentoFinanceiro, type Servico, type Unidade } from '../lib/supabase'
import styles from './Financeiro.module.css'

type FiltroStatus = 'todos' | 'a_pagar' | 'pago'
type FiltroOrigem = 'todas' | 'medicao' | 'compra' | 'avulso'

const hojeIso = () => new Date().toISOString().slice(0, 10)

async function carregarTodosServicos(): Promise<Servico[]> {
  const todos: Servico[] = []
  const pagina = 1000
  for (let de = 0; ; de += pagina) {
    const { data } = await supabase.from('servicos').select('*').eq('ativo', true).order('codigo').range(de, de + pagina - 1)
    const lote = data ?? []
    todos.push(...lote)
    if (lote.length < pagina) break
  }
  return todos
}

async function carregarUnidadesEEtapas(obraId: string): Promise<{ unidades: Unidade[]; etapas: Etapa[] }> {
  const { data: unidadesData } = await supabase.from('unidades').select('*').eq('obra_id', obraId).order('ordem')
  const unidades = unidadesData ?? []
  const ids = unidades.map(u => u.id)
  if (ids.length === 0) return { unidades, etapas: [] }
  const { data: etapasData } = await supabase.from('etapas').select('*').in('unidade_id', ids).eq('placeholder', false).order('ordem')
  return { unidades, etapas: etapasData ?? [] }
}

function origemLancamento(l: LancamentoFinanceiro): FiltroOrigem {
  if (l.medicao_item_id) return 'medicao'
  if (l.pedido_item_id) return 'compra'
  return 'avulso'
}

function origemLabel(l: LancamentoFinanceiro): string {
  const origem = origemLancamento(l)
  if (origem === 'medicao') return 'Medição'
  if (origem === 'compra') return 'Compra'
  return 'Avulso'
}

function diasAte(data: string | null): number | null {
  if (!data) return null
  const hoje = new Date(`${hojeIso()}T00:00:00`)
  const alvo = new Date(`${data}T00:00:00`)
  return Math.round((alvo.getTime() - hoje.getTime()) / 86400000)
}

export default function Financeiro() {
  const { obraAtiva } = useObra()
  const { perfil, temModulo } = useAuth()
  const podeAcessar = perfil?.papel === 'admin' || (perfil?.papel === 'equipe' && temModulo('financeiro'))

  const [lancamentos, setLancamentos] = useState<LancamentoFinanceiro[]>([])
  const [servicos, setServicos] = useState<Servico[]>([])
  const [etapas, setEtapas] = useState<Etapa[]>([])
  const [unidades, setUnidades] = useState<Unidade[]>([])
  const [carregando, setCarregando] = useState(true)
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)

  const [filtroStatus, setFiltroStatus] = useState<FiltroStatus>('a_pagar')
  const [filtroOrigem, setFiltroOrigem] = useState<FiltroOrigem>('todas')
  const [busca, setBusca] = useState('')

  const [descricao, setDescricao] = useState('')
  const [favorecido, setFavorecido] = useState('')
  const [valor, setValor] = useState('')
  const [vencimento, setVencimento] = useState(hojeIso())
  const [servicoId, setServicoId] = useState<string | null>(null)
  const [observacao, setObservacao] = useState('')
  const [salvando, setSalvando] = useState(false)

  const [baixando, setBaixando] = useState<LancamentoFinanceiro | null>(null)
  const [baixaData, setBaixaData] = useState(hojeIso())
  const [baixaForma, setBaixaForma] = useState('')
  const [baixaConta, setBaixaConta] = useState('')
  const [salvandoBaixa, setSalvandoBaixa] = useState(false)
  const [editando, setEditando] = useState<LancamentoFinanceiro | null>(null)
  const [editDescricao, setEditDescricao] = useState('')
  const [editFavorecido, setEditFavorecido] = useState('')
  const [editValor, setEditValor] = useState('')
  const [editVencimento, setEditVencimento] = useState('')
  const [editServicoId, setEditServicoId] = useState<string | null>(null)
  const [editObservacao, setEditObservacao] = useState('')
  const [salvandoEdicao, setSalvandoEdicao] = useState(false)

  useEffect(() => {
    if (!obraAtiva || !podeAcessar) return
    carregarBase()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [obraAtiva?.id, podeAcessar])

  async function carregarBase() {
    if (!obraAtiva) return
    setCarregando(true)
    setMsg(null)
    const [{ data: lancs, error }, servs, base] = await Promise.all([
      supabase.from('lancamentos_financeiros').select('*').eq('obra_id', obraAtiva.id).eq('ativo', true).order('data_vencimento', { ascending: true, nullsFirst: false }).order('criado_em', { ascending: false }),
      carregarTodosServicos(),
      carregarUnidadesEEtapas(obraAtiva.id),
    ])
    if (error) setMsg({ tipo: 'erro', texto: `Erro ao carregar lançamentos: ${error.message}` })
    setLancamentos(lancs ?? [])
    setServicos(servs)
    setUnidades(base.unidades)
    setEtapas(base.etapas)
    setCarregando(false)
  }

  const resumo = useMemo(() => {
    const abertos = lancamentos.filter(l => l.status === 'a_pagar')
    const vencidos = abertos.filter(l => {
      const dias = diasAte(l.data_vencimento)
      return dias !== null && dias < 0
    })
    const proximos = abertos.filter(l => {
      const dias = diasAte(l.data_vencimento)
      return dias !== null && dias >= 0 && dias <= 7
    })
    return {
      aberto: abertos.reduce((s, l) => s + l.valor, 0),
      pago: lancamentos.filter(l => l.status === 'pago').reduce((s, l) => s + l.valor, 0),
      vencidos: vencidos.reduce((s, l) => s + l.valor, 0),
      proximos: proximos.reduce((s, l) => s + l.valor, 0),
      qtdVencidos: vencidos.length,
      qtdProximos: proximos.length,
    }
  }, [lancamentos])

  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase()
    return lancamentos.filter(l => {
      if (filtroStatus !== 'todos' && l.status !== filtroStatus) return false
      if (filtroOrigem !== 'todas' && origemLancamento(l) !== filtroOrigem) return false
      if (!termo) return true
      return [l.descricao, l.favorecido, l.observacao ?? ''].some(v => v.toLowerCase().includes(termo))
    })
  }, [busca, filtroOrigem, filtroStatus, lancamentos])

  function aplicacao(l: LancamentoFinanceiro): string {
    const servico = l.servico_id ? servicos.find(s => s.id === l.servico_id) : null
    const etapa = l.etapa_id ? etapas.find(e => e.id === l.etapa_id) : (servico ? etapas.find(e => e.id === servico.etapa_id) : null)
    const unidade = l.unidade_id ? unidades.find(u => u.id === l.unidade_id) : (etapa ? unidades.find(u => u.id === etapa.unidade_id) : null)
    if (servico) return `${unidade?.nome ?? 'Unidade'} / ${etapa?.nome ?? 'Etapa'} / ${servico.nome}`
    if (etapa) return `${unidade?.nome ?? 'Unidade'} / ${etapa.nome}`
    return 'A classificar'
  }

  async function criarAvulso() {
    if (!obraAtiva || !perfil) return
    const valorNumero = Number(valor)
    if (!descricao.trim() || !favorecido.trim() || Number.isNaN(valorNumero) || valorNumero <= 0 || !vencimento) {
      setMsg({ tipo: 'erro', texto: 'Preencha descrição, favorecido, valor maior que zero e vencimento.' })
      return
    }
    const servico = servicoId ? servicos.find(s => s.id === servicoId) : null
    const etapa = servico ? etapas.find(e => e.id === servico.etapa_id) : null
    setSalvando(true)
    setMsg(null)
    const { error } = await supabase.from('lancamentos_financeiros').insert({
      obra_id: obraAtiva.id,
      unidade_id: etapa?.unidade_id ?? null,
      etapa_id: etapa?.id ?? null,
      servico_id: servico?.id ?? null,
      descricao: descricao.trim(),
      favorecido: favorecido.trim(),
      valor: valorNumero,
      data_vencimento: vencimento,
      observacao: observacao.trim() || null,
      criado_por: perfil.id,
    })
    setSalvando(false)
    if (error) {
      setMsg({ tipo: 'erro', texto: `Erro ao lançar: ${error.message}` })
      return
    }
    setDescricao('')
    setFavorecido('')
    setValor('')
    setVencimento(hojeIso())
    setServicoId(null)
    setObservacao('')
    setMsg({ tipo: 'ok', texto: 'Lançamento avulso criado.' })
    carregarBase()
  }

  function iniciarBaixa(l: LancamentoFinanceiro) {
    setBaixando(l)
    setEditando(null)
    setBaixaData(hojeIso())
    setBaixaForma(l.forma_pagamento ?? '')
    setBaixaConta(l.conta_origem ?? '')
  }

  function iniciarEdicao(l: LancamentoFinanceiro) {
    setEditando(l)
    setBaixando(null)
    setEditDescricao(l.descricao)
    setEditFavorecido(l.favorecido)
    setEditValor(String(l.valor))
    setEditVencimento(l.data_vencimento ?? hojeIso())
    setEditServicoId(l.servico_id)
    setEditObservacao(l.observacao ?? '')
    setMsg(null)
  }

  async function confirmarBaixa() {
    if (!baixando || !perfil) return
    if (!baixaData || !baixaForma.trim()) {
      setMsg({ tipo: 'erro', texto: 'Informe data e forma de pagamento.' })
      return
    }
    setSalvandoBaixa(true)
    setMsg(null)
    const { error } = await supabase.from('lancamentos_financeiros').update({
      status: 'pago',
      data_pagamento: baixaData,
      forma_pagamento: baixaForma.trim(),
      conta_origem: baixaConta.trim() || null,
      pago_por: perfil.id,
      pago_em: new Date().toISOString(),
    }).eq('id', baixando.id)
    setSalvandoBaixa(false)
    if (error) {
      setMsg({ tipo: 'erro', texto: `Erro ao dar baixa: ${error.message}` })
      return
    }
    setBaixando(null)
    setMsg({ tipo: 'ok', texto: 'Baixa registrada.' })
    carregarBase()
  }

  async function salvarEdicao() {
    if (!editando) return
    const valorNumero = Number(editValor)
    if (!editDescricao.trim() || !editFavorecido.trim() || Number.isNaN(valorNumero) || valorNumero <= 0) {
      setMsg({ tipo: 'erro', texto: 'Preencha descrição, favorecido e valor maior que zero.' })
      return
    }
    const servico = editServicoId ? servicos.find(s => s.id === editServicoId) : null
    const etapa = servico ? etapas.find(e => e.id === servico.etapa_id) : null
    setSalvandoEdicao(true)
    setMsg(null)
    const { error } = await supabase.from('lancamentos_financeiros').update({
      unidade_id: etapa?.unidade_id ?? null,
      etapa_id: etapa?.id ?? null,
      servico_id: servico?.id ?? null,
      descricao: editDescricao.trim(),
      favorecido: editFavorecido.trim(),
      valor: valorNumero,
      data_vencimento: editVencimento || null,
      observacao: editObservacao.trim() || null,
    }).eq('id', editando.id)
    setSalvandoEdicao(false)
    if (error) {
      setMsg({ tipo: 'erro', texto: `Erro ao editar: ${error.message}` })
      return
    }
    setEditando(null)
    setMsg({ tipo: 'ok', texto: 'Lançamento atualizado.' })
    carregarBase()
  }

  if (!podeAcessar) {
    return (
      <div className={styles.pagina}>
        <h1>Financeiro</h1>
        <p className={styles.alerta}>Módulo de uso interno. Acesso restrito ao admin e equipe com permissão Financeiro.</p>
      </div>
    )
  }

  return (
    <div className={styles.pagina}>
      <div className={styles.cabecalho}>
        <div>
          <h1>Financeiro</h1>
          <p>Livro de lançamentos a pagar e pagos da obra ativa.</p>
        </div>
        <button className={styles.btnSecundario} onClick={carregarBase} disabled={carregando}>
          Atualizar
        </button>
      </div>

      <div className={styles.kpis}>
        <div className={styles.kpi}><span>A pagar</span><strong>R$ {formatarMoeda(resumo.aberto)}</strong></div>
        <div className={styles.kpi}><span>Vencidos</span><strong>R$ {formatarMoeda(resumo.vencidos)}</strong><small>{resumo.qtdVencidos} lanç.</small></div>
        <div className={styles.kpi}><span>Próx. 7 dias</span><strong>R$ {formatarMoeda(resumo.proximos)}</strong><small>{resumo.qtdProximos} lanç.</small></div>
        <div className={styles.kpi}><span>Pago</span><strong>R$ {formatarMoeda(resumo.pago)}</strong></div>
      </div>

      {msg && <p className={msg.tipo === 'ok' ? styles.msgOk : styles.msgErro}>{msg.texto}</p>}

      <section className={styles.bloco}>
        <h2>Lançamento avulso</h2>
        <div className={styles.formGrid}>
          <label className={styles.campo}>Descrição<input value={descricao} onChange={e => setDescricao(e.target.value)} /></label>
          <label className={styles.campo}>Favorecido<input value={favorecido} onChange={e => setFavorecido(e.target.value)} /></label>
          <label className={styles.campo}>Valor<input type="number" min="0" step="0.01" value={valor} onChange={e => setValor(e.target.value)} /></label>
          <label className={styles.campo}>Vencimento<input type="date" value={vencimento} onChange={e => setVencimento(e.target.value)} /></label>
        </div>
        <AplicacaoCascata unidades={unidades} etapas={etapas} servicos={servicos} servicoId={servicoId} onSelecionar={setServicoId} />
        <label className={styles.campo}>Observação<input value={observacao} onChange={e => setObservacao(e.target.value)} /></label>
        <button className={styles.btnPrincipal} onClick={criarAvulso} disabled={salvando}>{salvando ? 'Salvando...' : 'Criar lançamento'}</button>
      </section>

      {baixando && (
        <section className={styles.bloco}>
          <h2>Dar baixa</h2>
          <p className={styles.meta}>{baixando.descricao} - R$ {formatarMoeda(baixando.valor)}</p>
          <div className={styles.formGrid}>
            <label className={styles.campo}>Data do pagamento<input type="date" value={baixaData} onChange={e => setBaixaData(e.target.value)} /></label>
            <label className={styles.campo}>Forma de pagamento<input value={baixaForma} onChange={e => setBaixaForma(e.target.value)} placeholder="Pix, boleto, transferência..." /></label>
            <label className={styles.campo}>Conta origem<input value={baixaConta} onChange={e => setBaixaConta(e.target.value)} /></label>
          </div>
          <div className={styles.acoes}>
            <button className={styles.btnPrincipal} onClick={confirmarBaixa} disabled={salvandoBaixa}>{salvandoBaixa ? 'Salvando...' : 'Confirmar baixa'}</button>
            <button className={styles.btnSecundario} onClick={() => setBaixando(null)}>Cancelar</button>
          </div>
        </section>
      )}

      {editando && (
        <section className={styles.bloco}>
          <h2>Editar lançamento</h2>
          <p className={styles.meta}>{editando.descricao} - R$ {formatarMoeda(editando.valor)}</p>
          <div className={styles.formGrid}>
            <label className={styles.campo}>Descrição<input value={editDescricao} onChange={e => setEditDescricao(e.target.value)} /></label>
            <label className={styles.campo}>Favorecido<input value={editFavorecido} onChange={e => setEditFavorecido(e.target.value)} /></label>
            <label className={styles.campo}>Valor<input type="number" min="0" step="0.01" value={editValor} onChange={e => setEditValor(e.target.value)} /></label>
            <label className={styles.campo}>Vencimento<input type="date" value={editVencimento} onChange={e => setEditVencimento(e.target.value)} /></label>
          </div>
          <AplicacaoCascata unidades={unidades} etapas={etapas} servicos={servicos} servicoId={editServicoId} onSelecionar={setEditServicoId} />
          <label className={styles.campo}>Observação<input value={editObservacao} onChange={e => setEditObservacao(e.target.value)} /></label>
          <div className={styles.acoes}>
            <button className={styles.btnPrincipal} onClick={salvarEdicao} disabled={salvandoEdicao}>{salvandoEdicao ? 'Salvando...' : 'Salvar edição'}</button>
            <button className={styles.btnSecundario} onClick={() => setEditando(null)}>Cancelar</button>
          </div>
        </section>
      )}

      <section className={styles.bloco}>
        <div className={styles.filtros}>
          <label className={styles.campo}>Status
            <select value={filtroStatus} onChange={e => setFiltroStatus(e.target.value as FiltroStatus)}>
              <option value="todos">Todos</option>
              <option value="a_pagar">A pagar</option>
              <option value="pago">Pago</option>
            </select>
          </label>
          <label className={styles.campo}>Origem
            <select value={filtroOrigem} onChange={e => setFiltroOrigem(e.target.value as FiltroOrigem)}>
              <option value="todas">Todas</option>
              <option value="medicao">Medições</option>
              <option value="compra">Compras</option>
              <option value="avulso">Avulsos</option>
            </select>
          </label>
          <label className={styles.campo}>Buscar<input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Descrição, favorecido ou observação" /></label>
        </div>

        <div className={styles.tabelaWrap}>
          <table className={styles.tabela}>
            <thead>
              <tr>
                <th>Vencimento</th>
                <th>Descrição</th>
                <th>Favorecido</th>
                <th>Aplicação</th>
                <th>Origem</th>
                <th>Status</th>
                <th>Valor</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtrados.map(l => {
                const dias = diasAte(l.data_vencimento)
                const vencido = l.status === 'a_pagar' && dias !== null && dias < 0
                const proximo = l.status === 'a_pagar' && dias !== null && dias >= 0 && dias <= 7
                return (
                  <tr key={l.id} className={vencido ? styles.vencido : proximo ? styles.proximo : ''}>
                    <td data-label="Vencimento">{l.data_vencimento ? new Date(`${l.data_vencimento}T00:00:00`).toLocaleDateString('pt-BR') : '-'}</td>
                    <td data-label="Descrição">{l.descricao}</td>
                    <td data-label="Favorecido">{l.favorecido}</td>
                    <td data-label="Aplicação">{aplicacao(l)}</td>
                    <td data-label="Origem"><span className={styles.badge}>{origemLabel(l)}</span></td>
                    <td data-label="Status">{l.status === 'pago' ? 'Pago' : vencido ? 'Vencido' : 'A pagar'}</td>
                    <td data-label="Valor"><strong>R$ {formatarMoeda(l.valor)}</strong></td>
                    <td data-label="Ação">
                      {l.status === 'a_pagar' && (
                        <div className={styles.acoesTabela}>
                          <button className={styles.btnSecundario} onClick={() => iniciarEdicao(l)}>Editar</button>
                          <button className={styles.btnSecundario} onClick={() => iniciarBaixa(l)}>Dar baixa</button>
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
              {!carregando && filtrados.length === 0 && (
                <tr><td colSpan={8} className={styles.vazio}>Nenhum lançamento encontrado.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
