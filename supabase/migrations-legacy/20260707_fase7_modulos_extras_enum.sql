-- Fase 7 (Extras): novos módulos atribuíveis à equipe
-- Medições de empreiteiros · Contratos · FVS/qualidade · Galeria · Efetivo · Alertas
ALTER TYPE modulo_app ADD VALUE IF NOT EXISTS 'medicoes';
ALTER TYPE modulo_app ADD VALUE IF NOT EXISTS 'contratos';
ALTER TYPE modulo_app ADD VALUE IF NOT EXISTS 'fvs';
ALTER TYPE modulo_app ADD VALUE IF NOT EXISTS 'galeria';
ALTER TYPE modulo_app ADD VALUE IF NOT EXISTS 'efetivo';
ALTER TYPE modulo_app ADD VALUE IF NOT EXISTS 'alertas';
