// Script de importação do Orçamento Analítico V.03
// Lê o Excel e gera SQL para popular etapas + serviços no Supabase
// Executar: node scripts/importar-orcamento.js

const XLSX = require(
  'C:/Users/rodri.000/AppData/Local/Temp/claude/C--Users-rodri-000-Documents-Rodrigo-Claude-rt-gestao-obra/d29307a3-c5d5-4757-8113-d1737062525e/scratchpad/node_modules/xlsx'
)
const { randomUUID } = require('crypto')
const fs = require('fs')

const ARQUIVO = 'C:/Users/rodri.000/Downloads/ORÇAMENTO RESIDENCIAL V.03 - Orçamento Analítico.xlsx'

// IDs das unidades (Tharsos Imperial)
const UNIDADES = {
  sobrados: [
    { id: 'c8ebb246-d50f-441c-9b5b-cc7c1f180f1e', nome: 'Sobrado 01' },
    { id: 'c7ad5dbd-8025-48aa-aaba-3b2c57bb18ef', nome: 'Sobrado 02' },
    { id: 'ae1a34e9-5831-4c1e-881e-214c60e81d61', nome: 'Sobrado 03' },
    { id: '188b11d5-99ed-4778-a174-8157a567b5f7', nome: 'Sobrado 04' },
    { id: '067d8841-6b4b-4b2f-8750-9877ed7333df', nome: 'Sobrado 05' },
    { id: '743c98f1-9eb3-472c-a61e-07ed5fa6cc24', nome: 'Sobrado 06' },
    { id: 'f9ae3267-adda-4418-ba78-85d083a2ae2e', nome: 'Sobrado 07' },
    { id: 'c14022b1-0a8e-42fb-b344-15ed3991568a', nome: 'Sobrado 08' },
    { id: 'e3eabe91-60e3-4cfd-9027-15b60339441d', nome: 'Sobrado 09' },
    { id: '514cebfd-0b48-4a6d-8f0d-3952ac0d392e', nome: 'Sobrado 10' },
    { id: '532f0cc6-792d-4263-b84e-6eae7fb19a76', nome: 'Sobrado 11' },
    { id: '814a97aa-9da2-471b-bc1b-b4d01eec8ed7', nome: 'Sobrado 12' },
    { id: 'f5bafe42-4332-47c0-9784-30db93b2b118', nome: 'Sobrado 13' },
  ],
  portaria:   { id: 'd53c4aff-8a2a-4fda-a17e-7940d14618fd' },
  area_comum: { id: '20ed4cac-bd69-4ad5-990d-60f3ede1c4f1' },
  canteiro:   { id: '84dc2436-787e-4ffb-96a1-3022068bc50f' },
}

// --- Parsing ---

const wb = XLSX.readFile(ARQUIVO)
const ws = wb.Sheets[wb.SheetNames[0]]
const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })

const CODE_RE = /^\s*(\d+(?:\.\d+)*)\s*$/

function depth(code) { return code.split('.').length }

function getUnidadeCtx(stack) {
  for (let i = stack.length - 1; i >= 0; i--) {
    const c = stack[i].code
    if (c === '1.3') return { key: 'sobrados',   level: i }
    if (c === '1.2.1') return { key: 'portaria',   level: i }
    if (c === '1.2.2' || c === '1.2.3') return { key: 'area_comum', level: i }
    if (c === '1.4' || c === '1.5')     return { key: 'area_comum', level: i }
    if (c === '1.1' || c === '1.6' || c === '1.7') return { key: 'canteiro', level: i }
    if (c === '2') return { key: 'canteiro', level: i }
  }
  return { key: 'canteiro', level: 0 }
}

let stack = []     // [{code, nome}]
let inItem = false
let item = null
let gotFirstRow = false
const parsedItems = []

for (const row of rows) {
  const c0 = String(row[0]).trim()
  const c1 = String(row[1]).trim()
  const c3 = String(row[3]).trim()
  const c6 = String(row[6]).trim()
  const c7 = row[7]
  const c8 = row[8]
  const c9 = row[9]

  const codeMatch = c0.match(CODE_RE)

  // Leaf item header — tem "Código" na col B
  if (codeMatch && c1 === 'Código') {
    inItem = true
    gotFirstRow = false
    item = { codigo: codeMatch[1], nome: null, und: null, valorUnit: null, quant: null, total: null, isPerSobrado: false }
    continue
  }

  // Section header — tem nome na col D mas não é cabeçalho de item
  if (codeMatch && c3 !== '' && c3 !== 'Descrição' && c1 !== 'Código') {
    const code = codeMatch[1]
    const d = depth(code)
    while (stack.length > 0 && depth(stack[stack.length - 1].code) >= d) stack.pop()
    stack.push({ code, nome: c3 })
    inItem = false
    item = null
    gotFirstRow = false
    continue
  }

  // Primeira linha de dado do item (Composição ou Insumo)
  if (inItem && !gotFirstRow && (c0 === 'Composição' || c0 === 'Insumo' || c0 === 'Composição Auxiliar')) {
    if (!item.nome) {
      item.nome = c3
      item.und  = String(row[6]).trim()
      item.valorUnit = typeof c8 === 'number' ? c8 : parseFloat(String(c8).replace(',', '.'))
      gotFirstRow = true
    }
    continue
  }

  // Linha de quantidade
  if (c6 === 'Quant. =>' && inItem && item && item.nome) {
    const qRaw = String(c7)
    const perUnit = qRaw.match(/([\d,]+)\s*x\s*13/)
    if (perUnit) {
      item.quant = parseFloat(perUnit[1].replace(',', '.'))
      item.isPerSobrado = true
    } else {
      item.quant = typeof c7 === 'number' ? c7 : parseFloat(qRaw.replace(',', '.'))
    }
    item.total = typeof c9 === 'number' ? c9 : parseFloat(String(c9).replace(',', '.'))

    if (!isNaN(item.quant) && item.quant !== null) {
      const { key: uKey, level: uLevel } = getUnidadeCtx(stack)
      const above = stack.slice(uLevel + 1)
      const etapa = above.length > 0 ? above[0] : stack[stack.length - 1]
      const grupo = above.length > 1 ? above[above.length - 1] : null

      parsedItems.push({
        ...item,
        unidadeKey:  uKey,
        etapaNome:   etapa ? etapa.nome : 'Geral',
        etapaCodigo: etapa ? etapa.code : '',
        grupoNome:   grupo ? grupo.nome : null,
      })
    }

    inItem = false
    item = null
    continue
  }
}

// --- Geração de SQL ---

// Usa E'...' com \uXXXX para garantir SQL 100% ASCII (sem problema de encoding no PowerShell)
function esc(s) {
  if (s === null || s === undefined) return 'NULL'
  const inner = String(s)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "''")
    .replace(/[^\x00-\x7F]/g, c => `\\u${c.codePointAt(0).toString(16).padStart(4, '0')}`)
  return "E'" + inner + "'"
}
function num(v) {
  if (v === null || v === undefined) return 'NULL'
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'))
  return isNaN(n) ? 'NULL' : n
}

const etapaMap = new Map() // `${unidadeId}:${etapaCodigo}` → {id, unidadeId, nome, codigo, ordem}
let etapaOrdem = 1

function getEtapaId(unidadeId, etapaCodigo, etapaNome) {
  const key = `${unidadeId}:${etapaCodigo}`
  if (!etapaMap.has(key)) {
    etapaMap.set(key, { id: randomUUID(), unidadeId, nome: etapaNome, codigo: etapaCodigo, ordem: etapaOrdem++ })
  }
  return etapaMap.get(key).id
}

const servicoRows = []

for (const pi of parsedItems) {
  if (pi.unidadeKey === 'sobrados') {
    for (const sob of UNIDADES.sobrados) {
      const etapaId = getEtapaId(sob.id, pi.etapaCodigo, pi.etapaNome)
      const totalUnit = pi.isPerSobrado
        ? (pi.quant * pi.valorUnit)
        : (isNaN(pi.total) ? null : pi.total / 13)
      servicoRows.push({
        id: randomUUID(), etapa_id: etapaId,
        codigo: pi.codigo, nome: pi.nome, grupo: pi.grupoNome,
        und: pi.und, quant: pi.quant, valor_unit: pi.valorUnit,
        total: totalUnit !== null ? Math.round(totalUnit * 100) / 100 : null,
      })
    }
  } else {
    const uid = UNIDADES[pi.unidadeKey]?.id
    if (!uid) continue
    const etapaId = getEtapaId(uid, pi.etapaCodigo, pi.etapaNome)
    servicoRows.push({
      id: randomUUID(), etapa_id: etapaId,
      codigo: pi.codigo, nome: pi.nome, grupo: pi.grupoNome,
      und: pi.und, quant: pi.quant, valor_unit: pi.valorUnit,
      total: pi.total,
    })
  }
}

const sqlParts = []

// Remove etapas placeholder
sqlParts.push('DELETE FROM etapas WHERE placeholder = true;\n')

// Insert etapas em lotes de 100
const etapas = Array.from(etapaMap.values())
const BATCH_E = 100
for (let i = 0; i < etapas.length; i += BATCH_E) {
  const batch = etapas.slice(i, i + BATCH_E)
  const vals = batch.map(e =>
    `(${esc(e.id)},${esc(e.unidadeId)},${esc(e.nome)},${esc(e.codigo)},${e.ordem},false)`
  ).join(',\n  ')
  sqlParts.push(`INSERT INTO etapas (id,unidade_id,nome,codigo,ordem,placeholder) VALUES\n  ${vals};\n`)
}

// Insert serviços em lotes de 200
const BATCH_S = 200
for (let i = 0; i < servicoRows.length; i += BATCH_S) {
  const batch = servicoRows.slice(i, i + BATCH_S)
  const vals = batch.map(s =>
    `(${esc(s.id)},${esc(s.etapa_id)},${esc(s.codigo)},${esc(s.nome)},${esc(s.grupo)},${esc(s.und)},${num(s.quant)},${num(s.valor_unit)},${num(s.total)})`
  ).join(',\n  ')
  sqlParts.push(`INSERT INTO servicos (id,etapa_id,codigo,nome,grupo,und,quant,valor_unit,total) VALUES\n  ${vals};\n`)
}

const sql = sqlParts.join('\n')
fs.writeFileSync('scripts/orcamento_import.sql', sql, 'utf8')

console.log(`Itens parseados : ${parsedItems.length}`)
console.log(`Etapas geradas  : ${etapas.length}`)
console.log(`Serviços gerados: ${servicoRows.length}`)
console.log(`SQL salvo em    : scripts/orcamento_import.sql`)
