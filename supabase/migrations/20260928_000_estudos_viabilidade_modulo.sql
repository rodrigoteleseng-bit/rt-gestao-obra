-- Deve ser executada em transacao separada: um novo valor de enum nao pode ser
-- referenciado pela mesma migration no Postgres.
ALTER TYPE modulo_app ADD VALUE IF NOT EXISTS 'estudos_viabilidade';
