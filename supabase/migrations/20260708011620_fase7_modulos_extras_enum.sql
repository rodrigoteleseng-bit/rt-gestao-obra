-- Fase 7 (Extras): novos módulos atribuíveis à equipe
ALTER TYPE modulo_app ADD VALUE IF NOT EXISTS 'medicoes';
ALTER TYPE modulo_app ADD VALUE IF NOT EXISTS 'contratos';
ALTER TYPE modulo_app ADD VALUE IF NOT EXISTS 'fvs';
ALTER TYPE modulo_app ADD VALUE IF NOT EXISTS 'galeria';
ALTER TYPE modulo_app ADD VALUE IF NOT EXISTS 'efetivo';
ALTER TYPE modulo_app ADD VALUE IF NOT EXISTS 'alertas';;
