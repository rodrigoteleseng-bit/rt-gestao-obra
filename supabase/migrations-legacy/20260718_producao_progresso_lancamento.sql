-- ============================================================
-- PRODUCAO PROPRIA - PROGRESSO POR PAREDE E CANCELAMENTO | RT Engenharia
-- ============================================================
-- Saldo de producao por (parede x sobrado x servico/face) e novo
-- caminho de lancamento por parede cadastrada na planta clicavel.
-- O caminho antigo fica preservado apenas para leitura do historico.

CREATE TABLE producao_paredes_progresso (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parede_id     UUID NOT NULL REFERENCES producao_paredes(id),
  unidade_id    UUID NOT NULL REFERENCES unidades(id),
  servico       tipo_servico_producao NOT NULL,
  face          TEXT CHECK (face IN ('a', 'b') OR face IS NULL),
  produzido_m2  NUMERIC(10,4) NOT NULL DEFAULT 0 CHECK (produzido_m2 >= 0),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT prod_paredes_progresso_unico UNIQUE NULLS NOT DISTINCT (parede_id, unidade_id, servico, face)
);

ALTER TABLE producao_lancamentos
  ALTER COLUMN comprimento DROP NOT NULL,
  ALTER COLUMN altura DROP NOT NULL,
  ADD COLUMN parede_id UUID REFERENCES producao_paredes(id),
  ADD COLUMN face TEXT CHECK (face IN ('a', 'b') OR face IS NULL),
  ADD COLUMN cancelado_em TIMESTAMPTZ,
  ADD COLUMN cancelado_por UUID REFERENCES perfis_usuario(id),
  ADD COLUMN motivo_cancelamento TEXT,
  ADD CONSTRAINT parede_ou_legado CHECK (
    (parede_id IS NOT NULL AND comprimento IS NULL AND altura IS NULL)
    OR (parede_id IS NULL AND comprimento IS NOT NULL AND altura IS NOT NULL)
  );

CREATE OR REPLACE FUNCTION producao_inicializar_lancamento() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM unidades u WHERE u.id = NEW.unidade_id AND u.obra_id = NEW.obra_id) THEN
    RAISE EXCEPTION 'Unidade não pertence à obra.';
  END IF;

  IF NEW.parede_id IS NOT NULL THEN
    IF NEW.area_liquida IS NULL OR NEW.area_liquida <= 0 THEN
      RAISE EXCEPTION 'A área produzida deve ser positiva.';
    END IF;
    NEW.area_bruta := NEW.area_liquida;
    NEW.area_aberturas := 0;
  ELSE
    NEW.area_bruta := ROUND(NEW.comprimento * NEW.altura, 4);
    NEW.area_liquida := NEW.area_bruta;
  END IF;

  NEW.valor_total := ROUND(NEW.area_liquida * NEW.preco_m2, 2);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION producao_preparar_lancamento() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM producao_medicao_lancamentos ml
    JOIN producao_participantes p ON p.id = ml.participante_id
    WHERE p.lancamento_id = OLD.id
  ) THEN
    RAISE EXCEPTION 'Produção já incluída em medição não pode ser alterada.';
  END IF;

  IF NEW.cancelado_em IS NOT NULL AND OLD.cancelado_em IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.parede_id IS NOT NULL THEN
    IF NEW.area_liquida IS NULL OR NEW.area_liquida <= 0 THEN
      RAISE EXCEPTION 'A área líquida deve ser positiva.';
    END IF;
    NEW.area_bruta := NEW.area_liquida;
    NEW.area_aberturas := 0;
  ELSE
    NEW.area_bruta := ROUND(NEW.comprimento * NEW.altura, 4);
    NEW.area_liquida := ROUND(NEW.area_bruta - OLD.area_aberturas, 4);
    IF NEW.area_liquida <= 0 THEN
      RAISE EXCEPTION 'A área líquida deve ser positiva.';
    END IF;
  END IF;

  NEW.valor_total := ROUND(NEW.area_liquida * NEW.preco_m2, 2);
  NEW.editado_por := auth.uid();
  NEW.editado_em := now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION producao_recalcular(p_lancamento UUID) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_bruta NUMERIC(14,4);
  v_aberturas NUMERIC(14,4);
  v_liquida NUMERIC(14,4);
  v_preco NUMERIC(14,2);
  v_valor NUMERIC(14,2);
  v_parede UUID;
  v_n INTEGER;
  v_i INTEGER := 0;
  v_distribuido NUMERIC(14,2) := 0;
  v_part RECORD;
  v_parte NUMERIC(14,2);
BEGIN
  SELECT parede_id, area_liquida, preco_m2
    INTO v_parede, v_liquida, v_preco
  FROM producao_lancamentos
  WHERE id = p_lancamento
  FOR UPDATE;

  IF v_parede IS NULL THEN
    SELECT ROUND(comprimento * altura, 4)
      INTO v_bruta
    FROM producao_lancamentos
    WHERE id = p_lancamento;

    SELECT COALESCE(SUM(area), 0)
      INTO v_aberturas
    FROM producao_aberturas
    WHERE lancamento_id = p_lancamento AND ativo;

    v_liquida := ROUND(v_bruta - v_aberturas, 4);
    IF v_liquida <= 0 THEN
      RAISE EXCEPTION 'A área das aberturas deve ser menor que a área bruta.';
    END IF;

    v_valor := ROUND(v_liquida * v_preco, 2);
    UPDATE producao_lancamentos
    SET area_bruta = v_bruta,
        area_aberturas = v_aberturas,
        area_liquida = v_liquida,
        valor_total = v_valor
    WHERE id = p_lancamento;
  ELSE
    v_valor := ROUND(v_liquida * v_preco, 2);
    UPDATE producao_lancamentos
    SET valor_total = v_valor
    WHERE id = p_lancamento;
  END IF;

  SELECT COUNT(*)
    INTO v_n
  FROM producao_participantes
  WHERE lancamento_id = p_lancamento AND ativo;

  IF v_n = 0 THEN
    RETURN;
  END IF;

  FOR v_part IN
    SELECT id
    FROM producao_participantes
    WHERE lancamento_id = p_lancamento AND ativo
    ORDER BY trabalhador_id
  LOOP
    v_i := v_i + 1;
    v_parte := CASE WHEN v_i = v_n THEN v_valor - v_distribuido ELSE ROUND(v_valor / v_n, 2) END;
    UPDATE producao_participantes
    SET fracao = 1.0 / v_n,
        area_atribuida = ROUND(v_liquida / v_n, 4),
        valor_atribuido = v_parte
    WHERE id = v_part.id;
    v_distribuido := v_distribuido + v_parte;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION producao_registrar_producao_parede(
  p_obra UUID,
  p_unidade UUID,
  p_data DATE,
  p_parede UUID,
  p_face TEXT,
  p_area_m2 NUMERIC,
  p_preco NUMERIC,
  p_observacao TEXT,
  p_trabalhadores UUID[]
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_servico tipo_servico_producao;
  v_meta NUMERIC(10,4);
  v_progresso producao_paredes_progresso%ROWTYPE;
  v_lancamento_id UUID;
  v_trabalhador UUID;
BEGIN
  IF NOT pode_editar_medicoes() OR NOT pode_acessar_obra(p_obra) THEN
    RAISE EXCEPTION 'Sem permissão para lançar produção nesta obra.';
  END IF;
  IF p_face IS NOT NULL AND p_face NOT IN ('a', 'b') THEN
    RAISE EXCEPTION 'Face inválida.';
  END IF;
  IF p_area_m2 IS NULL OR p_area_m2 <= 0 THEN
    RAISE EXCEPTION 'Informe a área produzida.';
  END IF;
  IF p_preco IS NULL OR p_preco <= 0 THEN
    RAISE EXCEPTION 'Informe o preço por m².';
  END IF;
  IF p_trabalhadores IS NULL OR cardinality(p_trabalhadores) = 0 THEN
    RAISE EXCEPTION 'Selecione ao menos um profissional.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM unidades u WHERE u.id = p_unidade AND u.obra_id = p_obra) THEN
    RAISE EXCEPTION 'Unidade não pertence à obra.';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM producao_paredes pp
    JOIN producao_plantas pl ON pl.id = pp.planta_id
    WHERE pp.id = p_parede
      AND pp.ativo
      AND pl.ativo
      AND pl.obra_id = p_obra
  ) THEN
    RAISE EXCEPTION 'Parede não encontrada para esta obra.';
  END IF;
  IF NOT pode_acessar_parede(p_parede) THEN
    RAISE EXCEPTION 'Parede não encontrada.';
  END IF;

  IF p_face IS NULL THEN
    v_servico := 'alvenaria';
    SELECT meta_alvenaria_m2 INTO v_meta FROM producao_paredes WHERE id = p_parede;
  ELSE
    v_servico := 'reboco';
    SELECT CASE p_face WHEN 'a' THEN meta_reboco_a_m2 ELSE meta_reboco_b_m2 END
      INTO v_meta
    FROM producao_paredes
    WHERE id = p_parede;
  END IF;

  IF v_meta IS NULL THEN
    RAISE EXCEPTION 'Esta parede não tem meta cadastrada para o serviço/face escolhido.';
  END IF;

  INSERT INTO producao_paredes_progresso (parede_id, unidade_id, servico, face)
  VALUES (p_parede, p_unidade, v_servico, p_face)
  ON CONFLICT (parede_id, unidade_id, servico, face) DO NOTHING;

  SELECT *
    INTO v_progresso
  FROM producao_paredes_progresso
  WHERE parede_id = p_parede
    AND unidade_id = p_unidade
    AND servico = v_servico
    AND face IS NOT DISTINCT FROM p_face
  FOR UPDATE;

  IF v_progresso.produzido_m2 + p_area_m2 > v_meta THEN
    RAISE EXCEPTION 'Área ultrapassa o saldo restante da parede (faltam % m²).',
      ROUND(v_meta - v_progresso.produzido_m2, 2);
  END IF;

  INSERT INTO producao_lancamentos (
    obra_id,
    unidade_id,
    data_producao,
    servico,
    parede_nome,
    parede_id,
    face,
    area_liquida,
    preco_m2,
    observacao
  )
  SELECT p_obra,
         p_unidade,
         p_data,
         v_servico,
         pp.nome,
         p_parede,
         p_face,
         p_area_m2,
         p_preco,
         NULLIF(btrim(p_observacao), '')
  FROM producao_paredes pp
  WHERE pp.id = p_parede
  RETURNING id INTO v_lancamento_id;

  FOREACH v_trabalhador IN ARRAY p_trabalhadores LOOP
    IF NOT EXISTS (SELECT 1 FROM trabalhadores WHERE id = v_trabalhador AND obra_id = p_obra AND ativo) THEN
      RAISE EXCEPTION 'Profissional inválido para a obra.';
    END IF;
    INSERT INTO producao_participantes (lancamento_id, trabalhador_id)
    VALUES (v_lancamento_id, v_trabalhador);
  END LOOP;

  UPDATE producao_paredes_progresso
  SET produzido_m2 = produzido_m2 + p_area_m2,
      atualizado_em = now()
  WHERE id = v_progresso.id;

  RETURN v_lancamento_id;
END;
$$;

CREATE OR REPLACE FUNCTION producao_cancelar_lancamento(p_lancamento UUID, p_motivo TEXT)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_lanc producao_lancamentos%ROWTYPE;
BEGIN
  SELECT *
    INTO v_lanc
  FROM producao_lancamentos
  WHERE id = p_lancamento AND ativo
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lançamento não encontrado.';
  END IF;
  IF NOT pode_editar_medicoes() OR NOT pode_acessar_obra(v_lanc.obra_id) THEN
    RAISE EXCEPTION 'Sem permissão para cancelar este lançamento.';
  END IF;
  IF v_lanc.cancelado_em IS NOT NULL THEN
    RAISE EXCEPTION 'Lançamento já está cancelado.';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM producao_medicao_lancamentos ml
    JOIN producao_participantes p ON p.id = ml.participante_id
    WHERE p.lancamento_id = p_lancamento
  ) THEN
    RAISE EXCEPTION 'Produção já incluída em medição não pode ser cancelada.';
  END IF;
  IF NULLIF(btrim(p_motivo), '') IS NULL THEN
    RAISE EXCEPTION 'Informe o motivo do cancelamento.';
  END IF;

  UPDATE producao_lancamentos
  SET cancelado_em = now(),
      cancelado_por = auth.uid(),
      motivo_cancelamento = btrim(p_motivo)
  WHERE id = p_lancamento;

  IF v_lanc.parede_id IS NOT NULL THEN
    UPDATE producao_paredes_progresso
    SET produzido_m2 = GREATEST(0, produzido_m2 - v_lanc.area_liquida),
        atualizado_em = now()
    WHERE parede_id = v_lanc.parede_id
      AND unidade_id = v_lanc.unidade_id
      AND servico = v_lanc.servico
      AND face IS NOT DISTINCT FROM v_lanc.face;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION producao_editar_meta_parede(
  p_parede UUID,
  p_meta_alvenaria NUMERIC,
  p_meta_reboco_a NUMERIC,
  p_meta_reboco_b NUMERIC
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_produzido_alv NUMERIC;
  v_produzido_a NUMERIC;
  v_produzido_b NUMERIC;
BEGIN
  IF NOT pode_acessar_parede(p_parede) OR NOT pode_editar_medicoes() THEN
    RAISE EXCEPTION 'Sem permissão para editar esta parede.';
  END IF;
  IF p_meta_alvenaria IS NULL AND p_meta_reboco_a IS NULL AND p_meta_reboco_b IS NULL THEN
    RAISE EXCEPTION 'Informe ao menos uma meta.';
  END IF;

  SELECT COALESCE(MAX(produzido_m2) FILTER (WHERE servico = 'alvenaria'), 0),
         COALESCE(MAX(produzido_m2) FILTER (WHERE servico = 'reboco' AND face = 'a'), 0),
         COALESCE(MAX(produzido_m2) FILTER (WHERE servico = 'reboco' AND face = 'b'), 0)
    INTO v_produzido_alv, v_produzido_a, v_produzido_b
  FROM producao_paredes_progresso
  WHERE parede_id = p_parede;

  IF p_meta_alvenaria IS NOT NULL AND p_meta_alvenaria < v_produzido_alv THEN
    RAISE EXCEPTION 'Já foram produzidos % m² de alvenaria; a meta não pode ficar menor que isso.',
      ROUND(v_produzido_alv, 2);
  END IF;
  IF p_meta_reboco_a IS NOT NULL AND p_meta_reboco_a < v_produzido_a THEN
    RAISE EXCEPTION 'Já foram produzidos % m² de reboco (face A); a meta não pode ficar menor que isso.',
      ROUND(v_produzido_a, 2);
  END IF;
  IF p_meta_reboco_b IS NOT NULL AND p_meta_reboco_b < v_produzido_b THEN
    RAISE EXCEPTION 'Já foram produzidos % m² de reboco (face B); a meta não pode ficar menor que isso.',
      ROUND(v_produzido_b, 2);
  END IF;

  UPDATE producao_paredes
  SET meta_alvenaria_m2 = p_meta_alvenaria,
      meta_reboco_a_m2 = p_meta_reboco_a,
      meta_reboco_b_m2 = p_meta_reboco_b
  WHERE id = p_parede;
END;
$$;

REVOKE ALL ON FUNCTION producao_registrar_producao_parede(UUID,UUID,DATE,UUID,TEXT,NUMERIC,NUMERIC,TEXT,UUID[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION producao_cancelar_lancamento(UUID,TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION producao_editar_meta_parede(UUID,NUMERIC,NUMERIC,NUMERIC) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION producao_registrar_producao_parede(UUID,UUID,DATE,UUID,TEXT,NUMERIC,NUMERIC,TEXT,UUID[]) TO authenticated;
GRANT EXECUTE ON FUNCTION producao_cancelar_lancamento(UUID,TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION producao_editar_meta_parede(UUID,NUMERIC,NUMERIC,NUMERIC) TO authenticated;

ALTER TABLE producao_paredes_progresso ENABLE ROW LEVEL SECURITY;
CREATE POLICY prod_progresso_select ON producao_paredes_progresso FOR SELECT
  USING (pode_editar_medicoes());
CREATE POLICY isolamento_obra ON producao_paredes_progresso AS RESTRICTIVE FOR ALL TO authenticated
  USING (pode_acessar_parede(parede_id)) WITH CHECK (pode_acessar_parede(parede_id));
