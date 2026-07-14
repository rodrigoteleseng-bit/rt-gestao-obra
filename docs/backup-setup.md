# Setup do backup semanal (uma vez só, ~10 min)

Esses 4 passos só você consegue fazer (são suas contas). Depois de feitos, o backup roda
sozinho toda semana — nunca mais precisa mexer nisso.

## 1. Supabase — pegar 3 informações

No painel do projeto `rt-gestao-obra` (supabase.com/dashboard):

1. **Project Settings → Database → Connection string** → escolha **"Session pooler"**
   (não "Direct connection" — só funciona por IPv6 a menos que você pague o add-on de IPv4, e
   o servidor do GitHub Actions que roda o backup não tem como acessar por IPv6; nem
   "Transaction pooler" — não sustenta uma sessão real, o que quebra o `pg_dump`). Clique para
   **revelar a senha** antes de copiar a URI completa (ela pode aparecer mascarada). Isso vira
   o secret `SUPABASE_DB_URL`.
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
| `SUPABASE_DB_URL` | a connection string "Session pooler" do passo 1.1 |
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
