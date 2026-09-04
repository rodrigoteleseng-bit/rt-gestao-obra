-- Curva S financeira: agrega lancamentos_financeiros pagos por data/etapa/servico,
-- sem expor fornecedor/NF/descricao, para uso pela Curva S financeira e pelo
-- previsto x realizado x saldo por etapa (visivel tambem ao papel cliente, que
-- nao tem acesso a lancamentos_financeiros diretamente).
-- Ver docs/superpowers/specs/2026-09-04-fase3-curva-s-financeira-design.md secao 8.

CREATE OR REPLACE FUNCTION financeiro_realizado_agregado(p_obra_id UUID)
RETURNS TABLE (data_pagamento DATE, etapa_id UUID, servico_id UUID, valor NUMERIC)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT lf.data_pagamento, lf.etapa_id, lf.servico_id, SUM(lf.valor) AS valor
  FROM lancamentos_financeiros lf
  WHERE lf.obra_id = p_obra_id
    AND lf.ativo = true
    AND lf.status = 'pago'
    AND pode_acessar_obra(p_obra_id)
  GROUP BY lf.data_pagamento, lf.etapa_id, lf.servico_id
$$;

GRANT EXECUTE ON FUNCTION financeiro_realizado_agregado(UUID) TO authenticated;
