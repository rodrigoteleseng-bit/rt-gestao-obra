-- Hardening das funções SECURITY DEFINER.
-- Por padrão, PostgreSQL concede EXECUTE a PUBLIC; no Supabase isso inclui anon.

ALTER FUNCTION meu_papel() SET search_path = public;
ALTER FUNCTION meus_modulos() SET search_path = public;
ALTER FUNCTION handle_new_user() SET search_path = public;
ALTER FUNCTION definir_quantidade_tarefa(UUID, NUMERIC, TEXT) SET search_path = public;
ALTER FUNCTION rdo_em_rascunho(UUID) SET search_path = public;
ALTER FUNCTION fvs_nao_aprovada(UUID) SET search_path = public;
ALTER FUNCTION fvs_verificacao_aberta(UUID) SET search_path = public;
ALTER FUNCTION concluir_verificacao_fvs(UUID, status_fvs, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT) SET search_path = public;
ALTER FUNCTION nova_verificacao_fvs(UUID) SET search_path = public;
ALTER FUNCTION excluir_fvs(UUID) SET search_path = public;
ALTER FUNCTION gerar_bloco_requisicoes(UUID, INTEGER) SET search_path = public;
ALTER FUNCTION sincroniza_recebimento_pedido() SET search_path = public;
ALTER FUNCTION proximo_numero_pedido() SET search_path = public;
ALTER FUNCTION proximo_numero_contrato() SET search_path = public;
ALTER FUNCTION proximo_numero_medicao() SET search_path = public;
ALTER FUNCTION producao_numero_medicao() SET search_path = public;
ALTER FUNCTION producao_recalcular(UUID) SET search_path = public;
ALTER FUNCTION producao_recalcular_trigger() SET search_path = public;

REVOKE ALL ON FUNCTION meu_papel() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION meus_modulos() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION definir_quantidade_tarefa(UUID, NUMERIC, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION rdo_em_rascunho(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION fvs_nao_aprovada(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION fvs_verificacao_aberta(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION concluir_verificacao_fvs(UUID, status_fvs, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION nova_verificacao_fvs(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION excluir_fvs(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION gerar_bloco_requisicoes(UUID, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION sincroniza_recebimento_pedido() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION proximo_numero_pedido() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION proximo_numero_contrato() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION proximo_numero_medicao() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION producao_numero_medicao() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION producao_recalcular(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION producao_recalcular_trigger() FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION producao_aprovar_medicao(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION producao_cadastrar_salario(UUID, UUID, TEXT, NUMERIC, DATE) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION producao_cancelar_medicao(UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION producao_criar_lancamento(UUID, UUID, DATE, tipo_servico_producao, TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT, UUID[], JSONB) FROM PUBLIC, anon, authenticated;

-- Helpers usados pelas policies RLS.
GRANT EXECUTE ON FUNCTION meu_papel() TO authenticated;
GRANT EXECUTE ON FUNCTION meus_modulos() TO authenticated;
GRANT EXECUTE ON FUNCTION rdo_em_rascunho(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION fvs_nao_aprovada(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION fvs_verificacao_aberta(UUID) TO authenticated;

-- RPCs efetivamente chamadas pela interface.
GRANT EXECUTE ON FUNCTION definir_quantidade_tarefa(UUID, NUMERIC, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION concluir_verificacao_fvs(UUID, status_fvs, TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION nova_verificacao_fvs(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION excluir_fvs(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION gerar_bloco_requisicoes(UUID, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION producao_aprovar_medicao(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION producao_cadastrar_salario(UUID, UUID, TEXT, NUMERIC, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION producao_cancelar_medicao(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION producao_criar_lancamento(UUID, UUID, DATE, tipo_servico_producao, TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT, UUID[], JSONB) TO authenticated;
