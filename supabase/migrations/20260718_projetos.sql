-- ============================================================
-- FASE 7 — PROJETOS | RT Engenharia
-- ============================================================
-- Repositorio versionado de documentos da obra, com historico
-- append-only de revisoes em PDF e leitura liberada ao cliente.
--
-- Nota de aplicacao: o ALTER TYPE modulo_app ADD VALUE precisa ser
-- executado em transacao separada do restante da migracao no Supabase.

ALTER TYPE modulo_app ADD VALUE IF NOT EXISTS 'projetos';

CREATE TYPE categoria_documento_projeto AS ENUM (
  'projeto_executivo',
  'memorial',
  'administrativo'
);

CREATE TABLE projetos_documentos (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  obra_id     UUID NOT NULL REFERENCES obras(id) ON DELETE CASCADE,
  titulo      TEXT NOT NULL,
  categoria   categoria_documento_projeto NOT NULL,
  descricao   TEXT,
  ativo       BOOLEAN NOT NULL DEFAULT true,
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT now(),
  criado_por  UUID NOT NULL DEFAULT auth.uid() REFERENCES perfis_usuario(id),
  CONSTRAINT projetos_documentos_titulo_not_blank CHECK (btrim(titulo) <> '')
);

CREATE INDEX idx_projetos_documentos_obra ON projetos_documentos(obra_id) WHERE ativo;
CREATE INDEX idx_projetos_documentos_categoria ON projetos_documentos(obra_id, categoria) WHERE ativo;

CREATE TABLE projetos_revisoes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  documento_id  UUID NOT NULL REFERENCES projetos_documentos(id) ON DELETE CASCADE,
  revisao       TEXT NOT NULL,
  path          TEXT NOT NULL,
  observacao    TEXT,
  atual         BOOLEAN NOT NULL DEFAULT true,
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
  criado_por    UUID NOT NULL DEFAULT auth.uid() REFERENCES perfis_usuario(id),
  CONSTRAINT projetos_revisoes_revisao_not_blank CHECK (btrim(revisao) <> '')
);

CREATE INDEX idx_projetos_revisoes_documento ON projetos_revisoes(documento_id, criado_em DESC);
CREATE UNIQUE INDEX idx_projetos_revisoes_unica_atual ON projetos_revisoes(documento_id) WHERE atual;

CREATE OR REPLACE FUNCTION marcar_revisao_atual()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE projetos_revisoes
  SET atual = false
  WHERE documento_id = NEW.documento_id
    AND atual = true;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_marcar_revisao_atual
  BEFORE INSERT ON projetos_revisoes
  FOR EACH ROW EXECUTE FUNCTION marcar_revisao_atual();

ALTER TABLE projetos_documentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE projetos_revisoes ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION pode_editar_projetos()
RETURNS boolean
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT meu_papel() = 'admin'
    OR (meu_papel() = 'equipe' AND 'projetos' = ANY(meus_modulos()))
$$;

CREATE POLICY isolamento_obra ON projetos_documentos AS RESTRICTIVE FOR ALL TO authenticated
  USING (pode_acessar_obra(obra_id))
  WITH CHECK (pode_acessar_obra(obra_id));

CREATE POLICY isolamento_obra ON projetos_revisoes AS RESTRICTIVE FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM projetos_documentos d WHERE d.id = documento_id AND pode_acessar_obra(d.obra_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM projetos_documentos d WHERE d.id = documento_id AND pode_acessar_obra(d.obra_id)));

CREATE POLICY projetos_documentos_select ON projetos_documentos FOR SELECT TO authenticated
  USING (ativo = true OR pode_editar_projetos());
CREATE POLICY projetos_documentos_insert ON projetos_documentos FOR INSERT TO authenticated
  WITH CHECK (pode_editar_projetos());
CREATE POLICY projetos_documentos_update ON projetos_documentos FOR UPDATE TO authenticated
  USING (pode_editar_projetos())
  WITH CHECK (pode_editar_projetos());

CREATE POLICY projetos_revisoes_select ON projetos_revisoes FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM projetos_documentos d
    WHERE d.id = documento_id AND (d.ativo = true OR pode_editar_projetos())
  ));
CREATE POLICY projetos_revisoes_insert ON projetos_revisoes FOR INSERT TO authenticated
  WITH CHECK (pode_editar_projetos() AND EXISTS (
    SELECT 1 FROM projetos_documentos d WHERE d.id = documento_id AND d.ativo = true
  ));

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('projetos', 'projetos', false, 20971520, ARRAY['application/pdf'])
ON CONFLICT (id) DO NOTHING;

CREATE POLICY projetos_storage_select ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'projetos');
CREATE POLICY projetos_storage_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'projetos' AND pode_editar_projetos());

DROP POLICY isolamento_obra_storage ON storage.objects;

CREATE POLICY isolamento_obra_storage ON storage.objects AS RESTRICTIVE FOR ALL TO authenticated
USING (
  bucket_id NOT IN ('rdo','fvs','pendencias','cotacoes-nf','projetos')
  OR CASE
    WHEN bucket_id IN ('rdo','fvs','pendencias','projetos') THEN
      split_part(name,'/',1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      AND pode_acessar_obra(split_part(name,'/',1)::UUID)
    WHEN bucket_id = 'cotacoes-nf' THEN
      split_part(name,'/',1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      AND EXISTS (
        SELECT 1 FROM pedidos_compra p
        WHERE p.id=split_part(name,'/',1)::UUID AND pode_acessar_obra(p.obra_id)
      )
    ELSE false
  END
)
WITH CHECK (
  bucket_id NOT IN ('rdo','fvs','pendencias','cotacoes-nf','projetos')
  OR CASE
    WHEN bucket_id IN ('rdo','fvs','pendencias','projetos') THEN
      split_part(name,'/',1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      AND pode_acessar_obra(split_part(name,'/',1)::UUID)
    WHEN bucket_id = 'cotacoes-nf' THEN
      split_part(name,'/',1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      AND EXISTS (
        SELECT 1 FROM pedidos_compra p
        WHERE p.id=split_part(name,'/',1)::UUID AND pode_acessar_obra(p.obra_id)
      )
    ELSE false
  END
);

REVOKE ALL ON FUNCTION marcar_revisao_atual() FROM PUBLIC, anon, authenticated;
