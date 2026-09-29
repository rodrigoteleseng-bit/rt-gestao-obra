-- ============================================================
-- FASE 7 — MEDIÇÕES DE EMPREITEIROS | RT Engenharia
-- ============================================================
-- Lança execução periódica (quantidade) por item de contrato ativo,
-- acumula saldo frente à quantidade contratada, calcula valor
-- bruto/retido/líquido. Aprovação exclusiva do admin, trava de saldo
-- no banco sem exceção. Consome contratos/contratos_itens
-- (20260713_fase7_contratos.sql). Decisões de Rodrigo em 13/07/2026 —
-- ver docs/superpowers/specs/2026-07-13-fase7-medicoes-design.md.
--
-- O valor 'medicoes' do enum modulo_app já existe
-- (20260707_fase7_modulos_extras_enum.sql) — nada a alterar ali.

CREATE TYPE status_medicao AS ENUM ('rascunho', 'aprovada');

-- Contador de numeração sequencial por CONTRATO (não por obra —
-- a 1ª medição do CT-003 e a 1ª do CT-005 coexistem).
CREATE TABLE medicoes_seq (
  contrato_id   UUID PRIMARY KEY REFERENCES contratos(id) ON DELETE CASCADE,
  ultimo_numero INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE medicoes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contrato_id     UUID NOT NULL REFERENCES contratos(id),
  numero          INTEGER NOT NULL,
  data_referencia DATE NOT NULL,
  status          status_medicao NOT NULL DEFAULT 'rascunho',
  valor_bruto     NUMERIC(14,2) NOT NULL DEFAULT 0,
  valor_retido    NUMERIC(14,2) NOT NULL DEFAULT 0,
  valor_liquido   NUMERIC(14,2) NOT NULL DEFAULT 0,
  aprovada_por    UUID REFERENCES perfis_usuario(id),
  aprovada_em     TIMESTAMPTZ,
  ativo           BOOLEAN NOT NULL DEFAULT true,
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
  criado_por      UUID NOT NULL DEFAULT auth.uid() REFERENCES perfis_usuario(id),
  UNIQUE (contrato_id, numero)
);

CREATE OR REPLACE FUNCTION proximo_numero_medicao() RETURNS TRIGGER AS $$
DECLARE
  v_numero INTEGER;
BEGIN
  INSERT INTO medicoes_seq (contrato_id, ultimo_numero)
  VALUES (NEW.contrato_id, 0)
  ON CONFLICT (contrato_id) DO NOTHING;

  UPDATE medicoes_seq
    SET ultimo_numero = ultimo_numero + 1
    WHERE contrato_id = NEW.contrato_id
    RETURNING ultimo_numero INTO v_numero;

  NEW.numero := v_numero;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_numero_medicao
  BEFORE INSERT ON medicoes
  FOR EACH ROW EXECUTE FUNCTION proximo_numero_medicao();

-- Medição aprovada é permanente: nenhuma alteração (item, status ou
-- qualquer campo) depois de aprovada, nem para admin. Só admin pode
-- mudar o status (rascunho → aprovada). Diferente de Contratos, essa
-- trava já nasce completa aqui — não precisou de migração de correção.
CREATE OR REPLACE FUNCTION restringir_status_medicao() RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status = 'aprovada' THEN
    RAISE EXCEPTION 'Medição aprovada não pode ser alterada.';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND meu_papel() <> 'admin' THEN
    RAISE EXCEPTION 'Somente o admin pode aprovar uma medição.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_restringir_status_medicao
  BEFORE UPDATE ON medicoes
  FOR EACH ROW EXECUTE FUNCTION restringir_status_medicao();

CREATE TABLE medicoes_itens (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  medicao_id          UUID NOT NULL REFERENCES medicoes(id) ON DELETE CASCADE,
  contrato_item_id    UUID NOT NULL REFERENCES contratos_itens(id),
  quantidade_periodo  NUMERIC(14,4) NOT NULL CHECK (quantidade_periodo >= 0),
  valor_total_item    NUMERIC(14,2) NOT NULL DEFAULT 0,
  ativo               BOOLEAN NOT NULL DEFAULT true,
  criado_em           TIMESTAMPTZ NOT NULL DEFAULT now(),
  criado_por          UUID NOT NULL DEFAULT auth.uid() REFERENCES perfis_usuario(id)
);

-- Calcula o valor do item a partir do valor unitário negociado no
-- contrato — item de medição nunca guarda seu próprio valor_unitario.
CREATE OR REPLACE FUNCTION calcular_valor_item_medicao() RETURNS TRIGGER AS $$
DECLARE
  v_valor_unitario NUMERIC(14,4);
BEGIN
  SELECT valor_unitario INTO v_valor_unitario FROM contratos_itens WHERE id = NEW.contrato_item_id;
  NEW.valor_total_item := NEW.quantidade_periodo * v_valor_unitario;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_calcular_valor_item_medicao
  BEFORE INSERT OR UPDATE ON medicoes_itens
  FOR EACH ROW EXECUTE FUNCTION calcular_valor_item_medicao();

-- Recalcula bruto/retido/líquido da medição a partir da soma dos
-- itens ativos, aplicando a retenção % cadastrada no contrato.
CREATE OR REPLACE FUNCTION recalcular_valor_medicao() RETURNS TRIGGER AS $$
DECLARE
  v_medicao_id  UUID := COALESCE(NEW.medicao_id, OLD.medicao_id);
  v_contrato_id UUID;
  v_retencao    NUMERIC(5,2);
  v_bruto       NUMERIC(14,2);
  v_retido      NUMERIC(14,2);
BEGIN
  SELECT contrato_id INTO v_contrato_id FROM medicoes WHERE id = v_medicao_id;
  SELECT COALESCE(retencao_pct, 0) INTO v_retencao FROM contratos WHERE id = v_contrato_id;

  SELECT COALESCE(SUM(valor_total_item), 0) INTO v_bruto
  FROM medicoes_itens WHERE medicao_id = v_medicao_id AND ativo = true;

  v_retido := ROUND(v_bruto * v_retencao / 100, 2);

  UPDATE medicoes SET
    valor_bruto = v_bruto, valor_retido = v_retido, valor_liquido = v_bruto - v_retido
  WHERE id = v_medicao_id;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_recalcular_valor_medicao
  AFTER INSERT OR UPDATE ON medicoes_itens
  FOR EACH ROW EXECUTE FUNCTION recalcular_valor_medicao();

-- Trava de saldo: ao aprovar, nenhum item pode ultrapassar a
-- quantidade contratada somando tudo que já está aprovado. Sem
-- exceção pra admin — se precisar medir a mais, aditiva o contrato.
CREATE OR REPLACE FUNCTION validar_saldo_medicao() RETURNS TRIGGER AS $$
DECLARE
  v_item RECORD;
  v_ja_aprovado NUMERIC(14,4);
BEGIN
  IF NEW.status = 'aprovada' AND OLD.status = 'rascunho' THEN
    FOR v_item IN
      SELECT mi.contrato_item_id, mi.quantidade_periodo, ci.quantidade AS quantidade_contratada
      FROM medicoes_itens mi
      JOIN contratos_itens ci ON ci.id = mi.contrato_item_id
      WHERE mi.medicao_id = NEW.id AND mi.ativo = true
    LOOP
      SELECT COALESCE(SUM(mi2.quantidade_periodo), 0) INTO v_ja_aprovado
      FROM medicoes_itens mi2
      JOIN medicoes m2 ON m2.id = mi2.medicao_id
      WHERE mi2.contrato_item_id = v_item.contrato_item_id
        AND mi2.ativo = true
        AND m2.status = 'aprovada'
        AND m2.id <> NEW.id;

      IF v_ja_aprovado + v_item.quantidade_periodo > v_item.quantidade_contratada THEN
        RAISE EXCEPTION 'Quantidade medida (%) ultrapassa o saldo contratado do item (contratado: %, já aprovado: %).',
          v_item.quantidade_periodo, v_item.quantidade_contratada, v_ja_aprovado;
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_validar_saldo_medicao
  BEFORE UPDATE ON medicoes
  FOR EACH ROW EXECUTE FUNCTION validar_saldo_medicao();

CREATE INDEX idx_medicoes_contrato          ON medicoes(contrato_id);
CREATE INDEX idx_medicoes_itens_medicao     ON medicoes_itens(medicao_id);
CREATE INDEX idx_medicoes_itens_contrato_it ON medicoes_itens(contrato_item_id);

-- ── RLS ──
ALTER TABLE medicoes_seq   ENABLE ROW LEVEL SECURITY;
ALTER TABLE medicoes       ENABLE ROW LEVEL SECURITY;
ALTER TABLE medicoes_itens ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION pode_editar_medicoes()
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT meu_papel() = 'admin'
    OR (meu_papel() = 'equipe' AND 'medicoes' = ANY(meus_modulos()))
$$;

-- Sem policy de INSERT/UPDATE: só proximo_numero_medicao() (SECURITY DEFINER) escreve.
CREATE POLICY medseq_select ON medicoes_seq FOR SELECT
  USING (meu_papel() IN ('admin', 'equipe'));

-- Regra de soft delete (CLAUDE.md §3): toda policy de SELECT que
-- filtra por ativo = true já nasce com "OR pode_editar_medicoes()".
CREATE POLICY med_select ON medicoes FOR SELECT
  USING ((ativo = true AND meu_papel() = ANY (ARRAY['admin', 'equipe']::papel_usuario[])) OR pode_editar_medicoes());
CREATE POLICY med_insert ON medicoes FOR INSERT
  WITH CHECK (
    pode_editar_medicoes()
    AND status = 'rascunho'
    AND EXISTS (SELECT 1 FROM contratos c WHERE c.id = contrato_id AND c.status = 'ativo')
  );
CREATE POLICY med_update ON medicoes FOR UPDATE
  USING (pode_editar_medicoes()) WITH CHECK (pode_editar_medicoes());

-- Itens de medição imutáveis fora do rascunho — sem exceção pra
-- admin (lição aplicada desde o início; em Contratos isso só foi
-- corrigido numa segunda migração no mesmo dia).
CREATE POLICY mi_select ON medicoes_itens FOR SELECT
  USING ((ativo = true AND meu_papel() = ANY (ARRAY['admin', 'equipe']::papel_usuario[])) OR pode_editar_medicoes());
CREATE POLICY mi_insert ON medicoes_itens FOR INSERT
  WITH CHECK (
    pode_editar_medicoes()
    AND EXISTS (SELECT 1 FROM medicoes m WHERE m.id = medicao_id AND m.status = 'rascunho')
  );
CREATE POLICY mi_update ON medicoes_itens FOR UPDATE
  USING (pode_editar_medicoes())
  WITH CHECK (
    pode_editar_medicoes()
    AND EXISTS (SELECT 1 FROM medicoes m WHERE m.id = medicao_id AND m.status = 'rascunho')
  );
