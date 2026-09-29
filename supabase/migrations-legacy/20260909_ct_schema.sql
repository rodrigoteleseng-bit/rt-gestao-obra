-- Controle Tecnológico do concreto usinado (Qualidade — 3º submódulo, ao
-- lado de FVS e Pendências). Ver docs/superpowers/specs/2026-09-09-controle-tecnologico-concreto-design.md
-- Fase 1: schema completo, mas ct_plantas/planta_id/pintura_url ficam
-- sem uso até a Fase 2 (ferramenta de pintura) — evita ALTER TABLE
-- quebrando o CHECK de novo quando essa fase chegar.

CREATE TABLE ct_plantas (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  obra_id       UUID NOT NULL REFERENCES obras(id),
  nome          TEXT NOT NULL CHECK (btrim(nome) <> ''),
  reutilizavel  BOOLEAN NOT NULL DEFAULT false,
  pdf_path      TEXT NOT NULL,
  imagem_path   TEXT NOT NULL,
  ativo         BOOLEAN NOT NULL DEFAULT true,
  criado_por    UUID NOT NULL DEFAULT auth.uid() REFERENCES perfis_usuario(id),
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TYPE status_concretagem AS ENUM ('aberta', 'finalizada');

CREATE TABLE ct_concretagens (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  obra_id                 UUID NOT NULL REFERENCES obras(id),
  unidade_id              UUID NOT NULL REFERENCES unidades(id),
  planta_id               UUID REFERENCES ct_plantas(id),
  pavimento_identificacao TEXT,
  anexo_url               TEXT,
  data                    DATE NOT NULL,
  status                  status_concretagem NOT NULL DEFAULT 'aberta',
  finalizada_por          UUID REFERENCES perfis_usuario(id),
  finalizada_em           TIMESTAMPTZ,
  ativo                   BOOLEAN NOT NULL DEFAULT true,
  criado_por              UUID NOT NULL DEFAULT auth.uid() REFERENCES perfis_usuario(id),
  criado_em               TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ct_concretagem_planta_xor_anexo CHECK (
    (planta_id IS NOT NULL AND anexo_url IS NULL) OR
    (planta_id IS NULL AND anexo_url IS NOT NULL)
  )
);
CREATE INDEX idx_ct_concretagens_obra ON ct_concretagens(obra_id);
CREATE INDEX idx_ct_concretagens_unidade ON ct_concretagens(unidade_id);

CREATE TYPE status_laudo_concreto AS ENUM ('pendente', 'aprovado', 'reprovado');

CREATE TABLE ct_caminhoes (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  concretagem_id        UUID NOT NULL REFERENCES ct_concretagens(id),
  fornecedor            TEXT NOT NULL CHECK (btrim(fornecedor) <> ''),
  nf                    TEXT NOT NULL CHECK (btrim(nf) <> ''),
  numero_amostra        TEXT NOT NULL CHECK (btrim(numero_amostra) <> ''),
  hora_saida_usina      TIMESTAMPTZ,
  hora_chegada_obra     TIMESTAMPTZ,
  hora_inicio_descarga  TIMESTAMPTZ,
  hora_fim_descarga     TIMESTAMPTZ,
  volume_m3             NUMERIC(8,2) NOT NULL CHECK (volume_m3 > 0),
  slump_solicitado_cm   NUMERIC(5,1),
  slump_medido_cm       NUMERIC(5,1),
  cor                   TEXT NOT NULL CHECK (cor ~* '^#[0-9a-f]{6}$'),
  pintura_url           TEXT,
  status_laudo          status_laudo_concreto NOT NULL DEFAULT 'pendente',
  laudo_url             TEXT,
  laudo_anexado_em      TIMESTAMPTZ,
  validado_por          UUID REFERENCES perfis_usuario(id),
  validado_em           TIMESTAMPTZ,
  pendencia_id          UUID REFERENCES pendencias(id),
  ativo                 BOOLEAN NOT NULL DEFAULT true,
  criado_por            UUID NOT NULL DEFAULT auth.uid() REFERENCES perfis_usuario(id),
  criado_em             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_ct_caminhoes_concretagem ON ct_caminhoes(concretagem_id);
CREATE INDEX idx_ct_caminhoes_status_laudo ON ct_caminhoes(status_laudo) WHERE status_laudo = 'pendente';

-- ── RLS ──
ALTER TABLE ct_plantas       ENABLE ROW LEVEL SECURITY;
ALTER TABLE ct_concretagens  ENABLE ROW LEVEL SECURITY;
ALTER TABLE ct_caminhoes     ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION pode_editar_controle_tecnologico()
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT meu_papel() = 'admin'
    OR (meu_papel() = 'equipe' AND 'controle_tecnologico' = ANY(meus_modulos()))
$$;

CREATE POLICY ct_plantas_select ON ct_plantas FOR SELECT
  USING ((ativo = true AND meu_papel() = ANY (ARRAY['admin', 'equipe']::papel_usuario[])) OR pode_editar_controle_tecnologico());
CREATE POLICY ct_plantas_insert ON ct_plantas FOR INSERT
  WITH CHECK (pode_editar_controle_tecnologico());
CREATE POLICY ct_plantas_update ON ct_plantas FOR UPDATE
  USING (pode_editar_controle_tecnologico()) WITH CHECK (pode_editar_controle_tecnologico());

CREATE POLICY ct_concretagens_select ON ct_concretagens FOR SELECT
  USING ((ativo = true AND meu_papel() = ANY (ARRAY['admin', 'equipe']::papel_usuario[])) OR pode_editar_controle_tecnologico());
CREATE POLICY ct_concretagens_insert ON ct_concretagens FOR INSERT
  WITH CHECK (pode_editar_controle_tecnologico());
CREATE POLICY ct_concretagens_update ON ct_concretagens FOR UPDATE
  USING (pode_editar_controle_tecnologico()) WITH CHECK (pode_editar_controle_tecnologico());

CREATE POLICY ct_caminhoes_select ON ct_caminhoes FOR SELECT
  USING ((ativo = true AND meu_papel() = ANY (ARRAY['admin', 'equipe']::papel_usuario[])) OR pode_editar_controle_tecnologico());
CREATE POLICY ct_caminhoes_insert ON ct_caminhoes FOR INSERT
  WITH CHECK (pode_editar_controle_tecnologico());
CREATE POLICY ct_caminhoes_update ON ct_caminhoes FOR UPDATE
  USING (pode_editar_controle_tecnologico()) WITH CHECK (pode_editar_controle_tecnologico());

-- ── Storage ──
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('controle-tecnologico', 'controle-tecnologico', false, 26214400, ARRAY['application/pdf', 'image/*'])
ON CONFLICT (id) DO NOTHING;

CREATE POLICY ct_storage_select ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'controle-tecnologico' AND meu_papel() IN ('admin', 'equipe'));
CREATE POLICY ct_storage_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'controle-tecnologico' AND pode_editar_controle_tecnologico());
