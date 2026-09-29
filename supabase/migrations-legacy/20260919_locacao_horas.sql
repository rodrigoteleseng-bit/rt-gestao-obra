BEGIN;

-- Locacoes de equipamentos podem ser cobradas por horas trabalhadas.
-- A quantidade ja e NUMERIC e, nessa modalidade, aceita fracoes (ex.: 2.5 h).
ALTER TYPE modalidade_locacao_ferramenta ADD VALUE IF NOT EXISTS 'horaria';

COMMIT;
