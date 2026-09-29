ALTER TABLE estoque_movimentos
  ADD COLUMN fornecedor_id UUID REFERENCES fornecedores(id),
  ADD COLUMN numero_nf     TEXT;;
