// Converte fvs_15_prioritarias_qualidade_obras.md nos modelos de FVS do app.
// - Renumera conforme a sequência real da obra (cobertura antes dos acabamentos)
// - Injeta as 2 fichas novas: Reboco/Emboço e Forro de Gesso
// Saída: scripts/fvs_seed.sql
// Uso: node scripts/importar-fvs.cjs

const fs = require('fs')
const path = require('path')

const MD = fs.readFileSync(path.join(__dirname, '..', 'fvs_15_prioritarias_qualidade_obras.md'), 'utf8')

// Renumeração aprovada pelo Rodrigo em 09/07/2026 (nº antigo do arquivo → novo código/ordem)
const RENUM = {
  '001': { codigo: 'FVS-001', ordem: 1 },
  '002': { codigo: 'FVS-002', ordem: 2 },
  '003': { codigo: 'FVS-003', ordem: 3 },
  '004': { codigo: 'FVS-004', ordem: 4 },
  '005': { codigo: 'FVS-005', ordem: 5 },
  '006': { codigo: 'FVS-006', ordem: 6 },
  '007': { codigo: 'FVS-007', ordem: 7 },
  // FVS-008 = Reboco (nova)
  '008': { codigo: 'FVS-009', ordem: 9 },   // Impermeabilização
  '012': { codigo: 'FVS-010', ordem: 10 },  // Cobertura (movida: cronograma real)
  '009': { codigo: 'FVS-011', ordem: 11 },  // Contrapiso
  '010': { codigo: 'FVS-012', ordem: 12 },  // Cerâmico
  // FVS-013 = Forro de gesso (nova)
  '011': { codigo: 'FVS-014', ordem: 14 },  // Esquadrias
  '013': { codigo: 'FVS-015', ordem: 15 },  // Pintura
  '014': { codigo: 'FVS-016', ordem: 16 },  // Louças e metais
  '015': { codigo: 'FVS-017', ordem: 17 },  // Entrega final
}

// Nomes de seção mais curtos para a tela do celular
function nomeSecao(titulo) {
  const t = titulo.trim()
  if (/^Pré-requisitos/i.test(t)) return 'Pré-requisitos'
  if (/^Checklist de execução/i.test(t)) return 'Execução'
  const m = t.match(/^Checklist\s*(?:—|-)?\s*(.+)$/i)
  if (m) return m[1].charAt(0).toUpperCase() + m[1].slice(1)
  return t
}

function parseFvs(md) {
  const blocos = md.split(/^# FVS-/m).slice(1)
  const fichas = []
  for (const bloco of blocos) {
    const cab = bloco.match(/^(\d{3}) — (.+)$/m)
    if (!cab) continue
    const numeroAntigo = cab[1]
    const nome = cab[2].trim()

    const secTexto = (titulo) => {
      const re = new RegExp(`## ${titulo}\\n+([\\s\\S]*?)(?=\\n## |\\n# |$)`)
      const m = bloco.match(re)
      if (!m) return null
      return m[1].replace(/\|[\s\S]*/g, '').replace(/-{3,}/g, '').trim().replace(/\n+/g, ' ').trim() || null
    }

    const objetivo = secTexto('Objetivo')
    const normas = secTexto('Normas e documentos de referência')
    let criterios = secTexto('Critérios de aceitação')
    const registros = secTexto('Registros obrigatórios')
    if (registros) criterios = `${criterios ?? ''}\nRegistros obrigatórios: ${registros}`.trim()

    // seções com tabela de itens
    const itens = []
    const reSec = /## ((?:Pré-requisitos|Checklist)[^\n]*)\n+((?:\|[^\n]*\n)+)/g
    let m
    while ((m = reSec.exec(bloco)) !== null) {
      const secao = nomeSecao(m[1])
      const linhas = m[2].trim().split('\n').slice(2) // pula cabeçalho e separador
      let ordem = 0
      for (const linha of linhas) {
        const cols = linha.split('|').map(c => c.trim())
        // | n | texto | C | NC | NA |  → cols[1]=n, cols[2]=texto
        if (cols.length >= 3 && cols[2]) {
          itens.push({ secao, ordem: ++ordem, texto: cols[2] })
        }
      }
    }

    fichas.push({ numeroAntigo, nome, objetivo, normas, criterios, itens })
  }
  return fichas
}

// ── Fichas novas (autoria: Claude/RT com base em NBR 13749/7200 e NBR 15758-2) ──
const NOVAS = [
  {
    codigo: 'FVS-008', ordem: 8, nome: 'Reboco / emboço',
    objetivo: 'Verificar chapisco, taliscamento, prumo, planeza, espessura, aderência e cura dos revestimentos argamassados internos e externos.',
    normas: 'Projeto arquitetônico, memorial, NBR 13749 (especificação), NBR 7200 (execução), NBR 15575.',
    criterios: 'Planeza: desvio máximo 3 mm em régua de 2 m (NBR 13749). Sem som cavo, fissuras, descolamento ou desaprumo perceptível. Requadros de vãos em esquadro. Não revestir sobre instalações não testadas.',
    itens: [
      { secao: 'Pré-requisitos', ordem: 1, texto: 'Alvenaria concluída e encunhada' },
      { secao: 'Pré-requisitos', ordem: 2, texto: 'Instalações embutidas testadas e liberadas (estanqueidade aprovada)' },
      { secao: 'Pré-requisitos', ordem: 3, texto: 'Rasgos e passagens fechados com argamassa' },
      { secao: 'Pré-requisitos', ordem: 4, texto: 'Contramarcos e tacos instalados quando previstos' },
      { secao: 'Pré-requisitos', ordem: 5, texto: 'Superfície limpa, sem poeira, óleo ou desmoldante' },
      { secao: 'Execução', ordem: 1, texto: 'Chapisco aplicado com cobertura uniforme e boa aderência' },
      { secao: 'Execução', ordem: 2, texto: 'Cura do chapisco respeitada antes do emboço' },
      { secao: 'Execução', ordem: 3, texto: 'Taliscas e mestras executadas conforme prumo e espessura definida' },
      { secao: 'Execução', ordem: 4, texto: 'Espessura do revestimento dentro dos limites (interno 5–20 mm; externo conforme projeto)', criterio: 'NBR 13749' },
      { secao: 'Execução', ordem: 5, texto: 'Prumo e planeza conferidos com régua de 2 m', criterio: 'Desvio ≤ 3 mm / 2 m' },
      { secao: 'Execução', ordem: 6, texto: 'Cantos e arestas alinhados e protegidos' },
      { secao: 'Execução', ordem: 7, texto: 'Requadros de vãos executados em esquadro' },
      { secao: 'Execução', ordem: 8, texto: 'Argamassa com traço e preparo conforme procedimento' },
      { secao: 'Execução', ordem: 9, texto: 'Acabamento conforme previsto (desempenado, camurçado ou sarrafeado)' },
      { secao: 'Execução', ordem: 10, texto: 'Juntas de trabalho executadas quando previstas (externo)' },
      { secao: 'Execução', ordem: 11, texto: 'Cura úmida realizada em áreas externas quando necessário' },
      { secao: 'Execução', ordem: 12, texto: 'Sem fissuras, descolamento ou som cavo após cura' },
    ],
  },
  {
    codigo: 'FVS-013', ordem: 13, nome: 'Forro de gesso',
    objetivo: 'Verificar estrutura de fixação, nivelamento, juntas, recortes, alçapões e acabamento de forros de gesso (placas, drywall ou moldado).',
    normas: 'Projeto arquitetônico, projeto de forro, NBR 15758-2 (sistemas em chapas de gesso — forros), manual do fabricante, NBR 15575.',
    criterios: 'Forro nivelado com desnível máximo de 3 mm em régua de 2 m. Emendas invisíveis após preparo. Recortes firmes e nas posições corretas. Acessos (alçapões) preservados. Sem manchas de umidade.',
    itens: [
      { secao: 'Pré-requisitos', ordem: 1, texto: 'Cobertura/laje estanque, sem infiltração sobre o forro' },
      { secao: 'Pré-requisitos', ordem: 2, texto: 'Instalações elétricas e hidráulicas sobre o forro concluídas e testadas' },
      { secao: 'Pré-requisitos', ordem: 3, texto: 'Pontos de luminárias, difusores e dutos definidos' },
      { secao: 'Pré-requisitos', ordem: 4, texto: 'Ambientes fechados (esquadrias instaladas ou vãos protegidos)' },
      { secao: 'Pré-requisitos', ordem: 5, texto: 'Placas e perfis conferidos, sem umidade ou avaria' },
      { secao: 'Execução', ordem: 1, texto: 'Nível do forro marcado conforme projeto (pé-direito)' },
      { secao: 'Execução', ordem: 2, texto: 'Estrutura/tirantes fixados com espaçamento conforme fabricante' },
      { secao: 'Execução', ordem: 3, texto: 'Fixações na laje/estrutura firmes (nunca em instalações)' },
      { secao: 'Execução', ordem: 4, texto: 'Placas alinhadas e niveladas, sem degraus entre placas', criterio: 'Desnível ≤ 3 mm / 2 m' },
      { secao: 'Execução', ordem: 5, texto: 'Recortes para luminárias e difusores nas posições corretas' },
      { secao: 'Execução', ordem: 6, texto: 'Alçapões de acesso previstos e executados' },
      { secao: 'Execução', ordem: 7, texto: 'Juntas tratadas com fita e massa nas demãos adequadas' },
      { secao: 'Execução', ordem: 8, texto: 'Tabicas, molduras e negativos executados conforme projeto' },
      { secao: 'Execução', ordem: 9, texto: 'Lixamento final sem marcas de emenda aparentes' },
      { secao: 'Execução', ordem: 10, texto: 'Superfície pronta para pintura, sem manchas de umidade' },
    ],
  },
]

// ── montar lista final ──
const parseadas = parseFvs(MD)
const fichas = []
for (const f of parseadas) {
  const alvo = RENUM[f.numeroAntigo]
  if (!alvo) { console.error(`AVISO: FVS-${f.numeroAntigo} sem renumeração — ignorada`); continue }
  fichas.push({ codigo: alvo.codigo, ordem: alvo.ordem, nome: f.nome, objetivo: f.objetivo, normas: f.normas, criterios: f.criterios, itens: f.itens })
}
fichas.push(...NOVAS)
fichas.sort((a, b) => a.ordem - b.ordem)

// ── gerar SQL ──
const esc = (s) => s == null ? 'NULL' : `'${String(s).replace(/'/g, "''")}'`
const ADMIN = `(SELECT id FROM perfis_usuario WHERE email = 'rodrigoteles.eng@gmail.com')`

let sql = `-- Seed dos modelos de FVS — gerado por scripts/importar-fvs.cjs em ${new Date().toISOString().slice(0, 10)}\n`
sql += `-- Fonte: fvs_15_prioritarias_qualidade_obras.md (15 fichas) + FVS-008 Reboco e FVS-013 Forro de gesso (novas)\n\n`

for (const f of fichas) {
  sql += `INSERT INTO fvs_modelos (codigo, nome, objetivo, normas, criterios_aceitacao, ordem, criado_por)\n`
  sql += `VALUES (${esc(f.codigo)}, ${esc(f.nome)}, ${esc(f.objetivo)}, ${esc(f.normas)}, ${esc(f.criterios)}, ${f.ordem}, ${ADMIN});\n\n`

  const values = f.itens.map(i =>
    `  ((SELECT id FROM fvs_modelos WHERE codigo = ${esc(f.codigo)}), ${esc(i.secao)}, ${i.ordem}, ${esc(i.texto)}, ${esc(i.criterio ?? null)})`
  ).join(',\n')
  sql += `INSERT INTO fvs_modelo_itens (modelo_id, secao, ordem, texto, criterio) VALUES\n${values};\n\n`
}

fs.writeFileSync(path.join(__dirname, 'fvs_seed.sql'), sql, 'utf8')

// relatório
console.log('Fichas geradas:')
for (const f of fichas) {
  const porSecao = {}
  f.itens.forEach(i => { porSecao[i.secao] = (porSecao[i.secao] ?? 0) + 1 })
  console.log(`  ${f.codigo} (ordem ${String(f.ordem).padStart(2)}) — ${f.nome} — ${f.itens.length} itens [${Object.entries(porSecao).map(([s, n]) => `${s}: ${n}`).join(', ')}]`)
}
console.log(`\nTotal: ${fichas.length} modelos, ${fichas.reduce((s, f) => s + f.itens.length, 0)} itens`)
console.log('SQL: scripts/fvs_seed.sql')
