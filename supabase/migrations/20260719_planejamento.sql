-- ============================================================
-- FASE 7 - PLANEJAMENTO (lookahead + PPC) | RT Engenharia
-- ============================================================
-- Modulo novo em cima do Cronograma (Fase 2) existente, por referencia
-- viva (nunca copia data/nome da tarefa). Restricoes travam uma tarefa
-- de entrar no compromisso semanal ate serem resolvidas. Fechar a
-- semana calcula o PPC a partir do Avanco Fisico ja lancado e vira
-- historico imutavel. Visao trimestral nao tem tabela propria -- e
-- uma agregacao de etapas/cronograma_previsto/avancos_fisicos, so
-- leitura, resolvida no frontend. Cliente nao ve o modulo.

ALTER TYPE modulo_app ADD VALUE IF NOT EXISTS 'planejamento';

CREATE TYPE categoria_restricao AS ENUM (
  'material', 'mao_de_obra', 'projeto_documentacao', 'decisao_pendente',
  'equipamento', 'financeiro', 'servico_predecessor', 'clima'
);
CREATE TYPE status_restricao AS ENUM ('aberta', 'resolvida');
CREATE TYPE status_semana_planejamento AS ENUM ('aberta', 'fechada');

CREATE TABLE restricoes (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  obra_id        UUID NOT NULL REFERENCES obras(id) ON DELETE CASCADE,
  tarefa_id      UUID NOT NULL REFERENCES cronograma_tarefas(id),
  categoria      categoria_restricao NOT NULL,
  responsavel_id UUID REFERENCES perfis_usuario(id),
  prazo          DATE NOT NULL,
  status         status_restricao NOT NULL DEFAULT 'aberta',
  observacao     TEXT,
  resolvida_por  UUID REFERENCES perfis_usuario(id),
  resolvida_em   TIMESTAMPTZ,
  ativo          BOOLEAN NOT NULL DEFAULT true,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now(),
  criado_por     UUID NOT NULL DEFAULT auth.uid() REFERENCES perfis_usuario(id),
  CONSTRAINT restricoes_resolucao_auditoria_chk
    CHECK (status <> 'resolvida' OR (resolvida_por IS NOT NULL AND resolvida_em IS NOT NULL))
);

CREATE TABLE planejamento_semanas (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  obra_id      UUID NOT NULL REFERENCES obras(id) ON DELETE CASCADE,
  data_inicio  DATE NOT NULL,
  data_fim     DATE NOT NULL,
  status       status_semana_planejamento NOT NULL DEFAULT 'aberta',
  ppc          NUMERIC(5,2),
  fechada_por  UUID REFERENCES perfis_usuario(id),
  fechada_em   TIMESTAMPTZ,
  ativo        BOOLEAN NOT NULL DEFAULT true,
  criado_em    TIMESTAMPTZ NOT NULL DEFAULT now(),
  criado_por   UUID NOT NULL DEFAULT auth.uid() REFERENCES perfis_usuario(id),
  CONSTRAINT planejamento_semanas_datas_validas CHECK (data_fim > data_inicio),
  CONSTRAINT planejamento_semanas_fechamento_auditoria_chk
    CHECK (status <> 'fechada' OR (fechada_por IS NOT NULL AND fechada_em IS NOT NULL AND ppc IS NOT NULL))
);

CREATE UNIQUE INDEX idx_planejamento_semanas_unica
  ON planejamento_semanas(obra_id, data_inicio) WHERE ativo;

CREATE TABLE planejamento_compromissos (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  semana_id          UUID NOT NULL REFERENCES planejamento_semanas(id) ON DELETE CASCADE,
  tarefa_id          UUID NOT NULL REFERENCES cronograma_tarefas(id),
  percentual_inicio  NUMERIC(5,2) NOT NULL,
  meta_percentual    NUMERIC(5,2) NOT NULL,
  percentual_fim     NUMERIC(5,2),
  cumprido           BOOLEAN,
  motivo_categoria   categoria_restricao,
  motivo_observacao  TEXT,
  ativo              BOOLEAN NOT NULL DEFAULT true,
  criado_em          TIMESTAMPTZ NOT NULL DEFAULT now(),
  criado_por         UUID NOT NULL DEFAULT auth.uid() REFERENCES perfis_usuario(id),
  CONSTRAINT planejamento_compromissos_meta_valida
    CHECK (meta_percentual > percentual_inicio AND meta_percentual <= 100)
);

CREATE UNIQUE INDEX idx_planejamento_compromissos_unico
  ON planejamento_compromissos(semana_id, tarefa_id) WHERE ativo;

CREATE INDEX idx_restricoes_obra_status ON restricoes(obra_id, status) WHERE ativo;
CREATE INDEX idx_restricoes_tarefa ON restricoes(tarefa_id) WHERE ativo;
CREATE INDEX idx_planejamento_semanas_obra ON planejamento_semanas(obra_id) WHERE ativo;
CREATE INDEX idx_planejamento_compromissos_semana ON planejamento_compromissos(semana_id) WHERE ativo;
CREATE INDEX idx_planejamento_compromissos_tarefa ON planejamento_compromissos(tarefa_id) WHERE ativo;

ALTER TABLE restricoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE planejamento_semanas ENABLE ROW LEVEL SECURITY;
ALTER TABLE planejamento_compromissos ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION pode_editar_planejamento()
RETURNS boolean
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT meu_papel() = 'admin'
    OR (meu_papel() = 'equipe' AND 'planejamento' = ANY(meus_modulos()::text[]))
$$;

CREATE OR REPLACE FUNCTION bloquear_tarefa_com_restricao_aberta()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM restricoes r
    WHERE r.tarefa_id = NEW.tarefa_id AND r.ativo AND r.status = 'aberta'
  ) THEN
    RAISE EXCEPTION 'Esta tarefa tem restricao aberta e nao pode entrar no compromisso da semana.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION travar_compromisso_fechado()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status status_semana_planejamento;
BEGIN
  SELECT status INTO v_status FROM planejamento_semanas WHERE id = OLD.semana_id;
  IF v_status = 'fechada' THEN
    RAISE EXCEPTION 'Semana fechada: compromisso nao pode mais ser alterado.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_bloquear_tarefa_com_restricao_aberta
  BEFORE INSERT ON planejamento_compromissos
  FOR EACH ROW EXECUTE FUNCTION bloquear_tarefa_com_restricao_aberta();

CREATE TRIGGER trg_travar_compromisso_fechado
  BEFORE UPDATE ON planejamento_compromissos
  FOR EACH ROW EXECUTE FUNCTION travar_compromisso_fechado();

CREATE OR REPLACE FUNCTION calcular_fechamento_semana(p_semana UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_obra UUID;
  v_status status_semana_planejamento;
  v_data_fim DATE;
BEGIN
  IF meu_papel() <> 'admin' THEN
    RAISE EXCEPTION 'Somente o admin pode calcular o fechamento da semana.';
  END IF;

  SELECT obra_id, status, data_fim INTO v_obra, v_status, v_data_fim
  FROM planejamento_semanas WHERE id = p_semana AND ativo;
  IF v_obra IS NULL THEN
    RAISE EXCEPTION 'Semana nao encontrada.';
  END IF;
  IF NOT pode_acessar_obra(v_obra) THEN
    RAISE EXCEPTION 'Sem acesso a obra desta semana.';
  END IF;
  IF v_status <> 'aberta' THEN
    RAISE EXCEPTION 'Semana ja fechada.';
  END IF;

  UPDATE planejamento_compromissos pc
  SET percentual_fim = sub.percentual,
      cumprido = sub.percentual >= pc.meta_percentual
  FROM (
    SELECT pc2.id, COALESCE((
      SELECT af.percentual FROM avancos_fisicos af
      WHERE af.tarefa_id = pc2.tarefa_id AND af.ativo AND af.data_referencia <= v_data_fim
      ORDER BY af.data_referencia DESC LIMIT 1
    ), 0) AS percentual
    FROM planejamento_compromissos pc2
    WHERE pc2.semana_id = p_semana AND pc2.ativo
  ) sub
  WHERE pc.id = sub.id;
END;
$$;

CREATE OR REPLACE FUNCTION fechar_semana_planejamento(p_semana UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_obra UUID;
  v_status status_semana_planejamento;
  v_sem_calcular INT;
  v_total INT;
  v_pendentes INT;
  v_cumpridos INT;
BEGIN
  IF meu_papel() <> 'admin' THEN
    RAISE EXCEPTION 'Somente o admin pode fechar a semana.';
  END IF;

  SELECT obra_id, status INTO v_obra, v_status
  FROM planejamento_semanas WHERE id = p_semana AND ativo;
  IF v_obra IS NULL THEN
    RAISE EXCEPTION 'Semana nao encontrada.';
  END IF;
  IF NOT pode_acessar_obra(v_obra) THEN
    RAISE EXCEPTION 'Sem acesso a obra desta semana.';
  END IF;
  IF v_status <> 'aberta' THEN
    RAISE EXCEPTION 'Semana ja fechada.';
  END IF;

  SELECT count(*) FILTER (WHERE percentual_fim IS NULL), count(*)
    INTO v_sem_calcular, v_total
  FROM planejamento_compromissos WHERE semana_id = p_semana AND ativo;

  IF v_total = 0 THEN
    RAISE EXCEPTION 'Semana sem nenhum compromisso ativo.';
  END IF;
  IF v_sem_calcular > 0 THEN
    RAISE EXCEPTION 'Rode calcular o fechamento antes de fechar a semana.';
  END IF;

  SELECT count(*) INTO v_pendentes
  FROM planejamento_compromissos
  WHERE semana_id = p_semana AND ativo AND cumprido = false AND motivo_categoria IS NULL;

  IF v_pendentes > 0 THEN
    RAISE EXCEPTION '% compromisso(s) nao cumprido(s) sem motivo preenchido.', v_pendentes;
  END IF;

  SELECT count(*) FILTER (WHERE cumprido) INTO v_cumpridos
  FROM planejamento_compromissos WHERE semana_id = p_semana AND ativo;

  UPDATE planejamento_semanas
  SET status = 'fechada', ppc = round(100.0 * v_cumpridos / v_total, 2),
      fechada_por = auth.uid(), fechada_em = now()
  WHERE id = p_semana;
END;
$$;

CREATE POLICY isolamento_obra ON restricoes AS RESTRICTIVE FOR ALL TO authenticated
  USING (pode_acessar_obra(obra_id))
  WITH CHECK (pode_acessar_obra(obra_id));

CREATE POLICY isolamento_obra ON planejamento_semanas AS RESTRICTIVE FOR ALL TO authenticated
  USING (pode_acessar_obra(obra_id))
  WITH CHECK (pode_acessar_obra(obra_id));

CREATE POLICY isolamento_obra ON planejamento_compromissos AS RESTRICTIVE FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM planejamento_semanas s WHERE s.id = semana_id AND pode_acessar_obra(s.obra_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM planejamento_semanas s WHERE s.id = semana_id AND pode_acessar_obra(s.obra_id)));

CREATE POLICY restricoes_select ON restricoes FOR SELECT TO authenticated
  USING (meu_papel() IN ('admin', 'equipe') AND (ativo = true OR pode_editar_planejamento()));
CREATE POLICY restricoes_insert ON restricoes FOR INSERT TO authenticated
  WITH CHECK (pode_editar_planejamento());
CREATE POLICY restricoes_update ON restricoes FOR UPDATE TO authenticated
  USING (pode_editar_planejamento())
  WITH CHECK (pode_editar_planejamento());

CREATE POLICY planejamento_semanas_select ON planejamento_semanas FOR SELECT TO authenticated
  USING (meu_papel() IN ('admin', 'equipe') AND (ativo = true OR pode_editar_planejamento()));
CREATE POLICY planejamento_semanas_insert ON planejamento_semanas FOR INSERT TO authenticated
  WITH CHECK (pode_editar_planejamento());
CREATE POLICY planejamento_semanas_update ON planejamento_semanas FOR UPDATE TO authenticated
  USING (pode_editar_planejamento())
  WITH CHECK (pode_editar_planejamento());

CREATE POLICY planejamento_compromissos_select ON planejamento_compromissos FOR SELECT TO authenticated
  USING (meu_papel() IN ('admin', 'equipe') AND (ativo = true OR pode_editar_planejamento()));
CREATE POLICY planejamento_compromissos_insert ON planejamento_compromissos FOR INSERT TO authenticated
  WITH CHECK (pode_editar_planejamento());
CREATE POLICY planejamento_compromissos_update ON planejamento_compromissos FOR UPDATE TO authenticated
  USING (pode_editar_planejamento())
  WITH CHECK (pode_editar_planejamento());

REVOKE ALL ON FUNCTION bloquear_tarefa_com_restricao_aberta() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION travar_compromisso_fechado() FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION calcular_fechamento_semana(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION calcular_fechamento_semana(UUID) TO authenticated;
REVOKE ALL ON FUNCTION fechar_semana_planejamento(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION fechar_semana_planejamento(UUID) TO authenticated;
