-- ============================================================
-- FIX — Planejamento: fechar semana nao travado no RLS + semana
-- fechada e restricao resolvida nao eram imutaveis | RT Engenharia
-- ============================================================
-- Achado na revisao obrigatoria pos-commit do modulo Planejamento
-- (20260719_planejamento.sql), antes do teste de campo do Rodrigo:
--
-- 1. A regra aprovada na spec ("fechar semana e exclusivo do admin")
--    so era checada dentro da RPC fechar_semana_planejamento — a
--    policy de UPDATE de planejamento_semanas permitia qualquer
--    equipe com o modulo escrever status='fechada' direto via API,
--    pulando o calculo de PPC e a exigencia de motivo.
-- 2. O trigger de imutabilidade so protegia planejamento_compromissos
--    depois de fechada — a propria linha de planejamento_semanas
--    (ppc, datas) continuava editavel depois de fechada, e uma
--    restricao resolvida podia ser reaberta, quebrando o historico
--    imutavel e a regra "nao pode ser reaberta" da spec.
--
-- Falha da spec/plano original (Claude Code), nao do Codex, que
-- implementou fielmente o que foi passado.

DROP POLICY planejamento_semanas_update ON planejamento_semanas;
CREATE POLICY planejamento_semanas_update ON planejamento_semanas FOR UPDATE TO authenticated
  USING (pode_editar_planejamento())
  WITH CHECK (pode_editar_planejamento() AND (status <> 'fechada' OR meu_papel() = 'admin'));

CREATE OR REPLACE FUNCTION travar_semana_fechada()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.status = 'fechada' THEN
    RAISE EXCEPTION 'Semana fechada: nao pode mais ser alterada.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_travar_semana_fechada
  BEFORE UPDATE ON planejamento_semanas
  FOR EACH ROW EXECUTE FUNCTION travar_semana_fechada();

CREATE OR REPLACE FUNCTION impedir_reabertura_restricao()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.status = 'resolvida' AND NEW.status = 'aberta' THEN
    RAISE EXCEPTION 'Restricao resolvida nao pode ser reaberta. Cadastre uma restricao nova.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_impedir_reabertura_restricao
  BEFORE UPDATE ON restricoes
  FOR EACH ROW EXECUTE FUNCTION impedir_reabertura_restricao();

REVOKE ALL ON FUNCTION travar_semana_fechada() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION impedir_reabertura_restricao() FROM PUBLIC, anon, authenticated;
