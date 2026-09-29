-- Trigger: passa a permitir aprovada -> cancelada com motivo obrigatorio.
-- Qualquer outra alteracao numa medicao aprovada ou cancelada continua
-- bloqueada, sem excecao para admin.
CREATE OR REPLACE FUNCTION restringir_status_medicao() RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status = 'aprovada' AND NEW.status = 'cancelada' THEN
    IF NEW.motivo_cancelamento IS NULL OR btrim(NEW.motivo_cancelamento) = '' THEN
      RAISE EXCEPTION 'Motivo do cancelamento e obrigatorio.';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status = 'aprovada' THEN
    RAISE EXCEPTION 'Medicao aprovada nao pode ser alterada.';
  END IF;
  IF OLD.status = 'cancelada' THEN
    RAISE EXCEPTION 'Medicao cancelada nao pode ser alterada.';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND meu_papel() <> 'admin' THEN
    RAISE EXCEPTION 'Somente o admin pode aprovar uma medicao.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- RPC: cancela uma medicao aprovada e reverte o Financeiro na mesma
-- transacao. O saldo do contrato-item volta sozinho, porque
-- validar_saldo_medicao() so soma medicoes com status = 'aprovada'.
CREATE OR REPLACE FUNCTION medicoes_cancelar_medicao(p_medicao_id UUID, p_motivo TEXT)
RETURNS medicoes
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_medicao medicoes;
BEGIN
  IF meu_papel() <> 'admin' THEN
    RAISE EXCEPTION 'Somente o admin pode cancelar uma medicao.';
  END IF;
  IF p_motivo IS NULL OR btrim(p_motivo) = '' THEN
    RAISE EXCEPTION 'Motivo do cancelamento e obrigatorio.';
  END IF;

  UPDATE medicoes
  SET status = 'cancelada',
      motivo_cancelamento = p_motivo,
      cancelada_por = auth.uid(),
      cancelada_em = now()
  WHERE id = p_medicao_id AND status = 'aprovada'
  RETURNING * INTO v_medicao;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Medicao nao encontrada ou nao esta aprovada.';
  END IF;

  UPDATE lancamentos_financeiros
  SET ativo = false
  WHERE ativo = true
    AND medicao_item_id IN (
      SELECT id FROM medicoes_itens WHERE medicao_id = p_medicao_id
    );

  RETURN v_medicao;
END;
$$;

-- Mesmo padrao de producao_cancelar_medicao (20260716_fase7_producao_propria.sql:432,434):
-- a checagem de admin e feita dentro da funcao, mas o EXECUTE em si
-- so e concedido a authenticated, nunca a PUBLIC.
REVOKE ALL ON FUNCTION medicoes_cancelar_medicao(UUID,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION medicoes_cancelar_medicao(UUID,TEXT) TO authenticated;
