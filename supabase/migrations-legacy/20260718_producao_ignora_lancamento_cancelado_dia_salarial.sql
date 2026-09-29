-- Lançamentos de produção cancelados não podem bloquear o registro de dia salarial.
-- A coluna cancelado_em foi adicionada depois da trigger original de dias salariais.
CREATE OR REPLACE FUNCTION producao_preparar_dia_salarial() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_sal producao_salarios%ROWTYPE;
BEGIN
  SELECT * INTO v_sal
  FROM producao_salarios s
  WHERE s.id = NEW.salario_id
    AND s.ativo
    AND s.obra_id = NEW.obra_id
    AND s.trabalhador_id = NEW.trabalhador_id
    AND s.vigente_desde <= NEW.data
    AND (s.vigente_ate IS NULL OR s.vigente_ate >= NEW.data);

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Não há salário vigente válido para esta data.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM producao_participantes p
    JOIN producao_lancamentos l ON l.id = p.lancamento_id
    WHERE p.trabalhador_id = NEW.trabalhador_id
      AND p.ativo
      AND l.ativo
      AND l.cancelado_em IS NULL
      AND l.obra_id = NEW.obra_id
      AND l.data_producao = NEW.data
  ) THEN
    RAISE EXCEPTION 'O profissional já possui produção nesta data.';
  END IF;

  NEW.salario_mensal_snapshot := v_sal.salario_mensal;
  NEW.divisor_snapshot := 30;
  NEW.valor_dia := v_sal.salario_mensal / 30.0;
  RETURN NEW;
END;
$$;