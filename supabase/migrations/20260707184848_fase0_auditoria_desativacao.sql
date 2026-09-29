ALTER TABLE perfis_usuario
  ADD COLUMN desativado_em TIMESTAMPTZ,
  ADD COLUMN desativado_por UUID REFERENCES perfis_usuario(id);;
