-- Ajustes pós-revisão: leitura sem redundância e imutabilidade após entrega.

DROP POLICY IF EXISTS floc_select ON ferramenta_locacoes;
DROP POLICY IF EXISTS floc_update ON ferramenta_locacoes;

CREATE POLICY floc_select ON ferramenta_locacoes FOR SELECT TO authenticated
  USING (ativo = true AND pode_editar_almoxarifado());

CREATE POLICY floc_update ON ferramenta_locacoes FOR UPDATE TO authenticated
  USING (pode_editar_almoxarifado() AND data_entregue IS NULL)
  WITH CHECK (pode_editar_almoxarifado());
