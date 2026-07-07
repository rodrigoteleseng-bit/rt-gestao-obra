-- ============================================================
-- FASE 0 — FUNDAÇÃO | RT Engenharia - App de Gestão de Obra
-- ============================================================

CREATE TYPE papel_usuario AS ENUM ('admin', 'equipe', 'cliente');
CREATE TYPE status_obra AS ENUM ('ativa', 'pausada', 'concluida', 'arquivada');
CREATE TYPE tipo_unidade AS ENUM ('sobrado', 'portaria', 'area_comum', 'canteiro', 'outro');
CREATE TYPE modulo_app AS ENUM ('rdo', 'avanco', 'pendencias', 'almoxarifado', 'financeiro', 'compras');

CREATE TABLE perfis_usuario (
  id              UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nome            TEXT NOT NULL,
  email           TEXT NOT NULL,
  papel           papel_usuario NOT NULL DEFAULT 'equipe',
  modulos_permitidos modulo_app[] NOT NULL DEFAULT '{}',
  ativo           BOOLEAN NOT NULL DEFAULT true,
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
  criado_por      UUID REFERENCES perfis_usuario(id)
);

CREATE TABLE obras (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome                TEXT NOT NULL,
  descricao           TEXT,
  endereco            TEXT,
  cidade              TEXT,
  estado              CHAR(2),
  data_inicio         DATE,
  data_fim_prevista   DATE,
  status              status_obra NOT NULL DEFAULT 'ativa',
  ativo               BOOLEAN NOT NULL DEFAULT true,
  criado_em           TIMESTAMPTZ NOT NULL DEFAULT now(),
  criado_por          UUID REFERENCES perfis_usuario(id)
);

CREATE TABLE unidades (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  obra_id     UUID NOT NULL REFERENCES obras(id) ON DELETE CASCADE,
  nome        TEXT NOT NULL,
  tipo        tipo_unidade NOT NULL DEFAULT 'sobrado',
  ordem       INTEGER NOT NULL DEFAULT 0,
  ativo       BOOLEAN NOT NULL DEFAULT true,
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT now(),
  criado_por  UUID REFERENCES perfis_usuario(id)
);

CREATE TABLE etapas (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unidade_id  UUID NOT NULL REFERENCES unidades(id) ON DELETE CASCADE,
  nome        TEXT NOT NULL,
  ordem       INTEGER NOT NULL DEFAULT 0,
  placeholder BOOLEAN NOT NULL DEFAULT false,
  ativo       BOOLEAN NOT NULL DEFAULT true,
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT now(),
  criado_por  UUID REFERENCES perfis_usuario(id)
);

CREATE TABLE servicos (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  etapa_id            UUID NOT NULL REFERENCES etapas(id) ON DELETE CASCADE,
  descricao           TEXT NOT NULL,
  unidade_medida      TEXT NOT NULL DEFAULT 'm²',
  quantidade_prevista NUMERIC(12,3),
  valor_unitario      NUMERIC(12,2),
  ativo               BOOLEAN NOT NULL DEFAULT true,
  criado_em           TIMESTAMPTZ NOT NULL DEFAULT now(),
  criado_por          UUID REFERENCES perfis_usuario(id)
);

ALTER TABLE perfis_usuario  ENABLE ROW LEVEL SECURITY;
ALTER TABLE obras            ENABLE ROW LEVEL SECURITY;
ALTER TABLE unidades         ENABLE ROW LEVEL SECURITY;
ALTER TABLE etapas           ENABLE ROW LEVEL SECURITY;
ALTER TABLE servicos         ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION meu_papel()
RETURNS papel_usuario LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT papel FROM perfis_usuario WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION meus_modulos()
RETURNS modulo_app[] LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT modulos_permitidos FROM perfis_usuario WHERE id = auth.uid()
$$;

CREATE POLICY "perfis_select" ON perfis_usuario FOR SELECT
  USING (meu_papel() = 'admin' OR id = auth.uid() OR (meu_papel() = 'cliente' AND ativo = true));
CREATE POLICY "perfis_insert" ON perfis_usuario FOR INSERT WITH CHECK (meu_papel() = 'admin');
CREATE POLICY "perfis_update" ON perfis_usuario FOR UPDATE
  USING (meu_papel() = 'admin' OR id = auth.uid())
  WITH CHECK (meu_papel() = 'admin' OR id = auth.uid());

CREATE POLICY "obras_select" ON obras FOR SELECT USING (ativo = true);
CREATE POLICY "obras_insert" ON obras FOR INSERT WITH CHECK (meu_papel() = 'admin');
CREATE POLICY "obras_update" ON obras FOR UPDATE USING (meu_papel() = 'admin');

CREATE POLICY "unidades_select" ON unidades FOR SELECT USING (ativo = true);
CREATE POLICY "unidades_insert" ON unidades FOR INSERT WITH CHECK (meu_papel() = 'admin');
CREATE POLICY "unidades_update" ON unidades FOR UPDATE USING (meu_papel() = 'admin');

CREATE POLICY "etapas_select" ON etapas FOR SELECT USING (ativo = true);
CREATE POLICY "etapas_insert" ON etapas FOR INSERT WITH CHECK (meu_papel() = 'admin');
CREATE POLICY "etapas_update" ON etapas FOR UPDATE USING (meu_papel() = 'admin');

CREATE POLICY "servicos_select" ON servicos FOR SELECT USING (ativo = true);
CREATE POLICY "servicos_insert" ON servicos FOR INSERT WITH CHECK (meu_papel() = 'admin');
CREATE POLICY "servicos_update" ON servicos FOR UPDATE USING (meu_papel() = 'admin');

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO perfis_usuario (id, nome, email, papel, modulos_permitidos)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'nome', split_part(NEW.email, '@', 1)),
    NEW.email,
    COALESCE((NEW.raw_user_meta_data->>'papel')::papel_usuario, 'equipe'),
    '{}'::modulo_app[]
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();
