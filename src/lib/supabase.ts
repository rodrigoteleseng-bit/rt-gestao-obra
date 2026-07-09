import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string

export const supabase = createClient(url, key)

export type PapelUsuario = 'admin' | 'equipe' | 'cliente'
export type ModuloApp =
  | 'rdo' | 'avanco' | 'pendencias' | 'almoxarifado' | 'financeiro' | 'compras'
  | 'medicoes' | 'contratos' | 'fvs' | 'galeria' | 'efetivo' | 'alertas'
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
