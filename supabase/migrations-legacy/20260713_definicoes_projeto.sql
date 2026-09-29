-- Definições de Projeto: decisões pendentes do cliente/proprietário
-- (cor, modelo, acabamento), com prazo e responsável. Leitura liberada
-- a todos os papéis (inclusive cliente); escrita restrita a
-- admin/equipe com o módulo habilitado.

ALTER TYPE modulo_app ADD VALUE IF NOT EXISTS 'definicoes';

CREATE TYPE status_definicao AS ENUM ('pendente', 'resolvida');

CREATE TABLE definicoes_projeto (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  obra_id        UUID NOT NULL REFERENCES obras(id) ON DELETE CASCADE,
  unidade_id     UUID REFERENCES unidades(id),
  titulo         TEXT NOT NULL,
  local_ambiente TEXT,
  descricao      TEXT,
  responsavel    TEXT,
  prazo          DATE,
  status         status_definicao NOT NULL DEFAULT 'pendente',
  decisao        TEXT,
  resolvida_em   TIMESTAMPTZ,
  resolvida_por  UUID REFERENCES perfis_usuario(id),
  ativo          BOOLEAN NOT NULL DEFAULT true,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now(),
  criado_por     UUID NOT NULL DEFAULT auth.uid() REFERENCES perfis_usuario(id)
);

CREATE INDEX idx_definicoes_unidade ON definicoes_projeto(unidade_id);
CREATE INDEX idx_definicoes_obra    ON definicoes_projeto(obra_id) WHERE ativo;

ALTER TABLE definicoes_projeto ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION pode_editar_definicoes()
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT meu_papel() = 'admin'
    OR (meu_papel() = 'equipe' AND 'definicoes' = ANY(meus_modulos()))
$$;

-- Leitura: todos os papéis (admin, equipe, cliente) — são decisões do cliente.
-- Escrita: admin, ou equipe com o módulo 'definicoes'.
CREATE POLICY def_select ON definicoes_projeto FOR SELECT
  USING (ativo = true);
CREATE POLICY def_insert ON definicoes_projeto FOR INSERT
  WITH CHECK (pode_editar_definicoes());
CREATE POLICY def_update ON definicoes_projeto FOR UPDATE
  USING (pode_editar_definicoes())
  WITH CHECK (pode_editar_definicoes());
