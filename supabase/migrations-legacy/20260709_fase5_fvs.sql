-- ============================================================
-- FASE 5 (parte 2) — FVS: Fichas de Verificação de Serviço
-- ============================================================
-- Modelos de checklist por tipo de serviço (17 fichas seedadas de
-- fvs_15_prioritarias_qualidade_obras.md + Reboco + Forro de gesso),
-- aplicadas por unidade com rodadas de verificação (histórico
-- imutável). Item NC gera pendência automática (RPC transacional).
-- Status: em_andamento → aprovada | aprovada_restricao | reprovada.
-- Aprovada = imutável. Cliente não vê. Decisões do Rodrigo 09/07/2026.

CREATE TYPE status_fvs AS ENUM ('em_andamento', 'aprovada', 'aprovada_restricao', 'reprovada');
CREATE TYPE resposta_fvs AS ENUM ('c', 'nc', 'na');

-- Modelos (globais — servem para qualquer obra)
CREATE TABLE fvs_modelos (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo              TEXT NOT NULL UNIQUE,   -- 'FVS-001'
  nome                TEXT NOT NULL,
  objetivo            TEXT,
  normas              TEXT,
  criterios_aceitacao TEXT,
  ordem               INTEGER NOT NULL,
  ativo               BOOLEAN NOT NULL DEFAULT true,
  criado_em           TIMESTAMPTZ NOT NULL DEFAULT now(),
  criado_por          UUID DEFAULT auth.uid() REFERENCES perfis_usuario(id)
);

CREATE TABLE fvs_modelo_itens (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  modelo_id  UUID NOT NULL REFERENCES fvs_modelos(id) ON DELETE CASCADE,
  secao      TEXT NOT NULL,      -- 'Pré-requisitos', 'Execução', 'Armação'…
  ordem      INTEGER NOT NULL,
  texto      TEXT NOT NULL,
  criterio   TEXT,               -- tolerância/critério objetivo (opcional, preenchível depois)
  ativo      BOOLEAN NOT NULL DEFAULT true
);

-- Aplicação de uma FVS em uma unidade
CREATE TABLE fvs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  obra_id       UUID NOT NULL REFERENCES obras(id) ON DELETE CASCADE,
  modelo_id     UUID NOT NULL REFERENCES fvs_modelos(id),
  unidade_id    UUID NOT NULL REFERENCES unidades(id),
  tarefa_id     UUID REFERENCES cronograma_tarefas(id),
  local_ambiente TEXT,           -- ex.: 'Pav. Térreo', 'Banheiro suíte'
  equipe_empreiteiro TEXT,
  projeto_referencia TEXT,
  status        status_fvs NOT NULL DEFAULT 'em_andamento',
  ativo         BOOLEAN NOT NULL DEFAULT true,
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
  criado_por    UUID NOT NULL DEFAULT auth.uid() REFERENCES perfis_usuario(id)
);

-- Rodadas de verificação (histórico: 1ª reprovada, 2ª aprovada…)
CREATE TABLE fvs_verificacoes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fvs_id        UUID NOT NULL REFERENCES fvs(id) ON DELETE CASCADE,
  numero        INTEGER NOT NULL,
  resultado     status_fvs,      -- NULL = rodada aberta
  observacao    TEXT,
  concluida_em  TIMESTAMPTZ,
  concluida_por UUID REFERENCES perfis_usuario(id),
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
  criado_por    UUID NOT NULL DEFAULT auth.uid() REFERENCES perfis_usuario(id),
  UNIQUE (fvs_id, numero)
);

CREATE TABLE fvs_respostas (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  verificacao_id  UUID NOT NULL REFERENCES fvs_verificacoes(id) ON DELETE CASCADE,
  item_id         UUID NOT NULL REFERENCES fvs_modelo_itens(id),
  resposta        resposta_fvs NOT NULL,
  observacao      TEXT,
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
  criado_por      UUID NOT NULL DEFAULT auth.uid() REFERENCES perfis_usuario(id),
  UNIQUE (verificacao_id, item_id)
);

CREATE TABLE fvs_fotos (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fvs_id          UUID NOT NULL REFERENCES fvs(id) ON DELETE CASCADE,
  verificacao_id  UUID REFERENCES fvs_verificacoes(id),
  item_id         UUID REFERENCES fvs_modelo_itens(id),
  path            TEXT NOT NULL,      -- bucket 'fvs'
  legenda         TEXT,
  lat             NUMERIC(10,7),
  lng             NUMERIC(10,7),
  precisao_m      NUMERIC(8,1),
  capturada_em    TIMESTAMPTZ NOT NULL,
  hash_sha256     TEXT NOT NULL,
  ativo           BOOLEAN NOT NULL DEFAULT true,
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
  criado_por      UUID NOT NULL DEFAULT auth.uid() REFERENCES perfis_usuario(id)
);

-- Pendência gerada por item NC de FVS: rastreia a origem
ALTER TABLE pendencias ADD COLUMN fvs_id UUID REFERENCES fvs(id);

CREATE INDEX idx_fvs_obra_status   ON fvs(obra_id, status);
CREATE INDEX idx_fvs_unidade       ON fvs(unidade_id);
CREATE INDEX idx_fvs_verif_fvs     ON fvs_verificacoes(fvs_id);
CREATE INDEX idx_fvs_resp_verif    ON fvs_respostas(verificacao_id);
CREATE INDEX idx_fvs_fotos_fvs     ON fvs_fotos(fvs_id);
CREATE INDEX idx_fvs_itens_modelo  ON fvs_modelo_itens(modelo_id);
CREATE INDEX idx_pendencias_fvs    ON pendencias(fvs_id);

ALTER TABLE fvs_modelos      ENABLE ROW LEVEL SECURITY;
ALTER TABLE fvs_modelo_itens ENABLE ROW LEVEL SECURITY;
ALTER TABLE fvs              ENABLE ROW LEVEL SECURITY;
ALTER TABLE fvs_verificacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE fvs_respostas    ENABLE ROW LEVEL SECURITY;
ALTER TABLE fvs_fotos        ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION pode_editar_fvs()
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT meu_papel() = 'admin'
    OR (meu_papel() = 'equipe' AND 'fvs' = ANY(meus_modulos()))
$$;

-- Helpers SECURITY DEFINER para policies de sub-tabelas
CREATE OR REPLACE FUNCTION fvs_nao_aprovada(p_fvs UUID)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (SELECT 1 FROM fvs WHERE id = p_fvs AND status <> 'aprovada' AND ativo = true)
$$;

CREATE OR REPLACE FUNCTION fvs_verificacao_aberta(p_verif UUID)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM fvs_verificacoes v
    JOIN fvs f ON f.id = v.fvs_id
    WHERE v.id = p_verif AND v.resultado IS NULL AND f.ativo = true
  )
$$;

-- Modelos: leitura admin/equipe; escrita só admin
CREATE POLICY fvsm_select ON fvs_modelos FOR SELECT
  USING (ativo = true AND meu_papel() IN ('admin', 'equipe'));
CREATE POLICY fvsm_insert ON fvs_modelos FOR INSERT WITH CHECK (meu_papel() = 'admin');
CREATE POLICY fvsm_update ON fvs_modelos FOR UPDATE
  USING (meu_papel() = 'admin') WITH CHECK (meu_papel() = 'admin');

CREATE POLICY fvsi_select ON fvs_modelo_itens FOR SELECT
  USING (ativo = true AND meu_papel() IN ('admin', 'equipe'));
CREATE POLICY fvsi_insert ON fvs_modelo_itens FOR INSERT WITH CHECK (meu_papel() = 'admin');
CREATE POLICY fvsi_update ON fvs_modelo_itens FOR UPDATE
  USING (meu_papel() = 'admin') WITH CHECK (meu_papel() = 'admin');

-- FVS: leitura admin/equipe (cliente bloqueado); escrita módulo fvs;
-- aprovada = imutável (nem admin altera pela API)
CREATE POLICY fvs_select ON fvs FOR SELECT
  USING (ativo = true AND meu_papel() IN ('admin', 'equipe'));
CREATE POLICY fvs_insert ON fvs FOR INSERT WITH CHECK (pode_editar_fvs());
CREATE POLICY fvs_update ON fvs FOR UPDATE
  USING (pode_editar_fvs() AND status <> 'aprovada')
  WITH CHECK (pode_editar_fvs());

CREATE POLICY fvsv_select ON fvs_verificacoes FOR SELECT
  USING (meu_papel() IN ('admin', 'equipe'));
CREATE POLICY fvsv_insert ON fvs_verificacoes FOR INSERT
  WITH CHECK (pode_editar_fvs() AND fvs_nao_aprovada(fvs_id));

CREATE POLICY fvsr_select ON fvs_respostas FOR SELECT
  USING (meu_papel() IN ('admin', 'equipe'));
CREATE POLICY fvsr_insert ON fvs_respostas FOR INSERT
  WITH CHECK (pode_editar_fvs() AND fvs_verificacao_aberta(verificacao_id));
CREATE POLICY fvsr_update ON fvs_respostas FOR UPDATE
  USING (pode_editar_fvs() AND fvs_verificacao_aberta(verificacao_id))
  WITH CHECK (pode_editar_fvs() AND fvs_verificacao_aberta(verificacao_id));

CREATE POLICY fvsf_select ON fvs_fotos FOR SELECT
  USING (ativo = true AND meu_papel() IN ('admin', 'equipe'));
CREATE POLICY fvsf_insert ON fvs_fotos FOR INSERT
  WITH CHECK (pode_editar_fvs() AND fvs_nao_aprovada(fvs_id));
CREATE POLICY fvsf_update ON fvs_fotos FOR UPDATE
  USING (pode_editar_fvs() AND fvs_nao_aprovada(fvs_id))
  WITH CHECK (pode_editar_fvs() AND fvs_nao_aprovada(fvs_id));

-- ============================================================
-- RPC transacional: conclui a rodada, atualiza o status da FVS
-- e cria 1 pendência por item NC (com evento 'aberta').
-- SECURITY DEFINER: quem tem módulo fvs gera pendências
-- automáticas mesmo sem o módulo pendencias.
-- ============================================================
CREATE OR REPLACE FUNCTION concluir_verificacao_fvs(
  p_verificacao UUID,
  p_resultado   status_fvs,
  p_observacao  TEXT DEFAULT NULL
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

  SELECT * INTO v_verif FROM fvs_verificacoes WHERE id = p_verificacao FOR UPDATE;
  IF NOT FOUND OR v_verif.resultado IS NOT NULL THEN
    RAISE EXCEPTION 'Verificação inexistente ou já concluída';
  END IF;

  SELECT * INTO v_fvs FROM fvs WHERE id = v_verif.fvs_id;
  IF v_fvs.status = 'aprovada' OR v_fvs.ativo = false THEN
    RAISE EXCEPTION 'FVS aprovada ou inativa não pode ser alterada';
  END IF;

  -- não se aprova com item NC na rodada
  IF p_resultado = 'aprovada' AND EXISTS (
    SELECT 1 FROM fvs_respostas WHERE verificacao_id = p_verificacao AND resposta = 'nc'
  ) THEN
    RAISE EXCEPTION 'Há itens não conformes: use Reprovada ou Aprovada com restrição';
  END IF;

  SELECT * INTO v_modelo FROM fvs_modelos WHERE id = v_fvs.modelo_id;

  UPDATE fvs_verificacoes
  SET resultado = p_resultado, observacao = p_observacao,
      concluida_em = now(), concluida_por = auth.uid()
  WHERE id = p_verificacao;

  UPDATE fvs SET status = p_resultado WHERE id = v_fvs.id;

  -- 1 pendência automática por item NC
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

-- RPC: nova rodada numa FVS reprovada
CREATE OR REPLACE FUNCTION nova_verificacao_fvs(p_fvs UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_fvs  fvs%ROWTYPE;
  v_novo UUID;
BEGIN
  IF NOT pode_editar_fvs() THEN
    RAISE EXCEPTION 'Sem permissão';
  END IF;
  SELECT * INTO v_fvs FROM fvs WHERE id = p_fvs FOR UPDATE;
  IF NOT FOUND OR v_fvs.ativo = false OR v_fvs.status <> 'reprovada' THEN
    RAISE EXCEPTION 'Nova verificação só é permitida em FVS reprovada';
  END IF;

  INSERT INTO fvs_verificacoes (fvs_id, numero, criado_por)
  SELECT p_fvs, COALESCE(MAX(numero), 0) + 1, auth.uid()
  FROM fvs_verificacoes WHERE fvs_id = p_fvs
  RETURNING id INTO v_novo;

  UPDATE fvs SET status = 'em_andamento' WHERE id = p_fvs;
  RETURN v_novo;
END;
$$;

-- Bucket privado para fotos de FVS
INSERT INTO storage.buckets (id, name, public) VALUES ('fvs', 'fvs', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY fvs_storage_select ON storage.objects FOR SELECT
  USING (bucket_id = 'fvs' AND meu_papel() IN ('admin', 'equipe'));
CREATE POLICY fvs_storage_insert ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'fvs' AND pode_editar_fvs());
