import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string

export const supabase = createClient(url, key)

export type PapelUsuario = 'admin' | 'equipe' | 'cliente'
export type ModuloApp =
  | 'rdo' | 'avanco' | 'pendencias' | 'almoxarifado' | 'financeiro' | 'compras'
  | 'medicoes' | 'contratos' | 'fvs' | 'galeria' | 'efetivo' | 'alertas' | 'definicoes' | 'tarefas' | 'projetos' | 'planejamento'
export type StatusObra = 'ativa' | 'pausada' | 'concluida' | 'arquivada'
export type TipoUnidade = 'sobrado' | 'portaria' | 'area_comum' | 'canteiro' | 'outro'

export interface PerfilUsuario {
  id: string
  nome: string
  email: string
  papel: PapelUsuario
  modulos_permitidos: ModuloApp[]
  ativo: boolean
  criado_em: string
}

export interface Obra {
  id: string
  nome: string
  descricao: string | null
  endereco: string | null
  cidade: string | null
  estado: string | null
  data_inicio: string | null
  data_fim_prevista: string | null
  status: StatusObra
}

export interface UsuarioObra {
  usuario_id: string
  obra_id: string
  ativo: boolean
  criado_em: string
  atualizado_em: string
}

export interface Unidade {
  id: string
  obra_id: string
  nome: string
  tipo: TipoUnidade
  ordem: number
}

export interface Etapa {
  id: string
  unidade_id: string
  nome: string
  codigo: string | null
  ordem: number
  placeholder: boolean
}

export interface CronogramaVersao {
  id: string
  obra_id: string
  versao: number
  nome: string
  arquivo: string | null
  vigente: boolean
}

export interface CronogramaTarefa {
  id: string
  obra_id: string
  unidade_id: string
  parent_id: string | null
  uid_project: number
  outline_number: string | null
  nivel: number
  ordem: number
  nome: string
  resumo: boolean
  grupo_ataque: string | null
  etapa_id: string | null
  servico_id: string | null
  und: string | null
  quant_total: number | null
  quant_definida_por: string | null
  quant_definida_em: string | null
}

export interface CronogramaPrevisto {
  id: string
  tarefa_id: string
  versao_id: string
  inicio: string
  fim: string
  duracao_horas: number | null
}

export interface AvancoFisico {
  id: string
  tarefa_id: string
  data_referencia: string
  percentual: number
  quantidade: number | null
  observacao: string | null
  ativo: boolean
  criado_em: string
  criado_por: string
}

export type StatusRdo = 'rascunho' | 'assinado'
export type CondicaoClima = 'claro' | 'nublado' | 'chuvoso'

export interface Rdo {
  id: string
  obra_id: string
  numero: number
  data: string
  horario_inicio: string | null
  clima_manha: CondicaoClima | null
  clima_manha_trabalhavel: boolean | null
  clima_tarde: CondicaoClima | null
  clima_tarde_trabalhavel: boolean | null
  acidente: boolean
  acidente_descricao: string | null
  observacoes: string | null
  status: StatusRdo
  assinatura_imagem: string | null
  assinado_por_nome: string | null
  assinado_em: string | null
  assinatura_lat: number | null
  assinatura_lng: number | null
  assinatura_precisao_m: number | null
  ativo: boolean
  criado_em: string
  criado_por: string
}

export interface RdoAtividade {
  id: string
  rdo_id: string
  unidade_id: string
  tarefa_id: string | null
  descricao: string
  ordem: number
  ativo: boolean
}

export interface RdoEfetivo {
  id: string
  rdo_id: string
  funcao: string
  quantidade: number
  empresa: string | null
  ativo: boolean
}

export interface RdoFoto {
  id: string
  rdo_id: string
  unidade_id: string | null
  path: string
  legenda: string | null
  lat: number | null
  lng: number | null
  precisao_m: number | null
  capturada_em: string
  hash_sha256: string
  ativo: boolean
}

export interface RdoAudio {
  id: string
  rdo_id: string
  path: string
  duracao_seg: number | null
  gravado_em: string
  hash_sha256: string
  ativo: boolean
}

export type TipoServicoProducao = 'alvenaria' | 'reboco'
export type TipoAberturaProducao = 'porta' | 'janela' | 'outro'
export type StatusMedicaoProducao = 'rascunho' | 'aprovada' | 'paga' | 'cancelada'
export type Pavimento = 'terreo' | 'superior' | 'platibanda' | 'caixa_agua'
export type FaceParede = 'a' | 'b'

export interface ProducaoSalario {
  id: string; obra_id: string; trabalhador_id: string; funcao: string
  salario_mensal: number; vigente_desde: string; vigente_ate: string | null
  ativo: boolean; criado_por: string; criado_em: string
}
export interface ProducaoPlanta {
  id: string; obra_id: string; pavimento: Pavimento
  pdf_path: string; imagem_path: string; ativo: boolean
  criado_por: string; criado_em: string
}
export interface ProducaoParede {
  id: string; planta_id: string; nome: string
  pos_x: number; pos_y: number; largura: number; altura_px: number
  meta_alvenaria_m2: number | null; meta_reboco_a_m2: number | null; meta_reboco_b_m2: number | null
  rotulo_pos_x: number | null; rotulo_pos_y: number | null; rotulo_rotacao: number; rotulo_escala: number
  ativo: boolean; criado_por: string; criado_em: string
}
export interface ProducaoParedeProgresso {
  id: string; parede_id: string; unidade_id: string
  servico: TipoServicoProducao; face: FaceParede | null
  produzido_m2: number; atualizado_em: string
}
export interface ProducaoLancamento {
  id: string; obra_id: string; unidade_id: string; data_producao: string
  servico: TipoServicoProducao; parede_nome: string
  parede_id: string | null; face: FaceParede | null
  comprimento: number | null; altura: number | null
  area_bruta: number; area_aberturas: number; area_liquida: number; preco_m2: number
  valor_total: number; observacao: string | null; ativo: boolean; criado_por: string; criado_em: string
  cancelado_em: string | null; cancelado_por: string | null; motivo_cancelamento: string | null
}
export interface ProducaoAbertura {
  id: string; lancamento_id: string; tipo: TipoAberturaProducao; identificacao: string | null
  comprimento: number; altura: number; area: number; ativo: boolean
}
export interface ProducaoParticipante {
  id: string; lancamento_id: string; trabalhador_id: string; fracao: number
  area_atribuida: number; valor_atribuido: number; ativo: boolean
}
export interface ProducaoDiaSalarial {
  id: string; obra_id: string; trabalhador_id: string; data: string; salario_id: string
  salario_mensal_snapshot: number; divisor_snapshot: number; valor_dia: number
  motivo: string; medicao_id: string | null; ativo: boolean
}
export interface ProducaoMedicao {
  id: string; obra_id: string; trabalhador_id: string; numero: number
  data_inicio: string; data_fim: string; status: StatusMedicaoProducao
  valor_producao: number; valor_salarial: number; valor_total: number
  aprovada_por: string | null; aprovada_em: string | null; paga_por: string | null; paga_em: string | null
  cancelada_por: string | null; cancelada_em: string | null; motivo_cancelamento: string | null
  ativo: boolean; criado_por: string; criado_em: string
}

export type StatusPendencia = 'aberta' | 'em_correcao' | 'resolvida'

export interface Pendencia {
  id: string
  obra_id: string
  unidade_id: string
  tarefa_id: string | null
  descricao: string
  responsavel: string | null
  prazo: string | null
  status: StatusPendencia
  resolvida_em: string | null
  resolvida_por: string | null
  ativo: boolean
  criado_em: string
  criado_por: string
}

export interface PendenciaEvento {
  id: string
  pendencia_id: string
  status: StatusPendencia
  comentario: string | null
  criado_em: string
  criado_por: string
}

export interface PendenciaFoto {
  id: string
  pendencia_id: string
  path: string
  legenda: string | null
  lat: number | null
  lng: number | null
  precisao_m: number | null
  capturada_em: string
  hash_sha256: string
  ativo: boolean
}

export type StatusDefinicao = 'pendente' | 'resolvida'

export interface DefinicaoProjeto {
  id: string
  obra_id: string
  unidade_id: string | null
  titulo: string
  local_ambiente: string | null
  descricao: string | null
  responsavel: string | null
  prazo: string | null
  status: StatusDefinicao
  decisao: string | null
  resolvida_em: string | null
  resolvida_por: string | null
  ativo: boolean
  criado_em: string
  criado_por: string
}

export interface ProjetoDocumento {
  id: string
  obra_id: string
  titulo: string
  pasta_id: string
  descricao: string | null
  ativo: boolean
  criado_em: string
  criado_por: string
}

export interface ProjetoPasta {
  id: string
  obra_id: string
  nome: string
  ativo: boolean
  criado_em: string
  criado_por: string
}

export interface ProjetoRevisao {
  id: string
  documento_id: string
  revisao: string
  path: string
  observacao: string | null
  atual: boolean
  criado_em: string
  criado_por: string
}

export type StatusTarefa = 'aberta' | 'em_andamento' | 'concluida' | 'cancelada'
export type PrioridadeTarefa = 'baixa' | 'normal' | 'alta' | 'urgente'
export type TipoTarefaComentario = 'comentario' | 'criada' | 'iniciada' | 'concluida' | 'cancelada' | 'reaberta' | 'editada'

export interface Tarefa {
  id: string
  obra_id: string
  unidade_id: string | null
  etapa_id: string | null
  servico_id: string | null
  titulo: string
  descricao: string | null
  responsavel_id: string | null
  prazo: string
  prioridade: PrioridadeTarefa
  status: StatusTarefa
  motivo_cancelamento: string | null
  concluida_por: string | null
  concluida_em: string | null
  cancelada_por: string | null
  cancelada_em: string | null
  ativo: boolean
  criado_por: string
  criado_em: string
  atualizado_por: string | null
  atualizado_em: string
}

export interface TarefaComentario {
  id: string
  tarefa_id: string
  tipo: TipoTarefaComentario
  comentario: string
  criado_por: string
  criado_em: string
}

export type StatusFvs = 'em_andamento' | 'aprovada' | 'aprovada_restricao' | 'reprovada'
export type RespostaFvs = 'c' | 'nc' | 'na' | 'aguardando'

export interface FvsModelo {
  id: string
  codigo: string
  nome: string
  objetivo: string | null
  normas: string | null
  criterios_aceitacao: string | null
  ordem: number
  ativo: boolean
}

export interface FvsModeloItem {
  id: string
  modelo_id: string
  secao: string
  ordem: number
  texto: string
  criterio: string | null
  ativo: boolean
}

export interface Fvs {
  id: string
  obra_id: string
  modelo_id: string
  unidade_id: string
  tarefa_id: string | null
  local_ambiente: string | null
  equipe_empreiteiro: string | null
  projeto_referencia: string | null
  status: StatusFvs
  ativo: boolean
  criado_em: string
  criado_por: string
}

export interface FvsVerificacao {
  id: string
  fvs_id: string
  numero: number
  resultado: StatusFvs | null
  observacao: string | null
  concluida_em: string | null
  concluida_por: string | null
  assinatura_imagem: string | null
  assinado_por_nome: string | null
  assinatura_lat: number | null
  assinatura_lng: number | null
  assinatura_precisao_m: number | null
  criado_em: string
  criado_por: string
}

export interface FvsResposta {
  id: string
  verificacao_id: string
  item_id: string
  resposta: RespostaFvs
  observacao: string | null
}

export interface FvsFoto {
  id: string
  fvs_id: string
  verificacao_id: string | null
  item_id: string | null
  path: string
  legenda: string | null
  lat: number | null
  lng: number | null
  precisao_m: number | null
  capturada_em: string
  hash_sha256: string
  ativo: boolean
}

export interface Servico {
  id: string
  etapa_id: string
  codigo: string | null
  nome: string
  grupo: string | null
  und: string | null
  quant: number | null
  valor_unit: number | null
  total: number | null
  ativo: boolean
}

export type StatusPedidoCompra =
  | 'rascunho' | 'em_cotacao' | 'aprovado' | 'enviado'
  | 'recebido_parcial' | 'recebido_total' | 'conferido_nf' | 'encerrado' | 'cancelado'

export interface Fornecedor {
  id: string
  nome: string
  contato: string | null
  cnpj: string | null
  ativo: boolean
  criado_em: string
  criado_por: string
}

export interface PedidoCompra {
  id: string
  obra_id: string
  numero: number
  status: StatusPedidoCompra
  descricao: string | null
  motivo_cancelamento: string | null
  aprovado_por: string | null
  aprovado_em: string | null
  ativo: boolean
  criado_em: string
  criado_por: string
}

export interface PedidoCompraItem {
  id: string
  pedido_id: string
  servico_id: string | null
  descricao_item: string
  quantidade_pedida: number
  und: string | null
  data_necessaria: string | null
  urgente: boolean
  cotacao_item_vencedora_id: string | null
  quantidade_recebida: number
  valor_recebido: number | null
  ativo: boolean
  criado_em: string
  criado_por: string
}

export interface Cotacao {
  id: string
  pedido_id: string
  fornecedor_id: string
  condicao_pagamento: string | null
  prazo_entrega_dias: number | null
  anexo_url: string
  criado_em: string
  criado_por: string
  editado_em: string | null
  editado_por: string | null
}

export interface CotacaoItem {
  id: string
  cotacao_id: string
  pedido_item_id: string
  preco_unitario: number
  criado_em: string
  criado_por: string
  editado_em: string | null
  editado_por: string | null
}

export interface RecebimentoNf {
  id: string
  pedido_id: string
  anexo_nf_url: string
  observacao: string | null
  criado_em: string
  criado_por: string
}

export type CategoriaMaterial = 'material' | 'epi' | 'escritorio'
export type TipoMovimentoEstoque = 'entrada' | 'saida'
export interface Material {
  id: string; obra_id: string; codigo: string; nome: string
  descricao: string | null; und: string; categoria: CategoriaMaterial
  estoque_minimo: number | null; ativo: boolean; criado_por: string; criado_em: string
}
export interface EstoqueMovimento {
  id: string; obra_id: string; material_id: string; tipo: TipoMovimentoEstoque
  quantidade: number; pedido_item_id: string | null; requisicao_numero: number | null
  unidade_id: string | null; retirado_por: string | null; tarefa_id: string | null
  aplicacao: string | null; observacao: string | null; ativo: boolean
  criado_por: string; criado_em: string
  fornecedor_id: string | null; numero_nf: string | null
  editado_por: string | null; editado_em: string | null
}
export interface Ferramenta {
  id: string; obra_id: string; nome: string; descricao: string | null
  ativo: boolean; criado_por: string; criado_em: string
}
export interface FerramentaEmprestimo {
  id: string; ferramenta_id: string; retirado_por: string; unidade_id: string | null
  observacao: string | null; retirada_em: string; devolvida_em: string | null
  devolvida_recebida_por: string | null; criado_por: string; criado_em: string
}
export type ModalidadeLocacaoFerramenta = 'diaria' | 'semanal' | 'mensal'
export interface FerramentaLocacao {
  id: string
  obra_id: string
  nome_ferramenta: string
  locadora: string
  modalidade: ModalidadeLocacaoFerramenta
  data_chegada: string
  data_entrega_prevista: string
  data_entregue: string | null
  observacao: string | null
  ativo: boolean
  criado_por: string
  criado_em: string
  entregue_por: string | null
  entregue_em: string | null
  editado_por: string | null
  editado_em: string | null
}
export interface RequisicaoBloco {
  id: string; obra_id: string; numero_inicial: number; numero_final: number
  criado_por: string; criado_em: string
}
export interface Trabalhador {
  id: string
  obra_id: string
  nome: string
  funcao: string
  empresa: string | null
  data_admissao: string | null
  ativo: boolean
  criado_por: string
  criado_em: string
}
export interface EfetivoChamada {
  id: string
  obra_id: string
  data: string
  criado_por: string
  criado_em: string
}
export interface EfetivoPresenca {
  id: string
  chamada_id: string
  trabalhador_id: string
  presente: boolean
  criado_por: string
  criado_em: string
}

export type StatusContrato = 'rascunho' | 'ativo' | 'encerrado'

export interface Empreiteiro {
  id: string
  nome: string
  documento: string | null
  contato: string | null
  especialidade: string | null
  pix: string | null
  ativo: boolean
  criado_em: string
  criado_por: string
}

export interface Contrato {
  id: string
  obra_id: string
  numero: string
  empreiteiro_id: string
  objeto: string
  condicao_pagamento: string | null
  retencao_pct: number | null
  valor_total: number
  status: StatusContrato
  ativado_por: string | null
  ativado_em: string | null
  encerrado_por: string | null
  encerrado_em: string | null
  ativo: boolean
  criado_em: string
  criado_por: string
}

export interface ContratoItem {
  id: string
  contrato_id: string
  servico_id: string
  unidade_id: string
  quantidade: number
  valor_unitario: number
  valor_total: number
  ativo: boolean
  criado_em: string
  criado_por: string
}

export type StatusMedicao = 'rascunho' | 'aprovada'

export interface Medicao {
  id: string
  contrato_id: string
  numero: number
  data_referencia: string
  status: StatusMedicao
  valor_bruto: number
  valor_retido: number
  valor_liquido: number
  aprovada_por: string | null
  aprovada_em: string | null
  ativo: boolean
  criado_em: string
  criado_por: string
}

export interface MedicaoItem {
  id: string
  medicao_id: string
  contrato_item_id: string
  quantidade_periodo: number
  valor_total_item: number
  ativo: boolean
  criado_em: string
  criado_por: string
}

export type CategoriaRestricao =
  | 'material' | 'mao_de_obra' | 'projeto_documentacao' | 'decisao_pendente'
  | 'equipamento' | 'financeiro' | 'servico_predecessor' | 'clima'
export type StatusRestricao = 'aberta' | 'resolvida'
export type StatusSemanaPlanejamento = 'aberta' | 'planejada' | 'fechada'

export interface Restricao {
  id: string
  obra_id: string
  tarefa_id: string
  categoria: CategoriaRestricao
  responsavel_id: string | null
  prazo: string
  status: StatusRestricao
  observacao: string | null
  resolvida_por: string | null
  resolvida_em: string | null
  ativo: boolean
  criado_em: string
  criado_por: string
}

export interface PlanejamentoSemana {
  id: string
  obra_id: string
  data_inicio: string
  data_fim: string
  status: StatusSemanaPlanejamento
  ppc: number | null
  fechada_por: string | null
  fechada_em: string | null
  ativo: boolean
  criado_em: string
  criado_por: string
}

export interface PlanejamentoCompromisso {
  id: string
  semana_id: string
  tarefa_id: string
  percentual_inicio: number
  meta_percentual: number
  percentual_fim: number | null
  cumprido: boolean | null
  motivo_categoria: CategoriaRestricao | null
  motivo_observacao: string | null
  ativo: boolean
  criado_em: string
  criado_por: string
}

