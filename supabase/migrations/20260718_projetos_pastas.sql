-- ============================================================
-- FASE 7 — PROJETOS | PASTAS LIVRES
-- ============================================================
-- Substitui categorias fixas por pastas cadastráveis por obra.
-- A ordem das operações preserva documentos reais já cadastrados.

CREATE TABLE projetos_pastas (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  obra_id     UUID NOT NULL REFERENCES obras(id) ON DELETE CASCADE,
  nome        TEXT NOT NULL,
  ativo       BOOLEAN NOT NULL DEFAULT true,
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT now(),
  criado_por  UUID NOT NULL DEFAULT auth.uid() REFERENCES perfis_usuario(id),
  CONSTRAINT projetos_pastas_nome_not_blank CHECK (btrim(nome) <> '')
);

CREATE UNIQUE INDEX idx_projetos_pastas_nome_unico
  ON projetos_pastas(obra_id, lower(nome)) WHERE ativo;
CREATE INDEX idx_projetos_pastas_obra ON projetos_pastas(obra_id) WHERE ativo;

ALTER TABLE projetos_pastas ENABLE ROW LEVEL SECURITY;

CREATE POLICY isolamento_obra ON projetos_pastas AS RESTRICTIVE FOR ALL TO authenticated
  USING (pode_acessar_obra(obra_id))
  WITH CHECK (pode_acessar_obra(obra_id));

CREATE POLICY projetos_pastas_select ON projetos_pastas FOR SELECT TO authenticated
  USING (ativo = true OR pode_editar_projetos());
CREATE POLICY projetos_pastas_insert ON projetos_pastas FOR INSERT TO authenticated
  WITH CHECK (pode_editar_projetos());
CREATE POLICY projetos_pastas_update ON projetos_pastas FOR UPDATE TO authenticated
  USING (pode_editar_projetos())
  WITH CHECK (pode_editar_projetos());

INSERT INTO projetos_pastas (obra_id, nome, criado_por)
SELECT DISTINCT d.obra_id,
  CASE d.categoria
    WHEN 'projeto_executivo' THEN 'Projeto Executivo'
    WHEN 'memorial' THEN 'Memorial'
    WHEN 'administrativo' THEN 'Administrativo'
  END,
  (SELECT id FROM perfis_usuario WHERE papel = 'admin' AND ativo ORDER BY criado_em LIMIT 1)
FROM projetos_documentos d;

ALTER TABLE projetos_documentos ADD COLUMN pasta_id UUID REFERENCES projetos_pastas(id);

UPDATE projetos_documentos d
SET pasta_id = p.id
FROM projetos_pastas p
WHERE p.obra_id = d.obra_id
  AND p.nome = CASE d.categoria
    WHEN 'projeto_executivo' THEN 'Projeto Executivo'
    WHEN 'memorial' THEN 'Memorial'
    WHEN 'administrativo' THEN 'Administrativo'
  END;

ALTER TABLE projetos_documentos ALTER COLUMN pasta_id SET NOT NULL;

DROP INDEX IF EXISTS idx_projetos_documentos_categoria;
CREATE INDEX idx_projetos_documentos_pasta ON projetos_documentos(obra_id, pasta_id) WHERE ativo;

ALTER TABLE projetos_documentos DROP COLUMN categoria;
DROP TYPE categoria_documento_projeto;
