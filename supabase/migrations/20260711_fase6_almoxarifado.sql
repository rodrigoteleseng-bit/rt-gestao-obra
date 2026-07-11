-- ============================================================
-- Fase 6 — Almoxarifado | RT Engenharia
-- Spec: docs/superpowers/specs/2026-07-11-fase6-almoxarifado-design.md
-- ============================================================

CREATE TYPE categoria_material AS ENUM ('material', 'epi', 'escritorio');
CREATE TYPE tipo_movimento_estoque AS ENUM ('entrada', 'saida');

CREATE TABLE materiais (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  obra_id       UUID NOT NULL REFERENCES obras(id) ON DELETE CASCADE,
  codigo        TEXT NOT NULL,
  nome          TEXT NOT NULL,
  descricao     TEXT,
  und           TEXT NOT NULL DEFAULT 'un',
  categoria     categoria_material NOT NULL DEFAULT 'material',
  estoque_minimo NUMERIC(14,4),
  ativo         BOOLEAN NOT NULL DEFAULT true,
  criado_por    UUID NOT NULL DEFAULT auth.uid() REFERENCES perfis_usuario(id),
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (obra_id, codigo)
);

CREATE TABLE estoque_movimentos (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  obra_id       UUID NOT NULL REFERENCES obras(id) ON DELETE CASCADE,
  material_id   UUID NOT NULL REFERENCES materiais(id),
  tipo          tipo_movimento_estoque NOT NULL,
  quantidade    NUMERIC(14,4) NOT NULL CHECK (quantidade > 0),
  -- entrada:
  pedido_item_id UUID REFERENCES pedidos_compra_itens(id),
  -- saída:
  requisicao_numero INTEGER,
  unidade_id    UUID REFERENCES unidades(id),
  retirado_por  TEXT,
  tarefa_id     UUID REFERENCES cronograma_tarefas(id),
  aplicacao     TEXT,
  observacao    TEXT,
  ativo         BOOLEAN NOT NULL DEFAULT true,
  criado_por    UUID NOT NULL DEFAULT auth.uid() REFERENCES perfis_usuario(id),
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_estoque_mov_material ON estoque_movimentos(material_id) WHERE ativo;
CREATE INDEX idx_estoque_mov_pedido_item ON estoque_movimentos(pedido_item_id) WHERE pedido_item_id IS NOT NULL;

CREATE TABLE requisicoes_seq (
  obra_id       UUID PRIMARY KEY REFERENCES obras(id) ON DELETE CASCADE,
  ultimo_numero INTEGER NOT NULL
);
-- Obra piloto: bloco impresso vai até 00400; primeira digital = 00401.
INSERT INTO requisicoes_seq (obra_id, ultimo_numero)
SELECT id, 400 FROM obras;

CREATE TABLE requisicoes_blocos (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  obra_id        UUID NOT NULL REFERENCES obras(id) ON DELETE CASCADE,
  numero_inicial INTEGER NOT NULL,
  numero_final   INTEGER NOT NULL,
  criado_por     UUID NOT NULL DEFAULT auth.uid() REFERENCES perfis_usuario(id),
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE ferramentas (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  obra_id       UUID NOT NULL REFERENCES obras(id) ON DELETE CASCADE,
  nome          TEXT NOT NULL,
  descricao     TEXT,
  ativo         BOOLEAN NOT NULL DEFAULT true,
  criado_por    UUID NOT NULL DEFAULT auth.uid() REFERENCES perfis_usuario(id),
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE ferramenta_emprestimos (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ferramenta_id  UUID NOT NULL REFERENCES ferramentas(id),
  retirado_por   TEXT NOT NULL,
  unidade_id     UUID REFERENCES unidades(id),
  observacao     TEXT,
  retirada_em    TIMESTAMPTZ NOT NULL DEFAULT now(),
  devolvida_em   TIMESTAMPTZ,
  devolvida_recebida_por UUID REFERENCES perfis_usuario(id),
  criado_por     UUID NOT NULL DEFAULT auth.uid() REFERENCES perfis_usuario(id),
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- uma ferramenta só pode ter 1 empréstimo aberto
CREATE UNIQUE INDEX uniq_emprestimo_aberto ON ferramenta_emprestimos(ferramenta_id)
  WHERE devolvida_em IS NULL;

-- ---------- permissão ----------
CREATE OR REPLACE FUNCTION pode_editar_almoxarifado()
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT meu_papel() = 'admin'
    OR (meu_papel() = 'equipe' AND 'almoxarifado' = ANY(meus_modulos()))
$$;

-- ---------- saldo ----------
CREATE OR REPLACE VIEW estoque_saldos AS
SELECT m.id AS material_id,
  COALESCE(SUM(CASE WHEN e.tipo = 'entrada' THEN e.quantidade
                    WHEN e.tipo = 'saida'   THEN -e.quantidade END), 0) AS saldo
FROM materiais m
LEFT JOIN estoque_movimentos e ON e.material_id = m.id AND e.ativo
GROUP BY m.id;

CREATE OR REPLACE FUNCTION saldo_material(p_material UUID)
RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT COALESCE(SUM(CASE WHEN tipo = 'entrada' THEN quantidade ELSE -quantidade END), 0)
  FROM estoque_movimentos WHERE material_id = p_material AND ativo
$$;

-- ---------- validações de movimento ----------
CREATE OR REPLACE FUNCTION valida_movimento_estoque()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.tipo = 'saida' THEN
    IF NEW.unidade_id IS NULL THEN
      RAISE EXCEPTION 'Saída exige unidade de destino';
    END IF;
    IF NEW.retirado_por IS NULL OR btrim(NEW.retirado_por) = '' THEN
      RAISE EXCEPTION 'Saída exige quem retirou';
    END IF;
    IF saldo_material(NEW.material_id) < NEW.quantidade THEN
      RAISE EXCEPTION 'Saldo insuficiente: saldo atual %', saldo_material(NEW.material_id);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_valida_movimento
  BEFORE INSERT ON estoque_movimentos
  FOR EACH ROW EXECUTE FUNCTION valida_movimento_estoque();

-- ---------- integração entrada → pedido de compra ----------
-- Entrada vinculada a item de pedido soma em quantidade_recebida
-- (dispara o trigger de status recebido_parcial/total já existente em Compras).
-- Inativar o movimento (soft delete) reverte a soma.
CREATE OR REPLACE FUNCTION sincroniza_recebimento_pedido()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.tipo = 'entrada' AND NEW.pedido_item_id IS NOT NULL THEN
    UPDATE pedidos_compra_itens
    SET quantidade_recebida = quantidade_recebida + NEW.quantidade
    WHERE id = NEW.pedido_item_id;
  ELSIF TG_OP = 'UPDATE' AND OLD.ativo AND NOT NEW.ativo
        AND NEW.tipo = 'entrada' AND NEW.pedido_item_id IS NOT NULL THEN
    UPDATE pedidos_compra_itens
    SET quantidade_recebida = GREATEST(quantidade_recebida - NEW.quantidade, 0)
    WHERE id = NEW.pedido_item_id;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_sincroniza_recebimento
  AFTER INSERT OR UPDATE OF ativo ON estoque_movimentos
  FOR EACH ROW EXECUTE FUNCTION sincroniza_recebimento_pedido();

-- ---------- RPC: gerar bloco de requisições ----------
CREATE OR REPLACE FUNCTION gerar_bloco_requisicoes(p_obra UUID, p_qtd integer)
RETURNS TABLE(numero_inicial integer, numero_final integer)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_ini integer;
  v_fim integer;
BEGIN
  IF NOT pode_editar_almoxarifado() THEN
    RAISE EXCEPTION 'Sem permissão para gerar requisições';
  END IF;
  IF p_qtd < 1 OR p_qtd > 500 THEN
    RAISE EXCEPTION 'Quantidade deve ser entre 1 e 500';
  END IF;
  UPDATE requisicoes_seq
  SET ultimo_numero = ultimo_numero + p_qtd
  WHERE obra_id = p_obra
  RETURNING ultimo_numero - p_qtd + 1, ultimo_numero INTO v_ini, v_fim;
  IF NOT FOUND THEN
    INSERT INTO requisicoes_seq (obra_id, ultimo_numero) VALUES (p_obra, p_qtd);
    v_ini := 1; v_fim := p_qtd;
  END IF;
  INSERT INTO requisicoes_blocos (obra_id, numero_inicial, numero_final, criado_por)
  VALUES (p_obra, v_ini, v_fim, auth.uid());
  RETURN QUERY SELECT v_ini, v_fim;
END;
$$;

-- ---------- RPC: próximo código de material ----------
CREATE OR REPLACE FUNCTION proximo_codigo_material(p_obra UUID)
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT 'COD' || lpad((COALESCE(MAX(substring(codigo FROM '^COD(\d+)$')::int), 0) + 1)::text, 3, '0')
  FROM materiais WHERE obra_id = p_obra
$$;

-- ---------- RLS ----------
ALTER TABLE materiais              ENABLE ROW LEVEL SECURITY;
ALTER TABLE estoque_movimentos     ENABLE ROW LEVEL SECURITY;
ALTER TABLE requisicoes_seq        ENABLE ROW LEVEL SECURITY;
ALTER TABLE requisicoes_blocos     ENABLE ROW LEVEL SECURITY;
ALTER TABLE ferramentas            ENABLE ROW LEVEL SECURITY;
ALTER TABLE ferramenta_emprestimos ENABLE ROW LEVEL SECURITY;

CREATE POLICY mat_select ON materiais FOR SELECT
  USING (ativo = true AND meu_papel() IN ('admin', 'equipe'));
CREATE POLICY mat_insert ON materiais FOR INSERT WITH CHECK (pode_editar_almoxarifado());
CREATE POLICY mat_update ON materiais FOR UPDATE
  USING (pode_editar_almoxarifado()) WITH CHECK (pode_editar_almoxarifado());

CREATE POLICY mov_select ON estoque_movimentos FOR SELECT
  USING (meu_papel() IN ('admin', 'equipe'));
CREATE POLICY mov_insert ON estoque_movimentos FOR INSERT WITH CHECK (pode_editar_almoxarifado());
-- inativar (soft delete) só admin
CREATE POLICY mov_update ON estoque_movimentos FOR UPDATE
  USING (meu_papel() = 'admin') WITH CHECK (meu_papel() = 'admin');

CREATE POLICY rseq_select ON requisicoes_seq FOR SELECT
  USING (meu_papel() IN ('admin', 'equipe'));
CREATE POLICY rbl_select ON requisicoes_blocos FOR SELECT
  USING (meu_papel() IN ('admin', 'equipe'));

CREATE POLICY fer_select ON ferramentas FOR SELECT
  USING (ativo = true AND meu_papel() IN ('admin', 'equipe'));
CREATE POLICY fer_insert ON ferramentas FOR INSERT WITH CHECK (pode_editar_almoxarifado());
CREATE POLICY fer_update ON ferramentas FOR UPDATE
  USING (pode_editar_almoxarifado()) WITH CHECK (pode_editar_almoxarifado());

CREATE POLICY femp_select ON ferramenta_emprestimos FOR SELECT
  USING (meu_papel() IN ('admin', 'equipe'));
CREATE POLICY femp_insert ON ferramenta_emprestimos FOR INSERT WITH CHECK (pode_editar_almoxarifado());
-- devolução = UPDATE preenchendo devolvida_em; empréstimo já devolvido é imutável
CREATE POLICY femp_update ON ferramenta_emprestimos FOR UPDATE
  USING (pode_editar_almoxarifado() AND devolvida_em IS NULL)
  WITH CHECK (pode_editar_almoxarifado());
