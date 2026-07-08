-- ============================================================
-- FASE 2 — CRONOGRAMA + AVANÇO FÍSICO | RT Engenharia
-- ============================================================
-- Baselines versionadas (nada se apaga), tarefas com identidade
-- estável (UID do MS Project), previsto por versão, dependências
-- e lançamentos semanais de avanço com autoria e soft delete.

-- Versões de baseline: cada importação do MS Project gera uma versão.
CREATE TABLE cronograma_versoes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  obra_id     UUID NOT NULL REFERENCES obras(id) ON DELETE CASCADE,
  versao      INTEGER NOT NULL,
  nome        TEXT NOT NULL,
  arquivo     TEXT,
  vigente     BOOLEAN NOT NULL DEFAULT true,
  ativo       BOOLEAN NOT NULL DEFAULT true,
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT now(),
  criado_por  UUID REFERENCES perfis_usuario(id),
  UNIQUE (obra_id, versao)
);

-- Tarefas do cronograma (árvore própria do MS Project).
-- uid_project mantém a identidade entre reimportações.
-- etapa_id/servico_id: vínculo opcional com o orçamento (de-para na Fase 3).
CREATE TABLE cronograma_tarefas (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  obra_id         UUID NOT NULL REFERENCES obras(id) ON DELETE CASCADE,
  unidade_id      UUID NOT NULL REFERENCES unidades(id),
  parent_id       UUID REFERENCES cronograma_tarefas(id),
  uid_project     INTEGER NOT NULL,
  outline_number  TEXT,
  nivel           INTEGER NOT NULL,
  ordem           INTEGER NOT NULL,
  nome            TEXT NOT NULL,
  resumo          BOOLEAN NOT NULL DEFAULT false,
  grupo_ataque    TEXT,
  etapa_id        UUID REFERENCES etapas(id),
  servico_id      UUID REFERENCES servicos(id),
  ativo           BOOLEAN NOT NULL DEFAULT true,
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
  criado_por      UUID REFERENCES perfis_usuario(id),
  UNIQUE (obra_id, uid_project)
);

-- Datas previstas de cada tarefa, por versão de baseline.
CREATE TABLE cronograma_previsto (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tarefa_id     UUID NOT NULL REFERENCES cronograma_tarefas(id) ON DELETE CASCADE,
  versao_id     UUID NOT NULL REFERENCES cronograma_versoes(id) ON DELETE CASCADE,
  inicio        DATE NOT NULL,
  fim           DATE NOT NULL,
  duracao_horas NUMERIC(10,2),
  UNIQUE (tarefa_id, versao_id)
);

-- Rede de dependências (predecessoras) do MS Project.
-- tipo: FS, SS, FF, SF. defasagem_min em minutos (LinkLag/10 do XML).
CREATE TABLE cronograma_dependencias (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tarefa_id       UUID NOT NULL REFERENCES cronograma_tarefas(id) ON DELETE CASCADE,
  predecessora_id UUID NOT NULL REFERENCES cronograma_tarefas(id) ON DELETE CASCADE,
  tipo            TEXT NOT NULL DEFAULT 'FS' CHECK (tipo IN ('FS','SS','FF','SF')),
  defasagem_min   INTEGER NOT NULL DEFAULT 0,
  UNIQUE (tarefa_id, predecessora_id)
);

-- Lançamentos semanais de avanço físico (% acumulado por tarefa-folha).
-- O % atual da tarefa é o último lançamento ativo; o histórico fica íntegro.
CREATE TABLE avancos_fisicos (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tarefa_id       UUID NOT NULL REFERENCES cronograma_tarefas(id),
  data_referencia DATE NOT NULL,
  percentual      NUMERIC(5,2) NOT NULL CHECK (percentual >= 0 AND percentual <= 100),
  observacao      TEXT,
  ativo           BOOLEAN NOT NULL DEFAULT true,
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
  criado_por      UUID NOT NULL DEFAULT auth.uid() REFERENCES perfis_usuario(id)
);

CREATE INDEX idx_cron_tarefas_obra     ON cronograma_tarefas(obra_id);
CREATE INDEX idx_cron_tarefas_unidade  ON cronograma_tarefas(unidade_id);
CREATE INDEX idx_cron_tarefas_parent   ON cronograma_tarefas(parent_id);
CREATE INDEX idx_cron_previsto_versao  ON cronograma_previsto(versao_id);
CREATE INDEX idx_cron_previsto_tarefa  ON cronograma_previsto(tarefa_id);
CREATE INDEX idx_cron_dep_tarefa       ON cronograma_dependencias(tarefa_id);
CREATE INDEX idx_avancos_tarefa        ON avancos_fisicos(tarefa_id);
CREATE INDEX idx_avancos_data          ON avancos_fisicos(data_referencia);

ALTER TABLE cronograma_versoes      ENABLE ROW LEVEL SECURITY;
ALTER TABLE cronograma_tarefas      ENABLE ROW LEVEL SECURITY;
ALTER TABLE cronograma_previsto     ENABLE ROW LEVEL SECURITY;
ALTER TABLE cronograma_dependencias ENABLE ROW LEVEL SECURITY;
ALTER TABLE avancos_fisicos         ENABLE ROW LEVEL SECURITY;

-- Leitura para autenticados; escrita do cronograma só admin.
CREATE POLICY cron_versoes_select ON cronograma_versoes FOR SELECT USING (ativo = true);
CREATE POLICY cron_versoes_admin  ON cronograma_versoes FOR ALL
  USING (meu_papel() = 'admin') WITH CHECK (meu_papel() = 'admin');

CREATE POLICY cron_tarefas_select ON cronograma_tarefas FOR SELECT USING (ativo = true);
CREATE POLICY cron_tarefas_admin  ON cronograma_tarefas FOR ALL
  USING (meu_papel() = 'admin') WITH CHECK (meu_papel() = 'admin');

CREATE POLICY cron_previsto_select ON cronograma_previsto FOR SELECT USING (true);
CREATE POLICY cron_previsto_admin  ON cronograma_previsto FOR ALL
  USING (meu_papel() = 'admin') WITH CHECK (meu_papel() = 'admin');

CREATE POLICY cron_dep_select ON cronograma_dependencias FOR SELECT USING (true);
CREATE POLICY cron_dep_admin  ON cronograma_dependencias FOR ALL
  USING (meu_papel() = 'admin') WITH CHECK (meu_papel() = 'admin');

-- Avanço: admin sempre; equipe apenas com o módulo 'avanco' habilitado.
-- Correção = novo lançamento ou inativação do próprio registro (autor ou admin).
CREATE POLICY avancos_select ON avancos_fisicos FOR SELECT USING (true);
CREATE POLICY avancos_insert ON avancos_fisicos FOR INSERT WITH CHECK (
  meu_papel() = 'admin'
  OR (meu_papel() = 'equipe' AND 'avanco' = ANY(meus_modulos()))
);
CREATE POLICY avancos_update ON avancos_fisicos FOR UPDATE
  USING (meu_papel() = 'admin' OR criado_por = auth.uid())
  WITH CHECK (meu_papel() = 'admin' OR criado_por = auth.uid());
