// Enviador de SQL para a edge function temporaria exec-import-sql.
// Divide o arquivo em lotes de statements e envia em sequencia.
// Executar: node scripts/enviar-sql.cjs <arquivo.sql> <segredo>
// Requer .env com VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY.

const fs = require('fs')
const path = require('path')

const arquivo = process.argv[2]
const segredo = process.argv[3]
if (!arquivo || !segredo) {
  console.error('Uso: node scripts/enviar-sql.cjs <arquivo.sql> <segredo>')
  process.exit(1)
}

const env = Object.fromEntries(
  fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8')
    .split(/\r?\n/).filter(l => l.includes('='))
    .map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])
)
const URL_FN = env.VITE_SUPABASE_URL + '/functions/v1/exec-import-sql'
const ANON = env.VITE_SUPABASE_ANON_KEY

// Statements separados por linha em branco (formato dos geradores de import)
const statements = fs.readFileSync(arquivo, 'utf8').split('\n\n').filter(s => s.trim() && !s.trim().startsWith('--'))

const MAX_CHARS = 120_000 // ~120 KB por requisicao

async function main() {
  const lotes = []
  let atual = []
  let tam = 0
  for (const s of statements) {
    if (tam + s.length > MAX_CHARS && atual.length > 0) { lotes.push(atual); atual = []; tam = 0 }
    atual.push(s)
    tam += s.length
  }
  if (atual.length > 0) lotes.push(atual)

  console.log(`${statements.length} statements em ${lotes.length} lotes`)

  for (let i = 0; i < lotes.length; i++) {
    const sql = lotes[i].join('\n')
    const r = await fetch(URL_FN, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + ANON,
        'x-import-secret': segredo,
      },
      body: JSON.stringify({ sql }),
    })
    const body = await r.text()
    if (!r.ok) {
      console.error(`Lote ${i + 1}/${lotes.length} FALHOU (${r.status}): ${body}`)
      process.exit(1)
    }
    console.log(`Lote ${i + 1}/${lotes.length} ok`)
  }
  console.log('Envio concluido.')
}

main().catch(e => { console.error(e); process.exit(1) })
