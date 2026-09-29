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
;
