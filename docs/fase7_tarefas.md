# Fase 7 — Tarefas

> Detalhes técnicos do módulo de Tarefas. Entregue e aceito em produção em 18/07/2026, após revisão prévia e pós-commit do Claude Code, correções dos achados e teste real do Rodrigo como admin, equipe com o módulo `tarefas`, equipe sem o módulo e cliente. Ver `docs/superpowers/specs/2026-07-18-tarefas-design.md` e `docs/superpowers/plans/2026-07-18-tarefas.md`.

## O que foi entregue

- Tela `/tarefas` para registrar tarefas operacionais da obra e do escritório, com lista, filtros, formulário de cadastro/edição, detalhe, comentários e histórico.
- Tarefa sempre vinculada a uma obra, com `prazo` obrigatório, `titulo` obrigatório e `prioridade` com padrão `normal`.
- Responsável opcional vinculado a `perfis_usuario(id)`; tarefa sem responsável aparece como "Sem responsável" na tela.
- Vínculo opcional com a hierarquia da EAP: `obra_id` obrigatório e `unidade_id`, `etapa_id`, `servico_id` opcionais.
- Fluxo de status: `aberta`, `em_andamento`, `concluida`, `cancelada`, com máquina de estado travada por trigger no banco.
- Comentários manuais e eventos automáticos em `tarefas_comentarios`, sem edição/exclusão de comentários no MVP.
- Soft delete por `ativo = false` na tarefa, com histórico preservado para usuários internos com permissão.
- Contador no Dashboard para tarefas atrasadas e tarefas abertas do usuário.
- Ajuste mobile final em `src/pages/Tarefas.module.css` (commit `f1a0aa7`): campos de Responsável/Prazo e filtros passaram a encolher corretamente no celular, evitando overflow horizontal.

## Modelo de dados

### Enums

Criados em `supabase/migrations/20260718_tarefas.sql`:

- `status_tarefa`: `aberta`, `em_andamento`, `concluida`, `cancelada`.
- `prioridade_tarefa`: `baixa`, `normal`, `alta`, `urgente`.
- `tipo_tarefa_comentario`: `comentario`, `criada`, `iniciada`, `concluida`, `cancelada`, `reaberta`, `editada`.
- `modulo_app`: recebeu o valor `tarefas` via `ALTER TYPE modulo_app ADD VALUE IF NOT EXISTS 'tarefas'`.

### `tarefas`

Campos criados na migração:

- `id` — UUID, chave primária.
- `obra_id` — UUID obrigatório, FK para `obras(id)`, com `ON DELETE CASCADE`.
- `unidade_id` — UUID opcional, FK para `unidades(id)`.
- `etapa_id` — UUID opcional, FK para `etapas(id)`.
- `servico_id` — UUID opcional, FK para `servicos(id)`.
- `titulo` — texto obrigatório, com constraint `tarefas_titulo_not_blank`.
- `descricao` — texto opcional.
- `responsavel_id` — UUID opcional, FK para `perfis_usuario(id)`.
- `prazo` — data obrigatória.
- `prioridade` — `prioridade_tarefa`, padrão `normal`.
- `status` — `status_tarefa`, padrão `aberta`.
- `motivo_cancelamento` — texto opcional, obrigatório por constraint quando `status = 'cancelada'`.
- `concluida_por`, `concluida_em` — autoria/data de conclusão, obrigatórios por constraint quando `status = 'concluida'`.
- `cancelada_por`, `cancelada_em` — autoria/data de cancelamento, obrigatórios por constraint quando `status = 'cancelada'`.
- `ativo` — boolean, padrão `true`, usado para soft delete.
- `criado_por`, `criado_em` — rastreabilidade de criação; `criado_por` usa `auth.uid()` por padrão.
- `atualizado_por`, `atualizado_em` — rastreabilidade de atualização, preenchida no trigger `preparar_tarefa()`.

Índices criados: `idx_tarefas_obra_status`, `idx_tarefas_obra_prazo`, `idx_tarefas_responsavel`, `idx_tarefas_unidade`.

### `tarefas_comentarios`

Campos criados na migração:

- `id` — UUID, chave primária.
- `tarefa_id` — UUID obrigatório, FK para `tarefas(id)`, com `ON DELETE CASCADE`.
- `tipo` — `tipo_tarefa_comentario`, padrão `comentario`.
- `comentario` — texto obrigatório, com constraint `tarefas_comentarios_texto_not_blank`.
- `criado_por`, `criado_em` — rastreabilidade de criação; `criado_por` usa `auth.uid()` por padrão.

Índice criado: `idx_tarefas_comentarios_tarefa`.

## Regras de negócio

- Toda tarefa nova nasce como `aberta`; o trigger `preparar_tarefa()` rejeita INSERT com status diferente.
- Transições permitidas no banco:
  - `aberta -> em_andamento`;
  - `aberta/em_andamento -> concluida`;
  - `aberta/em_andamento -> cancelada`;
  - `concluida/cancelada -> aberta` somente para admin.
- A equipe só conclui tarefa quando `OLD.responsavel_id = auth.uid()`; admin pode concluir qualquer tarefa.
- Ao concluir, o banco sobrescreve `concluida_por := auth.uid()` e `concluida_em := now()`.
- Ao cancelar, o banco exige `motivo_cancelamento` e sobrescreve `cancelada_por := auth.uid()` e `cancelada_em := now()`.
- Tarefa `concluida` ou `cancelada` fica em modo leitura: UPDATE sem mudança de status é bloqueado por `preparar_tarefa()`; a UI também oculta o botão **Editar** para esses status.
- Reabrir tarefa concluída/cancelada limpa `concluida_por`, `concluida_em`, `cancelada_por`, `cancelada_em` e `motivo_cancelamento`.
- O trigger `validar_tarefa_mesma_obra()` impede vínculo cruzado: unidade, etapa e serviço precisam pertencer à mesma `obra_id` da tarefa; etapa precisa pertencer à unidade informada; serviço precisa pertencer à etapa/unidade informadas.
- O trigger `registrar_evento_tarefa()` registra eventos automáticos de criação e mudança de status.
- O trigger `registrar_edicao_tarefa()` registra evento `editada` quando mudam `titulo`, `descricao`, `responsavel_id`, `prazo`, `prioridade`, `unidade_id`, `etapa_id` ou `servico_id` sem mudança de status.
- Comentários são append-only no MVP: há policies de SELECT e INSERT, sem policy de UPDATE/DELETE para `tarefas_comentarios`.
- Arquivar usa soft delete em `tarefas.ativo`; a policy de comentários usa `t.ativo = true OR pode_editar_tarefas()` para que o histórico não desapareça para usuários internos com permissão.

## Permissões e RLS

RLS está habilitado em `tarefas` e `tarefas_comentarios`.

- **Admin:** `pode_editar_tarefas()` retorna true por `meu_papel() = 'admin'`; pode criar, editar tarefa aberta/em andamento, comentar, iniciar, concluir, cancelar, reabrir e arquivar. Admin acessa obras conforme `pode_acessar_obra()`.
- **Equipe com módulo `tarefas`:** `pode_editar_tarefas()` retorna true quando `meu_papel() = 'equipe'` e `'tarefas' = ANY(meus_modulos())`; pode criar, editar tarefa aberta/em andamento, comentar, iniciar e cancelar; só conclui se for o responsável vigente.
- **Equipe sem módulo `tarefas`:** não passa em `pode_editar_tarefas()`; no teste real do Rodrigo, não acessou o módulo.
- **Cliente:** policies de SELECT exigem `meu_papel() IN ('admin', 'equipe')`; cliente não vê/acessa o módulo.
- **Isolamento por obra:** `tarefas` tem policy `isolamento_obra AS RESTRICTIVE FOR ALL TO authenticated` com `pode_acessar_obra(obra_id)`; `tarefas_comentarios` herda esse isolamento pela tarefa pai.
- **Hardening de funções SECURITY DEFINER:** a migração final revoga execução direta de `validar_tarefa_mesma_obra()`, `registrar_evento_tarefa()` e `registrar_edicao_tarefa()` para `PUBLIC`, `anon` e `authenticated`. O REVOKE não afeta o disparo por trigger.

## Onde estão as regras de negócio

- Banco: `supabase/migrations/20260718_tarefas.sql` — enums, tabelas, índices, RLS, `pode_editar_tarefas()`, triggers `validar_tarefa_mesma_obra()`, `preparar_tarefa()`, `registrar_evento_tarefa()`, `registrar_edicao_tarefa()` e REVOKEs das funções SECURITY DEFINER.
- Frontend: `src/pages/Tarefas.tsx` e `src/pages/Tarefas.module.css` — lista, filtros, formulário, detalhe, comentários, ações de status, bloqueio visual de cliente/usuário sem permissão e correção mobile.
- Integrações de rota/menu/dashboard: `src/App.tsx`, `src/components/Layout.tsx`, `src/pages/Dashboard.tsx`, `src/pages/Dashboard.module.css`.
- Permissão no cadastro de usuários: `src/pages/Usuarios.tsx` adiciona o módulo `tarefas` na lista de checkboxes.
- Desenho e decisões: `docs/superpowers/specs/2026-07-18-tarefas-design.md`.
- Plano, revisões e aceite real: `docs/superpowers/plans/2026-07-18-tarefas.md`.

## Achados de revisão tratados antes do aceite

- **Isolamento por obra:** revisão prévia do Claude Code apontou falta de policy restritiva; corrigido com `isolamento_obra AS RESTRICTIVE` em `tarefas` e `tarefas_comentarios`.
- **Máquina de status:** revisão prévia apontou que status não podia ficar só em prosa/RLS; corrigido com trigger `preparar_tarefa()` comparando `OLD.status` e `NEW.status`.
- **Auditoria servidor-side:** revisão prévia apontou que campos de conclusão/cancelamento não podiam ser graváveis livremente pelo cliente; corrigido com `auth.uid()` e `now()` forçados no trigger.
- **Vínculos da EAP na mesma obra:** revisão prévia apontou que FK não passa por RLS; corrigido com `validar_tarefa_mesma_obra()`.
- **Histórico após arquivar:** revisão pós-commit apontou que `tarefas_comentarios_select` ocultava histórico de tarefa arquivada; corrigido com fallback `t.ativo = true OR pode_editar_tarefas()`.
- **Tarefa fechada somente leitura:** revisão pós-commit apontou edição indevida de tarefa concluída/cancelada; corrigido no trigger e na UI.
- **Evento de edição:** revisão pós-commit registrou lacuna de histórico; incorporado com `registrar_edicao_tarefa()`.
- **Funções SECURITY DEFINER:** após aplicar a migração em produção, o advisor do Supabase apontou exposição de RPC anônima nas funções privilegiadas; corrigido no commit `b684cee` com REVOKEs para `PUBLIC`, `anon` e `authenticated`.
- **Layout mobile:** Rodrigo validou o módulo no celular; overflow nos campos Responsável/Prazo foi corrigido no commit `f1a0aa7`.

## Verificações e aceite

- Revisão prévia do Claude Code registrada em `docs/superpowers/plans/2026-07-18-tarefas.md` antes da implementação.
- Revisão pós-commit do Claude Code no commit `ddf5a50`, com achados tratados no commit `055c91f`.
- Migração aplicada em produção no commit `b684cee`, com hardening das funções SECURITY DEFINER.
- Correção mobile aplicada no commit `f1a0aa7`.
- Teste real do Rodrigo em 18/07/2026 registrado no commit `96023aa`: admin, equipe com módulo `tarefas`, equipe sem módulo e cliente, seguindo roteiro de permissão/status/RLS das revisões. Resultado registrado: tudo funcionando como esperado, sem achados novos.
- O teste real citado no plano usou dados de verificação; o uso contínuo com tarefas reais da obra ficou como próxima etapa operacional, não como bloqueio de aceite técnico.

## Fora de escopo do MVP

- Fotos, anexos ou documentos vinculados à tarefa.
- Visualização Kanban.
- Recorrência de tarefas.
- Notificações push.
- Integração automática com RDO, Lookahead/PPC, Alertas detalhados, Financeiro ou outros módulos.
- Criação automática de tarefas a partir de outros módulos.

## Lacunas

- [lacuna] O plano registra que o teste aceito por Rodrigo usou dados de verificação; ainda não há registro no repositório de uso contínuo com tarefas reais da obra piloto.
