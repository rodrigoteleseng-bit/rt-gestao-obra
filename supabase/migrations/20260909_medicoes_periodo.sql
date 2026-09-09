-- Medições (empreiteiros): troca data_referencia (uma data) por um
-- período (data_inicio/data_fim) — formato real confirmado numa planilha
-- de medição de campo (Prudência Serviços Ltda, análise de 09/09/2026).
-- Mesmo padrão já usado em producao_medicoes (20260716_fase7_producao_propria.sql:100-101).

ALTER TABLE medicoes
  ADD COLUMN data_inicio DATE,
  ADD COLUMN data_fim    DATE;

-- Backfill precisa contornar trg_restringir_status_medicao: esse trigger bloqueia
-- QUALQUER UPDATE numa medição aprovada/cancelada (mesmo de migração de schema) —
-- achado ao tentar aplicar esta migração contra o dado real (CT-001/JFC, já cancelada).
-- Desabilitado só para este UPDATE pontual, reabilitado logo em seguida.
ALTER TABLE medicoes DISABLE TRIGGER trg_restringir_status_medicao;

UPDATE medicoes SET data_inicio = data_referencia, data_fim = data_referencia
WHERE data_inicio IS NULL;

ALTER TABLE medicoes ENABLE TRIGGER trg_restringir_status_medicao;

ALTER TABLE medicoes
  ALTER COLUMN data_inicio SET NOT NULL,
  ALTER COLUMN data_fim    SET NOT NULL,
  ADD CONSTRAINT chk_medicoes_periodo CHECK (data_fim >= data_inicio),
  DROP COLUMN data_referencia;
