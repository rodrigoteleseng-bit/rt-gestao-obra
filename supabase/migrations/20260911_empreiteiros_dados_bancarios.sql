-- Dados bancários do empreiteiro (banco, agência, conta -- pix já existia),
-- pedidos pelo Rodrigo pra aparecerem no quadro "Dados para Emissão de
-- Nota Fiscal" do PDF de Medição, numa seção "Informações:" nova, junto
-- com uma linha de referência automática (ex.: "Nota fiscal referente a
-- MED-004 do CT-001, referente a serviço de <objeto do contrato>"). Mesmo
-- padrão de nullable TEXT já usado pros outros campos cadastrais.

ALTER TABLE empreiteiros ADD COLUMN banco TEXT;
ALTER TABLE empreiteiros ADD COLUMN agencia TEXT;
ALTER TABLE empreiteiros ADD COLUMN conta TEXT;
