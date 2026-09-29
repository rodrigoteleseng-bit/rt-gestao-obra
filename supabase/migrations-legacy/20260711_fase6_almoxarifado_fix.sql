-- Ajustes de revisão da Task 1 (Almoxarifado):
-- 1. INSERT policies passam a exigir criado_por = auth.uid() (rastreabilidade §6).
-- 2. Trigger de sincronização com pedido avisa quando a reversão encontraria valor negativo.

ALTER POLICY mat_insert ON materiais
  WITH CHECK (pode_editar_almoxarifado() AND criado_por = auth.uid());
ALTER POLICY mov_insert ON estoque_movimentos
  WITH CHECK (pode_editar_almoxarifado() AND criado_por = auth.uid());
ALTER POLICY fer_insert ON ferramentas
  WITH CHECK (pode_editar_almoxarifado() AND criado_por = auth.uid());
ALTER POLICY femp_insert ON ferramenta_emprestimos
  WITH CHECK (pode_editar_almoxarifado() AND criado_por = auth.uid());

CREATE OR REPLACE FUNCTION sincroniza_recebimento_pedido()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_atual numeric;
BEGIN
  IF TG_OP = 'INSERT' AND NEW.tipo = 'entrada' AND NEW.pedido_item_id IS NOT NULL THEN
    UPDATE pedidos_compra_itens
    SET quantidade_recebida = quantidade_recebida + NEW.quantidade
    WHERE id = NEW.pedido_item_id;
  ELSIF TG_OP = 'UPDATE' AND OLD.ativo AND NOT NEW.ativo
        AND NEW.tipo = 'entrada' AND NEW.pedido_item_id IS NOT NULL THEN
    SELECT quantidade_recebida INTO v_atual FROM pedidos_compra_itens WHERE id = NEW.pedido_item_id;
    IF v_atual IS NOT NULL AND v_atual < NEW.quantidade THEN
      RAISE WARNING 'Reversao de entrada %: quantidade_recebida (%) menor que o movimento (%) — possivel dessincronizacao', NEW.id, v_atual, NEW.quantidade;
    END IF;
    UPDATE pedidos_compra_itens
    SET quantidade_recebida = GREATEST(quantidade_recebida - NEW.quantidade, 0)
    WHERE id = NEW.pedido_item_id;
  END IF;
  RETURN NEW;
END;
$$;
