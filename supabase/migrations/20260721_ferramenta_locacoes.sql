-- Controle de aluguel de ferramentas no Almoxarifado.

CREATE TYPE modalidade_locacao_ferramenta AS ENUM ('diaria', 'semanal', 'mensal');

CREATE TABLE ferramenta_locacoes (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  obra_id               UUID NOT NULL REFERENCES obras(id) ON DELETE CASCADE,
  nome_ferramenta       TEXT NOT NULL,
  locadora              TEXT NOT NULL,
  modalidade            modalidade_locacao_ferramenta NOT NULL,
  data_chegada          DATE NOT NULL,
  data_entrega_prevista DATE NOT NULL,
  data_entregue         DATE,
  observacao            TEXT,
  ativo                 BOOLEAN NOT NULL DEFAULT true,
  criado_por            UUID NOT NULL DEFAULT auth.uid() REFERENCES perfis_usuario(id),
  criado_em             TIMESTAMPTZ NOT NULL DEFAULT now(),
  entregue_por          UUID REFERENCES perfis_usuario(id),
  entregue_em           TIMESTAMPTZ,
  CHECK (data_entrega_prevista >= data_chegada),
  CHECK (data_entregue IS NULL OR data_entregue >= data_chegada)
);

CREATE INDEX idx_ferramenta_locacoes_obra_vencimento
  ON ferramenta_locacoes(obra_id, data_entrega_prevista)
  WHERE ativo;

ALTER TABLE ferramenta_locacoes ENABLE ROW LEVEL SECURITY;

CREATE POLICY floc_select ON ferramenta_locacoes FOR SELECT TO authenticated
  USING ((ativo = true OR pode_editar_almoxarifado()) AND pode_editar_almoxarifado());

CREATE POLICY floc_insert ON ferramenta_locacoes FOR INSERT TO authenticated
  WITH CHECK (pode_editar_almoxarifado() AND criado_por = auth.uid());

CREATE POLICY floc_update ON ferramenta_locacoes FOR UPDATE TO authenticated
  USING (pode_editar_almoxarifado())
  WITH CHECK (pode_editar_almoxarifado());

CREATE POLICY isolamento_obra ON ferramenta_locacoes AS RESTRICTIVE FOR ALL TO authenticated
  USING (pode_acessar_obra(obra_id))
  WITH CHECK (pode_acessar_obra(obra_id));
