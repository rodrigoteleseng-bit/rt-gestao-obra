-- Campos cadastrais adicionais da obra, pedidos pelo Rodrigo em Dados da Obra:
-- CNPJ (da incorporadora/empresa responsável por essa obra), CNO (Cadastro
-- Nacional de Obra, registro obrigatório da Receita Federal por canteiro),
-- endereço do escritório (distinto do endereço da obra, que já existia) e
-- e-mail de contato. Por enquanto só cadastro/referência — sem uso em PDF
-- ainda (confirmado com o Rodrigo). Mesmo padrão de nome_empreendimento
-- (20260908_pedido_compra_empreendimento.sql): TEXT nullable, sem mudança
-- de RLS (obras já é admin-only pra escrita).

ALTER TABLE obras ADD COLUMN cnpj TEXT;
ALTER TABLE obras ADD COLUMN cno_obra TEXT;
ALTER TABLE obras ADD COLUMN endereco_escritorio TEXT;
ALTER TABLE obras ADD COLUMN email TEXT;
