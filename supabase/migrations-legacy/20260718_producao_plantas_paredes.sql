-- ============================================================
-- PRODUCAO PROPRIA - CATALOGO DE PLANTAS E PAREDES | RT Engenharia
-- ============================================================
-- Planta em PDF (convertida para imagem no upload) por pavimento da
-- planta "Sobrado Tipo", reaproveitada nos 13 sobrados. Paredes sao
-- cadastradas uma vez (faixa clicavel + metas de area); o progresso
-- por sobrado fica na Task 2 (producao_paredes_progresso).
-- Decisoes do Rodrigo em 17/07/2026 - ver
-- docs/superpowers/specs/2026-07-17-producao-selecao-parede-pdf-design.md

CREATE TABLE producao_plantas (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  obra_id      UUID NOT NULL REFERENCES obras(id) ON DELETE CASCADE,
  pavimento    TEXT NOT NULL CHECK (pavimento IN ('terreo', 'superior', 'platibanda', 'caixa_agua')),
  pdf_path     TEXT NOT NULL,
  imagem_path  TEXT NOT NULL,
  ativo        BOOLEAN NOT NULL DEFAULT true,
  criado_por   UUID NOT NULL DEFAULT auth.uid() REFERENCES perfis_usuario(id),
  criado_em    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (obra_id, pavimento)
);

CREATE TABLE producao_paredes (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  planta_id         UUID NOT NULL REFERENCES producao_plantas(id) ON DELETE CASCADE,
  nome              TEXT NOT NULL CHECK (btrim(nome) <> ''),
  pos_x             NUMERIC(6,3) NOT NULL CHECK (pos_x >= 0 AND pos_x <= 100),
  pos_y             NUMERIC(6,3) NOT NULL CHECK (pos_y >= 0 AND pos_y <= 100),
  largura           NUMERIC(6,3) NOT NULL CHECK (largura > 0 AND largura <= 100),
  altura_px         NUMERIC(6,3) NOT NULL CHECK (altura_px > 0 AND altura_px <= 100),
  meta_alvenaria_m2 NUMERIC(10,4) CHECK (meta_alvenaria_m2 IS NULL OR meta_alvenaria_m2 > 0),
  meta_reboco_a_m2  NUMERIC(10,4) CHECK (meta_reboco_a_m2 IS NULL OR meta_reboco_a_m2 > 0),
  meta_reboco_b_m2  NUMERIC(10,4) CHECK (meta_reboco_b_m2 IS NULL OR meta_reboco_b_m2 > 0),
  ativo             BOOLEAN NOT NULL DEFAULT true,
  criado_por        UUID NOT NULL DEFAULT auth.uid() REFERENCES perfis_usuario(id),
  criado_em         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT pelo_menos_uma_meta CHECK (
    meta_alvenaria_m2 IS NOT NULL OR meta_reboco_a_m2 IS NOT NULL OR meta_reboco_b_m2 IS NOT NULL
  )
);
CREATE INDEX idx_prod_paredes_planta ON producao_paredes(planta_id) WHERE ativo;

-- ---------- Storage ----------
INSERT INTO storage.buckets (id, name, public) VALUES ('producao-plantas', 'producao-plantas', false)
ON CONFLICT (id) DO NOTHING;
UPDATE storage.buckets
SET file_size_limit = 26214400, allowed_mime_types = ARRAY['application/pdf', 'image/*']
WHERE id = 'producao-plantas';

-- ---------- RLS ----------
CREATE OR REPLACE FUNCTION pode_acessar_planta(p_planta UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM producao_plantas pl WHERE pl.id = p_planta AND pode_acessar_obra(pl.obra_id)
  )
$$;
REVOKE ALL ON FUNCTION pode_acessar_planta(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION pode_acessar_planta(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION pode_acessar_parede(p_parede UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM producao_paredes pp
    JOIN producao_plantas pl ON pl.id = pp.planta_id
    WHERE pp.id = p_parede AND pode_acessar_obra(pl.obra_id)
  )
$$;
REVOKE ALL ON FUNCTION pode_acessar_parede(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION pode_acessar_parede(UUID) TO authenticated;

ALTER TABLE producao_plantas ENABLE ROW LEVEL SECURITY;
ALTER TABLE producao_paredes ENABLE ROW LEVEL SECURITY;

CREATE POLICY prod_plantas_select ON producao_plantas FOR SELECT
  USING ((ativo AND meu_papel() IN ('admin','equipe')) OR pode_editar_medicoes());
CREATE POLICY prod_plantas_insert ON producao_plantas FOR INSERT
  WITH CHECK (pode_editar_medicoes() AND criado_por = auth.uid());
CREATE POLICY prod_plantas_update ON producao_plantas FOR UPDATE
  USING (pode_editar_medicoes()) WITH CHECK (pode_editar_medicoes());
CREATE POLICY isolamento_obra ON producao_plantas AS RESTRICTIVE FOR ALL TO authenticated
  USING (pode_acessar_obra(obra_id)) WITH CHECK (pode_acessar_obra(obra_id));

CREATE POLICY prod_paredes_select ON producao_paredes FOR SELECT
  USING ((ativo AND meu_papel() IN ('admin','equipe')) OR pode_editar_medicoes());
CREATE POLICY prod_paredes_insert ON producao_paredes FOR INSERT
  WITH CHECK (pode_editar_medicoes() AND criado_por = auth.uid());
CREATE POLICY prod_paredes_update ON producao_paredes FOR UPDATE
  USING (pode_editar_medicoes()) WITH CHECK (pode_editar_medicoes());
CREATE POLICY isolamento_obra ON producao_paredes AS RESTRICTIVE FOR ALL TO authenticated
  USING (pode_acessar_parede(id)) WITH CHECK (pode_acessar_parede(id));

CREATE POLICY prodplantas_storage_select ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'producao-plantas' AND pode_acessar_obra(split_part(name,'/',1)::UUID));
CREATE POLICY prodplantas_storage_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'producao-plantas' AND pode_editar_medicoes() AND pode_acessar_obra(split_part(name,'/',1)::UUID));
