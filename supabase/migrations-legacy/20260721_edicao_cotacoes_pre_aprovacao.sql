-- Permite corrigir/renegociar cotacoes antes da aprovacao do pedido.
-- Depois de aprovado, enviado, recebido, encerrado ou cancelado, a cotacao volta a ser imutavel.

ALTER TABLE cotacoes
  ADD COLUMN IF NOT EXISTS editado_em TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS editado_por UUID REFERENCES perfis_usuario(id);

ALTER TABLE cotacoes_itens
  ADD COLUMN IF NOT EXISTS editado_em TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS editado_por UUID REFERENCES perfis_usuario(id);

DROP POLICY IF EXISTS cot_update_pre_aprovacao ON cotacoes;
DROP POLICY IF EXISTS coti_update_pre_aprovacao ON cotacoes_itens;
DROP FUNCTION IF EXISTS pedido_compra_aberto_por_cotacao(UUID);

CREATE POLICY cot_update_pre_aprovacao ON cotacoes FOR UPDATE
  USING (
    pode_editar_compras()
    AND EXISTS (
      SELECT 1
      FROM pedidos_compra p
      WHERE p.id = pedido_id
        AND p.status IN ('rascunho', 'em_cotacao')
        AND p.ativo = true
        AND pode_acessar_obra(p.obra_id)
    )
  )
  WITH CHECK (
    pode_editar_compras()
    AND EXISTS (
      SELECT 1
      FROM pedidos_compra p
      WHERE p.id = pedido_id
        AND p.status IN ('rascunho', 'em_cotacao')
        AND p.ativo = true
        AND pode_acessar_obra(p.obra_id)
    )
  );

CREATE POLICY coti_update_pre_aprovacao ON cotacoes_itens FOR UPDATE
  USING (
    pode_editar_compras()
    AND EXISTS (
      SELECT 1
      FROM cotacoes c
      JOIN pedidos_compra p ON p.id = c.pedido_id
      WHERE c.id = cotacao_id
        AND p.status IN ('rascunho', 'em_cotacao')
        AND p.ativo = true
        AND pode_acessar_obra(p.obra_id)
    )
  )
  WITH CHECK (
    pode_editar_compras()
    AND EXISTS (
      SELECT 1
      FROM cotacoes c
      JOIN pedidos_compra p ON p.id = c.pedido_id
      WHERE c.id = cotacao_id
        AND p.status IN ('rascunho', 'em_cotacao')
        AND p.ativo = true
        AND pode_acessar_obra(p.obra_id)
    )
  );

CREATE OR REPLACE FUNCTION marcar_edicao_cotacao()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.editado_em := now();
  NEW.editado_por := auth.uid();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_marcar_edicao_cotacao ON cotacoes;
DROP TRIGGER IF EXISTS trg_marcar_edicao_cotacao_item ON cotacoes_itens;

CREATE TRIGGER trg_marcar_edicao_cotacao
  BEFORE UPDATE ON cotacoes
  FOR EACH ROW
  EXECUTE FUNCTION marcar_edicao_cotacao();

CREATE TRIGGER trg_marcar_edicao_cotacao_item
  BEFORE UPDATE ON cotacoes_itens
  FOR EACH ROW
  EXECUTE FUNCTION marcar_edicao_cotacao();
