DROP POLICY IF EXISTS lf_select ON lancamentos_financeiros;
CREATE POLICY lf_select ON lancamentos_financeiros FOR SELECT TO authenticated
  USING (pode_editar_financeiro());
;
