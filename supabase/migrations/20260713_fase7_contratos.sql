-- ============================================================
-- FASE 7 — CONTRATOS | RT Engenharia
-- ============================================================
-- Contratos com empreiteiros terceirizados por serviço: cabeçalho
-- (empreiteiro, objeto, condição de pagamento, retenção %) + itens
-- (serviço do orçamento × unidade, quantidade e valor negociados).
-- Base para o futuro módulo de Medições (lança execução por item).
-- Cliente NÃO vê Contratos (CLAUDE.md §2). Decisões do Rodrigo em
-- 13/07/2026 — ver docs/superpowers/specs/2026-07-13-fase7-contratos-design.md.
--
-- O valor 'contratos' do enum modulo_app já existe
-- (20260707_fase7_modulos_extras_enum.sql) — nada a alterar ali.

CREATE TABLE empreiteiros (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome          TEXT NOT NULL,
  documento     TEXT,
  contato       TEXT,
  especialidade TEXT,
  pix           TEXT,
  ativo         BOOLEAN NOT NULL DEFAULT true,
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
  criado_por    UUID NOT NULL DEFAULT auth.uid() REFERENCES perfis_usuario(id)
);

-- Contador de numeração sequencial por obra (só a função
-- proximo_numero_contrato(), SECURITY DEFINER, escreve aqui).
-- Diferente de pedidos_compra_seq: não há contratos formais em
-- papel a incorporar, então toda obra começa do zero (CT-001).
CREATE TABLE contratos_seq (
  obra_id       UUID PRIMARY KEY REFERENCES obras(id) ON DELETE CASCADE,
  ultimo_numero INTEGER NOT NULL DEFAULT 0
);

INSERT INTO contratos_seq (obra_id, ultimo_numero)
SELECT id, 0 FROM obras
ON CONFLICT (obra_id) DO NOTHING;

CREATE TYPE status_contrato AS ENUM ('rascunho', 'ativo', 'encerrado');

CREATE TABLE contratos (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  obra_id             UUID NOT NULL REFERENCES obras(id) ON DELETE CASCADE,
  numero              TEXT NOT NULL,
  empreiteiro_id      UUID NOT NULL REFERENCES empreiteiros(id),
  objeto              TEXT NOT NULL,
  condicao_pagamento  TEXT,
  retencao_pct        NUMERIC(5,2),
  valor_total         NUMERIC(14,2) NOT NULL DEFAULT 0,
  status              status_contrato NOT NULL DEFAULT 'rascunho',
  ativado_por         UUID REFERENCES perfis_usuario(id),
  ativado_em          TIMESTAMPTZ,
  encerrado_por       UUID REFERENCES perfis_usuario(id),
  encerrado_em        TIMESTAMPTZ,
  ativo               BOOLEAN NOT NULL DEFAULT true,
  criado_em           TIMESTAMPTZ NOT NULL DEFAULT now(),
  criado_por          UUID NOT NULL DEFAULT auth.uid() REFERENCES perfis_usuario(id),
  UNIQUE (obra_id, numero)
);

CREATE OR REPLACE FUNCTION proximo_numero_contrato() RETURNS TRIGGER AS $$
DECLARE
  v_numero INTEGER;
BEGIN
  INSERT INTO contratos_seq (obra_id, ultimo_numero)
  VALUES (NEW.obra_id, 0)
  ON CONFLICT (obra_id) DO NOTHING;

  UPDATE contratos_seq
    SET ultimo_numero = ultimo_numero + 1
    WHERE obra_id = NEW.obra_id
    RETURNING ultimo_numero INTO v_numero;

  NEW.numero := 'CT-' || lpad(v_numero::text, 3, '0');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_numero_contrato
  BEFORE INSERT ON contratos
  FOR EACH ROW EXECUTE FUNCTION proximo_numero_contrato();

-- Só admin pode alterar o status do contrato (Ativar/Encerrar) —
-- mesma lógica de restringir_vencedor_item em Compras: enforcement
-- real no banco, não só no botão da tela.
CREATE OR REPLACE FUNCTION restringir_status_contrato() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status AND meu_papel() <> 'admin' THEN
    RAISE EXCEPTION 'Somente o admin pode alterar o status do contrato.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_restringir_status_contrato
  BEFORE UPDATE ON contratos
  FOR EACH ROW EXECUTE FUNCTION restringir_status_contrato();

CREATE TABLE contratos_itens (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contrato_id     UUID NOT NULL REFERENCES contratos(id) ON DELETE CASCADE,
  servico_id      UUID NOT NULL REFERENCES servicos(id),
  unidade_id      UUID NOT NULL REFERENCES unidades(id),
  quantidade      NUMERIC(14,4) NOT NULL,
  valor_unitario  NUMERIC(14,4) NOT NULL,
  valor_total     NUMERIC(14,2) NOT NULL,
  ativo           BOOLEAN NOT NULL DEFAULT true,
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
  criado_por      UUID NOT NULL DEFAULT auth.uid() REFERENCES perfis_usuario(id)
);

-- Recalcula o valor total do contrato a partir da soma dos itens
-- ativos sempre que um item é inserido, alterado ou inativado.
CREATE OR REPLACE FUNCTION recalcular_valor_contrato() RETURNS TRIGGER AS $$
DECLARE
  v_contrato_id UUID := COALESCE(NEW.contrato_id, OLD.contrato_id);
BEGIN
  UPDATE contratos SET valor_total = (
    SELECT COALESCE(SUM(valor_total), 0) FROM contratos_itens
    WHERE contrato_id = v_contrato_id AND ativo = true
  ) WHERE id = v_contrato_id;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_recalcular_valor_contrato
  AFTER INSERT OR UPDATE ON contratos_itens
  FOR EACH ROW EXECUTE FUNCTION recalcular_valor_contrato();

CREATE INDEX idx_contratos_obra_status    ON contratos(obra_id, status);
CREATE INDEX idx_contratos_itens_contrato ON contratos_itens(contrato_id);
CREATE INDEX idx_contratos_itens_servico  ON contratos_itens(servico_id);

-- ── RLS ──
ALTER TABLE empreiteiros    ENABLE ROW LEVEL SECURITY;
ALTER TABLE contratos_seq   ENABLE ROW LEVEL SECURITY;
ALTER TABLE contratos       ENABLE ROW LEVEL SECURITY;
ALTER TABLE contratos_itens ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION pode_editar_contratos()
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT meu_papel() = 'admin'
    OR (meu_papel() = 'equipe' AND 'contratos' = ANY(meus_modulos()))
$$;

-- Regra de soft delete (CLAUDE.md §3): toda policy de SELECT que
-- filtra por ativo = true já nasce com "OR pode_editar_contratos()",
-- pra não bloquear silenciosamente a inativação (fix de 13/07/2026).

CREATE POLICY emp_select ON empreiteiros FOR SELECT
  USING ((ativo = true AND meu_papel() = ANY (ARRAY['admin', 'equipe']::papel_usuario[])) OR pode_editar_contratos());
CREATE POLICY emp_insert ON empreiteiros FOR INSERT
  WITH CHECK (pode_editar_contratos());
CREATE POLICY emp_update ON empreiteiros FOR UPDATE
  USING (pode_editar_contratos()) WITH CHECK (pode_editar_contratos());

-- Sem policy de INSERT/UPDATE: só proximo_numero_contrato() (SECURITY DEFINER) escreve.
CREATE POLICY ctrseq_select ON contratos_seq FOR SELECT
  USING (meu_papel() IN ('admin', 'equipe'));

CREATE POLICY ctr_select ON contratos FOR SELECT
  USING ((ativo = true AND meu_papel() = ANY (ARRAY['admin', 'equipe']::papel_usuario[])) OR pode_editar_contratos());
CREATE POLICY ctr_insert ON contratos FOR INSERT
  WITH CHECK (pode_editar_contratos() AND status = 'rascunho');
CREATE POLICY ctr_update ON contratos FOR UPDATE
  USING (pode_editar_contratos()) WITH CHECK (pode_editar_contratos());

CREATE POLICY ci_select ON contratos_itens FOR SELECT
  USING ((ativo = true AND meu_papel() = ANY (ARRAY['admin', 'equipe']::papel_usuario[])) OR pode_editar_contratos());
CREATE POLICY ci_insert ON contratos_itens FOR INSERT
  WITH CHECK (
    pode_editar_contratos()
    AND EXISTS (SELECT 1 FROM contratos c WHERE c.id = contrato_id AND (c.status = 'rascunho' OR meu_papel() = 'admin'))
  );
CREATE POLICY ci_update ON contratos_itens FOR UPDATE
  USING (pode_editar_contratos())
  WITH CHECK (
    pode_editar_contratos()
    AND EXISTS (SELECT 1 FROM contratos c WHERE c.id = contrato_id AND (c.status = 'rascunho' OR meu_papel() = 'admin'))
  );
