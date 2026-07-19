-- Hardening de search_path — funções que ficaram de fora de
-- 20260717_hardening_funcoes_privilegiadas.sql
-- ============================================================
-- Achado ao checar o advisor de seguranca apos o fix de storage de
-- 18/07: a varredura de 17/07 fixou o search_path de uma lista
-- especifica de funcoes (RDO/FVS/numeracao/producao), mas nao cobriu
-- a familia pode_editar_* (porteiras de RLS usadas em quase todo
-- modulo) nem os triggers de calculo/trava que dependem delas.
-- Todas sao anteriores a 17/07 — nao sao codigo novo que escapou
-- depois, foram esquecidas na varredura original.
--
-- Nenhuma delas e SECURITY DEFINER (rodam como SECURITY INVOKER), mas
-- quase todas chamam meu_papel()/meus_modulos() (que SAO SECURITY
-- DEFINER, ja com search_path fixado) por referencia nao qualificada.
-- Sem o SET search_path proprio, a resolucao desse nome durante a
-- execucao ainda depende do search_path ativo na sessao de quem
-- chamou — mesma classe de risco ja corrigida nas outras funcoes.
-- Nao muda GRANT/REVOKE: nenhuma delas precisa disso, pois nao sao
-- SECURITY DEFINER.

ALTER FUNCTION pode_editar_rdo() SET search_path = public;
ALTER FUNCTION pode_editar_fvs() SET search_path = public;
ALTER FUNCTION pode_editar_pendencias() SET search_path = public;
ALTER FUNCTION pode_editar_compras() SET search_path = public;
ALTER FUNCTION pode_editar_almoxarifado() SET search_path = public;
ALTER FUNCTION pode_editar_efetivo() SET search_path = public;
ALTER FUNCTION pode_editar_definicoes() SET search_path = public;
ALTER FUNCTION pode_editar_contratos() SET search_path = public;
ALTER FUNCTION pode_editar_medicoes() SET search_path = public;

ALTER FUNCTION restringir_vencedor_item() SET search_path = public;
ALTER FUNCTION recalcular_status_pedido() SET search_path = public;
ALTER FUNCTION saldo_material(UUID) SET search_path = public;
ALTER FUNCTION valida_movimento_estoque() SET search_path = public;
ALTER FUNCTION proximo_codigo_material(UUID) SET search_path = public;
ALTER FUNCTION restringir_status_contrato() SET search_path = public;
ALTER FUNCTION recalcular_valor_contrato() SET search_path = public;
ALTER FUNCTION restringir_status_medicao() SET search_path = public;
ALTER FUNCTION calcular_valor_item_medicao() SET search_path = public;
ALTER FUNCTION recalcular_valor_medicao() SET search_path = public;
ALTER FUNCTION validar_saldo_medicao() SET search_path = public;
ALTER FUNCTION proteger_valores_medicao() SET search_path = public;
