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

## 2. Google Cloud — autorizar sua própria conta (não uma conta de serviço)

**Por quê:** contas de serviço do Google não têm cota de armazenamento própria em contas
pessoais/gratuitas (a sua não é Google Workspace). Mesmo compartilhando uma pasta com ela, o
upload falharia com erro de cota — a conta de serviço vira "dona" do arquivo e não tem espaço
nenhum. "Drives compartilhados" (o jeito normal de contornar isso) só existe em contas
Workspace, não na sua. Por isso o backup se autentica **como você mesmo** — os arquivos ficam
guardados no seu próprio Google Drive de 15 GB, do jeito que qualquer outro arquivo seu já fica.

1. Acesse [console.cloud.google.com](https://console.cloud.google.com) com sua conta Google.
2. Crie um projeto novo (ou use um existente) — nome sugerido: "rt-gestao-obra-backup".
3. No menu, vá em **APIs e serviços → Biblioteca**, procure **"Google Drive API"** e clique
   em **Ativar**.
4. Vá em **APIs e serviços → Tela de consentimento OAuth**:
   - Tipo de usuário: **Externo**.
   - Preencha nome do app e seu e-mail (obrigatórios) e salve.
   - Na tela de "Usuários de teste", clique em **Adicionar usuários** e adicione seu próprio
     e-mail Gmail. Como o app não vai ser publicado/verificado pelo Google, ele fica em modo de
     teste — isso é totalmente normal e não expira de um jeito problemático pra um único
     usuário de teste (você mesmo).
5. Vá em **APIs e serviços → Credenciais → Criar credenciais → ID do cliente OAuth**.
   - Tipo de aplicativo: **"App para computador"** (Desktop app).
   - Nome: "backup-semanal" (ou o que preferir).
   - Clientes do tipo "App para computador" no Google Cloud Console normalmente já
     pré-autorizam redirecionamentos `localhost` automaticamente — se você não vir um campo
     pra colar `http://localhost:53682/callback`, não se preocupe, é esperado. Se o painel
     mostrar um campo de "URIs de redirecionamento autorizados", cole esse endereço lá.
6. Copie o **ID do cliente** e o **Chave secreta do cliente** que aparecem depois de criar.
   Isso vira, respectivamente, os secrets `GOOGLE_OAUTH_CLIENT_ID` e
   `GOOGLE_OAUTH_CLIENT_SECRET`.
7. No seu computador (não é passo do GitHub Actions), dentro da pasta do projeto:
   - Se ainda não tiver feito, rode `npm install` uma vez.
   - Rode (substituindo pelos valores copiados no passo 6):
     ```
     GOOGLE_OAUTH_CLIENT_ID=seu-client-id GOOGLE_OAUTH_CLIENT_SECRET=seu-client-secret node scripts/gerar-token-drive.js
     ```
   - Abra o link impresso no terminal, faça login com sua própria conta Google e autorize.
   - Copie o valor `GOOGLE_OAUTH_REFRESH_TOKEN` que aparece no terminal depois disso. Isso vira
     o secret `GOOGLE_OAUTH_REFRESH_TOKEN`. Esse script roda **só essa uma vez** — depois disso
     o backup semanal usa esse token pra sempre, sem precisar de navegador nem senha de novo.

## 3. Google Drive — criar a pasta

1. No seu Google Drive normal, crie uma pasta, ex.: **"RT Gestão de Obra — Backups"**.
2. Abra a pasta e copie o **ID dela pela URL** — é o trecho depois de `/folders/`, ex.:
   `https://drive.google.com/drive/folders/`**`1AbCdEfGhIjKlMnOpQrStUvWxYz`**. Isso vira o
   secret `GOOGLE_DRIVE_FOLDER_ID`.
3. Não precisa compartilhar essa pasta com ninguém — como o backup autentica como você mesmo
   (não como uma conta separada), ela já está na sua própria conta.

## 4. GitHub — colar os 7 segredos

No repositório `rt-gestao-obra` no GitHub: **Settings → Secrets and variables → Actions → New
repository secret**. Criar um de cada vez, com esses nomes exatos:

| Nome do secret | Valor |
|---|---|
| `SUPABASE_DB_URL` | a connection string "Session pooler" do passo 1.1 |
| `SUPABASE_URL` | a Project URL do passo 1.2 |
| `SUPABASE_SERVICE_ROLE_KEY` | a chave `service_role` do passo 1.3 |
| `GOOGLE_OAUTH_CLIENT_ID` | o ID do cliente OAuth do passo 2.6 |
| `GOOGLE_OAUTH_CLIENT_SECRET` | a chave secreta do cliente OAuth do passo 2.6 |
| `GOOGLE_OAUTH_REFRESH_TOKEN` | o refresh token impresso pelo `scripts/gerar-token-drive.js` no passo 2.7 |
| `GOOGLE_DRIVE_FOLDER_ID` | o ID da pasta do passo 3.2 |

## 5. Testar

Na aba **Actions** do repositório, escolha o workflow **"Backup semanal"** → botão **"Run
workflow"** (isso existe por causa do `workflow_dispatch` no arquivo do workflow — não precisa
esperar domingo). Depois de ~1 minuto, confira:
- A execução terminou com ✅ verde (não ❌ vermelho) na aba Actions.
- Um arquivo `backup-rt-gestao-obra-AAAA-MM-DD.zip` apareceu na pasta do Drive.

Se der erro, a aba Actions mostra o log — a mensagem de erro geralmente aponta exatamente qual
dos 7 segredos está faltando ou errado.
