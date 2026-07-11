// Helpers de data compartilhados pelo módulo Almoxarifado (Fase 6).
// Extraído para evitar duplicar a lógica de fuso horário entre a tela de Ferramentas
// (Almoxarifado.tsx) e o banner de ferramentas em atraso no Dashboard.

/** Data local (fuso do navegador) em formato ISO (YYYY-MM-DD), sem componente de hora. */
export function dataLocalISO(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dia = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dia}`
}

export function dataHoje(): string {
  return dataLocalISO(new Date())
}

export function diasEntre(dataIsoInicio: string, dataIsoFim: string): number {
  return Math.round((Date.parse(dataIsoFim) - Date.parse(dataIsoInicio)) / 86400000)
}
