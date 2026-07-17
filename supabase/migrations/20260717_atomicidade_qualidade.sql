-- Atomicidade dos fluxos de criação de FVS e de Pendências.
-- Todas as funções são SECURITY INVOKER: as policies RLS existentes continuam valendo.

CREATE OR REPLACE FUNCTION criar_fvs_com_verificacao(
  p_obra UUID,
  p_modelo UUID,
  p_unidade UUID,
  p_tarefa UUID DEFAULT NULL,
  p_local_ambiente TEXT DEFAULT NULL,
  p_equipe_empreiteiro TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_fvs_id UUID;
BEGIN
  IF NOT pode_editar_fvs() THEN
    RAISE EXCEPTION 'Sem permissão para criar FVS';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM unidades WHERE id = p_unidade AND obra_id = p_obra) THEN
    RAISE EXCEPTION 'A unidade não pertence à obra informada';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM fvs_modelos WHERE id = p_modelo AND ativo = true) THEN
    RAISE EXCEPTION 'Modelo de FVS inválido ou inativo';
  END IF;

  IF p_tarefa IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM cronograma_tarefas
    WHERE id = p_tarefa AND unidade_id = p_unidade AND ativo = true
  ) THEN
    RAISE EXCEPTION 'A tarefa não pertence à unidade informada';
  END IF;

  INSERT INTO fvs (obra_id, modelo_id, unidade_id, tarefa_id, local_ambiente, equipe_empreiteiro)
  VALUES (p_obra, p_modelo, p_unidade, p_tarefa, NULLIF(BTRIM(p_local_ambiente), ''), NULLIF(BTRIM(p_equipe_empreiteiro), ''))
  RETURNING id INTO v_fvs_id;

  INSERT INTO fvs_verificacoes (fvs_id, numero)
  VALUES (v_fvs_id, 1);

  RETURN v_fvs_id;
END;
$$;

CREATE OR REPLACE FUNCTION criar_pendencia_com_evento(
  p_obra UUID,
  p_unidade UUID,
  p_tarefa UUID DEFAULT NULL,
  p_descricao TEXT DEFAULT NULL,
  p_responsavel TEXT DEFAULT NULL,
  p_prazo DATE DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_pendencia_id UUID;
BEGIN
  IF NOT pode_editar_pendencias() THEN
    RAISE EXCEPTION 'Sem permissão para criar pendência';
  END IF;

  IF NULLIF(BTRIM(p_descricao), '') IS NULL THEN
    RAISE EXCEPTION 'A descrição é obrigatória';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM unidades WHERE id = p_unidade AND obra_id = p_obra) THEN
    RAISE EXCEPTION 'A unidade não pertence à obra informada';
  END IF;

  IF p_tarefa IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM cronograma_tarefas
    WHERE id = p_tarefa AND unidade_id = p_unidade AND ativo = true
  ) THEN
    RAISE EXCEPTION 'A tarefa não pertence à unidade informada';
  END IF;

  INSERT INTO pendencias (obra_id, unidade_id, tarefa_id, descricao, responsavel, prazo)
  VALUES (p_obra, p_unidade, p_tarefa, BTRIM(p_descricao), NULLIF(BTRIM(p_responsavel), ''), p_prazo)
  RETURNING id INTO v_pendencia_id;

  INSERT INTO pendencia_eventos (pendencia_id, status, comentario)
  VALUES (v_pendencia_id, 'aberta', NULL);

  RETURN v_pendencia_id;
END;
$$;

CREATE OR REPLACE FUNCTION atualizar_status_pendencia_com_evento(
  p_pendencia UUID,
  p_status status_pendencia,
  p_comentario TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_atual pendencias%ROWTYPE;
BEGIN
  SELECT * INTO v_atual
  FROM pendencias
  WHERE id = p_pendencia AND ativo = true
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pendência não encontrada ou sem acesso';
  END IF;

  IF NOT pode_editar_pendencias() THEN
    RAISE EXCEPTION 'Sem permissão para alterar pendência';
  END IF;

  IF NOT (
    (v_atual.status = 'aberta' AND p_status IN ('em_correcao', 'resolvida'))
    OR (v_atual.status = 'em_correcao' AND p_status = 'resolvida')
    OR (v_atual.status = 'resolvida' AND p_status = 'aberta' AND meu_papel() = 'admin')
  ) THEN
    RAISE EXCEPTION 'Transição de status inválida: % → %', v_atual.status, p_status;
  END IF;

  UPDATE pendencias
  SET status = p_status,
      resolvida_em = CASE WHEN p_status = 'resolvida' THEN now() ELSE NULL END,
      resolvida_por = CASE WHEN p_status = 'resolvida' THEN auth.uid() ELSE NULL END
  WHERE id = p_pendencia;

  INSERT INTO pendencia_eventos (pendencia_id, status, comentario)
  VALUES (p_pendencia, p_status, NULLIF(BTRIM(p_comentario), ''));

  RETURN p_pendencia;
END;
$$;

REVOKE ALL ON FUNCTION criar_fvs_com_verificacao(UUID, UUID, UUID, UUID, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION criar_pendencia_com_evento(UUID, UUID, UUID, TEXT, TEXT, DATE) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION atualizar_status_pendencia_com_evento(UUID, status_pendencia, TEXT) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION criar_fvs_com_verificacao(UUID, UUID, UUID, UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION criar_pendencia_com_evento(UUID, UUID, UUID, TEXT, TEXT, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION atualizar_status_pendencia_com_evento(UUID, status_pendencia, TEXT) TO authenticated;
