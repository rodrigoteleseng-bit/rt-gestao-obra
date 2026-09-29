import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useObra } from '../contexts/ObraContext'
import { supabase, type Servico } from '../lib/supabase'
import { calcularSolucao, parametrosPadrao, solucoesPadrao, type ParametrosEstudo, type SolucaoEstudo } from '../lib/estudosViabilidade'
import { useConfirmDialog } from '../components/ConfirmDialogContext'
import { gerarPdfEstudoViabilidade } from '../lib/estudosViabilidadePdf'
import styles from './EstudosViabilidade.module.css'
import dashboardStyles from './EstudosViabilidadeDashboard.module.css'
import approvalStyles from './EstudosViabilidadeAprovacao.module.css'

type Status = 'rascunho' | 'aguardando_aprovacao' | 'aprovado'
type Estudo = {
  id: string; obra_id: string; servico_id: string | null; titulo: string; area_m2: number; observacao_tecnica: string | null; fonte_custos: string | null; data_referencia_custos: string | null
  parametros: ParametrosEstudo; solucoes: SolucaoEstudo[]; resultados: { solucoes?: ReturnType<typeof calcularSolucao>[] }; status: Status; decisao: string | null
  motivo_devolucao: string | null; solucao_escolhida_id: string | null; solucao_escolhida_nome: string | null; aprovado_em: string | null; aprovado_por_nome: string | null; criado_em: string
}
type Rascunho = { titulo: string; area: number; servicoId: string; observacao: string; fonteCustos: string; dataReferencia: string; parametros: ParametrosEstudo; solucoes: SolucaoEstudo[] }
type EscolhaAprovacao = { id: string; nome: string }

const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const numero = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 })
const vazio = (): Rascunho => ({ titulo: 'Estudo de alvenaria', area: 100, servicoId: '', observacao: '', fonteCustos: '', dataReferencia: '', parametros: { ...parametrosPadrao }, solucoes: solucoesPadrao.map(s => ({ ...s, id: crypto.randomUUID() })) })

function statusTexto(status: Status) {
  return status === 'rascunho' ? 'Rascunho' : status === 'aguardando_aprovacao' ? 'Aguardando aprovação' : 'Aprovado'
}

export default function EstudosViabilidade() {
  const { obraAtiva } = useObra()
  const { perfil, temModulo } = useAuth()
  const { solicitarTexto } = useConfirmDialog()
  const [estudos, setEstudos] = useState<Estudo[]>([])
  const [servicos, setServicos] = useState<Servico[]>([])
  const [selecionado, setSelecionado] = useState<Estudo | null>(null)
  const [rascunho, setRascunho] = useState(vazio)
  const [carregando, setCarregando] = useState(true)
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState('')
  const [visao, setVisao] = useState<'editor' | 'dashboard'>('editor')
  const [confirmandoAprovacao, setConfirmandoAprovacao] = useState(false)
  const [solucaoEscolhidaId, setSolucaoEscolhidaId] = useState('')
  const [justificativaEscolha, setJustificativaEscolha] = useState('')
  const admin = perfil?.papel === 'admin'
  const acessoModulo = admin || temModulo('estudos_viabilidade')

  useEffect(() => { if (obraAtiva) void carregar(obraAtiva.id) }, [obraAtiva])

  async function carregar(obraId: string) {
    setCarregando(true); setErro('')
    const { data: unis, error: erroUnis } = await supabase.from('unidades').select('id').eq('obra_id', obraId)
    if (erroUnis) { setErro(erroUnis.message); setCarregando(false); return }
    const unidadeIds = (unis ?? []).map(u => u.id)
    const { data: etapas, error: erroEtapas } = unidadeIds.length ? await supabase.from('etapas').select('id').in('unidade_id', unidadeIds).eq('placeholder', false) : { data: [], error: null }
    if (erroEtapas) { setErro(erroEtapas.message); setCarregando(false); return }
    const etapaIds = (etapas ?? []).map(e => e.id)
    const [lista, listaServicos] = await Promise.all([
      supabase.from('estudos_viabilidade').select('*').eq('obra_id', obraId).eq('ativo', true).order('criado_em', { ascending: false }),
      etapaIds.length ? supabase.from('servicos').select('id,etapa_id,codigo,nome,grupo,und,quant,valor_unit,total,ativo').in('etapa_id', etapaIds).eq('ativo', true).order('nome') : Promise.resolve({ data: [], error: null }),
    ])
    if (lista.error || listaServicos.error) setErro(lista.error?.message ?? listaServicos.error?.message ?? 'Não foi possível carregar os estudos.')
    else { setEstudos((lista.data ?? []) as Estudo[]); setServicos((listaServicos.data ?? []) as Servico[]) }
    setCarregando(false)
  }

  function novo() { setSelecionado(null); setRascunho(vazio()); setVisao('editor'); setErro(''); setConfirmandoAprovacao(false); setSolucaoEscolhidaId(''); setJustificativaEscolha('') }
  function abrir(estudo: Estudo) {
    setSelecionado(estudo)
    setRascunho({ titulo: estudo.titulo, area: Number(estudo.area_m2), servicoId: estudo.servico_id ?? '', observacao: estudo.observacao_tecnica ?? '', fonteCustos: estudo.fonte_custos ?? '', dataReferencia: estudo.data_referencia_custos ?? '', parametros: { ...parametrosPadrao, ...estudo.parametros }, solucoes: estudo.solucoes })
    setVisao('editor'); setErro(''); setConfirmandoAprovacao(false); setSolucaoEscolhidaId(''); setJustificativaEscolha('')
  }
  function alterarParametro(campo: keyof ParametrosEstudo, valor: number | 'local' | 'usina') { setRascunho(atual => ({ ...atual, parametros: { ...atual.parametros, [campo]: valor } })) }
  function alterarSolucao(id: string, campo: keyof SolucaoEstudo, valor: string | number) { setRascunho(atual => ({ ...atual, solucoes: atual.solucoes.map(s => s.id === id ? { ...s, [campo]: valor } : s) })) }
  function adicionarSolucao() { setRascunho(atual => ({ ...atual, solucoes: [...atual.solucoes, { id: crypto.randomUUID(), nome: 'Nova solução', bloco: '9', panos: 1, paulistaCm: 1.5, maoAssentamento: 0, maoChapisco: 0, maoPaulista: 0, observacao: '' }] })) }
  function removerSolucao(id: string) { setRascunho(atual => ({ ...atual, solucoes: atual.solucoes.length > 1 ? atual.solucoes.filter(s => s.id !== id) : atual.solucoes })) }

  const resultados = useMemo(() => selecionado?.status !== 'rascunho' && selecionado && Array.isArray(selecionado.resultados?.solucoes) ? selecionado.resultados.solucoes : rascunho.solucoes.map(s => calcularSolucao(s, rascunho.parametros, rascunho.area)), [rascunho, selecionado])
  const resultadosValidos = resultados.filter(r => r.totalM2 !== null)
  const menor = resultadosValidos.length ? Math.min(...resultadosValidos.map(r => r.totalM2 ?? Infinity)) : null
  const podeEditar = acessoModulo && (selecionado === null || selecionado.status === 'rascunho')

  async function salvar(status: Status = 'rascunho', decisao?: string, motivoDevolucao?: string, escolha?: EscolhaAprovacao) {
    if (!obraAtiva || !rascunho.titulo.trim() || rascunho.area <= 0) { setErro('Informe título e área maior que zero.'); return }
    setSalvando(true); setErro('')
    const payload = {
      obra_id: obraAtiva.id, servico_id: rascunho.servicoId || null, titulo: rascunho.titulo.trim(), area_m2: rascunho.area,
      observacao_tecnica: rascunho.observacao || null, fonte_custos: rascunho.fonteCustos || null, data_referencia_custos: rascunho.dataReferencia || null, parametros: rascunho.parametros, solucoes: rascunho.solucoes,
      status,
      ...(decisao !== undefined ? { decisao: decisao || null } : {}), ...(motivoDevolucao !== undefined ? { motivo_devolucao: motivoDevolucao || null } : {}),
      ...(escolha !== undefined ? { solucao_escolhida_id: escolha?.id ?? null, solucao_escolhida_nome: escolha?.nome ?? null } : {}),
    }
    const resposta = selecionado ? await supabase.from('estudos_viabilidade').update(payload).eq('id', selecionado.id).select().single() : await supabase.from('estudos_viabilidade').insert(payload).select().single()
    if (resposta.error) setErro(resposta.error.message)
    else { const salvo = resposta.data as Estudo; setSelecionado(salvo); await carregar(obraAtiva.id); abrir(salvo) }
    setSalvando(false)
  }
  async function enviarAprovacao() { await salvar('aguardando_aprovacao') }
  function abrirAprovacao() {
    const economica = resultadosValidos.find(r => r.totalM2 === menor)
    setSolucaoEscolhidaId(economica?.id ?? '')
    setJustificativaEscolha('')
    setConfirmandoAprovacao(true)
    setErro('')
  }
  async function aprovar() {
    const escolha = resultadosValidos.find(r => r.id === solucaoEscolhidaId)
    if (!escolha || !justificativaEscolha.trim()) { setErro('Escolha uma solução com custos completos e registre a justificativa técnica.'); return }
    await salvar('aprovado', justificativaEscolha.trim(), undefined, { id: escolha.id, nome: escolha.nome })
    setConfirmandoAprovacao(false)
  }
  async function devolver() { const motivo = await solicitarTexto({ titulo: 'Devolver para correção', mensagem: 'O estudo voltará a rascunho.', confirmarTexto: 'Devolver', campo: { rotulo: 'Motivo da devolução' } }); if (motivo) await salvar('rascunho', undefined, motivo) }

  if (carregando) return <div className={styles.page}><p>Carregando estudos de viabilidade…</p></div>
  if (!acessoModulo) return <div className={styles.page}><div className={styles.error}>Você não tem permissão para acessar Estudos de viabilidade.</div></div>
  return <div className={styles.page}>
    <header className={styles.header}><div><p className={styles.eyebrow}>ORÇAMENTO · ESTUDO SEM IMPACTO FINANCEIRO</p><h1>Estudos de viabilidade</h1><p>Compare alternativas técnicas e registre a decisão aprovada. Nenhum valor é enviado ao orçamento, compras ou financeiro.</p></div><button className={styles.primary} onClick={novo}>+ Novo estudo</button></header>
    {erro ? <div className={styles.error}>{erro}</div> : null}
    {selecionado?.status === 'aprovado' ? <p><button className={styles.secondary} onClick={() => void gerarPdfEstudoViabilidade({ obra: obraAtiva, titulo: rascunho.titulo, area: rascunho.area, fonte: rascunho.fonteCustos, data: rascunho.dataReferencia, decisao: selecionado.decisao, solucaoEscolhidaNome: selecionado.solucao_escolhida_nome, aprovadoEm: selecionado.aprovado_em, aprovadoPorNome: selecionado.aprovado_por_nome, resultados })}>Baixar PDF do estudo aprovado</button></p> : null}
    <div className={styles.layout}>
      <aside className={styles.lista}><h2>Estudos da obra</h2>{estudos.length === 0 ? <p className={styles.vazio}>Ainda não há estudos cadastrados.</p> : estudos.map(e => <button key={e.id} className={`${styles.estudoItem} ${selecionado?.id === e.id ? styles.selecionado : ''}`} onClick={() => abrir(e)}><strong>{e.titulo}</strong><span>{statusTexto(e.status)}</span><small>{numero.format(Number(e.area_m2))} m²</small></button>)}</aside>
      <section className={styles.conteudo}>
        <div className={styles.toolbar}><div><span className={`${styles.status} ${styles[selecionado?.status ?? 'rascunho']}`}>{statusTexto(selecionado?.status ?? 'rascunho')}</span>{selecionado?.motivo_devolucao ? <p className={styles.devolucao}>Devolvido: {selecionado.motivo_devolucao}</p> : null}</div><div className={styles.actions}><button className={styles.secondary} onClick={() => setVisao(visao === 'editor' ? 'dashboard' : 'editor')}>{visao === 'editor' ? 'Ver dashboard' : 'Editar estudo'}</button>{podeEditar ? <button className={styles.secondary} disabled={salvando} onClick={() => void salvar()}>Salvar rascunho</button> : null}{selecionado?.status === 'rascunho' ? <button className={styles.primary} disabled={salvando} onClick={() => void enviarAprovacao()}>Enviar para aprovação</button> : null}{admin && selecionado?.status === 'aguardando_aprovacao' ? <><button className={styles.secondary} disabled={salvando} onClick={() => void devolver()}>Devolver para correção</button><button className={styles.primary} disabled={salvando} onClick={abrirAprovacao}>Escolher e aprovar</button></> : null}</div></div>
        {confirmandoAprovacao ? <AprovacaoEscolha resultados={resultadosValidos} menor={menor} solucaoEscolhidaId={solucaoEscolhidaId} justificativa={justificativaEscolha} aoEscolher={setSolucaoEscolhidaId} aoJustificar={setJustificativaEscolha} aoCancelar={() => setConfirmandoAprovacao(false)} aoConfirmar={() => void aprovar()} salvando={salvando} /> : null}
        {selecionado?.status === 'aprovado' ? <section className={approvalStyles.decisionRegistered}><p>DECISÃO APROVADA</p><strong>{selecionado.solucao_escolhida_nome ?? 'Solução não registrada'}</strong><span>{selecionado.decisao ?? 'Sem justificativa registrada.'}</span><small>{selecionado.aprovado_por_nome ? `Aprovado por ${selecionado.aprovado_por_nome}` : 'Aprovador não registrado'}{selecionado.aprovado_em ? ` · ${new Date(selecionado.aprovado_em).toLocaleString('pt-BR')}` : ''}</small></section> : null}
        {visao === 'dashboard' ? <Dashboard resultados={resultados} area={rascunho.area} menor={menor} modalidade={rascunho.parametros.modalidade} /> : <>
          <section className={styles.card}><div className={styles.gridTopo}><label>Título do estudo<input disabled={!podeEditar} value={rascunho.titulo} onChange={e => setRascunho(a => ({ ...a, titulo: e.target.value }))} /></label><label>Serviço vinculado<select disabled={!podeEditar} value={rascunho.servicoId} onChange={e => setRascunho(a => ({ ...a, servicoId: e.target.value }))}><option value="">Sem vínculo específico</option>{servicos.map(s => <option key={s.id} value={s.id}>{s.codigo ? `${s.codigo} · ` : ''}{s.nome}</option>)}</select></label><label>Área do estudo (m²)<input disabled={!podeEditar} type="number" min="0" value={rascunho.area} onChange={e => setRascunho(a => ({ ...a, area: Number(e.target.value) }))} /></label></div><label>Observação técnica<input disabled={!podeEditar} value={rascunho.observacao} placeholder="Ex.: validar desempenho acústico e detalhamento de amarração" onChange={e => setRascunho(a => ({ ...a, observacao: e.target.value }))} /></label></section>
          <section className={styles.card}><div className={styles.gridTopo}><label>Fonte dos custos<input disabled={!podeEditar} value={rascunho.fonteCustos} placeholder="Ex.: Cotação Fornecedor X nº 123" onChange={e => setRascunho(a => ({ ...a, fonteCustos: e.target.value }))} /></label><label>Data de referência<input disabled={!podeEditar} type="date" value={rascunho.dataReferencia} onChange={e => setRascunho(a => ({ ...a, dataReferencia: e.target.value }))} /></label></div><p className={styles.help}>Fonte e data são obrigatórias para enviar o estudo à aprovação.</p></section>
          <Parametros parametros={rascunho.parametros} editar={podeEditar} alterar={alterarParametro} />
          <section className={styles.card}><div className={styles.sectionHead}><div><p className={styles.eyebrow}>ALTERNATIVAS</p><h2>Soluções comparadas</h2></div>{podeEditar ? <button className={styles.secondary} onClick={adicionarSolucao}>+ Adicionar solução</button> : null}</div>{rascunho.solucoes.map((s, i) => <SolucaoCard key={s.id} solucao={s} numero={i + 1} editar={podeEditar} alterar={alterarSolucao} remover={removerSolucao} resultado={resultados[i]} />)}</section>
          <Resumo resultados={resultados} area={rascunho.area} menor={menor} />
        </>}
      </section>
    </div>
  </div>
}

function Parametros({ parametros, editar, alterar }: { parametros: ParametrosEstudo; editar: boolean; alterar: (campo: keyof ParametrosEstudo, valor: number | 'local' | 'usina') => void }) {
  const campo = (chave: keyof ParametrosEstudo, texto: string) => <label key={chave}>{texto}<input disabled={!editar} type="number" min="0" step="0.01" value={parametros[chave] as number} onChange={e => alterar(chave, Number(e.target.value))} /></label>
  return <section className={styles.card}><div className={styles.sectionHead}><div><p className={styles.eyebrow}>BASE DE CUSTOS</p><h2>Argamassas e insumos</h2></div><label className={styles.modalidade}>Modalidade no comparativo<select disabled={!editar} value={parametros.modalidade} onChange={e => alterar('modalidade', e.target.value as 'local' | 'usina')}><option value="local">Feita na obra</option><option value="usina">Usinada entregue</option></select></label></div><details open><summary>Preços e coeficientes</summary><div className={styles.fields}>{campo('bloco9', 'Bloco 9 cm (R$/milheiro)')}{campo('bloco115', 'Bloco 11,5 cm (R$/milheiro)')}{campo('bloco19', 'Bloco 19 cm (R$/milheiro)')}{campo('areia', 'Areia (R$/m³)')}{campo('cimentoSaco', 'Cimento (R$/saco 50 kg)')}{campo('juntaCm', 'Junta (cm)')}{campo('perdaBloco', 'Perda de blocos (%)')}{campo('perdaArgamassa', 'Perda de argamassa (%)')}{campo('cimentoAssentamento', 'Cimento assentamento (kg/m³)')}{campo('areiaAssentamento', 'Areia assentamento (m³/m³)')}{campo('cimentoPaulista', 'Cimento paulista (kg/m³)')}{campo('areiaPaulista', 'Areia paulista (m³/m³)')}{campo('cimentoChapisco', 'Cimento chapisco (kg/m²/face)')}{campo('areiaChapisco', 'Areia chapisco (m³/m²/face)')}{campo('volumeChapisco', 'Argamassa chapisco (m³/m², 2 faces)')}</div></details><details><summary>Preparo local</summary><div className={styles.fields}>{campo('custoHoraPreparo', 'Custo-hora da equipe (R$/h)')}{campo('produtividadePrincipal', 'Produtividade principal (m³/h)')}{campo('produtividadeChapisco', 'Produtividade chapisco (m³/h)')}</div></details><details><summary>Usina e entrega</summary><div className={styles.fields}>{campo('usinaPrincipal', 'Usinada assentamento/paulista (R$/m³)')}{campo('usinaChapisco', 'Usinada chapisco (R$/m³)')}{campo('perdaUsina', 'Perda usinada (%)')}{campo('fretePrincipal', 'Frete principal (R$)')}{campo('freteChapisco', 'Frete chapisco (R$)')}{campo('minimoPrincipal', 'Pedido mínimo principal (m³)')}{campo('minimoChapisco', 'Pedido mínimo chapisco (m³)')}{campo('recebimentoUsina', 'Recebimento/bombeamento (R$/m³)')}</div></details></section>
}

function SolucaoCard({ solucao, numero: indice, editar, alterar, remover, resultado }: { solucao: SolucaoEstudo; numero: number; editar: boolean; alterar: (id: string, campo: keyof SolucaoEstudo, valor: string | number) => void; remover: (id: string) => void; resultado: ReturnType<typeof calcularSolucao> }) {
  const campo = (chave: keyof SolucaoEstudo, texto: string, tipo: 'text' | 'number' = 'number') => <label>{texto}<input disabled={!editar} type={tipo} min={tipo === 'number' ? 0 : undefined} step={tipo === 'number' ? 0.01 : undefined} value={solucao[chave] as string | number} onChange={e => alterar(solucao.id, chave, tipo === 'number' ? Number(e.target.value) : e.target.value)} /></label>
  return <article className={styles.solucao}><div className={styles.solutionHead}><strong>Solução {indice}</strong>{editar ? <button className={styles.linkDanger} onClick={() => remover(solucao.id)}>Remover</button> : null}</div><div className={styles.fields}>{campo('nome', 'Nome da solução', 'text')}<label>Bloco<select disabled={!editar} value={solucao.bloco} onChange={e => alterar(solucao.id, 'bloco', e.target.value)}><option value="9">Cerâmico 9 × 19 × 29</option><option value="11.5">Cerâmico 11,5 × 19 × 29</option><option value="19">Cerâmico 19 × 19 × 29</option></select></label>{campo('panos', 'Panos de alvenaria')}{campo('paulistaCm', 'Paulista por face (cm)')}{campo('maoAssentamento', 'MO assentamento (R$/m²)')}{campo('maoChapisco', 'MO chapisco (R$/m²)')}{campo('maoPaulista', 'MO paulista (R$/m²)')}</div>{campo('observacao', 'Condição técnica / observação', 'text')}<div className={styles.metricas}><span>Blocos <strong>{numero.format(resultado.blocosM2)}/m²</strong></span><span>Espessura final <strong>{numero.format(resultado.espessuraFinalCm)} cm</strong></span><span>Total <strong>{resultado.totalM2 === null ? 'Pendente' : `${moeda.format(resultado.totalM2)}/m²`}</strong></span></div>{resultado.motivoPendente ? <p className={styles.pendente}>{resultado.motivoPendente}</p> : null}</article>
}

function Resumo({ resultados, area, menor }: { resultados: ReturnType<typeof calcularSolucao>[]; area: number; menor: number | null }) {
  return <section className={styles.card}><div className={styles.sectionHead}><div><p className={styles.eyebrow}>RESULTADO</p><h2>Comparativo por m²</h2></div></div><div className={styles.tableWrap}><table><thead><tr><th>Solução</th><th>Blocos</th><th>Argamassa</th><th>Aplicação</th><th>Total/m²</th><th>Total da área</th></tr></thead><tbody>{resultados.map(r => <tr className={r.totalM2 === menor ? styles.winner : ''}><td>{r.nome}</td><td>{moeda.format(r.custoBloco)}</td><td>{r.custoArgamassa === null ? 'Pendente' : moeda.format(r.custoArgamassa)}</td><td>{moeda.format(r.custoAplicacao)}</td><td><strong>{r.totalM2 === null ? '—' : moeda.format(r.totalM2)}</strong></td><td><strong>{r.totalArea === null ? '—' : moeda.format(r.totalArea)}</strong></td></tr>)}</tbody></table></div><p className={styles.help}>A alternativa destacada é apenas a de menor custo entre as soluções com dados completos. Confirme requisitos de projeto, desempenho e execução antes de aprovar.</p></section>
}

function AprovacaoEscolha({ resultados, menor, solucaoEscolhidaId, justificativa, aoEscolher, aoJustificar, aoCancelar, aoConfirmar, salvando }: { resultados: ReturnType<typeof calcularSolucao>[]; menor: number | null; solucaoEscolhidaId: string; justificativa: string; aoEscolher: (id: string) => void; aoJustificar: (valor: string) => void; aoCancelar: () => void; aoConfirmar: () => void; salvando: boolean }) {
  return <section className={approvalStyles.approvalCard}>
    <div><p className={styles.eyebrow}>DECISÃO DE EXECUÇÃO</p><h2>Escolha a solução a executar</h2><p>O menor custo permanece destacado como referência. Você pode aprovar qualquer alternativa completa, desde que registre a justificativa técnica.</p></div>
    <div className={approvalStyles.options}>{resultados.map(r => {
      const eEconomica = r.totalM2 === menor
      const insumos = r.custoBloco + (r.custoArgamassa ?? 0)
      return <label className={`${approvalStyles.option} ${solucaoEscolhidaId === r.id ? approvalStyles.optionSelected : ''}`} key={r.id}>
        <input type="radio" name="solucao-escolhida" value={r.id} checked={solucaoEscolhidaId === r.id} onChange={() => aoEscolher(r.id)} />
        <span><strong>{r.nome}</strong><small>{moeda.format(r.totalM2 ?? 0)}/m² · Insumos {moeda.format(insumos)} · Mão de obra {moeda.format(r.custoAplicacao)}</small>{eEconomica ? <b>Menor custo</b> : null}</span>
      </label>
    })}</div>
    <label className={approvalStyles.justification}>Justificativa técnica da escolha<textarea value={justificativa} onChange={event => aoJustificar(event.target.value)} rows={4} placeholder="Ex.: solução escolhida pelo desempenho acústico previsto em projeto, apesar do custo maior." /></label>
    <div className={approvalStyles.actions}><button className={styles.secondary} onClick={aoCancelar}>Cancelar</button><button className={styles.primary} disabled={salvando || !solucaoEscolhidaId || !justificativa.trim()} onClick={aoConfirmar}>Confirmar aprovação</button></div>
  </section>
}

function Dashboard({ resultados, area, menor, modalidade }: { resultados: ReturnType<typeof calcularSolucao>[]; area: number; menor: number | null; modalidade: 'local' | 'usina' }) {
  const validos = resultados.filter(r => r.totalM2 !== null)
  const maior = validos.length ? Math.max(...validos.map(r => r.totalM2 ?? 0)) : 0
  const vencedor = validos.find(r => r.totalM2 === menor)

  return <section className={styles.dashboard}>
    <div className={styles.kpis}>
      <div><span>Menor custo</span><strong>{menor === null ? 'Pendente' : `${moeda.format(menor)}/m²`}</strong></div>
      <div><span>Alternativa econômica</span><strong>{vencedor?.nome ?? '—'}</strong></div>
      <div><span>Economia máxima</span><strong>{menor === null ? '—' : `${moeda.format(maior - menor)}/m²`}</strong></div>
      <div><span>Modalidade</span><strong>{modalidade === 'local' ? 'Feita na obra' : 'Usinada entregue'}</strong></div>
    </div>
    <section className={styles.card}>
      <div className={dashboardStyles.dashboardHead}>
        <div><p className={styles.eyebrow}>VISÃO COMPARATIVA</p><h2>Insumos × mão de obra</h2><p className={dashboardStyles.dashboardSubtitle}>Compare o custo por m² e identifique o componente que mais pesa em cada solução.</p></div>
        <div className={dashboardStyles.dashboardLegend} aria-label="Legenda do gráfico"><span><i className={dashboardStyles.dotInsumos} />Insumos</span><span><i className={dashboardStyles.dotMaoObra} />Mão de obra</span></div>
      </div>
      {validos.length ? <div className={dashboardStyles.decisionGrid}>{validos.map((r, indice) => {
        const insumos = r.custoBloco + (r.custoArgamassa ?? 0)
        const maoObra = r.custoAplicacao
        const total = r.totalM2 ?? 0
        const insumosPercentual = total ? insumos / total * 100 : 0
        const maoObraPercentual = total ? maoObra / total * 100 : 0
        const maiorComponente = maoObra > insumos ? 'Mão de obra' : 'Insumos'
        const maiorPercentual = Math.max(insumosPercentual, maoObraPercentual)
        const eVencedora = r.totalM2 === menor
        return <article className={`${dashboardStyles.decisionCard} ${eVencedora ? dashboardStyles.decisionWinner : ''}`} key={r.id}>
          <header className={dashboardStyles.decisionCardHead}><small>{eVencedora ? '✓ MENOR CUSTO' : `SOLUÇÃO ${String(indice + 1).padStart(2, '0')}`}</small><h3>{r.nome}</h3></header>
          <div className={dashboardStyles.decisionTotal}><strong>{moeda.format(total)}</strong><span>por m²<br />{moeda.format(total * area)} na área</span></div>
          <div className={dashboardStyles.costRows}>
            <div className={`${dashboardStyles.costRow} ${dashboardStyles.insumosRow}`}><label>Insumos</label><div className={dashboardStyles.miniTrack}><i className={dashboardStyles.miniInsumos} style={{ width: `${insumosPercentual}%` }} /></div><b>{moeda.format(insumos)}</b></div>
            <div className={`${dashboardStyles.costRow} ${dashboardStyles.maoObraRow}`}><label>Mão de obra</label><div className={dashboardStyles.miniTrack}><i className={dashboardStyles.miniMaoObra} style={{ width: `${maoObraPercentual}%` }} /></div><b>{moeda.format(maoObra)}</b></div>
          </div>
          <footer className={dashboardStyles.decisionFooter}><span>Maior impacto</span><strong>{maiorComponente} · {numero.format(maiorPercentual)}%</strong></footer>
        </article>
      })}</div> : <p className={styles.pendente}>Complete os dados da modalidade selecionada para visualizar o dashboard.</p>}
    </section>
  </section>
}
