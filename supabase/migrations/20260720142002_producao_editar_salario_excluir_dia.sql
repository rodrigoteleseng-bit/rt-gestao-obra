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
;
