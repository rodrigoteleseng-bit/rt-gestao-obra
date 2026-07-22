// Importa o historico de gastos da planilha "Relatorio Thiago Abrantes" para
// lancamentos_financeiros. Ver docs/superpowers/specs/2026-07-21-fase3a-financeiro-livro-design.md §10.
//
// Uso: node scripts/importar-historico-financeiro.cjs <caminho-da-planilha.xlsx> <obra_id>
// Gera scripts/historico_financeiro_import.sql para revisao antes de aplicar.
//
// Nao executa SQL no banco. A aplicacao real deve acontecer em uma etapa separada,
// depois que Rodrigo enviar a planilha atualizada.

const fs = require('fs')

let XLSX
try {
  XLSX = require('xlsx')
} catch {
  console.error('Dependencia ausente: xlsx. Rode com uma instalacao que disponibilize esse pacote antes do dry-run.')
  console.error('Exemplo temporario: npx -p xlsx node scripts/importar-historico-financeiro.cjs <planilha.xlsx> <obra_id>')
  process.exit(1)
}

const ARQUIVO = process.argv[2]
const OBRA_ID = process.argv[3]

if (!ARQUIVO || !OBRA_ID) {
  console.error('Uso: node scripts/importar-historico-financeiro.cjs <planilha.xlsx> <obra_id>')
  process.exit(1)
}

if (!fs.existsSync(ARQUIVO)) {
  console.error(`Planilha nao encontrada: ${ARQUIVO}`)
  process.exit(1)
}

// Trechos de descricao ja cobertos por Contrato/Medicao no app - nao importar como avulso
// para evitar contagem em dobro. Atualizar a cada novo contrato medido pelo app.
const EXCLUSOES = [
  'instalações hidrossanitárias (JFC INSTALAÇÕES)',
  'instalacoes hidrossanitarias (JFC INSTALACOES)',
]

function sqlText(v) {
  return String(v ?? '').replace(/'/g, "''")
}

function normalizarValor(v) {
  const texto = String(v ?? '').trim()
  if (!texto) return 0
  const limpo = texto.replace(/[^\d,.-]/g, '')
  if (limpo.includes(',') && limpo.includes('.')) {
    const ultimaVirgula = limpo.lastIndexOf(',')
    const ultimoPonto = limpo.lastIndexOf('.')
    if (ultimaVirgula > ultimoPonto) return Number(limpo.replace(/\./g, '').replace(',', '.')) || 0
    return Number(limpo.replace(/,/g, '')) || 0
  }
  if (limpo.includes(',') && !limpo.includes('.')) return Number(limpo.replace(',', '.')) || 0
  return Number(limpo) || 0
}

function normalizarData(v) {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10)
  const texto = String(v ?? '').trim()
  const m = texto.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/)
  if (!m) return null
  const [, mes, dia, ano] = m
  const anoCompleto = ano.length === 2 ? `20${ano}` : ano
  return `${anoCompleto}-${mes.padStart(2, '0')}-${dia.padStart(2, '0')}`
}

function extrairFavorecido(descricao) {
  const m = descricao.match(/\(([^)]+)\)\s*$/)
  return m ? m[1] : descricao
}

function normalizarTexto(v) {
  return String(v ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

function deveExcluir(descricao) {
  const alvo = normalizarTexto(descricao)
  return EXCLUSOES.some(trecho => alvo.includes(normalizarTexto(trecho)))
}

const wb = XLSX.readFile(ARQUIVO, { cellDates: true })
const ws = wb.Sheets['RELATÓRIO DESPESAS DE OBRA'] || wb.Sheets['RELATORIO DESPESAS DE OBRA'] || wb.Sheets[wb.SheetNames[0]]
const linhas = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' })

const inserts = []
let excluidas = 0
let semCodigo = 0
let ambiguoSobrado = 0
let ignoradas = 0

for (let i = 15; i < linhas.length; i++) {
  const l = linhas[i]
  if (!l[6] || !String(l[6]).trim()) continue

  const data = normalizarData(l[2])
  const codigo = String(l[5] ?? '').trim()
  const valor = normalizarValor(l[6])
  const descricaoBruta = String(l[7] ?? '').trim()
  const nfRef = String(l[8] ?? '').trim()

  if (!descricaoBruta || valor <= 0) {
    ignoradas++
    continue
  }
  if (deveExcluir(descricaoBruta)) {
    excluidas++
    continue
  }

  const favorecido = sqlText(extrairFavorecido(descricaoBruta))
  const descricao = sqlText(descricaoBruta)
  const nf = nfRef && nfRef !== '-' ? ` (${nfRef})` : ''
  const observacao = sqlText(`Importado do historico - planilha Thiago Abrantes${nf}`)

  let etapaSql = 'NULL'
  let servicoSql = 'NULL'
  let unidadeSql = 'NULL'

  if (!codigo || codigo === '-' || /validar/i.test(codigo)) {
    semCodigo++
  } else if (/^1\.3\./.test(codigo)) {
    ambiguoSobrado++
    const etapaCodigo = sqlText(codigo.replace(/\.\d+$/, ''))
    etapaSql = `(SELECT e.id FROM etapas e JOIN unidades u ON u.id = e.unidade_id WHERE e.codigo = '${etapaCodigo}' AND u.obra_id = '${OBRA_ID}' LIMIT 1)`
    unidadeSql = `(SELECT unidade_id FROM etapas WHERE id = ${etapaSql})`
  } else {
    const codigoSql = sqlText(codigo)
    servicoSql = `(SELECT s.id FROM servicos s JOIN etapas e ON e.id = s.etapa_id JOIN unidades u ON u.id = e.unidade_id WHERE s.codigo = '${codigoSql}' AND u.obra_id = '${OBRA_ID}' LIMIT 1)`
    etapaSql = `(SELECT etapa_id FROM servicos WHERE id = ${servicoSql})`
    unidadeSql = `(SELECT unidade_id FROM etapas WHERE id = ${etapaSql})`
  }

  inserts.push(
    `INSERT INTO lancamentos_financeiros (obra_id, unidade_id, etapa_id, servico_id, descricao, favorecido, valor, status, data_pagamento, forma_pagamento, observacao) VALUES ('${OBRA_ID}', ${unidadeSql}, ${etapaSql}, ${servicoSql}, '${descricao}', '${favorecido}', ${valor.toFixed(2)}, 'pago', ${data ? `'${data}'` : 'NULL'}, 'Historico - forma nao registrada na planilha', '${observacao}');`
  )
}

const saida = 'scripts/historico_financeiro_import.sql'
fs.writeFileSync(saida, inserts.join('\n') + (inserts.length ? '\n' : ''))

console.log(`Gerado ${saida} com ${inserts.length} lancamentos.`)
console.log(`Excluidas ja cobertas por contrato/medicao no app: ${excluidas}`)
console.log(`Sem codigo do orcamento, fila a classificar: ${semCodigo}`)
console.log(`Codigo ambiguo entre sobrados, vinculado so a etapa: ${ambiguoSobrado}`)
console.log(`Ignoradas sem descricao ou valor valido: ${ignoradas}`)
console.log('Dry-run concluido. Nao aplique esse SQL enquanto a planilha atualizada nao for revisada.')
