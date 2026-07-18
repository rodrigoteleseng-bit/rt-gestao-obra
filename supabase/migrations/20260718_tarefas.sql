-- ============================================================
-- FASE 7 — TAREFAS | RT Engenharia
-- ============================================================
-- Tarefas avulsas por obra, com prazo obrigatorio, responsavel
-- opcional, comentarios append-only e maquina de status travada
-- no banco. Cliente nao ve o modulo.

ALTER TYPE modulo_app ADD VALUE IF NOT EXISTS 'tarefas';

CREATE TYPE status_tarefa AS ENUM ('aberta', 'em_andamento', 'concluida', 'cancelada');
CREATE TYPE prioridade_tarefa AS ENUM ('baixa', 'normal', 'alta', 'urgente');
CREATE TYPE tipo_tarefa_comentario AS ENUM ('comentario', 'criada', 'iniciada', 'concluida', 'cancelada', 'reaberta', 'editada');

CREATE TABLE tarefas (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  obra_id             UUID NOT NULL REFERENCES obras(id) ON DELETE CASCADE,
  unidade_id          UUID REFERENCES unidades(id),
  etapa_id            UUID REFERENCES etapas(id),
  servico_id          UUID REFERENCES servicos(id),
  titulo              TEXT NOT NULL,
  descricao           TEXT,
  responsavel_id      UUID REFERENCES perfis_usuario(id),
  prazo               DATE NOT NULL,
  prioridade          prioridade_tarefa NOT NULL DEFAULT 'normal',
  status              status_tarefa NOT NULL DEFAULT 'aberta',
  motivo_cancelamento TEXT,
  concluida_por       UUID REFERENCES perfis_usuario(id),
  concluida_em        TIMESTAMPTZ,
  cancelada_por       UUID REFERENCES perfis_usuario(id),
  cancelada_em        TIMESTAMPTZ,
  ativo               BOOLEAN NOT NULL DEFAULT true,
  criado_por          UUID NOT NULL DEFAULT auth.uid() REFERENCES perfis_usuario(id),
  criado_em           TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_por      UUID REFERENCES perfis_usuario(id),
  atualizado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT tarefas_titulo_not_blank CHECK (btrim(titulo) <> ''),
  CONSTRAINT tarefas_cancelamento_motivo_chk CHECK (status <> 'cancelada' OR btrim(COALESCE(motivo_cancelamento, '')) <> ''),
  CONSTRAINT tarefas_conclusao_auditoria_chk CHECK (status <> 'concluida' OR (concluida_por IS NOT NULL AND concluida_em IS NOT NULL)),
  CONSTRAINT tarefas_cancelamento_auditoria_chk CHECK (status <> 'cancelada' OR (cancelada_por IS NOT NULL AND cancelada_em IS NOT NULL))
);

CREATE TABLE tarefas_comentarios (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tarefa_id   UUID NOT NULL REFERENCES tarefas(id) ON DELETE CASCADE,
  tipo        tipo_tarefa_comentario NOT NULL DEFAULT 'comentario',
  comentario  TEXT NOT NULL,
  criado_por  UUID NOT NULL DEFAULT auth.uid() REFERENCES perfis_usuario(id),
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT tarefas_comentarios_texto_not_blank CHECK (btrim(comentario) <> '')
);

CREATE INDEX idx_tarefas_obra_status ON tarefas(obra_id, status) WHERE ativo;
CREATE INDEX idx_tarefas_obra_prazo ON tarefas(obra_id, prazo) WHERE ativo;
CREATE INDEX idx_tarefas_responsavel ON tarefas(responsavel_id) WHERE ativo;
CREATE INDEX idx_tarefas_unidade ON tarefas(unidade_id) WHERE ativo;
CREATE INDEX idx_tarefas_comentarios_tarefa ON tarefas_comentarios(tarefa_id, criado_em);

ALTER TABLE tarefas ENABLE ROW LEVEL SECURITY;
ALTER TABLE tarefas_comentarios ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION pode_editar_tarefas()
RETURNS boolean
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT meu_papel() = 'admin'
    OR (meu_papel() = 'equipe' AND 'tarefas' = ANY(meus_modulos()))
$$;

CREATE OR REPLACE FUNCTION validar_tarefa_mesma_obra()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_obra UUID;
  v_unidade_etapa UUID;
  v_etapa_servico UUID;
BEGIN
  IF NEW.unidade_id IS NOT NULL THEN
    SELECT u.obra_id INTO v_obra FROM unidades u WHERE u.id = NEW.unidade_id AND u.ativo;
    IF v_obra IS NULL OR v_obra <> NEW.obra_id THEN
      RAISE EXCEPTION 'A unidade vinculada nao pertence a obra da tarefa.';
    END IF;
  END IF;

  IF NEW.etapa_id IS NOT NULL THEN
    SELECT u.obra_id, e.unidade_id INTO v_obra, v_unidade_etapa
    FROM etapas e JOIN unidades u ON u.id = e.unidade_id
    WHERE e.id = NEW.etapa_id AND e.ativo AND u.ativo;
    IF v_obra IS NULL OR v_obra <> NEW.obra_id THEN
      RAISE EXCEPTION 'A etapa vinculada nao pertence a obra da tarefa.';
    END IF;
    IF NEW.unidade_id IS NOT NULL AND v_unidade_etapa <> NEW.unidade_id THEN
      RAISE EXCEPTION 'A etapa vinculada nao pertence a unidade informada.';
    END IF;
  END IF;

  IF NEW.servico_id IS NOT NULL THEN
    SELECT u.obra_id, s.etapa_id, e.unidade_id INTO v_obra, v_etapa_servico, v_unidade_etapa
    FROM servicos s
    JOIN etapas e ON e.id = s.etapa_id
    JOIN unidades u ON u.id = e.unidade_id
    WHERE s.id = NEW.servico_id AND s.ativo AND e.ativo AND u.ativo;
    IF v_obra IS NULL OR v_obra <> NEW.obra_id THEN
      RAISE EXCEPTION 'O servico vinculado nao pertence a obra da tarefa.';
    END IF;
    IF NEW.etapa_id IS NOT NULL AND v_etapa_servico <> NEW.etapa_id THEN
      RAISE EXCEPTION 'O servico vinculado nao pertence a etapa informada.';
    END IF;
    IF NEW.unidade_id IS NOT NULL AND v_unidade_etapa <> NEW.unidade_id THEN
      RAISE EXCEPTION 'O servico vinculado nao pertence a unidade informada.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION preparar_tarefa()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.titulo := btrim(NEW.titulo);
  NEW.descricao := NULLIF(btrim(COALESCE(NEW.descricao, '')), '');
  NEW.motivo_cancelamento := NULLIF(btrim(COALESCE(NEW.motivo_cancelamento, '')), '');
  NEW.atualizado_por := auth.uid();
  NEW.atualizado_em := now();

  IF TG_OP = 'INSERT' THEN
    NEW.criado_por := COALESCE(NEW.criado_por, auth.uid());
    IF NEW.status <> 'aberta' THEN
      RAISE EXCEPTION 'Nova tarefa deve iniciar como aberta.';
    END IF;
    NEW.concluida_por := NULL;
    NEW.concluida_em := NULL;
    NEW.cancelada_por := NULL;
    NEW.cancelada_em := NULL;
    NEW.motivo_cancelamento := NULL;
  ELSE
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      IF OLD.status = 'aberta' AND NEW.status = 'em_andamento' THEN
        NEW.concluida_por := NULL;
        NEW.concluida_em := NULL;
        NEW.cancelada_por := NULL;
        NEW.cancelada_em := NULL;
        NEW.motivo_cancelamento := NULL;
      ELSIF OLD.status IN ('aberta', 'em_andamento') AND NEW.status = 'concluida' THEN
        IF meu_papel() <> 'admin' AND (OLD.responsavel_id IS NULL OR OLD.responsavel_id <> auth.uid()) THEN
          RAISE EXCEPTION 'Equipe so pode concluir tarefa em que esteja como responsavel.';
        END IF;
        NEW.concluida_por := auth.uid();
        NEW.concluida_em := now();
        NEW.cancelada_por := NULL;
        NEW.cancelada_em := NULL;
        NEW.motivo_cancelamento := NULL;
      ELSIF OLD.status IN ('aberta', 'em_andamento') AND NEW.status = 'cancelada' THEN
        IF btrim(COALESCE(NEW.motivo_cancelamento, '')) = '' THEN
          RAISE EXCEPTION 'Informe o motivo do cancelamento.';
        END IF;
        NEW.cancelada_por := auth.uid();
        NEW.cancelada_em := now();
        NEW.concluida_por := NULL;
        NEW.concluida_em := NULL;
      ELSIF OLD.status IN ('concluida', 'cancelada') AND NEW.status = 'aberta' THEN
        IF meu_papel() <> 'admin' THEN
          RAISE EXCEPTION 'Somente o admin pode reabrir tarefa concluida ou cancelada.';
        END IF;
        NEW.concluida_por := NULL;
        NEW.concluida_em := NULL;
        NEW.cancelada_por := NULL;
        NEW.cancelada_em := NULL;
        NEW.motivo_cancelamento := NULL;
      ELSE
        RAISE EXCEPTION 'Transicao de status invalida para tarefa: % -> %.', OLD.status, NEW.status;
      END IF;
    ELSE
      IF OLD.status IN ('concluida', 'cancelada') THEN
        RAISE EXCEPTION 'Tarefa concluida ou cancelada fica em modo leitura. Reabra antes de editar.';
      END IF;
      NEW.concluida_por := OLD.concluida_por;
      NEW.concluida_em := OLD.concluida_em;
      NEW.cancelada_por := OLD.cancelada_por;
      NEW.cancelada_em := OLD.cancelada_em;
      IF OLD.status <> 'cancelada' THEN
        NEW.motivo_cancelamento := OLD.motivo_cancelamento;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION registrar_evento_tarefa()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tipo tipo_tarefa_comentario;
  v_texto TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_tipo := 'criada';
    v_texto := 'Tarefa criada.';
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    v_tipo := CASE NEW.status
      WHEN 'em_andamento' THEN 'iniciada'::tipo_tarefa_comentario
      WHEN 'concluida' THEN 'concluida'::tipo_tarefa_comentario
      WHEN 'cancelada' THEN 'cancelada'::tipo_tarefa_comentario
      WHEN 'aberta' THEN 'reaberta'::tipo_tarefa_comentario
    END;
    v_texto := CASE NEW.status
      WHEN 'em_andamento' THEN 'Tarefa iniciada.'
      WHEN 'concluida' THEN 'Tarefa concluida.'
      WHEN 'cancelada' THEN 'Tarefa cancelada: ' || COALESCE(NEW.motivo_cancelamento, '')
      WHEN 'aberta' THEN 'Tarefa reaberta.'
    END;
  ELSE
    RETURN NEW;
  END IF;

  INSERT INTO tarefas_comentarios (tarefa_id, tipo, comentario, criado_por)
  VALUES (NEW.id, v_tipo, v_texto, auth.uid());
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION registrar_edicao_tarefa()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_partes TEXT[] := ARRAY[]::TEXT[];
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;
  IF NEW.titulo IS DISTINCT FROM OLD.titulo THEN v_partes := array_append(v_partes, 'titulo'); END IF;
  IF NEW.descricao IS DISTINCT FROM OLD.descricao THEN v_partes := array_append(v_partes, 'descricao'); END IF;
  IF NEW.responsavel_id IS DISTINCT FROM OLD.responsavel_id THEN v_partes := array_append(v_partes, 'responsavel'); END IF;
  IF NEW.prazo IS DISTINCT FROM OLD.prazo THEN v_partes := array_append(v_partes, 'prazo'); END IF;
  IF NEW.prioridade IS DISTINCT FROM OLD.prioridade THEN v_partes := array_append(v_partes, 'prioridade'); END IF;
  IF NEW.unidade_id IS DISTINCT FROM OLD.unidade_id THEN v_partes := array_append(v_partes, 'unidade'); END IF;
  IF NEW.etapa_id IS DISTINCT FROM OLD.etapa_id THEN v_partes := array_append(v_partes, 'etapa'); END IF;
  IF NEW.servico_id IS DISTINCT FROM OLD.servico_id THEN v_partes := array_append(v_partes, 'servico'); END IF;

  IF cardinality(v_partes) > 0 THEN
    INSERT INTO tarefas_comentarios (tarefa_id, tipo, comentario, criado_por)
    VALUES (NEW.id, 'editada', 'Tarefa editada: ' || array_to_string(v_partes, ', ') || '.', auth.uid());
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validar_tarefa_mesma_obra
  BEFORE INSERT OR UPDATE ON tarefas
  FOR EACH ROW EXECUTE FUNCTION validar_tarefa_mesma_obra();

CREATE TRIGGER trg_preparar_tarefa
  BEFORE INSERT OR UPDATE ON tarefas
  FOR EACH ROW EXECUTE FUNCTION preparar_tarefa();

CREATE TRIGGER trg_registrar_evento_tarefa_insert
  AFTER INSERT ON tarefas
  FOR EACH ROW EXECUTE FUNCTION registrar_evento_tarefa();

CREATE TRIGGER trg_registrar_evento_tarefa_status
  AFTER UPDATE OF status ON tarefas
  FOR EACH ROW EXECUTE FUNCTION registrar_evento_tarefa();

CREATE TRIGGER trg_registrar_edicao_tarefa
  AFTER UPDATE OF titulo, descricao, responsavel_id, prazo, prioridade, unidade_id, etapa_id, servico_id ON tarefas
  FOR EACH ROW EXECUTE FUNCTION registrar_edicao_tarefa();

CREATE POLICY isolamento_obra ON tarefas AS RESTRICTIVE FOR ALL TO authenticated
  USING (pode_acessar_obra(obra_id))
  WITH CHECK (pode_acessar_obra(obra_id));

CREATE POLICY isolamento_obra ON tarefas_comentarios AS RESTRICTIVE FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM tarefas t WHERE t.id = tarefa_id AND pode_acessar_obra(t.obra_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM tarefas t WHERE t.id = tarefa_id AND pode_acessar_obra(t.obra_id)));

CREATE POLICY tarefas_select ON tarefas FOR SELECT TO authenticated
  USING (meu_papel() IN ('admin', 'equipe') AND (ativo = true OR pode_editar_tarefas()));
CREATE POLICY tarefas_insert ON tarefas FOR INSERT TO authenticated
  WITH CHECK (pode_editar_tarefas());
CREATE POLICY tarefas_update ON tarefas FOR UPDATE TO authenticated
  USING (pode_editar_tarefas())
  WITH CHECK (pode_editar_tarefas());

CREATE POLICY tarefas_comentarios_select ON tarefas_comentarios FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM tarefas t
    WHERE t.id = tarefa_id
      AND (t.ativo = true OR pode_editar_tarefas())
      AND meu_papel() IN ('admin', 'equipe')
  ));
CREATE POLICY tarefas_comentarios_insert ON tarefas_comentarios FOR INSERT TO authenticated
  WITH CHECK (pode_editar_tarefas() AND EXISTS (
    SELECT 1 FROM tarefas t
    WHERE t.id = tarefa_id
      AND t.ativo = true
      AND meu_papel() IN ('admin', 'equipe')
  ));

-- Funcoes de trigger SECURITY DEFINER nao devem ser chamaveis diretamente via RPC
-- (mesmo padrao de hardening aplicado a vincular_admin_nova_obra/validar_acesso_obra_linha
-- em 20260717_isolamento_usuario_obra.sql). O REVOKE nao afeta o disparo do trigger.
REVOKE ALL ON FUNCTION validar_tarefa_mesma_obra() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION registrar_evento_tarefa() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION registrar_edicao_tarefa() FROM PUBLIC, anon, authenticated;
