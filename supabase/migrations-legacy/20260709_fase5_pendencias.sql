-- ============================================================
-- FASE 5 — PENDÊNCIAS | RT Engenharia
-- ============================================================
-- Pendências de obra por unidade (mín.) + tarefa do cronograma
-- (opcional). Fluxo: aberta → em_correcao → resolvida.
-- Histórico imutável de eventos; fotos com carimbo jurídico
-- (mesmo padrão do RDO: GPS + data/hora + hash SHA-256).
-- Cliente NÃO vê pendências (CLAUDE.md §2).
-- Decisões do Rodrigo em 09/07/2026.

CREATE TYPE status_pendencia AS ENUM ('aberta', 'em_correcao', 'resolvida');

CREATE TABLE pendencias (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  obra_id       UUID NOT NULL REFERENCES obras(id) ON DELETE CASCADE,
  unidade_id    UUID NOT NULL REFERENCES unidades(id),
  tarefa_id     UUID REFERENCES cronograma_tarefas(id),
  descricao     TEXT NOT NULL,
  responsavel   TEXT,
  prazo         DATE,
  status        status_pendencia NOT NULL DEFAULT 'aberta',
  resolvida_em  TIMESTAMPTZ,
  resolvida_por UUID REFERENCES perfis_usuario(id),
  ativo         BOOLEAN NOT NULL DEFAULT true,
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
  criado_por    UUID NOT NULL DEFAULT auth.uid() REFERENCES perfis_usuario(id)
);

-- Histórico de mudanças de status: só INSERT (imutável).
CREATE TABLE pendencia_eventos (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pendencia_id  UUID NOT NULL REFERENCES pendencias(id) ON DELETE CASCADE,
  status        status_pendencia NOT NULL,
  comentario    TEXT,
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
  criado_por    UUID NOT NULL DEFAULT auth.uid() REFERENCES perfis_usuario(id)
);

CREATE TABLE pendencia_fotos (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pendencia_id  UUID NOT NULL REFERENCES pendencias(id) ON DELETE CASCADE,
  path          TEXT NOT NULL,          -- caminho no bucket 'pendencias'
  legenda       TEXT,
  lat           NUMERIC(10,7),
  lng           NUMERIC(10,7),
  precisao_m    NUMERIC(8,1),
  capturada_em  TIMESTAMPTZ NOT NULL,
  hash_sha256   TEXT NOT NULL,
  ativo         BOOLEAN NOT NULL DEFAULT true,
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
  criado_por    UUID NOT NULL DEFAULT auth.uid() REFERENCES perfis_usuario(id)
);

CREATE INDEX idx_pendencias_obra_status ON pendencias(obra_id, status);
CREATE INDEX idx_pendencias_unidade     ON pendencias(unidade_id);
CREATE INDEX idx_pend_eventos_pend      ON pendencia_eventos(pendencia_id);
CREATE INDEX idx_pend_fotos_pend        ON pendencia_fotos(pendencia_id);

ALTER TABLE pendencias        ENABLE ROW LEVEL SECURITY;
ALTER TABLE pendencia_eventos ENABLE ROW LEVEL SECURITY;
ALTER TABLE pendencia_fotos   ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION pode_editar_pendencias()
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT meu_papel() = 'admin'
    OR (meu_papel() = 'equipe' AND 'pendencias' = ANY(meus_modulos()))
$$;

-- Leitura: admin e equipe (cliente NÃO vê pendências).
-- Escrita: admin/equipe com módulo 'pendencias'.
-- Pendência resolvida: só admin altera (cobre a reabertura).
CREATE POLICY pend_select ON pendencias FOR SELECT
  USING (ativo = true AND meu_papel() IN ('admin', 'equipe'));
CREATE POLICY pend_insert ON pendencias FOR INSERT
  WITH CHECK (pode_editar_pendencias());
CREATE POLICY pend_update ON pendencias FOR UPDATE
  USING (pode_editar_pendencias() AND (status <> 'resolvida' OR meu_papel() = 'admin'))
  WITH CHECK (pode_editar_pendencias());

-- Eventos: histórico imutável — sem UPDATE nem DELETE.
CREATE POLICY pend_ev_select ON pendencia_eventos FOR SELECT
  USING (meu_papel() IN ('admin', 'equipe'));
CREATE POLICY pend_ev_insert ON pendencia_eventos FOR INSERT
  WITH CHECK (pode_editar_pendencias());

CREATE POLICY pend_foto_select ON pendencia_fotos FOR SELECT
  USING (ativo = true AND meu_papel() IN ('admin', 'equipe'));
CREATE POLICY pend_foto_insert ON pendencia_fotos FOR INSERT
  WITH CHECK (pode_editar_pendencias());
CREATE POLICY pend_foto_update ON pendencia_fotos FOR UPDATE
  USING (pode_editar_pendencias())
  WITH CHECK (pode_editar_pendencias());

-- Bucket privado (mesmo padrão do RDO); leitura restrita a admin/equipe.
INSERT INTO storage.buckets (id, name, public) VALUES ('pendencias', 'pendencias', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY pend_storage_select ON storage.objects FOR SELECT
  USING (bucket_id = 'pendencias' AND meu_papel() IN ('admin', 'equipe'));
CREATE POLICY pend_storage_insert ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'pendencias' AND pode_editar_pendencias());
