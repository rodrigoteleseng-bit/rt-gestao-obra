# Fase 7 — Medições Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Módulo novo de Medições de empreiteiros, integrado ao detalhe de um contrato ativo: lançar quantidade executada por item de contrato, acumular saldo, calcular valor bruto/retido/líquido, aprovação exclusiva do admin com trava de saldo no banco, e PDF do documento.

**Architecture:** Duas tabelas novas (`medicoes`, `medicoes_itens`) que consomem `contratos`/`contratos_itens` (não repetem serviço/unidade — sempre herdam do item do contrato). Numeração sequencial por trigger, **por contrato** (não por obra, diferente de `contratos_seq`). Duas triggers de cálculo (valor do item, valor total da medição com retenção) e uma trigger de trava de saldo que bloqueia a aprovação se ultrapassar a quantidade contratada — sem exceção pra admin, e uma trigger que torna qualquer medição aprovada permanentemente imutável (lição já aplicada desde o início, sem precisar de uma segunda migração de correção como aconteceu em Contratos). Frontend: `MedicaoForm.tsx` (nova tela, cobre criar/detalhar/editar/aprovar/imprimir), uma seção nova dentro do `DetalheContrato` já existente em `ContratoForm.tsx`, e `Medicoes.tsx` (lista global, substitui o placeholder `EmConstrucao` atual). PDF em `medicoesPdf.ts`, mesmo padrão visual de `comprasPdf.ts`.

**Tech Stack:** PostgreSQL (Supabase) pra migração; React + TypeScript + Vite pro resto; `jspdf` (já é dependência do projeto) pro PDF. Sem framework de teste automatizado neste projeto — verificação via `npm run build` + consultas SQL diretas (para a lógica de trava de saldo, que não depende de sessão autenticada) + teste manual no navegador com os três papéis (para RLS/permissão, que dependem de `auth.uid()` e por isso não são verificáveis por SQL direto via a ferramenta MCP).

## Global Constraints

- **Cliente nunca vê Medições** — mesmo bloqueio total usado em Contratos (`if (perfil?.papel === 'cliente') return <aviso>`).
- **RLS é a aplicação real da permissão, nunca só a interface** (CLAUDE.md §3/§6). Toda policy de SELECT que filtra por `ativo = true` já nasce com `OR pode_editar_medicoes()` (regra do fix crítico de 13/07/2026). Itens de medição são imutáveis fora do `rascunho` **desde a primeira versão da migração**, sem exceção pra admin — a lição do bug de bypass em Contratos (corrigido em uma segunda migração no mesmo dia) é aplicada aqui de uma vez.
- **Medição só pode ser criada com o contrato `ativo`** (`med_insert` policy verifica isso via `EXISTS`).
- **Numeração é sequencial por contrato** (inteiro simples: 1, 2, 3…), gerada só pelo trigger — nunca digitada.
- **Trava de saldo:** ao aprovar, nenhum item pode ultrapassar a quantidade contratada somando tudo que já está aprovado — bloqueio no banco, sem exceção pra admin.
- **Medição aprovada é permanente** — nenhuma alteração depois (item, status, ou qualquer campo do cabeçalho), nem para admin.
- **`valor_bruto`/`valor_retido`/`valor_liquido` nunca são digitados** — sempre calculados por trigger a partir dos itens e da `retencao_pct` do contrato.
- Nenhuma migração de `modulo_app`, `Usuarios.tsx` ou `Layout.tsx` é necessária — os três já têm `'medicoes'` cadastrado desde 07/07/2026 (nunca usado até agora).
- Regime de mão de obra direta (produção própria) e anexo de comprovante assinado ficam **fora de escopo** deste plano (ver spec §9).

---

## Arquivos afetados

- Criar: `supabase/migrations/20260713_fase7_medicoes.sql`
- Modificar: `src/lib/supabase.ts` — novos tipos `StatusMedicao`, `Medicao`, `MedicaoItem`.
- Criar: `src/pages/MedicaoForm.tsx`, `src/pages/MedicaoForm.module.css`
- Modificar: `src/pages/ContratoForm.tsx` — seção "Medições" dentro de `DetalheContrato`.
- Criar: `src/pages/Medicoes.tsx`, `src/pages/Medicoes.module.css`
- Criar: `src/lib/medicoesPdf.ts`
- Modificar: `src/App.tsx` — rotas `contratos/:contratoId/medicoes/:medicaoId` e substituição do stub `/medicoes`.
- Criar: `docs/fase7_medicoes.md`
- Modificar: `CLAUDE.md` — §0 e changelog de versão.

---

### Task 1: Migração de banco + tipos TypeScript

**Files:**
- Create: `supabase/migrations/20260713_fase7_medicoes.sql`
- Modify: `src/lib/supabase.ts`

**Interfaces:**
- Consumes: `meu_papel()`/`meus_modulos()` (`20260707_fase0_fundacao.sql:76-84`); tabelas `contratos`/`contratos_itens` (`20260713_fase7_contratos.sql`); enum `modulo_app` (já tem `'medicoes'`, `20260707_fase7_modulos_extras_enum.sql:3`).
- Produces: tabelas `medicoes_seq`, `medicoes`, `medicoes_itens`; função `pode_editar_medicoes()`; tipos `StatusMedicao`, `Medicao`, `MedicaoItem` — consumidos pelas Tasks 2-4.

- [ ] **Step 1: Criar a migração**

```sql
-- ============================================================
-- FASE 7 — MEDIÇÕES DE EMPREITEIROS | RT Engenharia
-- ============================================================
-- Lança execução periódica (quantidade) por item de contrato ativo,
-- acumula saldo frente à quantidade contratada, calcula valor
-- bruto/retido/líquido. Aprovação exclusiva do admin, trava de saldo
-- no banco sem exceção. Consome contratos/contratos_itens
-- (20260713_fase7_contratos.sql). Decisões de Rodrigo em 13/07/2026 —
-- ver docs/superpowers/specs/2026-07-13-fase7-medicoes-design.md.
--
-- O valor 'medicoes' do enum modulo_app já existe
-- (20260707_fase7_modulos_extras_enum.sql) — nada a alterar ali.

CREATE TYPE status_medicao AS ENUM ('rascunho', 'aprovada');

-- Contador de numeração sequencial por CONTRATO (não por obra —
-- a 1ª medição do CT-003 e a 1ª do CT-005 coexistem).
CREATE TABLE medicoes_seq (
  contrato_id   UUID PRIMARY KEY REFERENCES contratos(id) ON DELETE CASCADE,
  ultimo_numero INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE medicoes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contrato_id     UUID NOT NULL REFERENCES contratos(id),
  numero          INTEGER NOT NULL,
  data_referencia DATE NOT NULL,
  status          status_medicao NOT NULL DEFAULT 'rascunho',
  valor_bruto     NUMERIC(14,2) NOT NULL DEFAULT 0,
  valor_retido    NUMERIC(14,2) NOT NULL DEFAULT 0,
  valor_liquido   NUMERIC(14,2) NOT NULL DEFAULT 0,
  aprovada_por    UUID REFERENCES perfis_usuario(id),
  aprovada_em     TIMESTAMPTZ,
  ativo           BOOLEAN NOT NULL DEFAULT true,
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
  criado_por      UUID NOT NULL DEFAULT auth.uid() REFERENCES perfis_usuario(id),
  UNIQUE (contrato_id, numero)
);

CREATE OR REPLACE FUNCTION proximo_numero_medicao() RETURNS TRIGGER AS $$
DECLARE
  v_numero INTEGER;
BEGIN
  INSERT INTO medicoes_seq (contrato_id, ultimo_numero)
  VALUES (NEW.contrato_id, 0)
  ON CONFLICT (contrato_id) DO NOTHING;

  UPDATE medicoes_seq
    SET ultimo_numero = ultimo_numero + 1
    WHERE contrato_id = NEW.contrato_id
    RETURNING ultimo_numero INTO v_numero;

  NEW.numero := v_numero;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_numero_medicao
  BEFORE INSERT ON medicoes
  FOR EACH ROW EXECUTE FUNCTION proximo_numero_medicao();

-- Medição aprovada é permanente: nenhuma alteração (item, status ou
-- qualquer campo) depois de aprovada, nem para admin. Só admin pode
-- mudar o status (rascunho → aprovada). Diferente de Contratos, essa
-- trava já nasce completa aqui — não precisou de migração de correção.
CREATE OR REPLACE FUNCTION restringir_status_medicao() RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status = 'aprovada' THEN
    RAISE EXCEPTION 'Medição aprovada não pode ser alterada.';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND meu_papel() <> 'admin' THEN
    RAISE EXCEPTION 'Somente o admin pode aprovar uma medição.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_restringir_status_medicao
  BEFORE UPDATE ON medicoes
  FOR EACH ROW EXECUTE FUNCTION restringir_status_medicao();

CREATE TABLE medicoes_itens (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  medicao_id          UUID NOT NULL REFERENCES medicoes(id) ON DELETE CASCADE,
  contrato_item_id    UUID NOT NULL REFERENCES contratos_itens(id),
  quantidade_periodo  NUMERIC(14,4) NOT NULL CHECK (quantidade_periodo >= 0),
  valor_total_item    NUMERIC(14,2) NOT NULL DEFAULT 0,
  ativo               BOOLEAN NOT NULL DEFAULT true,
  criado_em           TIMESTAMPTZ NOT NULL DEFAULT now(),
  criado_por          UUID NOT NULL DEFAULT auth.uid() REFERENCES perfis_usuario(id)
);

-- Calcula o valor do item a partir do valor unitário negociado no
-- contrato — item de medição nunca guarda seu próprio valor_unitario.
CREATE OR REPLACE FUNCTION calcular_valor_item_medicao() RETURNS TRIGGER AS $$
DECLARE
  v_valor_unitario NUMERIC(14,4);
BEGIN
  SELECT valor_unitario INTO v_valor_unitario FROM contratos_itens WHERE id = NEW.contrato_item_id;
  NEW.valor_total_item := NEW.quantidade_periodo * v_valor_unitario;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_calcular_valor_item_medicao
  BEFORE INSERT OR UPDATE ON medicoes_itens
  FOR EACH ROW EXECUTE FUNCTION calcular_valor_item_medicao();

-- Recalcula bruto/retido/líquido da medição a partir da soma dos
-- itens ativos, aplicando a retenção % cadastrada no contrato.
CREATE OR REPLACE FUNCTION recalcular_valor_medicao() RETURNS TRIGGER AS $$
DECLARE
  v_medicao_id  UUID := COALESCE(NEW.medicao_id, OLD.medicao_id);
  v_contrato_id UUID;
  v_retencao    NUMERIC(5,2);
  v_bruto       NUMERIC(14,2);
  v_retido      NUMERIC(14,2);
BEGIN
  SELECT contrato_id INTO v_contrato_id FROM medicoes WHERE id = v_medicao_id;
  SELECT COALESCE(retencao_pct, 0) INTO v_retencao FROM contratos WHERE id = v_contrato_id;

  SELECT COALESCE(SUM(valor_total_item), 0) INTO v_bruto
  FROM medicoes_itens WHERE medicao_id = v_medicao_id AND ativo = true;

  v_retido := ROUND(v_bruto * v_retencao / 100, 2);

  UPDATE medicoes SET
    valor_bruto = v_bruto, valor_retido = v_retido, valor_liquido = v_bruto - v_retido
  WHERE id = v_medicao_id;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_recalcular_valor_medicao
  AFTER INSERT OR UPDATE ON medicoes_itens
  FOR EACH ROW EXECUTE FUNCTION recalcular_valor_medicao();

-- Trava de saldo: ao aprovar, nenhum item pode ultrapassar a
-- quantidade contratada somando tudo que já está aprovado. Sem
-- exceção pra admin — se precisar medir a mais, aditiva o contrato.
CREATE OR REPLACE FUNCTION validar_saldo_medicao() RETURNS TRIGGER AS $$
DECLARE
  v_item RECORD;
  v_ja_aprovado NUMERIC(14,4);
BEGIN
  IF NEW.status = 'aprovada' AND OLD.status = 'rascunho' THEN
    FOR v_item IN
      SELECT mi.contrato_item_id, mi.quantidade_periodo, ci.quantidade AS quantidade_contratada
      FROM medicoes_itens mi
      JOIN contratos_itens ci ON ci.id = mi.contrato_item_id
      WHERE mi.medicao_id = NEW.id AND mi.ativo = true
    LOOP
      SELECT COALESCE(SUM(mi2.quantidade_periodo), 0) INTO v_ja_aprovado
      FROM medicoes_itens mi2
      JOIN medicoes m2 ON m2.id = mi2.medicao_id
      WHERE mi2.contrato_item_id = v_item.contrato_item_id
        AND mi2.ativo = true
        AND m2.status = 'aprovada'
        AND m2.id <> NEW.id;

      IF v_ja_aprovado + v_item.quantidade_periodo > v_item.quantidade_contratada THEN
        RAISE EXCEPTION 'Quantidade medida (%) ultrapassa o saldo contratado do item (contratado: %, já aprovado: %).',
          v_item.quantidade_periodo, v_item.quantidade_contratada, v_ja_aprovado;
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_validar_saldo_medicao
  BEFORE UPDATE ON medicoes
  FOR EACH ROW EXECUTE FUNCTION validar_saldo_medicao();

CREATE INDEX idx_medicoes_contrato          ON medicoes(contrato_id);
CREATE INDEX idx_medicoes_itens_medicao     ON medicoes_itens(medicao_id);
CREATE INDEX idx_medicoes_itens_contrato_it ON medicoes_itens(contrato_item_id);

-- ── RLS ──
ALTER TABLE medicoes_seq   ENABLE ROW LEVEL SECURITY;
ALTER TABLE medicoes       ENABLE ROW LEVEL SECURITY;
ALTER TABLE medicoes_itens ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION pode_editar_medicoes()
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT meu_papel() = 'admin'
    OR (meu_papel() = 'equipe' AND 'medicoes' = ANY(meus_modulos()))
$$;

-- Sem policy de INSERT/UPDATE: só proximo_numero_medicao() (SECURITY DEFINER) escreve.
CREATE POLICY medseq_select ON medicoes_seq FOR SELECT
  USING (meu_papel() IN ('admin', 'equipe'));

-- Regra de soft delete (CLAUDE.md §3): toda policy de SELECT que
-- filtra por ativo = true já nasce com "OR pode_editar_medicoes()".
CREATE POLICY med_select ON medicoes FOR SELECT
  USING ((ativo = true AND meu_papel() = ANY (ARRAY['admin', 'equipe']::papel_usuario[])) OR pode_editar_medicoes());
CREATE POLICY med_insert ON medicoes FOR INSERT
  WITH CHECK (
    pode_editar_medicoes()
    AND status = 'rascunho'
    AND EXISTS (SELECT 1 FROM contratos c WHERE c.id = contrato_id AND c.status = 'ativo')
  );
CREATE POLICY med_update ON medicoes FOR UPDATE
  USING (pode_editar_medicoes()) WITH CHECK (pode_editar_medicoes());

-- Itens de medição imutáveis fora do rascunho — sem exceção pra
-- admin (lição aplicada desde o início; em Contratos isso só foi
-- corrigido numa segunda migração no mesmo dia).
CREATE POLICY mi_select ON medicoes_itens FOR SELECT
  USING ((ativo = true AND meu_papel() = ANY (ARRAY['admin', 'equipe']::papel_usuario[])) OR pode_editar_medicoes());
CREATE POLICY mi_insert ON medicoes_itens FOR INSERT
  WITH CHECK (
    pode_editar_medicoes()
    AND EXISTS (SELECT 1 FROM medicoes m WHERE m.id = medicao_id AND m.status = 'rascunho')
  );
CREATE POLICY mi_update ON medicoes_itens FOR UPDATE
  USING (pode_editar_medicoes())
  WITH CHECK (
    pode_editar_medicoes()
    AND EXISTS (SELECT 1 FROM medicoes m WHERE m.id = medicao_id AND m.status = 'rascunho')
  );
```

- [ ] **Step 2: Aplicar a migração no banco Supabase**

Usar a ferramenta MCP do Supabase (`apply_migration`, projeto `yxshldsfmbmbzdkcymca` — nome `rt-gestao-obra`) com o nome `fase7_medicoes` e o SQL acima. **Pedir confirmação explícita ao Rodrigo antes de aplicar** (altera o banco de produção — criação de tabelas novas, aditiva e sem impacto em dados existentes). Depois de aplicada, confirmar com queries simples via `execute_sql`:

```sql
SELECT enum_range(NULL::status_medicao);              -- {rascunho,aprovada}
SELECT count(*) FROM medicoes_seq;                    -- 0 (só cria linha sob demanda)
SELECT proname FROM pg_proc WHERE proname IN
  ('proximo_numero_medicao', 'restringir_status_medicao',
   'calcular_valor_item_medicao', 'recalcular_valor_medicao',
   'validar_saldo_medicao', 'pode_editar_medicoes');  -- 6 linhas
```

- [ ] **Step 3: Testar a trava de saldo diretamente no banco (via `execute_sql`)**

A trava de saldo (`validar_saldo_medicao`) não depende de `auth.uid()`/sessão — dá pra testar direto por SQL. Escolher um `contrato_id` real com status `ativo` e pelo menos um item (ou criar um contrato de teste em rascunho, adicionar um item e ativar). Substituir `<CONTRATO_ITEM_ID>` e `<CONTRATO_ID>` pelos valores reais:

```sql
-- Descobrir um item de contrato ativo para o teste
SELECT ci.id AS contrato_item_id, ci.contrato_id, ci.quantidade, c.status
FROM contratos_itens ci JOIN contratos c ON c.id = ci.contrato_id
WHERE c.status = 'ativo' AND ci.ativo = true LIMIT 1;
```

Com o resultado, criar uma medição de teste que tenta medir 1 unidade a mais do que a quantidade contratada e aprovar:

```sql
-- Cria a medição de teste
INSERT INTO medicoes (contrato_id, data_referencia)
VALUES ('<CONTRATO_ID>', CURRENT_DATE) RETURNING id;
-- (anotar o id retornado como <MEDICAO_ID>)

INSERT INTO medicoes_itens (medicao_id, contrato_item_id, quantidade_periodo)
SELECT '<MEDICAO_ID>', id, quantidade + 1 FROM contratos_itens WHERE id = '<CONTRATO_ITEM_ID>';

-- Deve falhar com "Quantidade medida (...) ultrapassa o saldo contratado..."
UPDATE medicoes SET status = 'aprovada' WHERE id = '<MEDICAO_ID>';
```

Expected: o `UPDATE` final falha com a mensagem de exceção da trava de saldo. Depois, limpar os dados de teste:

```sql
DELETE FROM medicoes WHERE id = '<MEDICAO_ID>';  -- cascade remove os itens
```

Se o `UPDATE` passar sem erro, a trava está com bug — voltar ao Step 1 antes de prosseguir (não seguir para as próximas tasks com essa regra quebrada).

- [ ] **Step 4: Adicionar os tipos em `src/lib/supabase.ts`**

Ao final do arquivo (depois da interface `ContratoItem`, que hoje termina na última linha do arquivo), adicionar:

```ts

export type StatusMedicao = 'rascunho' | 'aprovada'

export interface Medicao {
  id: string
  contrato_id: string
  numero: number
  data_referencia: string
  status: StatusMedicao
  valor_bruto: number
  valor_retido: number
  valor_liquido: number
  aprovada_por: string | null
  aprovada_em: string | null
  ativo: boolean
  criado_em: string
  criado_por: string
}

export interface MedicaoItem {
  id: string
  medicao_id: string
  contrato_item_id: string
  quantidade_periodo: number
  valor_total_item: number
  ativo: boolean
  criado_em: string
  criado_por: string
}
```

- [ ] **Step 5: Verificar**

Rodar `npm run build` — TypeScript deve compilar limpo (os novos tipos ainda não são usados em lugar nenhum).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260713_fase7_medicoes.sql src/lib/supabase.ts
git commit -m "Medições: migração de banco (medicoes, medicoes_itens, trava de saldo) e tipos TypeScript"
```

---

### Task 2: `MedicaoForm.tsx` — criar, detalhar, editar itens, aprovar

**Files:**
- Create: `src/pages/MedicaoForm.tsx`
- Create: `src/pages/MedicaoForm.module.css`

**Interfaces:**
- Consumes: `Contrato`, `ContratoItem`, `Servico`, `Unidade`, `Medicao`, `MedicaoItem` de `../lib/supabase` (Task 1); `useAuth()`, tabelas `contratos`, `contratos_itens`, `medicoes`, `medicoes_itens`, `servicos`, `unidades`.
- Produces: componente `MedicaoForm` default-exportado; `export const STATUS_MEDICAO_LABEL: Record<StatusMedicao, string>` — consumido por `ContratoForm.tsx` (Task 3) e `Medicoes.tsx` (Task 4). Rotas montadas na Task 4 (`contratos/:contratoId/medicoes/:medicaoId`, onde `medicaoId === 'nova'` significa criação).

- [ ] **Step 1: Criar `src/pages/MedicaoForm.module.css`**

```css
.page {
  max-width: 960px;
  margin: 0 auto;
  padding-bottom: 40px;
}

.voltar {
  background: none;
  border: none;
  color: var(--navy);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  padding: 0 0 10px;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 16px;
}

.page h1 { font-size: 20px; margin: 0; }
.page h2 { font-size: 14px; color: var(--navy); margin-bottom: 10px; }

.chip {
  font-size: 11px;
  font-weight: 700;
  border-radius: 999px;
  padding: 3px 10px;
  white-space: nowrap;
}

.chip_rascunho { background: #eceff1; color: #546e7a; }
.chip_aprovada { background: #e3f4e3; color: #1e6b2e; }

.bloco {
  background: var(--branco);
  border: 1.5px solid var(--cinza-200);
  border-radius: var(--radius-md);
  padding: 16px;
  margin-bottom: 12px;
  box-shadow: var(--sombra-sm);
}

.campo {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  font-weight: 600;
  color: var(--cinza-600);
  margin-bottom: 12px;
}

.campo input {
  padding: 10px 12px;
  border: 1.5px solid var(--cinza-200);
  border-radius: var(--radius-sm);
  font-size: 14px;
  font-family: inherit;
  background: var(--branco);
}

.campo input:focus { border-color: var(--navy); outline: none; }

.tabela {
  width: 100%;
  border-collapse: collapse;
  font-size: 12.5px;
}

.tabela th, .tabela td {
  border: 1px solid var(--cinza-200);
  padding: 7px 8px;
  text-align: left;
}

.tabela th { background: var(--cinza-100); font-size: 10.5px; text-transform: uppercase; color: var(--cinza-600); }

.inputQtd {
  width: 90px;
  padding: 6px 8px;
  border: 1.5px solid var(--cinza-200);
  border-radius: var(--radius-sm);
  font-size: 13px;
  font-family: inherit;
}

.inputQtd:focus { border-color: var(--navy); outline: none; }

.resumoLinha {
  display: flex;
  justify-content: space-between;
  font-size: 14px;
  padding: 4px 0;
}

.acoes {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.btnPrincipal {
  background: var(--terracota);
  color: var(--branco);
  border: none;
  border-radius: var(--radius-sm);
  padding: 12px 18px;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
}

.btnPrincipal:disabled { opacity: 0.6; cursor: default; }

.btnSecundario {
  background: var(--branco);
  color: var(--navy);
  border: 1.5px solid var(--navy);
  border-radius: var(--radius-sm);
  padding: 12px 16px;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
}

.msgOk { color: #1e6b2e; font-weight: 600; font-size: 13px; padding: 6px 0; }
.msgErro { color: #a33030; font-weight: 600; font-size: 13px; padding: 6px 0; }
.vazio { color: var(--cinza-600); font-size: 14px; padding: 12px 0; }

@media (max-width: 640px) {
  .tabela { font-size: 11px; }
  .inputQtd { width: 70px; }
}
```

- [ ] **Step 2: Criar `src/pages/MedicaoForm.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import {
  supabase, type Contrato, type ContratoItem, type Servico, type Unidade,
  type Medicao, type MedicaoItem, type StatusMedicao,
} from '../lib/supabase'
import { gerarPdfMedicao } from '../lib/medicoesPdf'
import styles from './MedicaoForm.module.css'

export const STATUS_MEDICAO_LABEL: Record<StatusMedicao, string> = {
  rascunho: 'Rascunho',
  aprovada: 'Aprovada',
}

interface ItemLinha {
  contratoItemId: string
  servicoNome: string
  servicoCodigo: string
  unidadeNome: string
  quantidadeContratada: number
  valorUnitario: number
  jaAprovado: number
  quantidadePeriodo: string
  medicaoItemId: string | null
}

export default function MedicaoForm() {
  const { contratoId, medicaoId } = useParams()
  const nova = medicaoId === 'nova'
  const navigate = useNavigate()
  const { perfil, temModulo } = useAuth()
  const podeEditar = perfil?.papel === 'admin' || temModulo('medicoes')
  const ehAdmin = perfil?.papel === 'admin'

  const [carregando, setCarregando] = useState(true)
  const [contrato, setContrato] = useState<Contrato | null>(null)
  const [empreiteiroNome, setEmpreiteiroNome] = useState('—')
  const [contratoItens, setContratoItens] = useState<ContratoItem[]>([])
  const [servicos, setServicos] = useState<Servico[]>([])
  const [unidades, setUnidades] = useState<Unidade[]>([])
  const [medicao, setMedicao] = useState<Medicao | null>(null)
  const [itensExistentes, setItensExistentes] = useState<MedicaoItem[]>([])
  const [jaAprovadoPorItem, setJaAprovadoPorItem] = useState<Map<string, number>>(new Map())

  const [dataReferencia, setDataReferencia] = useState(() => new Date().toISOString().slice(0, 10))
  const [linhas, setLinhas] = useState<ItemLinha[]>([])
  const [salvando, setSalvando] = useState(false)
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)

  useEffect(() => { if (contratoId) carregar(contratoId) }, [contratoId, medicaoId])

  async function carregar(cId: string) {
    setCarregando(true)
    const [{ data: c }, { data: itensContrato }, { data: todasMedicoes }] = await Promise.all([
      supabase.from('contratos').select('*').eq('id', cId).single(),
      supabase.from('contratos_itens').select('*').eq('contrato_id', cId).eq('ativo', true).order('criado_em'),
      supabase.from('medicoes').select('*').eq('contrato_id', cId).eq('ativo', true),
    ])
    setContrato(c ?? null)
    setContratoItens(itensContrato ?? [])

    if (c) {
      const { data: emp } = await supabase.from('empreiteiros').select('nome').eq('id', c.empreiteiro_id).single()
      setEmpreiteiroNome(emp?.nome ?? '—')
    }

    const medicaoIds = (todasMedicoes ?? []).map(m => m.id)
    const { data: todosItensMedicoes } = medicaoIds.length > 0
      ? await supabase.from('medicoes_itens').select('*').in('medicao_id', medicaoIds).eq('ativo', true)
      : { data: [] as MedicaoItem[] }

    const aprovadasIds = new Set((todasMedicoes ?? []).filter(m => m.status === 'aprovada').map(m => m.id))
    const mapaAprovado = new Map<string, number>()
    for (const it of todosItensMedicoes ?? []) {
      if (!aprovadasIds.has(it.medicao_id)) continue
      mapaAprovado.set(it.contrato_item_id, (mapaAprovado.get(it.contrato_item_id) ?? 0) + it.quantidade_periodo)
    }
    setJaAprovadoPorItem(mapaAprovado)

    const servicoIds = [...new Set((itensContrato ?? []).map(i => i.servico_id))]
    const unidadeIds = [...new Set((itensContrato ?? []).map(i => i.unidade_id))]
    const [{ data: svcs }, { data: unis }] = await Promise.all([
      servicoIds.length > 0
        ? supabase.from('servicos').select('*').in('id', servicoIds)
        : Promise.resolve({ data: [] as Servico[] }),
      unidadeIds.length > 0
        ? supabase.from('unidades').select('*').in('id', unidadeIds)
        : Promise.resolve({ data: [] as Unidade[] }),
    ])
    setServicos(svcs ?? [])
    setUnidades(unis ?? [])

    if (!nova && medicaoId) {
      const atual = (todasMedicoes ?? []).find(m => m.id === medicaoId) ?? null
      setMedicao(atual)
      if (atual) setDataReferencia(atual.data_referencia)
      const { data: itensAtual } = await supabase.from('medicoes_itens').select('*')
        .eq('medicao_id', medicaoId).eq('ativo', true)
      setItensExistentes(itensAtual ?? [])
    }

    setCarregando(false)
  }

  useEffect(() => {
    if (carregando) return
    const porServico = new Map(servicos.map(s => [s.id, s]))
    const nomeUnidade = new Map(unidades.map(u => [u.id, u.nome]))
    const itemExistentePorContratoItem = new Map(itensExistentes.map(i => [i.contrato_item_id, i]))

    setLinhas(contratoItens.map(ci => {
      const s = porServico.get(ci.servico_id)
      const existente = itemExistentePorContratoItem.get(ci.id)
      return {
        contratoItemId: ci.id,
        servicoNome: s?.nome ?? '—',
        servicoCodigo: s?.codigo ?? '',
        unidadeNome: nomeUnidade.get(ci.unidade_id) ?? '—',
        quantidadeContratada: ci.quantidade,
        valorUnitario: ci.valor_unitario,
        jaAprovado: jaAprovadoPorItem.get(ci.id) ?? 0,
        quantidadePeriodo: existente ? String(existente.quantidade_periodo) : '0',
        medicaoItemId: existente?.id ?? null,
      }
    }))
  }, [carregando, contratoItens, servicos, unidades, itensExistentes, jaAprovadoPorItem])

  function atualizarLinha(contratoItemId: string, valor: string) {
    setLinhas(prev => prev.map(l => l.contratoItemId === contratoItemId ? { ...l, quantidadePeriodo: valor } : l))
  }

  async function salvarNova() {
    if (!contrato) return
    setSalvando(true)
    setMsg(null)
    const { data: novaMedicao, error } = await supabase.from('medicoes').insert({
      contrato_id: contrato.id,
      data_referencia: dataReferencia,
    }).select().single()
    if (error || !novaMedicao) {
      setSalvando(false)
      setMsg({ tipo: 'erro', texto: `Erro ao criar medição: ${error?.message}` })
      return
    }
    const { error: eItens } = await supabase.from('medicoes_itens').insert(
      linhas.map(l => ({
        medicao_id: novaMedicao.id,
        contrato_item_id: l.contratoItemId,
        quantidade_periodo: Number(l.quantidadePeriodo) || 0,
      }))
    )
    setSalvando(false)
    if (eItens) {
      setMsg({ tipo: 'erro', texto: `Medição criada, mas falhou ao salvar itens: ${eItens.message}` })
      return
    }
    navigate(`/contratos/${contrato.id}/medicoes/${novaMedicao.id}`, { replace: true })
  }

  async function salvarEdicao() {
    setSalvando(true)
    setMsg(null)
    for (const l of linhas) {
      if (!l.medicaoItemId) continue
      const { error } = await supabase.from('medicoes_itens')
        .update({ quantidade_periodo: Number(l.quantidadePeriodo) || 0 })
        .eq('id', l.medicaoItemId)
      if (error) {
        setSalvando(false)
        setMsg({ tipo: 'erro', texto: `Erro ao salvar item: ${error.message}` })
        return
      }
    }
    setSalvando(false)
    setMsg({ tipo: 'ok', texto: 'Itens atualizados.' })
    if (contratoId) carregar(contratoId)
  }

  async function aprovar() {
    if (!medicao) return
    if (!confirm('Aprovar esta medição? Os itens ficarão travados e não poderão mais ser alterados.')) return
    setSalvando(true)
    setMsg(null)
    const { error } = await supabase.from('medicoes').update({
      status: 'aprovada', aprovada_por: perfil?.id, aprovada_em: new Date().toISOString(),
    }).eq('id', medicao.id)
    setSalvando(false)
    if (error) {
      setMsg({ tipo: 'erro', texto: `Erro ao aprovar: ${error.message}` })
      return
    }
    if (contratoId) carregar(contratoId)
  }

  function imprimir() {
    if (!contrato || !medicao) return
    gerarPdfMedicao({
      contrato,
      medicao,
      empreiteiroNome,
      itens: linhas.map(l => ({
        servicoCodigo: l.servicoCodigo,
        servicoNome: l.servicoNome,
        unidadeNome: l.unidadeNome,
        quantidadeContratada: l.quantidadeContratada,
        jaAprovado: l.jaAprovado,
        quantidadePeriodo: Number(l.quantidadePeriodo) || 0,
        valorUnitario: l.valorUnitario,
      })),
    })
  }

  if (perfil?.papel === 'cliente') {
    return <div className={styles.page}><p className={styles.vazio}>Módulo de uso interno da equipe.</p></div>
  }
  if (carregando) return <div className={styles.page}><p className={styles.vazio}>Carregando…</p></div>
  if (!contrato) return <div className={styles.page}><p className={styles.vazio}>Contrato não encontrado.</p></div>
  if (nova && !podeEditar) {
    return <div className={styles.page}><p className={styles.vazio}>Você não tem permissão para criar medições.</p></div>
  }
  if (nova && contrato.status !== 'ativo') {
    return <div className={styles.page}><p className={styles.vazio}>Só é possível medir um contrato ativo.</p></div>
  }
  if (!nova && !medicao) {
    return <div className={styles.page}><p className={styles.vazio}>Medição não encontrada.</p></div>
  }

  const bruto = linhas.reduce((acc, l) => acc + (Number(l.quantidadePeriodo) || 0) * l.valorUnitario, 0)
  const retencaoPct = contrato.retencao_pct ?? 0
  const retido = Math.round(bruto * retencaoPct) / 100
  const liquido = bruto - retido
  const podeEditarItens = podeEditar && (nova || medicao?.status === 'rascunho')

  return (
    <div className={styles.page}>
      <button className={styles.voltar} onClick={() => navigate(`/contratos/${contrato.id}`)}>← {contrato.numero}</button>
      <div className={styles.header}>
        <h1>{nova ? 'Nova medição' : `${contrato.numero} — ${medicao!.numero}ª medição`}</h1>
        {medicao && (
          <span className={`${styles.chip} ${styles[`chip_${medicao.status}`]}`}>{STATUS_MEDICAO_LABEL[medicao.status]}</span>
        )}
      </div>

      <div className={styles.bloco}>
        <label className={styles.campo}>
          Data de referência *
          <input type="date" value={dataReferencia} onChange={e => setDataReferencia(e.target.value)}
            disabled={!nova} />
        </label>
      </div>

      <div className={styles.bloco}>
        <h2>Itens</h2>
        <table className={styles.tabela}>
          <thead>
            <tr>
              <th>Serviço</th><th>Unidade</th><th>Qtd. contratada</th><th>Já aprovado</th>
              <th>Saldo antes</th><th>Qtd. neste período</th><th>Valor unit.</th><th>Valor do período</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map(l => {
              const saldoAntes = l.quantidadeContratada - l.jaAprovado
              const valorPeriodo = (Number(l.quantidadePeriodo) || 0) * l.valorUnitario
              return (
                <tr key={l.contratoItemId}>
                  <td>{l.servicoCodigo ? `${l.servicoCodigo} — ` : ''}{l.servicoNome}</td>
                  <td>{l.unidadeNome}</td>
                  <td>{l.quantidadeContratada}</td>
                  <td>{l.jaAprovado}</td>
                  <td>{saldoAntes}</td>
                  <td>
                    {podeEditarItens
                      ? <input type="number" min="0" step="0.0001" value={l.quantidadePeriodo}
                          onChange={e => atualizarLinha(l.contratoItemId, e.target.value)} className={styles.inputQtd} />
                      : l.quantidadePeriodo}
                  </td>
                  <td>R$ {l.valorUnitario.toFixed(2)}</td>
                  <td>R$ {valorPeriodo.toFixed(2)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className={styles.bloco}>
        <div className={styles.resumoLinha}><span>Valor bruto</span><strong>R$ {bruto.toFixed(2)}</strong></div>
        <div className={styles.resumoLinha}><span>Retenção ({retencaoPct}%)</span><strong>− R$ {retido.toFixed(2)}</strong></div>
        <div className={styles.resumoLinha}><span>Valor líquido</span><strong>R$ {liquido.toFixed(2)}</strong></div>
      </div>

      {msg && <p className={msg.tipo === 'ok' ? styles.msgOk : styles.msgErro}>{msg.texto}</p>}

      <div className={styles.acoes}>
        {nova && podeEditarItens && (
          <button className={styles.btnPrincipal} onClick={salvarNova} disabled={salvando}>
            {salvando ? 'Salvando…' : 'Criar medição'}
          </button>
        )}
        {!nova && podeEditarItens && (
          <button className={styles.btnPrincipal} onClick={salvarEdicao} disabled={salvando}>
            {salvando ? 'Salvando…' : 'Salvar itens'}
          </button>
        )}
        {!nova && ehAdmin && medicao?.status === 'rascunho' && (
          <button className={styles.btnPrincipal} onClick={aprovar} disabled={salvando}>
            {salvando ? 'Aprovando…' : 'Aprovar medição'}
          </button>
        )}
        {!nova && (
          <button className={styles.btnSecundario} onClick={imprimir}>🖨️ Imprimir PDF</button>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Verificar**

Rodar `npm run build` — vai falhar até a Task 5 criar `src/lib/medicoesPdf.ts` com a função `gerarPdfMedicao`. **Isso é esperado nesta etapa** — a Task 5 cobre esse arquivo. Se quiser compilar isolado agora, comentar temporariamente o import e o corpo de `imprimir()`; senão, seguir para a Task 3 e voltar a rodar `npm run build` só depois da Task 5.

- [ ] **Step 4: Commit**

```bash
git add src/pages/MedicaoForm.tsx src/pages/MedicaoForm.module.css
git commit -m "Medições: tela de nova medição, detalhe, edição de itens e aprovação"
```

---

### Task 3: Integração no detalhe do contrato + rotas

**Files:**
- Modify: `src/pages/ContratoForm.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `Medicao` de `../lib/supabase` (Task 1); `STATUS_MEDICAO_LABEL` de `./MedicaoForm` (Task 2); componente `MedicaoForm` (Task 2).
- Produces: rota `contratos/:contratoId/medicoes/:medicaoId` montada; seção "Medições" visível no detalhe de um contrato ativo.

- [ ] **Step 1: Adicionar imports em `src/pages/ContratoForm.tsx`**

No topo do arquivo, alterar a linha de import de `../lib/supabase` (linha 5-8 do arquivo atual) de:

```tsx
import {
  supabase, type Servico, type Unidade, type Empreiteiro,
  type Contrato, type ContratoItem,
} from '../lib/supabase'
```

para:

```tsx
import {
  supabase, type Servico, type Unidade, type Empreiteiro,
  type Contrato, type ContratoItem, type Medicao,
} from '../lib/supabase'
```

Logo abaixo do import de `STATUS_LABEL` (`import { STATUS_LABEL } from './Contratos'`), adicionar:

```tsx
import { STATUS_MEDICAO_LABEL } from './MedicaoForm'
```

- [ ] **Step 2: Passar `podeEditarMedicoes` para `DetalheContrato`**

Dentro do componente `ContratoForm`, logo após a linha `const podeEditar = perfil?.papel === 'admin' || temModulo('contratos')`, adicionar:

```tsx
  const podeEditarMedicoes = perfil?.papel === 'admin' || temModulo('medicoes')
```

No JSX que renderiza `<DetalheContrato ... />` (dentro do bloco `if (!novo) { ... }`), adicionar a prop nova:

```tsx
      <DetalheContrato
        contrato={contrato} itens={itensContrato} servicos={servicos} unidades={unidades} empreiteiros={empreiteiros}
        podeEditar={podeEditar} podeEditarMedicoes={podeEditarMedicoes} ehAdmin={perfil?.papel === 'admin'} perfilId={perfil?.id}
        onRecarregar={() => carregarContrato(contrato.id)}
      />
```

- [ ] **Step 3: Atualizar `DetalheContratoProps` e a assinatura de `DetalheContrato`**

Na interface `DetalheContratoProps`, adicionar o campo:

```tsx
  podeEditarMedicoes: boolean
```

Na assinatura da função `DetalheContrato`, adicionar `podeEditarMedicoes` à desestruturação de props:

```tsx
function DetalheContrato({ contrato, itens, servicos, unidades, empreiteiros, podeEditar, podeEditarMedicoes, ehAdmin, perfilId, onRecarregar }: DetalheContratoProps) {
```

- [ ] **Step 4: Buscar e exibir as medições do contrato**

Dentro de `DetalheContrato`, logo após a declaração de `const podeEditarItens = podeEditar && contrato.status === 'rascunho'`, adicionar:

```tsx
  const [medicoes, setMedicoes] = useState<Medicao[]>([])
  const [carregandoMedicoes, setCarregandoMedicoes] = useState(true)

  useEffect(() => {
    supabase.from('medicoes').select('*').eq('contrato_id', contrato.id).eq('ativo', true)
      .order('numero', { ascending: false })
      .then(({ data }) => { setMedicoes(data ?? []); setCarregandoMedicoes(false) })
  }, [contrato.id])
```

No JSX, logo antes do bloco final `<div className={styles.bloco}><h2>Itens</h2>...</div>` (ou seja, adicionar uma nova seção depois dele, antes do `</div>` que fecha `.page`), adicionar:

```tsx
      {contrato.status === 'ativo' && (
        <div className={styles.bloco}>
          <div className={styles.header} style={{ marginBottom: 10 }}>
            <h2 style={{ margin: 0 }}>Medições</h2>
            {podeEditarMedicoes && (
              <button className={styles.btnSecundario} onClick={() => navigate(`/contratos/${contrato.id}/medicoes/nova`)}>
                + Nova medição
              </button>
            )}
          </div>
          {carregandoMedicoes && <p className={styles.vazio}>Carregando…</p>}
          {!carregandoMedicoes && medicoes.length === 0 && <p className={styles.vazio}>Nenhuma medição lançada.</p>}
          {medicoes.map(m => (
            <button key={m.id} className={styles.btnSecundario}
              style={{ display: 'block', width: '100%', textAlign: 'left', marginBottom: 6 }}
              onClick={() => navigate(`/contratos/${contrato.id}/medicoes/${m.id}`)}>
              {m.numero}ª medição — {STATUS_MEDICAO_LABEL[m.status]} — R$ {m.valor_liquido.toFixed(2)}
            </button>
          ))}
        </div>
      )}
```

- [ ] **Step 5: Registrar a rota em `src/App.tsx`**

Adicionar o import logo após `import ContratoForm from './pages/ContratoForm'`:

```tsx
import MedicaoForm from './pages/MedicaoForm'
```

Adicionar a rota logo após `<Route path="contratos/:id" element={<ContratoForm />} />`:

```tsx
        <Route path="contratos/:contratoId/medicoes/:medicaoId" element={<MedicaoForm />} />
```

- [ ] **Step 6: Verificar**

Rodar `npm run build` (deve compilar limpo agora que `MedicaoForm.tsx` importa `gerarPdfMedicao`, que só existe a partir da Task 5 — se ainda não fez a Task 5, esperar erro de módulo não encontrado e seguir para lá antes de validar esta etapa). No navegador, logado como admin: abrir um contrato ativo existente (ou ativar um de teste), confirmar que a seção "Medições" aparece com "Nenhuma medição lançada." e que "+ Nova medição" navega para `/contratos/<id>/medicoes/nova`, mostrando a tabela pré-preenchida com os itens do contrato.

- [ ] **Step 7: Commit**

```bash
git add src/pages/ContratoForm.tsx src/App.tsx
git commit -m "Medições: integra seção de medições no detalhe do contrato ativo"
```

---

### Task 4: Lista global `/medicoes`

**Files:**
- Create: `src/pages/Medicoes.tsx`
- Create: `src/pages/Medicoes.module.css`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `STATUS_MEDICAO_LABEL` de `./MedicaoForm` (Task 2); tabelas `medicoes`/`contratos`/`empreiteiros` via select aninhado; `useAuth()`, `useObra()`.
- Produces: componente `Medicoes` default-exportado, substitui o stub `EmConstrucao` na rota `/medicoes`.

- [ ] **Step 1: Criar `src/pages/Medicoes.module.css`**

```css
.page {
  max-width: 720px;
  margin: 0 auto;
  padding-bottom: 40px;
}

.page h1 { font-size: 20px; margin-bottom: 4px; }

.sub {
  color: var(--cinza-600);
  font-size: 13px;
  margin-bottom: 16px;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 16px;
}

.filtros { display: flex; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; }

.selectFiltro {
  padding: 10px 12px;
  border: 1.5px solid var(--cinza-200);
  border-radius: var(--radius-sm);
  font-size: 14px;
  background: var(--branco);
  min-width: 180px;
}

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

.cardTopo {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  margin-bottom: 5px;
}

.cardNumero { font-family: var(--font-titulo); font-weight: 700; color: var(--navy); font-size: 14px; }

.cardDesc { font-size: 14px; color: var(--cinza-800); margin-bottom: 7px; }

.cardRodape {
  display: flex;
  gap: 14px;
  flex-wrap: wrap;
  font-size: 12px;
  color: var(--cinza-600);
}

.chip {
  font-size: 11px;
  font-weight: 700;
  border-radius: 999px;
  padding: 3px 10px;
  white-space: nowrap;
}

.chip_rascunho { background: #eceff1; color: #546e7a; }
.chip_aprovada { background: #e3f4e3; color: #1e6b2e; }

.vazio { color: var(--cinza-600); font-size: 14px; padding: 12px 0; }
```

- [ ] **Step 2: Criar `src/pages/Medicoes.tsx`**

```tsx
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useObra } from '../contexts/ObraContext'
import { supabase, type StatusMedicao } from '../lib/supabase'
import { STATUS_MEDICAO_LABEL } from './MedicaoForm'
import styles from './Medicoes.module.css'

interface MedicaoLista {
  id: string
  numero: number
  status: StatusMedicao
  valor_liquido: number
  contrato_id: string
  contratos: { numero: string; empreiteiros: { nome: string } | null } | null
}

export default function Medicoes() {
  const { perfil } = useAuth()
  const { obraAtiva } = useObra()
  const navigate = useNavigate()

  const [medicoes, setMedicoes] = useState<MedicaoLista[]>([])
  const [carregando, setCarregando] = useState(true)
  const [filtroStatus, setFiltroStatus] = useState<StatusMedicao | ''>('')

  useEffect(() => {
    if (!obraAtiva) return
    setCarregando(true)
    supabase.from('medicoes')
      .select('id, numero, status, valor_liquido, contrato_id, contratos!inner(numero, obra_id, empreiteiros(nome))')
      .eq('ativo', true)
      .eq('contratos.obra_id', obraAtiva.id)
      .order('criado_em', { ascending: false })
      .then(({ data }) => {
        setMedicoes((data ?? []) as unknown as MedicaoLista[])
        setCarregando(false)
      })
  }, [obraAtiva])

  const filtradas = useMemo(() => medicoes.filter(m => !filtroStatus || m.status === filtroStatus), [medicoes, filtroStatus])

  if (perfil?.papel === 'cliente') {
    return <div className={styles.page}><p className={styles.vazio}>Módulo de uso interno da equipe.</p></div>
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1>Medições</h1>
          <p className={styles.sub}>Medições de todos os contratos com empreiteiros.</p>
        </div>
      </div>

      <div className={styles.filtros}>
        <select className={styles.selectFiltro} value={filtroStatus}
          onChange={e => setFiltroStatus(e.target.value as StatusMedicao | '')}>
          <option value="">Todos os status</option>
          <option value="rascunho">Rascunho</option>
          <option value="aprovada">Aprovada</option>
        </select>
      </div>

      {carregando && <p className={styles.vazio}>Carregando…</p>}
      {!carregando && filtradas.length === 0 && (
        <p className={styles.vazio}>{medicoes.length === 0 ? 'Nenhuma medição registrada.' : 'Nenhuma medição com esse filtro.'}</p>
      )}

      {filtradas.map(m => (
        <button key={m.id} className={styles.card} onClick={() => navigate(`/contratos/${m.contrato_id}/medicoes/${m.id}`)}>
          <div className={styles.cardTopo}>
            <span className={styles.cardNumero}>{m.contratos?.numero} — {m.numero}ª medição</span>
            <span className={`${styles.chip} ${styles[`chip_${m.status}`]}`}>{STATUS_MEDICAO_LABEL[m.status]}</span>
          </div>
          <div className={styles.cardDesc}>{m.contratos?.empreiteiros?.nome ?? '—'}</div>
          <div className={styles.cardRodape}>
            <span>R$ {m.valor_liquido.toFixed(2)}</span>
          </div>
        </button>
      ))}
    </div>
  )
}
```

- [ ] **Step 3: Substituir o stub em `src/App.tsx`**

Adicionar o import logo após `import Medicoes from './pages/Medicoes'` — na verdade, adicionar o import (ainda não existe):

```tsx
import Medicoes from './pages/Medicoes'
```

Localizar a linha atual:

```tsx
        <Route path="medicoes" element={<EmConstrucao modulo="Medições de Empreiteiros" fase={7} />} />
```

Substituir por:

```tsx
        <Route path="medicoes" element={<Medicoes />} />
```

- [ ] **Step 4: Verificar**

Rodar `npm run build`. No navegador, logado como admin: acessar `/medicoes` pelo menu lateral, confirmar que a lista mostra as medições já criadas (se houver, da Task 3) com número do contrato, nome do empreiteiro, status e valor líquido; testar o filtro por status. Logado como cliente: confirmar que o item de menu "Medições" nem aparece.

- [ ] **Step 5: Commit**

```bash
git add src/pages/Medicoes.tsx src/pages/Medicoes.module.css src/App.tsx
git commit -m "Medições: lista global substituindo o placeholder Em Construção"
```

---

### Task 5: PDF da medição

**Files:**
- Create: `src/lib/medicoesPdf.ts`

**Interfaces:**
- Consumes: `Contrato`, `Medicao` de `../lib/supabase` (Task 1); `jspdf` (já é dependência do projeto, usado por `comprasPdf.ts`).
- Produces: `export function gerarPdfMedicao(d: DadosPdfMedicao): void` e `export interface ItemPdfMedicao` / `DadosPdfMedicao` — consumidos por `MedicaoForm.tsx` (Task 2, já escrito com esse import — esta task cria o arquivo que faltava para aquele build passar).

- [ ] **Step 1: Criar `src/lib/medicoesPdf.ts`**

```ts
// Geração do PDF da medição de empreiteiro com identidade RT Engenharia
// (jsPDF, client-side) — mesmo padrão visual de comprasPdf.ts. Mostra
// quantidade contratada, já aprovada, medida neste período e saldo,
// mais o resumo bruto/retido/líquido.
import { jsPDF } from 'jspdf'
import type { Contrato, Medicao } from './supabase'

const NAVY = '#1A3248'
const TERRACOTA = '#C49A7A'
const CINZA = '#6c757d'

export interface ItemPdfMedicao {
  servicoCodigo: string
  servicoNome: string
  unidadeNome: string
  quantidadeContratada: number
  jaAprovado: number
  quantidadePeriodo: number
  valorUnitario: number
}

export interface DadosPdfMedicao {
  contrato: Contrato
  medicao: Medicao
  empreiteiroNome: string
  itens: ItemPdfMedicao[]
}

function fmtData(iso: string | null): string {
  if (!iso) return '—'
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`
}

export function gerarPdfMedicao(d: DadosPdfMedicao): void {
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' })
  const W = 210
  const ML = 14
  const MR = 14
  const LARG = W - ML - MR
  let y = 0

  function rodape() {
    const total = pdf.getNumberOfPages()
    for (let i = 1; i <= total; i++) {
      pdf.setPage(i)
      pdf.setDrawColor(TERRACOTA)
      pdf.setLineWidth(0.5)
      pdf.line(ML, 285, W - MR, 285)
      pdf.setFontSize(7.5)
      pdf.setTextColor(CINZA)
      pdf.setFont('helvetica', 'normal')
      pdf.text('RT Engenharia — Rodrigo Teles Silva · CREA 1018712895 D/GO · Inteligência Aplicada', ML, 290)
      pdf.text(`Página ${i} de ${total}`, W - MR, 290, { align: 'right' })
    }
  }

  function novaPagina() { pdf.addPage(); y = 16 }
  function precisa(mm: number) { if (y + mm > 280) novaPagina() }

  // ---------- cabeçalho ----------
  pdf.setFillColor(NAVY)
  pdf.rect(0, 0, W, 30, 'F')
  pdf.setFillColor(TERRACOTA)
  pdf.rect(0, 30, W, 1.4, 'F')
  pdf.setTextColor('#ffffff')
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(17)
  pdf.text('RT ENGENHARIA', ML, 13)
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(8.5)
  pdf.setTextColor('#B8D4E8')
  pdf.text('Inteligência Aplicada', ML, 18.5)
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(11)
  pdf.setTextColor('#ffffff')
  pdf.text('MEDIÇÃO', W - MR, 12, { align: 'right' })
  pdf.setFontSize(10)
  pdf.setTextColor('#D0AE95')
  pdf.text(`${d.contrato.numero} — ${d.medicao.numero}ª medição`, W - MR, 18.5, { align: 'right' })
  y = 39

  // ---------- identificação ----------
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(11)
  pdf.setTextColor('#222222')
  pdf.text(`Empreiteiro: ${d.empreiteiroNome}`, ML, y)
  y += 6
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(9.5)
  pdf.setTextColor(CINZA)
  pdf.text(`Objeto: ${d.contrato.objeto}`, ML, y)
  y += 5.5
  pdf.text(`Data de referência: ${fmtData(d.medicao.data_referencia)}`, ML, y)
  y += 8

  // ---------- tabela de itens ----------
  const colX = { item: ML, und: ML + 58, contratada: ML + 74, antes: ML + 94, periodo: ML + 114, unit: ML + 134, total: ML + 157 }
  const colW = { item: 56, und: 14, contratada: 18, antes: 18, periodo: 18, unit: 21, total: 22 }

  function cabecalhoTabela() {
    precisa(10)
    pdf.setFillColor('#F0EBE3')
    pdf.rect(ML, y, LARG, 7, 'F')
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(7.5)
    pdf.setTextColor(NAVY)
    pdf.text('SERVIÇO', colX.item + 1, y + 4.7)
    pdf.text('UND.', colX.und + 1, y + 4.7)
    pdf.text('CONTRAT.', colX.contratada + 1, y + 4.7)
    pdf.text('ANTES', colX.antes + 1, y + 4.7)
    pdf.text('PERÍODO', colX.periodo + 1, y + 4.7)
    pdf.text('V. UNIT.', colX.unit + 1, y + 4.7)
    pdf.text('V. TOTAL', colX.total + 1, y + 4.7)
    y += 7
  }

  cabecalhoTabela()

  let bruto = 0
  for (const it of d.itens) {
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(8.5)
    const nomeCompleto = it.servicoCodigo ? `${it.servicoCodigo} — ${it.servicoNome}` : it.servicoNome
    const linhasItem = pdf.splitTextToSize(nomeCompleto, colW.item - 2) as string[]
    const alturaLinha = Math.max(linhasItem.length, 1) * 4.2 + 2.5
    const valorTotalItem = it.quantidadePeriodo * it.valorUnitario
    bruto += valorTotalItem

    precisa(alturaLinha)
    pdf.setDrawColor('#E0DAD0')
    pdf.setLineWidth(0.2)
    pdf.line(ML, y, W - MR, y)

    pdf.setTextColor('#222222')
    pdf.text(linhasItem, colX.item + 1, y + 4.2)
    pdf.text(it.unidadeNome, colX.und + 1, y + 4.2)
    pdf.text(`${it.quantidadeContratada}`, colX.contratada + 1, y + 4.2)
    pdf.text(`${it.jaAprovado}`, colX.antes + 1, y + 4.2)
    pdf.text(`${it.quantidadePeriodo}`, colX.periodo + 1, y + 4.2)
    pdf.text(`R$ ${it.valorUnitario.toFixed(2)}`, colX.unit + 1, y + 4.2)
    pdf.text(`R$ ${valorTotalItem.toFixed(2)}`, colX.total + 1, y + 4.2)
    y += alturaLinha
  }
  pdf.setDrawColor('#E0DAD0')
  pdf.line(ML, y, W - MR, y)
  y += 10

  // ---------- resumo financeiro ----------
  const retencaoPct = d.contrato.retencao_pct ?? 0
  const retido = Math.round(bruto * retencaoPct) / 100
  const liquido = bruto - retido

  precisa(24)
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(10)
  pdf.setTextColor('#222222')
  pdf.text('Valor bruto:', colX.unit, y)
  pdf.text(`R$ ${bruto.toFixed(2)}`, W - MR, y, { align: 'right' })
  y += 6
  pdf.text(`Retenção (${retencaoPct}%):`, colX.unit, y)
  pdf.text(`− R$ ${retido.toFixed(2)}`, W - MR, y, { align: 'right' })
  y += 6
  pdf.setFont('helvetica', 'bold')
  pdf.text('Valor líquido:', colX.unit, y)
  pdf.text(`R$ ${liquido.toFixed(2)}`, W - MR, y, { align: 'right' })

  rodape()
  pdf.save(`${d.contrato.numero} - MEDICAO ${d.medicao.numero} - ${d.empreiteiroNome}.pdf`)
}
```

- [ ] **Step 2: Verificar**

Rodar `npm run build` — deve compilar limpo agora (Tasks 2-5 completas). No navegador, logado como admin: abrir uma medição existente (rascunho ou aprovada), clicar "🖨️ Imprimir PDF", confirmar que o arquivo baixa com cabeçalho RT, tabela de itens e resumo bruto/retido/líquido corretos.

- [ ] **Step 3: Commit**

```bash
git add src/lib/medicoesPdf.ts
git commit -m "Medições: geração de PDF com identidade RT"
```

---

### Task 6: Verificação end-to-end e documentação de entrega

**Files:**
- Create: `docs/fase7_medicoes.md`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: nada de código novo — esta task só documenta e valida manualmente o que as Tasks 1-5 entregaram.
- Produces: registro formal da entrega, seguindo o mesmo padrão de `docs/fase7_contratos.md`.

- [ ] **Step 1: Checklist de verificação manual (sem código)**

Executar cada item logado com o papel indicado, no navegador (desktop e celular):

1. **Admin** — cria uma medição em um contrato ativo com pelo menos 2 itens, lança quantidades (incluindo uma fracionada, ex.: `1.2`), salva como rascunho, edita de novo, aprova. Confirma que os valores bruto/retido/líquido batem com o cálculo manual (quantidade × valor unitário, retenção do contrato).
2. **Admin** — tenta aprovar uma medição cuja quantidade somada ultrapassa o saldo contratado de algum item (pode reduzir a quantidade contratada de um item de teste ou medir alto o suficiente) — confirma que a tela mostra a mensagem de erro da trava de saldo e a medição continua em rascunho.
3. **Admin** — tenta editar itens de uma medição já aprovada (inclusive tentando direto pela URL) — confirma que a tela não permite e que uma tentativa de update via API é bloqueada pelo RLS.
4. **Equipe com módulo `medicoes` habilitado** (em `/usuarios`) — consegue criar/editar medição em rascunho, mas **não vê** o botão "Aprovar medição".
5. **Equipe sem o módulo `medicoes`** — não vê a seção "Medições" no contrato nem consegue acessar `/medicoes` pelo menu (ou recebe aviso de permissão se acessar a URL direto).
6. **Cliente** — não vê "Medições" no menu, e acessar `/medicoes` ou `/contratos/:id/medicoes/:id` direto pela URL mostra o aviso de módulo interno.
7. Confirma que a numeração das medições é sequencial por contrato (1, 2, 3…) e não colide entre contratos diferentes.
8. PDF gera com os valores corretos e identidade RT, em pelo menos uma medição rascunho e uma aprovada.
9. Testar em celular (não só desktop) o fluxo de criar e aprovar uma medição.

Se qualquer item falhar, voltar à task correspondente antes de prosseguir — não documentar a entrega com um critério de aceite não verificado.

- [ ] **Step 2: Criar `docs/fase7_medicoes.md`**

```markdown
# Fase 7 — Medições de empreiteiros

> Detalhes técnicos do módulo de Medições. Entregue em 13/07/2026, aguardando teste de campo
> com uma medição real e aceite do Rodrigo — ver CLAUDE.md §0.
> Consome as tabelas de Contratos (`docs/fase7_contratos.md`) — cobre apenas o regime de
> empreiteiros terceirizados por serviço.

## O que foi entregue

- Medição vinculada a um contrato **ativo** (`/contratos/:id/medicoes/nova` e
  `/contratos/:id/medicoes/:medicaoId`), numerada em sequência por contrato (1ª, 2ª medição…).
- Uma linha por item do contrato, herdando serviço/unidade/valor unitário — sem busca de
  serviço nova, os itens vêm sempre do próprio contrato.
- Quantidade executada no período aceita valores fracionados (ex.: `1,2`). Saldo (quanto falta)
  e valor do período calculados automaticamente a partir da quantidade contratada e do que já
  foi aprovado antes.
- Fluxo de status **rascunho → aprovada**, aprovação exclusiva do admin, sem volta.
- **Trava de saldo no banco:** ao aprovar, bloqueia se a soma de tudo que já foi aprovado
  ultrapassar a quantidade contratada de qualquer item — sem exceção nem para admin.
- **Retenção calculada:** valor bruto medido, valor retido (bruto × retenção % do contrato) e
  valor líquido a pagar — primeira funcionalidade do app a usar esse campo do contrato.
- Itens de medição aprovada são permanentemente imutáveis (trava desde a primeira migração,
  sem precisar de correção posterior como aconteceu em Contratos).
- PDF com identidade RT (itens + resumo bruto/retido/líquido), sem assinatura digital nesta
  versão.
- Lista global em `/medicoes` (substitui o placeholder "Em construção"), com filtro por status.
- Módulo `medicoes` (checkbox em Usuários, já existia no enum desde 07/07/2026, nunca usado
  até agora): admin sempre tem acesso; equipe só com o módulo habilitado cria/edita rascunho e
  aprova (aprovação sempre exclusiva do admin). Cliente não vê o módulo.

## Onde estão as regras de negócio

RLS e triggers em `supabase/migrations/20260713_fase7_medicoes.sql`. Diferente de Contratos,
que precisou de duas migrações de correção no mesmo dia (bypass de admin em itens e transição
de status fora de ordem), aqui as duas lições já entraram na primeira versão: itens de medição
nunca têm exceção de admin na imutabilidade, e qualquer medição aprovada é bloqueada contra
qualquer alteração (não só de status) desde o início.

Ver `docs/superpowers/specs/2026-07-13-fase7-medicoes-design.md` para o desenho completo e
`docs/superpowers/plans/2026-07-13-fase7-medicoes.md` para o plano de implementação.

## Fora de escopo (spec explicitamente deferiu)

- Regime de mão de obra direta (produção individual de funcionários próprios) — spec futura
  separada.
- Lançamento financeiro real (pagamento) — Financeiro (Fase 3) ainda não existe; a medição
  aprovada só registra o valor líquido a pagar.
- Anexo de comprovante/documento assinado da medição — pedido adiado pelo Rodrigo em
  13/07/2026, para tratar depois num módulo próprio de anexos/documentos.
- Vínculo automático com Avanço Físico do Cronograma — quantidade é sempre digitada
  manualmente na medição, por decisão do Rodrigo.
- Edição do cabeçalho da medição (data de referência) e exclusão de medição aprovada pela
  tela — permanente por design.
```

- [ ] **Step 3: Atualizar `CLAUDE.md`**

No topo do `§0. Estado atual`, adicionar um novo parágrafo logo após o parágrafo de Contratos
(a linha que começa com `**Contratos (\`/contratos\`, \`/empreiteiros\`) — entregue em
13/07/2026...`):

```markdown
- **Medições (`/contratos/:id/medicoes`, `/medicoes`) — entregue em 13/07/2026, aguardando teste de campo com uma medição real e aceite.** Detalhes em `docs/fase7_medicoes.md`. Lança quantidade executada por item de contrato ativo (aceita fração, ex.: 1,2), acumula saldo frente à quantidade contratada, calcula valor bruto/retido/líquido (primeiro uso real do campo retenção % do contrato), aprovação exclusiva do admin com trava de saldo no banco sem exceção. PDF com identidade RT. Fora de escopo: regime de mão de obra direta (produção própria), lançamento financeiro real (Fase 3 não existe), anexo de comprovante assinado (adiado a pedido do Rodrigo), vínculo automático com Avanço Físico.
```

Atualizar a linha `**Próxima etapa:**` para refletir que Medições (regime de empreiteiros) já
foi entregue, substituindo a menção a "seguir para Medições" pela pendência de aceite dela
junto com as demais aguardando teste de campo, e mantendo Financeiro como próxima fase grande
ainda não iniciada.

No final do arquivo, adicionar uma nova entrada de changelog, incrementando a versão (a última
registrada é 1.9):

```markdown
*Versão 1.10 — 13/07/2026 — §0 registra o módulo Medições (Fase 7) entregue: lançamento de
quantidade executada por item de contrato ativo, trava de saldo no banco sem exceção pra
admin, cálculo de retenção (bruto/retido/líquido), aprovação exclusiva do admin, PDF com
identidade RT. Cobre só o regime de empreiteiros por serviço — produção própria fica pra spec
futura. Ver `docs/fase7_medicoes.md`.*
```

E atualizar a linha `> Versão X.X — ...` no topo do arquivo (logo abaixo do título) para
`> Versão 1.10 — 13/07/2026`.

- [ ] **Step 4: Commit**

```bash
git add docs/fase7_medicoes.md CLAUDE.md
git commit -m "Docs: registra entrega do módulo Medições (Fase 7)"
```

---

## Self-Review

**Cobertura da spec:** todas as seções de `docs/superpowers/specs/2026-07-13-fase7-medicoes-design.md`
têm task correspondente — §2 (modelo de dados) e §3 (numeração) → Task 1; §4 (trava de saldo) →
Task 1 (schema) + Task 6 Step 1 item 2 (verificação); §5 (telas) → Tasks 2-4; §6 (PDF) → Task 5;
§7 (permissões/RLS) → Task 1 (schema) + Task 6 Step 1 itens 3-6 (verificação); §8
(rastreabilidade) → Task 1 (`criado_por`/`aprovada_por` já no schema); §9 (fora de escopo) →
documentado na Task 6; §10 (critérios de aceite) → Task 6 Step 1.

**Consistência de tipos:** `contrato_item_id`/`quantidade_periodo`/`valor_total_item` em
`medicoes_itens` usados de forma consistente entre a migração (Task 1), `MedicaoForm.tsx`
(Task 2) e `medicoesPdf.ts` (Task 5). `STATUS_MEDICAO_LABEL` exportado uma única vez em
`MedicaoForm.tsx` e importado por `ContratoForm.tsx` (Task 3) e `Medicoes.tsx` (Task 4) — sem
duplicação.
