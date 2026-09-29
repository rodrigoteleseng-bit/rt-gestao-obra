-- Maquinário do dia no RDO — máquina/equipamento em uso, período de
-- trabalho e situação. Mesmo padrão de rdo_efetivo/rdo_atividades:
-- soft delete, editável só enquanto o RDO pai está em rascunho.
-- Ver docs/superpowers/specs (redesenho do RDO, 2026-09-11).

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

-- Mesmo padrão de rdo_efetivo: leitura pra qualquer autenticado (cliente
-- vê o RDO), escrita restrita a quem edita o módulo RDO, só com o RDO
-- pai em rascunho (rdo_em_rascunho já existe, criada em 20260708_fase4_rdo.sql).
CREATE POLICY rdo_maq_select ON rdo_maquinarios FOR SELECT USING (ativo = true);
CREATE POLICY rdo_maq_insert ON rdo_maquinarios FOR INSERT
  WITH CHECK (pode_editar_rdo() AND rdo_em_rascunho(rdo_id));
CREATE POLICY rdo_maq_update ON rdo_maquinarios FOR UPDATE
  USING (pode_editar_rdo() AND rdo_em_rascunho(rdo_id))
  WITH CHECK (pode_editar_rdo() AND rdo_em_rascunho(rdo_id));
