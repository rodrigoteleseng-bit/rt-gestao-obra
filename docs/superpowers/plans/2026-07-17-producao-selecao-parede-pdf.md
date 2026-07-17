# Produção própria — Seleção de parede por planta (PDF) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir a digitação manual de comprimento/altura/vãos no lançamento diário de Produção própria por um catálogo de paredes clicável sobre a planta em PDF (térreo, superior, platibanda, caixa d'água), reaproveitado nos 13 sobrados "Tipo" com saldo de produção independente por sobrado, incluindo cancelamento de lançamento não aprovado.

**Architecture:** Três tabelas novas (`producao_plantas`, `producao_paredes`, `producao_paredes_progresso`) + alterações em `producao_lancamentos` (vínculo opcional a parede/face, colunas de cancelamento). PDF é convertido para imagem uma vez no upload (no navegador, com `pdfjs-dist`); cadastro e lançamento usam sempre a imagem, nunca renderizam o PDF ao vivo. Um componente React único (`PlantaClicavel`) cobre os dois modos de uso: "desenhar" (cadastro, admin/equipe desenha as faixas) e "selecionar" (lançamento diário, clique simples). RLS segue o padrão `SECURITY DEFINER` por tabela-pai (aprendido na revisão de `docs/revisao-2026-07-17-rls-filhos-obra.md` — nunca subquery inline). Saldo por parede×sobrado×serviço/face é travado no banco, mesmo princípio de Medições de contrato.

**Tech Stack:** PostgreSQL (Supabase) pra migração; React 19 + TypeScript + Vite 6 pro resto; `pdfjs-dist` (nova dependência) só para converter PDF→PNG no momento do upload. Sem framework de teste automatizado neste projeto — verificação via `npm run build` + navegador, mesmo padrão usado em todas as fases anteriores.

## Global Constraints

- **Trava total:** o lançamento diário só aceita paredes já cadastradas na planta clicável — sem fallback de texto livre (decisão do Rodrigo, spec §2).
- **Escopo desta entrega:** só a planta "Sobrado Tipo" (térreo/superior/platibanda/caixa d'água), reaproveitada nos 13 sobrados. Portaria e Área Comum ficam de fora — mas nada no modelo de dados é específico de sobrado (spec §2).
- **Saldo é por sobrado, não pela planta:** `producao_paredes` guarda a meta (cadastrada uma vez); `producao_paredes_progresso` guarda o produzido, com uma linha por `(parede_id, unidade_id, servico, face)` — terminar uma parede num sobrado nunca afeta o saldo da mesma parede em outro sobrado (spec §3).
- **RLS é a aplicação real da permissão, nunca só a interface** (CLAUDE.md §3/§6). Toda tabela nova segue a regra de soft delete (`ativo = true OR pode_editar_medicoes()` na policy de SELECT) e a regra de isolamento por obra com função `SECURITY DEFINER` dedicada, nunca subquery inline contra tabela-pai (`docs/revisao-2026-07-17-rls-filhos-obra.md`).
- **Permissão:** cadastro de plantas/paredes e lançamento diário usam a mesma permissão já existente, `pode_editar_medicoes()` (confirmado por Rodrigo em 17/07/2026) — não criar módulo novo.
- **Sem `window.confirm`/`window.prompt` nativos** — a auditoria geral já identificou isso como inconsistente com a identidade visual (`docs/auditoria-geral-2026-07-17.md`); a escolha de face e o motivo de cancelamento usam um modal próprio, estilizado com as variáveis CSS do projeto (`--navy`, `--cinza-*`, etc., já usadas em `Producao.module.css`).
- **Preço por m² continua congelado por lançamento** e o rateio entre profissionais continua igual (função `producao_recalcular` existente) — esta entrega não muda essas regras, só a origem da área.

---

## Arquivos afetados

- Criar: `supabase/migrations/20260718_producao_plantas_paredes.sql`
- Criar: `supabase/migrations/20260718_producao_progresso_lancamento.sql`
- Modificar: `src/lib/supabase.ts` — novos tipos `ProducaoPlanta`, `ProducaoParede`, `ProducaoParedeProgresso`; `ProducaoLancamento` ganha `parede_id`, `face`, `cancelado_em`, `cancelado_por`, `motivo_cancelamento`, e `comprimento`/`altura` viram `number | null`.
- Modificar: `package.json` — adicionar `pdfjs-dist`.
- Criar: `src/lib/pdfParaImagem.ts`
- Criar: `src/components/PlantaClicavel.tsx`, `src/components/PlantaClicavel.module.css`
- Modificar: `src/pages/Producao.tsx` — nova aba "Plantas", e o componente `Lancamentos` passa a usar `PlantaClicavel` em vez dos campos de comprimento/altura/aberturas, mais o cancelamento.
- Modificar: `src/pages/Producao.module.css` — classes novas para o modal de face/cancelamento e o resumo de saldo.

---

### Task 1: Migração — catálogo de plantas e paredes

**Files:**
- Create: `supabase/migrations/20260718_producao_plantas_paredes.sql`

**Interfaces:**
- Consumes: `pode_acessar_obra(UUID)` (`supabase/migrations/20260717_isolamento_usuario_obra.sql:38`); `pode_editar_medicoes()` (`supabase/migrations/20260713_fase7_medicoes.sql:185`); `obras`, `perfis_usuario` já existentes.
- Produces: tabelas `producao_plantas`, `producao_paredes`; funções `pode_acessar_planta(UUID)`, `pode_acessar_parede(UUID)`; bucket `producao-plantas` — consumidos pela Task 2 e pelo frontend (Tasks 3-6).

- [ ] **Step 1: Criar a migração**

```sql
-- ============================================================
-- PRODUÇÃO PRÓPRIA — CATÁLOGO DE PLANTAS E PAREDES | RT Engenharia
-- ============================================================
-- Planta em PDF (convertida para imagem no upload) por pavimento da
-- planta "Sobrado Tipo", reaproveitada nos 13 sobrados. Paredes são
-- cadastradas uma vez (faixa clicável + metas de área); o progresso
-- por sobrado fica na Task 2 (producao_paredes_progresso).
-- Decisões do Rodrigo em 17/07/2026 — ver
-- docs/superpowers/specs/2026-07-17-producao-selecao-parede-pdf-design.md

CREATE TABLE producao_plantas (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  obra_id      UUID NOT NULL REFERENCES obras(id) ON DELETE CASCADE,
  pavimento    TEXT NOT NULL CHECK (pavimento IN ('terreo', 'superior', 'platibanda', 'caixa_agua')),
  pdf_path     TEXT NOT NULL,
  imagem_path  TEXT NOT NULL,
  ativo        BOOLEAN NOT NULL DEFAULT true,
  criado_por   UUID NOT NULL DEFAULT auth.uid() REFERENCES perfis_usuario(id),
  criado_em    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (obra_id, pavimento)
);

CREATE TABLE producao_paredes (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  planta_id         UUID NOT NULL REFERENCES producao_plantas(id) ON DELETE CASCADE,
  nome              TEXT NOT NULL CHECK (btrim(nome) <> ''),
  pos_x             NUMERIC(6,3) NOT NULL CHECK (pos_x >= 0 AND pos_x <= 100),
  pos_y             NUMERIC(6,3) NOT NULL CHECK (pos_y >= 0 AND pos_y <= 100),
  largura           NUMERIC(6,3) NOT NULL CHECK (largura > 0 AND largura <= 100),
  altura_px         NUMERIC(6,3) NOT NULL CHECK (altura_px > 0 AND altura_px <= 100),
  meta_alvenaria_m2 NUMERIC(10,4) CHECK (meta_alvenaria_m2 IS NULL OR meta_alvenaria_m2 > 0),
  meta_reboco_a_m2  NUMERIC(10,4) CHECK (meta_reboco_a_m2 IS NULL OR meta_reboco_a_m2 > 0),
  meta_reboco_b_m2  NUMERIC(10,4) CHECK (meta_reboco_b_m2 IS NULL OR meta_reboco_b_m2 > 0),
  ativo             BOOLEAN NOT NULL DEFAULT true,
  criado_por        UUID NOT NULL DEFAULT auth.uid() REFERENCES perfis_usuario(id),
  criado_em         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT pelo_menos_uma_meta CHECK (
    meta_alvenaria_m2 IS NOT NULL OR meta_reboco_a_m2 IS NOT NULL OR meta_reboco_b_m2 IS NOT NULL
  )
);
CREATE INDEX idx_prod_paredes_planta ON producao_paredes(planta_id) WHERE ativo;

-- ---------- Storage ----------
INSERT INTO storage.buckets (id, name, public) VALUES ('producao-plantas', 'producao-plantas', false)
ON CONFLICT (id) DO NOTHING;
UPDATE storage.buckets
SET file_size_limit = 26214400, allowed_mime_types = ARRAY['application/pdf', 'image/*']
WHERE id = 'producao-plantas';

-- ---------- RLS ----------
CREATE OR REPLACE FUNCTION pode_acessar_planta(p_planta UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM producao_plantas pl WHERE pl.id = p_planta AND pode_acessar_obra(pl.obra_id)
  )
$$;
REVOKE ALL ON FUNCTION pode_acessar_planta(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION pode_acessar_planta(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION pode_acessar_parede(p_parede UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM producao_paredes pp
    JOIN producao_plantas pl ON pl.id = pp.planta_id
    WHERE pp.id = p_parede AND pode_acessar_obra(pl.obra_id)
  )
$$;
REVOKE ALL ON FUNCTION pode_acessar_parede(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION pode_acessar_parede(UUID) TO authenticated;

ALTER TABLE producao_plantas ENABLE ROW LEVEL SECURITY;
ALTER TABLE producao_paredes ENABLE ROW LEVEL SECURITY;

CREATE POLICY prod_plantas_select ON producao_plantas FOR SELECT
  USING ((ativo AND meu_papel() IN ('admin','equipe')) OR pode_editar_medicoes());
CREATE POLICY prod_plantas_insert ON producao_plantas FOR INSERT
  WITH CHECK (pode_editar_medicoes() AND criado_por = auth.uid());
CREATE POLICY prod_plantas_update ON producao_plantas FOR UPDATE
  USING (pode_editar_medicoes()) WITH CHECK (pode_editar_medicoes());
CREATE POLICY isolamento_obra ON producao_plantas AS RESTRICTIVE FOR ALL TO authenticated
  USING (pode_acessar_obra(obra_id)) WITH CHECK (pode_acessar_obra(obra_id));

CREATE POLICY prod_paredes_select ON producao_paredes FOR SELECT
  USING ((ativo AND meu_papel() IN ('admin','equipe')) OR pode_editar_medicoes());
CREATE POLICY prod_paredes_insert ON producao_paredes FOR INSERT
  WITH CHECK (pode_editar_medicoes() AND criado_por = auth.uid());
CREATE POLICY prod_paredes_update ON producao_paredes FOR UPDATE
  USING (pode_editar_medicoes()) WITH CHECK (pode_editar_medicoes());
CREATE POLICY isolamento_obra ON producao_paredes AS RESTRICTIVE FOR ALL TO authenticated
  USING (pode_acessar_parede(id)) WITH CHECK (pode_acessar_parede(id));

CREATE POLICY prodplantas_storage_select ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'producao-plantas' AND pode_acessar_obra(split_part(name,'/',1)::UUID));
CREATE POLICY prodplantas_storage_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'producao-plantas' AND pode_editar_medicoes() AND pode_acessar_obra(split_part(name,'/',1)::UUID));
```

- [ ] **Step 2: Aplicar a migração e verificar**

Aplicar via MCP do Supabase (`apply_migration`) ou `supabase db push`, conforme o fluxo já usado nas migrações anteriores deste projeto. Confirmar com uma consulta:

```sql
SELECT table_name FROM information_schema.tables
WHERE table_name IN ('producao_plantas', 'producao_paredes');
-- Esperado: as duas linhas.
SELECT id FROM storage.buckets WHERE id = 'producao-plantas';
-- Esperado: 1 linha.
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260718_producao_plantas_paredes.sql
git commit -m "feat: catálogo de plantas e paredes da produção própria"
```

---

### Task 2: Migração — progresso, lançamento por parede e cancelamento

**Files:**
- Create: `supabase/migrations/20260718_producao_progresso_lancamento.sql`

**Interfaces:**
- Consumes: `producao_paredes` (Task 1); `producao_lancamentos`, `producao_participantes`, `producao_recalcular(UUID)`, `producao_inicializar_lancamento()`, `producao_preparar_lancamento()` (`supabase/migrations/20260716_fase7_producao_propria.sql:39-247`); `pode_editar_medicoes()`, `pode_acessar_obra(UUID)`.
- Produces: tabela `producao_paredes_progresso`; RPCs `producao_registrar_producao_parede(p_obra UUID, p_unidade UUID, p_data DATE, p_parede UUID, p_face TEXT, p_area_m2 NUMERIC, p_preco NUMERIC, p_observacao TEXT, p_trabalhadores UUID[])`, `producao_cancelar_lancamento(p_lancamento UUID, p_motivo TEXT)` e `producao_editar_meta_parede(p_parede UUID, p_meta_alvenaria NUMERIC, p_meta_reboco_a NUMERIC, p_meta_reboco_b NUMERIC)` — consumidos pelas Tasks 5 e 6.

- [ ] **Step 1: Criar a migração**

```sql
-- ============================================================
-- PRODUÇÃO PRÓPRIA — PROGRESSO POR PAREDE E CANCELAMENTO | RT Engenharia
-- ============================================================
-- Saldo de produção por (parede × sobrado × serviço/face) e o novo
-- caminho de lançamento que substitui comprimento/altura/aberturas
-- por uma área já resolvida no cadastro da parede (Task 1). O caminho
-- antigo (comprimento/altura livres) fica só para leitura do histórico
-- já lançado — a trava total impede novos lançamentos por ele.

CREATE TABLE producao_paredes_progresso (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parede_id    UUID NOT NULL REFERENCES producao_paredes(id),
  unidade_id   UUID NOT NULL REFERENCES unidades(id),
  servico      tipo_servico_producao NOT NULL,
  face         TEXT CHECK (face IN ('a', 'b') OR face IS NULL),
  produzido_m2 NUMERIC(10,4) NOT NULL DEFAULT 0 CHECK (produzido_m2 >= 0),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (parede_id, unidade_id, servico, face)
);

-- Alterações em producao_lancamentos: vínculo opcional a parede/face,
-- comprimento/altura viram opcionais (só o caminho antigo os usa),
-- e colunas de cancelamento.
ALTER TABLE producao_lancamentos
  ALTER COLUMN comprimento DROP NOT NULL,
  ALTER COLUMN altura DROP NOT NULL,
  ADD COLUMN parede_id UUID REFERENCES producao_paredes(id),
  ADD COLUMN face TEXT CHECK (face IN ('a', 'b') OR face IS NULL),
  ADD COLUMN cancelado_em TIMESTAMPTZ,
  ADD COLUMN cancelado_por UUID REFERENCES perfis_usuario(id),
  ADD COLUMN motivo_cancelamento TEXT,
  ADD CONSTRAINT parede_ou_legado CHECK (
    (parede_id IS NOT NULL AND comprimento IS NULL AND altura IS NULL)
    OR (parede_id IS NULL AND comprimento IS NOT NULL AND altura IS NOT NULL)
  );

-- A policy de SELECT existente já cobre ativo=true OR pode_editar_medicoes();
-- um lançamento cancelado continua com ativo=true (é histórico, não soft
-- delete) — só ganha cancelado_em preenchido. Nenhuma policy nova necessária.

-- ---------- Triggers existentes: aceitar o caminho por parede ----------
-- producao_inicializar_lancamento (BEFORE INSERT): no caminho antigo,
-- calcula área a partir de comprimento×altura; no caminho novo, a área
-- já vem pronta em NEW.area_liquida (setada pela RPC) e só precisa ser
-- espelhada em area_bruta e usada para o valor.
CREATE OR REPLACE FUNCTION producao_inicializar_lancamento() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM unidades u WHERE u.id=NEW.unidade_id AND u.obra_id=NEW.obra_id) THEN
    RAISE EXCEPTION 'Unidade não pertence à obra.';
  END IF;
  IF NEW.parede_id IS NOT NULL THEN
    IF NEW.area_liquida IS NULL OR NEW.area_liquida <= 0 THEN
      RAISE EXCEPTION 'A área produzida deve ser positiva.';
    END IF;
    NEW.area_bruta := NEW.area_liquida;
    NEW.area_aberturas := 0;
  ELSE
    NEW.area_bruta := ROUND(NEW.comprimento*NEW.altura,4);
    NEW.area_liquida := NEW.area_bruta;
  END IF;
  NEW.valor_total := ROUND(NEW.area_liquida*NEW.preco_m2,2);
  RETURN NEW;
END; $$;

-- producao_preparar_lancamento (BEFORE UPDATE): idem, mas só se aplica
-- de fato ao caminho antigo hoje (edição de lançamento por parede não
-- é exposta na UI nesta entrega — cancelar + relançar é o caminho).
CREATE OR REPLACE FUNCTION producao_preparar_lancamento() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM producao_medicao_lancamentos ml JOIN producao_participantes p ON p.id=ml.participante_id
             WHERE p.lancamento_id=OLD.id) THEN RAISE EXCEPTION 'Produção já incluída em medição não pode ser alterada.'; END IF;
  IF NEW.cancelado_em IS NOT NULL AND OLD.cancelado_em IS NULL THEN
    -- Cancelamento: não recalcula área/valor, só grava o cancelamento (feito pela RPC abaixo).
    RETURN NEW;
  END IF;
  IF NEW.parede_id IS NOT NULL THEN
    NEW.area_bruta := NEW.area_liquida;
    NEW.area_aberturas := 0;
  ELSE
    NEW.area_bruta:=ROUND(NEW.comprimento*NEW.altura,4);
    NEW.area_liquida:=ROUND(NEW.area_bruta-OLD.area_aberturas,4);
    IF NEW.area_liquida<=0 THEN RAISE EXCEPTION 'A área líquida deve ser positiva.'; END IF;
  END IF;
  NEW.valor_total:=ROUND(NEW.area_liquida*NEW.preco_m2,2);
  NEW.editado_por:=auth.uid(); NEW.editado_em:=now();
  RETURN NEW;
END; $$;

-- producao_recalcular (chamada ao inserir participantes): no caminho por
-- parede, a área já está fixada no lançamento — não recalcular a partir
-- de comprimento×altura (que são NULL), só redistribuir o rateio.
CREATE OR REPLACE FUNCTION producao_recalcular(p_lancamento UUID) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_bruta NUMERIC(14,4); v_aberturas NUMERIC(14,4); v_liquida NUMERIC(14,4);
        v_valor NUMERIC(14,2); v_parede UUID; v_n INTEGER; v_i INTEGER := 0; v_distribuido NUMERIC(14,2) := 0;
        v_part RECORD; v_parte NUMERIC(14,2);
BEGIN
  SELECT parede_id, area_liquida, preco_m2 INTO v_parede, v_liquida, v_valor
  FROM producao_lancamentos WHERE id=p_lancamento FOR UPDATE;
  IF v_parede IS NULL THEN
    SELECT ROUND(comprimento*altura,4) INTO v_bruta FROM producao_lancamentos WHERE id=p_lancamento;
    SELECT COALESCE(SUM(area),0) INTO v_aberturas FROM producao_aberturas
    WHERE lancamento_id=p_lancamento AND ativo;
    v_liquida := ROUND(v_bruta-v_aberturas,4);
    IF v_liquida <= 0 THEN RAISE EXCEPTION 'A área das aberturas deve ser menor que a área bruta.'; END IF;
    v_valor := ROUND(v_liquida*(SELECT preco_m2 FROM producao_lancamentos WHERE id=p_lancamento),2);
    UPDATE producao_lancamentos SET area_bruta=v_bruta, area_aberturas=v_aberturas,
      area_liquida=v_liquida, valor_total=v_valor WHERE id=p_lancamento;
  ELSE
    v_valor := ROUND(v_liquida*v_valor,2);
    UPDATE producao_lancamentos SET valor_total=v_valor WHERE id=p_lancamento;
  END IF;
  SELECT COUNT(*) INTO v_n FROM producao_participantes WHERE lancamento_id=p_lancamento AND ativo;
  IF v_n=0 THEN RETURN; END IF;
  FOR v_part IN SELECT id FROM producao_participantes WHERE lancamento_id=p_lancamento AND ativo ORDER BY trabalhador_id LOOP
    v_i := v_i+1;
    v_parte := CASE WHEN v_i=v_n THEN v_valor-v_distribuido ELSE ROUND(v_valor/v_n,2) END;
    UPDATE producao_participantes SET fracao=1.0/v_n,
      area_atribuida=ROUND(v_liquida/v_n,4), valor_atribuido=v_parte WHERE id=v_part.id;
    v_distribuido := v_distribuido+v_parte;
  END LOOP;
END; $$;

-- ---------- RPCs ----------
CREATE OR REPLACE FUNCTION producao_registrar_producao_parede(
  p_obra UUID, p_unidade UUID, p_data DATE, p_parede UUID, p_face TEXT,
  p_area_m2 NUMERIC, p_preco NUMERIC, p_observacao TEXT, p_trabalhadores UUID[]
) RETURNS UUID
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v_servico tipo_servico_producao;
  v_meta NUMERIC(10,4);
  v_progresso producao_paredes_progresso%ROWTYPE;
  v_lancamento_id UUID;
  v_trabalhador UUID;
BEGIN
  IF NOT pode_editar_medicoes() OR NOT pode_acessar_obra(p_obra) THEN
    RAISE EXCEPTION 'Sem permissão para lançar produção nesta obra.';
  END IF;
  IF NOT pode_acessar_parede(p_parede) THEN RAISE EXCEPTION 'Parede não encontrada.'; END IF;
  IF p_area_m2 IS NULL OR p_area_m2 <= 0 THEN RAISE EXCEPTION 'Informe a área produzida.'; END IF;
  IF p_trabalhadores IS NULL OR cardinality(p_trabalhadores) = 0 THEN
    RAISE EXCEPTION 'Selecione ao menos um profissional.';
  END IF;

  IF p_face IS NULL THEN
    v_servico := 'alvenaria';
    SELECT meta_alvenaria_m2 INTO v_meta FROM producao_paredes WHERE id = p_parede;
  ELSE
    v_servico := 'reboco';
    SELECT CASE p_face WHEN 'a' THEN meta_reboco_a_m2 ELSE meta_reboco_b_m2 END
      INTO v_meta FROM producao_paredes WHERE id = p_parede;
  END IF;
  IF v_meta IS NULL THEN RAISE EXCEPTION 'Esta parede não tem meta cadastrada para o serviço/face escolhido.'; END IF;

  INSERT INTO producao_paredes_progresso (parede_id, unidade_id, servico, face)
  VALUES (p_parede, p_unidade, v_servico, p_face)
  ON CONFLICT (parede_id, unidade_id, servico, face) DO NOTHING;

  SELECT * INTO v_progresso FROM producao_paredes_progresso
  WHERE parede_id = p_parede AND unidade_id = p_unidade AND servico = v_servico
    AND face IS NOT DISTINCT FROM p_face
  FOR UPDATE;

  IF v_progresso.produzido_m2 + p_area_m2 > v_meta THEN
    RAISE EXCEPTION 'Área ultrapassa o saldo restante da parede (faltam %.2f m²).', (v_meta - v_progresso.produzido_m2);
  END IF;

  INSERT INTO producao_lancamentos (
    obra_id, unidade_id, data_producao, servico, parede_nome, parede_id, face,
    area_liquida, preco_m2, observacao
  )
  SELECT p_obra, p_unidade, p_data, v_servico, pp.nome, p_parede, p_face,
         p_area_m2, p_preco, NULLIF(btrim(p_observacao), '')
  FROM producao_paredes pp WHERE pp.id = p_parede
  RETURNING id INTO v_lancamento_id;

  FOREACH v_trabalhador IN ARRAY p_trabalhadores LOOP
    INSERT INTO producao_participantes (lancamento_id, trabalhador_id) VALUES (v_lancamento_id, v_trabalhador);
  END LOOP;

  UPDATE producao_paredes_progresso SET produzido_m2 = produzido_m2 + p_area_m2, atualizado_em = now()
  WHERE id = v_progresso.id;

  RETURN v_lancamento_id;
END; $$;

CREATE OR REPLACE FUNCTION producao_cancelar_lancamento(p_lancamento UUID, p_motivo TEXT)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE v_lanc producao_lancamentos%ROWTYPE;
BEGIN
  SELECT * INTO v_lanc FROM producao_lancamentos WHERE id = p_lancamento AND ativo FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lançamento não encontrado.'; END IF;
  IF NOT pode_editar_medicoes() OR NOT pode_acessar_obra(v_lanc.obra_id) THEN
    RAISE EXCEPTION 'Sem permissão para cancelar este lançamento.';
  END IF;
  IF v_lanc.cancelado_em IS NOT NULL THEN RAISE EXCEPTION 'Lançamento já está cancelado.'; END IF;
  IF EXISTS (
    SELECT 1 FROM producao_medicao_lancamentos ml JOIN producao_participantes p ON p.id = ml.participante_id
    WHERE p.lancamento_id = p_lancamento
  ) THEN RAISE EXCEPTION 'Produção já incluída em medição não pode ser cancelada.'; END IF;
  IF NULLIF(btrim(p_motivo), '') IS NULL THEN RAISE EXCEPTION 'Informe o motivo do cancelamento.'; END IF;

  UPDATE producao_lancamentos
    SET cancelado_em = now(), cancelado_por = auth.uid(), motivo_cancelamento = btrim(p_motivo)
    WHERE id = p_lancamento;

  IF v_lanc.parede_id IS NOT NULL THEN
    UPDATE producao_paredes_progresso
      SET produzido_m2 = GREATEST(0, produzido_m2 - v_lanc.area_liquida), atualizado_em = now()
      WHERE parede_id = v_lanc.parede_id AND unidade_id = v_lanc.unidade_id
        AND servico = v_lanc.servico AND face IS NOT DISTINCT FROM v_lanc.face;
  END IF;
END; $$;

-- Editar meta de uma parede já cadastrada: bloqueado se o novo valor for
-- menor que o já produzido em QUALQUER sobrado (spec §3/§6 — nunca deixar
-- saldo negativo). Corrige a posição da faixa não é possível por aqui —
-- fora de escopo desta entrega (spec §7): inativar e recadastrar.
CREATE OR REPLACE FUNCTION producao_editar_meta_parede(
  p_parede UUID, p_meta_alvenaria NUMERIC, p_meta_reboco_a NUMERIC, p_meta_reboco_b NUMERIC
) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE v_produzido_alv NUMERIC; v_produzido_a NUMERIC; v_produzido_b NUMERIC;
BEGIN
  IF NOT pode_acessar_parede(p_parede) OR NOT pode_editar_medicoes() THEN
    RAISE EXCEPTION 'Sem permissão para editar esta parede.';
  END IF;
  IF p_meta_alvenaria IS NULL AND p_meta_reboco_a IS NULL AND p_meta_reboco_b IS NULL THEN
    RAISE EXCEPTION 'Informe ao menos uma meta.';
  END IF;
  SELECT COALESCE(MAX(produzido_m2) FILTER (WHERE servico='alvenaria'), 0),
         COALESCE(MAX(produzido_m2) FILTER (WHERE servico='reboco' AND face='a'), 0),
         COALESCE(MAX(produzido_m2) FILTER (WHERE servico='reboco' AND face='b'), 0)
    INTO v_produzido_alv, v_produzido_a, v_produzido_b
  FROM producao_paredes_progresso WHERE parede_id = p_parede;
  IF p_meta_alvenaria IS NOT NULL AND p_meta_alvenaria < v_produzido_alv THEN
    RAISE EXCEPTION 'Já foram produzidos %.2f m² de alvenaria — a meta não pode ficar menor que isso.', v_produzido_alv;
  END IF;
  IF p_meta_reboco_a IS NOT NULL AND p_meta_reboco_a < v_produzido_a THEN
    RAISE EXCEPTION 'Já foram produzidos %.2f m² de reboco (face A) — a meta não pode ficar menor que isso.', v_produzido_a;
  END IF;
  IF p_meta_reboco_b IS NOT NULL AND p_meta_reboco_b < v_produzido_b THEN
    RAISE EXCEPTION 'Já foram produzidos %.2f m² de reboco (face B) — a meta não pode ficar menor que isso.', v_produzido_b;
  END IF;
  UPDATE producao_paredes SET
    meta_alvenaria_m2 = p_meta_alvenaria, meta_reboco_a_m2 = p_meta_reboco_a, meta_reboco_b_m2 = p_meta_reboco_b
  WHERE id = p_parede;
END; $$;

REVOKE ALL ON FUNCTION producao_registrar_producao_parede(UUID,UUID,DATE,UUID,TEXT,NUMERIC,NUMERIC,TEXT,UUID[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION producao_cancelar_lancamento(UUID,TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION producao_editar_meta_parede(UUID,NUMERIC,NUMERIC,NUMERIC) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION producao_registrar_producao_parede(UUID,UUID,DATE,UUID,TEXT,NUMERIC,NUMERIC,TEXT,UUID[]) TO authenticated;
GRANT EXECUTE ON FUNCTION producao_cancelar_lancamento(UUID,TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION producao_editar_meta_parede(UUID,NUMERIC,NUMERIC,NUMERIC) TO authenticated;

-- RLS de producao_paredes_progresso: mesma permissão, isolamento via parede.
ALTER TABLE producao_paredes_progresso ENABLE ROW LEVEL SECURITY;
CREATE POLICY prod_progresso_select ON producao_paredes_progresso FOR SELECT
  USING (pode_editar_medicoes());
CREATE POLICY isolamento_obra ON producao_paredes_progresso AS RESTRICTIVE FOR ALL TO authenticated
  USING (pode_acessar_parede(parede_id)) WITH CHECK (pode_acessar_parede(parede_id));
```

- [ ] **Step 2: Aplicar a migração e verificar**

```sql
SELECT proname FROM pg_proc WHERE proname IN ('producao_registrar_producao_parede', 'producao_cancelar_lancamento');
-- Esperado: as duas linhas.
SELECT column_name FROM information_schema.columns
WHERE table_name = 'producao_lancamentos' AND column_name IN ('parede_id', 'face', 'cancelado_em');
-- Esperado: as três linhas.
```

Rodar manualmente um teste transacional (com `ROLLBACK` antes de aplicar de verdade, mesmo padrão já usado na revisão de RLS de 13/07/2026): inserir uma parede fictícia com `meta_alvenaria_m2 = 10`, chamar `producao_registrar_producao_parede` com `p_area_m2 = 5`, chamar de novo com `p_area_m2 = 6` — a segunda chamada deve falhar com "Área ultrapassa o saldo restante".

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260718_producao_progresso_lancamento.sql
git commit -m "feat: saldo de produção por parede/sobrado e cancelamento de lançamento"
```

---

### Task 3: Tipos TypeScript + conversão de PDF para imagem

**Files:**
- Modify: `src/lib/supabase.ts`
- Modify: `package.json`
- Create: `src/lib/pdfParaImagem.ts`

**Interfaces:**
- Consumes: nenhuma (utilitário isolado).
- Produces: `converterPdfParaImagem(arquivo: File): Promise<Blob>` — consumida pela Task 5. Tipos `ProducaoPlanta`, `ProducaoParede`, `ProducaoParedeProgresso` — consumidos pelas Tasks 4-6.

- [ ] **Step 1: Instalar a dependência**

```bash
npm install pdfjs-dist
```

- [ ] **Step 2: Adicionar os tipos em `src/lib/supabase.ts`**

Localizar o bloco de tipos de Produção própria (em torno da linha 192, `export interface ProducaoLancamento`) e aplicar:

```typescript
export type Pavimento = 'terreo' | 'superior' | 'platibanda' | 'caixa_agua'
export type FaceParede = 'a' | 'b'

export interface ProducaoPlanta {
  id: string; obra_id: string; pavimento: Pavimento
  pdf_path: string; imagem_path: string; ativo: boolean
  criado_por: string; criado_em: string
}
export interface ProducaoParede {
  id: string; planta_id: string; nome: string
  pos_x: number; pos_y: number; largura: number; altura_px: number
  meta_alvenaria_m2: number | null; meta_reboco_a_m2: number | null; meta_reboco_b_m2: number | null
  ativo: boolean; criado_por: string; criado_em: string
}
export interface ProducaoParedeProgresso {
  id: string; parede_id: string; unidade_id: string
  servico: TipoServicoProducao; face: FaceParede | null
  produzido_m2: number; atualizado_em: string
}
export interface ProducaoLancamento {
  id: string; obra_id: string; unidade_id: string; data_producao: string
  servico: TipoServicoProducao; parede_nome: string
  parede_id: string | null; face: FaceParede | null
  comprimento: number | null; altura: number | null
  area_bruta: number; area_aberturas: number; area_liquida: number; preco_m2: number
  valor_total: number; observacao: string | null; ativo: boolean; criado_por: string; criado_em: string
  cancelado_em: string | null; cancelado_por: string | null; motivo_cancelamento: string | null
}
```

Isso substitui a definição existente de `ProducaoLancamento` (linhas 192-197 do arquivo antes desta mudança).

- [ ] **Step 3: Criar `src/lib/pdfParaImagem.ts`**

```typescript
import * as pdfjsLib from 'pdfjs-dist'
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker

export async function converterPdfParaImagem(arquivo: File): Promise<Blob> {
  const buffer = await arquivo.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise
  const pagina = await pdf.getPage(1)
  const viewport = pagina.getViewport({ scale: 2 })
  const canvas = document.createElement('canvas')
  canvas.width = viewport.width
  canvas.height = viewport.height
  const contexto = canvas.getContext('2d')
  if (!contexto) throw new Error('Não foi possível preparar a conversão do PDF.')
  await pagina.render({ canvasContext: contexto, viewport, canvas }).promise
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob) resolve(blob)
      else reject(new Error('Falha ao gerar a imagem da planta.'))
    }, 'image/png')
  })
}
```

- [ ] **Step 4: Verificar**

```bash
npm run build
```
Esperado: compila limpo (o utilitário ainda não é usado em nenhuma tela).

- [ ] **Step 5: Commit**

```bash
git add src/lib/supabase.ts src/lib/pdfParaImagem.ts package.json package-lock.json
git commit -m "feat: tipos e conversão de PDF para imagem da produção própria"
```

---

### Task 4: Componente `PlantaClicavel` (desenhar e selecionar)

**Files:**
- Create: `src/components/PlantaClicavel.tsx`
- Create: `src/components/PlantaClicavel.module.css`

**Interfaces:**
- Consumes: tipo `ProducaoParede` (Task 3).
- Produces: componente `<PlantaClicavel imagemUrl unidadeSelecionada={null} modo="desenhar" paredes onDesenhar={(zona) => void} onSelecionar={(parede) => void} progressoPorParede={Map<string, {alvenaria, rebocoA, rebocoB}>} />` — consumido pelas Tasks 5 e 6.

- [ ] **Step 1: Criar `PlantaClicavel.module.css`**

```css
.container{position:relative;width:100%;max-width:900px;margin:0 auto;border:1.5px solid var(--cinza-200);border-radius:var(--radius-md);overflow:hidden;touch-action:none;user-select:none}
.imagem{display:block;width:100%;height:auto}
.faixa{position:absolute;background:rgba(196,154,122,0.45);border:2px solid var(--terracota, #C49A7A);border-radius:4px;cursor:pointer}
.faixaConcluida{background:rgba(58,124,165,0.25);border-color:var(--azul-medio, #3A7CA5)}
.rotulo{position:absolute;top:-22px;left:0;font-size:11px;font-weight:700;color:var(--navy);background:var(--branco);padding:1px 5px;border-radius:4px;white-space:nowrap}
.arrastando{position:absolute;background:rgba(26,50,72,0.25);border:2px dashed var(--navy);border-radius:4px;pointer-events:none}
```

- [ ] **Step 2: Criar `PlantaClicavel.tsx`**

```tsx
import { useRef, useState } from 'react'
import type { ProducaoParede } from '../lib/supabase'
import styles from './PlantaClicavel.module.css'

export type ZonaDesenhada = { pos_x: number; pos_y: number; largura: number; altura_px: number }
export type SaldoParede = { alvenaria: number | null; rebocoA: number | null; rebocoB: number | null }

type Props = {
  imagemUrl: string
  paredes: ProducaoParede[]
  modo: 'desenhar' | 'selecionar'
  onDesenhar?: (zona: ZonaDesenhada) => void
  onSelecionar?: (parede: ProducaoParede) => void
  saldoPorParede?: Map<string, SaldoParede>
}

export default function PlantaClicavel({
  imagemUrl, paredes, modo, onDesenhar, onSelecionar, saldoPorParede,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [inicio, setInicio] = useState<{ x: number; y: number } | null>(null)
  const [atual, setAtual] = useState<{ x: number; y: number } | null>(null)

  function posicaoPercentual(evento: React.PointerEvent): { x: number; y: number } {
    const retangulo = containerRef.current!.getBoundingClientRect()
    return {
      x: ((evento.clientX - retangulo.left) / retangulo.width) * 100,
      y: ((evento.clientY - retangulo.top) / retangulo.height) * 100,
    }
  }

  function aoPressionar(evento: React.PointerEvent) {
    if (modo !== 'desenhar') return
    const ponto = posicaoPercentual(evento)
    setInicio(ponto)
    setAtual(ponto)
  }
  function aoMover(evento: React.PointerEvent) {
    if (modo !== 'desenhar' || !inicio) return
    setAtual(posicaoPercentual(evento))
  }
  function aoSoltar() {
    if (modo !== 'desenhar' || !inicio || !atual || !onDesenhar) { setInicio(null); setAtual(null); return }
    const zona: ZonaDesenhada = {
      pos_x: Math.min(inicio.x, atual.x),
      pos_y: Math.min(inicio.y, atual.y),
      largura: Math.abs(atual.x - inicio.x),
      altura_px: Math.abs(atual.y - inicio.y),
    }
    setInicio(null); setAtual(null)
    if (zona.largura > 0.5 && zona.altura_px > 0.5) onDesenhar(zona)
  }

  const zonaAtual = inicio && atual ? {
    left: `${Math.min(inicio.x, atual.x)}%`, top: `${Math.min(inicio.y, atual.y)}%`,
    width: `${Math.abs(atual.x - inicio.x)}%`, height: `${Math.abs(atual.y - inicio.y)}%`,
  } : null

  return (
    <div
      ref={containerRef}
      className={styles.container}
      onPointerDown={aoPressionar}
      onPointerMove={aoMover}
      onPointerUp={aoSoltar}
    >
      <img src={imagemUrl} alt="Planta" className={styles.imagem} draggable={false} />
      {paredes.map(parede => {
        const saldo = saldoPorParede?.get(parede.id)
        const concluida = saldo != null &&
          (parede.meta_alvenaria_m2 == null || saldo.alvenaria !== null && saldo.alvenaria <= 0) &&
          (parede.meta_reboco_a_m2 == null || saldo.rebocoA !== null && saldo.rebocoA <= 0) &&
          (parede.meta_reboco_b_m2 == null || saldo.rebocoB !== null && saldo.rebocoB <= 0)
        return (
          <div
            key={parede.id}
            className={`${styles.faixa} ${concluida ? styles.faixaConcluida : ''}`}
            style={{
              left: `${parede.pos_x}%`, top: `${parede.pos_y}%`,
              width: `${parede.largura}%`, height: `${parede.altura_px}%`,
            }}
            onClick={() => modo === 'selecionar' && onSelecionar?.(parede)}
          >
            <span className={styles.rotulo}>{parede.nome}</span>
          </div>
        )
      })}
      {zonaAtual && <div className={styles.arrastando} style={zonaAtual} />}
    </div>
  )
}
```

- [ ] **Step 3: Verificar**

```bash
npm run build
```
Esperado: compila limpo (componente ainda não é importado em nenhuma tela).

- [ ] **Step 4: Commit**

```bash
git add src/components/PlantaClicavel.tsx src/components/PlantaClicavel.module.css
git commit -m "feat: componente de planta clicável (desenhar e selecionar parede)"
```

---

### Task 5: Aba "Plantas" — cadastro de plantas e paredes

**Files:**
- Modify: `src/pages/Producao.tsx`
- Modify: `src/pages/Producao.module.css`

**Interfaces:**
- Consumes: `PlantaClicavel` (Task 4), `converterPdfParaImagem` (Task 3), tipos `ProducaoPlanta`/`ProducaoParede` (Task 3), RPC `producao_editar_meta_parede` (Task 2).
- Produces: aba "Plantas" navegável e a constante `PAVIMENTOS` (módulo-level em `Producao.tsx`) — Task 6 depende dos dados que esta task cria (paredes cadastradas) e reaproveita `PAVIMENTOS`.

- [ ] **Step 1: Adicionar classes CSS do modal de metas**

Adicionar ao final de `src/pages/Producao.module.css` (mesma linha única do arquivo, seguindo o padrão já usado):

```css
.modalFundo{position:fixed;inset:0;background:rgba(26,50,72,0.5);display:flex;align-items:center;justify-content:center;z-index:50;padding:16px}.modalCaixa{background:var(--branco);border-radius:var(--radius-md);padding:20px;max-width:420px;width:100%;display:flex;flex-direction:column;gap:12px}.modalCaixa h3{margin:0;color:var(--navy);font-size:16px}.saldoLinha{display:flex;justify-content:space-between;font-size:13px;color:var(--cinza-600)}
```

- [ ] **Step 2: Ampliar o tipo `Aba` e adicionar a aba "Plantas"**

Em `src/pages/Producao.tsx`, modificar a linha `type Aba = "lancamentos" | "dias" | "salarios";` (linha 16) para:

```typescript
type Aba = "lancamentos" | "plantas" | "dias" | "salarios";
```

Modificar o objeto `rotulo` (linha 70-74):

```typescript
const rotulo: Record<Aba, string> = {
  lancamentos: "Lançamentos diários",
  plantas: "Plantas",
  dias: "Dias salariais",
  salarios: "Salários",
};
```

Adicionar a renderização condicional, junto às demais (linha 96-100):

```tsx
{aba === "lancamentos" && (
  <Lancamentos trabalhadores={trabalhadores} unidades={unidades} />
)}{" "}
{aba === "plantas" && <Plantas />}{" "}
{aba === "dias" && <Dias trabalhadores={trabalhadores} />}{" "}
{aba === "salarios" && <Salarios trabalhadores={trabalhadores} />}
```

- [ ] **Step 3: Criar o componente `Plantas`**

Adicionar ao final de `src/pages/Producao.tsx`, antes da função `Campo`:

```tsx
const PAVIMENTOS: { valor: Pavimento; rotulo: string }[] = [
  { valor: "terreo", rotulo: "Térreo" },
  { valor: "superior", rotulo: "Superior" },
  { valor: "platibanda", rotulo: "Platibanda" },
  { valor: "caixa_agua", rotulo: "Caixa d'água" },
];

function Plantas() {
  const { obraAtiva } = useObra();
  const [plantas, setPlantas] = useState<ProducaoPlanta[]>([]),
    [paredes, setParedes] = useState<ProducaoParede[]>([]),
    [pavimentoSel, setPavimentoSel] = useState<Pavimento>("terreo"),
    [enviandoPdf, setEnviandoPdf] = useState(false),
    [msg, setMsg] = useState<Msg>(null),
    [zonaPendente, setZonaPendente] = useState<ZonaDesenhada | null>(null),
    [formParede, setFormParede] = useState({
      nome: "", metaAlvenaria: "", metaRebocoA: "", metaRebocoB: "",
    }),
    [editandoParede, setEditandoParede] = useState<ProducaoParede | null>(null),
    [formEdicao, setFormEdicao] = useState({ metaAlvenaria: "", metaRebocoA: "", metaRebocoB: "" }),
    [urlImagem, setUrlImagem] = useState<string | null>(null);

  const plantaAtual = plantas.find((p) => p.pavimento === pavimentoSel) ?? null;
  const paredesDaPlanta = paredes.filter((p) => p.planta_id === plantaAtual?.id);

  async function carregar() {
    if (!obraAtiva) return;
    const [pl, pa] = await Promise.all([
      supabase.from("producao_plantas").select("*").eq("obra_id", obraAtiva.id).eq("ativo", true),
      supabase.from("producao_paredes").select("*").eq("ativo", true),
    ]);
    setPlantas(pl.data ?? []);
    setParedes(pa.data ?? []);
  }
  useEffect(() => { carregar(); }, [obraAtiva]);

  useEffect(() => {
    let cancelado = false;
    async function carregarUrl() {
      if (!plantaAtual) { setUrlImagem(null); return; }
      const { data } = await supabase.storage.from("producao-plantas").createSignedUrl(plantaAtual.imagem_path, 3600);
      if (!cancelado) setUrlImagem(data?.signedUrl ?? null);
    }
    carregarUrl();
    return () => { cancelado = true; };
  }, [plantaAtual]);

  async function enviarPdf(arquivo: File) {
    if (!obraAtiva) return;
    setEnviandoPdf(true);
    setMsg(null);
    try {
      const imagemBlob = await converterPdfParaImagem(arquivo);
      const pasta = `${obraAtiva.id}/${pavimentoSel}`;
      const pdfPath = `${pasta}/planta-${crypto.randomUUID()}.pdf`;
      const imagemPath = `${pasta}/planta-${crypto.randomUUID()}.png`;
      const [upPdf, upImg] = await Promise.all([
        supabase.storage.from("producao-plantas").upload(pdfPath, arquivo),
        supabase.storage.from("producao-plantas").upload(imagemPath, imagemBlob),
      ]);
      if (upPdf.error || upImg.error) {
        throw new Error(upPdf.error?.message ?? upImg.error?.message);
      }
      const { error } = await supabase.from("producao_plantas").upsert(
        { obra_id: obraAtiva.id, pavimento: pavimentoSel, pdf_path: pdfPath, imagem_path: imagemPath },
        { onConflict: "obra_id,pavimento" },
      );
      if (error) throw new Error(error.message);
      setMsg({ tipo: "ok", texto: "Planta enviada." });
      await carregar();
    } catch (erro) {
      setMsg({ tipo: "erro", texto: `Falha ao enviar a planta: ${(erro as Error).message}` });
    }
    setEnviandoPdf(false);
  }

  async function salvarParede() {
    if (!plantaAtual || !zonaPendente || !formParede.nome.trim()) return;
    const metaAlv = numero(formParede.metaAlvenaria) || null,
      metaA = numero(formParede.metaRebocoA) || null,
      metaB = numero(formParede.metaRebocoB) || null;
    if (!metaAlv && !metaA && !metaB) {
      setMsg({ tipo: "erro", texto: "Informe ao menos uma meta (alvenaria ou reboco)." });
      return;
    }
    const { error } = await supabase.from("producao_paredes").insert({
      planta_id: plantaAtual.id,
      nome: formParede.nome.trim(),
      pos_x: zonaPendente.pos_x, pos_y: zonaPendente.pos_y,
      largura: zonaPendente.largura, altura_px: zonaPendente.altura_px,
      meta_alvenaria_m2: metaAlv, meta_reboco_a_m2: metaA, meta_reboco_b_m2: metaB,
    });
    if (error) { setMsg({ tipo: "erro", texto: error.message }); return; }
    setZonaPendente(null);
    setFormParede({ nome: "", metaAlvenaria: "", metaRebocoA: "", metaRebocoB: "" });
    await carregar();
  }

  function abrirEdicao(parede: ProducaoParede) {
    setEditandoParede(parede);
    setFormEdicao({
      metaAlvenaria: parede.meta_alvenaria_m2?.toString().replace(".", ",") ?? "",
      metaRebocoA: parede.meta_reboco_a_m2?.toString().replace(".", ",") ?? "",
      metaRebocoB: parede.meta_reboco_b_m2?.toString().replace(".", ",") ?? "",
    });
  }

  async function salvarEdicaoMeta() {
    if (!editandoParede) return;
    const { error } = await supabase.rpc("producao_editar_meta_parede", {
      p_parede: editandoParede.id,
      p_meta_alvenaria: numero(formEdicao.metaAlvenaria) || null,
      p_meta_reboco_a: numero(formEdicao.metaRebocoA) || null,
      p_meta_reboco_b: numero(formEdicao.metaRebocoB) || null,
    });
    if (error) { setMsg({ tipo: "erro", texto: error.message }); return; }
    setEditandoParede(null);
    await carregar();
  }

  return (
    <>
      <section className={styles.bloco}>
        <h2>Planta do pavimento</h2>
        <div className={styles.campos}>
          <Campo label="Pavimento">
            <select className={styles.select} value={pavimentoSel} onChange={(e) => setPavimentoSel(e.target.value as Pavimento)}>
              {PAVIMENTOS.map((p) => <option key={p.valor} value={p.valor}>{p.rotulo}</option>)}
            </select>
          </Campo>
        </div>
        {!plantaAtual && (
          <div className={styles.acoes}>
            <input type="file" accept="application/pdf" disabled={enviandoPdf}
              onChange={(e) => e.target.files?.[0] && enviarPdf(e.target.files[0])} />
          </div>
        )}
        <Mensagem msg={msg} />
        {urlImagem && (
          <>
            <p className={styles.sub}>Clique e arraste sobre uma parede para cadastrar a faixa clicável.</p>
            <PlantaClicavel
              imagemUrl={urlImagem}
              paredes={paredesDaPlanta}
              modo="desenhar"
              onDesenhar={setZonaPendente}
            />
            <div className={styles.lista}>
              {paredesDaPlanta.map((p) => (
                <div className={styles.linha} key={p.id}>
                  <strong>{p.nome}</strong>
                  <div className={styles.meta}>
                    {p.meta_alvenaria_m2 != null && `Alvenaria: ${p.meta_alvenaria_m2.toFixed(2)} m²`}
                    {p.meta_reboco_a_m2 != null && ` · Reboco A: ${p.meta_reboco_a_m2.toFixed(2)} m²`}
                    {p.meta_reboco_b_m2 != null && ` · Reboco B: ${p.meta_reboco_b_m2.toFixed(2)} m²`}
                  </div>
                  <button className={styles.btnSec} onClick={() => abrirEdicao(p)}>Editar metas</button>
                </div>
              ))}
            </div>
          </>
        )}
      </section>
      {editandoParede && (
        <div className={styles.modalFundo} onClick={() => setEditandoParede(null)}>
          <div className={styles.modalCaixa} onClick={(e) => e.stopPropagation()}>
            <h3>Editar metas — {editandoParede.nome}</h3>
            <Campo label="Meta de alvenaria (m²)">
              <input className={styles.input} inputMode="decimal" value={formEdicao.metaAlvenaria}
                onChange={(e) => setFormEdicao({ ...formEdicao, metaAlvenaria: e.target.value })} />
            </Campo>
            <Campo label="Meta de reboco — face A (m²)">
              <input className={styles.input} inputMode="decimal" value={formEdicao.metaRebocoA}
                onChange={(e) => setFormEdicao({ ...formEdicao, metaRebocoA: e.target.value })} />
            </Campo>
            <Campo label="Meta de reboco — face B (m²)">
              <input className={styles.input} inputMode="decimal" value={formEdicao.metaRebocoB}
                onChange={(e) => setFormEdicao({ ...formEdicao, metaRebocoB: e.target.value })} />
            </Campo>
            <div className={styles.acoes}>
              <button className={styles.btn} onClick={salvarEdicaoMeta}>Salvar</button>
              <button className={styles.btnSec} onClick={() => setEditandoParede(null)}>Cancelar</button>
            </div>
          </div>
        </div>
      )}
      {zonaPendente && (
        <div className={styles.modalFundo} onClick={() => setZonaPendente(null)}>
          <div className={styles.modalCaixa} onClick={(e) => e.stopPropagation()}>
            <h3>Nova parede</h3>
            <Campo label="Nome">
              <input className={styles.input} value={formParede.nome}
                onChange={(e) => setFormParede({ ...formParede, nome: e.target.value })} />
            </Campo>
            <Campo label="Meta de alvenaria (m²)">
              <input className={styles.input} inputMode="decimal" value={formParede.metaAlvenaria}
                onChange={(e) => setFormParede({ ...formParede, metaAlvenaria: e.target.value })} />
            </Campo>
            <Campo label="Meta de reboco — face A (m²)">
              <input className={styles.input} inputMode="decimal" value={formParede.metaRebocoA}
                onChange={(e) => setFormParede({ ...formParede, metaRebocoA: e.target.value })} />
            </Campo>
            <Campo label="Meta de reboco — face B (m²)">
              <input className={styles.input} inputMode="decimal" value={formParede.metaRebocoB}
                onChange={(e) => setFormParede({ ...formParede, metaRebocoB: e.target.value })} />
            </Campo>
            <div className={styles.acoes}>
              <button className={styles.btn} onClick={salvarParede}>Salvar parede</button>
              <button className={styles.btnSec} onClick={() => setZonaPendente(null)}>Cancelar</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 4: Adicionar os imports necessários**

No topo de `src/pages/Producao.tsx`, ampliar os imports existentes:

```typescript
import {
  supabase,
  type ProducaoDiaSalarial,
  type ProducaoLancamento,
  type ProducaoSalario,
  type ProducaoPlanta,
  type ProducaoParede,
  type Pavimento,
  type Trabalhador,
  type Unidade,
} from "../lib/supabase";
import { converterPdfParaImagem } from "../lib/pdfParaImagem";
import PlantaClicavel, { type ZonaDesenhada } from "../components/PlantaClicavel";
```

- [ ] **Step 5: Verificar**

```bash
npm run build
```
No navegador, logado com o módulo de produção: acessar Produção própria → aba "Plantas" → selecionar "Térreo" → enviar um PDF de teste → confirmar que a imagem aparece → arrastar sobre uma região → preencher nome e meta de alvenaria → salvar → confirmar que a faixa aparece na planta e a parede aparece na lista abaixo → clicar "Editar metas", aumentar o valor e salvar → confirmar que atualiza.

- [ ] **Step 6: Commit**

```bash
git add src/pages/Producao.tsx src/pages/Producao.module.css
git commit -m "feat: cadastro de plantas e paredes na aba Plantas"
```

---

### Task 6: Lançamento diário por parede + cancelamento

**Files:**
- Modify: `src/pages/Producao.tsx`

**Interfaces:**
- Consumes: `PlantaClicavel` (Task 4), RPCs `producao_registrar_producao_parede` / `producao_cancelar_lancamento` (Task 2), tipo `ProducaoParedeProgresso` (Task 3), constante `PAVIMENTOS` (Task 5, já no escopo do módulo de `Producao.tsx`).

- [ ] **Step 1: Substituir o formulário de lançamento na função `Lancamentos`**

Em `src/pages/Producao.tsx`, dentro da função `Lancamentos` (a partir da linha 232), substituir os estados de `form`/`aberturas` e a função `salvar` inteira:

```tsx
function Lancamentos({
  trabalhadores,
  unidades,
}: {
  trabalhadores: Trabalhador[];
  unidades: Unidade[];
}) {
  const { obraAtiva } = useObra();
  const [lista, setLista] = useState<ProducaoLancamento[]>([]),
    [msg, setMsg] = useState<Msg>(null),
    [salvando, setSalvando] = useState(false);
  const [form, setForm] = useState({
      data: hojeISO(), unidade: "", servico: "alvenaria" as TipoServicoProducao,
      pavimento: "terreo" as Pavimento, preco: "", obs: "", area: "",
    }),
    [selecionados, setSelecionados] = useState<string[]>([""]),
    [plantas, setPlantas] = useState<ProducaoPlanta[]>([]),
    [paredes, setParedes] = useState<ProducaoParede[]>([]),
    [progresso, setProgresso] = useState<ProducaoParedeProgresso[]>([]),
    [urlImagem, setUrlImagem] = useState<string | null>(null),
    [paredeSelecionada, setParedeSelecionada] = useState<ProducaoParede | null>(null),
    [faceEscolha, setFaceEscolha] = useState<FaceParede | null>(null),
    [cancelandoId, setCancelandoId] = useState<string | null>(null),
    [motivoCancelamento, setMotivoCancelamento] = useState("");

  async function carregar() {
    if (!obraAtiva) return;
    const [l, pl, pa] = await Promise.all([
      supabase.from("producao_lancamentos").select("*").eq("obra_id", obraAtiva.id)
        .eq("ativo", true).order("data_producao", { ascending: false }),
      supabase.from("producao_plantas").select("*").eq("obra_id", obraAtiva.id).eq("ativo", true),
      supabase.from("producao_paredes").select("*").eq("ativo", true),
    ]);
    setLista(l.data ?? []);
    setPlantas(pl.data ?? []);
    setParedes(pa.data ?? []);
  }
  useEffect(() => { carregar(); }, [obraAtiva]);

  useEffect(() => {
    if (!form.unidade) { setProgresso([]); return; }
    supabase.from("producao_paredes_progresso").select("*").eq("unidade_id", form.unidade)
      .then(({ data }) => setProgresso(data ?? []));
  }, [form.unidade]);

  const plantaAtual = plantas.find((p) => p.pavimento === form.pavimento) ?? null;
  const paredesDaPlanta = paredes.filter((p) => p.planta_id === plantaAtual?.id);

  useEffect(() => {
    let cancelado = false;
    async function carregarUrl() {
      if (!plantaAtual) { setUrlImagem(null); return; }
      const { data } = await supabase.storage.from("producao-plantas").createSignedUrl(plantaAtual.imagem_path, 3600);
      if (!cancelado) setUrlImagem(data?.signedUrl ?? null);
    }
    carregarUrl();
    return () => { cancelado = true; };
  }, [plantaAtual]);

  function saldoDaParede(parede: ProducaoParede) {
    const buscar = (servico: TipoServicoProducao, face: FaceParede | null) =>
      progresso.find((p) => p.parede_id === parede.id && p.servico === servico && p.face === face)?.produzido_m2 ?? 0;
    return {
      alvenaria: parede.meta_alvenaria_m2 != null ? parede.meta_alvenaria_m2 - buscar("alvenaria", null) : null,
      rebocoA: parede.meta_reboco_a_m2 != null ? parede.meta_reboco_a_m2 - buscar("reboco", "a") : null,
      rebocoB: parede.meta_reboco_b_m2 != null ? parede.meta_reboco_b_m2 - buscar("reboco", "b") : null,
    };
  }

  function aoSelecionarParede(parede: ProducaoParede) {
    if (form.servico === "reboco") { setParedeSelecionada(parede); setFaceEscolha(null); }
    else { setParedeSelecionada(parede); setFaceEscolha(null); }
  }

  const saldoRestante = paredeSelecionada
    ? form.servico === "alvenaria"
      ? saldoDaParede(paredeSelecionada).alvenaria
      : faceEscolha === "a" ? saldoDaParede(paredeSelecionada).rebocoA
      : faceEscolha === "b" ? saldoDaParede(paredeSelecionada).rebocoB
      : null
    : null;

  const participantes = selecionados.filter(Boolean);
  const areaNum = numero(form.area) || 0;
  const total = areaNum * (numero(form.preco) || 0);

  async function salvar() {
    if (!obraAtiva || !form.unidade || !paredeSelecionada || (form.servico === "reboco" && !faceEscolha)
      || areaNum <= 0 || numero(form.preco) <= 0 || !participantes.length) {
      setMsg({ tipo: "erro", texto: "Selecione unidade, parede, área, preço e profissionais." });
      return;
    }
    if (saldoRestante != null && areaNum > saldoRestante) {
      setMsg({ tipo: "erro", texto: `Área maior que o saldo restante (${saldoRestante.toFixed(2)} m²).` });
      return;
    }
    setSalvando(true);
    const { error } = await supabase.rpc("producao_registrar_producao_parede", {
      p_obra: obraAtiva.id, p_unidade: form.unidade, p_data: form.data,
      p_parede: paredeSelecionada.id, p_face: form.servico === "reboco" ? faceEscolha : null,
      p_area_m2: areaNum, p_preco: numero(form.preco), p_observacao: form.obs || null,
      p_trabalhadores: participantes,
    });
    setSalvando(false);
    if (error) { setMsg({ tipo: "erro", texto: error.message }); return; }
    setMsg({ tipo: "ok", texto: "Produção salva e rateada." });
    setForm((f) => ({ ...f, area: "", obs: "" }));
    setParedeSelecionada(null); setFaceEscolha(null);
    const unidadeAtual = form.unidade;
    await carregar();
    supabase.from("producao_paredes_progresso").select("*").eq("unidade_id", unidadeAtual)
      .then(({ data }) => setProgresso(data ?? []));
  }

  async function confirmarCancelamento() {
    if (!cancelandoId || !motivoCancelamento.trim()) return;
    const { error } = await supabase.rpc("producao_cancelar_lancamento", {
      p_lancamento: cancelandoId, p_motivo: motivoCancelamento.trim(),
    });
    if (error) { setMsg({ tipo: "erro", texto: error.message }); return; }
    setCancelandoId(null); setMotivoCancelamento("");
    await carregar();
  }

  return (
    <>
      <section className={styles.bloco}>
        <h2>Nova produção</h2>
        <div className={styles.campos}>
          <Campo label="Data">
            <input className={styles.input} type="date" value={form.data}
              onChange={(e) => setForm({ ...form, data: e.target.value })} />
          </Campo>
          <Campo label="Unidade">
            <select className={styles.select} value={form.unidade}
              onChange={(e) => { setForm({ ...form, unidade: e.target.value }); setParedeSelecionada(null); }}>
              <option value="">Selecione…</option>
              {unidades.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
            </select>
          </Campo>
          <Campo label="Serviço">
            <select className={styles.select} value={form.servico}
              onChange={(e) => { setForm({ ...form, servico: e.target.value as TipoServicoProducao }); setParedeSelecionada(null); setFaceEscolha(null); }}>
              <option value="alvenaria">Alvenaria</option>
              <option value="reboco">Reboco</option>
            </select>
          </Campo>
          <Campo label="Pavimento">
            <select className={styles.select} value={form.pavimento}
              onChange={(e) => { setForm({ ...form, pavimento: e.target.value as Pavimento }); setParedeSelecionada(null); setFaceEscolha(null); }}>
              {PAVIMENTOS.map((p) => <option key={p.valor} value={p.valor}>{p.rotulo}</option>)}
            </select>
          </Campo>
        </div>
        {!form.unidade ? (
          <p className={styles.sub}>Selecione a unidade para escolher a parede.</p>
        ) : !urlImagem ? (
          <p className={styles.sub}>Nenhuma planta deste pavimento cadastrada ainda — cadastre na aba "Plantas".</p>
        ) : (
          <PlantaClicavel imagemUrl={urlImagem} paredes={paredesDaPlanta} modo="selecionar" onSelecionar={aoSelecionarParede} />
        )}
        {paredeSelecionada && form.servico === "reboco" && !faceEscolha && (
          <div className={styles.modalFundo} onClick={() => setParedeSelecionada(null)}>
            <div className={styles.modalCaixa} onClick={(e) => e.stopPropagation()}>
              <h3>{paredeSelecionada.nome} — qual face?</h3>
              <div className={styles.acoes}>
                <button className={styles.btn} onClick={() => setFaceEscolha("a")}>Face A</button>
                <button className={styles.btn} onClick={() => setFaceEscolha("b")}>Face B</button>
              </div>
            </div>
          </div>
        )}
        {paredeSelecionada && (form.servico === "alvenaria" || faceEscolha) && (
          <div className={styles.resumo}>
            <span>Parede: <strong>{paredeSelecionada.nome}{faceEscolha ? ` — Face ${faceEscolha.toUpperCase()}` : ""}</strong></span>
            <span>Saldo restante: <strong>{saldoRestante?.toFixed(2) ?? "—"} m²</strong></span>
          </div>
        )}
        <div className={styles.campos}>
          <Campo label="Área produzida hoje (m²)">
            <input className={styles.input} inputMode="decimal" value={form.area}
              onChange={(e) => setForm({ ...form, area: e.target.value })} />
          </Campo>
          <Campo label="Preço do dia (R$/m²)">
            <input className={styles.input} inputMode="decimal" value={form.preco}
              onChange={(e) => setForm({ ...form, preco: e.target.value })} />
          </Campo>
          <Campo label="Observação">
            <input className={styles.input} value={form.obs}
              onChange={(e) => setForm({ ...form, obs: e.target.value })} />
          </Campo>
        </div>
        <h2>Profissionais</h2>
        <div className={styles.lista}>
          {selecionados.map((selecionado, i) => (
            <div className={styles.linha} key={i}>
              <select className={styles.select} value={selecionado}
                onChange={(e) => setSelecionados((atual) => atual.map((id, j) => (j === i ? e.target.value : id)))}>
                <option value="">Selecione o profissional…</option>
                {trabalhadores.map((t) => (
                  <option key={t.id} value={t.id} disabled={selecionados.some((id, j) => j !== i && id === t.id)}>
                    {t.nome} — {t.funcao}
                  </option>
                ))}
              </select>
              {selecionados.length > 1 && (
                <button className={styles.btnSec} onClick={() => setSelecionados((atual) => atual.filter((_, j) => j !== i))}>
                  Remover
                </button>
              )}
            </div>
          ))}
          <button className={styles.btnSec} onClick={() => setSelecionados((atual) => [...atual, ""])}
            disabled={participantes.length >= trabalhadores.length}>
            + Acrescentar profissional
          </button>
        </div>
        <div className={styles.resumo}>
          <span>Área: <strong>{areaNum.toFixed(2)} m²</strong></span>
          <span>Total: <strong>R$ {formatarMoeda(total)}</strong></span>
          <span>Por profissional: <strong>R$ {formatarMoeda(participantes.length ? total / participantes.length : 0)}</strong></span>
        </div>
        <div className={styles.acoes}>
          <button className={styles.btn} disabled={salvando} onClick={salvar}>
            {salvando ? "Salvando…" : "Salvar lançamento"}
          </button>
        </div>
      </section>
      <Mensagem msg={msg} />
      <section className={styles.bloco}>
        <h2>Lançamentos recentes</h2>
        <div className={styles.lista}>
          {lista.map((l) => (
            <div className={styles.linha} key={l.id}>
              <div>
                <strong>{l.parede_nome}{l.face ? ` — Face ${l.face.toUpperCase()}` : ""}</strong>
                <div className={styles.meta}>
                  {fmt(l.data_producao)} · {l.servico} · {unidades.find((u) => u.id === l.unidade_id)?.nome}
                  {l.cancelado_em && " · CANCELADO"}
                </div>
              </div>
              <div>
                <strong>{l.area_liquida.toFixed(2)} m²</strong>
                <div className={styles.meta}>R$ {formatarMoeda(l.valor_total)}</div>
              </div>
              {!l.cancelado_em && (
                <button className={styles.btnSec} onClick={() => setCancelandoId(l.id)}>Cancelar</button>
              )}
            </div>
          ))}
        </div>
      </section>
      {cancelandoId && (
        <div className={styles.modalFundo} onClick={() => setCancelandoId(null)}>
          <div className={styles.modalCaixa} onClick={(e) => e.stopPropagation()}>
            <h3>Cancelar lançamento</h3>
            <Campo label="Motivo">
              <input className={styles.input} value={motivoCancelamento} onChange={(e) => setMotivoCancelamento(e.target.value)} />
            </Campo>
            <div className={styles.acoes}>
              <button className={styles.btn} disabled={!motivoCancelamento.trim()} onClick={confirmarCancelamento}>Confirmar</button>
              <button className={styles.btnSec} onClick={() => setCancelandoId(null)}>Voltar</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
```

Isso substitui integralmente a função `Lancamentos` original (linhas 232-543 do arquivo antes desta mudança) — remove o tipo `Abertura` e a lógica de comprimento/altura/aberturas do formulário, que não é mais usada por nenhum lançamento novo.

- [ ] **Step 2: Ampliar os imports**

Adicionar `TipoServicoProducao`, `FaceParede`, `ProducaoParedeProgresso` ao import de `src/lib/supabase.ts` já ampliado na Task 5.

- [ ] **Step 3: Remover o tipo `Abertura` não usado**

Remover do topo do arquivo (linha 18-23) o tipo `Abertura`, já que não é mais referenciado em nenhum lugar após esta task.

- [ ] **Step 4: Verificar**

```bash
npm run build
```
No navegador, logado com o módulo de produção: Produção própria → aba "Lançamentos diários" → escolher unidade e serviço → a planta do térreo deve aparecer com as faixas cadastradas na Task 5 → clicar numa parede de alvenaria → conferir que o saldo aparece → lançar uma área dentro do saldo → confirmar que salva e o saldo diminui → tentar lançar mais do que o saldo restante → confirmar que bloqueia com mensagem clara → cancelar o lançamento feito → confirmar que o saldo volta.

- [ ] **Step 5: Commit**

```bash
git add src/pages/Producao.tsx
git commit -m "feat: lançamento diário por parede clicável e cancelamento"
```

---

### Task 7: Verificação final

- [ ] `npm run build` sem erros, do zero (`rm -rf node_modules/.vite && npm run build`).
- [ ] Roteiro completo do §8 da spec, no navegador e no celular:
  1. Cadastrar a planta do térreo com 2-3 paredes (alvenaria e reboco 2 faces).
  2. Lançar produção parcial numa parede de alvenaria num sobrado; conferir saldo.
  3. Lançar o restante; tentar ultrapassar — deve bloquear.
  4. Repetir a mesma parede em outro sobrado — saldo independente.
  5. Lançar reboco na face A e na face B — saldos separados.
  6. Cancelar um lançamento não aprovado — saldo volta.
  7. Tentar cancelar um lançamento dentro de uma medição aprovada — deve bloquear (criar uma medição de teste via a aba já existente, revertendo depois).
  8. Confirmar precisão do clique na faixa colorida no celular.
- [ ] Confirmar que `docs/fase7_producao_propria.md` foi atualizado com esta entrega (responsabilidade de quem implementar, conforme `docs/colaboracao-codex-claude.md` — documentação de módulo é de quem implementou).
- [ ] Rodrigo testa com uma parede real e dá o aceite.
