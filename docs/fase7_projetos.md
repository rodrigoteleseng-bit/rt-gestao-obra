# Fase 7 — Projetos

> Detalhes técnicos do módulo Projetos. Implementado em 18/07/2026 pelo Codex a partir de `docs/superpowers/specs/2026-07-18-projetos-design.md` e `docs/superpowers/plans/2026-07-18-projetos.md`. A migração não foi aplicada ao Supabase nesta etapa. Como envolve tabela nova, RLS, trigger e Storage, exige revisão pós-commit do Claude Code antes de qualquer teste de campo com dados reais.

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

A migração não foi aplicada nesta etapa.

Ao aplicar no Supabase, executar o `ALTER TYPE modulo_app ADD VALUE IF NOT EXISTS 'projetos';` em transação separada do restante do arquivo, pelo mesmo motivo já registrado em Tarefas: o Postgres não permite usar valor novo de enum na mesma transação em que ele foi adicionado.

## Validação técnica nesta sessão

- `npx tsc -b` passou após as Tasks 1, 2/3 e 4.
- `npm run build` não pôde ser concluído no sandbox: o Vite/esbuild falhou ao carregar `vite.config.ts` por bloqueio de permissão ao tentar ler diretórios acima do workspace (`Cannot read directory "../../../..": Access is denied`).
- Testes reais de RLS, Storage, permissões dos três papéis e isolamento entre obras não foram executados porque a migração não foi aplicada ao Supabase nesta etapa.

## Pendências antes de teste com dados reais

- Aplicar os commits externamente, pois o `.git` ficou somente leitura nesta sessão.
- Rodar `npm run build` fora do sandbox bloqueado.
- Aplicar a migração no Supabase somente quando Rodrigo decidir.
- Fazer revisão pós-commit obrigatória do Claude Code antes do Rodrigo testar com documentos reais.
- Após a revisão e correções, validar admin, equipe com módulo, equipe sem módulo, cliente leitura e isolamento entre obras.
