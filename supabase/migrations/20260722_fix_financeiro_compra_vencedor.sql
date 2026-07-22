-- Corrige a ingestao Compras -> Financeiro: o vencedor por item fica em
-- pedidos_compra_itens.cotacao_item_vencedora_id, nao em cotacoes_itens.

CREATE OR REPLACE FUNCTION financeiro_ingerir_compra_item()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_obra_id UUID;
  v_favorecido TEXT;
  v_etapa_id UUID;
BEGIN
  IF NEW.valor_recebido IS NOT NULL
     AND NEW.valor_recebido > 0
     AND OLD.valor_recebido IS NULL THEN
    SELECT pc.obra_id INTO v_obra_id
    FROM pedidos_compra pc
    WHERE pc.id = NEW.pedido_id;

    SELECT f.nome INTO v_favorecido
    FROM pedidos_compra_itens pci
    JOIN cotacoes_itens cit ON cit.id = pci.cotacao_item_vencedora_id
    JOIN cotacoes cot ON cot.id = cit.cotacao_id
    JOIN fornecedores f ON f.id = cot.fornecedor_id
    WHERE pci.id = NEW.id;

    IF NEW.servico_id IS NOT NULL THEN
      SELECT etapa_id INTO v_etapa_id
      FROM servicos
      WHERE id = NEW.servico_id;
    END IF;

    INSERT INTO lancamentos_financeiros (
      obra_id, etapa_id, servico_id, descricao, favorecido, valor, pedido_item_id, criado_por
    )
    VALUES (
      v_obra_id,
      v_etapa_id,
      NEW.servico_id,
      'Compra - ' || NEW.descricao_item,
      COALESCE(v_favorecido, 'Fornecedor nao informado'),
      NEW.valor_recebido,
      NEW.id,
      auth.uid()
    );
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION financeiro_ingerir_compra_item() FROM PUBLIC, anon, authenticated;
