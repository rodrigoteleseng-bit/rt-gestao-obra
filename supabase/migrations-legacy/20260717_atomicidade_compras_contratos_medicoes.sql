-- ============================================================
-- AUDITORIA — ATOMICIDADE EM COMPRAS, CONTRATOS E MEDICOES
-- ============================================================
-- Cada RPC executa cabecalho + itens (ou todo o lote de edicao) na
-- mesma transacao PostgreSQL. Qualquer excecao desfaz o conjunto.
-- SECURITY INVOKER e RLS preservam permissoes e isolamento por obra.

CREATE OR REPLACE FUNCTION criar_pedido_compra_com_itens(
  p_obra UUID,
  p_descricao TEXT,
  p_itens JSONB
) RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_pedido_id UUID;
  v_item JSONB;
  v_servico UUID;
BEGIN
  IF NOT pode_editar_compras() OR NOT pode_acessar_obra(p_obra) THEN
    RAISE EXCEPTION 'Sem permissao para criar pedido nesta obra.';
  END IF;
  IF jsonb_typeof(p_itens) <> 'array' OR jsonb_array_length(p_itens) = 0 THEN
    RAISE EXCEPTION 'O pedido precisa de ao menos um item.';
  END IF;

  INSERT INTO pedidos_compra (obra_id, descricao)
  VALUES (p_obra, NULLIF(btrim(p_descricao), ''))
  RETURNING id INTO v_pedido_id;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_itens)
  LOOP
    v_servico := NULLIF(v_item->>'servico_id', '')::UUID;
    IF NULLIF(btrim(v_item->>'descricao_item'), '') IS NULL
       OR COALESCE((v_item->>'quantidade_pedida')::NUMERIC, 0) <= 0 THEN
      RAISE EXCEPTION 'Item de pedido invalido: descricao e quantidade positiva sao obrigatorias.';
    END IF;
    IF v_servico IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM servicos s
      JOIN etapas e ON e.id = s.etapa_id
      JOIN unidades u ON u.id = e.unidade_id
      WHERE s.id = v_servico AND s.ativo = true AND u.obra_id = p_obra
    ) THEN
      RAISE EXCEPTION 'O servico informado nao pertence a obra do pedido.';
    END IF;

    INSERT INTO pedidos_compra_itens (
      pedido_id, servico_id, descricao_item, quantidade_pedida, und, data_necessaria, urgente
    ) VALUES (
      v_pedido_id, v_servico, btrim(v_item->>'descricao_item'),
      (v_item->>'quantidade_pedida')::NUMERIC, NULLIF(btrim(v_item->>'und'), ''),
      NULLIF(v_item->>'data_necessaria', '')::DATE,
      COALESCE((v_item->>'urgente')::BOOLEAN, false)
    );
  END LOOP;

  RETURN v_pedido_id;
END;
$$;

CREATE OR REPLACE FUNCTION salvar_itens_pedido_compra(
  p_pedido UUID,
  p_itens JSONB
) RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_obra UUID;
  v_status status_pedido_compra;
  v_item JSONB;
  v_id UUID;
  v_servico UUID;
BEGIN
  SELECT obra_id, status INTO v_obra, v_status
  FROM pedidos_compra WHERE id = p_pedido AND ativo = true FOR UPDATE;
  IF NOT FOUND OR v_status <> 'rascunho' THEN
    RAISE EXCEPTION 'Pedido inexistente ou fora do rascunho.';
  END IF;
  IF NOT pode_editar_compras() OR NOT pode_acessar_obra(v_obra) THEN
    RAISE EXCEPTION 'Sem permissao para editar este pedido.';
  END IF;
  IF jsonb_typeof(p_itens) <> 'array' OR NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_itens) x
    WHERE NOT COALESCE((x->>'removido')::BOOLEAN, false)
      AND NULLIF(btrim(x->>'descricao_item'), '') IS NOT NULL
      AND COALESCE((x->>'quantidade_pedida')::NUMERIC, 0) > 0
  ) THEN
    RAISE EXCEPTION 'O pedido precisa de ao menos um item valido.';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_itens)
  LOOP
    v_id := NULLIF(v_item->>'id', '')::UUID;
    IF v_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM pedidos_compra_itens WHERE id = v_id AND pedido_id = p_pedido
    ) THEN
      RAISE EXCEPTION 'Item nao pertence ao pedido.';
    END IF;
    IF COALESCE((v_item->>'removido')::BOOLEAN, false) THEN
      IF v_id IS NOT NULL THEN
        UPDATE pedidos_compra_itens SET ativo = false WHERE id = v_id;
      END IF;
      CONTINUE;
    END IF;

    v_servico := NULLIF(v_item->>'servico_id', '')::UUID;
    IF NULLIF(btrim(v_item->>'descricao_item'), '') IS NULL
       OR COALESCE((v_item->>'quantidade_pedida')::NUMERIC, 0) <= 0 THEN
      RAISE EXCEPTION 'Item de pedido invalido.';
    END IF;
    IF v_servico IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM servicos s JOIN etapas e ON e.id=s.etapa_id JOIN unidades u ON u.id=e.unidade_id
      WHERE s.id=v_servico AND s.ativo=true AND u.obra_id=v_obra
    ) THEN
      RAISE EXCEPTION 'O servico informado nao pertence a obra do pedido.';
    END IF;

    IF v_id IS NULL THEN
      INSERT INTO pedidos_compra_itens
        (pedido_id, servico_id, descricao_item, quantidade_pedida, und, data_necessaria, urgente)
      VALUES (p_pedido, v_servico, btrim(v_item->>'descricao_item'),
        (v_item->>'quantidade_pedida')::NUMERIC, NULLIF(btrim(v_item->>'und'), ''),
        NULLIF(v_item->>'data_necessaria', '')::DATE, COALESCE((v_item->>'urgente')::BOOLEAN, false));
    ELSE
      UPDATE pedidos_compra_itens SET
        servico_id=v_servico, descricao_item=btrim(v_item->>'descricao_item'),
        quantidade_pedida=(v_item->>'quantidade_pedida')::NUMERIC,
        und=NULLIF(btrim(v_item->>'und'), ''), data_necessaria=NULLIF(v_item->>'data_necessaria', '')::DATE,
        urgente=COALESCE((v_item->>'urgente')::BOOLEAN, false), ativo=true
      WHERE id=v_id;
    END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION criar_contrato_com_itens(
  p_obra UUID,
  p_empreiteiro UUID,
  p_objeto TEXT,
  p_condicao_pagamento TEXT,
  p_retencao_pct NUMERIC,
  p_itens JSONB
) RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_contrato_id UUID;
  v_item JSONB;
BEGIN
  IF NOT pode_editar_contratos() OR NOT pode_acessar_obra(p_obra) THEN
    RAISE EXCEPTION 'Sem permissao para criar contrato nesta obra.';
  END IF;
  IF NULLIF(btrim(p_objeto), '') IS NULL THEN RAISE EXCEPTION 'Objeto do contrato obrigatorio.'; END IF;
  IF p_retencao_pct IS NOT NULL AND (p_retencao_pct < 0 OR p_retencao_pct > 100) THEN
    RAISE EXCEPTION 'Retencao deve estar entre 0 e 100.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM empreiteiros WHERE id=p_empreiteiro AND ativo=true) THEN
    RAISE EXCEPTION 'Empreiteiro invalido ou inativo.';
  END IF;
  IF jsonb_typeof(p_itens) <> 'array' OR jsonb_array_length(p_itens)=0 THEN
    RAISE EXCEPTION 'O contrato precisa de ao menos um item.';
  END IF;

  INSERT INTO contratos (obra_id, empreiteiro_id, objeto, condicao_pagamento, retencao_pct)
  VALUES (p_obra, p_empreiteiro, btrim(p_objeto), NULLIF(btrim(p_condicao_pagamento), ''), p_retencao_pct)
  RETURNING id INTO v_contrato_id;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_itens)
  LOOP
    IF COALESCE((v_item->>'quantidade')::NUMERIC,0) <= 0
       OR COALESCE((v_item->>'valor_unitario')::NUMERIC,0) <= 0 THEN
      RAISE EXCEPTION 'Quantidade e valor unitario devem ser positivos.';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM servicos s JOIN etapas e ON e.id=s.etapa_id JOIN unidades u ON u.id=e.unidade_id
      WHERE s.id=(v_item->>'servico_id')::UUID AND s.ativo=true AND u.obra_id=p_obra
    ) OR NOT EXISTS (
      SELECT 1 FROM unidades WHERE id=(v_item->>'unidade_id')::UUID AND obra_id=p_obra AND ativo=true
    ) THEN RAISE EXCEPTION 'Servico ou unidade nao pertence a obra do contrato.'; END IF;

    INSERT INTO contratos_itens (contrato_id, servico_id, unidade_id, quantidade, valor_unitario, valor_total)
    VALUES (v_contrato_id, (v_item->>'servico_id')::UUID, (v_item->>'unidade_id')::UUID,
      (v_item->>'quantidade')::NUMERIC, (v_item->>'valor_unitario')::NUMERIC,
      round((v_item->>'quantidade')::NUMERIC * (v_item->>'valor_unitario')::NUMERIC, 2));
  END LOOP;
  RETURN v_contrato_id;
END;
$$;

CREATE OR REPLACE FUNCTION salvar_itens_contrato(p_contrato UUID, p_itens JSONB)
RETURNS VOID LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE v_obra UUID; v_status status_contrato; v_item JSONB; v_id UUID;
BEGIN
  SELECT obra_id,status INTO v_obra,v_status FROM contratos WHERE id=p_contrato AND ativo=true FOR UPDATE;
  IF NOT FOUND OR v_status <> 'rascunho' THEN RAISE EXCEPTION 'Contrato inexistente ou fora do rascunho.'; END IF;
  IF NOT pode_editar_contratos() OR NOT pode_acessar_obra(v_obra) THEN RAISE EXCEPTION 'Sem permissao para editar este contrato.'; END IF;
  IF jsonb_typeof(p_itens) <> 'array' OR NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_itens) x WHERE NOT COALESCE((x->>'removido')::BOOLEAN,false)
      AND NULLIF(x->>'servico_id','') IS NOT NULL AND NULLIF(x->>'unidade_id','') IS NOT NULL
      AND COALESCE((x->>'quantidade')::NUMERIC,0)>0 AND COALESCE((x->>'valor_unitario')::NUMERIC,0)>0
  ) THEN RAISE EXCEPTION 'O contrato precisa de ao menos um item valido.'; END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_itens) LOOP
    v_id := NULLIF(v_item->>'id','')::UUID;
    IF v_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM contratos_itens WHERE id=v_id AND contrato_id=p_contrato) THEN
      RAISE EXCEPTION 'Item nao pertence ao contrato.';
    END IF;
    IF COALESCE((v_item->>'removido')::BOOLEAN,false) THEN
      IF v_id IS NOT NULL THEN UPDATE contratos_itens SET ativo=false WHERE id=v_id; END IF;
      CONTINUE;
    END IF;
    IF COALESCE((v_item->>'quantidade')::NUMERIC,0)<=0 OR COALESCE((v_item->>'valor_unitario')::NUMERIC,0)<=0 THEN
      RAISE EXCEPTION 'Item de contrato invalido.';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM servicos s JOIN etapas e ON e.id=s.etapa_id JOIN unidades u ON u.id=e.unidade_id
      WHERE s.id=(v_item->>'servico_id')::UUID AND s.ativo=true AND u.obra_id=v_obra
    ) OR NOT EXISTS (
      SELECT 1 FROM unidades WHERE id=(v_item->>'unidade_id')::UUID AND obra_id=v_obra AND ativo=true
    ) THEN RAISE EXCEPTION 'Servico ou unidade nao pertence a obra do contrato.'; END IF;

    IF v_id IS NULL THEN
      INSERT INTO contratos_itens (contrato_id,servico_id,unidade_id,quantidade,valor_unitario,valor_total)
      VALUES (p_contrato,(v_item->>'servico_id')::UUID,(v_item->>'unidade_id')::UUID,
        (v_item->>'quantidade')::NUMERIC,(v_item->>'valor_unitario')::NUMERIC,
        round((v_item->>'quantidade')::NUMERIC*(v_item->>'valor_unitario')::NUMERIC,2));
    ELSE
      UPDATE contratos_itens SET servico_id=(v_item->>'servico_id')::UUID,
        unidade_id=(v_item->>'unidade_id')::UUID, quantidade=(v_item->>'quantidade')::NUMERIC,
        valor_unitario=(v_item->>'valor_unitario')::NUMERIC,
        valor_total=round((v_item->>'quantidade')::NUMERIC*(v_item->>'valor_unitario')::NUMERIC,2), ativo=true
      WHERE id=v_id;
    END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION criar_medicao_com_itens(p_contrato UUID, p_data_referencia DATE, p_itens JSONB)
RETURNS UUID LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE v_medicao_id UUID; v_obra UUID; v_item JSONB;
BEGIN
  SELECT obra_id INTO v_obra FROM contratos WHERE id=p_contrato AND ativo=true AND status='ativo' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Contrato inexistente ou fora do status ativo.'; END IF;
  IF NOT pode_editar_medicoes() OR NOT pode_acessar_obra(v_obra) THEN RAISE EXCEPTION 'Sem permissao para criar medicao neste contrato.'; END IF;
  IF p_data_referencia IS NULL THEN RAISE EXCEPTION 'Data de referencia obrigatoria.'; END IF;
  IF jsonb_typeof(p_itens)<>'array' OR jsonb_array_length(p_itens)=0 THEN RAISE EXCEPTION 'A medicao precisa de itens.'; END IF;

  INSERT INTO medicoes (contrato_id,data_referencia) VALUES (p_contrato,p_data_referencia) RETURNING id INTO v_medicao_id;
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

CREATE OR REPLACE FUNCTION salvar_itens_medicao(p_medicao UUID, p_itens JSONB)
RETURNS VOID LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE v_contrato UUID; v_obra UUID; v_status status_medicao; v_item JSONB; v_id UUID;
BEGIN
  SELECT m.contrato_id,c.obra_id,m.status INTO v_contrato,v_obra,v_status
  FROM medicoes m JOIN contratos c ON c.id=m.contrato_id WHERE m.id=p_medicao AND m.ativo=true FOR UPDATE OF m;
  IF NOT FOUND OR v_status<>'rascunho' THEN RAISE EXCEPTION 'Medicao inexistente ou fora do rascunho.'; END IF;
  IF NOT pode_editar_medicoes() OR NOT pode_acessar_obra(v_obra) THEN RAISE EXCEPTION 'Sem permissao para editar esta medicao.'; END IF;
  IF jsonb_typeof(p_itens)<>'array' OR jsonb_array_length(p_itens)=0 THEN RAISE EXCEPTION 'A medicao precisa de itens.'; END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_itens) LOOP
    v_id := NULLIF(v_item->>'id','')::UUID;
    IF v_id IS NULL OR COALESCE((v_item->>'quantidade_periodo')::NUMERIC,-1)<0 THEN RAISE EXCEPTION 'Item de medicao invalido.'; END IF;
    IF NOT EXISTS (
      SELECT 1 FROM medicoes_itens mi JOIN contratos_itens ci ON ci.id=mi.contrato_item_id
      WHERE mi.id=v_id AND mi.medicao_id=p_medicao AND ci.contrato_id=v_contrato AND mi.ativo=true
    ) THEN RAISE EXCEPTION 'Item nao pertence a medicao.'; END IF;
    UPDATE medicoes_itens SET quantidade_periodo=(v_item->>'quantidade_periodo')::NUMERIC WHERE id=v_id;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION criar_pedido_compra_com_itens(UUID,TEXT,JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION salvar_itens_pedido_compra(UUID,JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION criar_contrato_com_itens(UUID,UUID,TEXT,TEXT,NUMERIC,JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION salvar_itens_contrato(UUID,JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION criar_medicao_com_itens(UUID,DATE,JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION salvar_itens_medicao(UUID,JSONB) FROM PUBLIC;

REVOKE ALL ON FUNCTION criar_pedido_compra_com_itens(UUID,TEXT,JSONB) FROM anon;
REVOKE ALL ON FUNCTION salvar_itens_pedido_compra(UUID,JSONB) FROM anon;
REVOKE ALL ON FUNCTION criar_contrato_com_itens(UUID,UUID,TEXT,TEXT,NUMERIC,JSONB) FROM anon;
REVOKE ALL ON FUNCTION salvar_itens_contrato(UUID,JSONB) FROM anon;
REVOKE ALL ON FUNCTION criar_medicao_com_itens(UUID,DATE,JSONB) FROM anon;
REVOKE ALL ON FUNCTION salvar_itens_medicao(UUID,JSONB) FROM anon;

GRANT EXECUTE ON FUNCTION criar_pedido_compra_com_itens(UUID,TEXT,JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION salvar_itens_pedido_compra(UUID,JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION criar_contrato_com_itens(UUID,UUID,TEXT,TEXT,NUMERIC,JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION salvar_itens_contrato(UUID,JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION criar_medicao_com_itens(UUID,DATE,JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION salvar_itens_medicao(UUID,JSONB) TO authenticated;
