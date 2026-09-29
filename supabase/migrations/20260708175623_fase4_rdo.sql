CREATE TYPE status_rdo AS ENUM ('rascunho', 'assinado');
CREATE TYPE condicao_clima AS ENUM ('claro', 'nublado', 'chuvoso');

CREATE TABLE rdos (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  obra_id               UUID NOT NULL REFERENCES obras(id) ON DELETE CASCADE,
  numero                INTEGER NOT NULL,
  data                  DATE NOT NULL,
  horario_inicio        TIME,
  clima_manha           condicao_clima,
  clima_manha_trabalhavel BOOLEAN,
  clima_tarde           condicao_clima,
  clima_tarde_trabalhavel BOOLEAN,
  acidente              BOOLEAN NOT NULL DEFAULT false,
  acidente_descricao    TEXT,
  observacoes           TEXT,
  status                status_rdo NOT NULL DEFAULT 'rascunho',
  assinatura_imagem     TEXT,
  assinado_por_nome     TEXT,
  assinado_em           TIMESTAMPTZ,
  assinatura_lat        NUMERIC(10,7),
  assinatura_lng        NUMERIC(10,7),
  assinatura_precisao_m NUMERIC(8,1),
  ativo                 BOOLEAN NOT NULL DEFAULT true,
  criado_em             TIMESTAMPTZ NOT NULL DEFAULT now(),
  criado_por            UUID NOT NULL DEFAULT auth.uid() REFERENCES perfis_usuario(id),
  UNIQUE (obra_id, numero),
  UNIQUE (obra_id, data)
);

CREATE TABLE rdo_atividades (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rdo_id      UUID NOT NULL REFERENCES rdos(id) ON DELETE CASCADE,
  unidade_id  UUID NOT NULL REFERENCES unidades(id),
  tarefa_id   UUID REFERENCES cronograma_tarefas(id),
  descricao   TEXT NOT NULL,
  ordem       INTEGER NOT NULL DEFAULT 0,
  ativo       BOOLEAN NOT NULL DEFAULT true,
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT now(),
  criado_por  UUID NOT NULL DEFAULT auth.uid() REFERENCES perfis_usuario(id)
);

CREATE TABLE rdo_efetivo (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rdo_id      UUID NOT NULL REFERENCES rdos(id) ON DELETE CASCADE,
  funcao      TEXT NOT NULL,
  quantidade  INTEGER NOT NULL CHECK (quantidade > 0),
  empresa     TEXT,
  ativo       BOOLEAN NOT NULL DEFAULT true,
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT now(),
  criado_por  UUID NOT NULL DEFAULT auth.uid() REFERENCES perfis_usuario(id)
);

CREATE TABLE rdo_fotos (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rdo_id        UUID NOT NULL REFERENCES rdos(id) ON DELETE CASCADE,
  unidade_id    UUID REFERENCES unidades(id),
  path          TEXT NOT NULL,
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

CREATE TABLE rdo_audios (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rdo_id       UUID NOT NULL REFERENCES rdos(id) ON DELETE CASCADE,
  path         TEXT NOT NULL,
  duracao_seg  NUMERIC(8,1),
  gravado_em   TIMESTAMPTZ NOT NULL,
  hash_sha256  TEXT NOT NULL,
  ativo        BOOLEAN NOT NULL DEFAULT true,
  criado_em    TIMESTAMPTZ NOT NULL DEFAULT now(),
  criado_por   UUID NOT NULL DEFAULT auth.uid() REFERENCES perfis_usuario(id)
);

CREATE INDEX idx_rdos_obra_data    ON rdos(obra_id, data);
CREATE INDEX idx_rdo_ativ_rdo      ON rdo_atividades(rdo_id);
CREATE INDEX idx_rdo_efetivo_rdo   ON rdo_efetivo(rdo_id);
CREATE INDEX idx_rdo_fotos_rdo     ON rdo_fotos(rdo_id);
CREATE INDEX idx_rdo_audios_rdo    ON rdo_audios(rdo_id);

ALTER TABLE rdos           ENABLE ROW LEVEL SECURITY;
ALTER TABLE rdo_atividades ENABLE ROW LEVEL SECURITY;
ALTER TABLE rdo_efetivo    ENABLE ROW LEVEL SECURITY;
ALTER TABLE rdo_fotos      ENABLE ROW LEVEL SECURITY;
ALTER TABLE rdo_audios     ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION pode_editar_rdo()
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT meu_papel() = 'admin' OR (meu_papel() = 'equipe' AND 'rdo' = ANY(meus_modulos()))
$$;

CREATE POLICY rdos_select ON rdos FOR SELECT USING (ativo = true);
CREATE POLICY rdos_insert ON rdos FOR INSERT WITH CHECK (pode_editar_rdo());
CREATE POLICY rdos_update ON rdos FOR UPDATE
  USING (pode_editar_rdo() AND status = 'rascunho')
  WITH CHECK (pode_editar_rdo());

CREATE OR REPLACE FUNCTION rdo_em_rascunho(p_rdo UUID)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (SELECT 1 FROM rdos WHERE id = p_rdo AND status = 'rascunho' AND ativo = true)
$$;

CREATE POLICY rdo_ativ_select ON rdo_atividades FOR SELECT USING (ativo = true);
CREATE POLICY rdo_ativ_insert ON rdo_atividades FOR INSERT
  WITH CHECK (pode_editar_rdo() AND rdo_em_rascunho(rdo_id));
CREATE POLICY rdo_ativ_update ON rdo_atividades FOR UPDATE
  USING (pode_editar_rdo() AND rdo_em_rascunho(rdo_id))
  WITH CHECK (pode_editar_rdo() AND rdo_em_rascunho(rdo_id));

CREATE POLICY rdo_efet_select ON rdo_efetivo FOR SELECT USING (ativo = true);
CREATE POLICY rdo_efet_insert ON rdo_efetivo FOR INSERT
  WITH CHECK (pode_editar_rdo() AND rdo_em_rascunho(rdo_id));
CREATE POLICY rdo_efet_update ON rdo_efetivo FOR UPDATE
  USING (pode_editar_rdo() AND rdo_em_rascunho(rdo_id))
  WITH CHECK (pode_editar_rdo() AND rdo_em_rascunho(rdo_id));

CREATE POLICY rdo_fotos_select ON rdo_fotos FOR SELECT USING (ativo = true);
CREATE POLICY rdo_fotos_insert ON rdo_fotos FOR INSERT
  WITH CHECK (pode_editar_rdo() AND rdo_em_rascunho(rdo_id));
CREATE POLICY rdo_fotos_update ON rdo_fotos FOR UPDATE
  USING (pode_editar_rdo() AND rdo_em_rascunho(rdo_id))
  WITH CHECK (pode_editar_rdo() AND rdo_em_rascunho(rdo_id));

CREATE POLICY rdo_audios_select ON rdo_audios FOR SELECT USING (ativo = true);
CREATE POLICY rdo_audios_insert ON rdo_audios FOR INSERT
  WITH CHECK (pode_editar_rdo() AND rdo_em_rascunho(rdo_id));
CREATE POLICY rdo_audios_update ON rdo_audios FOR UPDATE
  USING (pode_editar_rdo() AND rdo_em_rascunho(rdo_id))
  WITH CHECK (pode_editar_rdo() AND rdo_em_rascunho(rdo_id));

INSERT INTO storage.buckets (id, name, public) VALUES ('rdo', 'rdo', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY rdo_storage_select ON storage.objects FOR SELECT
  USING (bucket_id = 'rdo' AND auth.role() = 'authenticated');
CREATE POLICY rdo_storage_insert ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'rdo' AND pode_editar_rdo());;
