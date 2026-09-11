-- Razão Social (campo novo, separado de nome_empreendimento -- este último
-- continua alimentando o título dos PDFs de Medição/Produção Própria/Pedido
-- de Compra como já fazia; Razão Social é só para o quadro "Dados para
-- Emissão de Nota Fiscal") e dados do Engenheiro da Obra (nome + CREA, para
-- assinar como "Eng. da Obra" no PDF de Medição, em vez de mostrar sempre
-- quem lançou o registro no app). Mesmo padrão dos campos cadastrais já
-- adicionados em 20260910_obras_dados_cadastrais.sql: TEXT nullable, sem
-- mudança de RLS.

ALTER TABLE obras ADD COLUMN razao_social TEXT;
ALTER TABLE obras ADD COLUMN engenheiro_obra_nome TEXT;
ALTER TABLE obras ADD COLUMN engenheiro_obra_crea TEXT;
