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
   formato texto plano (`.sql`), usando a *connection string do Session pooler* do Postgres
   (porta 5432) — não a Direct connection (só aceita IPv6 sem o add-on pago de IPv4, e os
   runners do GitHub Actions não têm saída IPv6) nem o Transaction pooler (porta 6543,
   multiplexa conexão por statement e quebra o que o `pg_dump` precisa de uma sessão real).
   `--no-owner --no-privileges` para não travar numa restauração futura por causa de
   papéis/donos específicos do Supabase.
2. **Cópia dos arquivos:** lista todos os buckets do Storage via API (`service_role` key, que
   ignora RLS/políticas de storage) e baixa todo objeto de cada bucket, preservando a estrutura
   de pastas.
3. **Empacota** o dump + os arquivos baixados num único `.zip`, nomeado
   `backup-rt-gestao-obra-AAAA-MM-DD.zip`.
4. **Envia pro Google Drive**, numa pasta dedicada. **Atualização pós-revisão final (14/07):**
   originalmente desenhado com uma conta de serviço do Google Cloud; corrigido para OAuth2
   autorizado como a própria conta pessoal do Rodrigo, porque contas de serviço não têm cota de
   armazenamento própria em contas pessoais/gratuitas — ver §5 e `docs/backup-setup.md`.

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
Ele precisa de uma credencial própria e permanente. **(Atualização 14/07, pós-revisão final):**
não é mais uma conta de serviço do Google Cloud compartilhada com uma pasta — isso não funciona
em contas pessoais/gratuitas, que não dão cota de armazenamento a contas de serviço. Em vez
disso, o workflow se autentica via OAuth2 **como a própria conta do Rodrigo**, usando um
refresh token de longa duração gerado uma única vez, localmente, pelo script
`scripts/gerar-token-drive.js` (nunca em CI). Isso — e pegar duas informações do painel do
Supabase — são passos que só o Rodrigo (dono das contas) consegue fazer; o Claude Code não tem
uma ferramenta de navegador para clicar nesses painéis por ele nesta sessão.

## 6. Segredos necessários (GitHub Actions Secrets)

| Nome | De onde vem | Sensível? |
|---|---|---|
| `SUPABASE_DB_URL` | Supabase → Project Settings → Database → Connection string → **Session pooler** (porta 5432) | Sim — senha do banco embutida |
| `SUPABASE_URL` | Supabase → Project Settings → API → Project URL | Não (pública) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API → `service_role` secret | **Sim, muito** — ignora todo RLS |
| `GOOGLE_OAUTH_CLIENT_ID` | Google Cloud Console → credencial OAuth "App para computador" | Sim |
| `GOOGLE_OAUTH_CLIENT_SECRET` | Google Cloud Console → mesma credencial OAuth | Sim |
| `GOOGLE_OAUTH_REFRESH_TOKEN` | gerado uma vez, localmente, por `scripts/gerar-token-drive.js` | **Sim, muito** — dá acesso ao Drive do Rodrigo |
| `GOOGLE_DRIVE_FOLDER_ID` | ID da pasta do Drive (pedaço da URL) | Não |

(Substitui o antigo `GOOGLE_SERVICE_ACCOUNT_JSON` único — ver atualização de 14/07 acima.)

## 7. Roteiro de setup manual (uma vez só, ~10 min)

1. **Supabase:** copiar a connection string "Session pooler" e a chave `service_role`
   (painel do projeto `rt-gestao-obra`, `yxshldsfmbmbzdkcymca`).
2. **Google Cloud:** criar/usar um projeto → ativar "Google Drive API" → configurar a tela de
   consentimento OAuth (Externo, com o próprio Gmail como usuário de teste) → criar credencial
   OAuth "App para computador" → rodar `scripts/gerar-token-drive.js` localmente uma vez pra
   obter o refresh token.
3. **Google Drive:** criar a pasta "RT Gestão de Obra — Backups" na própria conta (sem
   compartilhamento — o backup autentica como o próprio Rodrigo) → copiar o ID da pasta da URL.
4. **GitHub:** colar as 7 informações acima em Settings → Secrets and variables → Actions, no
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
