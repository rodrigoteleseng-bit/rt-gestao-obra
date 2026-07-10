-- ============================================================
-- FVS — estado "aguardando conferência" | RT Engenharia
-- ============================================================
-- Permite preencher uma FVS por partes ao longo de vários dias.
-- Ex.: FVS-003 (Forma, armação e concretagem) — confere a armação
-- num dia, a forma noutro, a concretagem noutro. Itens que ainda não
-- estão prontos para conferir ficam como 'aguardando'; a verificação
-- só é concluída (e assinada) quando não houver mais 'aguardando'.
-- Decisão do Rodrigo em 10/07/2026.

ALTER TYPE resposta_fvs ADD VALUE IF NOT EXISTS 'aguardando';
