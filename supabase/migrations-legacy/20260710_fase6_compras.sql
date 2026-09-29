-- ============================================================
-- FASE 6 — SUPRIMENTOS: COMPRAS | RT Engenharia
-- ============================================================
-- Pedido de compra com múltiplos itens, cada item vinculado
-- (quando possível) a um serviço do orçamento. Cotações por
-- fornecedor com preço por item; vencedor definido por item
-- (só admin). Recebimento com NF, status recalculado automático.
-- Cliente NÃO vê Compras (CLAUDE.md §2).
-- Decisões do Rodrigo em 10/07/2026 (ver spec no mesmo dia).

CREATE TYPE status_pedido_compra AS ENUM (
  'rascunho', 'em_cotacao', 'aprovado', 'enviado',
  'recebido_parcial', 'recebido_total', 'conferido_nf', 'encerrado', 'cancelado'
);

CREATE TABLE fornecedores (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome        TEXT NOT NULL,
  contato     TEXT,
  cnpj        TEXT,
  ativo       BOOLEAN NOT NULL DEFAULT true,
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT now(),
  criado_por  UUID NOT NULL DEFAULT auth.uid() REFERENCES perfis_usuario(id)
);

-- Contador de numeração sequencial por obra (não é RLS-editável
-- diretamente; só a função proximo_numero_pedido(), SECURITY DEFINER,
-- escreve aqui). Obras já existentes na data desta migration começam
-- do 65 (64 pedidos já feitos fora do app); obras novas começam do 001.
CREATE TABLE pedidos_compra_seq (
  obra_id       UUID PRIMARY KEY REFERENCES obras(id) ON DELETE CASCADE,
  ultimo_numero INTEGER NOT NULL DEFAULT 0
);

INSERT INTO pedidos_compra_seq (obra_id, ultimo_numero)
SELECT id, 64 FROM obras
ON CONFLICT (obra_id) DO NOTHING;

CREATE TABLE pedidos_compra (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  obra_id              UUID NOT NULL REFERENCES obras(id) ON DELETE CASCADE,
  numero               INTEGER NOT NULL,
  status               status_pedido_compra NOT NULL DEFAULT 'rascunho',
  descricao            TEXT,
  motivo_cancelamento  TEXT,
  aprovado_por         UUID REFERENCES perfis_usuario(id),
  aprovado_em          TIMESTAMPTZ,
  ativo                BOOLEAN NOT NULL DEFAULT true,
  criado_em            TIMESTAMPTZ NOT NULL DEFAULT now(),
  criado_por           UUID NOT NULL DEFAULT auth.uid() REFERENCES perfis_usuario(id),
  UNIQUE (obra_id, numero)
);

CREATE OR REPLACE FUNCTION proximo_numero_pedido() RETURNS TRIGGER AS $$
DECLARE
  v_numero INTEGER;
BEGIN
  INSERT INTO pedidos_compra_seq (obra_id, ultimo_numero)
  VALUES (NEW.obra_id, 0)
  ON CONFLICT (obra_id) DO NOTHING;

  UPDATE pedidos_compra_seq
    SET ultimo_numero = ultimo_numero + 1
    WHERE obra_id = NEW.obra_id
    RETURNING ultimo_numero INTO v_numero;

  NEW.numero := v_numero;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_numero_pedido
  BEFORE INSERT ON pedidos_compra
  FOR EACH ROW EXECUTE FUNCTION proximo_numero_pedido();

CREATE TABLE pedidos_compra_itens (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_id                 UUID NOT NULL REFERENCES pedidos_compra(id) ON DELETE CASCADE,
  servico_id                UUID REFERENCES servicos(id),          -- NULL = "a classificar"
  descricao_item            TEXT NOT NULL,
  quantidade_pedida         NUMERIC(14,4) NOT NULL,
  und                       TEXT,
  data_necessaria           DATE,
  urgente                   BOOLEAN NOT NULL DEFAULT false,
  cotacao_item_vencedora_id UUID,                                  -- FK adicionada depois de cotacoes_itens existir
  quantidade_recebida       NUMERIC(14,4) NOT NULL DEFAULT 0,
  valor_recebido            NUMERIC(14,2),
  ativo                     BOOLEAN NOT NULL DEFAULT true,
  criado_em                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  criado_por                UUID NOT NULL DEFAULT auth.uid() REFERENCES perfis_usuario(id)
);

CREATE TABLE cotacoes (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_id           UUID NOT NULL REFERENCES pedidos_compra(id) ON DELETE CASCADE,
  fornecedor_id       UUID NOT NULL REFERENCES fornecedores(id),
  condicao_pagamento  TEXT,
  prazo_entrega_dias  INTEGER,
  anexo_url           TEXT NOT NULL,                               -- caminho no bucket 'cotacoes-nf'
  criado_em           TIMESTAMPTZ NOT NULL DEFAULT now(),
  criado_por          UUID NOT NULL DEFAULT auth.uid() REFERENCES perfis_usuario(id)
);

CREATE TABLE cotacoes_itens (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cotacao_id      UUID NOT NULL REFERENCES cotacoes(id) ON DELETE CASCADE,
  pedido_item_id  UUID NOT NULL REFERENCES pedidos_compra_itens(id) ON DELETE CASCADE,
  preco_unitario  NUMERIC(14,4) NOT NULL,
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
  criado_por      UUID NOT NULL DEFAULT auth.uid() REFERENCES perfis_usuario(id),
  UNIQUE (cotacao_id, pedido_item_id)
);

ALTER TABLE pedidos_compra_itens
  ADD CONSTRAINT fk_pci_vencedora
  FOREIGN KEY (cotacao_item_vencedora_id) REFERENCES cotacoes_itens(id);

CREATE TABLE recebimentos_nf (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_id     UUID NOT NULL REFERENCES pedidos_compra(id) ON DELETE CASCADE,
  anexo_nf_url  TEXT NOT NULL,                                     -- caminho no bucket 'cotacoes-nf'
  observacao    TEXT,
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
  criado_por    UUID NOT NULL DEFAULT auth.uid() REFERENCES perfis_usuario(id)
);

CREATE INDEX idx_pedidos_compra_obra_status ON pedidos_compra(obra_id, status);
CREATE INDEX idx_pc_itens_pedido            ON pedidos_compra_itens(pedido_id);
CREATE INDEX idx_cotacoes_pedido            ON cotacoes(pedido_id);
CREATE INDEX idx_cotacoes_itens_cotacao     ON cotacoes_itens(cotacao_id);
CREATE INDEX idx_cotacoes_itens_item        ON cotacoes_itens(pedido_item_id);
CREATE INDEX idx_recebimentos_pedido        ON recebimentos_nf(pedido_id);

-- Só admin pode definir/alterar o vencedor por item (regra CLAUDE.md §5).
CREATE OR REPLACE FUNCTION restringir_vencedor_item() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.cotacao_item_vencedora_id IS DISTINCT FROM OLD.cotacao_item_vencedora_id
     AND meu_papel() <> 'admin' THEN
    RAISE EXCEPTION 'Somente o admin pode definir o item vencedor da cotação.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_restringir_vencedor_item
  BEFORE UPDATE ON pedidos_compra_itens
  FOR EACH ROW EXECUTE FUNCTION restringir_vencedor_item();

-- Recalcula status do pedido a partir do recebimento por item.
-- Só age quando o pedido já está em 'enviado' ou além (não interfere
-- em rascunho/em_cotacao/aprovado/cancelado/conferido_nf/encerrado).
CREATE OR REPLACE FUNCTION recalcular_status_pedido() RETURNS TRIGGER AS $$
DECLARE
  v_status          status_pedido_compra;
  v_total_itens     INTEGER;
  v_itens_completos INTEGER;
  v_itens_iniciados INTEGER;
BEGIN
  SELECT status INTO v_status FROM pedidos_compra WHERE id = NEW.pedido_id;
  IF v_status NOT IN ('enviado', 'recebido_parcial', 'recebido_total') THEN
    RETURN NEW;
  END IF;

  SELECT count(*),
         count(*) FILTER (WHERE quantidade_recebida >= quantidade_pedida),
         count(*) FILTER (WHERE quantidade_recebida > 0)
    INTO v_total_itens, v_itens_completos, v_itens_iniciados
    FROM pedidos_compra_itens
    WHERE pedido_id = NEW.pedido_id AND ativo = true;

  IF v_itens_completos = v_total_itens THEN
    UPDATE pedidos_compra SET status = 'recebido_total' WHERE id = NEW.pedido_id;
  ELSIF v_itens_iniciados > 0 THEN
    UPDATE pedidos_compra SET status = 'recebido_parcial' WHERE id = NEW.pedido_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_recalcular_status_pedido
  AFTER UPDATE OF quantidade_recebida ON pedidos_compra_itens
  FOR EACH ROW EXECUTE FUNCTION recalcular_status_pedido();

-- ── RLS ──
ALTER TABLE pedidos_compra_seq    ENABLE ROW LEVEL SECURITY;
ALTER TABLE fornecedores          ENABLE ROW LEVEL SECURITY;
ALTER TABLE pedidos_compra        ENABLE ROW LEVEL SECURITY;
ALTER TABLE pedidos_compra_itens  ENABLE ROW LEVEL SECURITY;
ALTER TABLE cotacoes              ENABLE ROW LEVEL SECURITY;
ALTER TABLE cotacoes_itens        ENABLE ROW LEVEL SECURITY;
ALTER TABLE recebimentos_nf       ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION pode_editar_compras()
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT meu_papel() = 'admin'
    OR (meu_papel() = 'equipe' AND 'compras' = ANY(meus_modulos()))
$$;

-- Sem policy de INSERT/UPDATE: só proximo_numero_pedido() (SECURITY DEFINER) escreve.
CREATE POLICY pcs_select ON pedidos_compra_seq FOR SELECT
  USING (meu_papel() IN ('admin', 'equipe'));

CREATE POLICY forn_select ON fornecedores FOR SELECT
  USING (ativo = true AND meu_papel() IN ('admin', 'equipe'));
CREATE POLICY forn_insert ON fornecedores FOR INSERT
  WITH CHECK (pode_editar_compras());
CREATE POLICY forn_update ON fornecedores FOR UPDATE
  USING (pode_editar_compras()) WITH CHECK (pode_editar_compras());

CREATE POLICY pc_select ON pedidos_compra FOR SELECT
  USING (ativo = true AND meu_papel() IN ('admin', 'equipe'));
CREATE POLICY pc_insert ON pedidos_compra FOR INSERT
  WITH CHECK (
    pode_editar_compras()
    AND (status = 'rascunho' OR meu_papel() = 'admin')
  );
CREATE POLICY pc_update ON pedidos_compra FOR UPDATE
  USING (pode_editar_compras())
  WITH CHECK (
    pode_editar_compras()
    AND (status NOT IN ('aprovado', 'encerrado', 'cancelado') OR meu_papel() = 'admin')
  );

CREATE POLICY pci_select ON pedidos_compra_itens FOR SELECT
  USING (ativo = true AND meu_papel() IN ('admin', 'equipe'));
CREATE POLICY pci_insert ON pedidos_compra_itens FOR INSERT
  WITH CHECK (pode_editar_compras());
CREATE POLICY pci_update ON pedidos_compra_itens FOR UPDATE
  USING (pode_editar_compras()) WITH CHECK (pode_editar_compras());

-- Cotações e itens de cotação: histórico, só leitura + insert (sem update/delete).
CREATE POLICY cot_select ON cotacoes FOR SELECT
  USING (meu_papel() IN ('admin', 'equipe'));
CREATE POLICY cot_insert ON cotacoes FOR INSERT
  WITH CHECK (pode_editar_compras());

CREATE POLICY coti_select ON cotacoes_itens FOR SELECT
  USING (meu_papel() IN ('admin', 'equipe'));
CREATE POLICY coti_insert ON cotacoes_itens FOR INSERT
  WITH CHECK (pode_editar_compras());

-- Recebimentos/NF: histórico, só leitura + insert.
CREATE POLICY rnf_select ON recebimentos_nf FOR SELECT
  USING (meu_papel() IN ('admin', 'equipe'));
CREATE POLICY rnf_insert ON recebimentos_nf FOR INSERT
  WITH CHECK (pode_editar_compras());

-- ── Storage: anexos de cotação e NF (bucket privado) ──
INSERT INTO storage.buckets (id, name, public) VALUES ('cotacoes-nf', 'cotacoes-nf', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY cotnf_storage_select ON storage.objects FOR SELECT
  USING (bucket_id = 'cotacoes-nf' AND meu_papel() IN ('admin', 'equipe'));
CREATE POLICY cotnf_storage_insert ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'cotacoes-nf' AND pode_editar_compras());
