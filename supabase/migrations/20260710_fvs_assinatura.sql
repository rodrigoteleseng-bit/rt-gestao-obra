-- ============================================================
-- FVS — assinatura na conclusão da verificação | RT Engenharia
-- ============================================================
-- Quem conclui uma rodada de verificação assina digitalmente (canvas),
-- com nome + GPS + data/hora, mesma validade jurídica do RDO.
-- A assinatura é gravada pela RPC concluir_verificacao_fvs.
-- Decisão do Rodrigo em 10/07/2026.

ALTER TABLE fvs_verificacoes
  ADD COLUMN assinatura_imagem     TEXT,
  ADD COLUMN assinado_por_nome     TEXT,
  ADD COLUMN assinatura_lat        NUMERIC(10,7),
  ADD COLUMN assinatura_lng        NUMERIC(10,7),
  ADD COLUMN assinatura_precisao_m NUMERIC(8,1);

-- Remove a versão anterior (3 args) — a nova tem parâmetros de assinatura,
-- então é outra sobrecarga; sem o DROP, chamadas ficariam ambíguas.
DROP FUNCTION IF EXISTS concluir_verificacao_fvs(uuid, status_fvs, text);

-- Recria a RPC com os parâmetros de assinatura (obrigatória para concluir).
CREATE OR REPLACE FUNCTION concluir_verificacao_fvs(
  p_verificacao UUID,
  p_resultado   status_fvs,
  p_observacao  TEXT DEFAULT NULL,
  p_assinatura  TEXT DEFAULT NULL,
  p_assinante   TEXT DEFAULT NULL,
  p_lat         NUMERIC DEFAULT NULL,
  p_lng         NUMERIC DEFAULT NULL,
  p_precisao    NUMERIC DEFAULT NULL
) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_verif   fvs_verificacoes%ROWTYPE;
  v_fvs     fvs%ROWTYPE;
  v_modelo  fvs_modelos%ROWTYPE;
  v_nc      RECORD;
  v_pend_id UUID;
  v_qtd     integer := 0;
BEGIN
  IF NOT pode_editar_fvs() THEN
    RAISE EXCEPTION 'Sem permissão para concluir verificação de FVS';
  END IF;
  IF p_resultado NOT IN ('aprovada', 'aprovada_restricao', 'reprovada') THEN
    RAISE EXCEPTION 'Resultado inválido';
  END IF;
  IF p_assinatura IS NULL OR p_assinante IS NULL OR btrim(p_assinante) = '' THEN
    RAISE EXCEPTION 'Assinatura e nome do responsável são obrigatórios';
  END IF;

  SELECT * INTO v_verif FROM fvs_verificacoes WHERE id = p_verificacao FOR UPDATE;
  IF NOT FOUND OR v_verif.resultado IS NOT NULL THEN
    RAISE EXCEPTION 'Verificação inexistente ou já concluída';
  END IF;

  SELECT * INTO v_fvs FROM fvs WHERE id = v_verif.fvs_id;
  IF v_fvs.status = 'aprovada' OR v_fvs.ativo = false THEN
    RAISE EXCEPTION 'FVS aprovada ou inativa não pode ser alterada';
  END IF;

  IF p_resultado = 'aprovada' AND EXISTS (
    SELECT 1 FROM fvs_respostas WHERE verificacao_id = p_verificacao AND resposta = 'nc'
  ) THEN
    RAISE EXCEPTION 'Há itens não conformes: use Reprovada ou Aprovada com restrição';
  END IF;

  SELECT * INTO v_modelo FROM fvs_modelos WHERE id = v_fvs.modelo_id;

  UPDATE fvs_verificacoes
  SET resultado = p_resultado, observacao = p_observacao,
      concluida_em = now(), concluida_por = auth.uid(),
      assinatura_imagem = p_assinatura, assinado_por_nome = btrim(p_assinante),
      assinatura_lat = p_lat, assinatura_lng = p_lng, assinatura_precisao_m = p_precisao
  WHERE id = p_verificacao;

  UPDATE fvs SET status = p_resultado WHERE id = v_fvs.id;

  FOR v_nc IN
    SELECT r.observacao AS obs, i.texto
    FROM fvs_respostas r
    JOIN fvs_modelo_itens i ON i.id = r.item_id
    WHERE r.verificacao_id = p_verificacao AND r.resposta = 'nc'
    ORDER BY i.secao, i.ordem
  LOOP
    INSERT INTO pendencias (obra_id, unidade_id, tarefa_id, descricao, fvs_id, criado_por)
    VALUES (
      v_fvs.obra_id, v_fvs.unidade_id, v_fvs.tarefa_id,
      v_modelo.codigo || ' ' || v_modelo.nome || ' — item não conforme: ' || v_nc.texto
        || COALESCE(' (' || v_nc.obs || ')', ''),
      v_fvs.id, auth.uid()
    ) RETURNING id INTO v_pend_id;

    INSERT INTO pendencia_eventos (pendencia_id, status, comentario, criado_por)
    VALUES (v_pend_id, 'aberta', 'Gerada automaticamente pela ' || v_modelo.codigo
      || ' (verificação nº ' || v_verif.numero || ')', auth.uid());

    v_qtd := v_qtd + 1;
  END LOOP;

  RETURN v_qtd;
END;
$$;
