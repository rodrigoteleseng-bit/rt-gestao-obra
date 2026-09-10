# Controle Tecnológico do Concreto — Fase 1 (sem pintura) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar o controle técnico completo do concreto usinado (lançar caminhão, acompanhar
prazo de 30 dias, anexar/validar laudo, pendência automática se reprovado) usando **anexo de
foto/PDF já marcado** para o mapa de concretagem — sem a ferramenta de pintura em app, que fica
para a Fase 2 (plano separado).

**Architecture:** 3 tabelas novas (`ct_plantas` — schema completo, mas não usada por nenhuma tela
nesta fase; `ct_concretagens`; `ct_caminhoes`), RLS espelhando o par leitura-aberta/escrita-
restrita já usado em `contratos_itens`, bucket privado `controle-tecnologico` com o mesmo padrão
de anexo (upload + URL assinada) implementado esta semana em Contratos. Frontend novo sob
`/controle-tecnologico`, terceiro item do grupo "Qualidade" no menu, ao lado de FVS e Pendências.

**Tech Stack:** Supabase (Postgres + RLS + Storage) + React 19 + TypeScript + Vite. Sem framework
de testes — verificação por SQL direto (`apply_migration`/`execute_sql`) e `npm run build` +
teste manual no navegador.

## Global Constraints

- Spec completa: `docs/superpowers/specs/2026-09-09-controle-tecnologico-concreto-design.md` —
  ler antes de implementar qualquer task.
- **Escopo desta Fase 1**: a tela de criar concretagem só oferece a opção "anexar foto/PDF já
  marcado" — a opção "usar planta do catálogo" (e a ferramenta de pintura) fica reservada para a
  Fase 2. O schema já inclui as colunas/tabela pra isso (`ct_plantas`, `ct_concretagens.planta_id`,
  `ct_concretagens.pavimento_identificacao`, `ct_caminhoes.pintura_url`) — ficam presentes mas
  sempre `NULL`/vazias nesta fase, pra não precisar de uma migração de `ALTER TABLE` quebrando o
  `CHECK` de novo quando a Fase 2 chegar.
- **PDF desta fase**: o "mapa" fica como anexo aberto separadamente na tela (URL assinada, mesmo
  padrão do anexo de contrato), **não embutido** dentro do PDF gerado — embutir o mapa pintado
  direto no PDF só faz sentido de verdade na Fase 2, quando a pintura é um PNG gerado pelo
  próprio app (fácil de inserir com `addImage`); embutir um PDF/foto arbitrário anexado por fora
  exigiria uma biblioteca de rasterização que este app não usa em nenhum outro lugar. O PDF desta
  fase tem cabeçalho + legenda (tabela com todos os caminhões: cor, NF, amostra, horários, slump,
  status do laudo).
- Toda mudança de schema precisa de migração versionada em `supabase/migrations`.
- `ALTER TYPE modulo_app ADD VALUE 'controle_tecnologico'` precisa estar em migração **própria**,
  sem nenhuma referência ao valor na mesma transação (armadilha documentada em CLAUDE.md §0 —
  já causou retrabalho antes neste projeto).
- Regra de RLS pra soft delete (CLAUDE.md §3): toda policy de SELECT que filtra por `ativo = true`
  precisa `OR pode_editar_controle_tecnologico()`, nunca só `ativo = true`.
- **Anexar/validar laudo (aprovar/reprovar): exclusivo do admin, travado em nível de banco**
  (trigger), não só na interface — mesmo padrão de "aprovação exclusiva do admin" de Medições/FVS.
  Lançar caminhão, pintar (Fase 2), finalizar concretagem: admin ou equipe com o módulo
  `controle_tecnologico`.
- Cliente não acessa nada deste submódulo — sem exceção.
- Vínculo à hierarquia vai só até **Unidade** (decisão explícita do Rodrigo, ver spec §2 nota).
- Bucket `controle-tecnologico`: privado, PDF + imagem, 25MB — mesmo limite já usado em
  `producao-plantas`/`contratos-assinados`.
- Toda função `SECURITY DEFINER` precisa de `SET search_path = public` desde a criação.

---

### Task 1: Migração — enum, tabelas, RLS, bucket

**Files:**
- Create: `supabase/migrations/20260909_ct_modulo_enum.sql`
- Create: `supabase/migrations/20260909_ct_schema.sql`

**Interfaces:**
- Produces: valor `'controle_tecnologico'` em `modulo_app`; tabelas `ct_plantas`,
  `ct_concretagens`, `ct_caminhoes`; função `pode_editar_controle_tecnologico()`; bucket
  `controle-tecnologico`. Usados pelas Tasks 2-5.

- [ ] **Step 1: Migração do enum (isolada)**

Criar `supabase/migrations/20260909_ct_modulo_enum.sql`:

```sql
-- Valor novo do enum precisa estar isolado, sem nada na mesma transação
-- que o referencie (ALTER TYPE ... ADD VALUE não pode ser usado e
-- referenciado na mesma transação — CLAUDE.md §0).
ALTER TYPE modulo_app ADD VALUE 'controle_tecnologico';
```

- [ ] **Step 2: Aplicar e verificar**

Aplicar via `mcp__claude_ai_Supabase__apply_migration` (nome `ct_modulo_enum`), depois:

```sql
SELECT enumlabel FROM pg_enum JOIN pg_type ON pg_type.oid = pg_enum.enumtypid
WHERE pg_type.typname = 'modulo_app' ORDER BY enumsortorder;
-- Esperado: lista atual + 'controle_tecnologico' no final
```

- [ ] **Step 3: Escrever a migração do schema**

Criar `supabase/migrations/20260909_ct_schema.sql`:

```sql
-- Controle Tecnológico do concreto usinado (Qualidade — 3º submódulo, ao
-- lado de FVS e Pendências). Ver docs/superpowers/specs/2026-09-09-controle-tecnologico-concreto-design.md
-- Fase 1: schema completo, mas ct_plantas/planta_id/pintura_url ficam
-- sem uso até a Fase 2 (ferramenta de pintura) — evita ALTER TABLE
-- quebrando o CHECK de novo quando essa fase chegar.

CREATE TABLE ct_plantas (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  obra_id       UUID NOT NULL REFERENCES obras(id),
  nome          TEXT NOT NULL CHECK (btrim(nome) <> ''),
  reutilizavel  BOOLEAN NOT NULL DEFAULT false,
  pdf_path      TEXT NOT NULL,
  imagem_path   TEXT NOT NULL,
  ativo         BOOLEAN NOT NULL DEFAULT true,
  criado_por    UUID NOT NULL DEFAULT auth.uid() REFERENCES perfis_usuario(id),
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TYPE status_concretagem AS ENUM ('aberta', 'finalizada');

CREATE TABLE ct_concretagens (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  obra_id                 UUID NOT NULL REFERENCES obras(id),
  unidade_id              UUID NOT NULL REFERENCES unidades(id),
  planta_id               UUID REFERENCES ct_plantas(id),
  pavimento_identificacao TEXT,
  anexo_url               TEXT,
  data                    DATE NOT NULL,
  status                  status_concretagem NOT NULL DEFAULT 'aberta',
  finalizada_por          UUID REFERENCES perfis_usuario(id),
  finalizada_em           TIMESTAMPTZ,
  ativo                   BOOLEAN NOT NULL DEFAULT true,
  criado_por              UUID NOT NULL DEFAULT auth.uid() REFERENCES perfis_usuario(id),
  criado_em               TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ct_concretagem_planta_xor_anexo CHECK (
    (planta_id IS NOT NULL AND anexo_url IS NULL) OR
    (planta_id IS NULL AND anexo_url IS NOT NULL)
  )
);
CREATE INDEX idx_ct_concretagens_obra ON ct_concretagens(obra_id);
CREATE INDEX idx_ct_concretagens_unidade ON ct_concretagens(unidade_id);

CREATE TYPE status_laudo_concreto AS ENUM ('pendente', 'aprovado', 'reprovado');

CREATE TABLE ct_caminhoes (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  concretagem_id        UUID NOT NULL REFERENCES ct_concretagens(id),
  fornecedor            TEXT NOT NULL CHECK (btrim(fornecedor) <> ''),
  nf                    TEXT NOT NULL CHECK (btrim(nf) <> ''),
  numero_amostra        TEXT NOT NULL CHECK (btrim(numero_amostra) <> ''),
  hora_saida_usina      TIMESTAMPTZ,
  hora_chegada_obra     TIMESTAMPTZ,
  hora_inicio_descarga  TIMESTAMPTZ,
  hora_fim_descarga     TIMESTAMPTZ,
  volume_m3             NUMERIC(8,2) NOT NULL CHECK (volume_m3 > 0),
  slump_solicitado_cm   NUMERIC(5,1),
  slump_medido_cm       NUMERIC(5,1),
  cor                   TEXT NOT NULL CHECK (cor ~* '^#[0-9a-f]{6}$'),
  pintura_url           TEXT,
  status_laudo          status_laudo_concreto NOT NULL DEFAULT 'pendente',
  laudo_url             TEXT,
  laudo_anexado_em      TIMESTAMPTZ,
  validado_por          UUID REFERENCES perfis_usuario(id),
  validado_em           TIMESTAMPTZ,
  pendencia_id          UUID REFERENCES pendencias(id),
  ativo                 BOOLEAN NOT NULL DEFAULT true,
  criado_por            UUID NOT NULL DEFAULT auth.uid() REFERENCES perfis_usuario(id),
  criado_em             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_ct_caminhoes_concretagem ON ct_caminhoes(concretagem_id);
CREATE INDEX idx_ct_caminhoes_status_laudo ON ct_caminhoes(status_laudo) WHERE status_laudo = 'pendente';

-- ── RLS ──
ALTER TABLE ct_plantas       ENABLE ROW LEVEL SECURITY;
ALTER TABLE ct_concretagens  ENABLE ROW LEVEL SECURITY;
ALTER TABLE ct_caminhoes     ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION pode_editar_controle_tecnologico()
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT meu_papel() = 'admin'
    OR (meu_papel() = 'equipe' AND 'controle_tecnologico' = ANY(meus_modulos()))
$$;

CREATE POLICY ct_plantas_select ON ct_plantas FOR SELECT
  USING ((ativo = true AND meu_papel() = ANY (ARRAY['admin', 'equipe']::papel_usuario[])) OR pode_editar_controle_tecnologico());
CREATE POLICY ct_plantas_insert ON ct_plantas FOR INSERT
  WITH CHECK (pode_editar_controle_tecnologico());
CREATE POLICY ct_plantas_update ON ct_plantas FOR UPDATE
  USING (pode_editar_controle_tecnologico()) WITH CHECK (pode_editar_controle_tecnologico());

CREATE POLICY ct_concretagens_select ON ct_concretagens FOR SELECT
  USING ((ativo = true AND meu_papel() = ANY (ARRAY['admin', 'equipe']::papel_usuario[])) OR pode_editar_controle_tecnologico());
CREATE POLICY ct_concretagens_insert ON ct_concretagens FOR INSERT
  WITH CHECK (pode_editar_controle_tecnologico());
CREATE POLICY ct_concretagens_update ON ct_concretagens FOR UPDATE
  USING (pode_editar_controle_tecnologico()) WITH CHECK (pode_editar_controle_tecnologico());

CREATE POLICY ct_caminhoes_select ON ct_caminhoes FOR SELECT
  USING ((ativo = true AND meu_papel() = ANY (ARRAY['admin', 'equipe']::papel_usuario[])) OR pode_editar_controle_tecnologico());
CREATE POLICY ct_caminhoes_insert ON ct_caminhoes FOR INSERT
  WITH CHECK (pode_editar_controle_tecnologico());
CREATE POLICY ct_caminhoes_update ON ct_caminhoes FOR UPDATE
  USING (pode_editar_controle_tecnologico()) WITH CHECK (pode_editar_controle_tecnologico());

-- ── Storage ──
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('controle-tecnologico', 'controle-tecnologico', false, 26214400, ARRAY['application/pdf', 'image/*'])
ON CONFLICT (id) DO NOTHING;

CREATE POLICY ct_storage_select ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'controle-tecnologico' AND meu_papel() IN ('admin', 'equipe'));
CREATE POLICY ct_storage_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'controle-tecnologico' AND pode_editar_controle_tecnologico());
```

- [ ] **Step 4: Aplicar a migração**

Aplicar via `mcp__claude_ai_Supabase__apply_migration` (nome `ct_schema`).

- [ ] **Step 5: Verificar**

```sql
SELECT table_name FROM information_schema.tables
WHERE table_name IN ('ct_plantas','ct_concretagens','ct_caminhoes');
-- Esperado: as 3

SELECT policyname FROM pg_policies WHERE tablename IN ('ct_plantas','ct_concretagens','ct_caminhoes');
-- Esperado: 9 policies (3 por tabela)

SELECT id, public, file_size_limit, allowed_mime_types FROM storage.buckets WHERE id = 'controle-tecnologico';
-- Esperado: public=false, file_size_limit=26214400, allowed_mime_types={application/pdf,image/*}

-- Testa o CHECK (nem planta_id nem anexo_url preenchidos deve falhar).
-- Sem BEGIN/ROLLBACK: a violação de CHECK já impede o INSERT, não há nada
-- pra desfazer. Usa a obra piloto real (id fixo conhecido) e busca
-- qualquer Unidade dela por subquery — sem `\gset` (isso é comando de
-- cliente psql, não roda pela ferramenta de SQL usada neste projeto).
INSERT INTO ct_concretagens (obra_id, unidade_id, data)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  (SELECT id FROM unidades WHERE obra_id = '00000000-0000-0000-0000-000000000001' LIMIT 1),
  CURRENT_DATE
);
-- Esperado: erro de CHECK constraint "ct_concretagem_planta_xor_anexo"
```

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260909_ct_modulo_enum.sql supabase/migrations/20260909_ct_schema.sql
git commit -m "feat: adiciona schema do Controle Tecnologico do concreto (tabelas, RLS, bucket)"
```

---

### Task 2: Migração — trigger admin-only de laudo e pendência automática

**Files:**
- Create: `supabase/migrations/20260909_ct_triggers.sql`

**Interfaces:**
- Consumes: tabelas da Task 1; tabela `pendencias`/`pendencia_eventos` (já existentes, ver
  `supabase/migrations/20260709_fase5_pendencias.sql:13-33`).
- Produces: coluna `pendencias.ct_caminhao_id`; triggers `trg_ct_restringir_laudo` e
  `trg_ct_gerar_pendencia` em `ct_caminhoes`. Usados pela Task 5 (frontend de laudo).

- [ ] **Step 1: Escrever a migração**

Criar `supabase/migrations/20260909_ct_triggers.sql`:

```sql
-- Rastreabilidade de volta: de qual caminhão essa pendência veio (mesmo
-- padrão já usado em pendencias.fvs_id, ver 20260709_fase5_fvs.sql:97).
ALTER TABLE pendencias ADD COLUMN ct_caminhao_id UUID REFERENCES ct_caminhoes(id);
CREATE INDEX idx_pendencias_ct_caminhao ON pendencias(ct_caminhao_id);

-- Anexar/trocar o laudo e mudar status_laudo é exclusivo do admin, travado
-- no banco — mesmo padrão de "aprovação exclusiva do admin" já usado em
-- Medições/FVS, não só na interface.
CREATE OR REPLACE FUNCTION ct_restringir_laudo() RETURNS TRIGGER AS $$
BEGIN
  IF (NEW.status_laudo IS DISTINCT FROM OLD.status_laudo
      OR NEW.laudo_url IS DISTINCT FROM OLD.laudo_url)
     AND meu_papel() <> 'admin' THEN
    RAISE EXCEPTION 'Somente o admin pode anexar ou validar o laudo.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_ct_restringir_laudo
  BEFORE UPDATE ON ct_caminhoes
  FOR EACH ROW EXECUTE FUNCTION ct_restringir_laudo();

-- Laudo reprovado gera Pendência automática vinculada à Unidade da
-- concretagem — mesmo padrão já usado quando um item de FVS reprova
-- (ver 20260709_fase5_fvs.sql:238-248).
CREATE OR REPLACE FUNCTION ct_gerar_pendencia_reprovado() RETURNS TRIGGER AS $$
DECLARE
  v_obra_id    UUID;
  v_unidade_id UUID;
  v_pend_id    UUID;
BEGIN
  IF NEW.status_laudo = 'reprovado' AND OLD.status_laudo IS DISTINCT FROM 'reprovado' THEN
    SELECT obra_id, unidade_id INTO v_obra_id, v_unidade_id
    FROM ct_concretagens WHERE id = NEW.concretagem_id;

    INSERT INTO pendencias (obra_id, unidade_id, descricao, ct_caminhao_id, criado_por)
    VALUES (
      v_obra_id, v_unidade_id,
      'Concreto reprovado — amostra ' || NEW.numero_amostra || ', NF ' || NEW.nf
        || ', fornecedor ' || NEW.fornecedor,
      NEW.id, auth.uid()
    ) RETURNING id INTO v_pend_id;

    INSERT INTO pendencia_eventos (pendencia_id, status, comentario, criado_por)
    VALUES (v_pend_id, 'aberta',
      'Gerada automaticamente pelo Controle Tecnológico (laudo reprovado)', auth.uid());

    NEW.pendencia_id := v_pend_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_ct_gerar_pendencia
  BEFORE UPDATE ON ct_caminhoes
  FOR EACH ROW EXECUTE FUNCTION ct_gerar_pendencia_reprovado();
```

- [ ] **Step 2: Aplicar a migração**

Aplicar via `mcp__claude_ai_Supabase__apply_migration` (nome `ct_triggers`).

- [ ] **Step 3: Verificar com teste real (transação de teste, sem efeito permanente)**

Sem `\gset` (comando de cliente `psql`, não roda pela ferramenta de SQL usada neste projeto) —
usa a obra piloto real (id fixo) e reencontra as linhas de teste por uma chave natural
(`numero_amostra`) em vez de capturar o id gerado:

```sql
BEGIN;
SET LOCAL request.jwt.claims = '{"sub": "<uuid de um admin real>", "role": "authenticated"}';
SET LOCAL role authenticated;

-- monta uma concretagem + caminhão de teste
INSERT INTO ct_concretagens (obra_id, unidade_id, data, anexo_url)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  (SELECT id FROM unidades WHERE obra_id = '00000000-0000-0000-0000-000000000001' LIMIT 1),
  CURRENT_DATE, 'teste/teste.pdf'
);
INSERT INTO ct_caminhoes (concretagem_id, fornecedor, nf, numero_amostra, volume_m3, cor)
VALUES (
  (SELECT id FROM ct_concretagens WHERE anexo_url = 'teste/teste.pdf' ORDER BY criado_em DESC LIMIT 1),
  'Usina Teste', 'NF123', 'AM-001-TESTE', 8, '#C49A7A'
);

-- 1. equipe (sem ser admin) tentando mudar status_laudo deve falhar
SET LOCAL request.jwt.claims = '{"sub": "<uuid de equipe real, nao-admin>", "role": "authenticated"}';
UPDATE ct_caminhoes SET status_laudo = 'aprovado' WHERE numero_amostra = 'AM-001-TESTE';
-- Esperado: erro "Somente o admin pode anexar ou validar o laudo."

-- 2. admin reprovando deve gerar pendência
SET LOCAL request.jwt.claims = '{"sub": "<uuid de um admin real>", "role": "authenticated"}';
UPDATE ct_caminhoes SET status_laudo = 'reprovado' WHERE numero_amostra = 'AM-001-TESTE';
SELECT pendencia_id FROM ct_caminhoes WHERE numero_amostra = 'AM-001-TESTE';
-- Esperado: pendencia_id preenchido (não nulo)
SELECT descricao, unidade_id FROM pendencias
WHERE id = (SELECT pendencia_id FROM ct_caminhoes WHERE numero_amostra = 'AM-001-TESTE');
-- Esperado: descrição citando "AM-001-TESTE"/"NF123"/"Usina Teste", unidade_id = o mesmo da concretagem

ROLLBACK;
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260909_ct_triggers.sql
git commit -m "feat: trava laudo para admin e gera pendencia automatica no Controle Tecnologico"
```

---

### Task 3: Frontend — tipos, rotas, lista e criação de concretagem

**Files:**
- Modify: `src/lib/supabase.ts` (tipo `ModuloApp`, novas interfaces)
- Modify: `src/App.tsx` (rotas)
- Modify: `src/components/Layout.tsx` (menu)
- Modify: `src/pages/Usuarios.tsx` (rótulo do módulo novo)
- Create: `src/pages/ControleTecnologico.tsx` (lista de concretagens)
- Create: `src/pages/ControleTecnologico.module.css`
- Create: `src/pages/ControleTecnologicoForm.tsx` (criar/detalhe de uma concretagem — itens 4/5
  ficam pra próximas tasks, aqui só a criação e o cabeçalho)
- Create: `src/pages/ControleTecnologicoForm.module.css`

**Interfaces:**
- Consumes: tabelas/RLS da Task 1. Reaproveita `nomeArquivoStorage` (copiar de
  `src/pages/CompraForm.tsx:22-38`, mesmo aviso da Task 2 do plano de Contratos: **copie o
  arquivo, não retranscreva a regex de acentos à mão**) e o padrão de upload+URL assinada já
  usado em `ContratoForm.tsx` (`enviarAnexo`/`carregarUrls`, ver `ContratoForm.tsx:505-534,191-203`).
- Produces: rota `/controle-tecnologico` (lista) e `/controle-tecnologico/:id` (detalhe/nova,
  seguindo o padrão `:id === 'nova'` já usado em `MedicaoForm.tsx`); tipos `CtConcretagem`,
  `CtCaminhao`, `StatusConcretagem`, `StatusLaudoConcreto` em `src/lib/supabase.ts`, consumidos
  pelas Tasks 4 e 5.

- [ ] **Step 1: Atualizar `ModuloApp` em `src/lib/supabase.ts`**

Em `src/lib/supabase.ts:9-11`, trocar:

```ts
export type ModuloApp =
  | 'rdo' | 'avanco' | 'pendencias' | 'almoxarifado' | 'financeiro' | 'compras'
  | 'medicoes' | 'contratos' | 'fvs' | 'galeria' | 'efetivo' | 'alertas' | 'definicoes' | 'tarefas' | 'projetos' | 'planejamento'
```

por:

```ts
export type ModuloApp =
  | 'rdo' | 'avanco' | 'pendencias' | 'almoxarifado' | 'financeiro' | 'compras'
  | 'medicoes' | 'contratos' | 'fvs' | 'galeria' | 'efetivo' | 'alertas' | 'definicoes' | 'tarefas' | 'projetos' | 'planejamento'
  | 'controle_tecnologico'
```

- [ ] **Step 2: Adicionar os tipos novos em `src/lib/supabase.ts`**

Depois da interface `Pendencia` (que termina em `src/lib/supabase.ts:262`), adicionar:

```ts
export type StatusConcretagem = 'aberta' | 'finalizada'
export type StatusLaudoConcreto = 'pendente' | 'aprovado' | 'reprovado'

export interface CtConcretagem {
  id: string
  obra_id: string
  unidade_id: string
  planta_id: string | null
  pavimento_identificacao: string | null
  anexo_url: string | null
  data: string
  status: StatusConcretagem
  finalizada_por: string | null
  finalizada_em: string | null
  ativo: boolean
  criado_por: string
  criado_em: string
}

export interface CtCaminhao {
  id: string
  concretagem_id: string
  fornecedor: string
  nf: string
  numero_amostra: string
  hora_saida_usina: string | null
  hora_chegada_obra: string | null
  hora_inicio_descarga: string | null
  hora_fim_descarga: string | null
  volume_m3: number
  slump_solicitado_cm: number | null
  slump_medido_cm: number | null
  cor: string
  pintura_url: string | null
  status_laudo: StatusLaudoConcreto
  laudo_url: string | null
  laudo_anexado_em: string | null
  validado_por: string | null
  validado_em: string | null
  pendencia_id: string | null
  ativo: boolean
  criado_por: string
  criado_em: string
}
```

- [ ] **Step 3: Rótulo do módulo novo em `Usuarios.tsx`**

Em `src/pages/Usuarios.tsx:9-26`, dentro do objeto `MODULOS_LABELS`, adicionar a linha:

```ts
  controle_tecnologico: 'Controle Tecnológico',
```

(em qualquer posição dentro do objeto — é um `Record` sem ordem exigida; o TypeScript já vai
apontar erro de compilação se essa chave faltar, já que o tipo `ModuloApp` mudou no Step 1).

- [ ] **Step 4: Item de menu em `Layout.tsx`**

Em `src/components/Layout.tsx:59-62`, dentro do grupo `qualidade`, depois da linha do item
`pendencias` (`Layout.tsx:61`), adicionar:

```ts
      { type: 'link', key: 'controle_tecnologico', label: 'Controle Tecnológico', icon: '🧪', path: '/controle-tecnologico' },
```

- [ ] **Step 5: Rotas em `App.tsx`**

Em `src/App.tsx`, depois da linha `const Fvs Form = lazy(...)` (`App.tsx:31`), adicionar:

```ts
const ControleTecnologico = lazy(() => import('./pages/ControleTecnologico'))
const ControleTecnologicoForm = lazy(() => import('./pages/ControleTecnologicoForm'))
```

E depois da rota `fvs/:id` (`App.tsx:87`), adicionar:

```tsx
        <Route path="controle-tecnologico" element={<ControleTecnologico />} />
        <Route path="controle-tecnologico/:id" element={<ControleTecnologicoForm />} />
```

- [ ] **Step 6: Criar `src/pages/ControleTecnologico.tsx` (lista)**

Página de lista, seguindo exatamente o padrão de `src/pages/Contratos.tsx` (filtro por status,
cards clicáveis, botão "+ Nova concretagem", bloqueio pro papel `cliente`):

```tsx
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useObra } from '../contexts/ObraContext'
import { supabase, type CtConcretagem, type StatusConcretagem, type Unidade } from '../lib/supabase'
import styles from './ControleTecnologico.module.css'

export const STATUS_CONCRETAGEM_LABEL: Record<StatusConcretagem, string> = {
  aberta: 'Aberta',
  finalizada: 'Finalizada',
}

function fmtData(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`
}

export default function ControleTecnologico() {
  const { perfil, temModulo } = useAuth()
  const { obraAtiva } = useObra()
  const navigate = useNavigate()
  const podeEditar = perfil?.papel === 'admin' || temModulo('controle_tecnologico')

  const [concretagens, setConcretagens] = useState<CtConcretagem[]>([])
  const [unidades, setUnidades] = useState<Unidade[]>([])
  const [carregando, setCarregando] = useState(true)
  const [filtroStatus, setFiltroStatus] = useState<StatusConcretagem | ''>('')

  useEffect(() => {
    if (!obraAtiva) return
    setCarregando(true)
    Promise.all([
      supabase.from('ct_concretagens').select('*').eq('obra_id', obraAtiva.id).eq('ativo', true)
        .order('data', { ascending: false }),
      supabase.from('unidades').select('*').eq('obra_id', obraAtiva.id).order('ordem'),
    ]).then(([c, u]) => {
      setConcretagens(c.data ?? [])
      setUnidades(u.data ?? [])
      setCarregando(false)
    })
  }, [obraAtiva])

  const nomeUnidade = useMemo(() => new Map(unidades.map(u => [u.id, u.nome])), [unidades])

  const filtradas = useMemo(() => {
    return concretagens.filter(c => !filtroStatus || c.status === filtroStatus)
  }, [concretagens, filtroStatus])

  if (perfil?.papel === 'cliente') {
    return <div className={styles.page}><p className={styles.vazio}>Módulo de uso interno da equipe.</p></div>
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1>Controle Tecnológico</h1>
          <p className={styles.sub}>Concreto usinado — caminhões, amostras e laudos de ruptura.</p>
        </div>
        {podeEditar && (
          <button className={styles.btnNova} onClick={() => navigate('/controle-tecnologico/nova')}>+ Nova concretagem</button>
        )}
      </div>

      <div className={styles.filtros}>
        <select className={styles.selectFiltro} value={filtroStatus}
          onChange={e => setFiltroStatus(e.target.value as StatusConcretagem | '')}>
          <option value="">Todos os status</option>
          {(Object.keys(STATUS_CONCRETAGEM_LABEL) as StatusConcretagem[]).map(s => (
            <option key={s} value={s}>{STATUS_CONCRETAGEM_LABEL[s]}</option>
          ))}
        </select>
      </div>

      {carregando && <p className={styles.vazio}>Carregando…</p>}
      {!carregando && filtradas.length === 0 && (
        <p className={styles.vazio}>{concretagens.length === 0 ? 'Nenhuma concretagem registrada.' : 'Nenhuma concretagem com esse filtro.'}</p>
      )}

      {filtradas.map(c => (
        <button key={c.id} className={styles.card} onClick={() => navigate(`/controle-tecnologico/${c.id}`)}>
          <div className={styles.cardTopo}>
            <span className={styles.cardData}>{fmtData(c.data)}</span>
            <span className={`${styles.chip} ${styles[`chip_${c.status}`]}`}>{STATUS_CONCRETAGEM_LABEL[c.status]}</span>
          </div>
          <div className={styles.cardDesc}>{nomeUnidade.get(c.unidade_id) ?? '—'}</div>
        </button>
      ))}
    </div>
  )
}
```

- [ ] **Step 7: Criar `src/pages/ControleTecnologico.module.css`**

```css
.page { padding: 16px; max-width: 900px; margin: 0 auto; }
.header { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 14px; flex-wrap: wrap; }
.page h1 { font-size: 20px; margin: 0; }
.sub { font-size: 13px; color: var(--cinza-600); margin: 4px 0 0; }

.btnNova {
  background: var(--navy);
  color: #fff;
  border: none;
  border-radius: var(--radius-sm);
  padding: 10px 16px;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
}

.filtros { display: flex; gap: 10px; margin-bottom: 14px; flex-wrap: wrap; }
.selectFiltro { padding: 8px 10px; border: 1px solid var(--cinza-200); border-radius: var(--radius-sm); font-size: 13px; }

.vazio { color: var(--cinza-600); font-size: 14px; padding: 12px 0; }

.card {
  width: 100%;
  display: block;
  text-align: left;
  background: var(--branco);
  border: 1.5px solid var(--cinza-200);
  border-radius: var(--radius-md);
  padding: 12px 16px;
  margin-bottom: 8px;
  cursor: pointer;
}
.cardTopo { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 5px; }
.cardData { font-family: var(--font-titulo); font-weight: 700; color: var(--navy); font-size: 14px; }
.cardDesc { font-size: 14px; color: var(--cinza-800); }

.chip { font-size: 11px; font-weight: 700; padding: 3px 10px; border-radius: 999px; text-transform: uppercase; }
.chip_aberta { background: #eceff1; color: #546e7a; }
.chip_finalizada { background: #e3f4e3; color: #1e6b2e; }
```

- [ ] **Step 8: Criar `src/pages/ControleTecnologicoForm.tsx` (criação — só o cabeçalho por ora)**

Cria a concretagem (Unidade + anexo — planta do catálogo fica pra Fase 2) e mostra o cabeçalho de
uma concretagem existente. A lista de caminhões e o botão de finalizar/PDF entram na Task 4; o
acompanhamento de laudo entra na Task 5 — aqui eles aparecem como placeholders comentados que as
próximas tasks substituem, pra este arquivo já compilar e navegar corretamente.

**Primeiro**: `src/pages/CompraForm.tsx:22-38` já tem a função `nomeArquivoStorage` (sanitiza
nome de arquivo antes do upload). **Não retranscreva essa função à mão** — a regex de acentos usa
um range Unicode de marcas diacríticas fácil de corromper ao copiar/colar (já aconteceu nesta
mesma sessão, duas vezes). Abra `CompraForm.tsx`, copie as linhas 22-38 exatamente como estão, e
cole no topo de `ControleTecnologicoForm.tsx` (antes do `export default function`). Confirme com
`git diff` que ficou byte-idêntica à original antes de seguir.

**Depois**, o resto do arquivo:

```tsx
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useObra } from '../contexts/ObraContext'
import { supabase, type CtConcretagem, type Unidade } from '../lib/supabase'
import { STATUS_CONCRETAGEM_LABEL } from './ControleTecnologico'
import styles from './ControleTecnologicoForm.module.css'

// nomeArquivoStorage colada aqui (ver instrução acima — copiada de CompraForm.tsx:22-38)

export default function ControleTecnologicoForm() {
  const { id } = useParams()
  const nova = id === 'nova'
  const navigate = useNavigate()
  const { perfil, temModulo } = useAuth()
  const { obraAtiva } = useObra()
  const podeEditar = perfil?.papel === 'admin' || temModulo('controle_tecnologico')

  const [unidades, setUnidades] = useState<Unidade[]>([])
  const [unidadeId, setUnidadeId] = useState('')
  const [data, setData] = useState(() => new Date().toISOString().slice(0, 10))
  const [arquivo, setArquivo] = useState<File | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)

  const [concretagem, setConcretagem] = useState<CtConcretagem | null>(null)
  const [carregando, setCarregando] = useState(!nova)

  useEffect(() => {
    if (!obraAtiva) return
    supabase.from('unidades').select('*').eq('obra_id', obraAtiva.id).order('ordem')
      .then(({ data }) => setUnidades(data ?? []))
  }, [obraAtiva])

  useEffect(() => {
    if (nova || !id) return
    setCarregando(true)
    supabase.from('ct_concretagens').select('*').eq('id', id).single()
      .then(({ data }) => { setConcretagem(data ?? null); setCarregando(false) })
  }, [id, nova])

  async function criar() {
    if (!obraAtiva) return
    if (!unidadeId) { setMsg({ tipo: 'erro', texto: 'Selecione a Unidade.' }); return }
    if (!arquivo) { setMsg({ tipo: 'erro', texto: 'Anexe a foto ou o PDF do mapa de concretagem.' }); return }
    setSalvando(true)
    setMsg(null)
    const path = `${obraAtiva.id}/${crypto.randomUUID()}-${nomeArquivoStorage(arquivo.name)}`
    const { error: eUp } = await supabase.storage.from('controle-tecnologico').upload(path, arquivo)
    if (eUp) {
      setSalvando(false)
      setMsg({ tipo: 'erro', texto: `Falha no envio do arquivo: ${eUp.message}` })
      return
    }
    const { data: nova_, error } = await supabase.from('ct_concretagens').insert({
      obra_id: obraAtiva.id,
      unidade_id: unidadeId,
      anexo_url: path,
      data,
    }).select().single()
    setSalvando(false)
    if (error || !nova_) {
      setMsg({ tipo: 'erro', texto: `Erro ao criar concretagem: ${error?.message}` })
      return
    }
    navigate(`/controle-tecnologico/${nova_.id}`, { replace: true })
  }

  if (perfil?.papel === 'cliente') {
    return <div className={styles.page}><p className={styles.vazio}>Módulo de uso interno da equipe.</p></div>
  }
  if (nova && !podeEditar) {
    return <div className={styles.page}><p className={styles.vazio}>Você não tem permissão para criar concretagens.</p></div>
  }

  if (nova) {
    return (
      <div className={styles.page}>
        <button className={styles.voltar} onClick={() => navigate('/controle-tecnologico')}>← Controle Tecnológico</button>
        <h1>Nova concretagem</h1>
        <div className={styles.bloco}>
          <label className={styles.campo}>
            Unidade *
            <select value={unidadeId} onChange={e => setUnidadeId(e.target.value)}>
              <option value="">Selecione…</option>
              {unidades.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}
            </select>
          </label>
          <label className={styles.campo}>
            Data *
            <input type="date" value={data} onChange={e => setData(e.target.value)} />
          </label>
          <label className={styles.campo}>
            Mapa de concretagem — foto ou PDF já marcado *
            <input type="file" accept="application/pdf,image/*" onChange={e => setArquivo(e.target.files?.[0] ?? null)} />
          </label>
        </div>
        {msg && <p className={msg.tipo === 'ok' ? styles.msgOk : styles.msgErro}>{msg.texto}</p>}
        <button className={styles.btnPrincipal} onClick={criar} disabled={salvando}>
          {salvando ? 'Criando…' : 'Criar concretagem'}
        </button>
      </div>
    )
  }

  if (carregando) return <div className={styles.page}><p className={styles.vazio}>Carregando…</p></div>
  if (!concretagem) return <div className={styles.page}><p className={styles.vazio}>Concretagem não encontrada.</p></div>

  return (
    <div className={styles.page}>
      <button className={styles.voltar} onClick={() => navigate('/controle-tecnologico')}>← Controle Tecnológico</button>
      <div className={styles.header}>
        <h1>{concretagem.data.slice(8, 10)}/{concretagem.data.slice(5, 7)}/{concretagem.data.slice(0, 4)}</h1>
        <span className={styles.chip}>{STATUS_CONCRETAGEM_LABEL[concretagem.status]}</span>
      </div>
      {/* Task 4 adiciona aqui: lista de caminhões, "+ Lançar caminhão", "Finalizar concretagem" e o PDF. */}
      {/* Task 5 adiciona aqui: acompanhamento/validação do laudo por caminhão. */}
    </div>
  )
}
```

- [ ] **Step 9: Criar `src/pages/ControleTecnologicoForm.module.css`**

```css
.page { padding: 16px; max-width: 900px; margin: 0 auto; }
.voltar { background: none; border: none; color: var(--navy); font-size: 13px; font-weight: 600; cursor: pointer; padding: 0; margin-bottom: 10px; }
.header { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-bottom: 14px; }
.page h1 { font-size: 20px; margin: 0; }

.bloco { background: var(--branco); border: 1px solid var(--cinza-200); border-radius: var(--radius-md); padding: 14px 16px; margin-bottom: 14px; }
.bloco h2 { font-size: 14px; color: var(--navy); margin: 0 0 10px; }

.campo { display: block; font-size: 12px; font-weight: 600; color: var(--cinza-700); margin-bottom: 12px; }
.campo input, .campo select, .campo textarea {
  display: block;
  width: 100%;
  margin-top: 4px;
  padding: 9px 10px;
  border: 1px solid var(--cinza-200);
  border-radius: var(--radius-sm);
  font-size: 14px;
  font-family: inherit;
  box-sizing: border-box;
}

.chip { font-size: 11px; font-weight: 700; padding: 3px 10px; border-radius: 999px; text-transform: uppercase; background: #eceff1; color: #546e7a; }

.btnPrincipal {
  background: var(--navy);
  color: #fff;
  border: none;
  border-radius: var(--radius-sm);
  padding: 12px 16px;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
}
.btnPrincipal:disabled { opacity: 0.6; cursor: default; }

.msgOk { color: #1e6b2e; font-weight: 600; font-size: 13px; padding: 6px 0; }
.msgErro { color: #a33030; font-weight: 600; font-size: 13px; padding: 6px 0; }
.vazio { color: var(--cinza-600); font-size: 14px; padding: 12px 0; }
```

- [ ] **Step 10: Build e teste manual**

```bash
npm run build
```

Testar no navegador como admin: abrir `/controle-tecnologico`, confirmar que a tela carrega
vazia ("Nenhuma concretagem registrada"), clicar "+ Nova concretagem", preencher Unidade + data +
anexar um PDF pequeno de teste, criar — confirmar que abre o detalhe da concretagem recém-criada
com o cabeçalho certo. Testar como equipe sem o módulo `controle_tecnologico`: não vê o botão
"+ Nova concretagem" na lista. Testar como cliente: tela mostra "Módulo de uso interno da
equipe."

- [ ] **Step 11: Commit**

```bash
git add src/lib/supabase.ts src/App.tsx src/components/Layout.tsx src/pages/Usuarios.tsx src/pages/ControleTecnologico.tsx src/pages/ControleTecnologico.module.css src/pages/ControleTecnologicoForm.tsx src/pages/ControleTecnologicoForm.module.css
git commit -m "feat: cria o modulo Controle Tecnologico (lista + criacao de concretagem)"
```

---

### Task 4: Frontend — lançar caminhão, finalizar concretagem e PDF

**Files:**
- Modify: `src/pages/ControleTecnologicoForm.tsx`
- Modify: `src/pages/ControleTecnologicoForm.module.css`
- Create: `src/lib/controleTecnologicoPdf.ts`

**Interfaces:**
- Consumes: `CtCaminhao`, `CtConcretagem` (Task 3); `carregarIdentidadeObra`/`larguraProporcional`
  de `../lib/pdfBranding` (mesmo padrão de todo PDF do app, ver `src/lib/medicoesPdf.ts:8`);
  `formatarMoeda`-equivalente não é necessário aqui (não há valores financeiros neste PDF).
- Produces: `gerarPdfConcretagem(d: DadosPdfConcretagem): void`, exportada de
  `controleTecnologicoPdf.ts`, chamada pelo botão "Finalizar concretagem" em
  `ControleTecnologicoForm.tsx`.

- [ ] **Step 1: Adicionar o formulário de "Lançar caminhão" e a lista de caminhões**

Em `src/pages/ControleTecnologicoForm.tsx`, adicionar os estados (junto aos existentes, antes da
função `criar`):

```ts
  const [caminhoes, setCaminhoes] = useState<CtCaminhao[]>([])
  const [mostrarFormCaminhao, setMostrarFormCaminhao] = useState(false)
  const [fFornecedor, setFFornecedor] = useState('')
  const [fNf, setFNf] = useState('')
  const [fAmostra, setFAmostra] = useState('')
  const [fVolume, setFVolume] = useState('')
  const [fSlumpSolicitado, setFSlumpSolicitado] = useState('')
  const [fSlumpMedido, setFSlumpMedido] = useState('')
  const [fHoraSaida, setFHoraSaida] = useState('')
  const [fHoraChegada, setFHoraChegada] = useState('')
  const [fHoraInicioDescarga, setFHoraInicioDescarga] = useState('')
  const [fHoraFimDescarga, setFHoraFimDescarga] = useState('')
  const [fCor, setFCor] = useState('#C49A7A')
  const [salvandoCaminhao, setSalvandoCaminhao] = useState(false)
  const [msgCaminhao, setMsgCaminhao] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)
  const [finalizando, setFinalizando] = useState(false)
```

Import `CtCaminhao` no topo (junto com os outros tipos já importados de `../lib/supabase`).

Adicionar `carregarCaminhoes` e chamá-la no `useEffect` que já carrega a concretagem (logo depois
de `setConcretagem`):

```ts
  async function carregarCaminhoes(concretagemId: string) {
    const { data } = await supabase.from('ct_caminhoes').select('*')
      .eq('concretagem_id', concretagemId).eq('ativo', true)
      .order('criado_em')
    setCaminhoes(data ?? [])
  }
```

No `useEffect` existente (Step 8 da Task 3), trocar:

```ts
    supabase.from('ct_concretagens').select('*').eq('id', id).single()
      .then(({ data }) => { setConcretagem(data ?? null); setCarregando(false) })
```

por:

```ts
    supabase.from('ct_concretagens').select('*').eq('id', id).single()
      .then(({ data }) => {
        setConcretagem(data ?? null)
        setCarregando(false)
        if (data) carregarCaminhoes(data.id)
      })
```

Um campo `datetime-local` grava como `"2026-09-09T14:30"` (sem timezone) — converta para ISO com
`new Date(valor).toISOString()` antes de gravar, e trate string vazia como `null`:

```ts
  function horaOuNulo(valor: string): string | null {
    return valor ? new Date(valor).toISOString() : null
  }

  async function lancarCaminhao() {
    if (!concretagem) return
    if (!fFornecedor.trim() || !fNf.trim() || !fAmostra.trim() || !fVolume) {
      setMsgCaminhao({ tipo: 'erro', texto: 'Preencha fornecedor, NF, amostra e volume.' })
      return
    }
    setSalvandoCaminhao(true)
    setMsgCaminhao(null)
    const { error } = await supabase.from('ct_caminhoes').insert({
      concretagem_id: concretagem.id,
      fornecedor: fFornecedor.trim(),
      nf: fNf.trim(),
      numero_amostra: fAmostra.trim(),
      volume_m3: Number(fVolume),
      slump_solicitado_cm: fSlumpSolicitado ? Number(fSlumpSolicitado) : null,
      slump_medido_cm: fSlumpMedido ? Number(fSlumpMedido) : null,
      hora_saida_usina: horaOuNulo(fHoraSaida),
      hora_chegada_obra: horaOuNulo(fHoraChegada),
      hora_inicio_descarga: horaOuNulo(fHoraInicioDescarga),
      hora_fim_descarga: horaOuNulo(fHoraFimDescarga),
      cor: fCor,
    })
    setSalvandoCaminhao(false)
    if (error) {
      setMsgCaminhao({ tipo: 'erro', texto: `Erro ao lançar caminhão: ${error.message}` })
      return
    }
    setFFornecedor(''); setFNf(''); setFAmostra(''); setFVolume('')
    setFSlumpSolicitado(''); setFSlumpMedido('')
    setFHoraSaida(''); setFHoraChegada(''); setFHoraInicioDescarga(''); setFHoraFimDescarga('')
    setFCor('#C49A7A')
    setMostrarFormCaminhao(false)
    carregarCaminhoes(concretagem.id)
  }
```

- [ ] **Step 2: Adicionar `finalizarConcretagem` e `imprimir`**

```ts
  async function finalizarConcretagem() {
    if (!concretagem) return
    setFinalizando(true)
    const { error } = await supabase.from('ct_concretagens').update({
      status: 'finalizada', finalizada_por: perfil?.id, finalizada_em: new Date().toISOString(),
    }).eq('id', concretagem.id)
    setFinalizando(false)
    if (error) { setMsgCaminhao({ tipo: 'erro', texto: `Erro ao finalizar: ${error.message}` }); return }
    setConcretagem(prev => prev ? { ...prev, status: 'finalizada' } : prev)
  }

  async function imprimir() {
    if (!concretagem || !obraAtiva) return
    const { gerarPdfConcretagem } = await import('../lib/controleTecnologicoPdf')
    const { data: obraRow } = await supabase.from('obras')
      .select('nome, logo_url, rodape_pdf').eq('id', obraAtiva.id).maybeSingle()
    const { carregarIdentidadeObra } = await import('../lib/pdfBranding')
    const identidade = await carregarIdentidadeObra(obraRow)
    const nomeUnidadeAtual = unidades.find(u => u.id === concretagem.unidade_id)?.nome ?? '—'
    gerarPdfConcretagem({
      concretagem, caminhoes, identidade,
      obraNome: obraRow?.nome ?? '—',
      unidadeNome: nomeUnidadeAtual,
    })
  }
```

- [ ] **Step 3: JSX — lista de caminhões, formulário, botões**

No `return` do estado "não é nova" (depois do comentário `{/* Task 4 adiciona aqui... */}` da
Task 3, Step 8), trocar esse comentário por:

```tsx
      <div className={styles.bloco}>
        <div className={styles.header} style={{ marginBottom: 10 }}>
          <h2 style={{ margin: 0, fontSize: 14, color: 'var(--navy)' }}>Caminhões</h2>
          {podeEditar && concretagem.status === 'aberta' && (
            <button className={styles.btnSecundario} onClick={() => setMostrarFormCaminhao(v => !v)}>
              {mostrarFormCaminhao ? 'Cancelar' : '+ Lançar caminhão'}
            </button>
          )}
        </div>

        {mostrarFormCaminhao && (
          <div className={styles.formCaminhao}>
            <label className={styles.campo}>Fornecedor (usina) *
              <input value={fFornecedor} onChange={e => setFFornecedor(e.target.value)} /></label>
            <label className={styles.campo}>NF *
              <input value={fNf} onChange={e => setFNf(e.target.value)} /></label>
            <label className={styles.campo}>Nº da amostra (laboratório) *
              <input value={fAmostra} onChange={e => setFAmostra(e.target.value)} /></label>
            <label className={styles.campo}>Volume (m³) *
              <input type="number" min="0" step="0.1" value={fVolume} onChange={e => setFVolume(e.target.value)} /></label>
            <label className={styles.campo}>Slump solicitado (cm)
              <input type="number" min="0" step="0.5" value={fSlumpSolicitado} onChange={e => setFSlumpSolicitado(e.target.value)} /></label>
            <label className={styles.campo}>Slump medido (cm)
              <input type="number" min="0" step="0.5" value={fSlumpMedido} onChange={e => setFSlumpMedido(e.target.value)} /></label>
            <label className={styles.campo}>Saída da usina
              <input type="datetime-local" value={fHoraSaida} onChange={e => setFHoraSaida(e.target.value)} /></label>
            <label className={styles.campo}>Chegada na obra
              <input type="datetime-local" value={fHoraChegada} onChange={e => setFHoraChegada(e.target.value)} /></label>
            <label className={styles.campo}>Início da descarga
              <input type="datetime-local" value={fHoraInicioDescarga} onChange={e => setFHoraInicioDescarga(e.target.value)} /></label>
            <label className={styles.campo}>Fim da descarga
              <input type="datetime-local" value={fHoraFimDescarga} onChange={e => setFHoraFimDescarga(e.target.value)} /></label>
            <label className={styles.campo}>Cor (legenda)
              <input type="color" value={fCor} onChange={e => setFCor(e.target.value)} /></label>
            {msgCaminhao && <p className={msgCaminhao.tipo === 'ok' ? styles.msgOk : styles.msgErro}>{msgCaminhao.texto}</p>}
            <button className={styles.btnPrincipal} onClick={lancarCaminhao} disabled={salvandoCaminhao}>
              {salvandoCaminhao ? 'Salvando…' : 'Lançar caminhão'}
            </button>
          </div>
        )}

        {caminhoes.length === 0 && !mostrarFormCaminhao && <p className={styles.vazio}>Nenhum caminhão lançado.</p>}
        {caminhoes.map(c => (
          <div key={c.id} className={styles.caminhaoItem}>
            <span className={styles.caminhaoCor} style={{ background: c.cor }} />
            <div className={styles.caminhaoInfo}>
              <strong>{c.fornecedor}</strong> — NF {c.nf} · Amostra {c.numero_amostra} · {c.volume_m3} m³
              <div className={styles.caminhaoMeta}>Laudo: {c.status_laudo}</div>
            </div>
          </div>
        ))}
      </div>

      {concretagem.status === 'aberta' && podeEditar && (
        <div className={styles.bloco}>
          <button className={styles.btnPrincipal} onClick={finalizarConcretagem} disabled={finalizando || caminhoes.length === 0}>
            {finalizando ? 'Finalizando…' : 'Finalizar concretagem'}
          </button>
        </div>
      )}

      {concretagem.status === 'finalizada' && (
        <div className={styles.bloco}>
          <button className={styles.btnSecundario} onClick={imprimir}>🖨️ Imprimir PDF</button>
        </div>
      )}
      {/* Task 5 adiciona aqui: acompanhamento/validação do laudo por caminhão. */}
```

- [ ] **Step 4: Adicionar as classes CSS novas em `ControleTecnologicoForm.module.css`**

```css
.btnSecundario {
  background: var(--branco);
  color: var(--navy);
  border: 1.5px solid var(--navy);
  border-radius: var(--radius-sm);
  padding: 10px 14px;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
}

.formCaminhao { border-top: 1.5px solid var(--cinza-200); margin-top: 12px; padding-top: 12px; }

.caminhaoItem { display: flex; align-items: flex-start; gap: 10px; padding: 8px 0; border-bottom: 1px solid var(--cinza-200); }
.caminhaoItem:last-child { border-bottom: none; }
.caminhaoCor { width: 16px; height: 16px; border-radius: 4px; flex: none; margin-top: 2px; border: 1px solid rgba(0,0,0,0.15); }
.caminhaoInfo { font-size: 13px; color: var(--cinza-800); }
.caminhaoMeta { font-size: 11px; color: var(--cinza-600); margin-top: 2px; text-transform: capitalize; }
```

- [ ] **Step 5: Criar `src/lib/controleTecnologicoPdf.ts`**

PDF simples: cabeçalho com identidade RT (mesmo padrão de todo PDF do app) + dados da concretagem
+ tabela-legenda dos caminhões. Sem mapa embutido nesta fase (ver Global Constraints):

```ts
import { jsPDF } from 'jspdf'
import type { CtConcretagem, CtCaminhao } from './supabase'
import { larguraProporcional, type IdentidadeMarca } from './pdfBranding'

const NAVY = '#1A3248'
const TERRACOTA = '#C49A7A'
const CINZA = '#6c757d'

export interface DadosPdfConcretagem {
  concretagem: CtConcretagem
  caminhoes: CtCaminhao[]
  identidade: IdentidadeMarca
  obraNome: string
  unidadeNome: string
}

function fmtData(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`
}

function fmtHora(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export function gerarPdfConcretagem(d: DadosPdfConcretagem): void {
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' })
  const W = 297
  const ML = 14
  const MR = 14
  const LARG = W - ML - MR
  let y = 0

  pdf.setFillColor(NAVY)
  pdf.rect(0, 0, W, 30, 'F')
  pdf.setFillColor(TERRACOTA)
  pdf.rect(0, 30, W, 1.4, 'F')
  if (d.identidade.logoBase64) {
    const alturaLogo = 22
    const larguraLogo = larguraProporcional(pdf, d.identidade.logoBase64, alturaLogo)
    pdf.addImage(d.identidade.logoBase64, 'PNG', ML, 4, larguraLogo, alturaLogo)
  } else {
    pdf.setTextColor('#ffffff')
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(17)
    pdf.text('RT ENGENHARIA', ML, 13)
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(8.5)
    pdf.setTextColor('#B8D4E8')
    pdf.text('Inteligência Aplicada', ML, 18.5)
  }
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(14)
  pdf.setTextColor('#ffffff')
  pdf.text('CONTROLE TECNOLÓGICO DO CONCRETO', W - MR, 13, { align: 'right' })
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(9)
  pdf.setTextColor('#D0AE95')
  pdf.text(`${d.obraNome} · ${d.unidadeNome} · ${fmtData(d.concretagem.data)}`, W - MR, 19, { align: 'right' })
  y = 40

  const colX = { cor: ML, fornecedor: ML + 12, nf: ML + 62, amostra: ML + 92, volume: ML + 132, slump: ML + 157, saida: ML + 187, chegada: ML + 212, inicio: ML + 237, fim: ML + 262 }
  pdf.setFillColor('#F0EBE3')
  pdf.rect(ML, y, LARG, 7, 'F')
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(7)
  pdf.setTextColor(NAVY)
  pdf.text('', colX.cor + 1, y + 4.7)
  pdf.text('FORNECEDOR', colX.fornecedor, y + 4.7)
  pdf.text('NF', colX.nf, y + 4.7)
  pdf.text('AMOSTRA', colX.amostra, y + 4.7)
  pdf.text('VOL. (M³)', colX.volume, y + 4.7)
  pdf.text('SLUMP SOL./MED.', colX.slump, y + 4.7)
  pdf.text('SAÍDA USINA', colX.saida, y + 4.7)
  pdf.text('CHEGADA OBRA', colX.chegada, y + 4.7)
  pdf.text('INÍCIO DESC.', colX.inicio, y + 4.7)
  pdf.text('FIM DESC.', colX.fim, y + 4.7)
  y += 7

  for (const c of d.caminhoes) {
    pdf.setDrawColor('#E0DAD0')
    pdf.setLineWidth(0.2)
    pdf.line(ML, y, W - MR, y)
    pdf.setFillColor(c.cor)
    pdf.rect(colX.cor + 1, y + 1.5, 5, 5, 'F')
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(8)
    pdf.setTextColor('#222222')
    pdf.text(c.fornecedor, colX.fornecedor, y + 5.2)
    pdf.text(c.nf, colX.nf, y + 5.2)
    pdf.text(c.numero_amostra, colX.amostra, y + 5.2)
    pdf.text(`${c.volume_m3}`, colX.volume, y + 5.2)
    pdf.text(`${c.slump_solicitado_cm ?? '—'} / ${c.slump_medido_cm ?? '—'}`, colX.slump, y + 5.2)
    pdf.text(fmtHora(c.hora_saida_usina), colX.saida, y + 5.2)
    pdf.text(fmtHora(c.hora_chegada_obra), colX.chegada, y + 5.2)
    pdf.text(fmtHora(c.hora_inicio_descarga), colX.inicio, y + 5.2)
    pdf.text(fmtHora(c.hora_fim_descarga), colX.fim, y + 5.2)
    y += 8
  }
  pdf.setDrawColor('#E0DAD0')
  pdf.line(ML, y, W - MR, y)
  y += 6

  pdf.setFont('helvetica', 'italic')
  pdf.setFontSize(8)
  pdf.setTextColor(CINZA)
  pdf.text('Mapa de concretagem anexado separadamente na tela do app.', ML, y)

  const totalPaginas = pdf.getNumberOfPages()
  for (let i = 1; i <= totalPaginas; i++) {
    pdf.setPage(i)
    pdf.setDrawColor(TERRACOTA)
    pdf.setLineWidth(0.5)
    pdf.line(ML, 196, W - MR, 196)
    pdf.setFontSize(7.5)
    pdf.setTextColor(CINZA)
    pdf.setFont('helvetica', 'normal')
    pdf.text(d.identidade.rodapeTexto, ML, 201)
    pdf.text(`Página ${i} de ${totalPaginas}`, W - MR, 201, { align: 'right' })
  }

  pdf.save(`Controle Tecnologico - ${d.unidadeNome} - ${fmtData(d.concretagem.data)}.pdf`)
}
```

- [ ] **Step 6: Build e teste manual**

```bash
npm run build
```

Testar no navegador: na concretagem criada na Task 3, lançar 2 caminhões de teste com cores
diferentes, confirmar que aparecem na lista com a cor certa. Clicar "Finalizar concretagem",
confirmar que o status muda pra "Finalizada" e o botão de lançar caminhão some. Clicar
"🖨️ Imprimir PDF" e confirmar que o PDF abre com o cabeçalho + a tabela dos 2 caminhões.

- [ ] **Step 7: Commit**

```bash
git add src/pages/ControleTecnologicoForm.tsx src/pages/ControleTecnologicoForm.module.css src/lib/controleTecnologicoPdf.ts
git commit -m "feat: lancar caminhao, finalizar concretagem e gerar PDF no Controle Tecnologico"
```

---

### Task 5: Frontend — acompanhamento e validação do laudo + alerta de 30 dias

**Files:**
- Modify: `src/pages/ControleTecnologicoForm.tsx`
- Modify: `src/pages/ControleTecnologicoForm.module.css`
- Modify: `src/pages/Dashboard.tsx`

**Interfaces:**
- Consumes: `CtCaminhao`, `CtConcretagem`, `Unidade` (Task 3); trigger `trg_ct_restringir_laudo`
  (Task 2, garante no banco que só admin grava `status_laudo`/`laudo_url` — a interface só
  precisa esconder o controle da equipe, a trava real já existe no banco).
- Produces: nada consumido por outra task — é o fim da Fase 1.

- [ ] **Step 1: Anexar/validar laudo por caminhão em `ControleTecnologicoForm.tsx`**

Adicionar estado (junto aos existentes):

```ts
  const [caminhaoLaudoId, setCaminhaoLaudoId] = useState<string | null>(null)
  const [arquivoLaudo, setArquivoLaudo] = useState<File | null>(null)
  const [enviandoLaudo, setEnviandoLaudo] = useState(false)
  const [urlsLaudo, setUrlsLaudo] = useState<Map<string, string>>(new Map())
```

Adicionar o `useEffect` de URLs assinadas dos laudos (mesmo padrão já usado em
`ContratoForm.tsx:191-203` pros anexos de contrato):

```ts
  useEffect(() => {
    let cancelado = false
    async function carregarUrls() {
      const novasUrls = new Map<string, string>()
      await Promise.all(caminhoes.map(async c => {
        if (!c.laudo_url) return
        const { data } = await supabase.storage.from('controle-tecnologico').createSignedUrl(c.laudo_url, 3600)
        if (data) novasUrls.set(c.laudo_url, data.signedUrl)
      }))
      if (!cancelado) setUrlsLaudo(novasUrls)
    }
    carregarUrls()
    return () => { cancelado = true }
  }, [caminhoes])
```

Adicionar `enviarLaudo` e `validarLaudo`:

```ts
  async function enviarLaudo(caminhao: CtCaminhao) {
    if (!arquivoLaudo || !obraAtiva) return
    setEnviandoLaudo(true)
    const path = `${obraAtiva.id}/${crypto.randomUUID()}-${nomeArquivoStorage(arquivoLaudo.name)}`
    const { error: eUp } = await supabase.storage.from('controle-tecnologico').upload(path, arquivoLaudo)
    if (eUp) {
      setEnviandoLaudo(false)
      setMsgCaminhao({ tipo: 'erro', texto: `Falha no envio do laudo: ${eUp.message}` })
      return
    }
    const { error } = await supabase.from('ct_caminhoes').update({
      laudo_url: path, laudo_anexado_em: new Date().toISOString(),
    }).eq('id', caminhao.id)
    setEnviandoLaudo(false)
    if (error) {
      setMsgCaminhao({ tipo: 'erro', texto: `Falha ao registrar o laudo: ${error.message}` })
      return
    }
    setArquivoLaudo(null)
    if (concretagem) carregarCaminhoes(concretagem.id)
  }

  async function validarLaudo(caminhao: CtCaminhao, aprovado: boolean) {
    const { error } = await supabase.from('ct_caminhoes').update({
      status_laudo: aprovado ? 'aprovado' : 'reprovado',
      validado_por: perfil?.id, validado_em: new Date().toISOString(),
    }).eq('id', caminhao.id)
    if (error) {
      setMsgCaminhao({ tipo: 'erro', texto: `Falha ao validar: ${error.message}` })
      return
    }
    setCaminhaoLaudoId(null)
    if (concretagem) carregarCaminhoes(concretagem.id)
  }
```

- [ ] **Step 2: JSX de laudo por caminhão**

No bloco `.caminhaoItem` do `caminhoes.map` (criado na Task 4, Step 3), trocar:

```tsx
            <div className={styles.caminhaoInfo}>
              <strong>{c.fornecedor}</strong> — NF {c.nf} · Amostra {c.numero_amostra} · {c.volume_m3} m³
              <div className={styles.caminhaoMeta}>Laudo: {c.status_laudo}</div>
            </div>
```

por:

```tsx
            <div className={styles.caminhaoInfo}>
              <strong>{c.fornecedor}</strong> — NF {c.nf} · Amostra {c.numero_amostra} · {c.volume_m3} m³
              <div className={`${styles.caminhaoMeta} ${styles[`laudo_${c.status_laudo}`]}`}>
                Laudo: {c.status_laudo}
                {c.laudo_url && urlsLaudo.get(c.laudo_url) && (
                  <> · <a className={styles.anexoLink} href={urlsLaudo.get(c.laudo_url)} target="_blank" rel="noreferrer">📎 ver laudo</a></>
                )}
              </div>
              {perfil?.papel === 'admin' && c.status_laudo === 'pendente' && (
                caminhaoLaudoId === c.id ? (
                  <div className={styles.laudoForm}>
                    <input type="file" accept="application/pdf,image/*" onChange={e => setArquivoLaudo(e.target.files?.[0] ?? null)} />
                    <button className={styles.btnSecundario} onClick={() => enviarLaudo(c)} disabled={enviandoLaudo || !arquivoLaudo}>
                      {enviandoLaudo ? 'Enviando…' : 'Anexar laudo'}
                    </button>
                  </div>
                ) : (
                  <button className={styles.btnSecundario} onClick={() => setCaminhaoLaudoId(c.id)}>Anexar laudo</button>
                )
              )}
              {perfil?.papel === 'admin' && c.status_laudo === 'pendente' && c.laudo_url && (
                <div className={styles.laudoForm}>
                  <button className={styles.btnPrincipal} onClick={() => validarLaudo(c, true)}>Aprovar</button>
                  <button className={styles.btnPerigo} onClick={() => validarLaudo(c, false)}>Reprovar</button>
                </div>
              )}
            </div>
```

- [ ] **Step 3: CSS novo em `ControleTecnologicoForm.module.css`**

```css
.laudo_pendente { color: #a35c00; }
.laudo_aprovado { color: #1e6b2e; }
.laudo_reprovado { color: #a33030; }

.laudoForm { display: flex; gap: 8px; align-items: center; margin-top: 6px; flex-wrap: wrap; }

.anexoLink { color: var(--navy); font-weight: 600; text-decoration: none; }
.anexoLink:hover { text-decoration: underline; }

.btnPerigo {
  background: var(--branco);
  color: #a33030;
  border: 1.5px solid #a33030;
  border-radius: var(--radius-sm);
  padding: 8px 12px;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
}
```

- [ ] **Step 4: Alerta de laudo pendente aos 30 dias no Dashboard**

Ler `src/pages/Dashboard.tsx:156-189` (banner de ferramenta em atraso) antes de editar — copiar
exatamente esse padrão (estado, `useEffect`, filtro em JS). Adicionar, próximo a esse bloco:

```ts
  type LaudoPendente = { caminhaoId: string; fornecedor: string; numeroAmostra: string; dias: number }
  const [laudosPendentes, setLaudosPendentes] = useState<LaudoPendente[]>([])

  useEffect(() => {
    if (!obra) { setLaudosPendentes([]); return }
    type LinhaCaminhao = {
      id: string
      fornecedor: string
      numero_amostra: string
      status_laudo: string
      ct_concretagens: { data: string; obra_id: string } | null
    }
    supabase.from('ct_caminhoes')
      .select('id, fornecedor, numero_amostra, status_laudo, ct_concretagens!inner(data, obra_id)')
      .eq('ct_concretagens.obra_id', obra.id)
      .eq('status_laudo', 'pendente')
      .then(({ data }) => {
        const hoje = dataHoje()
        const linhas = (data ?? []) as unknown as LinhaCaminhao[]
        const pendentes: LaudoPendente[] = linhas
          .map(c => ({
            caminhaoId: c.id,
            fornecedor: c.fornecedor,
            numeroAmostra: c.numero_amostra,
            dataConcretagem: c.ct_concretagens?.data ?? hoje,
          }))
          .filter(c => diasEntre(c.dataConcretagem, hoje) >= 30)
          .map(c => ({
            caminhaoId: c.caminhaoId,
            fornecedor: c.fornecedor,
            numeroAmostra: c.numeroAmostra,
            dias: diasEntre(c.dataConcretagem, hoje),
          }))
        setLaudosPendentes(pendentes)
      })
  }, [obra])
```

(`dataHoje`/`diasEntre` já existem em `Dashboard.tsx` — mesmas funções usadas pelo banner de
ferramenta em atraso, não precisam ser reescritas.)

No JSX, próximo ao banner de ferramenta em atraso, adicionar:

```tsx
      {laudosPendentes.length > 0 && (
        <div className={styles.bannerAlerta}>
          <strong>🧪 {laudosPendentes.length} laudo(s) de concreto pendente(s) há 30+ dias</strong>
          <ul>
            {laudosPendentes.map(l => (
              <li key={l.caminhaoId}>{l.fornecedor} — amostra {l.numeroAmostra} ({l.dias} dias)</li>
            ))}
          </ul>
        </div>
      )}
```

Se `styles.bannerAlerta` já existir em `Dashboard.module.css` (reaproveitado do banner de
ferramenta), usar a mesma classe — só criar uma nova se não existir nenhuma parecida (checar
`Dashboard.module.css` antes de adicionar CSS duplicado).

- [ ] **Step 5: Build e teste manual**

```bash
npm run build
```

Testar como admin: no caminhão lançado na Task 4, clicar "Anexar laudo", subir um PDF de teste,
confirmar que aparece o link "📎 ver laudo" e os botões "Aprovar"/"Reprovar". Clicar "Reprovar" —
confirmar que o status muda pra "reprovado" e, no módulo Pendências, uma pendência nova apareceu
vinculada à Unidade certa, citando a amostra/NF/fornecedor. Testar como equipe (não-admin): não
vê os botões de anexar/aprovar/reprovar laudo, só o status.

Pro alerta de 30 dias: mais fácil de testar via SQL direto — criar uma concretagem/caminhão de
teste com `data` 31 dias atrás (`UPDATE ct_concretagens SET data = CURRENT_DATE - INTERVAL '31 days' WHERE id = '...'`),
recarregar o Dashboard, confirmar que o banner aparece; depois reverter a data de teste.

Por fim, abrir as telas do módulo inteiro (lista, criação, detalhe com caminhões e laudo) com a
largura da janela estreita (DevTools em modo mobile, ~375px) — confirmar que nada fica cortado
ou sobreposto (critério de aceite "funciona no celular e desktop" da spec). Se algo espremer,
ajustar o CSS antes de considerar a Fase 1 concluída.

- [ ] **Step 6: Commit**

```bash
git add src/pages/ControleTecnologicoForm.tsx src/pages/ControleTecnologicoForm.module.css src/pages/Dashboard.tsx
git commit -m "feat: acompanhamento e validacao de laudo + alerta de 30 dias no Controle Tecnologico"
```

---

## Revisão obrigatória

Ao final das 5 tasks, revisar antes de qualquer teste de campo real: a Task 2 tem uma trava de
permissão em nível de banco (só admin grava `status_laudo`/`laudo_url`) que precisa ser
verificada de verdade (não só assumida) — testar como usuário equipe real tentando validar um
laudo pela interface (deve falhar) além do teste SQL da própria Task 2. A Task 2 também mexe na
tabela `pendencias` compartilhada com FVS (`ALTER TABLE... ADD COLUMN`) — confirmar que isso não
quebra nenhuma policy ou índice existente de Pendências/FVS.

A Fase 2 (catálogo de plantas + ferramenta de pintura com pincel/borracha) fica para um plano
separado, depois que esta Fase 1 estiver testada em campo com uma concretagem real.
