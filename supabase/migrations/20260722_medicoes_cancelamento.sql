-- Medicoes (empreiteiros): permite cancelar uma medicao aprovada,
-- preservando o registro. Ver docs/superpowers/specs/2026-07-22-medicoes-cancelamento-design.md
-- ALTER TYPE ... ADD VALUE nao pode ser referenciado na mesma transacao
-- (CLAUDE.md §0) - por isso esta migracao so adiciona o valor e as colunas;
-- o trigger e a RPC que os referenciam ficam na migracao seguinte.

ALTER TYPE status_medicao ADD VALUE 'cancelada';

ALTER TABLE medicoes
  ADD COLUMN motivo_cancelamento TEXT,
  ADD COLUMN cancelada_por       UUID REFERENCES perfis_usuario(id),
  ADD COLUMN cancelada_em        TIMESTAMPTZ;
