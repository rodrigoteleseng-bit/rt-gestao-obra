-- Assinatura muda de tipo (1 DATE -> 2 DATE) — CREATE OR REPLACE criaria uma
-- segunda função sobrecarregada em vez de substituir; precisa DROP explícito
-- da assinatura antiga primeiro.
DROP FUNCTION IF EXISTS criar_medicao_com_itens(UUID, DATE, JSONB);

CREATE OR REPLACE FUNCTION criar_medicao_com_itens(
  p_contrato UUID, p_data_inicio DATE, p_data_fim DATE, p_itens JSONB
)
RETURNS UUID LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE v_medicao_id UUID; v_obra UUID; v_item JSONB;
BEGIN
  SELECT obra_id INTO v_obra FROM contratos WHERE id=p_contrato AND ativo=true AND status='ativo' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Contrato inexistente ou fora do status ativo.'; END IF;
  IF NOT pode_editar_medicoes() OR NOT pode_acessar_obra(v_obra) THEN RAISE EXCEPTION 'Sem permissao para criar medicao neste contrato.'; END IF;
  IF p_data_inicio IS NULL OR p_data_fim IS NULL THEN RAISE EXCEPTION 'Periodo da medicao obrigatorio.'; END IF;
  IF p_data_fim < p_data_inicio THEN RAISE EXCEPTION 'Data fim nao pode ser anterior a data inicio.'; END IF;
  IF jsonb_typeof(p_itens)<>'array' OR jsonb_array_length(p_itens)=0 THEN RAISE EXCEPTION 'A medicao precisa de itens.'; END IF;

  INSERT INTO medicoes (contrato_id,data_inicio,data_fim) VALUES (p_contrato,p_data_inicio,p_data_fim) RETURNING id INTO v_medicao_id;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_itens) LOOP
    IF COALESCE((v_item->>'quantidade_periodo')::NUMERIC,-1)<0 THEN RAISE EXCEPTION 'Quantidade medida nao pode ser negativa.'; END IF;
    IF NOT EXISTS (SELECT 1 FROM contratos_itens WHERE id=(v_item->>'contrato_item_id')::UUID AND contrato_id=p_contrato AND ativo=true) THEN
      RAISE EXCEPTION 'Item nao pertence ao contrato da medicao.';
    END IF;
    INSERT INTO medicoes_itens (medicao_id,contrato_item_id,quantidade_periodo)
    VALUES (v_medicao_id,(v_item->>'contrato_item_id')::UUID,(v_item->>'quantidade_periodo')::NUMERIC);
  END LOOP;
  RETURN v_medicao_id;
END;
$$;

REVOKE ALL ON FUNCTION criar_medicao_com_itens(UUID,DATE,DATE,JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION criar_medicao_com_itens(UUID,DATE,DATE,JSONB) TO authenticated;
