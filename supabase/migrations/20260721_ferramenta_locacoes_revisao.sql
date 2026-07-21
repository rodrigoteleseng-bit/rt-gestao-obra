-- Ajustes pós-revisão: leitura preparada para soft delete futuro,
-- imutabilidade após entrega e auditoria de correções.

ALTER TABLE ferramenta_locacoes
  ADD COLUMN IF NOT EXISTS editado_por UUID REFERENCES perfis_usuario(id),
  ADD COLUMN IF NOT EXISTS editado_em TIMESTAMPTZ;

DROP POLICY IF EXISTS floc_select ON ferramenta_locacoes;
DROP POLICY IF EXISTS floc_update ON ferramenta_locacoes;

CREATE POLICY floc_select ON ferramenta_locacoes FOR SELECT TO authenticated
  USING ((ativo = true OR pode_editar_almoxarifado()) AND pode_editar_almoxarifado());

CREATE POLICY floc_update ON ferramenta_locacoes FOR UPDATE TO authenticated
  USING (pode_editar_almoxarifado() AND data_entregue IS NULL)
  WITH CHECK (pode_editar_almoxarifado());
