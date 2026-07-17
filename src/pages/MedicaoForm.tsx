import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import {
  supabase, type Contrato, type ContratoItem, type Servico, type Unidade,
  type Medicao, type MedicaoItem, type StatusMedicao,
} from '../lib/supabase'
import { gerarPdfMedicao } from '../lib/medicoesPdf'
import { formatarMoeda } from '../lib/formato'
import { useConfirmDialog } from '../components/ConfirmDialogContext'
import styles from './MedicaoForm.module.css'

export const STATUS_MEDICAO_LABEL: Record<StatusMedicao, string> = {
  rascunho: 'Rascunho',
  aprovada: 'Aprovada',
}

interface ItemLinha {
  contratoItemId: string
  servicoNome: string
  servicoCodigo: string
  unidadeNome: string
  quantidadeContratada: number
  valorUnitario: number
  jaAprovado: number
  quantidadePeriodo: string
  medicaoItemId: string | null
}

export default function MedicaoForm() {
  const { confirmar } = useConfirmDialog()
  const { contratoId, medicaoId } = useParams()
  const nova = medicaoId === 'nova'
  const navigate = useNavigate()
  const { perfil, temModulo } = useAuth()
  const podeEditar = perfil?.papel === 'admin' || temModulo('medicoes')
  const ehAdmin = perfil?.papel === 'admin'

  const [carregando, setCarregando] = useState(true)
  const [contrato, setContrato] = useState<Contrato | null>(null)
  const [empreiteiroNome, setEmpreiteiroNome] = useState('—')
  const [contratoItens, setContratoItens] = useState<ContratoItem[]>([])
  const [servicos, setServicos] = useState<Servico[]>([])
  const [unidades, setUnidades] = useState<Unidade[]>([])
  const [medicao, setMedicao] = useState<Medicao | null>(null)
  const [itensExistentes, setItensExistentes] = useState<MedicaoItem[]>([])
  const [jaAprovadoPorItem, setJaAprovadoPorItem] = useState<Map<string, number>>(new Map())

  const [dataReferencia, setDataReferencia] = useState(() => new Date().toISOString().slice(0, 10))
  const [linhas, setLinhas] = useState<ItemLinha[]>([])
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
      if (atual) setDataReferencia(atual.data_referencia)
      const { data: itensAtual } = await supabase.from('medicoes_itens').select('*')
        .eq('medicao_id', medicaoId).eq('ativo', true)
      setItensExistentes(itensAtual ?? [])
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
        unidadeNome: nomeUnidade.get(ci.unidade_id) ?? '—',
        quantidadeContratada: ci.quantidade,
        valorUnitario: ci.valor_unitario,
        jaAprovado: jaAprovadoPorItem.get(ci.id) ?? 0,
        quantidadePeriodo: existente ? String(existente.quantidade_periodo) : '0',
        medicaoItemId: existente?.id ?? null,
      }
    }))
  }, [carregando, contratoItens, servicos, unidades, itensExistentes, jaAprovadoPorItem])

  function atualizarLinha(contratoItemId: string, valor: string) {
    setLinhas(prev => prev.map(l => l.contratoItemId === contratoItemId ? { ...l, quantidadePeriodo: valor } : l))
  }

  async function salvarNova() {
    if (!contrato) return
    setSalvando(true)
    setMsg(null)
    const { data: novaMedicaoId, error } = await supabase.rpc('criar_medicao_com_itens', {
      p_contrato: contrato.id,
      p_data_referencia: dataReferencia,
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
    setSalvando(false)
    navigate(`/contratos/${contrato.id}/medicoes/${novaMedicaoId}`, { replace: true })
  }

  async function salvarEdicao() {
    if (!medicao) return
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
    setSalvando(false)
    setMsg({ tipo: 'ok', texto: 'Itens atualizados.' })
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

  function imprimir() {
    if (!contrato || !medicao) return
    gerarPdfMedicao({
      contrato,
      medicao,
      empreiteiroNome,
      itens: linhas.map(l => ({
        servicoCodigo: l.servicoCodigo,
        servicoNome: l.servicoNome,
        unidadeNome: l.unidadeNome,
        quantidadeContratada: l.quantidadeContratada,
        jaAprovado: l.jaAprovado,
        quantidadePeriodo: Number(l.quantidadePeriodo) || 0,
        valorUnitario: l.valorUnitario,
      })),
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
  const liquidoCalc = brutoCalc - retidoCalc

  // Medição aprovada é registro permanente: o resumo mostra sempre o
  // valor persistido (valor_bruto/retido/liquido), mantido pelo
  // trigger recalcular_valor_medicao — nunca o recomputo em memória,
  // que soma floats do JS ("arredonda a soma") enquanto o banco soma
  // valor_total_item já arredondado por item ("soma de arredondados"),
  // podendo divergir por centavos em medições com vários itens. Em
  // rascunho (ou numa medição nova) o recomputo ao vivo continua
  // necessário pra refletir edição de quantidade ainda não salva.
  const aprovada = !nova && medicao?.status === 'aprovada'
  const bruto = aprovada ? medicao!.valor_bruto : brutoCalc
  const retido = aprovada ? medicao!.valor_retido : retidoCalc
  const liquido = aprovada ? medicao!.valor_liquido : liquidoCalc
  const podeEditarItens = podeEditar && (nova || medicao?.status === 'rascunho')

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
        <label className={styles.campo}>
          Data de referência *
          <input type="date" value={dataReferencia} onChange={e => setDataReferencia(e.target.value)}
            disabled={!nova} />
        </label>
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

      <div className={styles.bloco}>
        <div className={styles.resumoLinha}><span>Valor bruto</span><strong>R$ {formatarMoeda(bruto)}</strong></div>
        <div className={styles.resumoLinha}><span>Retenção ({retencaoPct}%)</span><strong>− R$ {formatarMoeda(retido)}</strong></div>
        <div className={styles.resumoLinha}><span>Valor líquido</span><strong>R$ {formatarMoeda(liquido)}</strong></div>
      </div>

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
        {!nova && (
          <button className={styles.btnSecundario} onClick={imprimir}>🖨️ Imprimir PDF</button>
        )}
      </div>
    </div>
  )
}
