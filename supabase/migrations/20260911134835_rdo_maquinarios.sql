CREATE TABLE rdo_maquinarios (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rdo_id     UUID NOT NULL REFERENCES rdos(id) ON DELETE CASCADE,
  maquina    TEXT NOT NULL,
  periodo    TEXT NOT NULL,
  situacao   TEXT NOT NULL DEFAULT 'em_operacao' CHECK (situacao IN ('em_operacao', 'parada', 'manutencao')),
  ativo      BOOLEAN NOT NULL DEFAULT true,
  criado_em  TIMESTAMPTZ NOT NULL DEFAULT now(),
  criado_por UUID NOT NULL DEFAULT auth.uid() REFERENCES perfis_usuario(id)
);

CREATE INDEX idx_rdo_maquinarios_rdo ON rdo_maquinarios(rdo_id);

ALTER TABLE rdo_maquinarios ENABLE ROW LEVEL SECURITY;

CREATE POLICY rdo_maq_select ON rdo_maquinarios FOR SELECT USING (ativo = true);
CREATE POLICY rdo_maq_insert ON rdo_maquinarios FOR INSERT
  WITH CHECK (pode_editar_rdo() AND rdo_em_rascunho(rdo_id));
CREATE POLICY rdo_maq_update ON rdo_maquinarios FOR UPDATE
  USING (pode_editar_rdo() AND rdo_em_rascunho(rdo_id))
  WITH CHECK (pode_editar_rdo() AND rdo_em_rascunho(rdo_id));;
