-- Nome comercial do empreendimento, distinto do nome da obra (código interno do app).
-- Usado no cabeçalho do PDF de Pedido de Compra. Nullable: obra sem esse dado
-- preenchido mostra só o nome da obra, sem inventar texto.
ALTER TABLE obras ADD COLUMN nome_empreendimento TEXT;
