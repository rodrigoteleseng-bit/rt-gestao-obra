// Script de importação do Cronograma (MS Project XML) — Fase 2
// Lê o XML exportado do MS Project e gera SQL para popular
// cronograma_versoes, cronograma_tarefas, cronograma_previsto e
// cronograma_dependencias no Supabase.
// Executar: node scripts/importar-cronograma.cjs [caminho-do-xml]

const fs = require('fs')
const { randomUUID } = require('crypto')

const ARQUIVO = process.argv[2] || 'C:/Users/rodri.000/Documents/Cronograma de Serviços - Jardins imperial.xml'
const SAIDA = __dirname + '/cronograma_import.sql'

const OBRA_ID = '00000000-0000-0000-0000-000000000001' // Tharsos Imperial
const ADMIN_ID = '39be78b9-9179-4917-a748-be8a186b5ea3' // Rodrigo (autoria da importação)

// IDs das unidades (Fase 0)
const SOBRADOS = {
  1: 'c8ebb246-d50f-441c-9b5b-cc7c1f180f1e', 2: 'c7ad5dbd-8025-48aa-aaba-3b2c57bb18ef',
  3: 'ae1a34e9-5831-4c1e-881e-214c60e81d61', 4: '188b11d5-99ed-4778-a174-8157a567b5f7',
  5: '067d8841-6b4b-4b2f-8750-9877ed7333df', 6: '743c98f1-9eb3-472c-a61e-07ed5fa6cc24',
  7: 'f9ae3267-adda-4418-ba78-85d083a2ae2e', 8: 'c14022b1-0a8e-42fb-b344-15ed3991568a',
  9: 'e3eabe91-60e3-4cfd-9027-15b60339441d', 10: '514cebfd-0b48-4a6d-8f0d-3952ac0d392e',
  11: '532f0cc6-792d-4263-b84e-6eae7fb19a76', 12: '814a97aa-9da2-471b-bc1b-b4d01eec8ed7',
  13: 'f5bafe42-4332-47c0-9784-30db93b2b118',
}
const PORTARIA = 'd53c4aff-8a2a-4fda-a17e-7940d14618fd'
const AREA_COMUM = '20ed4cac-bd69-4ad5-990d-60f3ede1c4f1'
const CANTEIRO = '84dc2436-787e-4ffb-96a1-3022068bc50f'

// Mapeamento aprovado pelo Rodrigo (07/07/2026):
// Serviços Preliminares → Canteiro; Muro de Contenção, Área de Lazer e
// Pavimentação/Paisagismo Condomínio → Área Comum; Casa NN → Sobrado NN.
function unidadeDoBloco(nome) {
  const n = nome.toUpperCase()
  if (n.includes('PRELIMINAR')) return CANTEIRO
  if (n.includes('MURO DE CONTEN')) return AREA_COMUM
  if (n.includes('PORTARIA')) return PORTARIA
  if (n.includes('LAZER')) return AREA_COMUM
  if (n.includes('PAVIMENTA') || n.includes('PAISAGISMO')) return AREA_COMUM
  return null
}

// --- Leitura e parsing do XML ---

const xml = fs.readFileSync(ARQUIVO, 'utf8')
const tasksBlock = xml.slice(xml.indexOf('<Tasks>'), xml.indexOf('</Tasks>'))

function decode(s) {
  return s
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
}
function tag(block, name) {
  const m = block.match(new RegExp('<' + name + '>([^<]*)</' + name + '>'))
  return m ? decode(m[1]) : null
}
function duracaoHoras(pt) {
  if (!pt) return null
  const m = pt.match(/PT(\d+)H(\d+)M(\d+)S/)
  if (!m) return null
  return Math.round((Number(m[1]) + Number(m[2]) / 60 + Number(m[3]) / 3600) * 100) / 100
}

const rawTasks = tasksBlock.split('<Task>').slice(1).map(b => b.slice(0, b.indexOf('</Task>')))

// --- Montagem da árvore com mapeamento de unidades ---

const tarefas = []            // tarefas mantidas
const porUid = new Map()      // uid_project -> tarefa
const stack = []              // ancestrais mantidos [{nivel, id, unidade, grupo}]
let currentUnidade = null
let currentGrupo = null
const erros = []

for (const b of rawTasks) {
  const uid = tag(b, 'UID')
  const nome = tag(b, 'Name')
  if (uid === null || !nome) continue
  const nivel = Number(tag(b, 'OutlineLevel'))
  const ordem = Number(tag(b, 'ID'))
  const outline = tag(b, 'OutlineNumber')
  const resumo = tag(b, 'Summary') === '1'
  const inicio = (tag(b, 'Start') || '').slice(0, 10)
  const fim = (tag(b, 'Finish') || '').slice(0, 10)
  const durH = duracaoHoras(tag(b, 'Duration'))

  if (nivel <= 1) continue // raiz do projeto e "CONJUNTO JARDINS IMPERIAL"

  const nomeUp = nome.trim().toUpperCase()

  // Contêineres GRUPO 1/GRUPO 2: não viram tarefa; marcam o grupo de ataque
  if (nivel === 2 && nomeUp.startsWith('GRUPO')) {
    currentGrupo = 'Grupo ' + (nomeUp.match(/\d+/)?.[0] ?? '?')
    currentUnidade = null
    stack.length = 0
    continue
  }

  if (nivel === 2) {
    const u = unidadeDoBloco(nomeUp)
    if (!u) { erros.push(`Bloco nível 2 sem mapeamento de unidade: "${nome}"`); continue }
    currentUnidade = u
    currentGrupo = null
    stack.length = 0
  }

  // CASA NN (nível 3 dentro de GRUPO) → Sobrado NN, raiz da própria árvore
  if (nivel === 3 && currentGrupo && nomeUp.startsWith('CASA')) {
    const num = Number(nomeUp.match(/\d+/)?.[0])
    if (!SOBRADOS[num]) { erros.push(`Casa sem sobrado correspondente: "${nome}"`); continue }
    currentUnidade = SOBRADOS[num]
    stack.length = 0
  }

  if (!currentUnidade) { erros.push(`Tarefa sem unidade (fora de bloco mapeado): ${outline} "${nome}"`); continue }

  while (stack.length > 0 && stack[stack.length - 1].nivel >= nivel) stack.pop()
  const parent = stack.length > 0 ? stack[stack.length - 1].id : null

  const t = {
    id: randomUUID(), uid: Number(uid), nome: nome.trim(), nivel, ordem, outline,
    resumo, unidade: currentUnidade, grupo: currentGrupo, parent,
    inicio, fim, durH,
    preds: [],
  }

  // Predecessoras
  for (const pm of b.matchAll(/<PredecessorLink>([\s\S]*?)<\/PredecessorLink>/g)) {
    const pb = pm[1]
    const puid = tag(pb, 'PredecessorUID')
    const tipo = { 0: 'FF', 1: 'FS', 2: 'SF', 3: 'SS' }[tag(pb, 'Type')] || 'FS'
    const lag = Math.round(Number(tag(pb, 'LinkLag') || 0) / 10) // décimos de minuto → minutos
    if (puid !== null) t.preds.push({ uid: Number(puid), tipo, lag })
  }

  tarefas.push(t)
  porUid.set(t.uid, t)
  stack.push({ nivel, id: t.id })
}

if (erros.length > 0) {
  console.error('ERROS DE MAPEAMENTO — importação abortada:')
  for (const e of erros) console.error(' - ' + e)
  process.exit(1)
}

// Dependências apenas entre tarefas mantidas
let depsDescartadas = 0
const deps = []
for (const t of tarefas) {
  for (const p of t.preds) {
    if (porUid.has(p.uid)) deps.push({ tarefa: t.id, pred: porUid.get(p.uid).id, tipo: p.tipo, lag: p.lag })
    else depsDescartadas++
  }
}

// --- Geração do SQL (ASCII puro, unicode via E'\uXXXX') ---

function sqlStr(s) {
  if (s === null || s === undefined || s === '') return 'NULL'
  let out = ''
  let uni = false
  for (const ch of String(s)) {
    const code = ch.codePointAt(0)
    if (ch === "'") out += "''"
    else if (ch === '\\') { out += '\\\\'; uni = true }
    else if (code < 32) out += ' '
    else if (code > 126) { uni = true; out += '\\u' + code.toString(16).padStart(4, '0') }
    else out += ch
  }
  return (uni ? "E'" : "'") + out + "'"
}

const VERSAO_ID = randomUUID()
const linhas = []
linhas.push('-- Importacao do cronograma MS Project — Fase 2 — gerado por importar-cronograma.cjs')
linhas.push(`INSERT INTO cronograma_versoes (id, obra_id, versao, nome, arquivo, vigente, criado_por) VALUES ('${VERSAO_ID}', '${OBRA_ID}', 1, ${sqlStr('Baseline inicial (MS Project)')}, ${sqlStr(ARQUIVO.split('/').pop())}, true, '${ADMIN_ID}');`)

const LOTE = 200
for (let i = 0; i < tarefas.length; i += LOTE) {
  const vals = tarefas.slice(i, i + LOTE).map(t =>
    `('${t.id}','${OBRA_ID}','${t.unidade}',${t.parent ? `'${t.parent}'` : 'NULL'},${t.uid},${sqlStr(t.outline)},${t.nivel},${t.ordem},${sqlStr(t.nome)},${t.resumo},${sqlStr(t.grupo)},'${ADMIN_ID}')`
  )
  linhas.push(`INSERT INTO cronograma_tarefas (id, obra_id, unidade_id, parent_id, uid_project, outline_number, nivel, ordem, nome, resumo, grupo_ataque, criado_por) VALUES\n${vals.join(',\n')};`)
}

for (let i = 0; i < tarefas.length; i += LOTE) {
  const vals = tarefas.slice(i, i + LOTE).map(t =>
    `('${t.id}','${VERSAO_ID}','${t.inicio}','${t.fim}',${t.durH ?? 'NULL'})`
  )
  linhas.push(`INSERT INTO cronograma_previsto (tarefa_id, versao_id, inicio, fim, duracao_horas) VALUES\n${vals.join(',\n')};`)
}

for (let i = 0; i < deps.length; i += LOTE) {
  const vals = deps.slice(i, i + LOTE).map(d =>
    `('${d.tarefa}','${d.pred}','${d.tipo}',${d.lag})`
  )
  linhas.push(`INSERT INTO cronograma_dependencias (tarefa_id, predecessora_id, tipo, defasagem_min) VALUES\n${vals.join(',\n')};`)
}

fs.writeFileSync(SAIDA, linhas.join('\n\n'), 'ascii')

// --- Relatório de conferência ---

const porUnidade = new Map()
for (const t of tarefas) {
  const k = t.unidade
  porUnidade.set(k, (porUnidade.get(k) || 0) + 1)
}
const NOMES = { [PORTARIA]: 'Portaria', [AREA_COMUM]: 'Area Comum', [CANTEIRO]: 'Canteiro' }
for (const [n, id] of Object.entries(SOBRADOS)) NOMES[id] = 'Sobrado ' + String(n).padStart(2, '0')

const folhas = tarefas.filter(t => !t.resumo)
const datas = tarefas.flatMap(t => [t.inicio, t.fim]).filter(Boolean).sort()

console.log('=== Relatorio da importacao ===')
console.log(`Tarefas mantidas: ${tarefas.length} (${folhas.length} folhas) de ${rawTasks.length} no XML`)
console.log(`Dependencias: ${deps.length} (descartadas por referenciar tarefa fora do escopo: ${depsDescartadas})`)
console.log(`Datas extremas: ${datas[0]} a ${datas[datas.length - 1]}`)
console.log(`Folhas sem predecessora: ${folhas.filter(t => t.preds.length === 0).length}`)
console.log('Tarefas por unidade:')
for (const [id, qtd] of [...porUnidade.entries()].sort((a, b) => (NOMES[a[0]] || '').localeCompare(NOMES[b[0]] || ''))) {
  console.log(`  ${NOMES[id] || id}: ${qtd}`)
}
console.log(`SQL gerado em: ${SAIDA}`)
