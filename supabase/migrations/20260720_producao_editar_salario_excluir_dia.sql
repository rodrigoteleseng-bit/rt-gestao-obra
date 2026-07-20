-- ============================================================
-- FIX — Produção própria: permitir editar vigência salarial e
-- excluir dia salarial lançado errado | RT Engenharia
-- ============================================================
-- Rodrigo reportou nao conseguir corrigir uma vigencia salarial
-- lancada com data errada, nem reduzir um periodo de dia salarial ja
-- lancado (ex.: lancou 01/07 a 19/07, queria terminar em 14/07). A
-- tela nunca teve edicao/exclusao pra nenhum dos dois — nao e bug,
-- e funcionalidade que faltou construir (RLS de UPDATE ja permite
-- pode_editar_medicoes() nas duas tabelas desde 20260716).
--
-- Unica trava que faltava no banco: um dia salarial ja vinculado a
-- uma medicao (aprovada) nao pode ser editado nem excluido direto —
-- só pode ser desvinculado pelo cancelamento da propria medicao
-- (producao_cancelar_medicao, que zera medicao_id). Sem essa trava,
-- excluir um dia ja usado numa medicao aprovada corromperia o
-- historico imutavel sem passar pelo fluxo de cancelamento.

CREATE OR REPLACE FUNCTION producao_travar_dia_salarial_medido()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.medicao_id IS NOT NULL AND NEW.medicao_id IS NOT DISTINCT FROM OLD.medicao_id THEN
    RAISE EXCEPTION 'Dia salarial vinculado a uma medicao nao pode ser editado ou excluido diretamente. Cancele a medicao pra liberar.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_prod_travar_dia_salarial_medido
  BEFORE UPDATE ON producao_dias_salariais
  FOR EACH ROW EXECUTE FUNCTION producao_travar_dia_salarial_medido();

REVOKE ALL ON FUNCTION producao_travar_dia_salarial_medido() FROM PUBLIC, anon, authenticated;
