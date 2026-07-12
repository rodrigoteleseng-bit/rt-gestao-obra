-- ============================================================
-- Fase 7 — Gestão de Efetivo | RT Engenharia
-- Spec: docs/superpowers/specs/2026-07-12-fase7-efetivo-design.md
-- ============================================================

CREATE TABLE trabalhadores (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  obra_id        UUID NOT NULL REFERENCES obras(id) ON DELETE CASCADE,
  nome           TEXT NOT NULL,
  funcao         TEXT NOT NULL,
  empresa        TEXT,
  data_admissao  DATE,
  ativo          BOOLEAN NOT NULL DEFAULT true,
  criado_por     UUID NOT NULL DEFAULT auth.uid() REFERENCES perfis_usuario(id),
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_trabalhadores_obra ON trabalhadores(obra_id) WHERE ativo;

CREATE TABLE efetivo_chamadas (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  obra_id     UUID NOT NULL REFERENCES obras(id) ON DELETE CASCADE,
  data        DATE NOT NULL,
  criado_por  UUID NOT NULL DEFAULT auth.uid() REFERENCES perfis_usuario(id),
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (obra_id, data)
);

CREATE TABLE efetivo_presencas (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chamada_id      UUID NOT NULL REFERENCES efetivo_chamadas(id) ON DELETE CASCADE,
  trabalhador_id  UUID NOT NULL REFERENCES trabalhadores(id),
  presente        BOOLEAN NOT NULL,
  criado_por      UUID NOT NULL DEFAULT auth.uid() REFERENCES perfis_usuario(id),
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (chamada_id, trabalhador_id)
);
CREATE INDEX idx_presencas_chamada ON efetivo_presencas(chamada_id);

-- ---------- permissão ----------
CREATE OR REPLACE FUNCTION pode_editar_efetivo()
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT meu_papel() = 'admin'
    OR (meu_papel() = 'equipe' AND 'efetivo' = ANY(meus_modulos()))
$$;

-- ---------- RLS ----------
ALTER TABLE trabalhadores       ENABLE ROW LEVEL SECURITY;
ALTER TABLE efetivo_chamadas    ENABLE ROW LEVEL SECURITY;
ALTER TABLE efetivo_presencas   ENABLE ROW LEVEL SECURITY;

-- Leitura: admin e equipe (qualquer módulo — quem lê RDO precisa ver o resumo
-- de presença sem precisar do módulo 'efetivo' habilitado). Cliente não vê.
CREATE POLICY trab_select ON trabalhadores FOR SELECT
  USING (ativo = true AND meu_papel() IN ('admin', 'equipe'));
CREATE POLICY trab_insert ON trabalhadores FOR INSERT
  WITH CHECK (pode_editar_efetivo() AND criado_por = auth.uid());
CREATE POLICY trab_update ON trabalhadores FOR UPDATE
  USING (pode_editar_efetivo()) WITH CHECK (pode_editar_efetivo());

CREATE POLICY chamada_select ON efetivo_chamadas FOR SELECT
  USING (meu_papel() IN ('admin', 'equipe'));
CREATE POLICY chamada_insert ON efetivo_chamadas FOR INSERT
  WITH CHECK (pode_editar_efetivo() AND criado_por = auth.uid());

CREATE POLICY presenca_select ON efetivo_presencas FOR SELECT
  USING (meu_papel() IN ('admin', 'equipe'));
CREATE POLICY presenca_insert ON efetivo_presencas FOR INSERT
  WITH CHECK (pode_editar_efetivo() AND criado_por = auth.uid());
CREATE POLICY presenca_update ON efetivo_presencas FOR UPDATE
  USING (pode_editar_efetivo()) WITH CHECK (pode_editar_efetivo());
