-- Corrige INSERT bloqueado nas tabelas filhas do RDO apos o isolamento multiobra.
CREATE OR REPLACE FUNCTION pode_acessar_rdo(p_rdo UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM rdos r
    WHERE r.id = p_rdo AND pode_acessar_obra(r.obra_id)
  )
$$;
REVOKE ALL ON FUNCTION pode_acessar_rdo(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION pode_acessar_rdo(UUID) TO authenticated;

DROP POLICY IF EXISTS isolamento_obra ON rdo_atividades;
CREATE POLICY isolamento_obra ON rdo_atividades AS RESTRICTIVE FOR ALL TO authenticated
  USING (pode_acessar_rdo(rdo_id)) WITH CHECK (pode_acessar_rdo(rdo_id));
DROP POLICY IF EXISTS isolamento_obra ON rdo_efetivo;
CREATE POLICY isolamento_obra ON rdo_efetivo AS RESTRICTIVE FOR ALL TO authenticated
  USING (pode_acessar_rdo(rdo_id)) WITH CHECK (pode_acessar_rdo(rdo_id));
DROP POLICY IF EXISTS isolamento_obra ON rdo_fotos;
CREATE POLICY isolamento_obra ON rdo_fotos AS RESTRICTIVE FOR ALL TO authenticated
  USING (pode_acessar_rdo(rdo_id)) WITH CHECK (pode_acessar_rdo(rdo_id));
DROP POLICY IF EXISTS isolamento_obra ON rdo_audios;
CREATE POLICY isolamento_obra ON rdo_audios AS RESTRICTIVE FOR ALL TO authenticated
  USING (pode_acessar_rdo(rdo_id)) WITH CHECK (pode_acessar_rdo(rdo_id));
