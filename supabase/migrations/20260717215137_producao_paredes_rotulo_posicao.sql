ALTER TABLE producao_paredes
  ADD COLUMN rotulo_pos_x NUMERIC(6,3) CHECK (rotulo_pos_x IS NULL OR (rotulo_pos_x >= 0 AND rotulo_pos_x <= 100)),
  ADD COLUMN rotulo_pos_y NUMERIC(6,3) CHECK (rotulo_pos_y IS NULL OR (rotulo_pos_y >= 0 AND rotulo_pos_y <= 100)),
  ADD COLUMN rotulo_rotacao NUMERIC(5,1) NOT NULL DEFAULT 0 CHECK (rotulo_rotacao >= -180 AND rotulo_rotacao <= 180);;
