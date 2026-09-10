-- Achado na revisao final de branch: ct_restringir_laudo() e
-- ct_gerar_pendencia_reprovado() (Task 2) ficaram de fora do hardening
-- de search_path aplicado ao resto do Controle Tecnologico
-- (20260909_ct_schema_hardening.sql) -- mesmo padrao ja usado em toda
-- funcao de trigger de restricao/geracao do projeto desde
-- 20260719_hardening_pode_editar_e_triggers.sql.
ALTER FUNCTION ct_restringir_laudo() SET search_path = public;
ALTER FUNCTION ct_gerar_pendencia_reprovado() SET search_path = public;
