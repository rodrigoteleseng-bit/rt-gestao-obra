-- Posição e ângulo do rótulo (nome) de cada parede na planta clicável, ajustáveis
-- livremente por arrastar/girar na aba Plantas — resolve nomes de paredes próximas
-- ficando um em cima do outro. Colunas opcionais: parede sem ajuste continua usando
-- a posição padrão (canto da faixa, sem rotação), calculada no frontend.
-- Pedido do Rodrigo em teste real em 17/07/2026.

ALTER TABLE producao_paredes
  ADD COLUMN rotulo_pos_x NUMERIC(6,3) CHECK (rotulo_pos_x IS NULL OR (rotulo_pos_x >= 0 AND rotulo_pos_x <= 100)),
  ADD COLUMN rotulo_pos_y NUMERIC(6,3) CHECK (rotulo_pos_y IS NULL OR (rotulo_pos_y >= 0 AND rotulo_pos_y <= 100)),
  ADD COLUMN rotulo_rotacao NUMERIC(5,1) NOT NULL DEFAULT 0 CHECK (rotulo_rotacao >= -180 AND rotulo_rotacao <= 180);
