# Módulo Planejamento (Lookahead + PPC) — Plano de implementação

> **Para quem for executar:** use a skill `subagent-driven-development` (recomendado) ou
> `executing-plans` pra rodar este plano tarefa por tarefa. Os passos usam checkbox (`- [ ]`)
> pra acompanhar o progresso. **Esta é uma tarefa de categoria de risco** (RLS nova, trigger
> novo, máquina de estado de aprovação) — `docs/colaboracao-codex-claude.md` exige revisão do
> Claude Code antes do teste de campo do Rodrigo (Etapa 8/9 de
> `docs/sequencia-trabalho-codex-claude.md`), mesmo com a arquitetura já revisada na spec.

**Goal:** implementar o módulo Planejamento (spec em
`docs/superpowers/specs/2026-07-19-planejamento-lookahead-ppc-design.md`): restrições
vinculadas ao Cronograma, compromisso semanal com meta de % travado por restrição aberta,
fechamento de semana com PPC calculado e imutável (admin), visão trimestral agregada.

**Architecture:** uma migração Supabase (3 tabelas, 3 enums, RLS, 2 triggers, 2 RPCs) + uma
página React nova (`/planejamento`) com 3 abas (Mensal, Semanal, Trimestral), reaproveitando
`cronograma_tarefas`, `cronograma_previsto`, `cronograma_versoes` e `avancos_fisicos` já
existentes por referência (nunca cópia).

**Tech Stack:** React 19 + TypeScript + Vite, Supabase JS, CSS Modules, Postgres (RLS/triggers/
PL-pgSQL). Sem framework de teste automatizado — verificação por `tsc -b` (via `npm run build`)
e checagem manual no navegador.

## Global Constraints

- Todo texto de interface e mensagem de erro em português.
- Cores só via as variáveis CSS já definidas no projeto (`--navy`, `--nude`, `--branco`,
  `--terracota`, `--cinza-*`, `--sombra-sm`, `--radius-sm`, `--radius-md`).
- Toda função `SECURITY DEFINER` nova precisa de `SET search_path = public` já na criação
  (não deixar pra uma migração de hardening depois — ver `[[project_auditoria_seguranca]]`,
  gap de 21 funções que ficaram sem isso na varredura de 17/07).
- Funções de trigger `SECURITY DEFINER` que não são RPC (não devem ser chamadas direto pela
  API) recebem `REVOKE ALL ... FROM PUBLIC, anon, authenticated` no fim da migração, mesmo
  padrão de `20260718_tarefas.sql`.
- RPCs que a interface chama diretamente (`calcular_fechamento_semana`,
  `fechar_semana_planejamento`) recebem `REVOKE ALL` seguido de `GRANT EXECUTE ... TO
  authenticated` — nunca ficam abertas a `anon`.
- Toda tabela nova isolada por obra com policy `AS RESTRICTIVE` desde a migração que cria a
  tabela (nunca depois).
- Cliente não pode ver nenhuma linha de nenhuma das 3 tabelas novas — as policies de SELECT
  restringem a `admin`/`equipe`, mesmo padrão de `tarefas_select`.
- Nenhuma mudança em `cronograma_tarefas`, `cronograma_previsto`, `avancos_fisicos` ou qualquer
  tabela do Cronograma/Avanço Físico já existentes — este módulo só lê essas tabelas.

---

## Arquivos afetados

- **Criar:** `supabase/migrations/20260719_planejamento.sql`
- **Modificar:** `src/lib/supabase.ts` (tipos novos + `ModuloApp`)
- **Modificar:** `src/components/Layout.tsx` (item de menu)
- **Modificar:** `src/App.tsx` (rota + import lazy)
- **Criar:** `src/pages/Planejamento.tsx`
- **Criar:** `src/pages/Planejamento.module.css`

---

### Task 1: Migração — enums, tabelas, RLS, triggers, RPCs

**Files:**
- Create: `supabase/migrations/20260719_planejamento.sql`

**Interfaces:**
- Consome: `obras`, `perfis_usuario`, `cronograma_tarefas`, `avancos_fisicos`,
  `pode_acessar_obra(uuid)`, `meu_papel()`, `meus_modulos()` — todos já existentes.
- Produz: tabelas `restricoes`, `planejamento_semanas`, `planejamento_compromissos`; enums
  `categoria_restricao`, `status_restricao`, `status_semana_planejamento`; funções
  `pode_editar_planejamento()`, `calcular_fechamento_semana(uuid)`,
  `fechar_semana_planejamento(uuid)` — nomes e assinaturas usados nas Tasks 3 e 4.

- [ ] **Passo 1: Escrever a migração completa**

Crie `supabase/migrations/20260719_planejamento.sql` com o conteúdo abaixo:

```sql
-- ============================================================
-- FASE 7 — PLANEJAMENTO (lookahead + PPC) | RT Engenharia
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
    OR (meu_papel() = 'equipe' AND 'planejamento' = ANY(meus_modulos()))
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
```

Nota de risco aceito (documentar, não implementar agora): a policy de UPDATE de
`planejamento_compromissos` libera `pode_editar_planejamento()` pra qualquer coluna, então
tecnicamente um usuário com o módulo poderia gravar `percentual_fim`/`cumprido` direto via API
sem passar pelas RPCs. Postgres RLS não faz trava por coluna. É o mesmo nível de confiança já
aceito em outras tabelas do app — não vale a complexidade de resolver agora; a interface (Task
4) só expõe os campos de motivo pra edição manual.

- [ ] **Passo 2: Aplicar a migração e conferir o advisor**

Aplique a migração no projeto (`apply_migration` do Supabase MCP, ou `supabase db push` local)
e rode o advisor de segurança logo depois — confirme que nenhuma das funções novas aparece
como `function_search_path_mutable` (todas já nasceram com `SET search_path = public`).

- [ ] **Passo 3: Commit**

```bash
git add supabase/migrations/20260719_planejamento.sql
git commit -m "feat: cria modulo Planejamento (restricoes, compromisso semanal, PPC)"
```

---

### Task 2: Tipos TypeScript + rota + menu

**Files:**
- Modify: `src/lib/supabase.ts`
- Modify: `src/components/Layout.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consome: nada de novo além do já existente.
- Produz: tipos `Restricao`, `PlanejamentoSemana`, `PlanejamentoCompromisso`,
  `CategoriaRestricao`, `StatusRestricao`, `StatusSemanaPlanejamento` — usados nas Tasks 3, 4 e
  5.

- [ ] **Passo 1: Adicionar `'planejamento'` a `ModuloApp`**

Em `src/lib/supabase.ts`, localize (linha 9-11):

```ts
export type ModuloApp =
  | 'rdo' | 'avanco' | 'pendencias' | 'almoxarifado' | 'financeiro' | 'compras'
  | 'medicoes' | 'contratos' | 'fvs' | 'galeria' | 'efetivo' | 'alertas' | 'definicoes' | 'tarefas' | 'projetos'
```

Troque por:

```ts
export type ModuloApp =
  | 'rdo' | 'avanco' | 'pendencias' | 'almoxarifado' | 'financeiro' | 'compras'
  | 'medicoes' | 'contratos' | 'fvs' | 'galeria' | 'efetivo' | 'alertas' | 'definicoes' | 'tarefas' | 'projetos' | 'planejamento'
```

- [ ] **Passo 2: Adicionar os tipos novos**

No fim de `src/lib/supabase.ts`, adicione:

```ts
export type CategoriaRestricao =
  | 'material' | 'mao_de_obra' | 'projeto_documentacao' | 'decisao_pendente'
  | 'equipamento' | 'financeiro' | 'servico_predecessor' | 'clima'
export type StatusRestricao = 'aberta' | 'resolvida'
export type StatusSemanaPlanejamento = 'aberta' | 'fechada'

export interface Restricao {
  id: string
  obra_id: string
  tarefa_id: string
  categoria: CategoriaRestricao
  responsavel_id: string | null
  prazo: string
  status: StatusRestricao
  observacao: string | null
  resolvida_por: string | null
  resolvida_em: string | null
  ativo: boolean
  criado_em: string
  criado_por: string
}

export interface PlanejamentoSemana {
  id: string
  obra_id: string
  data_inicio: string
  data_fim: string
  status: StatusSemanaPlanejamento
  ppc: number | null
  fechada_por: string | null
  fechada_em: string | null
  ativo: boolean
  criado_em: string
  criado_por: string
}

export interface PlanejamentoCompromisso {
  id: string
  semana_id: string
  tarefa_id: string
  percentual_inicio: number
  meta_percentual: number
  percentual_fim: number | null
  cumprido: boolean | null
  motivo_categoria: CategoriaRestricao | null
  motivo_observacao: string | null
  ativo: boolean
  criado_em: string
  criado_por: string
}
```

- [ ] **Passo 3: Adicionar o item de menu**

Em `src/components/Layout.tsx`, localize (linha 63-64):

```tsx
  { type: 'link', key: 'tarefas', label: 'Tarefas', icon: '☑️', path: '/tarefas' },
  { type: 'link', key: 'projetos', label: 'Projetos', icon: '📁', path: '/projetos' },
```

Adicione logo abaixo:

```tsx
  { type: 'link', key: 'tarefas', label: 'Tarefas', icon: '☑️', path: '/tarefas' },
  { type: 'link', key: 'projetos', label: 'Projetos', icon: '📁', path: '/projetos' },
  { type: 'link', key: 'planejamento', label: 'Planejamento', icon: '📅', path: '/planejamento' },
```

Não precisa mexer na lógica de visibilidade (linha 84) — ela já usa `temModulo(item.key)`
genericamente, então `planejamento` some/aparece sozinho conforme o módulo do usuário.

- [ ] **Passo 4: Registrar a rota**

Em `src/App.tsx`, localize o import lazy da Tarefas (linha 35):

```tsx
const Tarefas = lazy(() => import('./pages/Tarefas'))
```

Adicione logo abaixo:

```tsx
const Tarefas = lazy(() => import('./pages/Tarefas'))
const Planejamento = lazy(() => import('./pages/Planejamento'))
```

Localize a rota de tarefas (linha 89):

```tsx
        <Route path="tarefas" element={<Tarefas />} />
```

Adicione logo abaixo:

```tsx
        <Route path="tarefas" element={<Tarefas />} />
        <Route path="planejamento" element={<Planejamento />} />
```

- [ ] **Passo 5: Rodar o typecheck**

Rode: `npm run build`
Esperado: falha nesta etapa é esperada — `Planejamento.tsx` ainda não existe (Task 3 cria o
arquivo). Confirme que o erro é só "Cannot find module './pages/Planejamento'" e não outro
problema de tipo.

- [ ] **Passo 6: Commit**

```bash
git add src/lib/supabase.ts src/components/Layout.tsx src/App.tsx
git commit -m "feat: adiciona tipos, rota e menu do modulo Planejamento"
```

---

### Task 3: Aba Mensal — restrições

**Files:**
- Create: `src/pages/Planejamento.tsx` (estrutura base da página + aba Mensal completa)
- Create: `src/pages/Planejamento.module.css`

**Interfaces:**
- Consome: `useAuth`, `useObra`, `useConfirmDialog` (mesmos hooks de `Projetos.tsx`),
  `Restricao`, `CategoriaRestricao`, tabelas `cronograma_tarefas`, `etapas`, `perfis_usuario`,
  `restricoes`.
- Produz: componente `Planejamento` default export (Tasks 4 e 5 estendem o mesmo arquivo);
  constante `CATEGORIA_LABEL: Record<CategoriaRestricao, string>` reaproveitada nas Tasks 4/5.

- [ ] **Passo 1: Criar `Planejamento.module.css`**

Crie `src/pages/Planejamento.module.css`:

```css
.page { max-width: 1180px; margin: 0 auto; }
.header { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; margin-bottom: 18px; }
.header h1 { margin: 0 0 4px; font-size: 26px; }
.sub { margin: 0; color: var(--cinza-600); font-size: 14px; }
.msgOk, .msgErro { border-radius: var(--radius-sm); padding: 10px 12px; font-size: 13px; font-weight: 700; margin-bottom: 14px; }
.msgOk { background: #e6f4ec; color: var(--sucesso); }
.msgErro { background: #fdeaea; color: var(--erro); }
.abas { display: flex; gap: 8px; margin-bottom: 16px; border-bottom: 1px solid var(--cinza-200); }
.aba { background: none; border: 0; padding: 10px 16px; font: inherit; font-weight: 800; color: var(--cinza-600); cursor: pointer; border-bottom: 2px solid transparent; }
.abaAtiva { color: var(--navy); border-bottom-color: var(--navy); }
.formulario, .box { background: var(--branco); border: 1px solid var(--cinza-200); border-radius: var(--radius-md); padding: 16px; margin-bottom: 16px; box-shadow: var(--sombra-sm); }
.formHeader { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 12px; }
.formHeader h2 { margin: 0; font-size: 17px; }
.campos { display: flex; flex-direction: column; gap: 12px; }
.campo { display: flex; flex-direction: column; gap: 6px; font-size: 12px; font-weight: 700; color: var(--navy); min-width: 0; }
.campo input, .campo select, .campo textarea { width: 100%; min-width: 0; border: 1px solid var(--cinza-200); border-radius: var(--radius-sm); padding: 10px 11px; font: inherit; background: var(--branco); color: var(--cinza-900); }
.linha2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.linha3 { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.acoesForm { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
.btnPrimario, .btnSecundario, .btnPerigo { border-radius: var(--radius-sm); padding: 10px 13px; font: inherit; font-weight: 800; cursor: pointer; }
.btnPrimario { border: 0; background: var(--navy); color: var(--branco); }
.btnSecundario { background: var(--nude); color: var(--navy); border: 1px solid var(--cinza-200); }
.btnPerigo { border: 0; background: var(--terracota); color: var(--branco); }
button:disabled { opacity: .55; cursor: not-allowed; }
.filtros { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; align-items: center; }
.filtros select, .filtros input { border: 1px solid var(--cinza-200); border-radius: var(--radius-sm); padding: 9px 11px; font: inherit; background: var(--branco); }
.tabela { width: 100%; border-collapse: collapse; background: var(--branco); border: 1px solid var(--cinza-200); border-radius: var(--radius-md); overflow: hidden; box-shadow: var(--sombra-sm); }
.tabela th, .tabela td { text-align: left; padding: 10px 12px; font-size: 13px; border-bottom: 1px solid var(--cinza-200); }
.tabela th { background: var(--nude); color: var(--navy); font-weight: 800; }
.tabela tr:last-child td { border-bottom: 0; }
.chip { display: inline-flex; border-radius: 999px; padding: 4px 9px; font-size: 11px; font-weight: 800; white-space: nowrap; background: #edf4fa; color: var(--navy); }
.chipAberta { background: #fdeaea; color: var(--erro); }
.chipResolvida { background: #e6f4ec; color: var(--sucesso); }
.vazio { background: var(--branco); border: 1px solid var(--cinza-200); border-radius: var(--radius-md); padding: 18px; color: var(--cinza-600); box-shadow: var(--sombra-sm); }
@media (max-width: 860px) {
  .header { flex-direction: column; width: 100%; }
  .linha2, .linha3 { grid-template-columns: 1fr; }
  .btnPrimario, .btnSecundario, .btnPerigo { width: 100%; }
  .tabela, .tabela thead { display: block; }
  .tabela tr { display: block; border-bottom: 1px solid var(--cinza-200); padding: 8px 0; }
  .tabela th { display: none; }
  .tabela td { display: flex; justify-content: space-between; gap: 8px; border-bottom: 0; padding: 4px 12px; }
}
```

- [ ] **Passo 2: Criar `Planejamento.tsx` com a estrutura base + aba Mensal**

Crie `src/pages/Planejamento.tsx`:

```tsx
import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useObra } from '../contexts/ObraContext'
import { supabase, type CategoriaRestricao, type PerfilUsuario, type Restricao, type StatusRestricao } from '../lib/supabase'
import styles from './Planejamento.module.css'

type Msg = { tipo: 'ok' | 'erro'; texto: string } | null
type Aba = 'mensal' | 'semanal' | 'trimestral'

interface TarefaCronograma {
  id: string
  nome: string
  etapa_id: string | null
  unidade_id: string | null
  resumo: boolean
  etapas: { nome: string } | null
  unidades: { nome: string } | null
}

export const CATEGORIA_LABEL: Record<CategoriaRestricao, string> = {
  material: 'Material',
  mao_de_obra: 'Mão de obra',
  projeto_documentacao: 'Projeto/documentação',
  decisao_pendente: 'Decisão pendente',
  equipamento: 'Equipamento',
  financeiro: 'Financeiro',
  servico_predecessor: 'Serviço predecessor',
  clima: 'Clima',
}

const fmtData = (iso?: string | null) => iso ? new Date(iso + 'T00:00:00').toLocaleDateString('pt-BR') : '-'

export default function Planejamento() {
  const { perfil, temModulo } = useAuth()
  const { obraAtiva } = useObra()
  const podeEditar = perfil?.papel === 'admin' || (perfil?.papel === 'equipe' && temModulo('planejamento'))
  const semPermissao = !podeEditar

  const [aba, setAba] = useState<Aba>('mensal')
  const [carregando, setCarregando] = useState(true)
  const [msg, setMsg] = useState<Msg>(null)
  const [salvando, setSalvando] = useState(false)

  const [tarefas, setTarefas] = useState<TarefaCronograma[]>([])
  const [usuarios, setUsuarios] = useState<PerfilUsuario[]>([])
  const [restricoes, setRestricoes] = useState<Restricao[]>([])

  const [filtroCategoria, setFiltroCategoria] = useState<CategoriaRestricao | ''>('')
  const [filtroStatus, setFiltroStatus] = useState<StatusRestricao | ''>('')

  const [formAberto, setFormAberto] = useState(false)
  const [buscaTarefa, setBuscaTarefa] = useState('')
  const [tarefaId, setTarefaId] = useState('')
  const [categoria, setCategoria] = useState<CategoriaRestricao>('material')
  const [responsavelId, setResponsavelId] = useState('')
  const [prazo, setPrazo] = useState('')
  const [observacao, setObservacao] = useState('')

  const tarefaPorId = useMemo(() => new Map(tarefas.map(t => [t.id, t])), [tarefas])
  const usuarioPorId = useMemo(() => new Map(usuarios.map(u => [u.id, u])), [usuarios])

  const tarefasAbertasPorId = useMemo(() => {
    const abertas = new Set<string>()
    for (const r of restricoes) if (r.status === 'aberta') abertas.add(r.tarefa_id)
    return abertas
  }, [restricoes])

  const tarefasFiltradas = useMemo(() => {
    const termo = buscaTarefa.trim().toLowerCase()
    if (!termo) return tarefas.slice(0, 30)
    return tarefas.filter(t => t.nome.toLowerCase().includes(termo)).slice(0, 30)
  }, [tarefas, buscaTarefa])

  const restricoesFiltradas = useMemo(() => {
    return restricoes.filter(r => (!filtroCategoria || r.categoria === filtroCategoria) && (!filtroStatus || r.status === filtroStatus))
      .sort((a, b) => a.prazo.localeCompare(b.prazo))
  }, [restricoes, filtroCategoria, filtroStatus])

  async function carregar() {
    if (!obraAtiva || semPermissao) { setCarregando(false); return }
    setCarregando(true)
    setMsg(null)
    const [tarefasResp, usuariosResp, restricoesResp] = await Promise.all([
      supabase.from('cronograma_tarefas').select('id, nome, etapa_id, unidade_id, resumo, etapas(nome), unidades(nome)').eq('obra_id', obraAtiva.id).eq('ativo', true).eq('resumo', false).order('nome'),
      supabase.from('perfis_usuario').select('*').eq('ativo', true).neq('papel', 'cliente').order('nome'),
      supabase.from('restricoes').select('*').eq('obra_id', obraAtiva.id).eq('ativo', true).order('prazo'),
    ])
    if (tarefasResp.error) setMsg({ tipo: 'erro', texto: 'Erro ao carregar tarefas do cronograma: ' + tarefasResp.error.message })
    else setTarefas((tarefasResp.data ?? []) as unknown as TarefaCronograma[])
    if (usuariosResp.error) setMsg({ tipo: 'erro', texto: 'Erro ao carregar usuários: ' + usuariosResp.error.message })
    else setUsuarios(usuariosResp.data ?? [])
    if (restricoesResp.error) setMsg({ tipo: 'erro', texto: 'Erro ao carregar restrições: ' + restricoesResp.error.message })
    else setRestricoes(restricoesResp.data ?? [])
    setCarregando(false)
  }

  useEffect(() => { carregar() }, [obraAtiva?.id, semPermissao])

  function limparForm() {
    setBuscaTarefa('')
    setTarefaId('')
    setCategoria('material')
    setResponsavelId('')
    setPrazo('')
    setObservacao('')
  }

  async function salvarRestricao() {
    setMsg(null)
    if (!obraAtiva) return setMsg({ tipo: 'erro', texto: 'Selecione uma obra.' })
    if (!tarefaId) return setMsg({ tipo: 'erro', texto: 'Selecione a tarefa do cronograma.' })
    if (!prazo) return setMsg({ tipo: 'erro', texto: 'Informe o prazo.' })
    setSalvando(true)
    const { error } = await supabase.from('restricoes').insert({
      obra_id: obraAtiva.id,
      tarefa_id: tarefaId,
      categoria,
      responsavel_id: responsavelId || null,
      prazo,
      observacao: observacao.trim() || null,
    })
    setSalvando(false)
    if (error) return setMsg({ tipo: 'erro', texto: 'Erro ao cadastrar restrição: ' + error.message })
    limparForm()
    setFormAberto(false)
    setMsg({ tipo: 'ok', texto: 'Restrição cadastrada.' })
    await carregar()
  }

  async function resolverRestricao(r: Restricao) {
    setMsg(null)
    setSalvando(true)
    const { error } = await supabase.from('restricoes').update({ status: 'resolvida', resolvida_por: perfil?.id, resolvida_em: new Date().toISOString() }).eq('id', r.id)
    setSalvando(false)
    if (error) return setMsg({ tipo: 'erro', texto: 'Erro ao resolver restrição: ' + error.message })
    setMsg({ tipo: 'ok', texto: 'Restrição marcada como resolvida.' })
    await carregar()
  }

  if (semPermissao) return <div className={styles.page}><h1>Planejamento</h1><div className={styles.msgErro}>Você não tem permissão para acessar Planejamento.</div></div>

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div><h1>Planejamento</h1><p className={styles.sub}>Restrições, compromisso semanal e marcos do cronograma.</p></div>
      </div>
      {msg && <div className={msg.tipo === 'ok' ? styles.msgOk : styles.msgErro}>{msg.texto}</div>}

      <div className={styles.abas}>
        <button className={[styles.aba, aba === 'mensal' ? styles.abaAtiva : ''].filter(Boolean).join(' ')} onClick={() => setAba('mensal')}>Mensal</button>
        <button className={[styles.aba, aba === 'semanal' ? styles.abaAtiva : ''].filter(Boolean).join(' ')} onClick={() => setAba('semanal')}>Semanal</button>
        <button className={[styles.aba, aba === 'trimestral' ? styles.abaAtiva : ''].filter(Boolean).join(' ')} onClick={() => setAba('trimestral')}>Trimestral</button>
      </div>

      {carregando ? <div className={styles.vazio}>Carregando...</div> : aba === 'mensal' && <>
        <div className={styles.header}>
          <div />
          <button className={styles.btnPrimario} onClick={() => setFormAberto(v => !v)}>{formAberto ? 'Fechar' : 'Nova restrição'}</button>
        </div>

        {formAberto && (
          <div className={styles.formulario}>
            <div className={styles.formHeader}><h2>Nova restrição</h2></div>
            <div className={styles.campos}>
              <label className={styles.campo}>Buscar tarefa do cronograma<input value={buscaTarefa} onChange={e => setBuscaTarefa(e.target.value)} placeholder="Digite o nome da tarefa" /></label>
              <label className={styles.campo}>Tarefa<select value={tarefaId} onChange={e => setTarefaId(e.target.value)}><option value="">Selecione</option>{tarefasFiltradas.map(t => <option key={t.id} value={t.id}>{t.nome}{t.etapas ? ' — ' + t.etapas.nome : ''}</option>)}</select></label>
              <div className={styles.linha3}>
                <label className={styles.campo}>Categoria<select value={categoria} onChange={e => setCategoria(e.target.value as CategoriaRestricao)}>{(Object.keys(CATEGORIA_LABEL) as CategoriaRestricao[]).map(c => <option key={c} value={c}>{CATEGORIA_LABEL[c]}</option>)}</select></label>
                <label className={styles.campo}>Responsável<select value={responsavelId} onChange={e => setResponsavelId(e.target.value)}><option value="">Sem responsável definido</option>{usuarios.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}</select></label>
                <label className={styles.campo}>Prazo<input type="date" value={prazo} onChange={e => setPrazo(e.target.value)} /></label>
              </div>
              <label className={styles.campo}>Observação<textarea value={observacao} onChange={e => setObservacao(e.target.value)} /></label>
            </div>
            <div className={styles.acoesForm}><button className={styles.btnPrimario} disabled={salvando} onClick={salvarRestricao}>{salvando ? 'Salvando...' : 'Salvar restrição'}</button><button className={styles.btnSecundario} onClick={() => { limparForm(); setFormAberto(false) }}>Cancelar</button></div>
          </div>
        )}

        <div className={styles.filtros}>
          <select value={filtroCategoria} onChange={e => setFiltroCategoria(e.target.value as CategoriaRestricao | '')}><option value="">Todas as categorias</option>{(Object.keys(CATEGORIA_LABEL) as CategoriaRestricao[]).map(c => <option key={c} value={c}>{CATEGORIA_LABEL[c]}</option>)}</select>
          <select value={filtroStatus} onChange={e => setFiltroStatus(e.target.value as StatusRestricao | '')}><option value="">Todos os status</option><option value="aberta">Aberta</option><option value="resolvida">Resolvida</option></select>
        </div>

        {restricoesFiltradas.length === 0 ? <div className={styles.vazio}>Nenhuma restrição encontrada.</div> : (
          <table className={styles.tabela}>
            <thead><tr><th>Tarefa</th><th>Categoria</th><th>Responsável</th><th>Prazo</th><th>Status</th><th></th></tr></thead>
            <tbody>{restricoesFiltradas.map(r => {
              const tarefa = tarefaPorId.get(r.tarefa_id)
              return (
                <tr key={r.id}>
                  <td data-label="Tarefa">{tarefa?.nome ?? 'Tarefa não encontrada'}</td>
                  <td data-label="Categoria">{CATEGORIA_LABEL[r.categoria]}</td>
                  <td data-label="Responsável">{r.responsavel_id ? usuarioPorId.get(r.responsavel_id)?.nome ?? '-' : '-'}</td>
                  <td data-label="Prazo">{fmtData(r.prazo)}</td>
                  <td data-label="Status"><span className={[styles.chip, r.status === 'aberta' ? styles.chipAberta : styles.chipResolvida].join(' ')}>{r.status === 'aberta' ? 'Aberta' : 'Resolvida'}</span></td>
                  <td data-label="">{r.status === 'aberta' && <button className={styles.btnSecundario} disabled={salvando} onClick={() => resolverRestricao(r)}>Resolver</button>}</td>
                </tr>
              )
            })}</tbody>
          </table>
        )}
      </>}
    </div>
  )
}
```

Note: `tarefasAbertasPorId` já é calculado aqui (usado na Task 4, aba Semanal, pra não deixar
selecionar tarefa com restrição aberta na busca de compromisso).

- [ ] **Passo 3: Rodar o typecheck**

Rode: `npm run build`
Esperado: build completa sem erro.

- [ ] **Passo 4: Verificação manual no navegador**

Rode: `npm run dev`, abra **Planejamento** (só aparece pra admin ou equipe com o módulo
`planejamento` habilitado em Usuários). Confirme:

1. Aba Mensal abre por padrão, mostrando "Nenhuma restrição encontrada." se a obra não tiver
   nenhuma ainda.
2. "Nova restrição": buscar uma tarefa real do cronograma pelo nome, escolher categoria,
   responsável (opcional) e prazo, salvar — aparece na tabela com status "Aberta".
3. Filtrar por categoria e por status funciona.
4. "Resolver" muda o status pra "Resolvida" e o botão some daquela linha.

- [ ] **Passo 5: Commit**

```bash
git add src/pages/Planejamento.tsx src/pages/Planejamento.module.css
git commit -m "feat: implementa aba Mensal (restricoes) do modulo Planejamento"
```

---

### Task 4: Aba Semanal — compromissos e fechamento

**Files:**
- Modify: `src/pages/Planejamento.tsx` (adiciona a aba Semanal ao componente já criado na
  Task 3)

**Interfaces:**
- Consome: `tarefasAbertasPorId`, `tarefaPorId`, `CATEGORIA_LABEL`, `Restricao` — todos já
  criados na Task 3. Tabelas `avancos_fisicos`, `planejamento_semanas`,
  `planejamento_compromissos`, RPCs `calcular_fechamento_semana`, `fechar_semana_planejamento`.
- Produz: nada consumido por outra task.

- [ ] **Passo 1: Adicionar estados e carregamento da aba Semanal**

Em `src/pages/Planejamento.tsx`, adicione aos imports do topo o tipo que falta:

```tsx
import { supabase, type CategoriaRestricao, type PerfilUsuario, type PlanejamentoCompromisso, type PlanejamentoSemana, type Restricao, type StatusRestricao } from '../lib/supabase'
```

Logo abaixo dos estados de restrições (após `const [observacao, setObservacao] = useState('')`), adicione:

```tsx
  const [semanas, setSemanas] = useState<PlanejamentoSemana[]>([])
  const [semanaSelecionadaId, setSemanaSelecionadaId] = useState<string | null>(null)
  const [compromissos, setCompromissos] = useState<PlanejamentoCompromisso[]>([])
  const [percentuaisAtuais, setPercentuaisAtuais] = useState<Record<string, number>>({})

  const [novaSemanaInicio, setNovaSemanaInicio] = useState('')
  const [novaSemanaFim, setNovaSemanaFim] = useState('')
  const [formCompromissoAberto, setFormCompromissoAberto] = useState(false)
  const [buscaTarefaCompromisso, setBuscaTarefaCompromisso] = useState('')
  const [tarefaCompromissoId, setTarefaCompromissoId] = useState('')
  const [metaPercentual, setMetaPercentual] = useState('')
```

Substitua a assinatura de `carregar()` — adicione o carregamento de semanas dentro da mesma
função, logo após o bloco que já busca `tarefasResp/usuariosResp/restricoesResp` (antes de
`setCarregando(false)`):

```tsx
    const semanasResp = await supabase.from('planejamento_semanas').select('*').eq('obra_id', obraAtiva.id).eq('ativo', true).order('data_inicio', { ascending: false })
    if (semanasResp.error) setMsg({ tipo: 'erro', texto: 'Erro ao carregar semanas: ' + semanasResp.error.message })
    else {
      const lista = semanasResp.data ?? []
      setSemanas(lista)
      if (!semanaSelecionadaId && lista.length > 0) setSemanaSelecionadaId(lista[0].id)
    }
```

Adicione uma função separada pra carregar compromissos da semana selecionada e os percentuais
atuais de avanço físico (chamada por um `useEffect` próprio, já que depende de
`semanaSelecionadaId`):

```tsx
  async function carregarCompromissos(semanaId: string) {
    const compResp = await supabase.from('planejamento_compromissos').select('*').eq('semana_id', semanaId).eq('ativo', true)
    if (compResp.error) { setMsg({ tipo: 'erro', texto: 'Erro ao carregar compromissos: ' + compResp.error.message }); return }
    setCompromissos(compResp.data ?? [])
  }

  useEffect(() => { if (semanaSelecionadaId) carregarCompromissos(semanaSelecionadaId) }, [semanaSelecionadaId])

  useEffect(() => {
    if (tarefas.length === 0) return
    supabase.from('avancos_fisicos').select('tarefa_id, percentual, data_referencia').eq('ativo', true).in('tarefa_id', tarefas.map(t => t.id)).order('data_referencia', { ascending: false }).then(({ data }) => {
      const atuais: Record<string, number> = {}
      for (const row of data ?? []) if (!(row.tarefa_id in atuais)) atuais[row.tarefa_id] = row.percentual
      setPercentuaisAtuais(atuais)
    })
  }, [tarefas])
```

**Interface consumida:** `tarefas` (já existe da Task 3) precisa incluir os `id` de todas as
tarefas ativas da obra — já é o caso, sem mudança na query da Task 3.

- [ ] **Passo 2: Funções de ação da aba Semanal**

Adicione, próximo às outras funções de ação (`salvarRestricao`, `resolverRestricao`):

```tsx
  const semanaSelecionada = semanas.find(s => s.id === semanaSelecionadaId) ?? null
  const tarefasElegiveis = useMemo(() => {
    const termo = buscaTarefaCompromisso.trim().toLowerCase()
    const jaComprometidas = new Set(compromissos.map(c => c.tarefa_id))
    return tarefas
      .filter(t => !tarefasAbertasPorId.has(t.id) && !jaComprometidas.has(t.id))
      .filter(t => !termo || t.nome.toLowerCase().includes(termo))
      .slice(0, 30)
  }, [tarefas, tarefasAbertasPorId, compromissos, buscaTarefaCompromisso])

  async function criarSemana() {
    setMsg(null)
    if (!obraAtiva) return
    if (!novaSemanaInicio || !novaSemanaFim) return setMsg({ tipo: 'erro', texto: 'Informe início e fim da semana.' })
    setSalvando(true)
    const { data, error } = await supabase.from('planejamento_semanas').insert({ obra_id: obraAtiva.id, data_inicio: novaSemanaInicio, data_fim: novaSemanaFim }).select('*').single()
    setSalvando(false)
    if (error) return setMsg({ tipo: 'erro', texto: 'Erro ao criar semana: ' + error.message })
    setNovaSemanaInicio('')
    setNovaSemanaFim('')
    setMsg({ tipo: 'ok', texto: 'Semana criada.' })
    await carregar()
    if (data) setSemanaSelecionadaId(data.id)
  }

  async function adicionarCompromisso() {
    setMsg(null)
    if (!semanaSelecionada) return setMsg({ tipo: 'erro', texto: 'Selecione uma semana.' })
    if (!tarefaCompromissoId) return setMsg({ tipo: 'erro', texto: 'Selecione a tarefa.' })
    const meta = Number(metaPercentual)
    const inicio = percentuaisAtuais[tarefaCompromissoId] ?? 0
    if (!meta || meta <= inicio || meta > 100) return setMsg({ tipo: 'erro', texto: 'Meta precisa ser maior que o % atual (' + inicio + '%) e no máximo 100.' })
    setSalvando(true)
    const { error } = await supabase.from('planejamento_compromissos').insert({
      semana_id: semanaSelecionada.id,
      tarefa_id: tarefaCompromissoId,
      percentual_inicio: inicio,
      meta_percentual: meta,
    })
    setSalvando(false)
    if (error) return setMsg({ tipo: 'erro', texto: 'Erro ao comprometer tarefa: ' + error.message })
    setBuscaTarefaCompromisso('')
    setTarefaCompromissoId('')
    setMetaPercentual('')
    setFormCompromissoAberto(false)
    setMsg({ tipo: 'ok', texto: 'Tarefa comprometida na semana.' })
    await carregarCompromissos(semanaSelecionada.id)
  }

  async function atualizarMotivo(c: PlanejamentoCompromisso, motivoCategoria: CategoriaRestricao, motivoObservacao: string) {
    setSalvando(true)
    const { error } = await supabase.from('planejamento_compromissos').update({ motivo_categoria: motivoCategoria, motivo_observacao: motivoObservacao.trim() || null }).eq('id', c.id)
    setSalvando(false)
    if (error) return setMsg({ tipo: 'erro', texto: 'Erro ao salvar motivo: ' + error.message })
    if (semanaSelecionada) await carregarCompromissos(semanaSelecionada.id)
  }

  async function calcularFechamento() {
    if (!semanaSelecionada) return
    setMsg(null)
    setSalvando(true)
    const { error } = await supabase.rpc('calcular_fechamento_semana', { p_semana: semanaSelecionada.id })
    setSalvando(false)
    if (error) return setMsg({ tipo: 'erro', texto: 'Erro ao calcular fechamento: ' + error.message })
    setMsg({ tipo: 'ok', texto: 'Fechamento calculado. Confira os não cumpridos antes de fechar.' })
    await carregarCompromissos(semanaSelecionada.id)
  }

  async function fecharSemana() {
    if (!semanaSelecionada) return
    setMsg(null)
    setSalvando(true)
    const { error } = await supabase.rpc('fechar_semana_planejamento', { p_semana: semanaSelecionada.id })
    setSalvando(false)
    if (error) return setMsg({ tipo: 'erro', texto: 'Erro ao fechar semana: ' + error.message })
    setMsg({ tipo: 'ok', texto: 'Semana fechada.' })
    await carregar()
    await carregarCompromissos(semanaSelecionada.id)
  }
```

- [ ] **Passo 3: Renderizar a aba Semanal**

Logo depois do bloco `{carregando ? ... : aba === 'mensal' && <>...</>}` já existente da Task
3, adicione (ainda dentro do mesmo `return`, como irmão do bloco anterior):

```tsx
      {!carregando && aba === 'semanal' && <>
        <div className={styles.filtros}>
          <select value={semanaSelecionadaId ?? ''} onChange={e => setSemanaSelecionadaId(e.target.value || null)}>
            <option value="">Selecione uma semana</option>
            {semanas.map(s => <option key={s.id} value={s.id}>{fmtData(s.data_inicio)} a {fmtData(s.data_fim)} {s.status === 'fechada' ? '(fechada, PPC ' + s.ppc + '%)' : ''}</option>)}
          </select>
        </div>

        <div className={styles.formulario}>
          <div className={styles.formHeader}><h2>Nova semana</h2></div>
          <div className={styles.linha2}>
            <label className={styles.campo}>Início<input type="date" value={novaSemanaInicio} onChange={e => setNovaSemanaInicio(e.target.value)} /></label>
            <label className={styles.campo}>Fim<input type="date" value={novaSemanaFim} onChange={e => setNovaSemanaFim(e.target.value)} /></label>
          </div>
          <div className={styles.acoesForm}><button className={styles.btnPrimario} disabled={salvando} onClick={criarSemana}>Criar semana</button></div>
        </div>

        {!semanaSelecionada ? <div className={styles.vazio}>Selecione ou crie uma semana.</div> : <>
          {semanaSelecionada.status === 'aberta' && (
            <div className={styles.acoesForm}>
              <button className={styles.btnSecundario} onClick={() => setFormCompromissoAberto(v => !v)}>{formCompromissoAberto ? 'Fechar' : 'Comprometer tarefa'}</button>
              <button className={styles.btnSecundario} disabled={salvando} onClick={calcularFechamento}>Calcular fechamento</button>
              {perfil?.papel === 'admin' && <button className={styles.btnPrimario} disabled={salvando} onClick={fecharSemana}>Fechar semana</button>}
            </div>
          )}

          {formCompromissoAberto && semanaSelecionada.status === 'aberta' && (
            <div className={styles.formulario}>
              <div className={styles.formHeader}><h2>Comprometer tarefa</h2></div>
              <div className={styles.campos}>
                <label className={styles.campo}>Buscar tarefa sem restrição aberta<input value={buscaTarefaCompromisso} onChange={e => setBuscaTarefaCompromisso(e.target.value)} /></label>
                <label className={styles.campo}>Tarefa<select value={tarefaCompromissoId} onChange={e => setTarefaCompromissoId(e.target.value)}><option value="">Selecione</option>{tarefasElegiveis.map(t => <option key={t.id} value={t.id}>{t.nome} (atual: {percentuaisAtuais[t.id] ?? 0}%)</option>)}</select></label>
                <label className={styles.campo}>Meta de % pro fim da semana<input type="number" min={0} max={100} value={metaPercentual} onChange={e => setMetaPercentual(e.target.value)} /></label>
              </div>
              <div className={styles.acoesForm}><button className={styles.btnPrimario} disabled={salvando} onClick={adicionarCompromisso}>Comprometer</button></div>
            </div>
          )}

          {semanaSelecionada.status === 'fechada' && <div className={styles.msgOk}>Semana fechada. PPC: {semanaSelecionada.ppc}%</div>}

          {compromissos.length === 0 ? <div className={styles.vazio}>Nenhuma tarefa comprometida nesta semana.</div> : (
            <table className={styles.tabela}>
              <thead><tr><th>Tarefa</th><th>Início</th><th>Meta</th><th>Real</th><th>Cumprida</th><th>Motivo</th></tr></thead>
              <tbody>{compromissos.map(c => (
                <tr key={c.id}>
                  <td data-label="Tarefa">{tarefaPorId.get(c.tarefa_id)?.nome ?? 'Tarefa não encontrada'}</td>
                  <td data-label="Início">{c.percentual_inicio}%</td>
                  <td data-label="Meta">{c.meta_percentual}%</td>
                  <td data-label="Real">{c.percentual_fim ?? '-'}{c.percentual_fim != null ? '%' : ''}</td>
                  <td data-label="Cumprida">{c.cumprido == null ? '-' : c.cumprido ? <span className={styles.chipResolvida + ' ' + styles.chip}>Sim</span> : <span className={styles.chipAberta + ' ' + styles.chip}>Não</span>}</td>
                  <td data-label="Motivo">
                    {c.cumprido === false && semanaSelecionada.status === 'aberta' ? (
                      <select value={c.motivo_categoria ?? ''} onChange={e => { if (e.target.value) atualizarMotivo(c, e.target.value as CategoriaRestricao, c.motivo_observacao ?? '') }}>
                        <option value="">Selecione o motivo</option>
                        {(Object.keys(CATEGORIA_LABEL) as CategoriaRestricao[]).map(cat => <option key={cat} value={cat}>{CATEGORIA_LABEL[cat]}</option>)}
                      </select>
                    ) : c.motivo_categoria ? CATEGORIA_LABEL[c.motivo_categoria] : '-'}
                  </td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </>}
      </>}
```

- [ ] **Passo 4: Rodar o typecheck**

Rode: `npm run build`
Esperado: build completa sem erro.

- [ ] **Passo 5: Verificação manual no navegador**

1. Criar uma semana nova (início/fim).
2. "Comprometer tarefa": confirme que a busca **não** lista nenhuma tarefa que tenha restrição
   aberta (cadastre uma restrição na aba Mensal antes, pra uma tarefa, e confirme que ela some
   da lista de elegíveis aqui).
3. Definir meta acima do % atual e salvar — aparece na tabela com "Real" e "Cumprida" vazios.
4. "Calcular fechamento" — preenche "Real" e "Cumprida" pra cada compromisso, sem travar a
   semana ainda.
5. Pra um compromisso não cumprido, escolher o motivo — confirme que salva.
6. Como admin, "Fechar semana" — só funciona depois que todo não cumprido tiver motivo (tente
   sem preencher motivo primeiro pra confirmar que a mensagem de erro aparece).
7. Depois de fechada: PPC aparece, "Comprometer tarefa"/"Calcular fechamento"/"Fechar semana"
   somem, e tentar editar um compromisso (via alguma ação, se sobrar) deve falhar.

- [ ] **Passo 6: Commit**

```bash
git add src/pages/Planejamento.tsx
git commit -m "feat: implementa aba Semanal (compromisso e PPC) do modulo Planejamento"
```

---

### Task 5: Aba Trimestral — marcos por etapa

**Files:**
- Modify: `src/pages/Planejamento.tsx`

**Interfaces:**
- Consome: tabelas `etapas`, `cronograma_previsto`, `cronograma_versoes`, `avancos_fisicos`
  (via `tarefas`/`percentuaisAtuais` já carregados nas Tasks 3/4).
- Produz: nada consumido por outra task — última peça do módulo.

- [ ] **Passo 1: Carregar dados agregados da visão trimestral**

Adicione um estado e um `useEffect` próprio (a visão é só leitura, calculada uma vez que a
obra/tarefas estejam carregadas):

```tsx
  interface MarcoEtapa { etapaId: string; nome: string; dataFim: string | null; percentualMedio: number }
  const [marcos, setMarcos] = useState<MarcoEtapa[]>([])

  useEffect(() => {
    if (!obraAtiva || tarefas.length === 0) { setMarcos([]); return }
    async function carregarMarcos() {
      const versaoResp = await supabase.from('cronograma_versoes').select('id').eq('obra_id', obraAtiva!.id).eq('vigente', true).eq('ativo', true).maybeSingle()
      if (!versaoResp.data) { setMarcos([]); return }
      const previstoResp = await supabase.from('cronograma_previsto').select('tarefa_id, fim').eq('versao_id', versaoResp.data.id)
      const fimPorTarefa = new Map((previstoResp.data ?? []).map(p => [p.tarefa_id, p.fim]))

      const porEtapa = new Map<string, { nome: string; tarefaIds: string[] }>()
      for (const t of tarefas) {
        if (!t.etapa_id) continue
        const atual = porEtapa.get(t.etapa_id) ?? { nome: t.etapas?.nome ?? 'Etapa', tarefaIds: [] }
        atual.tarefaIds.push(t.id)
        porEtapa.set(t.etapa_id, atual)
      }

      const lista: MarcoEtapa[] = []
      for (const [etapaId, info] of porEtapa) {
        const datasFim = info.tarefaIds.map(id => fimPorTarefa.get(id)).filter((d): d is string => !!d)
        const dataFim = datasFim.length > 0 ? datasFim.sort().at(-1)! : null
        const percentuais = info.tarefaIds.map(id => percentuaisAtuais[id] ?? 0)
        const percentualMedio = percentuais.length > 0 ? Math.round(percentuais.reduce((a, b) => a + b, 0) / percentuais.length) : 0
        lista.push({ etapaId, nome: info.nome, dataFim, percentualMedio })
      }
      lista.sort((a, b) => (a.dataFim ?? '9999-99-99').localeCompare(b.dataFim ?? '9999-99-99'))
      setMarcos(lista)
    }
    carregarMarcos()
  }, [obraAtiva, tarefas, percentuaisAtuais])
```

- [ ] **Passo 2: Renderizar a aba Trimestral**

Logo depois do bloco da aba Semanal (fim da Task 4), adicione:

```tsx
      {!carregando && aba === 'trimestral' && <>
        {marcos.length === 0 ? <div className={styles.vazio}>Nenhuma versão vigente do cronograma encontrada para esta obra.</div> : (
          <table className={styles.tabela}>
            <thead><tr><th>Etapa</th><th>Previsão de término</th><th>Avanço médio</th></tr></thead>
            <tbody>{marcos.map(m => (
              <tr key={m.etapaId}>
                <td data-label="Etapa">{m.nome}</td>
                <td data-label="Previsão de término">{m.dataFim ? fmtData(m.dataFim) : 'Sem data prevista'}</td>
                <td data-label="Avanço médio">{m.percentualMedio}%</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </>}
```

- [ ] **Passo 3: Rodar o typecheck**

Rode: `npm run build`
Esperado: build completa sem erro.

- [ ] **Passo 4: Verificação manual no navegador**

1. Aba Trimestral mostra uma linha por etapa que tem tarefa vinculada, com data de término
   prevista (da versão vigente do cronograma) e % médio de avanço.
2. Nenhum controle de edição aparece nesta aba (só leitura).
3. Reduza a janela pra menos de 860px — confirme que a tabela empilha em cards, como no resto
   do app.

- [ ] **Passo 5: Commit**

```bash
git add src/pages/Planejamento.tsx
git commit -m "feat: implementa aba Trimestral (marcos por etapa) do modulo Planejamento"
```

---

## Critérios de aceite (repetidos da spec, pra conferência final)

- [ ] Restrição vinculada a uma tarefa do cronograma; mudança de data na tarefa reflete na
      tela sem duplicar dado.
- [ ] Tarefa com restrição aberta não pode ser adicionada a um compromisso semanal (bloqueado
      no banco).
- [ ] Resolver restrição grava autor e data; não pode ser reaberta.
- [ ] Meta de % da semana precisa ser maior que o ponto de partida e no máximo 100.
- [ ] Fechar semana com compromisso não cumprido sem motivo é bloqueado, com mensagem clara.
- [ ] PPC calculado corretamente e gravado só no fechamento.
- [ ] Semana fechada não aceita alteração em seus compromissos, sem exceção pra admin.
- [ ] Visão trimestral mostra data prevista e % médio por etapa, sem exigir cadastro novo.
- [ ] Cliente não vê nenhuma tela do módulo.
- [ ] Isolamento entre obras preservado.
- [ ] Migração versionada em `supabase/migrations`.
- [ ] Advisor de segurança sem achado novo de `function_search_path_mutable` nas funções deste
      módulo.
- [ ] Rodrigo testou com restrições e uma semana real e deu aceite.
