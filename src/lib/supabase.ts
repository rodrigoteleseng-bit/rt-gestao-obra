import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string

export const supabase = createClient(url, key)

export type PapelUsuario = 'admin' | 'equipe' | 'cliente'
export type ModuloApp = 'rdo' | 'avanco' | 'pendencias' | 'almoxarifado' | 'financeiro' | 'compras'
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
