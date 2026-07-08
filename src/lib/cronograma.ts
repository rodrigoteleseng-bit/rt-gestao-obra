// Carregamento e cálculos do cronograma (Fase 2).
// Peso das tarefas na Curva S e nos percentuais agregados = duração prevista
// [estimado — migra para valor (R$) quando houver de-para com o orçamento, Fase 3].

import { supabase } from './supabase'
import type { CronogramaVersao, CronogramaTarefa, CronogramaPrevisto, AvancoFisico } from './supabase'

// Supabase limita 1000 linhas por consulta — pagina até trazer tudo
async function paginado<T>(monta: (de: number, ate: number) => PromiseLike<{ data: T[] | null }>): Promise<T[]> {
  const todos: T[] = []
  const PAGINA = 1000
  for (let de = 0; ; de += PAGINA) {
    const { data } = await monta(de, de + PAGINA - 1)
    const lote = data ?? []
    todos.push(...lote)
    if (lote.length < PAGINA) break
  }
  return todos
}

export interface DadosCronograma {
  versao: CronogramaVersao | null
  tarefas: CronogramaTarefa[]
  previstoPorTarefa: Map<string, CronogramaPrevisto>
  avancos: AvancoFisico[]
}

export async function carregarCronograma(obraId: string): Promise<DadosCronograma> {
  const { data: versoes } = await supabase
    .from('cronograma_versoes')
    .select('*')
    .eq('obra_id', obraId)
    .eq('vigente', true)
    .order('versao', { ascending: false })
    .limit(1)
  const versao = (versoes ?? [])[0] ?? null
  if (!versao) return { versao: null, tarefas: [], previstoPorTarefa: new Map(), avancos: [] }

  const [tarefas, previstos, avancos] = await Promise.all([
    paginado<CronogramaTarefa>((de, ate) =>
      supabase.from('cronograma_tarefas').select('*')
        .eq('obra_id', obraId).eq('ativo', true).order('ordem').range(de, ate)),
    paginado<CronogramaPrevisto>((de, ate) =>
      supabase.from('cronograma_previsto').select('*')
        .eq('versao_id', versao.id).order('tarefa_id').range(de, ate)),
    paginado<AvancoFisico>((de, ate) =>
      supabase.from('avancos_fisicos').select('*')
        .eq('ativo', true).order('criado_em').range(de, ate)),
  ])

  const previstoPorTarefa = new Map(previstos.map(p => [p.tarefa_id, p]))
  return { versao, tarefas, previstoPorTarefa, avancos }
}

// % atual de cada tarefa-folha = último lançamento ativo
// (por data de referência; empate decidido pela data de criação).
export function percentuaisAtuais(avancos: AvancoFisico[]): Map<string, AvancoFisico> {
  const porTarefa = new Map<string, AvancoFisico>()
  for (const a of avancos) {
    const atual = porTarefa.get(a.tarefa_id)
    if (!atual
      || a.data_referencia > atual.data_referencia
      || (a.data_referencia === atual.data_referencia && a.criado_em > atual.criado_em)) {
      porTarefa.set(a.tarefa_id, a)
    }
  }
  return porTarefa
}

export interface NoCronograma {
  tarefa: CronogramaTarefa
  filhos: NoCronograma[]
  previsto: CronogramaPrevisto | null
  peso: number          // soma das durações das folhas descendentes
  percentual: number    // folha: lançado; resumo: média ponderada pelo peso
}

export type StatusTarefa = 'concluida' | 'atrasada' | 'andamento' | 'prevista'

export function statusTarefa(no: NoCronograma, hoje: string): StatusTarefa {
  if (no.percentual >= 100) return 'concluida'
  if (no.previsto && no.previsto.fim < hoje) return 'atrasada'
  if (no.percentual > 0) return 'andamento'
  return 'prevista'
}

// Monta a árvore e agrega peso/percentual de baixo para cima.
export function montarArvore(
  tarefas: CronogramaTarefa[],
  previstoPorTarefa: Map<string, CronogramaPrevisto>,
  pctPorTarefa: Map<string, AvancoFisico>,
): Map<string, NoCronograma[]> {
  const nos = new Map<string, NoCronograma>()
  for (const t of tarefas) {
    nos.set(t.id, { tarefa: t, filhos: [], previsto: previstoPorTarefa.get(t.id) ?? null, peso: 0, percentual: 0 })
  }
  const raizesPorUnidade = new Map<string, NoCronograma[]>()
  for (const t of tarefas) {
    const no = nos.get(t.id)!
    if (t.parent_id && nos.has(t.parent_id)) {
      nos.get(t.parent_id)!.filhos.push(no)
    } else {
      const lista = raizesPorUnidade.get(t.unidade_id) ?? []
      lista.push(no)
      raizesPorUnidade.set(t.unidade_id, lista)
    }
  }
  function agregar(no: NoCronograma): void {
    if (no.filhos.length === 0) {
      no.peso = no.previsto?.duracao_horas || 1
      no.percentual = pctPorTarefa.get(no.tarefa.id)?.percentual ?? 0
      return
    }
    let peso = 0
    let executado = 0
    for (const f of no.filhos) {
      agregar(f)
      peso += f.peso
      executado += f.peso * f.percentual
    }
    no.peso = peso
    no.percentual = peso > 0 ? executado / peso : 0
  }
  for (const raizes of raizesPorUnidade.values()) for (const r of raizes) agregar(r)
  return raizesPorUnidade
}

export function hojeISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
