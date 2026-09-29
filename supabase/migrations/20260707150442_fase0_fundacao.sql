
-- ============================================================
-- FASE 0 — FUNDAÇÃO | RT Engenharia - App de Gestão de Obra
-- ============================================================

-- ───────────────────────────────────────────────
-- 1. TIPOS ENUMERADOS
-- ───────────────────────────────────────────────
CREATE TYPE papel_usuario AS ENUM ('admin', 'equipe', 'cliente');
CREATE TYPE status_obra AS ENUM ('ativa', 'pausada', 'concluida', 'arquivada');
CREATE TYPE tipo_unidade AS ENUM ('sobrado', 'portaria', 'area_comum', 'canteiro', 'outro');
CREATE TYPE modulo_app AS ENUM ('rdo', 'avanco', 'pendencias', 'almoxarifado', 'financeiro', 'compras');

-- ───────────────────────────────────────────────
-- 2. TABELA: perfis_usuario
-- ───────────────────────────────────────────────
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

-- ───────────────────────────────────────────────
-- 3. TABELA: obras
-- ───────────────────────────────────────────────
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

-- ───────────────────────────────────────────────
-- 4. TABELA: unidades
-- ───────────────────────────────────────────────
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

-- ───────────────────────────────────────────────
-- 5. TABELA: etapas
-- ───────────────────────────────────────────────
CREATE TABLE etapas (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unidade_id  UUID NOT NULL REFERENCES unidades(id) ON DELETE CASCADE,
  nome        TEXT NOT NULL,
  ordem       INTEGER NOT NULL DEFAULT 0,
  placeholder BOOLEAN NOT NULL DEFAULT false, -- true = seed provisório, substituído na Fase 1
  ativo       BOOLEAN NOT NULL DEFAULT true,
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT now(),
  criado_por  UUID REFERENCES perfis_usuario(id)
);

-- ───────────────────────────────────────────────
-- 6. TABELA: servicos (preenchida na Fase 1)
-- ───────────────────────────────────────────────
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

-- ───────────────────────────────────────────────
-- 7. ROW LEVEL SECURITY
-- ───────────────────────────────────────────────
ALTER TABLE perfis_usuario  ENABLE ROW LEVEL SECURITY;
ALTER TABLE obras            ENABLE ROW LEVEL SECURITY;
ALTER TABLE unidades         ENABLE ROW LEVEL SECURITY;
ALTER TABLE etapas           ENABLE ROW LEVEL SECURITY;
ALTER TABLE servicos         ENABLE ROW LEVEL SECURITY;

-- Função auxiliar: retorna papel do usuário autenticado
CREATE OR REPLACE FUNCTION meu_papel()
RETURNS papel_usuario
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT papel FROM perfis_usuario WHERE id = auth.uid()
$$;

-- Função auxiliar: retorna módulos permitidos do usuário autenticado
CREATE OR REPLACE FUNCTION meus_modulos()
RETURNS modulo_app[]
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT modulos_permitidos FROM perfis_usuario WHERE id = auth.uid()
$$;

-- perfis_usuario: admin vê tudo; usuário vê o próprio perfil; cliente vê todos ativos
CREATE POLICY "perfis_select" ON perfis_usuario FOR SELECT
  USING (
    meu_papel() = 'admin'
    OR id = auth.uid()
    OR (meu_papel() = 'cliente' AND ativo = true)
  );

CREATE POLICY "perfis_insert" ON perfis_usuario FOR INSERT
  WITH CHECK (meu_papel() = 'admin');

CREATE POLICY "perfis_update" ON perfis_usuario FOR UPDATE
  USING (meu_papel() = 'admin' OR id = auth.uid())
  WITH CHECK (meu_papel() = 'admin' OR id = auth.uid());

-- obras: todos leem obras ativas; só admin escreve
CREATE POLICY "obras_select" ON obras FOR SELECT
  USING (ativo = true);

CREATE POLICY "obras_insert" ON obras FOR INSERT
  WITH CHECK (meu_papel() = 'admin');

CREATE POLICY "obras_update" ON obras FOR UPDATE
  USING (meu_papel() = 'admin');

-- unidades: todos leem; só admin escreve
CREATE POLICY "unidades_select" ON unidades FOR SELECT
  USING (ativo = true);

CREATE POLICY "unidades_insert" ON unidades FOR INSERT
  WITH CHECK (meu_papel() = 'admin');

CREATE POLICY "unidades_update" ON unidades FOR UPDATE
  USING (meu_papel() = 'admin');

-- etapas: todos leem; só admin escreve
CREATE POLICY "etapas_select" ON etapas FOR SELECT
  USING (ativo = true);

CREATE POLICY "etapas_insert" ON etapas FOR INSERT
  WITH CHECK (meu_papel() = 'admin');

CREATE POLICY "etapas_update" ON etapas FOR UPDATE
  USING (meu_papel() = 'admin');

-- servicos: todos leem; só admin escreve
CREATE POLICY "servicos_select" ON servicos FOR SELECT
  USING (ativo = true);

CREATE POLICY "servicos_insert" ON servicos FOR INSERT
  WITH CHECK (meu_papel() = 'admin');

CREATE POLICY "servicos_update" ON servicos FOR UPDATE
  USING (meu_papel() = 'admin');

-- ───────────────────────────────────────────────
-- 8. TRIGGER: cria perfil automaticamente no signup
-- ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
AS $$
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

-- ───────────────────────────────────────────────
-- 9. SEED: obra piloto — Tharsos Imperial
-- ───────────────────────────────────────────────
INSERT INTO obras (id, nome, descricao, endereco, cidade, estado, status)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'Tharsos Imperial',
  'Incorporação residencial com 13 sobrados + portaria + área comum',
  'Aparecida de Goiânia',
  'Aparecida de Goiânia',
  'GO',
  'ativa'
);

-- Unidades: Sobrados 01-13
INSERT INTO unidades (obra_id, nome, tipo, ordem) VALUES
  ('00000000-0000-0000-0000-000000000001', 'Sobrado 01', 'sobrado', 1),
  ('00000000-0000-0000-0000-000000000001', 'Sobrado 02', 'sobrado', 2),
  ('00000000-0000-0000-0000-000000000001', 'Sobrado 03', 'sobrado', 3),
  ('00000000-0000-0000-0000-000000000001', 'Sobrado 04', 'sobrado', 4),
  ('00000000-0000-0000-0000-000000000001', 'Sobrado 05', 'sobrado', 5),
  ('00000000-0000-0000-0000-000000000001', 'Sobrado 06', 'sobrado', 6),
  ('00000000-0000-0000-0000-000000000001', 'Sobrado 07', 'sobrado', 7),
  ('00000000-0000-0000-0000-000000000001', 'Sobrado 08', 'sobrado', 8),
  ('00000000-0000-0000-0000-000000000001', 'Sobrado 09', 'sobrado', 9),
  ('00000000-0000-0000-0000-000000000001', 'Sobrado 10', 'sobrado', 10),
  ('00000000-0000-0000-0000-000000000001', 'Sobrado 11', 'sobrado', 11),
  ('00000000-0000-0000-0000-000000000001', 'Sobrado 12', 'sobrado', 12),
  ('00000000-0000-0000-0000-000000000001', 'Sobrado 13', 'sobrado', 13),
  ('00000000-0000-0000-0000-000000000001', 'Portaria',   'portaria', 14),
  ('00000000-0000-0000-0000-000000000001', 'Área Comum', 'area_comum', 15),
  ('00000000-0000-0000-0000-000000000001', 'Canteiro de Obras', 'canteiro', 16);

-- Etapas padrão para cada sobrado (placeholder=true até importação da planilha na Fase 1)
DO $$
DECLARE
  u RECORD;
  etapas_sobrado TEXT[] := ARRAY[
    'Serviços Preliminares / Canteiro',
    'Fundação',
    'Superestrutura (Estrutura)',
    'Alvenaria / Vedação',
    'Cobertura',
    'Instalações Hidráulicas',
    'Instalações Elétricas / SPDA',
    'Revestimentos Internos',
    'Revestimentos Externos / Fachada',
    'Esquadrias',
    'Pisos / Pavimentação',
    'Louças e Metais',
    'Pintura',
    'Limpeza / Entrega'
  ];
  etapas_portaria TEXT[] := ARRAY[
    'Serviços Preliminares',
    'Fundação',
    'Estrutura / Alvenaria',
    'Cobertura',
    'Instalações',
    'Acabamento'
  ];
  etapas_area_comum TEXT[] := ARRAY[
    'Terraplanagem / Infraestrutura',
    'Pavimentação / Calçadas',
    'Paisagismo',
    'Instalações Externas',
    'Muros / Gradis',
    'Iluminação Externa'
  ];
  etapas_canteiro TEXT[] := ARRAY[
    'Instalação do Canteiro',
    'Desmobilização'
  ];
  i INTEGER;
  etapa_nome TEXT;
BEGIN
  FOR u IN SELECT id, tipo FROM unidades WHERE obra_id = '00000000-0000-0000-0000-000000000001' LOOP
    IF u.tipo = 'sobrado' THEN
      FOR i IN 1..array_length(etapas_sobrado, 1) LOOP
        INSERT INTO etapas (unidade_id, nome, ordem, placeholder)
        VALUES (u.id, etapas_sobrado[i], i, true);
      END LOOP;
    ELSIF u.tipo = 'portaria' THEN
      FOR i IN 1..array_length(etapas_portaria, 1) LOOP
        INSERT INTO etapas (unidade_id, nome, ordem, placeholder)
        VALUES (u.id, etapas_portaria[i], i, true);
      END LOOP;
    ELSIF u.tipo = 'area_comum' THEN
      FOR i IN 1..array_length(etapas_area_comum, 1) LOOP
        INSERT INTO etapas (unidade_id, nome, ordem, placeholder)
        VALUES (u.id, etapas_area_comum[i], i, true);
      END LOOP;
    ELSIF u.tipo = 'canteiro' THEN
      FOR i IN 1..array_length(etapas_canteiro, 1) LOOP
        INSERT INTO etapas (unidade_id, nome, ordem, placeholder)
        VALUES (u.id, etapas_canteiro[i], i, true);
      END LOOP;
    END IF;
  END LOOP;
END;
$$;
;
