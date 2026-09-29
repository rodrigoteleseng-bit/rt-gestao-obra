-- Trava a alteração de pintura_url quando a concretagem já está finalizada --
-- a policy ct_caminhoes_update de hoje não distingue esse caso (ela deixa os
-- campos de laudo editáveis de propósito mesmo com a concretagem finalizada,
-- então não dá pra travar via policy geral sem quebrar isso). Mesmo padrão de
-- ct_restringir_laudo (supabase/migrations/20260909_ct_triggers.sql).
-- Ver docs/superpowers/specs/2026-09-10-ct-pintura-fase2-design.md §8.

CREATE OR REPLACE FUNCTION ct_restringir_pintura() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_status status_concretagem;
BEGIN
  IF NEW.pintura_url IS DISTINCT FROM OLD.pintura_url THEN
    SELECT status INTO v_status FROM ct_concretagens WHERE id = NEW.concretagem_id;
    IF v_status = 'finalizada' THEN
      RAISE EXCEPTION 'Não é possível alterar a pintura de uma concretagem já finalizada.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_ct_restringir_pintura
  BEFORE UPDATE ON ct_caminhoes
  FOR EACH ROW EXECUTE FUNCTION ct_restringir_pintura();
