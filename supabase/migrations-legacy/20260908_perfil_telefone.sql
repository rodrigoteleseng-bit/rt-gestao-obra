-- Telefone do usuário, usado no bloco de identificação do PDF de Pedido de
-- Compra (linha do solicitante). Nullable: sem UI de edição ainda (aplicado
-- manualmente por SQL pra quem precisar, até existir tela pra isso).
ALTER TABLE perfis_usuario ADD COLUMN telefone TEXT;
