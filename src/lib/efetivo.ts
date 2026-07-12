// Converte a chamada nominal do dia (Fase 7) no mesmo formato agregado que
// RDOForm.tsx e rdoPdf.ts já sabem renderizar (RdoEfetivo: função + quantidade
// + empresa), para reaproveitar a UI e o PDF do RDO sem alterá-los.
import type { RdoEfetivo, Trabalhador } from './supabase'

export function agruparPresencasComoEfetivo(
  presencas: { trabalhador: Trabalhador; presente: boolean }[]
): RdoEfetivo[] {
  const grupos = new Map<string, { funcao: string; empresa: string | null; quantidade: number }>()
  for (const p of presencas) {
    if (!p.presente) continue
    const chave = `${p.trabalhador.funcao}::${p.trabalhador.empresa ?? ''}`
    const atual = grupos.get(chave)
    if (atual) atual.quantidade += 1
    else grupos.set(chave, { funcao: p.trabalhador.funcao, empresa: p.trabalhador.empresa, quantidade: 1 })
  }
  return Array.from(grupos.entries()).map(([chave, g], i) => ({
    id: `chamada-${chave}-${i}`, rdo_id: '', ativo: true,
    funcao: g.funcao, empresa: g.empresa, quantidade: g.quantidade,
  }))
}
