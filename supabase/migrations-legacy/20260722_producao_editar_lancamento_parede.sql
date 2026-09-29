-- Permite corrigir digitacao de data, area e preco em lancamentos de producao por parede.
-- Bloqueia alteracao quando o lancamento ja entrou em medicao e mantem o progresso da parede coerente.

CREATE OR REPLACE FUNCTION producao_editar_lancamento_parede(
  p_lancamento UUID,
  p_data DATE,
  p_area_m2 NUMERIC,
  p_preco NUMERIC
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_lanc producao_lancamentos%ROWTYPE;
  v_meta NUMERIC(14,4);
  v_produzido_atual NUMERIC(14,4);
  v_produzido_novo NUMERIC(14,4);
BEGIN
  SELECT *
    INTO v_lanc
  FROM producao_lancamentos
  WHERE id = p_lancamento AND ativo
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lancamento nao encontrado.';
  END IF;
  IF NOT pode_editar_medicoes() OR NOT pode_acessar_obra(v_lanc.obra_id) THEN
    RAISE EXCEPTION 'Sem permissao para editar este lancamento.';
  END IF;
  IF v_lanc.cancelado_em IS NOT NULL THEN
    RAISE EXCEPTION 'Lancamento cancelado nao pode ser editado.';
  END IF;
  IF v_lanc.parede_id IS NULL THEN
    RAISE EXCEPTION 'Lancamento antigo sem parede vinculada nao pode ser editado por esta tela.';
  END IF;
  IF p_data IS NULL OR p_area_m2 IS NULL OR p_area_m2 <= 0 OR p_preco IS NULL OR p_preco <= 0 THEN
    RAISE EXCEPTION 'Informe data, area e preco validos.';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM producao_medicao_lancamentos ml
    JOIN producao_participantes p ON p.id = ml.participante_id
    WHERE p.lancamento_id = p_lancamento
      AND ml.ativo
  ) THEN
    RAISE EXCEPTION 'Producao ja incluida em medicao nao pode ser alterada.';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM producao_participantes p
    JOIN producao_dias_salariais d
      ON d.trabalhador_id = p.trabalhador_id
     AND d.obra_id = v_lanc.obra_id
     AND d.data = p_data
     AND d.ativo
    WHERE p.lancamento_id = p_lancamento
      AND p.ativo
  ) THEN
    RAISE EXCEPTION 'Um profissional deste lancamento ja possui dia salarial na nova data.';
  END IF;

  IF v_lanc.servico = 'alvenaria' THEN
    SELECT meta_alvenaria_m2 INTO v_meta
    FROM producao_paredes
    WHERE id = v_lanc.parede_id;
  ELSE
    SELECT CASE v_lanc.face WHEN 'a' THEN meta_reboco_a_m2 ELSE meta_reboco_b_m2 END
      INTO v_meta
    FROM producao_paredes
    WHERE id = v_lanc.parede_id;
  END IF;

  IF v_meta IS NULL THEN
    RAISE EXCEPTION 'Parede sem meta cadastrada para este servico.';
  END IF;

  SELECT produzido_m2
    INTO v_produzido_atual
  FROM producao_paredes_progresso
  WHERE parede_id = v_lanc.parede_id
    AND unidade_id = v_lanc.unidade_id
    AND servico = v_lanc.servico
    AND face IS NOT DISTINCT FROM v_lanc.face
  FOR UPDATE;

  v_produzido_atual := COALESCE(v_produzido_atual, 0);
  v_produzido_novo := ROUND(v_produzido_atual - v_lanc.area_liquida + p_area_m2, 4);

  IF v_produzido_novo < 0 THEN
    RAISE EXCEPTION 'A correcao deixaria o progresso da parede negativo.';
  END IF;
  IF v_produzido_novo > v_meta THEN
    RAISE EXCEPTION 'Area corrigida ultrapassa a meta da parede (saldo maximo para este lancamento: % m2).',
      ROUND(v_meta - (v_produzido_atual - v_lanc.area_liquida), 2);
  END IF;

  UPDATE producao_lancamentos
  SET data_producao = p_data,
      area_liquida = ROUND(p_area_m2, 4),
      preco_m2 = ROUND(p_preco, 2)
  WHERE id = p_lancamento;

  PERFORM producao_recalcular(p_lancamento);

  UPDATE producao_paredes_progresso
  SET produzido_m2 = v_produzido_novo,
      atualizado_em = now()
  WHERE parede_id = v_lanc.parede_id
    AND unidade_id = v_lanc.unidade_id
    AND servico = v_lanc.servico
    AND face IS NOT DISTINCT FROM v_lanc.face;
END;
$$;

REVOKE ALL ON FUNCTION producao_editar_lancamento_parede(UUID, DATE, NUMERIC, NUMERIC) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION producao_editar_lancamento_parede(UUID, DATE, NUMERIC, NUMERIC) TO authenticated;
