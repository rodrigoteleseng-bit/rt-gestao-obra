-- Fase 3a - Financeiro: livro de lancamentos (contas a pagar + gasto avulso).
-- Ver docs/superpowers/specs/2026-07-21-fase3a-financeiro-livro-design.md

CREATE TYPE status_lancamento_financeiro AS ENUM ('a_pagar', 'pago');

CREATE TABLE lancamentos_financeiros (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  obra_id             UUID NOT NULL REFERENCES obras(id) ON DELETE CASCADE,
  unidade_id          UUID REFERENCES unidades(id),
  etapa_id            UUID REFERENCES etapas(id),
  servico_id          UUID REFERENCES servicos(id),
  descricao           TEXT NOT NULL,
  favorecido          TEXT NOT NULL,
  valor               NUMERIC(14,2) NOT NULL CHECK (valor > 0),

  -- origem: exatamente uma preenchida, ou nenhuma (avulso/historico) - FK tipada
  medicao_item_id     UUID REFERENCES medicoes_itens(id),
  pedido_item_id      UUID REFERENCES pedidos_compra_itens(id),
  CONSTRAINT origem_unica CHECK (
    (CASE WHEN medicao_item_id IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN pedido_item_id  IS NOT NULL THEN 1 ELSE 0 END) <= 1
  ),

  status              status_lancamento_financeiro NOT NULL DEFAULT 'a_pagar',
  data_vencimento     DATE,
  data_pagamento      DATE,
  forma_pagamento     TEXT,
  conta_origem        TEXT,
  observacao          TEXT,

  ativo               BOOLEAN NOT NULL DEFAULT true,
  criado_por          UUID NOT NULL DEFAULT auth.uid() REFERENCES perfis_usuario(id),
  criado_em           TIMESTAMPTZ NOT NULL DEFAULT now(),
  pago_por            UUID REFERENCES perfis_usuario(id),
  pago_em             TIMESTAMPTZ,
  CHECK (status = 'a_pagar' OR (data_pagamento IS NOT NULL AND forma_pagamento IS NOT NULL))
);

CREATE INDEX idx_lancamentos_obra_vencimento
  ON lancamentos_financeiros(obra_id, data_vencimento)
  WHERE ativo AND status = 'a_pagar';

-- ---------- permissao ----------
CREATE OR REPLACE FUNCTION pode_editar_financeiro()
RETURNS boolean LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT meu_papel() = 'admin'
    OR (meu_papel() = 'equipe' AND 'financeiro' = ANY(meus_modulos()))
$$;

-- ---------- RLS ----------
ALTER TABLE lancamentos_financeiros ENABLE ROW LEVEL SECURITY;

CREATE POLICY lf_select ON lancamentos_financeiros FOR SELECT TO authenticated
  USING (ativo = true AND pode_editar_financeiro());

CREATE POLICY lf_insert ON lancamentos_financeiros FOR INSERT TO authenticated
  WITH CHECK (pode_editar_financeiro() AND criado_por = auth.uid());

CREATE POLICY lf_update ON lancamentos_financeiros FOR UPDATE TO authenticated
  USING (pode_editar_financeiro() AND status = 'a_pagar')
  WITH CHECK (pode_editar_financeiro());

CREATE POLICY isolamento_obra ON lancamentos_financeiros AS RESTRICTIVE FOR ALL TO authenticated
  USING (pode_acessar_obra(obra_id))
  WITH CHECK (pode_acessar_obra(obra_id));
