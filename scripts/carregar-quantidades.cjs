// Carrega quant_total/und das tarefas-folha do cronograma (casas 01-13)
// a partir do orçamento importado na Fase 1, por regras explícitas de
// correspondência. Só aplica match seguro: 1 serviço (vincula servico_id)
// ou soma de serviços da MESMA unidade de medida (ex.: armação = soma dos
// kg das bitolas). O que for ambíguo fica pendente (preenchível na tela).
// Executar: node scripts/carregar-quantidades.cjs
// Saídas: scripts/quantidades_update.sql + scripts/depara_quantidades.csv

const fs = require('fs')

const ADMIN_ID = '39be78b9-9179-4917-a748-be8a186b5ea3' // Rodrigo (autor da definição)

// ---------- parser dos SQLs de importação (dados versionados no repo) ----------

function parseValues(sql, tabela) {
  const linhas = []
  const re = new RegExp(`INSERT INTO ${tabela} \\(([^)]+)\\) VALUES\\n([\\s\\S]*?);`, 'g')
  let m
  while ((m = re.exec(sql)) !== null) {
    const cols = m[1].split(',').map(c => c.trim())
    for (const lin of m[2].split('\n')) {
      const t = lin.trim().replace(/,$/, '')
      if (!t.startsWith('(')) continue
      linhas.push({ cols, raw: t.slice(1, -1) })
    }
  }
  return linhas.map(({ cols, raw }) => {
    const campos = []
    let i = 0
    while (i < raw.length) {
      if (raw[i] === ',') { i++; continue }
      if (raw.startsWith('NULL', i)) { campos.push(null); i += 4; continue }
      if (raw.startsWith("E'", i) || raw[i] === "'") {
        const ini = raw.indexOf("'", i) + 1
        let j = ini, s = ''
        while (j < raw.length) {
          if (raw[j] === "'" && raw[j + 1] === "'") { s += "'"; j += 2; continue }
          if (raw[j] === "'") break
          s += raw[j]; j++
        }
        s = s.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/\\\\/g, '\\')
        campos.push(s)
        i = j + 1
        continue
      }
      let j = i
      while (j < raw.length && raw[j] !== ',') j++
      const tok = raw.slice(i, j).trim()
      campos.push(tok === 'true' ? true : tok === 'false' ? false : tok === '' ? null : Number(tok))
      i = j
    }
    const obj = {}
    cols.forEach((c, k) => obj[c] = campos[k])
    return obj
  })
}

function norm(s) {
  return (s || '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/-?\s*casa\s*\d+/g, '')
    .replace(/[^a-z0-9\/ ]/g, ' ')
    .replace(/\s+/g, ' ').trim()
}
function normUnd(u) {
  const n = (u || '').toLowerCase().replace('²', '2').replace('³', '3').replace(/\./g, '').trim()
  if (n === 'un' || n === 'und' || n === 'unid') return 'un'
  return n
}

const orc = fs.readFileSync(__dirname + '/orcamento_import.sql', 'utf8')
const cro = fs.readFileSync(__dirname + '/cronograma_import.sql', 'utf8')
const etapas = parseValues(orc, 'etapas')
const servicos = parseValues(orc, 'servicos')
const tarefas = parseValues(cro, 'cronograma_tarefas')

const SOBRADOS = [
  'c8ebb246-d50f-441c-9b5b-cc7c1f180f1e', 'c7ad5dbd-8025-48aa-aaba-3b2c57bb18ef',
  'ae1a34e9-5831-4c1e-881e-214c60e81d61', '188b11d5-99ed-4778-a174-8157a567b5f7',
  '067d8841-6b4b-4b2f-8750-9877ed7333df', '743c98f1-9eb3-472c-a61e-07ed5fa6cc24',
  'f9ae3267-adda-4418-ba78-85d083a2ae2e', 'c14022b1-0a8e-42fb-b344-15ed3991568a',
  'e3eabe91-60e3-4cfd-9027-15b60339441d', '514cebfd-0b48-4a6d-8f0d-3952ac0d392e',
  '532f0cc6-792d-4263-b84e-6eae7fb19a76', '814a97aa-9da2-471b-bc1b-b4d01eec8ed7',
  'f5bafe42-4332-47c0-9784-30db93b2b118',
]
const NOME_SOBRADO = Object.fromEntries(SOBRADOS.map((id, i) => [id, `Sobrado ${String(i + 1).padStart(2, '0')}`]))

// ---------- regras de correspondência (casas) ----------
// pav: contexto do pavimento extraído dos ancestrais da tarefa.
// etapa: regex sobre nome da etapa do orçamento; grupo: regex sobre grupo;
// serv: regex sobre nome do serviço; agg: 'one' (1 linha, vincula servico_id)
// ou 'sum' (soma linhas da mesma unidade de medida).
const ETAPA_POR_PAV = { terreo: /^pavimento terreo$/, superior: /^pavimento superior$/, platibanda: /^pavimento platibanda$/ }

const REGRAS = [
  // — infraestrutura —
  { nome: /^escavacao/, chain: /estacas/, etapa: ETAPA_POR_PAV.terreo, grupo: /^fundacao$/, serv: /escavacao de estacas/, agg: 'one' },
  { nome: /^escavacao/, chain: /blocos/, etapa: ETAPA_POR_PAV.terreo, grupo: /^fundacao$/, serv: /escavacao manual de vala/, agg: 'one' },
  { nome: /^reaterro/, chain: /blocos/, etapa: ETAPA_POR_PAV.terreo, grupo: /^fundacao$/, serv: /reaterro de vala/, agg: 'one' },
  { nome: /^concretagem baldrame/, chain: /viga baldrame/, etapa: ETAPA_POR_PAV.terreo, grupo: /^viga baldrame$/, serv: /^concretagem/, agg: 'one' },
  { nome: /^desforma baldrame/, chain: /viga baldrame/, etapa: ETAPA_POR_PAV.terreo, grupo: /^viga baldrame$/, serv: /montagem e desmontagem de forma/, agg: 'one' },
  { nome: /^impermeabilizacao com tinta asfaltica/, chain: /viga baldrame/, etapa: /^impermeabilizacao$/, grupo: /viga baldrame/, serv: /tinta asfaltica/, agg: 'one' },
  // — superestrutura (térreo/superior) —
  { nome: /armacao/, chain: /pilares/, pav: ['terreo', 'superior'], grupo: /^pilares$/, serv: /^armacao corte e dobra/, agg: 'sum' },
  { nome: /^forma/, chain: /pilares/, pav: ['terreo', 'superior'], grupo: /^pilares$/, serv: /montagem e desmontagem de forma/, agg: 'one' },
  { nome: /^concretagem/, chain: /pilares/, pav: ['terreo', 'superior'], grupo: /^pilares$/, serv: /^concretagem/, agg: 'one' },
  { nome: /armacao/, chain: /vigas/, pav: ['terreo', 'superior'], grupo: /^vigas superiores$/, serv: /^armacao corte e dobra/, agg: 'sum' },
  { nome: /^forma/, chain: /vigas/, pav: ['terreo', 'superior'], grupo: /^vigas superiores$/, serv: /montagem e desmontagem de forma/, agg: 'one' },
  { nome: /^montagem e escoramento/, chain: /lajes/, pav: ['terreo', 'superior'], grupo: /^laje trelicada$/, serv: /^laje trelicada/, agg: 'one' },
  { nome: /^retirada do escoramento/, chain: /lajes/, pav: ['terreo', 'superior'], grupo: /^laje trelicada$/, serv: /^escoramento para laje/, agg: 'one' },
  { nome: /^armacao/, chain: /lajes/, pav: ['terreo', 'superior'], grupo: /^laje macica$/, serv: /^armacao corte e dobra/, agg: 'sum' },
  { nome: /^concretagem vigas e laje|^concretagem - vigas e laje/, chain: /lajes/, pav: ['terreo', 'superior'], grupo: /^(vigas superiores|laje macica|laje trelicada)$/, serv: /^concretagem/, agg: 'sum' },
  { nome: /^alvenaria de vedacao/, pav: ['terreo', 'superior'], grupo: /^paredes e paineis$/, serv: /^alvenaria de vedacao/, agg: 'one' },
  // — revestimentos argamassados —
  { nome: /^chapisco interno/, pav: ['terreo', 'superior', 'platibanda'], grupo: /^revestimentos argamassados internos$/, serv: /^chapisco interno/, agg: 'one' },
  { nome: /^reboco interno/, pav: ['terreo', 'superior', 'platibanda'], grupo: /^revestimentos argamassados internos$/, serv: /^reboco interno/, agg: 'one' },
  { nome: /^requadro de vaos/, pav: ['terreo', 'superior'], grupo: /^revestimentos argamassados internos$/, serv: /^requadro de vaos/, agg: 'one' },
  { nome: /^requadro/, pav: ['platibanda'], grupo: /^revestimentos argamassados internos$/, serv: /^requadro de platibanda/, agg: 'one' },
  { nome: /^regularizacao com argamassa do piso(?! externo)/, notNome: /externo/, pav: ['terreo', 'superior'], grupo: /^revestimentos argamassados internos$/, serv: /^contrapiso/, agg: 'one' },
  { nome: /^lastro de concreto magro do piso/, notNome: /externo/, pav: ['terreo'], grupo: /^revestimentos argamassados internos$/, serv: /^lastro de concreto/, agg: 'one' },
  { nome: /^chapisco externo/, etapa: /^pavimento (terreo|superior)$/, grupo: /^revestimentos argamassados externos$/, serv: /^chapisco externo/, agg: 'sum' },
  { nome: /^reboco externo/, etapa: /^pavimento (terreo|superior)$/, grupo: /^revestimentos argamassados externos$/, serv: /^reboco externo/, agg: 'sum' },
  { nome: /^requadro de vigas e lajes/, etapa: /^pavimento (terreo|superior)$/, grupo: /^revestimentos argamassados externos$/, serv: /^requadro de estruturas/, agg: 'sum' },
  { nome: /^lastro de concreto magro do piso externo/, etapa: ETAPA_POR_PAV.terreo, grupo: /^revestimentos argamassados externos$/, serv: /^lastro de concreto/, agg: 'one' },
  // — instalações e impermeabilização pontuais —
  { nome: /^instalacoes de gas/, etapa: /^instalacoes$/, grupo: /^instalacoes de gas$/, serv: /ponto de gas/, agg: 'one' },
  // — cobertura —
  { nome: /^montagem estrutura metalica/, etapa: /^cobertura$/, grupo: /^telhado$/, serv: /^fornecimento de estrutura para telhado/, agg: 'one' },
  { nome: /^telhamento/, etapa: /^cobertura$/, grupo: /^telhado$/, serv: /^mao de obra para execucao de cobertura/, agg: 'one' },
  { nome: /^calha/, etapa: /^cobertura$/, grupo: /^calhas$/, serv: /calha/, agg: 'one' },
  { nome: /^rufo/, etapa: /^cobertura$/, grupo: /^rufos$/, serv: /rufos/, agg: 'one' },
  { nome: /^pingadeiras/, etapa: /^cobertura$/, grupo: /^pingadeiras$/, serv: /pingadeira/, agg: 'one' },
  // — acabamentos —
  { nome: /^porcelanato de piso \+ rodape|^porcelanato de piso rodape/, pav: ['terreo', 'superior'], grupo: /porcelanatos internos de piso/, serv: /porcelanato de piso interno/, agg: 'one' },
  { nome: /^porcelanato de piso externo/, etapa: ETAPA_POR_PAV.terreo, grupo: /porcelanatos externos de piso/, serv: /porcelanato de piso externo/, agg: 'one' },
  { nome: /^porcelanato de parede e piso/, pav: ['superior'], grupo: /porcelanatos internos de paredes/, serv: /porcelanato de parede/, agg: 'one' },
  { nome: /^forro de gesso/, pav: ['terreo', 'superior'], grupo: /^forro$/, serv: /^forro de gesso/, agg: 'one' },
  { nome: /^emassamento|^pintura final/, pav: ['terreo', 'superior'], grupo: /^pintura interna de paredes$/, serv: /./, agg: 'sum' },
  { nome: /^peitoris/, pav: ['terreo', 'superior'], grupo: /^peitoris$/, serv: /^instalacao de soleiras e peitoris/, agg: 'one' },
  { nome: /^soleiras/, pav: ['terreo', 'superior'], grupo: /^soleiras$/, serv: /^instalacao de soleiras e peitoris/, agg: 'one' },
  { nome: /^bancadas/, pav: ['terreo', 'superior'], grupo: /^bancadas$/, serv: /^instalacao de bancadas/, agg: 'one' },
  { nome: /^esquadrias de aluminio/, pav: ['terreo', 'superior'], grupo: /esquadrias de alum.nio e vidro|esquadrias de aluminio e vidro/, serv: /esquadrias de aluminio/, agg: 'one' },
  { nome: /^portas/, pav: ['terreo', 'superior'], grupo: /esquadrias de (madeira\/)?pvc/, serv: /porta de pvc/, agg: 'one' },
  { nome: /^box/, pav: ['superior'], grupo: /^box$/, serv: /box de vidro/, agg: 'one' },
  // — fachada e diversos —
  { nome: /^pintura externa/, etapa: /^pavimento (terreo|superior|platibanda)$/, grupo: /^pintura externa parede$/, serv: /./, agg: 'sum' },
  { nome: /^churrasqueira/, etapa: /^diversos$/, serv: /churrasqueira/, agg: 'one' },
]

// Pavimento vem SÓ do caminho de ancestrais — o nome da tarefa engana
// ("Vigas Superiores (Pav. Térreo)", "laje superior" etc.).
function pavDaTarefa(chainNorm, nomeNorm) {
  if (/barrilete/.test(chainNorm)) return 'barrilete'
  if (/platibanda/.test(chainNorm)) return 'platibanda'
  if (/pavimento terreo|pav terreo|> terreo| terreo$|terreo /.test(chainNorm)) return 'terreo'
  if (/pavimento superior|pav superior|> superior| superior$|superior /.test(chainNorm)) return 'superior'
  if (/cobertura/.test(chainNorm)) return 'cobertura'
  // fallback: sufixo explícito no nome da tarefa (ex.: "Peitoris - Térreo")
  if (/barrilete/.test(nomeNorm)) return 'barrilete'
  if (/platibanda/.test(nomeNorm)) return 'platibanda'
  if (/terreo/.test(nomeNorm) && !/superior/.test(nomeNorm)) return 'terreo'
  if (/superior/.test(nomeNorm) && !/superiores/.test(nomeNorm) && !/terreo/.test(nomeNorm)) return 'superior'
  return null
}

// ---------- execução ----------

const porId = new Map(tarefas.map(t => [t.id, t]))
const linhasCsv = ['unidade;tarefa;caminho;status;quant_total;und;fonte']
const updates = []   // {id, quant, und, servicoId}
let aplicadas = 0, pendentes = 0

for (const unidadeId of SOBRADOS) {
  const etapasU = etapas.filter(e => e.unidade_id === unidadeId)
  const etapaIdSet = new Set(etapasU.map(e => e.id))
  const etapaPorId = new Map(etapasU.map(e => [e.id, e]))
  const servU = servicos.filter(s => etapaIdSet.has(s.etapa_id))
    .map(s => ({ ...s, etapaNome: norm(etapaPorId.get(s.etapa_id).nome), grupoNome: norm(s.grupo), nomeNorm: norm(s.nome) }))

  const tarefasU = tarefas.filter(t => t.unidade_id === unidadeId)
  const folhas = tarefasU.filter(t => t.resumo === false)

  for (const t of folhas) {
    const chain = []
    let p = t.parent_id ? porId.get(t.parent_id) : null
    while (p) { chain.unshift(p.nome); p = p.parent_id ? porId.get(p.parent_id) : null }
    const chainNorm = norm(chain.join(' > '))
    const nomeNorm = norm(t.nome)
    const pav = pavDaTarefa(chainNorm, nomeNorm)

    let resultado = null
    for (const r of REGRAS) {
      if (!r.nome.test(nomeNorm)) continue
      if (r.notNome && r.notNome.test(nomeNorm)) continue
      if (r.chain && !r.chain.test(chainNorm)) continue
      if (r.pav && (!pav || !r.pav.includes(pav))) continue
      const etapaRe = r.etapa || (pav && ETAPA_POR_PAV[pav])
      if (!etapaRe) continue
      const rows = servU.filter(s =>
        etapaRe.test(s.etapaNome) &&
        (!r.grupo || r.grupo.test(s.grupoNome)) &&
        r.serv.test(s.nomeNorm) &&
        s.quant !== null && s.quant > 0
      )
      if (rows.length === 0) continue
      if (r.agg === 'one') {
        if (rows.length !== 1) continue // ambíguo → tenta próxima regra / pendente
        resultado = { quant: rows[0].quant, und: rows[0].und, servicoId: rows[0].id, fonte: rows[0].nome }
      } else {
        const unds = new Set(rows.map(x => normUnd(x.und)))
        if (unds.size !== 1) continue // unidades mistas → não soma
        const soma = rows.reduce((a, x) => a + x.quant, 0)
        resultado = {
          quant: Math.round(soma * 10000) / 10000, und: rows[0].und, servicoId: null,
          fonte: rows.length === 1 ? rows[0].nome : `soma de ${rows.length} itens (${rows.map(x => x.codigo).join(', ')})`,
        }
      }
      break
    }

    const nomeU = NOME_SOBRADO[unidadeId]
    if (resultado) {
      aplicadas++
      updates.push({ id: t.id, quant: resultado.quant, und: resultado.und, servicoId: resultado.servicoId })
      linhasCsv.push(`${nomeU};${t.nome.replace(/;/g, ',')};${chain.join(' > ').replace(/;/g, ',')};aplicado;${String(resultado.quant).replace('.', ',')};${resultado.und};${resultado.fonte.replace(/;/g, ',')}`)
    } else {
      pendentes++
      linhasCsv.push(`${nomeU};${t.nome.replace(/;/g, ',')};${chain.join(' > ').replace(/;/g, ',')};pendente;;;`)
    }
  }
}

// ---------- SQL ----------

function esc(s) {
  let out = ''
  let uni = false
  for (const ch of String(s)) {
    const code = ch.codePointAt(0)
    if (ch === "'") out += "''"
    else if (code > 126) { uni = true; out += '\\u' + code.toString(16).padStart(4, '0') }
    else out += ch
  }
  return (uni ? "E'" : "'") + out + "'"
}

const sqlLinhas = ['-- Quantidades totais das tarefas (casas) a partir do orcamento — gerado por carregar-quantidades.cjs']
const LOTE = 300
for (let i = 0; i < updates.length; i += LOTE) {
  const vals = updates.slice(i, i + LOTE).map(u =>
    `('${u.id}'::uuid,${u.quant},${esc(u.und)},${u.servicoId ? `'${u.servicoId}'::uuid` : 'NULL::uuid'})`
  )
  sqlLinhas.push(`UPDATE cronograma_tarefas t SET
  quant_total = v.quant, und = v.und, servico_id = v.servico_id,
  quant_definida_por = '${ADMIN_ID}', quant_definida_em = now()
FROM (VALUES\n${vals.join(',\n')}\n) AS v(id, quant, und, servico_id)
WHERE t.id = v.id;`)
}

fs.writeFileSync(__dirname + '/quantidades_update.sql', sqlLinhas.join('\n\n'), 'ascii')
fs.writeFileSync(__dirname + '/depara_quantidades.csv', '﻿' + linhasCsv.join('\n'), 'utf8')

console.log('=== De-para orcamento -> cronograma (casas 01-13) ===')
console.log(`Aplicadas: ${aplicadas} tarefas (${Math.round(aplicadas / (aplicadas + pendentes) * 100)}%)`)
console.log(`Pendentes: ${pendentes} (sem correspondencia segura — preencher na tela na 1a medicao)`)
console.log(`Com vinculo servico_id (1:1): ${updates.filter(u => u.servicoId).length}`)
console.log('SQL: scripts/quantidades_update.sql | Conferencia: scripts/depara_quantidades.csv')
