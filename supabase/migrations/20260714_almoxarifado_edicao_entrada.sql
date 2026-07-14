-- ============================================================
-- ALMOXARIFADO — edição de entrada por admin + correção do trigger
-- de sincronização com quantidade_recebida do pedido de compra
-- ============================================================
-- Spec: docs/superpowers/specs/2026-07-14-almoxarifado-lote-edicao-design.md
--
-- editado_por/editado_em: rastreabilidade de correção (CLAUDE.md §6) —
-- nunca sobrescreve criado_por/criado_em original.
ALTER TABLE estoque_movimentos
  ADD COLUMN editado_por UUID REFERENCES perfis_usuario(id),
  ADD COLUMN editado_em  TIMESTAMPTZ;

-- O trigger original só reagia a UPDATE OF ativo (inativar), então uma
-- correção de quantidade/vínculo numa entrada já ligada a um item de
-- pedido deixava quantidade_recebida desatualizado. Generaliza pra
-- sempre reverter o efeito antigo da linha e aplicar o novo — cobre
-- quantidade, pedido_item_id e ativo com a mesma lógica, em vez de
-- tratar cada campo separadamente.
CREATE OR REPLACE FUNCTION sincroniza_recebimento_pedido()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.tipo = 'entrada' AND NEW.pedido_item_id IS NOT NULL THEN
    UPDATE pedidos_compra_itens
    SET quantidade_recebida = quantidade_recebida + NEW.quantidade
    WHERE id = NEW.pedido_item_id;

  ELSIF TG_OP = 'UPDATE' AND NEW.tipo = 'entrada' THEN
    IF OLD.ativo AND OLD.pedido_item_id IS NOT NULL THEN
      UPDATE pedidos_compra_itens
      SET quantidade_recebida = GREATEST(quantidade_recebida - OLD.quantidade, 0)
      WHERE id = OLD.pedido_item_id;
    END IF;
    IF NEW.ativo AND NEW.pedido_item_id IS NOT NULL THEN
      UPDATE pedidos_compra_itens
      SET quantidade_recebida = quantidade_recebida + NEW.quantidade
      WHERE id = NEW.pedido_item_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Precisa recriar o trigger pra escutar também UPDATE OF quantidade,
-- pedido_item_id (antes só escutava UPDATE OF ativo).
DROP TRIGGER trg_sincroniza_recebimento ON estoque_movimentos;
CREATE TRIGGER trg_sincroniza_recebimento
  AFTER INSERT OR UPDATE OF ativo, quantidade, pedido_item_id ON estoque_movimentos
  FOR EACH ROW EXECUTE FUNCTION sincroniza_recebimento_pedido();
