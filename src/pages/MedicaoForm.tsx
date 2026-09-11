import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import {
  supabase, type Contrato, type ContratoItem, type Servico, type Unidade,
  type Medicao, type MedicaoItem, type MedicaoDeducao, type StatusMedicao,
} from '../lib/supabase'
import { gerarPdfMedicao, type DeducaoPdfMedicao } from '../lib/medicoesPdf'
import { hojeISO } from '../lib/cronograma'
import { carregarIdentidadeObra } from '../lib/pdfBranding'
import { formatarMoeda } from '../lib/formato'
import { useConfirmDialog } from '../components/ConfirmDialogContext'
import styles from './MedicaoForm.module.css'

export const STATUS_MEDICAO_LABEL: Record<StatusMedicao, string> = {
  rascunho: 'Rascunho',
  aprovada: 'Aprovada',
  cancelada: 'Cancelada',
}

interface ItemLinha {
  contratoItemId: string
  servicoNome: string
  servicoCodigo: string
  und: string
  unidadeNome: string
  quantidadeContratada: number
  valorUnitario: number
  jaAprovado: number
  quantidadePeriodo: string
  medicaoItemId: string | null
}

interface DeducaoLinha {
  id: string | null
  descricao: string
  quantidade: string
  valorUnitario: string
  removido: boolean
}

export default function MedicaoForm() {
  const { confirmar, solicitarTexto } = useConfirmDialog()
  const { contratoId, medicaoId } = useParams()
  const nova = medicaoId === 'nova'
  const navigate = useNavigate()
  const { perfil, temModulo } = useAuth()
  const podeEditar = perfil?.papel === 'admin' || temModulo('medicoes')
  const ehAdmin = perfil?.papel === 'admin'

  const [carregando, setCarregando] = useState(true)
  const [contrato, setContrato] = useState<Contrato | null>(null)
  const [canceladorNome, setCanceladorNome] = useState<string | null>(null)
  const [empreiteiroNome, setEmpreiteiroNome] = useState('—')
  const [contratoItens, setContratoItens] = useState<ContratoItem[]>([])
  const [servicos, setServicos] = useState<Servico[]>([])
  const [unidades, setUnidades] = useState<Unidade[]>([])
  const [medicao, setMedicao] = useState<Medicao | null>(null)
  const [medicoesContrato, setMedicoesContrato] = useState<Medicao[]>([])
  const [itensExistentes, setItensExistentes] = useState<MedicaoItem[]>([])
  const [deducoesExistentes, setDeducoesExistentes] = useState<MedicaoDeducao[]>([])
  const [jaAprovadoPorItem, setJaAprovadoPorItem] = useState<Map<string, number>>(new Map())

  const [dataInicio, setDataInicio] = useState(() => hojeISO().slice(0, 8) + '01')
  const [dataFim, setDataFim] = useState(() => hojeISO())
  const [linhas, setLinhas] = useState<ItemLinha[]>([])
  const [deducoes, setDeducoes] = useState<DeducaoLinha[]>([])
  const [salvando, setSalvando] = useState(false)
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)

  useEffect(() => { if (contratoId) carregar(contratoId) }, [contratoId, medicaoId])

  async function carregar(cId: string) {
    setCarregando(true)
    const [{ data: c }, { data: itensContrato }, { data: todasMedicoes }] = await Promise.all([
      supabase.from('contratos').select('*').eq('id', cId).single(),
      supabase.from('contratos_itens').select('*').eq('contrato_id', cId).eq('ativo', true).order('criado_em'),
      supabase.from('medicoes').select('*').eq('contrato_id', cId).eq('ativo', true),
    ])
    setContrato(c ?? null)
    setContratoItens(itensContrato ?? [])
    setMedicoesContrato(todasMedicoes ?? [])

    if (c) {
      const { data: emp } = await supabase.from('empreiteiros').select('nome').eq('id', c.empreiteiro_id).single()
      setEmpreiteiroNome(emp?.nome ?? '—')
    }

    const medicaoIds = (todasMedicoes ?? []).map(m => m.id)
    const { data: todosItensMedicoes } = medicaoIds.length > 0
      ? await supabase.from('medicoes_itens').select('*').in('medicao_id', medicaoIds).eq('ativo', true)
      : { data: [] as MedicaoItem[] }

    const aprovadasIds = new Set((todasMedicoes ?? []).filter(m => m.status === 'aprovada').map(m => m.id))
    const mapaAprovado = new Map<string, number>()
    for (const it of todosItensMedicoes ?? []) {
      if (!aprovadasIds.has(it.medicao_id)) continue
      mapaAprovado.set(it.contrato_item_id, (mapaAprovado.get(it.contrato_item_id) ?? 0) + it.quantidade_periodo)
    }
    setJaAprovadoPorItem(mapaAprovado)

    const servicoIds = [...new Set((itensContrato ?? []).map(i => i.servico_id))]
    const unidadeIds = [...new Set((itensContrato ?? []).map(i => i.unidade_id))]
    const [{ data: svcs }, { data: unis }] = await Promise.all([
      servicoIds.length > 0
        ? supabase.from('servicos').select('*').in('id', servicoIds)
        : Promise.resolve({ data: [] as Servico[] }),
      unidadeIds.length > 0
        ? supabase.from('unidades').select('*').in('id', unidadeIds)
        : Promise.resolve({ data: [] as Unidade[] }),
    ])
    setServicos(svcs ?? [])
    setUnidades(unis ?? [])

    if (!nova && medicaoId) {
      const atual = (todasMedicoes ?? []).find(m => m.id === medicaoId) ?? null
      setMedicao(atual)
      if (atual) { setDataInicio(atual.data_inicio); setDataFim(atual.data_fim) }
      if (atual?.cancelada_por) {
        const { data: cancelador } = await supabase.from('perfis_usuario').select('nome').eq('id', atual.cancelada_por).single()
        setCanceladorNome(cancelador?.nome ?? atual.cancelada_por)
      } else {
        setCanceladorNome(null)
      }
      const { data: itensAtual } = await supabase.from('medicoes_itens').select('*')
        .eq('medicao_id', medicaoId).eq('ativo', true)
      setItensExistentes(itensAtual ?? [])
      const { data: deducoesAtual } = await supabase.from('medicoes_deducoes').select('*')
        .eq('medicao_id', medicaoId).eq('ativo', true).order('criado_em')
      setDeducoesExistentes(deducoesAtual ?? [])
    }

    setCarregando(false)
  }

  useEffect(() => {
    if (carregando) return
    const porServico = new Map(servicos.map(s => [s.id, s]))
    const nomeUnidade = new Map(unidades.map(u => [u.id, u.nome]))
    const itemExistentePorContratoItem = new Map(itensExistentes.map(i => [i.contrato_item_id, i]))

    setLinhas(contratoItens.map(ci => {
      const s = porServico.get(ci.servico_id)
      const existente = itemExistentePorContratoItem.get(ci.id)
      return {
        contratoItemId: ci.id,
        servicoNome: s?.nome ?? '—',
        servicoCodigo: s?.codigo ?? '',
        und: s?.und ?? '',
        unidadeNome: nomeUnidade.get(ci.unidade_id) ?? '—',
        quantidadeContratada: ci.quantidade,
        valorUnitario: ci.valor_unitario,
        jaAprovado: jaAprovadoPorItem.get(ci.id) ?? 0,
        quantidadePeriodo: existente ? String(existente.quantidade_periodo) : '0',
        medicaoItemId: existente?.id ?? null,
      }
    }))

    setDeducoes(deducoesExistentes.map(ded => ({
      id: ded.id,
      descricao: ded.descricao,
      quantidade: String(ded.quantidade),
      valorUnitario: String(ded.valor_unitario),
      removido: false,
    })))
  }, [carregando, contratoItens, servicos, unidades, itensExistentes, jaAprovadoPorItem, deducoesExistentes])

  function atualizarLinha(contratoItemId: string, valor: string) {
    setLinhas(prev => prev.map(l => l.contratoItemId === contratoItemId ? { ...l, quantidadePeriodo: valor } : l))
  }

  function adicionarDeducao() {
    setDeducoes(prev => [...prev, { id: null, descricao: '', quantidade: '1', valorUnitario: '0', removido: false }])
  }

  function atualizarDeducao(index: number, campo: 'descricao' | 'quantidade' | 'valorUnitario', valor: string) {
    setDeducoes(prev => prev.map((d, i) => i === index ? { ...d, [campo]: valor } : d))
  }

  function removerDeducao(index: number) {
    setDeducoes(prev => {
      const linha = prev[index]
      if (linha.id === null) return prev.filter((_, i) => i !== index)
      return prev.map((d, i) => i === index ? { ...d, removido: true } : d)
    })
  }

  function payloadDeducoes() {
    return deducoes
      .filter(d => d.id !== null || !d.removido)
      .map(d => ({
        id: d.id,
        descricao: d.descricao.trim(),
        quantidade: Number(d.quantidade) || 0,
        valor_unitario: Number(d.valorUnitario) || 0,
        removido: d.removido,
      }))
  }

  // Valida antes de chamar a RPC — sem isso, uma linha de dedução em
  // branco (descrição vazia ou quantidade zero) só falha depois de criar
  // a medição/salvar os itens, com uma mensagem de erro do banco pouco
  // clara ("Deducao invalida.").
  function validarDeducoes(): string | null {
    for (const d of deducoes) {
      if (d.removido) continue
      if (!d.descricao.trim()) return 'Preencha a descrição de todas as deduções (ou remova a linha vazia).'
      if ((Number(d.quantidade) || 0) <= 0) return 'A quantidade de cada dedução deve ser maior que zero.'
    }
    return null
  }

  async function salvarNova() {
    if (!contrato) return
    const erroValidacao = validarDeducoes()
    if (erroValidacao) {
      setMsg({ tipo: 'erro', texto: erroValidacao })
      return
    }
    setSalvando(true)
    setMsg(null)
    const { data: novaMedicaoId, error } = await supabase.rpc('criar_medicao_com_itens', {
      p_contrato: contrato.id,
      p_data_inicio: dataInicio,
      p_data_fim: dataFim,
      p_itens: linhas.map(l => ({
        contrato_item_id: l.contratoItemId,
        quantidade_periodo: Number(l.quantidadePeriodo) || 0,
      })),
    })
    if (error || !novaMedicaoId) {
      setSalvando(false)
      setMsg({ tipo: 'erro', texto: `Erro ao criar medição: ${error?.message}` })
      return
    }
    const payload = payloadDeducoes()
    if (payload.length > 0) {
      const { error: erroDeducoes } = await supabase.rpc('salvar_deducoes_medicao', {
        p_medicao: novaMedicaoId,
        p_deducoes: payload,
      })
      if (erroDeducoes) {
        setSalvando(false)
        setMsg({ tipo: 'erro', texto: `Medição criada, mas houve erro ao salvar as deduções: ${erroDeducoes.message}` })
        navigate(`/contratos/${contrato.id}/medicoes/${novaMedicaoId}`, { replace: true })
        return
      }
    }
    setSalvando(false)
    navigate(`/contratos/${contrato.id}/medicoes/${novaMedicaoId}`, { replace: true })
  }

  async function salvarEdicao() {
    if (!medicao) return
    const erroValidacao = validarDeducoes()
    if (erroValidacao) {
      setMsg({ tipo: 'erro', texto: erroValidacao })
      return
    }
    setSalvando(true)
    setMsg(null)
    const { error } = await supabase.rpc('salvar_itens_medicao', {
      p_medicao: medicao.id,
      p_itens: linhas.map(l => ({
        id: l.medicaoItemId,
        quantidade_periodo: Number(l.quantidadePeriodo) || 0,
      })),
    })
    if (error) {
      setSalvando(false)
      setMsg({ tipo: 'erro', texto: `Não foi possível salvar os itens: ${error.message}` })
      if (contratoId) carregar(contratoId)
      return
    }
    const { error: erroDeducoes } = await supabase.rpc('salvar_deducoes_medicao', {
      p_medicao: medicao.id,
      p_deducoes: payloadDeducoes(),
    })
    if (erroDeducoes) {
      setSalvando(false)
      setMsg({ tipo: 'erro', texto: `Itens salvos, mas houve erro ao salvar as deduções: ${erroDeducoes.message}` })
      if (contratoId) carregar(contratoId)
      return
    }
    setSalvando(false)
    setMsg({ tipo: 'ok', texto: 'Itens e deduções atualizados.' })
    if (contratoId) carregar(contratoId)
  }

  async function aprovar() {
    if (!medicao) return
    if (!await confirmar({
      titulo: 'Aprovar medição',
      mensagem: 'Os itens ficarão travados e não poderão mais ser alterados.',
      confirmarTexto: 'Aprovar medição',
    })) return
    setSalvando(true)
    setMsg(null)
    const { data, error } = await supabase.from('medicoes').update({
      status: 'aprovada', aprovada_por: perfil?.id, aprovada_em: new Date().toISOString(),
    }).eq('id', medicao.id).select()
    setSalvando(false)
    if (error) {
      setMsg({ tipo: 'erro', texto: `Erro ao aprovar: ${error.message}` })
      return
    }
    if (!data || data.length === 0) {
      setMsg({ tipo: 'erro', texto: 'Não foi possível aprovar — a medição pode já ter sido alterada por outra pessoa. Recarregando…' })
      if (contratoId) carregar(contratoId)
      return
    }
    if (contratoId) carregar(contratoId)
  }

  async function cancelar() {
    if (!medicao) return
    const motivo = await solicitarTexto({
      titulo: 'Cancelar medição',
      mensagem: 'A medição será preservada no histórico com o selo "Cancelada". O saldo do contrato volta a ficar disponível e os lançamentos gerados no Financeiro serão removidos.',
      confirmarTexto: 'Cancelar medição',
      perigoso: true,
      campo: { rotulo: 'Motivo do cancelamento', placeholder: 'Descreva o motivo...' },
    })
    if (!motivo) return
    setSalvando(true)
    setMsg(null)
    const { error } = await supabase.rpc('medicoes_cancelar_medicao', {
      p_medicao_id: medicao.id,
      p_motivo: motivo,
    })
    setSalvando(false)
    if (error) {
      setMsg({ tipo: 'erro', texto: `Erro ao cancelar: ${error.message}` })
      return
    }
    if (contratoId) carregar(contratoId)
  }

  async function imprimir() {
    if (!contrato || !medicao) return
    const [{ data: obraRow }, { data: responsavelRow }, { data: deducoesAtual }] = await Promise.all([
      supabase.from('obras')
        .select('nome, logo_url, rodape_pdf, nome_empreendimento, razao_social, endereco, cidade, estado, cnpj, cno_obra, endereco_escritorio, cep, email, engenheiro_obra_nome, engenheiro_obra_crea')
        .eq('id', contrato.obra_id).maybeSingle(),
      supabase.from('perfis_usuario').select('nome, email, telefone').eq('id', medicao.criado_por).maybeSingle(),
      supabase.from('medicoes_deducoes').select('*').eq('medicao_id', medicao.id).eq('ativo', true).order('criado_em'),
    ])
    const identidade = await carregarIdentidadeObra(obraRow)
    const deducoesPdf: DeducaoPdfMedicao[] = (deducoesAtual ?? []).map(ded => ({
      descricao: ded.descricao,
      quantidade: ded.quantidade,
      valorUnitario: ded.valor_unitario,
      valorTotal: ded.valor_total,
    }))
    gerarPdfMedicao({
      contrato,
      medicao,
      identidade,
      empreiteiroNome,
      obraNome: obraRow?.nome ?? '—',
      nomeEmpreendimento: obraRow?.nome_empreendimento ?? null,
      razaoSocialObra: obraRow?.razao_social ?? null,
      enderecoObra: obraRow?.endereco ?? null,
      cidadeObra: obraRow?.cidade ?? null,
      estadoObra: obraRow?.estado ?? null,
      cnpjObra: obraRow?.cnpj ?? null,
      cnoObra: obraRow?.cno_obra ?? null,
      enderecoEscritorioObra: obraRow?.endereco_escritorio ?? null,
      cepObra: obraRow?.cep ?? null,
      emailObra: obraRow?.email ?? null,
      engenheiroObraNome: obraRow?.engenheiro_obra_nome ?? null,
      engenheiroObraCrea: obraRow?.engenheiro_obra_crea ?? null,
      responsavelNome: responsavelRow?.nome ?? '—',
      responsavelEmail: responsavelRow?.email ?? '—',
      responsavelTelefone: responsavelRow?.telefone ?? null,
      totalBrutoContrato,
      totalRetidoContrato,
      totalLiquidoContrato,
      itens: linhas.map(l => ({
        servicoCodigo: l.servicoCodigo,
        servicoNome: l.servicoNome,
        und: l.und,
        unidadeNome: l.unidadeNome,
        quantidadeContratada: l.quantidadeContratada,
        jaAprovado: l.jaAprovado,
        quantidadePeriodo: Number(l.quantidadePeriodo) || 0,
        valorUnitario: l.valorUnitario,
      })),
      deducoes: deducoesPdf,
    })
  }

  if (perfil?.papel === 'cliente') {
    return <div className={styles.page}><p className={styles.vazio}>Módulo de uso interno da equipe.</p></div>
  }
  if (carregando) return <div className={styles.page}><p className={styles.vazio}>Carregando…</p></div>
  if (!contrato) return <div className={styles.page}><p className={styles.vazio}>Contrato não encontrado.</p></div>
  if (nova && !podeEditar) {
    return <div className={styles.page}><p className={styles.vazio}>Você não tem permissão para criar medições.</p></div>
  }
  if (nova && contrato.status !== 'ativo') {
    return <div className={styles.page}><p className={styles.vazio}>Só é possível medir um contrato ativo.</p></div>
  }
  if (!nova && !medicao) {
    return <div className={styles.page}><p className={styles.vazio}>Medição não encontrada.</p></div>
  }

  const brutoCalc = linhas.reduce((acc, l) => acc + (Number(l.quantidadePeriodo) || 0) * l.valorUnitario, 0)
  const retencaoPct = contrato.retencao_pct ?? 0
  const retidoCalc = Math.round(brutoCalc * retencaoPct) / 100
  const totalDeducoesCalc = deducoes.filter(d => !d.removido).reduce((acc, d) => acc + (Number(d.quantidade) || 0) * (Number(d.valorUnitario) || 0), 0)
  const liquidoCalc = brutoCalc - retidoCalc - totalDeducoesCalc

  // Medição aprovada é registro permanente: o resumo mostra sempre o
  // valor persistido (valor_bruto/retido/liquido), mantido pelo
  // trigger recalcular_valor_medicao — nunca o recomputo em memória,
  // que soma floats do JS ("arredonda a soma") enquanto o banco soma
  // valor_total_item já arredondado por item ("soma de arredondados"),
  // podendo divergir por centavos em medições com vários itens. Em
  // rascunho (ou numa medição nova) o recomputo ao vivo continua
  // necessário pra refletir edição de quantidade ainda não salva.
  const fechada = !nova && (medicao?.status === 'aprovada' || medicao?.status === 'cancelada')
  const bruto = fechada ? medicao!.valor_bruto : brutoCalc
  const retido = fechada ? medicao!.valor_retido : retidoCalc
  const liquido = fechada ? medicao!.valor_liquido : liquidoCalc
  const podeEditarItens = podeEditar && (nova || medicao?.status === 'rascunho')

  // Acompanhamento do contrato inteiro (mesmo cálculo do painel em ContratoForm.tsx),
  // repetido aqui pra não obrigar ir e voltar até a tela do contrato pra ver o acumulado.
  const medicoesAprovadas = medicoesContrato.filter(m => m.status === 'aprovada')
  const totalBrutoContrato = medicoesAprovadas.reduce((s, m) => s + m.valor_bruto, 0)
  const totalRetidoContrato = medicoesAprovadas.reduce((s, m) => s + m.valor_retido, 0)
  const totalLiquidoContrato = medicoesAprovadas.reduce((s, m) => s + m.valor_liquido, 0)
  const saldoContrato = contrato.valor_total - totalBrutoContrato
  const pctExecutadoContrato = contrato.valor_total > 0 ? (totalBrutoContrato / contrato.valor_total) * 100 : 0

  return (
    <div className={styles.page}>
      <button className={styles.voltar} onClick={() => navigate(`/contratos/${contrato.id}`)}>← {contrato.numero}</button>
      <div className={styles.header}>
        <h1>{nova ? 'Nova medição' : `${contrato.numero} — ${medicao!.numero}ª medição`}</h1>
        {medicao && (
          <span className={`${styles.chip} ${styles[`chip_${medicao.status}`]}`}>{STATUS_MEDICAO_LABEL[medicao.status]}</span>
        )}
      </div>

      <div className={styles.bloco}>
        <div className={styles.linha2}>
          <label className={styles.campo}>
            Data início *
            <input type="date" value={dataInicio} onChange={e => setDataInicio(e.target.value)}
              disabled={!nova} />
          </label>
          <label className={styles.campo}>
            Data fim *
            <input type="date" value={dataFim} onChange={e => setDataFim(e.target.value)}
              disabled={!nova} />
          </label>
        </div>
      </div>

      <div className={styles.bloco}>
        <h2>Itens</h2>
        <div className={styles.tabelaWrap}>
        <table className={styles.tabela}>
          <thead>
            <tr>
              <th>Serviço</th><th>Unidade</th><th>Qtd. contratada</th><th>Já aprovado</th>
              <th>Saldo antes</th><th>Qtd. neste período</th><th>Valor unit.</th><th>Valor do período</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map(l => {
              const saldoAntes = l.quantidadeContratada - l.jaAprovado
              const valorPeriodo = (Number(l.quantidadePeriodo) || 0) * l.valorUnitario
              return (
                <tr key={l.contratoItemId}>
                  <td data-label="Serviço">{l.servicoCodigo ? `${l.servicoCodigo} — ` : ''}{l.servicoNome}</td>
                  <td data-label="Unidade">{l.unidadeNome}</td>
                  <td data-label="Qtd. contratada">{l.quantidadeContratada}</td>
                  <td data-label="Já aprovado">{l.jaAprovado}</td>
                  <td data-label="Saldo antes">{saldoAntes}</td>
                  <td data-label="Qtd. neste período">
                    {podeEditarItens
                      ? <input type="number" min="0" step="0.0001" value={l.quantidadePeriodo}
                          onChange={e => atualizarLinha(l.contratoItemId, e.target.value)} className={styles.inputQtd} />
                      : l.quantidadePeriodo}
                  </td>
                  <td data-label="Valor unitário">R$ {formatarMoeda(l.valorUnitario)}</td>
                  <td data-label="Valor do período">R$ {formatarMoeda(valorPeriodo)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        </div>
      </div>

      {(deducoes.length > 0 || podeEditarItens) && (
        <div className={styles.bloco}>
          <h2>Deduções</h2>
          {deducoes.filter(d => !d.removido).length === 0 && !podeEditarItens && (
            <p className={styles.vazio}>Nenhuma dedução nesta medição.</p>
          )}
          {deducoes.filter(d => !d.removido).length > 0 && (
            <div className={styles.tabelaWrap}>
              <table className={styles.tabela}>
                <thead>
                  <tr>
                    <th>Descrição</th><th>Quantidade</th><th>Valor unit.</th><th>Valor total</th>
                    {podeEditarItens && <th></th>}
                  </tr>
                </thead>
                <tbody>
                  {deducoes.map((d, index) => {
                    if (d.removido) return null
                    const valorTotal = (Number(d.quantidade) || 0) * (Number(d.valorUnitario) || 0)
                    return (
                      <tr key={d.id ?? `nova-${index}`}>
                        <td data-label="Descrição">
                          {podeEditarItens
                            ? <input type="text" value={d.descricao}
                                onChange={e => atualizarDeducao(index, 'descricao', e.target.value)} />
                            : d.descricao}
                        </td>
                        <td data-label="Quantidade">
                          {podeEditarItens
                            ? <input type="number" min="0" step="0.0001" value={d.quantidade} className={styles.inputQtd}
                                onChange={e => atualizarDeducao(index, 'quantidade', e.target.value)} />
                            : d.quantidade}
                        </td>
                        <td data-label="Valor unitário">
                          {podeEditarItens
                            ? <input type="number" min="0" step="0.01" value={d.valorUnitario} className={styles.inputQtd}
                                onChange={e => atualizarDeducao(index, 'valorUnitario', e.target.value)} />
                            : `R$ ${formatarMoeda(Number(d.valorUnitario) || 0)}`}
                        </td>
                        <td data-label="Valor total">R$ {formatarMoeda(valorTotal)}</td>
                        {podeEditarItens && (
                          <td><button type="button" className={styles.btnSecundario} onClick={() => removerDeducao(index)}>Remover</button></td>
                        )}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          {podeEditarItens && (
            <button type="button" className={styles.btnSecundario} onClick={adicionarDeducao} style={{ marginTop: 10 }}>
              + Adicionar dedução
            </button>
          )}
        </div>
      )}

      <div className={styles.bloco}>
        <div className={styles.resumoLinha}><span>Valor bruto</span><strong>R$ {formatarMoeda(bruto)}</strong></div>
        <div className={styles.resumoLinha}><span>Retenção ({retencaoPct}%)</span><strong>− R$ {formatarMoeda(retido)}</strong></div>
        <div className={styles.resumoLinha}><span>Valor líquido</span><strong>R$ {formatarMoeda(liquido)}</strong></div>
      </div>

      {medicoesContrato.length > 0 && (
        <div className={styles.bloco}>
          <h2>Acompanhamento do contrato</h2>
          <div className={styles.resumoLinha}><span>Total medido (bruto)</span><strong>R$ {formatarMoeda(totalBrutoContrato)}</strong></div>
          <div className={styles.resumoLinha}><span>Retenção acumulada</span><strong>− R$ {formatarMoeda(totalRetidoContrato)}</strong></div>
          <div className={styles.resumoLinha}><span>Total líquido (pago/a pagar)</span><strong>R$ {formatarMoeda(totalLiquidoContrato)}</strong></div>
          <div className={styles.resumoLinha}><span>Saldo do contrato</span><strong>R$ {formatarMoeda(saldoContrato)}</strong></div>
          <div className={styles.resumoLinha}><span>% executado</span><strong>{pctExecutadoContrato.toFixed(1)}%</strong></div>
        </div>
      )}

      {medicao?.status === 'cancelada' && (
        <div className={styles.blocoCancelada}>
          <div><strong>Motivo do cancelamento:</strong> {medicao.motivo_cancelamento}</div>
          <div><strong>Cancelada por:</strong> {canceladorNome ?? '—'}</div>
          <div><strong>Cancelada em:</strong> {medicao.cancelada_em ? new Date(medicao.cancelada_em).toLocaleString('pt-BR') : '—'}</div>
        </div>
      )}

      {msg && <p className={msg.tipo === 'ok' ? styles.msgOk : styles.msgErro}>{msg.texto}</p>}

      <div className={styles.acoes}>
        {nova && podeEditarItens && (
          <button className={styles.btnPrincipal} onClick={salvarNova} disabled={salvando}>
            {salvando ? 'Salvando…' : 'Criar medição'}
          </button>
        )}
        {!nova && podeEditarItens && (
          <button className={styles.btnPrincipal} onClick={salvarEdicao} disabled={salvando}>
            {salvando ? 'Salvando…' : 'Salvar itens'}
          </button>
        )}
        {!nova && ehAdmin && medicao?.status === 'rascunho' && (
          <button className={styles.btnPrincipal} onClick={aprovar} disabled={salvando}>
            {salvando ? 'Aprovando…' : 'Aprovar medição'}
          </button>
        )}
        {!nova && ehAdmin && medicao?.status === 'aprovada' && (
          <button className={styles.btnPerigo} onClick={cancelar} disabled={salvando}>
            {salvando ? 'Cancelando...' : 'Cancelar medição'}
          </button>
        )}
        {!nova && (
          <button className={styles.btnSecundario} onClick={imprimir}>🖨️ Imprimir PDF</button>
        )}
      </div>
    </div>
  )
}
