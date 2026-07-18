-- Tamanho do rotulo (nome) de cada parede na planta clicavel, ajustavel por
-- botoes A-/A+ na aba Plantas. Parede sem ajuste continua no tamanho atual.
-- Pedido do Rodrigo em teste real em 18/07/2026.

ALTER TABLE producao_paredes
  ADD COLUMN IF NOT EXISTS rotulo_escala NUMERIC(3,2) NOT NULL DEFAULT 1
    CHECK (rotulo_escala >= 0.5 AND rotulo_escala <= 2.0);

NOTIFY pgrst, 'reload schema';
