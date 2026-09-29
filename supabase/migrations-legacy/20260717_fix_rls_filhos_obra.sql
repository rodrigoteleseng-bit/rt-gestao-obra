-- Corrige policies filhas que dependiam de subqueries inline para descobrir a obra.
-- Cada helper abaixo é SECURITY DEFINER para evitar que a RLS de leitura da tabela-pai
-- interfira na checagem de isolamento por obra nas tabelas descendentes.

CREATE OR REPLACE FUNCTION pode_acessar_etapa(p_etapa UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM etapas e
    JOIN unidades u ON u.id = e.unidade_id
    WHERE e.id = p_etapa
      AND pode_acessar_obra(u.obra_id)
  )
$$;

CREATE OR REPLACE FUNCTION pode_acessar_servico(p_servico UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM servicos s
    JOIN etapas e ON e.id = s.etapa_id
    JOIN unidades u ON u.id = e.unidade_id
    WHERE s.id = p_servico
      AND pode_acessar_obra(u.obra_id)
  )
$$;

CREATE OR REPLACE FUNCTION pode_acessar_cronograma_tarefa(p_tarefa UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM cronograma_tarefas t
    WHERE t.id = p_tarefa
      AND pode_acessar_obra(t.obra_id)
  )
$$;

CREATE OR REPLACE FUNCTION pode_acessar_fvs(p_fvs UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM fvs f
    WHERE f.id = p_fvs
      AND pode_acessar_obra(f.obra_id)
  )
$$;

CREATE OR REPLACE FUNCTION pode_acessar_fvs_verificacao(p_verificacao UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM fvs_verificacoes v
    JOIN fvs f ON f.id = v.fvs_id
    WHERE v.id = p_verificacao
      AND pode_acessar_obra(f.obra_id)
  )
$$;

CREATE OR REPLACE FUNCTION pode_acessar_pendencia(p_pendencia UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM pendencias p
    WHERE p.id = p_pendencia
      AND pode_acessar_obra(p.obra_id)
  )
$$;

CREATE OR REPLACE FUNCTION pode_acessar_pedido_compra(p_pedido UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM pedidos_compra p
    WHERE p.id = p_pedido
      AND pode_acessar_obra(p.obra_id)
  )
$$;

CREATE OR REPLACE FUNCTION pode_acessar_cotacao(p_cotacao UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM cotacoes c
    JOIN pedidos_compra p ON p.id = c.pedido_id
    WHERE c.id = p_cotacao
      AND pode_acessar_obra(p.obra_id)
  )
$$;

CREATE OR REPLACE FUNCTION pode_acessar_ferramenta(p_ferramenta UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM ferramentas f
    WHERE f.id = p_ferramenta
      AND pode_acessar_obra(f.obra_id)
  )
$$;

CREATE OR REPLACE FUNCTION pode_acessar_efetivo_chamada(p_chamada UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM efetivo_chamadas c
    WHERE c.id = p_chamada
      AND pode_acessar_obra(c.obra_id)
  )
$$;

CREATE OR REPLACE FUNCTION pode_acessar_contrato(p_contrato UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM contratos c
    WHERE c.id = p_contrato
      AND pode_acessar_obra(c.obra_id)
  )
$$;

CREATE OR REPLACE FUNCTION pode_acessar_medicao(p_medicao UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM medicoes m
    JOIN contratos c ON c.id = m.contrato_id
    WHERE m.id = p_medicao
      AND pode_acessar_obra(c.obra_id)
  )
$$;

CREATE OR REPLACE FUNCTION pode_acessar_producao_lancamento(p_lancamento UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM producao_lancamentos l
    WHERE l.id = p_lancamento
      AND pode_acessar_obra(l.obra_id)
  )
$$;

CREATE OR REPLACE FUNCTION pode_acessar_producao_medicao(p_medicao UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM producao_medicoes m
    WHERE m.id = p_medicao
      AND pode_acessar_obra(m.obra_id)
  )
$$;

REVOKE ALL ON FUNCTION pode_acessar_etapa(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION pode_acessar_servico(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION pode_acessar_cronograma_tarefa(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION pode_acessar_fvs(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION pode_acessar_fvs_verificacao(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION pode_acessar_pendencia(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION pode_acessar_pedido_compra(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION pode_acessar_cotacao(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION pode_acessar_ferramenta(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION pode_acessar_efetivo_chamada(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION pode_acessar_contrato(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION pode_acessar_medicao(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION pode_acessar_producao_lancamento(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION pode_acessar_producao_medicao(UUID) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION pode_acessar_etapa(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION pode_acessar_servico(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION pode_acessar_cronograma_tarefa(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION pode_acessar_fvs(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION pode_acessar_fvs_verificacao(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION pode_acessar_pendencia(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION pode_acessar_pedido_compra(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION pode_acessar_cotacao(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION pode_acessar_ferramenta(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION pode_acessar_efetivo_chamada(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION pode_acessar_contrato(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION pode_acessar_medicao(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION pode_acessar_producao_lancamento(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION pode_acessar_producao_medicao(UUID) TO authenticated;

DROP POLICY IF EXISTS isolamento_obra ON etapas;
CREATE POLICY isolamento_obra ON etapas AS RESTRICTIVE FOR ALL TO authenticated
  USING (pode_acessar_etapa(id))
  WITH CHECK (pode_acessar_etapa(id));

DROP POLICY IF EXISTS isolamento_obra ON servicos;
CREATE POLICY isolamento_obra ON servicos AS RESTRICTIVE FOR ALL TO authenticated
  USING (pode_acessar_servico(id))
  WITH CHECK (pode_acessar_servico(id));

DROP POLICY IF EXISTS isolamento_obra ON cronograma_previsto;
CREATE POLICY isolamento_obra ON cronograma_previsto AS RESTRICTIVE FOR ALL TO authenticated
  USING (pode_acessar_cronograma_tarefa(tarefa_id))
  WITH CHECK (pode_acessar_cronograma_tarefa(tarefa_id));

DROP POLICY IF EXISTS isolamento_obra ON cronograma_dependencias;
CREATE POLICY isolamento_obra ON cronograma_dependencias AS RESTRICTIVE FOR ALL TO authenticated
  USING (pode_acessar_cronograma_tarefa(tarefa_id))
  WITH CHECK (pode_acessar_cronograma_tarefa(tarefa_id));

DROP POLICY IF EXISTS isolamento_obra ON avancos_fisicos;
CREATE POLICY isolamento_obra ON avancos_fisicos AS RESTRICTIVE FOR ALL TO authenticated
  USING (pode_acessar_cronograma_tarefa(tarefa_id))
  WITH CHECK (pode_acessar_cronograma_tarefa(tarefa_id));

DROP POLICY IF EXISTS isolamento_obra ON fvs_verificacoes;
CREATE POLICY isolamento_obra ON fvs_verificacoes AS RESTRICTIVE FOR ALL TO authenticated
  USING (pode_acessar_fvs(fvs_id))
  WITH CHECK (pode_acessar_fvs(fvs_id));

DROP POLICY IF EXISTS isolamento_obra ON fvs_respostas;
CREATE POLICY isolamento_obra ON fvs_respostas AS RESTRICTIVE FOR ALL TO authenticated
  USING (pode_acessar_fvs_verificacao(verificacao_id))
  WITH CHECK (pode_acessar_fvs_verificacao(verificacao_id));

DROP POLICY IF EXISTS isolamento_obra ON fvs_fotos;
CREATE POLICY isolamento_obra ON fvs_fotos AS RESTRICTIVE FOR ALL TO authenticated
  USING (pode_acessar_fvs(fvs_id))
  WITH CHECK (pode_acessar_fvs(fvs_id));

DROP POLICY IF EXISTS isolamento_obra ON pendencia_eventos;
CREATE POLICY isolamento_obra ON pendencia_eventos AS RESTRICTIVE FOR ALL TO authenticated
  USING (pode_acessar_pendencia(pendencia_id))
  WITH CHECK (pode_acessar_pendencia(pendencia_id));

DROP POLICY IF EXISTS isolamento_obra ON pendencia_fotos;
CREATE POLICY isolamento_obra ON pendencia_fotos AS RESTRICTIVE FOR ALL TO authenticated
  USING (pode_acessar_pendencia(pendencia_id))
  WITH CHECK (pode_acessar_pendencia(pendencia_id));

DROP POLICY IF EXISTS isolamento_obra ON pedidos_compra_itens;
CREATE POLICY isolamento_obra ON pedidos_compra_itens AS RESTRICTIVE FOR ALL TO authenticated
  USING (pode_acessar_pedido_compra(pedido_id))
  WITH CHECK (pode_acessar_pedido_compra(pedido_id));

DROP POLICY IF EXISTS isolamento_obra ON cotacoes;
CREATE POLICY isolamento_obra ON cotacoes AS RESTRICTIVE FOR ALL TO authenticated
  USING (pode_acessar_pedido_compra(pedido_id))
  WITH CHECK (pode_acessar_pedido_compra(pedido_id));

DROP POLICY IF EXISTS isolamento_obra ON cotacoes_itens;
CREATE POLICY isolamento_obra ON cotacoes_itens AS RESTRICTIVE FOR ALL TO authenticated
  USING (pode_acessar_cotacao(cotacao_id))
  WITH CHECK (pode_acessar_cotacao(cotacao_id));

DROP POLICY IF EXISTS isolamento_obra ON recebimentos_nf;
CREATE POLICY isolamento_obra ON recebimentos_nf AS RESTRICTIVE FOR ALL TO authenticated
  USING (pode_acessar_pedido_compra(pedido_id))
  WITH CHECK (pode_acessar_pedido_compra(pedido_id));

DROP POLICY IF EXISTS isolamento_obra ON ferramenta_emprestimos;
CREATE POLICY isolamento_obra ON ferramenta_emprestimos AS RESTRICTIVE FOR ALL TO authenticated
  USING (pode_acessar_ferramenta(ferramenta_id))
  WITH CHECK (pode_acessar_ferramenta(ferramenta_id));

DROP POLICY IF EXISTS isolamento_obra ON efetivo_presencas;
CREATE POLICY isolamento_obra ON efetivo_presencas AS RESTRICTIVE FOR ALL TO authenticated
  USING (pode_acessar_efetivo_chamada(chamada_id))
  WITH CHECK (pode_acessar_efetivo_chamada(chamada_id));

DROP POLICY IF EXISTS isolamento_obra ON contratos_itens;
CREATE POLICY isolamento_obra ON contratos_itens AS RESTRICTIVE FOR ALL TO authenticated
  USING (pode_acessar_contrato(contrato_id))
  WITH CHECK (pode_acessar_contrato(contrato_id));

DROP POLICY IF EXISTS isolamento_obra ON medicoes_seq;
CREATE POLICY isolamento_obra ON medicoes_seq AS RESTRICTIVE FOR ALL TO authenticated
  USING (pode_acessar_contrato(contrato_id))
  WITH CHECK (pode_acessar_contrato(contrato_id));

DROP POLICY IF EXISTS isolamento_obra ON medicoes;
CREATE POLICY isolamento_obra ON medicoes AS RESTRICTIVE FOR ALL TO authenticated
  USING (pode_acessar_contrato(contrato_id))
  WITH CHECK (pode_acessar_contrato(contrato_id));

DROP POLICY IF EXISTS isolamento_obra ON medicoes_itens;
CREATE POLICY isolamento_obra ON medicoes_itens AS RESTRICTIVE FOR ALL TO authenticated
  USING (pode_acessar_medicao(medicao_id))
  WITH CHECK (pode_acessar_medicao(medicao_id));

DROP POLICY IF EXISTS isolamento_obra ON producao_aberturas;
CREATE POLICY isolamento_obra ON producao_aberturas AS RESTRICTIVE FOR ALL TO authenticated
  USING (pode_acessar_producao_lancamento(lancamento_id))
  WITH CHECK (pode_acessar_producao_lancamento(lancamento_id));

DROP POLICY IF EXISTS isolamento_obra ON producao_participantes;
CREATE POLICY isolamento_obra ON producao_participantes AS RESTRICTIVE FOR ALL TO authenticated
  USING (pode_acessar_producao_lancamento(lancamento_id))
  WITH CHECK (pode_acessar_producao_lancamento(lancamento_id));

DROP POLICY IF EXISTS isolamento_obra ON producao_medicao_lancamentos;
CREATE POLICY isolamento_obra ON producao_medicao_lancamentos AS RESTRICTIVE FOR ALL TO authenticated
  USING (pode_acessar_producao_medicao(medicao_id))
  WITH CHECK (pode_acessar_producao_medicao(medicao_id));

DROP POLICY IF EXISTS isolamento_obra ON producao_medicao_dias;
CREATE POLICY isolamento_obra ON producao_medicao_dias AS RESTRICTIVE FOR ALL TO authenticated
  USING (pode_acessar_producao_medicao(medicao_id))
  WITH CHECK (pode_acessar_producao_medicao(medicao_id));

DROP POLICY IF EXISTS isolamento_obra_storage ON storage.objects;
CREATE POLICY isolamento_obra_storage ON storage.objects AS RESTRICTIVE FOR ALL TO authenticated
USING (
  bucket_id NOT IN ('rdo','fvs','pendencias','cotacoes-nf')
  OR CASE
    WHEN bucket_id IN ('rdo','fvs','pendencias') THEN
      split_part(name,'/',1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      AND pode_acessar_obra(split_part(name,'/',1)::UUID)
    WHEN bucket_id = 'cotacoes-nf' THEN
      split_part(name,'/',1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      AND pode_acessar_pedido_compra(split_part(name,'/',1)::UUID)
    ELSE false
  END
)
WITH CHECK (
  bucket_id NOT IN ('rdo','fvs','pendencias','cotacoes-nf')
  OR CASE
    WHEN bucket_id IN ('rdo','fvs','pendencias') THEN
      split_part(name,'/',1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      AND pode_acessar_obra(split_part(name,'/',1)::UUID)
    WHEN bucket_id = 'cotacoes-nf' THEN
      split_part(name,'/',1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      AND pode_acessar_pedido_compra(split_part(name,'/',1)::UUID)
    ELSE false
  END
);
