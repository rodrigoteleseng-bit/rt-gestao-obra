-- Ajuste de campos do Controle Tecnológico encontrado no primeiro teste de campo real
-- (ver docs/superpowers/specs/2026-09-10-ct-lacre-horario-slump-design.md):
-- lacre da betoneira obrigatório e slump solicitado com tolerância simétrica.
-- As colunas de horário (hora_saida_usina etc.) não mudam de tipo aqui — só muda
-- como o frontend as preenche (usa a data da concretagem em vez de pedir de novo).

ALTER TABLE ct_caminhoes ADD COLUMN numero_lacre TEXT;
ALTER TABLE ct_caminhoes ADD COLUMN slump_tolerancia_cm NUMERIC(4,1);

-- Precisa que nenhuma linha tenha ficado com numero_lacre nulo (Steps 1-2 acima
-- limpam os únicos dados existentes, todos de teste, antes deste ponto).
ALTER TABLE ct_caminhoes ALTER COLUMN numero_lacre SET NOT NULL;
ALTER TABLE ct_caminhoes ADD CONSTRAINT ct_caminhoes_lacre_nao_vazio CHECK (btrim(numero_lacre) <> '');
