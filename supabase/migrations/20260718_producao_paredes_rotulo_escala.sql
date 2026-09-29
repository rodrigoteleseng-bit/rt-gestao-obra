ALTER TABLE producao_paredes ADD COLUMN IF NOT EXISTS rotulo_escala NUMERIC(3,2) NOT NULL DEFAULT 1 CHECK (rotulo_escala >= 0.5 AND rotulo_escala <= 2.0);;
