BEGIN;

-- Locacoes por hora aceitam fracao (ex.: 4.8 horas). Mantemos o mesmo
-- tipo nas devolucoes para permitir baixa parcial com casas decimais.
ALTER TABLE ferramenta_locacoes
  DROP CONSTRAINT IF EXISTS ferramenta_locacoes_quantidade_check;

DROP TRIGGER IF EXISTS trg_sincronizar_locacao_item_pedido ON ferramenta_locacoes;

ALTER TABLE ferramenta_locacoes
  ALTER COLUMN quantidade TYPE NUMERIC(14,4) USING quantidade::NUMERIC;

ALTER TABLE ferramenta_locacoes_devolucoes
  ALTER COLUMN quantidade TYPE NUMERIC(14,4) USING quantidade::NUMERIC;

ALTER TABLE ferramenta_locacoes
  ADD CONSTRAINT ferramenta_locacoes_quantidade_check CHECK (quantidade > 0);

CREATE TRIGGER trg_sincronizar_locacao_item_pedido
  AFTER INSERT OR UPDATE OF data_entregue, quantidade, ativo, pedido_item_id ON ferramenta_locacoes
  FOR EACH ROW EXECUTE FUNCTION sincronizar_locacao_item_pedido();

COMMIT;
