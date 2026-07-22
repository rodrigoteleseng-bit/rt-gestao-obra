-- Fase 3a - Financeiro: evita reavaliacao por linha de auth.uid() na policy de INSERT.

DROP POLICY IF EXISTS lf_insert ON lancamentos_financeiros;

CREATE POLICY lf_insert ON lancamentos_financeiros FOR INSERT TO authenticated
  WITH CHECK (pode_editar_financeiro() AND criado_por = (select auth.uid()));
