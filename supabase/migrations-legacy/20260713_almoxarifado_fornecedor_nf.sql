-- Fornecedor + NF opcionais na entrada de material, coexistindo com o
-- vínculo a pedido de compra (pedido_item_id). Sem preço, sem anexo —
-- só rastreabilidade de "de qual fornecedor veio" pra consulta futura.
ALTER TABLE estoque_movimentos
  ADD COLUMN fornecedor_id UUID REFERENCES fornecedores(id),
  ADD COLUMN numero_nf     TEXT;
