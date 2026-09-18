BEGIN;

-- ATENDIMENTO DE PEDIDOS: materiais, servicos e locacoes.
-- Decisao Rodrigo (18/09/2026): almoxarife e encarregado recebem uma
-- permissao operacional separada, sem acesso a cotacoes, valores ou aprovacao.

ALTER TYPE modulo_app ADD VALUE IF NOT EXISTS 'atendimento_pedidos';

CREATE TYPE natureza_item_pedido AS ENUM ('material', 'servico', 'locacao');

ALTER TABLE pedidos_compra_itens
  ADD COLUMN natureza natureza_item_pedido NOT NULL DEFAULT 'material',
  ADD COLUMN quantidade_executada NUMERIC(14,4) NOT NULL DEFAULT 0;

-- Pedidos ja existentes permanecem como material para nao mudar seu fluxo.
CREATE TABLE pedido_item_execucoes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_item_id UUID NOT NULL REFERENCES pedidos_compra_itens(id) ON DELETE RESTRICT,
  data_execucao DATE NOT NULL,
  quantidade NUMERIC(14,4) NOT NULL CHECK (quantidade > 0),
  observacao TEXT,
  ativo BOOLEAN NOT NULL DEFAULT true,
  cancelado_por UUID REFERENCES perfis_usuario(id),
  cancelado_em TIMESTAMPTZ,
  motivo_cancelamento TEXT,
  criado_por UUID NOT NULL DEFAULT auth.uid() REFERENCES perfis_usuario(id),
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    (ativo AND cancelado_por IS NULL AND cancelado_em IS NULL AND motivo_cancelamento IS NULL)
    OR (NOT ativo AND cancelado_por IS NOT NULL AND cancelado_em IS NOT NULL AND btrim(motivo_cancelamento) <> '')
  )
);

CREATE INDEX idx_pedido_item_execucoes_item ON pedido_item_execucoes(pedido_item_id) WHERE ativo;

-- A locacao continua sendo operada na aba Alugueis; este vinculo e apenas a
-- rastreabilidade da contratacao e ao recalculo do atendimento do pedido.
ALTER TABLE ferramenta_locacoes
  ADD COLUMN pedido_item_id UUID REFERENCES pedidos_compra_itens(id) ON DELETE RESTRICT;
CREATE INDEX idx_ferramenta_locacoes_pedido_item ON ferramenta_locacoes(pedido_item_id) WHERE ativo;

CREATE OR REPLACE FUNCTION pode_atender_pedidos()
RETURNS boolean LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT meu_papel() = 'admin'
    OR (meu_papel() = 'equipe' AND 'atendimento_pedidos' = ANY(meus_modulos()::text[]))
$$;

-- Um atendimento so pode ser registrado num servico de pedido operacional e
-- nunca pode ultrapassar a quantidade contratada.
CREATE OR REPLACE FUNCTION validar_execucao_item_pedido()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_natureza natureza_item_pedido;
  v_pedida NUMERIC(14,4);
  v_ja_executada NUMERIC(14,4);
  v_obra UUID;
  v_status status_pedido_compra;
BEGIN
  SELECT i.natureza, i.quantidade_pedida, p.obra_id, p.status
    INTO v_natureza, v_pedida, v_obra, v_status
  FROM pedidos_compra_itens i
  JOIN pedidos_compra p ON p.id = i.pedido_id
  WHERE i.id = NEW.pedido_item_id AND i.ativo AND p.ativo
  FOR UPDATE OF i;

  IF NOT FOUND OR v_natureza <> 'servico' THEN
    RAISE EXCEPTION 'Execucao so pode ser registrada para item de servico ativo.';
  END IF;
  IF NOT pode_atender_pedidos() OR NOT pode_acessar_obra(v_obra) THEN
    RAISE EXCEPTION 'Sem permissao para registrar atendimento neste pedido.';
  END IF;
  IF v_status NOT IN ('enviado', 'recebido_parcial', 'recebido_total') THEN
    RAISE EXCEPTION 'Este pedido nao esta aberto para atendimento.';
  END IF;

  SELECT COALESCE(SUM(quantidade), 0) INTO v_ja_executada
  FROM pedido_item_execucoes
  WHERE pedido_item_id = NEW.pedido_item_id AND ativo;

  IF v_ja_executada + NEW.quantidade > v_pedida THEN
    RAISE EXCEPTION 'A quantidade executada (%) ultrapassa o saldo pendente (%).',
      NEW.quantidade, v_pedida - v_ja_executada;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validar_execucao_item_pedido
  BEFORE INSERT ON pedido_item_execucoes
  FOR EACH ROW EXECUTE FUNCTION validar_execucao_item_pedido();

-- Execucao e imutavel. Um erro pode apenas ser cancelado por quem registrou
-- ou pelo admin, com motivo obrigatorio; o historico nunca e sobrescrito.
CREATE OR REPLACE FUNCTION proteger_execucao_item_pedido()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.ativo IS NOT TRUE OR NEW.ativo IS NOT FALSE
     OR NEW.pedido_item_id IS DISTINCT FROM OLD.pedido_item_id
     OR NEW.data_execucao IS DISTINCT FROM OLD.data_execucao
     OR NEW.quantidade IS DISTINCT FROM OLD.quantidade
     OR NEW.observacao IS DISTINCT FROM OLD.observacao
     OR NEW.criado_por IS DISTINCT FROM OLD.criado_por
     OR NEW.criado_em IS DISTINCT FROM OLD.criado_em
     OR NEW.cancelado_por IS DISTINCT FROM auth.uid()
     OR NEW.cancelado_em IS NULL
     OR NULLIF(btrim(NEW.motivo_cancelamento), '') IS NULL THEN
    RAISE EXCEPTION 'Execucao nao pode ser alterada; cancele-a com motivo.';
  END IF;
  IF NOT (OLD.criado_por = auth.uid() OR meu_papel() = 'admin') THEN
    RAISE EXCEPTION 'Somente o autor ou admin pode cancelar esta execucao.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_proteger_execucao_item_pedido
  BEFORE UPDATE ON pedido_item_execucoes
  FOR EACH ROW EXECUTE FUNCTION proteger_execucao_item_pedido();

CREATE OR REPLACE FUNCTION sincronizar_execucao_item_pedido()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_item UUID;
BEGIN
  v_item := COALESCE(NEW.pedido_item_id, OLD.pedido_item_id);
  UPDATE pedidos_compra_itens i
  SET quantidade_executada = COALESCE((
    SELECT SUM(e.quantidade) FROM pedido_item_execucoes e
    WHERE e.pedido_item_id = v_item AND e.ativo
  ), 0)
  WHERE i.id = v_item;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_sincronizar_execucao_item_pedido
  AFTER INSERT OR UPDATE OF ativo ON pedido_item_execucoes
  FOR EACH ROW EXECUTE FUNCTION sincronizar_execucao_item_pedido();

-- Uma locacao so pode ser vinculada ao item de locacao da mesma obra.
CREATE OR REPLACE FUNCTION validar_vinculo_locacao_pedido()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_obra UUID; v_natureza natureza_item_pedido; v_status status_pedido_compra;
BEGIN
  IF NEW.pedido_item_id IS NULL THEN RETURN NEW; END IF;
  SELECT p.obra_id, i.natureza, p.status INTO v_obra, v_natureza, v_status
  FROM pedidos_compra_itens i JOIN pedidos_compra p ON p.id=i.pedido_id
  WHERE i.id=NEW.pedido_item_id AND i.ativo AND p.ativo;
  IF NOT FOUND OR v_obra <> NEW.obra_id OR v_natureza <> 'locacao' THEN
    RAISE EXCEPTION 'A locacao deve apontar para item de locacao ativo da mesma obra.';
  END IF;
  IF v_status NOT IN ('enviado', 'recebido_parcial', 'recebido_total') THEN
    RAISE EXCEPTION 'Este pedido nao esta aberto para atendimento.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validar_vinculo_locacao_pedido
  BEFORE INSERT OR UPDATE OF pedido_item_id, obra_id ON ferramenta_locacoes
  FOR EACH ROW EXECUTE FUNCTION validar_vinculo_locacao_pedido();

CREATE OR REPLACE FUNCTION sincronizar_locacao_item_pedido()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_item UUID;
BEGIN
  v_item := COALESCE(NEW.pedido_item_id, OLD.pedido_item_id);
  IF v_item IS NULL THEN RETURN NEW; END IF;
  UPDATE pedidos_compra_itens i
  SET quantidade_executada = COALESCE((
    SELECT SUM(l.quantidade) FROM ferramenta_locacoes l
    WHERE l.pedido_item_id = v_item AND l.ativo AND l.data_entregue IS NOT NULL
  ), 0)
  WHERE i.id = v_item;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_sincronizar_locacao_item_pedido
  AFTER INSERT OR UPDATE OF data_entregue, quantidade, ativo, pedido_item_id ON ferramenta_locacoes
  FOR EACH ROW EXECUTE FUNCTION sincronizar_locacao_item_pedido();

-- Status comercial existente, agora calculado por recebimento para material
-- e por execucao/encerramento para servico e locacao.
CREATE OR REPLACE FUNCTION recalcular_status_pedido() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_status status_pedido_compra;
  v_total_itens INTEGER;
  v_itens_completos INTEGER;
  v_itens_iniciados INTEGER;
BEGIN
  SELECT status INTO v_status FROM pedidos_compra WHERE id = NEW.pedido_id;
  IF v_status NOT IN ('enviado', 'recebido_parcial', 'recebido_total') THEN RETURN NEW; END IF;
  SELECT count(*),
         count(*) FILTER (WHERE CASE WHEN natureza='material' THEN quantidade_recebida ELSE quantidade_executada END >= quantidade_pedida),
         count(*) FILTER (WHERE CASE WHEN natureza='material' THEN quantidade_recebida ELSE quantidade_executada END > 0)
    INTO v_total_itens, v_itens_completos, v_itens_iniciados
  FROM pedidos_compra_itens WHERE pedido_id=NEW.pedido_id AND ativo;
  IF v_itens_completos = v_total_itens THEN
    UPDATE pedidos_compra SET status='recebido_total' WHERE id=NEW.pedido_id;
  ELSIF v_itens_iniciados > 0 THEN
    UPDATE pedidos_compra SET status='recebido_parcial' WHERE id=NEW.pedido_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_recalcular_status_pedido ON pedidos_compra_itens;
CREATE TRIGGER trg_recalcular_status_pedido
  AFTER UPDATE OF quantidade_recebida, quantidade_executada ON pedidos_compra_itens
  FOR EACH ROW EXECUTE FUNCTION recalcular_status_pedido();

ALTER TABLE pedido_item_execucoes ENABLE ROW LEVEL SECURITY;

CREATE POLICY pie_select ON pedido_item_execucoes FOR SELECT TO authenticated
  USING ((ativo = true OR pode_atender_pedidos()) AND EXISTS (
    SELECT 1 FROM pedidos_compra_itens i JOIN pedidos_compra p ON p.id=i.pedido_id
    WHERE i.id=pedido_item_id AND pode_atender_pedidos() AND pode_acessar_obra(p.obra_id)
  ));
CREATE POLICY pie_insert ON pedido_item_execucoes FOR INSERT TO authenticated
  WITH CHECK (pode_atender_pedidos() AND criado_por=auth.uid());
CREATE POLICY pie_update ON pedido_item_execucoes FOR UPDATE TO authenticated
  USING (pode_atender_pedidos() AND (criado_por=auth.uid() OR meu_papel()='admin'))
  WITH CHECK (pode_atender_pedidos());

-- Atendimento le apenas cabecalho e itens, nunca cotacoes, valores ou NF.
DROP POLICY IF EXISTS pc_select ON pedidos_compra;
CREATE POLICY pc_select ON pedidos_compra FOR SELECT TO authenticated
  USING ((ativo = true OR pode_editar_compras()) AND (pode_editar_compras() OR pode_atender_pedidos()));
DROP POLICY IF EXISTS pci_select ON pedidos_compra_itens;
CREATE POLICY pci_select ON pedidos_compra_itens FOR SELECT TO authenticated
  USING ((ativo = true OR pode_editar_compras()) AND (pode_editar_compras() OR pode_atender_pedidos()));
DROP POLICY IF EXISTS cot_select ON cotacoes;
CREATE POLICY cot_select ON cotacoes FOR SELECT TO authenticated USING (pode_editar_compras());
DROP POLICY IF EXISTS coti_select ON cotacoes_itens;
CREATE POLICY coti_select ON cotacoes_itens FOR SELECT TO authenticated USING (pode_editar_compras());
DROP POLICY IF EXISTS rnf_select ON recebimentos_nf;
CREATE POLICY rnf_select ON recebimentos_nf FOR SELECT TO authenticated USING (pode_editar_compras());

DROP POLICY IF EXISTS floc_select ON ferramenta_locacoes;
CREATE POLICY floc_select ON ferramenta_locacoes FOR SELECT TO authenticated
  USING ((ativo = true OR pode_editar_almoxarifado() OR pode_atender_pedidos())
    AND (pode_editar_almoxarifado() OR pode_atender_pedidos()));
DROP POLICY IF EXISTS floc_insert ON ferramenta_locacoes;
CREATE POLICY floc_insert ON ferramenta_locacoes FOR INSERT TO authenticated
  WITH CHECK ((pode_editar_almoxarifado() OR pode_atender_pedidos()) AND criado_por=auth.uid());
DROP POLICY IF EXISTS flocdev_select ON ferramenta_locacoes_devolucoes;
CREATE POLICY flocdev_select ON ferramenta_locacoes_devolucoes FOR SELECT TO authenticated
  USING (pode_editar_almoxarifado() OR pode_atender_pedidos());
DROP POLICY IF EXISTS flocdev_insert ON ferramenta_locacoes_devolucoes;
CREATE POLICY flocdev_insert ON ferramenta_locacoes_devolucoes FOR INSERT TO authenticated
  WITH CHECK ((pode_editar_almoxarifado() OR pode_atender_pedidos()) AND devolvido_por=auth.uid());

-- Mantem as RPCs atomicas de criacao/edicao de pedido, agora com natureza
-- obrigatoria no formulario e default material para compatibilidade externa.
CREATE OR REPLACE FUNCTION criar_pedido_compra_com_itens(p_obra UUID, p_descricao TEXT, p_itens JSONB)
RETURNS UUID LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE v_pedido_id UUID; v_item JSONB; v_servico UUID; v_natureza natureza_item_pedido;
BEGIN
  IF NOT pode_editar_compras() OR NOT pode_acessar_obra(p_obra) THEN RAISE EXCEPTION 'Sem permissao para criar pedido nesta obra.'; END IF;
  IF jsonb_typeof(p_itens) <> 'array' OR jsonb_array_length(p_itens)=0 THEN RAISE EXCEPTION 'O pedido precisa de ao menos um item.'; END IF;
  INSERT INTO pedidos_compra (obra_id, descricao) VALUES (p_obra, NULLIF(btrim(p_descricao), '')) RETURNING id INTO v_pedido_id;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_itens) LOOP
    v_servico := NULLIF(v_item->>'servico_id','')::UUID;
    v_natureza := COALESCE(NULLIF(v_item->>'natureza','')::natureza_item_pedido, 'material');
    IF NULLIF(btrim(v_item->>'descricao_item'),'') IS NULL OR COALESCE((v_item->>'quantidade_pedida')::NUMERIC,0)<=0 THEN
      RAISE EXCEPTION 'Item de pedido invalido: descricao e quantidade positiva sao obrigatorias.';
    END IF;
    IF v_servico IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM servicos s JOIN etapas e ON e.id=s.etapa_id JOIN unidades u ON u.id=e.unidade_id
      WHERE s.id=v_servico AND s.ativo AND u.obra_id=p_obra
    ) THEN RAISE EXCEPTION 'O servico informado nao pertence a obra do pedido.'; END IF;
    INSERT INTO pedidos_compra_itens (pedido_id,servico_id,descricao_item,quantidade_pedida,und,data_necessaria,urgente,natureza)
    VALUES (v_pedido_id,v_servico,btrim(v_item->>'descricao_item'),(v_item->>'quantidade_pedida')::NUMERIC,
      NULLIF(btrim(v_item->>'und'),''),NULLIF(v_item->>'data_necessaria','')::DATE,
      COALESCE((v_item->>'urgente')::BOOLEAN,false),v_natureza);
  END LOOP;
  RETURN v_pedido_id;
END;
$$;

CREATE OR REPLACE FUNCTION salvar_itens_pedido_compra(p_pedido UUID, p_itens JSONB)
RETURNS VOID LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE v_obra UUID; v_status status_pedido_compra; v_item JSONB; v_id UUID; v_servico UUID; v_natureza natureza_item_pedido;
BEGIN
  SELECT obra_id,status INTO v_obra,v_status FROM pedidos_compra WHERE id=p_pedido AND ativo=true FOR UPDATE;
  IF NOT FOUND OR v_status <> 'rascunho' THEN RAISE EXCEPTION 'Pedido inexistente ou fora do rascunho.'; END IF;
  IF NOT pode_editar_compras() OR NOT pode_acessar_obra(v_obra) THEN RAISE EXCEPTION 'Sem permissao para editar este pedido.'; END IF;
  IF jsonb_typeof(p_itens) <> 'array' OR NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_itens) x WHERE NOT COALESCE((x->>'removido')::BOOLEAN,false)
      AND NULLIF(btrim(x->>'descricao_item'),'') IS NOT NULL AND COALESCE((x->>'quantidade_pedida')::NUMERIC,0)>0
  ) THEN RAISE EXCEPTION 'O pedido precisa de ao menos um item valido.'; END IF;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_itens) LOOP
    v_id := NULLIF(v_item->>'id','')::UUID;
    IF v_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM pedidos_compra_itens WHERE id=v_id AND pedido_id=p_pedido) THEN RAISE EXCEPTION 'Item nao pertence ao pedido.'; END IF;
    IF COALESCE((v_item->>'removido')::BOOLEAN,false) THEN
      IF v_id IS NOT NULL THEN UPDATE pedidos_compra_itens SET ativo=false WHERE id=v_id; END IF;
      CONTINUE;
    END IF;
    v_servico := NULLIF(v_item->>'servico_id','')::UUID;
    v_natureza := COALESCE(NULLIF(v_item->>'natureza','')::natureza_item_pedido,'material');
    IF NULLIF(btrim(v_item->>'descricao_item'),'') IS NULL OR COALESCE((v_item->>'quantidade_pedida')::NUMERIC,0)<=0 THEN RAISE EXCEPTION 'Item de pedido invalido.'; END IF;
    IF v_servico IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM servicos s JOIN etapas e ON e.id=s.etapa_id JOIN unidades u ON u.id=e.unidade_id
      WHERE s.id=v_servico AND s.ativo AND u.obra_id=v_obra
    ) THEN RAISE EXCEPTION 'O servico informado nao pertence a obra do pedido.'; END IF;
    IF v_id IS NULL THEN
      INSERT INTO pedidos_compra_itens (pedido_id,servico_id,descricao_item,quantidade_pedida,und,data_necessaria,urgente,natureza)
      VALUES (p_pedido,v_servico,btrim(v_item->>'descricao_item'),(v_item->>'quantidade_pedida')::NUMERIC,
        NULLIF(btrim(v_item->>'und'),''),NULLIF(v_item->>'data_necessaria','')::DATE,
        COALESCE((v_item->>'urgente')::BOOLEAN,false),v_natureza);
    ELSE
      UPDATE pedidos_compra_itens SET servico_id=v_servico,descricao_item=btrim(v_item->>'descricao_item'),
        quantidade_pedida=(v_item->>'quantidade_pedida')::NUMERIC,und=NULLIF(btrim(v_item->>'und'),''),
        data_necessaria=NULLIF(v_item->>'data_necessaria','')::DATE,urgente=COALESCE((v_item->>'urgente')::BOOLEAN,false),
        natureza=v_natureza,ativo=true WHERE id=v_id;
    END IF;
  END LOOP;
END;
$$;

COMMIT;
