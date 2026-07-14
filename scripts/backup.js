#!/usr/bin/env node
// Backup semanal: dump do banco (schema public) + todos os buckets do Storage,
// compactados num .zip e enviados pro Google Drive via conta de serviço.
// Rodado pelo workflow .github/workflows/backup-semanal.yml — nunca rodar
// manualmente contra produção sem entender que ele lê o banco inteiro e todos
// os buckets (não escreve nada no Supabase).
import { execFileSync } from 'node:child_process'
import { createWriteStream, createReadStream, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import archiver from 'archiver'
import { createClient } from '@supabase/supabase-js'
import { google } from 'googleapis'

const {
  SUPABASE_DB_URL,
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  GOOGLE_SERVICE_ACCOUNT_JSON,
  GOOGLE_DRIVE_FOLDER_ID,
} = process.env

function exigir(nome, valor) {
  if (!valor) throw new Error(`Variável de ambiente ausente: ${nome}`)
  return valor
}

async function baixarPasta(supabase, bucket, caminhoRemoto, dirLocal) {
  const { data: itens, error } = await supabase.storage.from(bucket).list(caminhoRemoto, { limit: 1000 })
  if (error) throw new Error(`Falha ao listar ${bucket}/${caminhoRemoto}: ${error.message}`)

  mkdirSync(dirLocal, { recursive: true })
  for (const item of itens ?? []) {
    const caminhoItemRemoto = caminhoRemoto ? `${caminhoRemoto}/${item.name}` : item.name
    if (item.id === null) {
      // pasta (sem id de arquivo) — desce recursivamente
      await baixarPasta(supabase, bucket, caminhoItemRemoto, join(dirLocal, item.name))
    } else {
      const { data: arquivo, error: eDownload } = await supabase.storage.from(bucket).download(caminhoItemRemoto)
      if (eDownload) throw new Error(`Falha ao baixar ${bucket}/${caminhoItemRemoto}: ${eDownload.message}`)
      const buffer = Buffer.from(await arquivo.arrayBuffer())
      writeFileSync(join(dirLocal, item.name), buffer)
    }
  }
}

async function baixarTodosBuckets(supabase, dirDestino) {
  const { data: buckets, error } = await supabase.storage.listBuckets()
  if (error) throw new Error(`Falha ao listar buckets: ${error.message}`)
  for (const bucket of buckets) {
    await baixarPasta(supabase, bucket.name, '', join(dirDestino, bucket.name))
  }
}

function compactar(dirOrigem, caminhoZip) {
  return new Promise((resolve, reject) => {
    const output = createWriteStream(caminhoZip)
    const archive = archiver('zip', { zlib: { level: 9 } })
    output.on('close', resolve)
    archive.on('error', reject)
    archive.pipe(output)
    archive.directory(dirOrigem, false)
    archive.finalize()
  })
}

async function enviarParaDrive(caminhoArquivo, nomeArquivo) {
  const credenciais = JSON.parse(GOOGLE_SERVICE_ACCOUNT_JSON)
  const auth = new google.auth.GoogleAuth({
    credentials: credenciais,
    scopes: ['https://www.googleapis.com/auth/drive'],
  })
  const drive = google.drive({ version: 'v3', auth })
  await drive.files.create({
    requestBody: { name: nomeArquivo, parents: [GOOGLE_DRIVE_FOLDER_ID] },
    media: { mimeType: 'application/zip', body: createReadStream(caminhoArquivo) },
  })
}

async function main() {
  exigir('SUPABASE_DB_URL', SUPABASE_DB_URL)
  exigir('SUPABASE_URL', SUPABASE_URL)
  exigir('SUPABASE_SERVICE_ROLE_KEY', SUPABASE_SERVICE_ROLE_KEY)
  exigir('GOOGLE_SERVICE_ACCOUNT_JSON', GOOGLE_SERVICE_ACCOUNT_JSON)
  exigir('GOOGLE_DRIVE_FOLDER_ID', GOOGLE_DRIVE_FOLDER_ID)

  const dataHoje = new Date().toISOString().slice(0, 10)
  const dirTemp = join(process.cwd(), 'backup-temp')
  mkdirSync(dirTemp, { recursive: true })

  console.log('1/4 — dump do banco (schema public)…')
  try {
    execFileSync('pg_dump', [
      SUPABASE_DB_URL,
      '--schema=public',
      '--no-owner',
      '--no-privileges',
      '--file', join(dirTemp, 'banco.sql'),
    ], { stdio: 'inherit' })
  } catch {
    // Nunca referenciar err.message/err.cmd/err.args aqui: o execFileSync do Node
    // inclui a SUPABASE_DB_URL completa (com senha em texto puro) no Error lançado
    // quando o processo filho sai com código != 0. O stderr do próprio pg_dump
    // (já impresso acima via stdio: 'inherit') não inclui a senha.
    throw new Error('pg_dump falhou — ver mensagem de erro do Postgres acima (stderr do próprio pg_dump não inclui a senha).')
  }

  console.log('2/4 — baixando arquivos do Storage…')
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  await baixarTodosBuckets(supabase, join(dirTemp, 'storage'))

  console.log('3/4 — compactando…')
  const nomeZip = `backup-rt-gestao-obra-${dataHoje}.zip`
  const caminhoZip = join(process.cwd(), nomeZip)
  await compactar(dirTemp, caminhoZip)

  console.log('4/4 — enviando pro Google Drive…')
  await enviarParaDrive(caminhoZip, nomeZip)

  rmSync(dirTemp, { recursive: true, force: true })
  rmSync(caminhoZip, { force: true })
  console.log(`Backup concluído: ${nomeZip}`)
}

main().catch(err => {
  console.error('Backup falhou:', err.message)
  process.exit(1)
})
