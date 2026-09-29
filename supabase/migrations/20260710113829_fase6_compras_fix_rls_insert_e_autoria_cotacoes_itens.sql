DROP POLICY pc_insert ON pedidos_compra;
CREATE POLICY pc_insert ON pedidos_compra FOR INSERT
  WITH CHECK (
    pode_editar_compras()
    AND (status = 'rascunho' OR meu_papel() = 'admin')
  );

ALTER TABLE cotacoes_itens
  ADD COLUMN criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN criado_por UUID NOT NULL DEFAULT auth.uid() REFERENCES perfis_usuario(id);;
