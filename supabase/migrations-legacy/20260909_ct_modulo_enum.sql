-- Valor novo do enum precisa estar isolado, sem nada na mesma transação
-- que o referencie (ALTER TYPE ... ADD VALUE não pode ser usado e
-- referenciado na mesma transação — CLAUDE.md §0).
ALTER TYPE modulo_app ADD VALUE 'controle_tecnologico';
