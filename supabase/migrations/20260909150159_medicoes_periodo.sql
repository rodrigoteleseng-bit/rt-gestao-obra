ALTER TABLE medicoes
  ADD COLUMN data_inicio DATE,
  ADD COLUMN data_fim    DATE;

ALTER TABLE medicoes DISABLE TRIGGER trg_restringir_status_medicao;

UPDATE medicoes SET data_inicio = data_referencia, data_fim = data_referencia
WHERE data_inicio IS NULL;

ALTER TABLE medicoes ENABLE TRIGGER trg_restringir_status_medicao;

ALTER TABLE medicoes
  ALTER COLUMN data_inicio SET NOT NULL,
  ALTER COLUMN data_fim    SET NOT NULL,
  ADD CONSTRAINT chk_medicoes_periodo CHECK (data_fim >= data_inicio),
  DROP COLUMN data_referencia;
;
