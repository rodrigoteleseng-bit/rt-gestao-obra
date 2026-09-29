-- Fase 3a - Financeiro: ingestao automatica de medicoes de empreiteiro aprovadas.

CREATE OR REPLACE FUNCTION financeiro_ingerir_medicao()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_obra_id UUID;
  v_favorecido TEXT;
BEGIN
  IF NEW.status = 'aprovada' AND (OLD.status IS DISTINCT FROM 'aprovada') THEN
    SELECT c.obra_id, e.nome INTO v_obra_id, v_favorecido
    FROM contratos c JOIN empreiteiros e ON e.id = c.empreiteiro_id
    WHERE c.id = NEW.contrato_id;

    INSERT INTO lancamentos_financeiros (
      obra_id, unidade_id, etapa_id, servico_id, descricao, favorecido, valor,
      medicao_item_id, criado_por
    )
    SELECT
      v_obra_id, ci.unidade_id, s.etapa_id, ci.servico_id,
      'Medicao ' || NEW.numero || ' - ' || s.nome,
      v_favorecido,
      ROUND(mi.valor_total_item * (NEW.valor_liquido / NULLIF(NEW.valor_bruto, 0)), 2),
      mi.id,
      NEW.aprovada_por
    FROM medicoes_itens mi
    JOIN contratos_itens ci ON ci.id = mi.contrato_item_id
    JOIN servicos s ON s.id = ci.servico_id
    WHERE mi.medicao_id = NEW.id
      AND mi.ativo = true
      AND ROUND(mi.valor_total_item * (NEW.valor_liquido / NULLIF(NEW.valor_bruto, 0)), 2) > 0;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION financeiro_ingerir_medicao() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_financeiro_ingerir_medicao ON medicoes;

CREATE TRIGGER trg_financeiro_ingerir_medicao
  AFTER UPDATE ON medicoes
  FOR EACH ROW EXECUTE FUNCTION financeiro_ingerir_medicao();

-- Backfill: medicoes ja aprovadas antes desta migracao existir (hoje: 1 real - ver spec §2/§10,
-- contrato JFC Instalacoes). Idempotente (NOT EXISTS), seguro rodar mais de uma vez.
INSERT INTO lancamentos_financeiros (
  obra_id, unidade_id, etapa_id, servico_id, descricao, favorecido, valor,
  medicao_item_id, criado_por
)
SELECT
  c.obra_id, ci.unidade_id, s.etapa_id, ci.servico_id,
  'Medicao ' || m.numero || ' - ' || s.nome,
  e.nome,
  ROUND(mi.valor_total_item * (m.valor_liquido / NULLIF(m.valor_bruto, 0)), 2),
  mi.id,
  m.aprovada_por
FROM medicoes m
JOIN contratos c ON c.id = m.contrato_id
JOIN empreiteiros e ON e.id = c.empreiteiro_id
JOIN medicoes_itens mi ON mi.medicao_id = m.id AND mi.ativo = true
JOIN contratos_itens ci ON ci.id = mi.contrato_item_id
JOIN servicos s ON s.id = ci.servico_id
WHERE m.status = 'aprovada'
  AND ROUND(mi.valor_total_item * (m.valor_liquido / NULLIF(m.valor_bruto, 0)), 2) > 0
  AND NOT EXISTS (
    SELECT 1 FROM lancamentos_financeiros lf WHERE lf.medicao_item_id = mi.id
  );
