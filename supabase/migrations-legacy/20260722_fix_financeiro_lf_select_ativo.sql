-- Fix: lf_select escondia lançamentos inativados até de quem pode editar
-- financeiro (achado na revisão pós-commit do cancelamento de medições,
-- 22/07/2026 — ver docs/superpowers/specs/2026-07-22-medicoes-cancelamento-design.md).
--
-- A policy original exigia ativo = true mesmo para pode_editar_financeiro(),
-- sem o "OR pode_editar_X()" que CLAUDE.md §3 exige em toda tabela com soft
-- delete. Isso só passou despercebido na Fase 3a porque, até agora, nenhum
-- fluxo do app jamais gravava ativo = false em lancamentos_financeiros — o
-- cancelamento de medição (22/07/2026) é o primeiro. Sem este fix, os
-- lançamentos revertidos por uma medição cancelada ficam invisíveis até
-- para o admin. Como nenhuma outra policy de SELECT existe nessa tabela
-- (cliente e equipe sem o módulo não veem financeiro de jeito nenhum),
-- remover "ativo = true AND" não abre acesso a mais ninguém — só devolve a
-- visão dos próprios inativados para quem já podia editar.
DROP POLICY IF EXISTS lf_select ON lancamentos_financeiros;
CREATE POLICY lf_select ON lancamentos_financeiros FOR SELECT TO authenticated
  USING (pode_editar_financeiro());
