# Backup semanal (banco + arquivos) · Spec de design

> Status: aprovado por Rodrigo em 14/07/2026, aguardando plano de implementação.
> Motivação: o projeto Supabase está no plano **free**, que não inclui nenhum backup
> automático (isso só existe a partir do plano Pro, US$25/mês). Hoje não há nenhuma cópia
> de segurança dos dados fora do banco em produção.

## 1. Objetivo

Rodar toda semana, sem depender de nenhum computador ligado, um backup completo do banco de
dados (todas as tabelas do schema `public`) e de todos os arquivos do Storage (fotos, áudios,
anexos), guardando tudo no Google Drive, sem apagar backups antigos (decisão explícita do
Rodrigo — não há limite de retenção nesta primeira versão).

## 2. Estado atual (levantado em 14/07/2026)

- Organização Supabase no plano **free** (`get_organization` confirmou `"plan":"free"`).
- 4 buckets de Storage hoje: `rdo`, `fvs`, `pendencias`, `cotacoes-nf` — todos privados
  (`public: false`), somam **51 arquivos / ~19 MB** no total. Volume pequeno agora; o desenho
  não assume um número fixo de buckets (descobre dinamicamente), porque módulos futuros podem
  criar novos (ex.: se o anexo de contrato assinado, hoje adiado, for construído depois).
- Sem framework de teste/staging separado neste projeto — o backup roda contra o banco de
  produção mesmo (leitura apenas, nunca escreve nada no Supabase).

## 3. Arquitetura

**GitHub Actions** (roda nos servidores do GitHub, independente de qualquer máquina local),
agendado por cron semanal — **domingo às 3h da manhã, horário de Brasília** (`0 6 * * 0` em
UTC). Cada execução:

1. **Dump do banco:** `pg_dump` do schema `public` inteiro (todas as tabelas do app), em
   formato texto plano (`.sql`), usando a *connection string direta* do Postgres (porta 5432,
   não o pooler/PgBouncer — `pg_dump` precisa de uma sessão real). `--no-owner --no-privileges`
   para não travar numa restauração futura por causa de papéis/donos específicos do Supabase.
2. **Cópia dos arquivos:** lista todos os buckets do Storage via API (`service_role` key, que
   ignora RLS/políticas de storage) e baixa todo objeto de cada bucket, preservando a estrutura
   de pastas.
3. **Empacota** o dump + os arquivos baixados num único `.zip`, nomeado
   `backup-rt-gestao-obra-AAAA-MM-DD.zip`.
4. **Envia pro Google Drive**, numa pasta dedicada, usando uma **conta de serviço do Google
   Cloud** (não a sessão do Claude, que não existe fora desta conversa — ver §5).

Script em Node.js (`scripts/backup.js`), já que o projeto é um app Node/Vite — reaproveita
`@supabase/supabase-js` (já é dependência) e adiciona `googleapis` + `archiver` como
devDependencies (só rodam no workflow, não entram no bundle do app, que só empacota o que é
importado por `src/`).

## 4. O que fica de fora (esta versão)

- **Limpeza/retenção automática** — decisão explícita do Rodrigo: guardar tudo, sem apagar.
  Se o Drive gratuito (15 GB) apertar no futuro, revisitar.
- **Restauração automatizada** (um comando que reconstrói um projeto Supabase do zero a partir
  do backup) — fica documentado como processo manual (recriar projeto, rodar as migrações do
  repositório para montar o schema, depois `psql` pra restaurar os dados do dump, depois
  recriar os arquivos de Storage a partir do zip). Não solicitado nesta rodada.
- **Schemas internos do Supabase** (`auth`, `storage`, `realtime`, extensões) — só o schema
  `public` (onde vivem todas as tabelas do app) é dumpado. Usuários de autenticação (`auth.users`)
  não fazem parte deste backup; se precisar disso no futuro, é uma extensão separada.
- **Alerta de falha customizado** — o GitHub já avisa por e-mail o dono do repositório quando
  uma execução agendada falha, sem configuração extra.

## 5. Por que precisa de setup manual (não dá pra automatizar 100% agora)

A conexão com o Google Drive usada nesta conversa é uma sessão do Claude — não existe fora
daqui, e um workflow do GitHub rodando sozinho às 3h da manhã de domingo não tem como usá-la.
Ele precisa de uma credencial própria e permanente: uma **conta de serviço do Google Cloud**,
compartilhada com uma pasta específica do Drive (não a conta pessoal inteira do Rodrigo — só
aquela pasta). Isso — e pegar duas informações do painel do Supabase — são passos que só o
Rodrigo (dono das contas) consegue fazer; o Claude Code não tem uma ferramenta de navegador
para clicar nesses painéis por ele nesta sessão.

## 6. Segredos necessários (GitHub Actions Secrets)

| Nome | De onde vem | Sensível? |
|---|---|---|
| `SUPABASE_DB_URL` | Supabase → Project Settings → Database → Connection string → **Direct connection** (porta 5432) | Sim — senha do banco embutida |
| `SUPABASE_URL` | Supabase → Project Settings → API → Project URL | Não (pública) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API → `service_role` secret | **Sim, muito** — ignora todo RLS |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | Google Cloud Console → conta de serviço → chave JSON | Sim |
| `GOOGLE_DRIVE_FOLDER_ID` | ID da pasta do Drive (pedaço da URL) | Não |

## 7. Roteiro de setup manual (uma vez só, ~10 min)

1. **Supabase:** copiar a connection string "Direct connection" e a chave `service_role`
   (painel do projeto `rt-gestao-obra`, `yxshldsfmbmbzdkcymca`).
2. **Google Cloud:** criar/usar um projeto → ativar "Google Drive API" → criar uma conta de
   serviço → gerar e baixar a chave `.json`.
3. **Google Drive:** criar a pasta "RT Gestão de Obra — Backups" → compartilhar com o e-mail
   da conta de serviço (formato `xxx@yyy.iam.gserviceaccount.com`) com permissão de Editor →
   copiar o ID da pasta da URL.
4. **GitHub:** colar as 5 informações acima em Settings → Secrets and variables → Actions, no
   repositório `rt-gestao-obra`.

O plano de implementação vai detalhar cada um desses 4 passos com prints/instruções exatas de
onde clicar.

## 8. Critérios de aceite

- [ ] Workflow roda manualmente sob demanda (`workflow_dispatch`) além do agendamento semanal,
      pra testar sem esperar domingo.
- [ ] Dump do banco inclui todas as tabelas do schema `public` (conferir contagem de tabelas
      do dump contra `list_tables`).
- [ ] Todos os 4 buckets de Storage (e qualquer bucket futuro) aparecem no zip.
- [ ] Arquivo aparece na pasta certa do Google Drive, nomeado com a data correta.
- [ ] Nenhum segredo aparece em texto visível nos logs do GitHub Actions.
- [ ] Rodrigo completou o roteiro de setup manual e uma execução de teste terminou com sucesso.
