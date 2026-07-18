# Fase 7 — Projetos

> Detalhes técnicos do módulo Projetos. Implementado em 18/07/2026 pelo Codex a partir de `docs/superpowers/specs/2026-07-18-projetos-design.md` e `docs/superpowers/plans/2026-07-18-projetos.md`. Revisão prévia e pós-commit do Claude Code concluídas, migração aplicada em produção no mesmo dia. Falta o teste de campo do Rodrigo com documentos reais para o aceite formal.

## O que foi implementado

- Tela `/projetos` para repositório versionado de documentos da obra.
- Categorias fixas: projeto executivo, memorial/especificação e administrativo/contratual.
- Cadastro de documento com título, categoria, descrição opcional, arquivo PDF obrigatório e primeira revisão obrigatória.
- Detalhe do documento com revisão atual em destaque e histórico de revisões anteriores.
- Upload de nova revisão em PDF; o path do Storage usa `${obra_id}/${documento_id}/${Date.now()}.pdf`, sem incorporar o texto livre do código de revisão.
- Abertura de PDFs por signed URL de 300 segundos no bucket privado `projetos`.
- Edição de título/categoria/descrição do documento.
- Soft delete do documento por `ativo = false`, preservando revisões e arquivos.
- Cliente acessa em modo leitura; admin e equipe com módulo `projetos` podem criar, editar, subir revisão e inativar.

## Modelo de dados

Criado em `supabase/migrations/20260718_projetos.sql`:

- `categoria_documento_projeto`: enum com `projeto_executivo`, `memorial` e `administrativo`.
- `projetos_documentos`: documento por obra, com título, categoria, descrição, soft delete e autoria de criação.
- `projetos_revisoes`: revisões append-only, com código de revisão, path do PDF, observação, flag `atual` e autoria de criação.
- Índice único parcial `idx_projetos_revisoes_unica_atual` garante apenas uma revisão atual por documento.

## Regras de banco e segurança

- RLS habilitado nas duas tabelas.
- Isolamento por obra criado desde a migração inicial com policies `AS RESTRICTIVE` usando `pode_acessar_obra(obra_id)`.
- Helper `pode_editar_projetos()` libera escrita para admin ou equipe com o módulo `projetos`.
- Cliente tem leitura de documentos/revisões ativos da obra vinculada.
- Usuários internos com permissão continuam vendo documentos inativos via policy de SELECT, preservando o padrão necessário para soft delete.
- Trigger `trg_marcar_revisao_atual` é `BEFORE INSERT` e desmarca a revisão anterior antes da nova entrar, evitando conflito com o índice único parcial.
- Função `marcar_revisao_atual()` tem `SECURITY DEFINER`, `search_path = public` e `REVOKE ALL ... FROM PUBLIC, anon, authenticated`.
- Bucket privado `projetos` aceita somente `application/pdf` até 20 MB.
- A policy restritiva existente `isolamento_obra_storage` foi recriada na migração incluindo o bucket `projetos` na lista isolada por obra.

## Aplicação da migração

Aplicada pelo Claude Code em 18/07/2026, via MCP Supabase, em duas transações: o
`ALTER TYPE modulo_app ADD VALUE IF NOT EXISTS 'projetos';` primeiro, depois o restante do
arquivo — mesmo motivo já registrado em Tarefas: o Postgres não permite usar valor novo de
enum na mesma transação em que ele foi adicionado.

Após aplicar, o advisor de segurança do Supabase não apontou nenhum achado novo para as
funções do módulo (a função `SECURITY DEFINER` já nasceu com o `REVOKE` aplicado na própria
migração).

## Validação técnica

- `npx tsc -b` passou no sandbox do Codex após as Tasks 1, 2/3 e 4.
- `npm run build` completo rodado pelo Claude Code fora do sandbox: passou limpo (o bloqueio
  `Access is denied` era específico do sandbox do Codex, não um problema de código).
- Revisão pós-commit do Claude Code conferiu o código real (não só o relato do Codex):
  trigger `BEFORE INSERT`, path do Storage sem texto livre, policy `isolamento_obra_storage`
  e `REVOKE` confirmados corretos.
- Corrigida nessa mesma revisão uma dessincronização entre `CLAUDE.md` e `AGENTS.md` (o
  segundo nunca tinha recebido a entrada do módulo Tarefas).

## Pendências antes do aceite formal

- Testes reais de RLS/permissão dos três papéis (admin, equipe com/sem módulo, cliente
  leitura) e isolamento entre obras, logando de fato no app — nenhuma ferramenta automatizada
  substitui esse teste.
- Teste de campo do Rodrigo com documentos reais da obra.

## Evolução — pastas livres por obra

Implementada localmente em 18/07/2026 a evolução planejada em `docs/superpowers/specs/2026-07-18-projetos-pastas-design.md` e `docs/superpowers/plans/2026-07-18-projetos-pastas.md`: as categorias fixas foram substituídas por pastas livres cadastradas por obra.

### O que mudou

- Criada a tabela `projetos_pastas`, com RLS e isolamento por obra.
- `projetos_documentos` passou a usar `pasta_id` obrigatório em vez de `categoria`.
- A migração preserva documentos existentes criando pastas equivalentes às categorias antigas: `Projeto Executivo`, `Memorial` e `Administrativo`.
- A tela `/projetos` agora filtra por pasta e exibe o nome da pasta no card e no detalhe.
- O cadastro de novo documento permite escolher pasta ativa existente ou criar uma nova pasta no próprio fluxo.
- O formulário de edição permite trocar a pasta do documento, preservando a pasta atual no select mesmo se ela estiver inativa.
- O painel `Gerenciar pastas` permite renomear e inativar pastas ativas.
- Pastas inativas continuam carregadas para exibição, evitando que documentos preservados percam o rótulo da pasta.

### Migração

Criada em `supabase/migrations/20260718_projetos_pastas.sql`. A ordem é intencional: cria pastas, adiciona `pasta_id` nullable, migra os documentos existentes, torna `pasta_id` `NOT NULL`, remove o índice antigo de categoria, remove a coluna `categoria` e só então remove o enum `categoria_documento_projeto`.

Aplicada pelo Claude Code em 18/07/2026 via MCP Supabase, numa transação só (sem `ALTER TYPE
ADD VALUE`, então não precisou da mesma separação de transações usada em Tarefas/Projetos
original). Confirmado por SQL direto que os 2 documentos já existentes migraram para a pasta
"Projeto Executivo", preservando o vínculo. O advisor de segurança do Supabase não apontou
nenhum achado novo.

### Validação técnica desta evolução

- `npx tsc -b` passou no sandbox do Codex após a migração da UI para pastas.
- `npm run build` completo rodado pelo Claude Code fora do sandbox: passou limpo (mesmo
  bloqueio `Access is denied` específico do sandbox do Codex, já visto nas duas
  implementações anteriores).
- Revisão pós-commit do Claude Code conferiu o código real: os dois achados da revisão prévia
  (Map de pastas incluindo inativas; select de edição preservando a pasta atual mesmo
  inativa) confirmados corretamente implementados.

### Pendências antes do aceite formal

- Testes reais de RLS/permissão dos três papéis (admin, equipe com/sem módulo, cliente
  leitura) e isolamento entre obras, logando de fato no app.
- Teste de campo do Rodrigo criando pastas reais (Arquitetura, Estrutura, Hidrossanitário
  etc.) e organizando documentos nelas.
