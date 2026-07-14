# Backup Semanal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Workflow do GitHub Actions rodando toda semana (domingo de madrugada), fazendo backup completo do banco (schema `public`) + todos os buckets do Storage, empacotando e enviando pro Google Drive via conta de serviço.

**Architecture:** Script Node.js (`scripts/backup.js`) orquestra 4 passos — `pg_dump` do schema `public` (conexão direta, não pooler), download recursivo de todos os buckets do Storage via `@supabase/supabase-js` com a chave `service_role`, compactação num único `.zip` via `archiver`, upload pro Drive via `googleapis` autenticado com uma conta de serviço do Google Cloud. `.github/workflows/backup-semanal.yml` roda esse script com cron semanal + `workflow_dispatch` (pra testar sob demanda), passando 5 segredos do GitHub Actions. Um guia de setup (`docs/backup-setup.md`) documenta os 4 passos manuais que só o Rodrigo pode fazer (contas dele).

**Tech Stack:** Node.js (ESM, já `"type": "module"` no `package.json`), `@supabase/supabase-js` (já é dependência), `googleapis` + `archiver` (novas devDependencies), `pg_dump` (cliente Postgres, instalado no workflow via `apt-get`). Sem framework de teste — verificação via `node --check` (sintaxe) e uma execução real feita pelo Rodrigo depois de configurar os segredos (não posso rodar isso de ponta a ponta sem as credenciais dele).

## Global Constraints

- **Nunca imprimir segredo em log.** Segredos entram só via `env:` no workflow (`${{ secrets.X }}`) — o GitHub mascara automaticamente qualquer valor de secret que aparecer no output. Nenhuma linha do script deve fazer `console.log` de uma variável de ambiente sensível inteira.
- **Só o schema `public` é dumpado** (não `auth`/`storage`/`realtime`/extensões) — ver spec §4.
- **Sem limpeza/retenção automática** — decisão explícita do Rodrigo: o backup nunca apaga um arquivo antigo do Drive.
- **Buckets descobertos dinamicamente** (`supabase.storage.listBuckets()`) — nunca hardcodear nomes de bucket, pra cobrir buckets futuros automaticamente.
- **`pg_dump` usa a connection string DIRETA** (porta 5432), nunca o pooler/PgBouncer (transaction mode não suporta bem o que o `pg_dump` precisa).
- A conta de serviço do Google só tem acesso à pasta que o Rodrigo compartilhar com ela explicitamente — nunca à conta pessoal inteira dele.

---

## Arquivos afetados

- Criar: `scripts/backup.js`
- Modificar: `package.json`, `package-lock.json` (novas devDependencies: `googleapis`, `archiver`)
- Criar: `.github/workflows/backup-semanal.yml`
- Criar: `docs/backup-setup.md`

---

### Task 1: `scripts/backup.js` + dependências

**Files:**
- Create: `scripts/backup.js`
- Modify: `package.json`, `package-lock.json`

**Interfaces:**
- Consumes: `@supabase/supabase-js` (já dependência do projeto, `createClient`); variáveis de ambiente `SUPABASE_DB_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GOOGLE_SERVICE_ACCOUNT_JSON`, `GOOGLE_DRIVE_FOLDER_ID`.
- Produces: arquivo `scripts/backup.js` executável via `node scripts/backup.js` — consumido pela Task 2 (o workflow chama exatamente esse comando).

- [ ] **Step 1: Adicionar as dependências**

```bash
npm install --save-dev googleapis archiver
```

Isso atualiza `package.json` e `package-lock.json` com as versões atuais resolvidas pelo npm
(não fixar versão manualmente — deixar o npm escolher).

- [ ] **Step 2: Criar `scripts/backup.js`**

```js
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
  execFileSync('pg_dump', [
    SUPABASE_DB_URL,
    '--schema=public',
    '--no-owner',
    '--no-privileges',
    '--file', join(dirTemp, 'banco.sql'),
  ], { stdio: 'inherit' })

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
  console.log(`Backup concluído: ${nomeZip}`)
}

main().catch(err => {
  console.error('Backup falhou:', err.message)
  process.exit(1)
})
```

- [ ] **Step 3: Verificar sintaxe**

```bash
node --check scripts/backup.js
```

Expected: sem output (sintaxe válida). Não é possível rodar o script de ponta a ponta aqui —
precisa das 5 variáveis de ambiente reais (credenciais do Rodrigo), que só existem depois do
setup manual (Task 3 + guia). Confirmar pelo menos que os módulos importados resolvem:

```bash
node -e "import('googleapis').then(() => console.log('googleapis OK'))"
node -e "import('archiver').then(() => console.log('archiver OK'))"
```

Expected: `googleapis OK` e `archiver OK`.

- [ ] **Step 4: Commit**

```bash
git add scripts/backup.js package.json package-lock.json
git commit -m "Backup: script de dump do banco + storage + upload pro Drive"
```

---

### Task 2: Workflow do GitHub Actions

**Files:**
- Create: `.github/workflows/backup-semanal.yml`

**Interfaces:**
- Consumes: `scripts/backup.js` (Task 1); 5 GitHub Actions Secrets (ainda não configurados —
  isso é a Task 3/guia, feito pelo Rodrigo).
- Produces: workflow agendado + acionável manualmente (`workflow_dispatch`) no repositório.

- [ ] **Step 1: Criar `.github/workflows/backup-semanal.yml`**

```yaml
name: Backup semanal

on:
  schedule:
    - cron: '0 6 * * 0' # domingo 03:00 (horário de Brasília, UTC-3)
  workflow_dispatch: {}

jobs:
  backup:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout do repositório
        uses: actions/checkout@v4

      - name: Instalar cliente Postgres (pg_dump)
        run: sudo apt-get update && sudo apt-get install -y postgresql-client

      - name: Configurar Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Instalar dependências
        run: npm ci

      - name: Rodar backup
        env:
          SUPABASE_DB_URL: ${{ secrets.SUPABASE_DB_URL }}
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
          GOOGLE_SERVICE_ACCOUNT_JSON: ${{ secrets.GOOGLE_SERVICE_ACCOUNT_JSON }}
          GOOGLE_DRIVE_FOLDER_ID: ${{ secrets.GOOGLE_DRIVE_FOLDER_ID }}
        run: node scripts/backup.js
```

- [ ] **Step 2: Verificar**

```bash
node --check .github/workflows/backup-semanal.yml 2>/dev/null; echo "(ignorar — arquivo é YAML, não JS; checar só que o YAML é válido)"
python3 -c "import yaml, sys; yaml.safe_load(open('.github/workflows/backup-semanal.yml'))" 2>&1 || echo "Sem python/pyyaml disponível — revisar visualmente a indentação"
```

Expected: sem erro de parsing YAML (ou revisão visual confirmando indentação consistente, já
que o parser real só roda quando o GitHub processa o arquivo).

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/backup-semanal.yml
git commit -m "Backup: workflow do GitHub Actions com agendamento semanal"
```

---

### Task 3: Guia de setup manual para o Rodrigo

**Files:**
- Create: `docs/backup-setup.md`

**Interfaces:**
- Consumes: nada de código — documenta os 5 segredos que as Tasks 1-2 esperam
  (`SUPABASE_DB_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GOOGLE_SERVICE_ACCOUNT_JSON`,
  `GOOGLE_DRIVE_FOLDER_ID`).
- Produces: guia que o Rodrigo segue uma vez, fora deste plano (contas dele).

- [ ] **Step 1: Criar `docs/backup-setup.md`**

```markdown
# Setup do backup semanal (uma vez só, ~10 min)

Esses 4 passos só você consegue fazer (são suas contas). Depois de feitos, o backup roda
sozinho toda semana — nunca mais precisa mexer nisso.

## 1. Supabase — pegar 3 informações

No painel do projeto `rt-gestao-obra` (supabase.com/dashboard):

1. **Project Settings → Database → Connection string** → escolha **"Direct connection"**
   (não "Transaction pooler" nem "Session pooler") → copie a URI completa (já vem com a senha).
   Isso vira o secret `SUPABASE_DB_URL`.
2. **Project Settings → API → Project URL** → copie. Vira `SUPABASE_URL`.
3. **Project Settings → API → Project API keys → `service_role`** → clique em "Reveal" e
   copie. Vira `SUPABASE_SERVICE_ROLE_KEY`. **Trate essa chave como uma senha-mestra** — ela
   ignora todas as permissões do app.

## 2. Google Cloud — criar a conta de serviço

1. Acesse [console.cloud.google.com](https://console.cloud.google.com) com sua conta Google.
2. Crie um projeto novo (ou use um existente) — nome sugerido: "rt-gestao-obra-backup".
3. No menu, vá em **APIs e serviços → Biblioteca**, procure **"Google Drive API"** e clique
   em **Ativar**.
4. Vá em **APIs e serviços → Credenciais → Criar credenciais → Conta de serviço**.
   - Nome: "backup-semanal" (ou o que preferir).
   - Não precisa dar nenhum papel/permissão no projeto — pule essa parte.
5. Clique na conta de serviço criada → aba **Chaves → Adicionar chave → Criar nova chave** →
   formato **JSON** → baixa um arquivo `.json` automaticamente.
6. Abra esse arquivo `.json` num editor de texto, copie o conteúdo inteiro. Isso vira o secret
   `GOOGLE_SERVICE_ACCOUNT_JSON` (cole o JSON inteiro, com chaves e tudo).
7. Anote o campo `"client_email"` de dentro desse JSON (parece
   `algumacoisa@rt-gestao-obra-backup.iam.gserviceaccount.com`) — precisa dele no próximo passo.

## 3. Google Drive — criar e compartilhar a pasta

1. No seu Google Drive normal, crie uma pasta, ex.: **"RT Gestão de Obra — Backups"**.
2. Clique com o botão direito → **Compartilhar** → cole o e-mail da conta de serviço (o
   `client_email` do passo anterior) → dê permissão de **Editor** → compartilhar (pode ignorar
   o aviso de "essa pessoa não vai receber notificação").
3. Abra a pasta e copie o **ID dela pela URL** — é o trecho depois de `/folders/`, ex.:
   `https://drive.google.com/drive/folders/`**`1AbCdEfGhIjKlMnOpQrStUvWxYz`**. Isso vira o
   secret `GOOGLE_DRIVE_FOLDER_ID`.

## 4. GitHub — colar os 5 segredos

No repositório `rt-gestao-obra` no GitHub: **Settings → Secrets and variables → Actions → New
repository secret**. Criar um de cada vez, com esses nomes exatos:

| Nome do secret | Valor |
|---|---|
| `SUPABASE_DB_URL` | a connection string "Direct connection" do passo 1.1 |
| `SUPABASE_URL` | a Project URL do passo 1.2 |
| `SUPABASE_SERVICE_ROLE_KEY` | a chave `service_role` do passo 1.3 |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | o conteúdo inteiro do arquivo `.json` do passo 2.6 |
| `GOOGLE_DRIVE_FOLDER_ID` | o ID da pasta do passo 3.3 |

## 5. Testar

Na aba **Actions** do repositório, escolha o workflow **"Backup semanal"** → botão **"Run
workflow"** (isso existe por causa do `workflow_dispatch` no arquivo do workflow — não precisa
esperar domingo). Depois de ~1 minuto, confira:
- A execução terminou com ✅ verde (não ❌ vermelho) na aba Actions.
- Um arquivo `backup-rt-gestao-obra-AAAA-MM-DD.zip` apareceu na pasta do Drive.

Se der erro, a aba Actions mostra o log — a mensagem de erro geralmente aponta exatamente qual
dos 5 segredos está faltando ou errado.
```

- [ ] **Step 2: Commit**

```bash
git add docs/backup-setup.md
git commit -m "Docs: guia de setup manual do backup semanal"
```

---

## Self-Review

**Cobertura da spec:** §3 (arquitetura) → Tasks 1-2; §5-6 (segredos e por que precisam de
setup manual) → Task 3; §7 (roteiro passo a passo) → Task 3 Step 1; §8 (critérios de aceite) —
o item "Rodrigo completou o setup e uma execução de teste terminou com sucesso" só pode ser
verificado por ele (Task 3, guia, passo 5 "Testar"), não por este plano.

**Consistência:** os 5 nomes de secret (`SUPABASE_DB_URL`, `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, `GOOGLE_SERVICE_ACCOUNT_JSON`, `GOOGLE_DRIVE_FOLDER_ID`) são
idênticos entre `scripts/backup.js` (Task 1), `.github/workflows/backup-semanal.yml` (Task 2)
e `docs/backup-setup.md` (Task 3) — conferido nome a nome.

**Limite real deste plano:** nenhuma task aqui pode validar uma execução real de ponta a ponta
(precisa das credenciais do Rodrigo, que não devem passar por este chat/plano). A verificação
final é sempre o passo 5 do guia, feito por ele.
