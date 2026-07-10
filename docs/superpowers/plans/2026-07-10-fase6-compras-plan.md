# Fase 6 — Suprimentos: Compras — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar o módulo de Compras (Fase 6, primeira metade) descrito em `docs/superpowers/specs/2026-07-10-fase6-compras-design.md`: pedido → cotações por item → aprovação (admin) → envio → recebimento com NF → conferência → encerramento.

**Architecture:** Supabase Postgres (schema + RLS + triggers) seguindo exatamente o padrão já usado em Pendências/FVS (`meu_papel()`, `meus_modulos()`, tabela por entidade, soft delete via `ativo`). Frontend React 19 + Vite, páginas em `src/pages` com CSS Modules, mesmo padrão de `Pendencias.tsx`/`PendenciaForm.tsx` (lista + formulário/detalhe numa rota `:id`, `nova` como id especial).

**Tech Stack:** React 19, react-router-dom 7, @supabase/supabase-js 2, TypeScript 5, Vite 6. Sem framework de testes automatizados no repo (nenhum jest/vitest instalado) — verificação é `npm run build` (checagem de tipos via `tsc -b`) + teste manual roteirizado em cada tarefa, mesmo padrão usado nas Fases 1–5.

## Global Constraints

- Toda tabela nova tem RLS habilitado; nenhuma tabela fica acessível sem policy explícita (CLAUDE.md §2, "regra dura").
- Todo registro grava autor (`criado_por UUID NOT NULL DEFAULT auth.uid()`) e timestamp (`criado_em TIMESTAMPTZ NOT NULL DEFAULT now()`) — CLAUDE.md §6.1.
- Nada se apaga de verdade: tabelas mutáveis (`fornecedores`, `pedidos_compra`, `pedidos_compra_itens`) têm `ativo BOOLEAN NOT NULL DEFAULT true`; tabelas de histórico (`cotacoes`, `cotacoes_itens`, `recebimentos_nf`) são somente-insert (sem policy de UPDATE/DELETE) — CLAUDE.md §6.4.
- Cliente (papel `cliente`) nunca vê Compras — não está entre os módulos do papel cliente (CLAUDE.md §2). Todas as SELECT policies restringem a `meu_papel() IN ('admin', 'equipe')`.
- Aprovar pedido, marcar vencedor por item e cancelar pedido são ações exclusivas do admin (CLAUDE.md §5, regras do módulo Compras).
- Migrations em `supabase/migrations/`, nome no padrão `YYYYMMDD_descricao.sql`, aplicadas via Supabase MCP (`apply_migration`), nunca alteração manual direta em produção (CLAUDE.md §3).
- Paleta RT: navy `#1A3248` / terracota `#C49A7A` já disponíveis como CSS vars `--navy` / `--terracota` em `src/styles` — reutilizar, nunca hardcodar hex novo.
- O enum `modulo_app` já contém o valor `'compras'` (definido em `20260707_fase0_fundacao.sql`) e o checkbox já existe em `src/pages/Usuarios.tsx` (`MODULOS_LABELS.compras = 'Compras'`) — **nenhuma migration nem alteração em Usuarios.tsx é necessária para permissões**.
- A rota `/compras` e o item de menu já existem em `src/App.tsx` (linha 45, hoje aponta para `<EmConstrucao modulo="Compras" fase={6} />`) e em `src/components/Layout.tsx` (linha 36) — só trocar o componente da rota, não criar navegação nova.

---

### Task 1: Migration — schema completo de Compras

**Files:**
- Create: `supabase/migrations/20260710_fase6_compras.sql`

**Interfaces:**
- Produces (tabelas/tipos usados pelas tasks seguintes): `fornecedores`, `pedidos_compra` (com `numero`, `status status_pedido_compra`), `pedidos_compra_itens` (com `servico_id` nullable, `cotacao_item_vencedora_id` nullable, `quantidade_recebida`), `cotacoes`, `cotacoes_itens`, `recebimentos_nf`. Bucket de storage `cotacoes-nf`.

- [ ] **Step 1: Escrever a migration completa**

```sql
-- ============================================================
-- FASE 6 — SUPRIMENTOS: COMPRAS | RT Engenharia
-- ============================================================
-- Pedido de compra com múltiplos itens, cada item vinculado
-- (quando possível) a um serviço do orçamento. Cotações por
-- fornecedor com preço por item; vencedor definido por item
-- (só admin). Recebimento com NF, status recalculado automático.
-- Cliente NÃO vê Compras (CLAUDE.md §2).
-- Decisões do Rodrigo em 10/07/2026 (ver spec no mesmo dia).

CREATE TYPE status_pedido_compra AS ENUM (
  'rascunho', 'em_cotacao', 'aprovado', 'enviado',
  'recebido_parcial', 'recebido_total', 'conferido_nf', 'encerrado', 'cancelado'
);

CREATE TABLE fornecedores (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome        TEXT NOT NULL,
  contato     TEXT,
  cnpj        TEXT,
  ativo       BOOLEAN NOT NULL DEFAULT true,
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT now(),
  criado_por  UUID NOT NULL DEFAULT auth.uid() REFERENCES perfis_usuario(id)
);

-- Contador de numeração sequencial por obra (não é RLS-editável
-- diretamente; só a função proximo_numero_pedido(), SECURITY DEFINER,
-- escreve aqui). Obras já existentes na data desta migration começam
-- do 65 (64 pedidos já feitos fora do app); obras novas começam do 001.
CREATE TABLE pedidos_compra_seq (
  obra_id       UUID PRIMARY KEY REFERENCES obras(id) ON DELETE CASCADE,
  ultimo_numero INTEGER NOT NULL DEFAULT 0
);

INSERT INTO pedidos_compra_seq (obra_id, ultimo_numero)
SELECT id, 64 FROM obras
ON CONFLICT (obra_id) DO NOTHING;

CREATE TABLE pedidos_compra (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  obra_id              UUID NOT NULL REFERENCES obras(id) ON DELETE CASCADE,
  numero               INTEGER NOT NULL,
  status               status_pedido_compra NOT NULL DEFAULT 'rascunho',
  descricao            TEXT,
  motivo_cancelamento  TEXT,
  aprovado_por         UUID REFERENCES perfis_usuario(id),
  aprovado_em          TIMESTAMPTZ,
  ativo                BOOLEAN NOT NULL DEFAULT true,
  criado_em            TIMESTAMPTZ NOT NULL DEFAULT now(),
  criado_por           UUID NOT NULL DEFAULT auth.uid() REFERENCES perfis_usuario(id),
  UNIQUE (obra_id, numero)
);

CREATE OR REPLACE FUNCTION proximo_numero_pedido() RETURNS TRIGGER AS $$
DECLARE
  v_numero INTEGER;
BEGIN
  INSERT INTO pedidos_compra_seq (obra_id, ultimo_numero)
  VALUES (NEW.obra_id, 0)
  ON CONFLICT (obra_id) DO NOTHING;

  UPDATE pedidos_compra_seq
    SET ultimo_numero = ultimo_numero + 1
    WHERE obra_id = NEW.obra_id
    RETURNING ultimo_numero INTO v_numero;

  NEW.numero := v_numero;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_numero_pedido
  BEFORE INSERT ON pedidos_compra
  FOR EACH ROW EXECUTE FUNCTION proximo_numero_pedido();

CREATE TABLE pedidos_compra_itens (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_id                 UUID NOT NULL REFERENCES pedidos_compra(id) ON DELETE CASCADE,
  servico_id                UUID REFERENCES servicos(id),          -- NULL = "a classificar"
  descricao_item            TEXT NOT NULL,
  quantidade_pedida         NUMERIC(14,4) NOT NULL,
  und                       TEXT,
  data_necessaria           DATE,
  urgente                   BOOLEAN NOT NULL DEFAULT false,
  cotacao_item_vencedora_id UUID,                                  -- FK adicionada depois de cotacoes_itens existir
  quantidade_recebida       NUMERIC(14,4) NOT NULL DEFAULT 0,
  valor_recebido            NUMERIC(14,2),
  ativo                     BOOLEAN NOT NULL DEFAULT true,
  criado_em                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  criado_por                UUID NOT NULL DEFAULT auth.uid() REFERENCES perfis_usuario(id)
);

CREATE TABLE cotacoes (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_id           UUID NOT NULL REFERENCES pedidos_compra(id) ON DELETE CASCADE,
  fornecedor_id       UUID NOT NULL REFERENCES fornecedores(id),
  condicao_pagamento  TEXT,
  prazo_entrega_dias  INTEGER,
  anexo_url           TEXT NOT NULL,                               -- caminho no bucket 'cotacoes-nf'
  criado_em           TIMESTAMPTZ NOT NULL DEFAULT now(),
  criado_por          UUID NOT NULL DEFAULT auth.uid() REFERENCES perfis_usuario(id)
);

CREATE TABLE cotacoes_itens (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cotacao_id      UUID NOT NULL REFERENCES cotacoes(id) ON DELETE CASCADE,
  pedido_item_id  UUID NOT NULL REFERENCES pedidos_compra_itens(id) ON DELETE CASCADE,
  preco_unitario  NUMERIC(14,4) NOT NULL,
  UNIQUE (cotacao_id, pedido_item_id)
);

ALTER TABLE pedidos_compra_itens
  ADD CONSTRAINT fk_pci_vencedora
  FOREIGN KEY (cotacao_item_vencedora_id) REFERENCES cotacoes_itens(id);

CREATE TABLE recebimentos_nf (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_id     UUID NOT NULL REFERENCES pedidos_compra(id) ON DELETE CASCADE,
  anexo_nf_url  TEXT NOT NULL,                                     -- caminho no bucket 'cotacoes-nf'
  observacao    TEXT,
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
  criado_por    UUID NOT NULL DEFAULT auth.uid() REFERENCES perfis_usuario(id)
);

CREATE INDEX idx_pedidos_compra_obra_status ON pedidos_compra(obra_id, status);
CREATE INDEX idx_pc_itens_pedido            ON pedidos_compra_itens(pedido_id);
CREATE INDEX idx_cotacoes_pedido            ON cotacoes(pedido_id);
CREATE INDEX idx_cotacoes_itens_cotacao     ON cotacoes_itens(cotacao_id);
CREATE INDEX idx_cotacoes_itens_item        ON cotacoes_itens(pedido_item_id);
CREATE INDEX idx_recebimentos_pedido        ON recebimentos_nf(pedido_id);

-- Só admin pode definir/alterar o vencedor por item (regra CLAUDE.md §5).
CREATE OR REPLACE FUNCTION restringir_vencedor_item() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.cotacao_item_vencedora_id IS DISTINCT FROM OLD.cotacao_item_vencedora_id
     AND meu_papel() <> 'admin' THEN
    RAISE EXCEPTION 'Somente o admin pode definir o item vencedor da cotação.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_restringir_vencedor_item
  BEFORE UPDATE ON pedidos_compra_itens
  FOR EACH ROW EXECUTE FUNCTION restringir_vencedor_item();

-- Recalcula status do pedido a partir do recebimento por item.
-- Só age quando o pedido já está em 'enviado' ou além (não interfere
-- em rascunho/em_cotacao/aprovado/cancelado/conferido_nf/encerrado).
CREATE OR REPLACE FUNCTION recalcular_status_pedido() RETURNS TRIGGER AS $$
DECLARE
  v_status          status_pedido_compra;
  v_total_itens     INTEGER;
  v_itens_completos INTEGER;
  v_itens_iniciados INTEGER;
BEGIN
  SELECT status INTO v_status FROM pedidos_compra WHERE id = NEW.pedido_id;
  IF v_status NOT IN ('enviado', 'recebido_parcial', 'recebido_total') THEN
    RETURN NEW;
  END IF;

  SELECT count(*),
         count(*) FILTER (WHERE quantidade_recebida >= quantidade_pedida),
         count(*) FILTER (WHERE quantidade_recebida > 0)
    INTO v_total_itens, v_itens_completos, v_itens_iniciados
    FROM pedidos_compra_itens
    WHERE pedido_id = NEW.pedido_id AND ativo = true;

  IF v_itens_completos = v_total_itens THEN
    UPDATE pedidos_compra SET status = 'recebido_total' WHERE id = NEW.pedido_id;
  ELSIF v_itens_iniciados > 0 THEN
    UPDATE pedidos_compra SET status = 'recebido_parcial' WHERE id = NEW.pedido_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_recalcular_status_pedido
  AFTER UPDATE OF quantidade_recebida ON pedidos_compra_itens
  FOR EACH ROW EXECUTE FUNCTION recalcular_status_pedido();

-- ── RLS ──
ALTER TABLE pedidos_compra_seq    ENABLE ROW LEVEL SECURITY;
ALTER TABLE fornecedores          ENABLE ROW LEVEL SECURITY;
ALTER TABLE pedidos_compra        ENABLE ROW LEVEL SECURITY;
ALTER TABLE pedidos_compra_itens  ENABLE ROW LEVEL SECURITY;
ALTER TABLE cotacoes              ENABLE ROW LEVEL SECURITY;
ALTER TABLE cotacoes_itens        ENABLE ROW LEVEL SECURITY;
ALTER TABLE recebimentos_nf       ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION pode_editar_compras()
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT meu_papel() = 'admin'
    OR (meu_papel() = 'equipe' AND 'compras' = ANY(meus_modulos()))
$$;

-- Sem policy de INSERT/UPDATE: só proximo_numero_pedido() (SECURITY DEFINER) escreve.
CREATE POLICY pcs_select ON pedidos_compra_seq FOR SELECT
  USING (meu_papel() IN ('admin', 'equipe'));

CREATE POLICY forn_select ON fornecedores FOR SELECT
  USING (ativo = true AND meu_papel() IN ('admin', 'equipe'));
CREATE POLICY forn_insert ON fornecedores FOR INSERT
  WITH CHECK (pode_editar_compras());
CREATE POLICY forn_update ON fornecedores FOR UPDATE
  USING (pode_editar_compras()) WITH CHECK (pode_editar_compras());

CREATE POLICY pc_select ON pedidos_compra FOR SELECT
  USING (ativo = true AND meu_papel() IN ('admin', 'equipe'));
CREATE POLICY pc_insert ON pedidos_compra FOR INSERT
  WITH CHECK (pode_editar_compras());
CREATE POLICY pc_update ON pedidos_compra FOR UPDATE
  USING (pode_editar_compras())
  WITH CHECK (
    pode_editar_compras()
    AND (status NOT IN ('aprovado', 'encerrado', 'cancelado') OR meu_papel() = 'admin')
  );

CREATE POLICY pci_select ON pedidos_compra_itens FOR SELECT
  USING (ativo = true AND meu_papel() IN ('admin', 'equipe'));
CREATE POLICY pci_insert ON pedidos_compra_itens FOR INSERT
  WITH CHECK (pode_editar_compras());
CREATE POLICY pci_update ON pedidos_compra_itens FOR UPDATE
  USING (pode_editar_compras()) WITH CHECK (pode_editar_compras());

-- Cotações e itens de cotação: histórico, só leitura + insert (sem update/delete).
CREATE POLICY cot_select ON cotacoes FOR SELECT
  USING (meu_papel() IN ('admin', 'equipe'));
CREATE POLICY cot_insert ON cotacoes FOR INSERT
  WITH CHECK (pode_editar_compras());

CREATE POLICY coti_select ON cotacoes_itens FOR SELECT
  USING (meu_papel() IN ('admin', 'equipe'));
CREATE POLICY coti_insert ON cotacoes_itens FOR INSERT
  WITH CHECK (pode_editar_compras());

-- Recebimentos/NF: histórico, só leitura + insert.
CREATE POLICY rnf_select ON recebimentos_nf FOR SELECT
  USING (meu_papel() IN ('admin', 'equipe'));
CREATE POLICY rnf_insert ON recebimentos_nf FOR INSERT
  WITH CHECK (pode_editar_compras());

-- ── Storage: anexos de cotação e NF (bucket privado) ──
INSERT INTO storage.buckets (id, name, public) VALUES ('cotacoes-nf', 'cotacoes-nf', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY cotnf_storage_select ON storage.objects FOR SELECT
  USING (bucket_id = 'cotacoes-nf' AND meu_papel() IN ('admin', 'equipe'));
CREATE POLICY cotnf_storage_insert ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'cotacoes-nf' AND pode_editar_compras());
```

- [ ] **Step 2: Aplicar a migration no Supabase**

Usar a ferramenta MCP do Supabase (`apply_migration`) com `name: "fase6_compras"` e o SQL acima, no projeto do app (confirmar o projeto certo com `list_projects` antes, caso haja mais de um).

- [ ] **Step 3: Verificar que as tabelas e a semente da numeração existem**

Rodar via `execute_sql` (mesmo projeto):

```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('fornecedores','pedidos_compra','pedidos_compra_itens','cotacoes','cotacoes_itens','recebimentos_nf','pedidos_compra_seq')
ORDER BY table_name;

SELECT obra_id, ultimo_numero FROM pedidos_compra_seq;
```

Esperado: as 7 tabelas listadas, e `pedidos_compra_seq` com uma linha por obra existente, `ultimo_numero = 64`.

- [ ] **Step 4: Verificar que a numeração começa em 65**

```sql
-- id de uma obra existente
SELECT id FROM obras LIMIT 1;
```

Copiar o `id` retornado e rodar (substituindo `<OBRA_ID>` e usando um `criado_por` de um usuário existente):

```sql
SELECT id FROM perfis_usuario LIMIT 1; -- pega um usuário válido
INSERT INTO pedidos_compra (obra_id, descricao, criado_por)
VALUES ('<OBRA_ID>', 'Teste de numeração', '<USUARIO_ID>')
RETURNING numero;
```

Esperado: `numero = 65`. Depois, apagar a linha de teste:

```sql
DELETE FROM pedidos_compra WHERE descricao = 'Teste de numeração';
```

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260710_fase6_compras.sql
git commit -m "Fase 6: schema de Compras (pedidos, itens, cotacoes, recebimento, numeracao)"
```

---

### Task 2: Tipos TypeScript

**Files:**
- Modify: `src/lib/supabase.ts` (adicionar ao final do arquivo, depois da interface `Servico`)

**Interfaces:**
- Consumes: nenhuma (só espelha o schema da Task 1).
- Produces: tipos `StatusPedidoCompra`, `Fornecedor`, `PedidoCompra`, `PedidoCompraItem`, `Cotacao`, `CotacaoItem`, `RecebimentoNf` — usados por todas as páginas das tasks seguintes.

- [ ] **Step 1: Adicionar os tipos**

```typescript
export type StatusPedidoCompra =
  | 'rascunho' | 'em_cotacao' | 'aprovado' | 'enviado'
  | 'recebido_parcial' | 'recebido_total' | 'conferido_nf' | 'encerrado' | 'cancelado'

export interface Fornecedor {
  id: string
  nome: string
  contato: string | null
  cnpj: string | null
  ativo: boolean
  criado_em: string
  criado_por: string
}

export interface PedidoCompra {
  id: string
  obra_id: string
  numero: number
  status: StatusPedidoCompra
  descricao: string | null
  motivo_cancelamento: string | null
  aprovado_por: string | null
  aprovado_em: string | null
  ativo: boolean
  criado_em: string
  criado_por: string
}

export interface PedidoCompraItem {
  id: string
  pedido_id: string
  servico_id: string | null
  descricao_item: string
  quantidade_pedida: number
  und: string | null
  data_necessaria: string | null
  urgente: boolean
  cotacao_item_vencedora_id: string | null
  quantidade_recebida: number
  valor_recebido: number | null
  ativo: boolean
  criado_em: string
  criado_por: string
}

export interface Cotacao {
  id: string
  pedido_id: string
  fornecedor_id: string
  condicao_pagamento: string | null
  prazo_entrega_dias: number | null
  anexo_url: string
  criado_em: string
  criado_por: string
}

export interface CotacaoItem {
  id: string
  cotacao_id: string
  pedido_item_id: string
  preco_unitario: number
}

export interface RecebimentoNf {
  id: string
  pedido_id: string
  anexo_nf_url: string
  observacao: string | null
  criado_em: string
  criado_por: string
}
```

- [ ] **Step 2: Checar tipos**

Run: `npm run build`
Expected: sem erros (o arquivo só adiciona tipos, nada os usa ainda).

- [ ] **Step 3: Commit**

```bash
git add src/lib/supabase.ts
git commit -m "Fase 6: tipos TypeScript para Compras"
```

---

### Task 3: Fornecedores — cadastro e lista

**Files:**
- Create: `src/pages/Fornecedores.tsx`
- Create: `src/pages/Fornecedores.module.css`
- Modify: `src/App.tsx` (adicionar rota `fornecedores`)

**Interfaces:**
- Consumes: `supabase`, `Fornecedor` de `../lib/supabase`; `useAuth`, `useObra`.
- Produces: rota `/fornecedores`, usada pela Task 5 (cotações) para escolher/criar fornecedor a partir do formulário de pedido.

- [ ] **Step 1: Criar `src/pages/Fornecedores.module.css`**

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

.voltar {
  background: none;
  border: none;
  color: var(--navy);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  padding: 0 0 10px;
}

.bloco {
  background: var(--branco);
  border: 1.5px solid var(--cinza-200);
  border-radius: var(--radius-md);
  padding: 16px;
  margin-bottom: 16px;
  box-shadow: var(--sombra-sm);
}

.campos {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.linha {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.campo {
  display: flex;
  flex: 1;
  min-width: 160px;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  font-weight: 600;
  color: var(--cinza-600);
}

.campo input {
  padding: 10px 12px;
  border: 1.5px solid var(--cinza-200);
  border-radius: var(--radius-sm);
  font-size: 14px;
  font-family: inherit;
}

.campo input:focus { border-color: var(--navy); outline: none; }

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

.card {
  background: var(--branco);
  border: 1.5px solid var(--cinza-200);
  border-radius: var(--radius-md);
  padding: 12px 16px;
  margin-bottom: 8px;
}

.cardNome { font-weight: 700; color: var(--navy); font-size: 14px; }

.cardMeta {
  display: flex;
  gap: 14px;
  flex-wrap: wrap;
  font-size: 12px;
  color: var(--cinza-600);
  margin-top: 4px;
}

.vazio { color: var(--cinza-600); font-size: 14px; padding: 12px 0; }

.msgOk { color: #1e6b2e; font-weight: 600; font-size: 13px; padding: 6px 0; }
.msgErro { color: #a33030; font-weight: 600; font-size: 13px; padding: 6px 0; }
```

- [ ] **Step 2: Criar `src/pages/Fornecedores.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { supabase, type Fornecedor } from '../lib/supabase'
import styles from './Fornecedores.module.css'

export default function Fornecedores() {
  const { perfil, temModulo } = useAuth()
  const navigate = useNavigate()
  const podeEditar = perfil?.papel === 'admin' || temModulo('compras')

  const [fornecedores, setFornecedores] = useState<Fornecedor[]>([])
  const [carregando, setCarregando] = useState(true)
  const [nome, setNome] = useState('')
  const [contato, setContato] = useState('')
  const [cnpj, setCnpj] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)

  useEffect(() => { carregar() }, [])

  function carregar() {
    setCarregando(true)
    supabase.from('fornecedores').select('*').eq('ativo', true).order('nome')
      .then(({ data }) => { setFornecedores(data ?? []); setCarregando(false) })
  }

  async function criar() {
    if (!nome.trim()) {
      setMsg({ tipo: 'erro', texto: 'Informe o nome do fornecedor.' })
      return
    }
    setSalvando(true)
    setMsg(null)
    const { error } = await supabase.from('fornecedores').insert({
      nome: nome.trim(),
      contato: contato.trim() || null,
      cnpj: cnpj.trim() || null,
    })
    setSalvando(false)
    if (error) {
      setMsg({ tipo: 'erro', texto: `Erro ao criar: ${error.message}` })
      return
    }
    setNome(''); setContato(''); setCnpj('')
    setMsg({ tipo: 'ok', texto: 'Fornecedor cadastrado.' })
    carregar()
  }

  if (perfil?.papel === 'cliente') {
    return <div className={styles.page}><p className={styles.vazio}>Módulo de uso interno da equipe.</p></div>
  }

  return (
    <div className={styles.page}>
      <button className={styles.voltar} onClick={() => navigate('/compras')}>← Compras</button>
      <h1>Fornecedores</h1>
      <p className={styles.sub}>Cadastro reaproveitável entre pedidos de compra.</p>

      {podeEditar && (
        <div className={styles.bloco}>
          <div className={styles.campos}>
            <label className={styles.campo}>
              Nome *
              <input value={nome} onChange={e => setNome(e.target.value)} placeholder="Ex.: Casa do Construtor" />
            </label>
            <div className={styles.linha}>
              <label className={styles.campo}>
                Contato
                <input value={contato} onChange={e => setContato(e.target.value)} placeholder="Telefone, e-mail…" />
              </label>
              <label className={styles.campo}>
                CNPJ
                <input value={cnpj} onChange={e => setCnpj(e.target.value)} placeholder="Opcional" />
              </label>
            </div>
          </div>
          {msg && <p className={msg.tipo === 'ok' ? styles.msgOk : styles.msgErro}>{msg.texto}</p>}
          <button className={styles.btnPrincipal} onClick={criar} disabled={salvando} style={{ marginTop: 12 }}>
            {salvando ? 'Salvando…' : '+ Cadastrar fornecedor'}
          </button>
        </div>
      )}

      {carregando && <p className={styles.vazio}>Carregando…</p>}
      {!carregando && fornecedores.length === 0 && <p className={styles.vazio}>Nenhum fornecedor cadastrado.</p>}
      {fornecedores.map(f => (
        <div key={f.id} className={styles.card}>
          <div className={styles.cardNome}>{f.nome}</div>
          <div className={styles.cardMeta}>
            {f.contato && <span>📞 {f.contato}</span>}
            {f.cnpj && <span>🧾 {f.cnpj}</span>}
          </div>
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 3: Adicionar a rota em `src/App.tsx`**

Adicionar o import junto aos demais (perto da linha 16):

```tsx
import Fornecedores from './pages/Fornecedores'
```

Adicionar a rota logo abaixo da rota `pendencias/:id` (perto da linha 48):

```tsx
<Route path="fornecedores" element={<Fornecedores />} />
```

- [ ] **Step 4: Verificar build e testar manualmente**

Run: `npm run build`
Expected: sem erros de tipo.

Rodar `npm run dev`, logar como admin, navegar para `/fornecedores` (digitar a URL — ainda não há link no menu), cadastrar um fornecedor de teste, confirmar que aparece na lista.

- [ ] **Step 5: Commit**

```bash
git add src/pages/Fornecedores.tsx src/pages/Fornecedores.module.css src/App.tsx
git commit -m "Fase 6: cadastro e lista de fornecedores"
```

---

### Task 4: Compras — lista de pedidos

**Files:**
- Create: `src/pages/Compras.tsx`
- Create: `src/pages/Compras.module.css`
- Modify: `src/App.tsx` (trocar a rota `compras` do placeholder `EmConstrucao` para `Compras`)

**Interfaces:**
- Consumes: `PedidoCompra`, `PedidoCompraItem` de `../lib/supabase`; `useAuth`, `useObra`.
- Produces: rota `/compras` navegando para `/compras/:id` (Task 5 cria essa rota/página).

- [ ] **Step 1: Criar `src/pages/Compras.module.css`**

```css
.page {
  max-width: 900px;
  margin: 0 auto;
  padding-bottom: 40px;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 16px;
}

.page h1 { font-size: 20px; margin-bottom: 4px; }

.sub { color: var(--cinza-600); font-size: 13px; max-width: 640px; }

.acoesHeader { display: flex; gap: 8px; }

.btnSecundario {
  background: var(--branco);
  color: var(--navy);
  border: 1.5px solid var(--navy);
  border-radius: var(--radius-sm);
  padding: 12px 16px;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  white-space: nowrap;
}

.btnNova {
  background: var(--terracota);
  color: var(--branco);
  border: none;
  border-radius: var(--radius-sm);
  padding: 12px 18px;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  white-space: nowrap;
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

.vazio { color: var(--cinza-600); font-size: 14px; padding: 12px 0; }

.card {
  width: 100%;
  display: block;
  background: var(--branco);
  border: 1.5px solid var(--cinza-200);
  border-radius: var(--radius-md);
  padding: 13px 16px;
  margin-bottom: 8px;
  cursor: pointer;
  box-shadow: var(--sombra-sm);
  text-align: left;
}

.card:hover { border-color: var(--navy); }

.cardUrgente { border-color: #c49a30; background: #fffaf0; }

.cardTopo {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  margin-bottom: 5px;
}

.cardNumero {
  font-family: var(--font-titulo);
  font-weight: 700;
  color: var(--navy);
  font-size: 13px;
}

.cardDesc { font-size: 14px; color: var(--cinza-800); margin-bottom: 7px; }

.cardRodape {
  display: flex;
  gap: 14px;
  flex-wrap: wrap;
  font-size: 12px;
  color: var(--cinza-600);
}

.urgenteTag { color: #a35c00; font-weight: 700; }

.chip {
  font-size: 11px;
  font-weight: 700;
  border-radius: 999px;
  padding: 3px 10px;
  white-space: nowrap;
}

.chip_rascunho { background: #eceff1; color: #546e7a; }
.chip_em_cotacao { background: #fdf3d7; color: #8a6d1a; }
.chip_aprovado { background: #e3edfa; color: #1a5fa3; }
.chip_enviado { background: #e3edfa; color: #1a5fa3; }
.chip_recebido_parcial { background: #fdf3d7; color: #8a6d1a; }
.chip_recebido_total { background: #e3f4e3; color: #1e6b2e; }
.chip_conferido_nf { background: #e3f4e3; color: #1e6b2e; }
.chip_encerrado { background: #e0e0e0; color: #424242; }
.chip_cancelado { background: #fdeaea; color: #a33030; }
```

- [ ] **Step 2: Criar `src/pages/Compras.tsx`**

```tsx
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useObra } from '../contexts/ObraContext'
import { supabase, type PedidoCompra, type PedidoCompraItem, type StatusPedidoCompra } from '../lib/supabase'
import styles from './Compras.module.css'

export const STATUS_LABEL: Record<StatusPedidoCompra, string> = {
  rascunho: 'Rascunho',
  em_cotacao: 'Em cotação',
  aprovado: 'Aprovado',
  enviado: 'Enviado',
  recebido_parcial: 'Recebido parcial',
  recebido_total: 'Recebido total',
  conferido_nf: 'Conferido com NF',
  encerrado: 'Encerrado',
  cancelado: 'Cancelado',
}

export default function Compras() {
  const { perfil, temModulo } = useAuth()
  const { obraAtiva } = useObra()
  const navigate = useNavigate()
  const podeEditar = perfil?.papel === 'admin' || temModulo('compras')

  const [pedidos, setPedidos] = useState<PedidoCompra[]>([])
  const [itensPorPedido, setItensPorPedido] = useState<Map<string, PedidoCompraItem[]>>(new Map())
  const [carregando, setCarregando] = useState(true)
  const [filtroStatus, setFiltroStatus] = useState<StatusPedidoCompra | ''>('')
  const [somenteUrgente, setSomenteUrgente] = useState(false)

  useEffect(() => {
    if (!obraAtiva) return
    setCarregando(true)
    supabase.from('pedidos_compra').select('*').eq('obra_id', obraAtiva.id).eq('ativo', true)
      .order('numero', { ascending: false })
      .then(async ({ data }) => {
        const lista = data ?? []
        setPedidos(lista)
        const { data: itens } = await supabase.from('pedidos_compra_itens').select('*')
          .in('pedido_id', lista.map(p => p.id)).eq('ativo', true)
        const mapa = new Map<string, PedidoCompraItem[]>()
        for (const it of itens ?? []) {
          const arr = mapa.get(it.pedido_id) ?? []
          arr.push(it)
          mapa.set(it.pedido_id, arr)
        }
        setItensPorPedido(mapa)
        setCarregando(false)
      })
  }, [obraAtiva])

  function temItemUrgente(pedidoId: string): boolean {
    return (itensPorPedido.get(pedidoId) ?? []).some(i => i.urgente)
  }

  const filtrados = useMemo(() => {
    return pedidos.filter(p =>
      (!filtroStatus || p.status === filtroStatus) &&
      (!somenteUrgente || temItemUrgente(p.id))
    )
  }, [pedidos, itensPorPedido, filtroStatus, somenteUrgente])

  if (perfil?.papel === 'cliente') {
    return <div className={styles.page}><p className={styles.vazio}>Módulo de uso interno da equipe.</p></div>
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1>Compras</h1>
          <p className={styles.sub}>Pedidos vinculados ao orçamento — cotação, aprovação e recebimento.</p>
        </div>
        <div className={styles.acoesHeader}>
          <button className={styles.btnSecundario} onClick={() => navigate('/fornecedores')}>Fornecedores</button>
          {podeEditar && (
            <button className={styles.btnNova} onClick={() => navigate('/compras/novo')}>+ Novo pedido</button>
          )}
        </div>
      </div>

      <div className={styles.filtros}>
        <select className={styles.selectFiltro} value={filtroStatus}
          onChange={e => setFiltroStatus(e.target.value as StatusPedidoCompra | '')}>
          <option value="">Todos os status</option>
          {(Object.keys(STATUS_LABEL) as StatusPedidoCompra[]).map(s => (
            <option key={s} value={s}>{STATUS_LABEL[s]}</option>
          ))}
        </select>
        <select className={styles.selectFiltro} value={somenteUrgente ? '1' : ''}
          onChange={e => setSomenteUrgente(e.target.value === '1')}>
          <option value="">Todos os pedidos</option>
          <option value="1">Só com item urgente</option>
        </select>
      </div>

      {carregando && <p className={styles.vazio}>Carregando…</p>}
      {!carregando && filtrados.length === 0 && (
        <p className={styles.vazio}>{pedidos.length === 0 ? 'Nenhum pedido registrado.' : 'Nenhum pedido com esses filtros.'}</p>
      )}

      {filtrados.map(p => (
        <button key={p.id} className={`${styles.card} ${temItemUrgente(p.id) ? styles.cardUrgente : ''}`}
          onClick={() => navigate(`/compras/${p.id}`)}>
          <div className={styles.cardTopo}>
            <span className={styles.cardNumero}>Pedido {String(p.numero).padStart(3, '0')}</span>
            <span className={`${styles.chip} ${styles[`chip_${p.status}`]}`}>{STATUS_LABEL[p.status]}</span>
          </div>
          <div className={styles.cardDesc}>{p.descricao || '(sem descrição)'}</div>
          <div className={styles.cardRodape}>
            <span>{(itensPorPedido.get(p.id) ?? []).length} item(ns)</span>
            {temItemUrgente(p.id) && <span className={styles.urgenteTag}>⚡ urgente</span>}
          </div>
        </button>
      ))}
    </div>
  )
}
```

- [ ] **Step 3: Trocar a rota em `src/App.tsx`**

Substituir o import de `EmConstrucao` para Compras (adicionar junto aos outros imports, perto da linha 16):

```tsx
import Compras from './pages/Compras'
```

Substituir a linha (atual linha 45):

```tsx
<Route path="compras" element={<EmConstrucao modulo="Compras" fase={6} />} />
```

por:

```tsx
<Route path="compras" element={<Compras />} />
```

(Não remover o import de `EmConstrucao` nem a rota `almoxarifado` — ainda usados pelo placeholder do Almoxarifado, fora de escopo desta spec.)

- [ ] **Step 4: Verificar build e testar manualmente**

Run: `npm run build`
Expected: sem erros de tipo (a rota `/compras/novo` e `/compras/:id` ainda não existem — normal, serão criadas na Task 5; por ora só a lista precisa renderizar).

Rodar `npm run dev`, logar como admin, clicar em "Compras" no menu lateral, confirmar que a lista carrega vazia (nenhum pedido ainda) e que os filtros aparecem.

- [ ] **Step 5: Commit**

```bash
git add src/pages/Compras.tsx src/pages/Compras.module.css src/App.tsx
git commit -m "Fase 6: lista de pedidos de compra"
```

---

### Task 5: CompraForm — criação do pedido com itens e autocomplete do orçamento

**Files:**
- Create: `src/pages/CompraForm.tsx`
- Create: `src/pages/CompraForm.module.css`
- Modify: `src/App.tsx` (rotas `compras/novo` e `compras/:id`)

**Interfaces:**
- Consumes: `Servico`, `PedidoCompra`, `PedidoCompraItem` de `../lib/supabase`; `STATUS_LABEL` de `./Compras`.
- Produces: componente `CompraForm` com estado de itens em edição (`{ servico_id, descricao_item, quantidade_pedida, und, data_necessaria, urgente }[]`), reaproveitado (estendido) pelas Tasks 6–8 no mesmo arquivo.

- [ ] **Step 1: Criar `src/pages/CompraForm.module.css`**

```css
.page {
  max-width: 900px;
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

.campo input, .campo select, .campo textarea {
  padding: 10px 12px;
  border: 1.5px solid var(--cinza-200);
  border-radius: var(--radius-sm);
  font-size: 14px;
  font-family: inherit;
  background: var(--branco);
}

.campo input:focus, .campo select:focus, .campo textarea:focus { border-color: var(--navy); outline: none; }

.itemLinha {
  border: 1.5px solid var(--cinza-200);
  border-radius: var(--radius-sm);
  padding: 12px;
  margin-bottom: 10px;
  position: relative;
}

.itemGrid {
  display: grid;
  grid-template-columns: 2fr 1fr 1fr 1fr;
  gap: 10px;
}

.itemGrid .campo { margin-bottom: 0; }

.autocompleteWrap { position: relative; }

.sugestoes {
  position: absolute;
  z-index: 5;
  top: 100%;
  left: 0;
  right: 0;
  background: var(--branco);
  border: 1.5px solid var(--navy);
  border-radius: var(--radius-sm);
  max-height: 220px;
  overflow-y: auto;
  box-shadow: var(--sombra-sm);
}

.sugestao {
  width: 100%;
  text-align: left;
  padding: 8px 10px;
  background: none;
  border: none;
  cursor: pointer;
  font-size: 13px;
}

.sugestao:hover { background: var(--cinza-100); }

.sugestaoCodigo { color: var(--cinza-600); font-size: 11px; margin-right: 6px; }

.vinculoOk { color: #1e6b2e; font-size: 11px; margin-top: 4px; }
.vinculoAusente { color: #a35c00; font-size: 11px; margin-top: 4px; }

.checkUrgente { display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 600; color: var(--cinza-800); margin-top: 4px; }

.btnRemoverItem {
  position: absolute;
  top: 8px;
  right: 8px;
  background: none;
  border: none;
  color: var(--cinza-600);
  cursor: pointer;
  font-size: 14px;
}

.btnAddItem {
  background: var(--branco);
  border: 1.5px dashed var(--terracota);
  color: var(--terracota);
  border-radius: var(--radius-sm);
  padding: 10px;
  width: 100%;
  font-weight: 700;
  cursor: pointer;
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
  width: 100%;
}

.btnPrincipal:disabled { opacity: 0.6; cursor: default; }

.msgOk { color: #1e6b2e; font-weight: 600; font-size: 13px; padding: 6px 0; }
.msgErro { color: #a33030; font-weight: 600; font-size: 13px; padding: 6px 0; }
.vazio { color: var(--cinza-600); font-size: 14px; padding: 12px 0; }
```

- [ ] **Step 2: Criar `src/pages/CompraForm.tsx` (criação do pedido)**

```tsx
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useObra } from '../contexts/ObraContext'
import { useAuth } from '../contexts/AuthContext'
import { supabase, type Servico } from '../lib/supabase'
import styles from './CompraForm.module.css'

interface ItemNovo {
  chave: string
  servico_id: string | null
  servicoLabel: string
  descricao_item: string
  quantidade_pedida: string
  und: string
  data_necessaria: string
  urgente: boolean
  buscaAberta: boolean
}

function itemVazio(): ItemNovo {
  return {
    chave: crypto.randomUUID(),
    servico_id: null,
    servicoLabel: '',
    descricao_item: '',
    quantidade_pedida: '',
    und: '',
    data_necessaria: '',
    urgente: false,
    buscaAberta: false,
  }
}

export default function CompraForm() {
  const { id } = useParams()
  const novo = id === 'novo'
  const navigate = useNavigate()
  const { obraAtiva } = useObra()
  const { perfil } = useAuth()

  const [servicos, setServicos] = useState<Servico[]>([])
  const [descricao, setDescricao] = useState('')
  const [itens, setItens] = useState<ItemNovo[]>([itemVazio()])
  const [salvando, setSalvando] = useState(false)
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)

  useEffect(() => {
    supabase.from('servicos').select('*').eq('ativo', true).order('codigo')
      .then(({ data }) => setServicos(data ?? []))
  }, [])

  function sugestoesPara(texto: string): Servico[] {
    const t = texto.trim().toLowerCase()
    if (t.length < 2) return []
    return servicos.filter(s => s.nome.toLowerCase().includes(t) || (s.codigo ?? '').toLowerCase().includes(t)).slice(0, 8)
  }

  function atualizarItem(chave: string, patch: Partial<ItemNovo>) {
    setItens(prev => prev.map(it => it.chave === chave ? { ...it, ...patch } : it))
  }

  function escolherServico(chave: string, s: Servico) {
    atualizarItem(chave, {
      servico_id: s.id,
      servicoLabel: `${s.codigo ?? ''} ${s.nome}`.trim(),
      descricao_item: s.nome,
      und: s.und ?? '',
      buscaAberta: false,
    })
  }

  function removerItem(chave: string) {
    setItens(prev => prev.length > 1 ? prev.filter(it => it.chave !== chave) : prev)
  }

  async function criar() {
    if (!obraAtiva || !perfil) return
    const itensValidos = itens.filter(it => it.descricao_item.trim() && Number(it.quantidade_pedida) > 0)
    if (itensValidos.length === 0) {
      setMsg({ tipo: 'erro', texto: 'Adicione ao menos um item com descrição e quantidade.' })
      return
    }
    setSalvando(true)
    setMsg(null)
    const { data: pedido, error } = await supabase.from('pedidos_compra').insert({
      obra_id: obraAtiva.id,
      descricao: descricao.trim() || null,
    }).select().single()
    if (error || !pedido) {
      setSalvando(false)
      setMsg({ tipo: 'erro', texto: `Erro ao criar pedido: ${error?.message}` })
      return
    }
    const { error: eItens } = await supabase.from('pedidos_compra_itens').insert(
      itensValidos.map(it => ({
        pedido_id: pedido.id,
        servico_id: it.servico_id,
        descricao_item: it.descricao_item.trim(),
        quantidade_pedida: Number(it.quantidade_pedida),
        und: it.und.trim() || null,
        data_necessaria: it.data_necessaria || null,
        urgente: it.urgente,
      }))
    )
    setSalvando(false)
    if (eItens) {
      setMsg({ tipo: 'erro', texto: `Pedido criado, mas falhou ao salvar itens: ${eItens.message}` })
      return
    }
    navigate(`/compras/${pedido.id}`, { replace: true })
  }

  if (!novo) {
    // Detalhe/edição de pedido existente — implementado nas Tasks 6–8.
    return <div className={styles.page}><p className={styles.vazio}>Carregando pedido…</p></div>
  }

  return (
    <div className={styles.page}>
      <button className={styles.voltar} onClick={() => navigate('/compras')}>← Compras</button>
      <h1>Novo pedido de compra</h1>

      <div className={styles.bloco}>
        <label className={styles.campo}>
          Descrição do pedido
          <input value={descricao} onChange={e => setDescricao(e.target.value)}
            placeholder="Ex.: Lista de material — fundação Sobrado 04" />
        </label>
      </div>

      <div className={styles.bloco}>
        <h2>Itens</h2>
        {itens.map(it => {
          const sugestoes = it.buscaAberta ? sugestoesPara(it.descricao_item) : []
          return (
            <div key={it.chave} className={styles.itemLinha}>
              {itens.length > 1 && (
                <button className={styles.btnRemoverItem} onClick={() => removerItem(it.chave)}>✕</button>
              )}
              <div className={styles.itemGrid}>
                <div className={styles.campo}>
                  Insumo *
                  <div className={styles.autocompleteWrap}>
                    <input
                      value={it.descricao_item}
                      onChange={e => atualizarItem(it.chave, {
                        descricao_item: e.target.value, servico_id: null, buscaAberta: true,
                      })}
                      onFocus={() => atualizarItem(it.chave, { buscaAberta: true })}
                      onBlur={() => setTimeout(() => atualizarItem(it.chave, { buscaAberta: false }), 150)}
                      placeholder="Ex.: bloco cerâmico 14x19x29"
                    />
                    {sugestoes.length > 0 && (
                      <div className={styles.sugestoes}>
                        {sugestoes.map(s => (
                          <button key={s.id} className={styles.sugestao}
                            onMouseDown={() => escolherServico(it.chave, s)}>
                            <span className={styles.sugestaoCodigo}>{s.codigo}</span>{s.nome}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  {it.servico_id
                    ? <span className={styles.vinculoOk}>✓ vinculado ao orçamento</span>
                    : <span className={styles.vinculoAusente}>⚠ sem vínculo — vai para "a classificar"</span>}
                </div>
                <label className={styles.campo}>
                  Quantidade *
                  <input type="number" min="0" step="0.01" value={it.quantidade_pedida}
                    onChange={e => atualizarItem(it.chave, { quantidade_pedida: e.target.value })} />
                </label>
                <label className={styles.campo}>
                  Und.
                  <input value={it.und} onChange={e => atualizarItem(it.chave, { und: e.target.value })} placeholder="un, m³, sc…" />
                </label>
                <label className={styles.campo}>
                  Necessário até
                  <input type="date" value={it.data_necessaria}
                    onChange={e => atualizarItem(it.chave, { data_necessaria: e.target.value })} />
                </label>
              </div>
              <label className={styles.checkUrgente}>
                <input type="checkbox" checked={it.urgente}
                  onChange={e => atualizarItem(it.chave, { urgente: e.target.checked })} />
                ⚡ Urgente — precisamos o mais rápido possível
              </label>
            </div>
          )
        })}
        <button className={styles.btnAddItem} onClick={() => setItens(prev => [...prev, itemVazio()])}>
          + Adicionar item
        </button>
      </div>

      {msg && <p className={msg.tipo === 'ok' ? styles.msgOk : styles.msgErro}>{msg.texto}</p>}
      <button className={styles.btnPrincipal} onClick={criar} disabled={salvando}>
        {salvando ? 'Criando…' : 'Criar pedido'}
      </button>
    </div>
  )
}
```

> Nota para a Task 6: o branch `if (!novo)` acima é um placeholder deliberado — a Task 6 substitui esse bloco pelo carregamento e pela visão de detalhe/cotações, sem alterar a parte de criação já validada aqui.

- [ ] **Step 3: Adicionar rotas em `src/App.tsx`**

Adicionar o import (perto dos outros, linha 16):

```tsx
import CompraForm from './pages/CompraForm'
```

Adicionar as rotas logo abaixo da rota `compras` (perto da linha 45):

```tsx
<Route path="compras/novo" element={<CompraForm />} />
<Route path="compras/:id" element={<CompraForm />} />
```

- [ ] **Step 4: Verificar build e testar manualmente**

Run: `npm run build`
Expected: sem erros de tipo.

Rodar `npm run dev`, logar como admin ou como usuário com módulo `compras`, ir em Compras → "+ Novo pedido", digitar "bloco" no campo de insumo de um item e confirmar que aparecem sugestões do orçamento (se a obra piloto tiver serviço com "bloco" no nome); escolher uma sugestão e confirmar que quantidade/und ficam associadas; adicionar um segundo item sem escolher sugestão nenhuma e confirmar que aparece "sem vínculo — vai para 'a classificar'"; marcar um item como urgente; criar o pedido e confirmar que ele aparece na lista de Compras com o número `065` (primeiro pedido da obra piloto).

- [ ] **Step 5: Commit**

```bash
git add src/pages/CompraForm.tsx src/pages/CompraForm.module.css src/App.tsx
git commit -m "Fase 6: criacao de pedido de compra com autocomplete do orcamento"
```

---

### Task 6: CompraForm — detalhe, cotações por fornecedor e marcação de vencedor

**Files:**
- Modify: `src/pages/CompraForm.tsx` (substituir o bloco `if (!novo) { ... }` por carregamento real + seções de detalhe/cotação)
- Modify: `src/pages/CompraForm.module.css` (adicionar classes da tabela comparativa)

**Interfaces:**
- Consumes: `PedidoCompra`, `PedidoCompraItem`, `Cotacao`, `CotacaoItem`, `Fornecedor` de `../lib/supabase`; `STATUS_LABEL` de `./Compras`.
- Produces: dentro do mesmo componente, estado `pedido`, `itens`, `cotacoes`, `cotacoesItens`, `fornecedores` e função `carregarPedido(pedidoId)` — consumidos pelas Tasks 7 e 8 no mesmo arquivo.

- [ ] **Step 1: Adicionar classes de CSS**

Anexar ao final de `src/pages/CompraForm.module.css`:

```css
.tabelaComparativa {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
  margin-top: 8px;
}

.tabelaComparativa th, .tabelaComparativa td {
  border: 1px solid var(--cinza-200);
  padding: 8px 10px;
  text-align: left;
}

.tabelaComparativa th { background: var(--cinza-100); font-size: 11px; text-transform: uppercase; color: var(--cinza-600); }

.precoVencedor { font-weight: 700; color: #1e6b2e; }

.btnVencedor {
  background: none;
  border: 1.5px solid var(--navy);
  color: var(--navy);
  border-radius: var(--radius-sm);
  padding: 4px 8px;
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
}

.btnVencedor.ativo { background: #1e6b2e; border-color: #1e6b2e; color: var(--branco); }

.fornecedorForm { border-top: 1.5px solid var(--cinza-200); margin-top: 12px; padding-top: 12px; }

.linha2 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; }
.linha2 .campo { margin-bottom: 0; }

.metaLista { display: flex; gap: 14px; flex-wrap: wrap; font-size: 12px; color: var(--cinza-600); margin-bottom: 10px; }
```

- [ ] **Step 2: Substituir o bloco de carregamento/detalhe**

Em `src/pages/CompraForm.tsx`, adicionar aos imports:

```tsx
import { supabase, type Servico, type PedidoCompra, type PedidoCompraItem, type Cotacao, type CotacaoItem, type Fornecedor } from '../lib/supabase'
import { STATUS_LABEL } from './Compras'
```

(substitui o import anterior que só trazia `Servico`).

Adicionar estado e efeito de carregamento logo depois da declaração de `const [msg, ...]` já existente:

```tsx
  const [pedido, setPedido] = useState<PedidoCompra | null>(null)
  const [itensPedido, setItensPedido] = useState<PedidoCompraItem[]>([])
  const [cotacoes, setCotacoes] = useState<Cotacao[]>([])
  const [cotacoesItens, setCotacoesItens] = useState<CotacaoItem[]>([])
  const [fornecedores, setFornecedores] = useState<Fornecedor[]>([])
  const [carregandoPedido, setCarregandoPedido] = useState(!novo)

  useEffect(() => {
    if (!novo && id) carregarPedido(id)
  }, [id, novo])

  async function carregarPedido(pedidoId: string) {
    setCarregandoPedido(true)
    const [{ data: p }, { data: its }, { data: cots }, { data: forns }] = await Promise.all([
      supabase.from('pedidos_compra').select('*').eq('id', pedidoId).single(),
      supabase.from('pedidos_compra_itens').select('*').eq('pedido_id', pedidoId).eq('ativo', true).order('criado_em'),
      supabase.from('cotacoes').select('*').eq('pedido_id', pedidoId).order('criado_em'),
      supabase.from('fornecedores').select('*').eq('ativo', true).order('nome'),
    ])
    setPedido(p ?? null)
    setItensPedido(its ?? [])
    setCotacoes(cots ?? [])
    setFornecedores(forns ?? [])
    if (cots && cots.length > 0) {
      const { data: coti } = await supabase.from('cotacoes_itens').select('*').in('cotacao_id', cots.map(c => c.id))
      setCotacoesItens(coti ?? [])
    } else {
      setCotacoesItens([])
    }
    setCarregandoPedido(false)
  }
```

Substituir o bloco:

```tsx
  if (!novo) {
    // Detalhe/edição de pedido existente — implementado nas Tasks 6–8.
    return <div className={styles.page}><p className={styles.vazio}>Carregando pedido…</p></div>
  }
```

por:

```tsx
  if (!novo) {
    if (carregandoPedido) return <div className={styles.page}><p className={styles.vazio}>Carregando…</p></div>
    if (!pedido) return <div className={styles.page}><p className={styles.vazio}>Pedido não encontrado.</p></div>
    return (
      <DetalhePedido
        pedido={pedido} itens={itensPedido} cotacoes={cotacoes} cotacoesItens={cotacoesItens}
        fornecedores={fornecedores} onRecarregar={() => carregarPedido(pedido.id)}
      />
    )
  }
```

- [ ] **Step 3: Adicionar o componente `DetalhePedido` (cotações + vencedor) no final do arquivo**

```tsx
interface DetalhePedidoProps {
  pedido: PedidoCompra
  itens: PedidoCompraItem[]
  cotacoes: Cotacao[]
  cotacoesItens: CotacaoItem[]
  fornecedores: Fornecedor[]
  onRecarregar: () => void
}

function DetalhePedido({ pedido, itens, cotacoes, cotacoesItens, fornecedores, onRecarregar }: DetalhePedidoProps) {
  const navigate = useNavigate()
  const { perfil, temModulo } = useAuth()
  const podeEditar = perfil?.papel === 'admin' || temModulo('compras')
  const ehAdmin = perfil?.papel === 'admin'

  const [fornecedorSel, setFornecedorSel] = useState('')
  const [condicaoPagamento, setCondicaoPagamento] = useState('')
  const [prazoEntrega, setPrazoEntrega] = useState('')
  const [precos, setPrecos] = useState<Record<string, string>>({})
  const [arquivo, setArquivo] = useState<File | null>(null)
  const [salvandoCotacao, setSalvandoCotacao] = useState(false)
  const [msgCotacao, setMsgCotacao] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)

  function precoDe(cotacaoId: string, itemId: string): number | null {
    const ci = cotacoesItens.find(c => c.cotacao_id === cotacaoId && c.pedido_item_id === itemId)
    return ci ? ci.preco_unitario : null
  }

  function idDoItemCotacao(cotacaoId: string, itemId: string): string | null {
    return cotacoesItens.find(c => c.cotacao_id === cotacaoId && c.pedido_item_id === itemId)?.id ?? null
  }

  async function registrarCotacao() {
    if (!fornecedorSel || !arquivo) {
      setMsgCotacao({ tipo: 'erro', texto: 'Escolha o fornecedor e anexe o orçamento dele.' })
      return
    }
    const itensComPreco = itens.filter(it => Number(precos[it.id]) > 0)
    if (itensComPreco.length === 0) {
      setMsgCotacao({ tipo: 'erro', texto: 'Informe o preço de ao menos um item.' })
      return
    }
    setSalvandoCotacao(true)
    setMsgCotacao(null)
    const path = `${pedido.id}/${crypto.randomUUID()}-${arquivo.name}`
    const { error: eUp } = await supabase.storage.from('cotacoes-nf').upload(path, arquivo)
    if (eUp) {
      setSalvandoCotacao(false)
      setMsgCotacao({ tipo: 'erro', texto: `Falha no envio do anexo: ${eUp.message}` })
      return
    }
    const { data: cot, error } = await supabase.from('cotacoes').insert({
      pedido_id: pedido.id,
      fornecedor_id: fornecedorSel,
      condicao_pagamento: condicaoPagamento.trim() || null,
      prazo_entrega_dias: prazoEntrega ? Number(prazoEntrega) : null,
      anexo_url: path,
    }).select().single()
    if (error || !cot) {
      setSalvandoCotacao(false)
      setMsgCotacao({ tipo: 'erro', texto: `Erro ao registrar cotação: ${error?.message}` })
      return
    }
    await supabase.from('cotacoes_itens').insert(
      itensComPreco.map(it => ({ cotacao_id: cot.id, pedido_item_id: it.id, preco_unitario: Number(precos[it.id]) }))
    )
    if (pedido.status === 'rascunho') {
      await supabase.from('pedidos_compra').update({ status: 'em_cotacao' }).eq('id', pedido.id)
    }
    setSalvandoCotacao(false)
    setFornecedorSel(''); setCondicaoPagamento(''); setPrazoEntrega(''); setPrecos({}); setArquivo(null)
    setMsgCotacao({ tipo: 'ok', texto: 'Cotação registrada.' })
    onRecarregar()
  }

  async function marcarVencedor(itemId: string, cotacaoItemId: string | null) {
    const { error } = await supabase.from('pedidos_compra_itens')
      .update({ cotacao_item_vencedora_id: cotacaoItemId }).eq('id', itemId)
    if (!error) onRecarregar()
  }

  async function aprovarPedido() {
    const todosComVencedor = itens.every(it => it.cotacao_item_vencedora_id !== null)
    if (!todosComVencedor) {
      alert('Defina o vencedor de todos os itens antes de aprovar.')
      return
    }
    await supabase.from('pedidos_compra').update({
      status: 'aprovado', aprovado_por: perfil?.id, aprovado_em: new Date().toISOString(),
    }).eq('id', pedido.id)
    onRecarregar()
  }

  const nomeFornecedor = (id: string) => fornecedores.find(f => f.id === id)?.nome ?? '?'

  return (
    <div className={styles.page}>
      <button className={styles.voltar} onClick={() => navigate('/compras')}>← Compras</button>
      <div className={styles.header}>
        <h1>Pedido {String(pedido.numero).padStart(3, '0')}</h1>
        <span className={`${styles.chip}`}>{STATUS_LABEL[pedido.status]}</span>
      </div>
      {pedido.descricao && <p className={styles.metaLista}>{pedido.descricao}</p>}

      <div className={styles.bloco}>
        <h2>Itens do pedido</h2>
        <table className={styles.tabelaComparativa}>
          <thead>
            <tr>
              <th>Item</th><th>Qtd.</th><th>Necessário até</th>
              {cotacoes.map(c => <th key={c.id}>{nomeFornecedor(c.fornecedor_id)}</th>)}
            </tr>
          </thead>
          <tbody>
            {itens.map(it => (
              <tr key={it.id}>
                <td>{it.urgente && '⚡ '}{it.descricao_item}</td>
                <td>{it.quantidade_pedida} {it.und}</td>
                <td>{it.data_necessaria ?? '—'}</td>
                {cotacoes.map(c => {
                  const preco = precoDe(c.id, it.id)
                  const cotItemId = idDoItemCotacao(c.id, it.id)
                  const vencedor = it.cotacao_item_vencedora_id !== null && cotItemId === it.cotacao_item_vencedora_id
                  return (
                    <td key={c.id}>
                      {preco !== null ? (
                        <>
                          <span className={vencedor ? styles.precoVencedor : ''}>R$ {preco.toFixed(2)}</span>
                          {ehAdmin && pedido.status !== 'aprovado' && (
                            <div>
                              <button
                                className={`${styles.btnVencedor} ${vencedor ? styles.ativo : ''}`}
                                onClick={() => marcarVencedor(it.id, vencedor ? null : cotItemId)}
                              >
                                {vencedor ? '✓ vencedor' : 'marcar vencedor'}
                              </button>
                            </div>
                          )}
                        </>
                      ) : '—'}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {podeEditar && pedido.status !== 'aprovado' && !['encerrado', 'cancelado'].includes(pedido.status) && (
        <div className={styles.bloco}>
          <h2>Registrar cotação de fornecedor</h2>
          <div className={styles.linha2}>
            <label className={styles.campo}>
              Fornecedor *
              <select value={fornecedorSel} onChange={e => setFornecedorSel(e.target.value)}>
                <option value="">Selecione…</option>
                {fornecedores.map(f => <option key={f.id} value={f.id}>{f.nome}</option>)}
              </select>
            </label>
            <label className={styles.campo}>
              Condição de pagamento
              <input value={condicaoPagamento} onChange={e => setCondicaoPagamento(e.target.value)} placeholder="Ex.: 30 dias" />
            </label>
            <label className={styles.campo}>
              Prazo de entrega (dias)
              <input type="number" min="0" value={prazoEntrega} onChange={e => setPrazoEntrega(e.target.value)} />
            </label>
          </div>
          <div className={styles.fornecedorForm}>
            {itens.map(it => (
              <label key={it.id} className={styles.campo}>
                Preço unitário — {it.descricao_item} ({it.und})
                <input type="number" min="0" step="0.01" value={precos[it.id] ?? ''}
                  onChange={e => setPrecos(prev => ({ ...prev, [it.id]: e.target.value }))} />
              </label>
            ))}
            <label className={styles.campo}>
              Anexo do orçamento do fornecedor (PDF/foto) *
              <input type="file" accept="application/pdf,image/*" onChange={e => setArquivo(e.target.files?.[0] ?? null)} />
            </label>
          </div>
          {msgCotacao && <p className={msgCotacao.tipo === 'ok' ? styles.msgOk : styles.msgErro}>{msgCotacao.texto}</p>}
          <button className={styles.btnPrincipal} onClick={registrarCotacao} disabled={salvandoCotacao}>
            {salvandoCotacao ? 'Salvando…' : 'Registrar cotação'}
          </button>
        </div>
      )}

      {ehAdmin && pedido.status === 'em_cotacao' && (
        <div className={styles.bloco}>
          <button className={styles.btnPrincipal} onClick={aprovarPedido}>Aprovar pedido</button>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Verificar build e testar manualmente**

Run: `npm run build`
Expected: sem erros de tipo.

Rodar `npm run dev`, abrir o pedido `065` criado na Task 5, cadastrar duas cotações de fornecedores diferentes (usando os fornecedores criados na Task 3) com preços diferentes por item e um anexo de teste (qualquer PDF/imagem pequena), confirmar que a tabela comparativa mostra as duas colunas; como admin, marcar vencedores diferentes em itens diferentes (comprovando a escolha por item); confirmar que "Aprovar pedido" só aparece depois de status `em_cotacao` e some a mensagem de erro se tentar aprovar com item sem vencedor.

- [ ] **Step 5: Commit**

```bash
git add src/pages/CompraForm.tsx src/pages/CompraForm.module.css
git commit -m "Fase 6: cotacoes por fornecedor, comparacao e vencedor por item"
```

---

### Task 7: CompraForm — envio, recebimento e conferência de NF

**Files:**
- Modify: `src/pages/CompraForm.tsx` (adicionar seções de envio/recebimento/NF dentro de `DetalhePedido`)

**Interfaces:**
- Consumes: `RecebimentoNf` de `../lib/supabase` (adicionar ao import existente).
- Produces: ações `marcarEnviado`, `salvarRecebimento`, `registrarNf` dentro de `DetalhePedido` — consumidas pela Task 8 (encerramento/cancelamento reaproveita o mesmo componente).

- [ ] **Step 1: Adicionar `RecebimentoNf` ao import de tipos**

No topo de `src/pages/CompraForm.tsx`, ajustar o import já existente:

```tsx
import { supabase, type Servico, type PedidoCompra, type PedidoCompraItem, type Cotacao, type CotacaoItem, type Fornecedor, type RecebimentoNf } from '../lib/supabase'
```

- [ ] **Step 2: Carregar recebimentos junto do pedido**

Em `carregarPedido`, adicionar ao `Promise.all` a busca de recebimentos e guardar em estado novo:

```tsx
  const [recebimentos, setRecebimentos] = useState<RecebimentoNf[]>([])
```

(declarar logo abaixo de `const [carregandoPedido, ...]`)

Ajustar `carregarPedido` para incluir a 5ª consulta:

```tsx
  async function carregarPedido(pedidoId: string) {
    setCarregandoPedido(true)
    const [{ data: p }, { data: its }, { data: cots }, { data: forns }, { data: recs }] = await Promise.all([
      supabase.from('pedidos_compra').select('*').eq('id', pedidoId).single(),
      supabase.from('pedidos_compra_itens').select('*').eq('pedido_id', pedidoId).eq('ativo', true).order('criado_em'),
      supabase.from('cotacoes').select('*').eq('pedido_id', pedidoId).order('criado_em'),
      supabase.from('fornecedores').select('*').eq('ativo', true).order('nome'),
      supabase.from('recebimentos_nf').select('*').eq('pedido_id', pedidoId).order('criado_em'),
    ])
    setPedido(p ?? null)
    setItensPedido(its ?? [])
    setCotacoes(cots ?? [])
    setFornecedores(forns ?? [])
    setRecebimentos(recs ?? [])
    if (cots && cots.length > 0) {
      const { data: coti } = await supabase.from('cotacoes_itens').select('*').in('cotacao_id', cots.map(c => c.id))
      setCotacoesItens(coti ?? [])
    } else {
      setCotacoesItens([])
    }
    setCarregandoPedido(false)
  }
```

Passar `recebimentos` para `DetalhePedido` na chamada em `if (!novo) { ... }`:

```tsx
      <DetalhePedido
        pedido={pedido} itens={itensPedido} cotacoes={cotacoes} cotacoesItens={cotacoesItens}
        fornecedores={fornecedores} recebimentos={recebimentos} onRecarregar={() => carregarPedido(pedido.id)}
      />
```

- [ ] **Step 3: Estender `DetalhePedidoProps` e adicionar seções de envio/recebimento/NF**

Ajustar a interface:

```tsx
interface DetalhePedidoProps {
  pedido: PedidoCompra
  itens: PedidoCompraItem[]
  cotacoes: Cotacao[]
  cotacoesItens: CotacaoItem[]
  fornecedores: Fornecedor[]
  recebimentos: RecebimentoNf[]
  onRecarregar: () => void
}
```

Ajustar a assinatura de `DetalhePedido` para receber `recebimentos`, e adicionar estado/ações dentro do componente (logo após as declarações de `aprovarPedido`):

```tsx
  const [quantidades, setQuantidades] = useState<Record<string, string>>({})
  const [arquivoNf, setArquivoNf] = useState<File | null>(null)
  const [obsNf, setObsNf] = useState('')
  const [salvandoRecebimento, setSalvandoRecebimento] = useState(false)
  const [msgRecebimento, setMsgRecebimento] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)

  async function marcarEnviado() {
    await supabase.from('pedidos_compra').update({ status: 'enviado' }).eq('id', pedido.id)
    onRecarregar()
  }

  async function salvarRecebimento() {
    const atualizacoes = itens.filter(it => quantidades[it.id] !== undefined && quantidades[it.id] !== '')
    if (atualizacoes.length === 0) {
      setMsgRecebimento({ tipo: 'erro', texto: 'Informe a quantidade recebida de ao menos um item.' })
      return
    }
    setSalvandoRecebimento(true)
    setMsgRecebimento(null)
    for (const it of atualizacoes) {
      await supabase.from('pedidos_compra_itens')
        .update({ quantidade_recebida: Number(quantidades[it.id]) })
        .eq('id', it.id)
    }
    setSalvandoRecebimento(false)
    setQuantidades({})
    setMsgRecebimento({ tipo: 'ok', texto: 'Recebimento atualizado.' })
    onRecarregar()
  }

  async function registrarNf() {
    if (!arquivoNf) {
      setMsgRecebimento({ tipo: 'erro', texto: 'Anexe a nota fiscal.' })
      return
    }
    setSalvandoRecebimento(true)
    setMsgRecebimento(null)
    const path = `${pedido.id}/nf-${crypto.randomUUID()}-${arquivoNf.name}`
    const { error: eUp } = await supabase.storage.from('cotacoes-nf').upload(path, arquivoNf)
    if (eUp) {
      setSalvandoRecebimento(false)
      setMsgRecebimento({ tipo: 'erro', texto: `Falha no envio da NF: ${eUp.message}` })
      return
    }
    const { error } = await supabase.from('recebimentos_nf').insert({
      pedido_id: pedido.id, anexo_nf_url: path, observacao: obsNf.trim() || null,
    })
    if (!error && pedido.status === 'recebido_total') {
      await supabase.from('pedidos_compra').update({ status: 'conferido_nf' }).eq('id', pedido.id)
    }
    setSalvandoRecebimento(false)
    setArquivoNf(null); setObsNf('')
    setMsgRecebimento({ tipo: 'ok', texto: 'NF registrada.' })
    onRecarregar()
  }

  function divergencia(it: PedidoCompraItem): boolean {
    return it.quantidade_recebida > 0 && it.quantidade_recebida !== it.quantidade_pedida
  }
```

Adicionar as seções de UI, logo depois do bloco `{ehAdmin && pedido.status === 'em_cotacao' && (...)}` já existente:

```tsx
      {ehAdmin && pedido.status === 'aprovado' && (
        <div className={styles.bloco}>
          <button className={styles.btnPrincipal} onClick={marcarEnviado}>Marcar como enviado ao fornecedor</button>
        </div>
      )}

      {podeEditar && ['enviado', 'recebido_parcial'].includes(pedido.status) && (
        <div className={styles.bloco}>
          <h2>Registrar recebimento</h2>
          {itens.map(it => (
            <label key={it.id} className={styles.campo}>
              {it.descricao_item} — pedido {it.quantidade_pedida} {it.und}, recebido até agora {it.quantidade_recebida}
              {divergencia(it) && <span className={styles.msgErro}> (divergência)</span>}
              <input type="number" min="0" step="0.01" value={quantidades[it.id] ?? ''}
                placeholder={`Nova quantidade total recebida`}
                onChange={e => setQuantidades(prev => ({ ...prev, [it.id]: e.target.value }))} />
            </label>
          ))}
          {msgRecebimento && <p className={msgRecebimento.tipo === 'ok' ? styles.msgOk : styles.msgErro}>{msgRecebimento.texto}</p>}
          <button className={styles.btnPrincipal} onClick={salvarRecebimento} disabled={salvandoRecebimento}>
            {salvandoRecebimento ? 'Salvando…' : 'Salvar quantidades recebidas'}
          </button>
        </div>
      )}

      {podeEditar && pedido.status === 'recebido_total' && (
        <div className={styles.bloco}>
          <h2>Conferência com nota fiscal</h2>
          <label className={styles.campo}>
            Nota fiscal (PDF/foto) *
            <input type="file" accept="application/pdf,image/*" onChange={e => setArquivoNf(e.target.files?.[0] ?? null)} />
          </label>
          <label className={styles.campo}>
            Observação
            <input value={obsNf} onChange={e => setObsNf(e.target.value)} placeholder="Ex.: NF 12345, entrega em duas notas…" />
          </label>
          {msgRecebimento && <p className={msgRecebimento.tipo === 'ok' ? styles.msgOk : styles.msgErro}>{msgRecebimento.texto}</p>}
          <button className={styles.btnPrincipal} onClick={registrarNf} disabled={salvandoRecebimento}>
            {salvandoRecebimento ? 'Salvando…' : 'Anexar NF e conferir'}
          </button>
        </div>
      )}

      {recebimentos.length > 0 && (
        <div className={styles.bloco}>
          <h2>Notas fiscais anexadas ({recebimentos.length})</h2>
          {recebimentos.map(r => (
            <p key={r.id} className={styles.metaLista}>{r.observacao || 'NF sem observação'} — {new Date(r.criado_em).toLocaleDateString('pt-BR')}</p>
          ))}
        </div>
      )}
```

- [ ] **Step 4: Verificar build e testar manualmente**

Run: `npm run build`
Expected: sem erros de tipo.

Rodar `npm run dev`, aprovar o pedido `065` (Task 6), clicar em "Marcar como enviado", lançar recebimento parcial de um item (menor que a quantidade pedida) e confirmar no card da lista de Compras (`/compras`) que o status virou "Recebido parcial" automaticamente (trigger do banco); completar a quantidade do item restante e confirmar que vira "Recebido total"; anexar a NF e confirmar que o status muda para "Conferido com NF".

- [ ] **Step 5: Commit**

```bash
git add src/pages/CompraForm.tsx
git commit -m "Fase 6: envio, recebimento por item e conferencia com NF"
```

---

### Task 8: CompraForm — cancelamento, encerramento e documentação da fase

**Files:**
- Modify: `src/pages/CompraForm.tsx` (ações de cancelar/encerrar, admin apenas)
- Create: `docs/fase6_compras.md`
- Modify: `CLAUDE.md` (§0, registrar entrega — só depois de aprovação explícita do Rodrigo, ver Step 4)

**Interfaces:**
- Consumes: nada novo.
- Produces: nada consumido por outra task (última do plano).

- [ ] **Step 1: Adicionar cancelamento e encerramento em `DetalhePedido`**

Adicionar estado e ações (perto de `registrarNf`):

```tsx
  const [motivoCancelamento, setMotivoCancelamento] = useState('')
  const [mostrarCancelar, setMostrarCancelar] = useState(false)

  async function cancelarPedido() {
    if (!motivoCancelamento.trim()) {
      alert('Informe o motivo do cancelamento.')
      return
    }
    await supabase.from('pedidos_compra').update({
      status: 'cancelado', motivo_cancelamento: motivoCancelamento.trim(),
    }).eq('id', pedido.id)
    onRecarregar()
  }

  async function encerrarPedido() {
    await supabase.from('pedidos_compra').update({ status: 'encerrado' }).eq('id', pedido.id)
    onRecarregar()
  }
```

Adicionar a UI no final do JSX de `DetalhePedido`, antes do fechamento do `</div>` principal:

```tsx
      {ehAdmin && pedido.status === 'conferido_nf' && (
        <div className={styles.bloco}>
          <button className={styles.btnPrincipal} onClick={encerrarPedido}>Encerrar pedido</button>
        </div>
      )}

      {pedido.status === 'cancelado' && pedido.motivo_cancelamento && (
        <div className={styles.bloco}>
          <h2>Motivo do cancelamento</h2>
          <p>{pedido.motivo_cancelamento}</p>
        </div>
      )}

      {ehAdmin && !['encerrado', 'cancelado'].includes(pedido.status) && (
        <div className={styles.bloco}>
          {!mostrarCancelar ? (
            <button className={styles.btnSecundario} onClick={() => setMostrarCancelar(true)}>Cancelar pedido</button>
          ) : (
            <>
              <label className={styles.campo}>
                Motivo do cancelamento *
                <input value={motivoCancelamento} onChange={e => setMotivoCancelamento(e.target.value)} />
              </label>
              <button className={styles.btnSecundario} onClick={cancelarPedido}>Confirmar cancelamento</button>
            </>
          )}
        </div>
      )}
```

Adicionar `.btnSecundario` ao `src/pages/CompraForm.module.css` (reaproveitando o estilo já usado em `Compras.module.css`):

```css
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
```

- [ ] **Step 2: Verificar build e testar manualmente o ciclo completo**

Run: `npm run build`
Expected: sem erros de tipo.

Rodar `npm run dev` e, como admin, no pedido `065` já em "Conferido com NF" (Task 7), clicar em "Encerrar pedido" e confirmar que o status final é "Encerrado". Criar um segundo pedido de teste e cancelá-lo com um motivo, confirmando que o motivo aparece na tela e que o pedido cancelado não pode mais ser editado (campos de cotação/recebimento somem).

- [ ] **Step 3: Criar `docs/fase6_compras.md`**

```markdown
# Fase 6 — Suprimentos: Compras

> Detalhes técnicos do módulo de Compras. Entregue em 10/07/2026, aguardando teste de campo com pedido real da obra piloto e aceite do Rodrigo — ver CLAUDE.md §0 e §7.

## O que foi entregue

- Pedido de compra com múltiplos itens, cada um vinculado (quando possível) a um serviço do orçamento via autocomplete; item sem correspondência fica marcado "a classificar".
- Data de necessidade e flag de urgência por item.
- Cotações por fornecedor, com anexo obrigatório, condição de pagamento e prazo de entrega; comparação lado a lado; vencedor definido por item (exclusivo do admin).
- Aprovação do pedido (admin) — bloqueada até todos os itens terem vencedor.
- Fluxo de status: rascunho → em_cotacao → aprovado → enviado → recebido_parcial/recebido_total (automático, via trigger) → conferido_nf → encerrado, com cancelamento (motivo obrigatório) possível em qualquer ponto antes de encerrado.
- Cadastro de fornecedores reaproveitável entre pedidos.
- Numeração sequencial por obra: obra piloto começa em 065 (64 pedidos já feitos fora do app antes da Fase 6); obras novas começam em 001.

## Fora de escopo (spec separada)

- Almoxarifado (entrada/saída de estoque, empréstimo de ferramentas).
- Conferência tripla automática cotação × recebimento no almoxarifado × NF — depende do Almoxarifado existir.
- Alertas automáticos (pedido urgente parado, prazo estourado) — Fase 7.

## Onde estão as regras de negócio

RLS e triggers em `supabase/migrations/20260710_fase6_compras.sql`. Ver `docs/superpowers/specs/2026-07-10-fase6-compras-design.md` para o desenho completo e as decisões tomadas com o Rodrigo.
```

- [ ] **Step 4: Commit (sem alterar CLAUDE.md ainda)**

```bash
git add src/pages/CompraForm.tsx src/pages/CompraForm.module.css docs/fase6_compras.md
git commit -m "Fase 6: cancelamento, encerramento e documentacao do modulo Compras"
```

> **Importante:** não editar `CLAUDE.md` §0 nesta task. Por regra do próprio documento ("alterações neste documento exigem aprovação do Rodrigo"), a linha de status da Fase 6 só deve ser marcada como "concluída e aceita" depois que o Rodrigo testar com um pedido real da obra piloto e der o aceite — mesmo padrão usado para a Fase 5. Quando isso acontecer, atualizar `CLAUDE.md` §0 e o número de versão do documento numa alteração separada, fora deste plano.

---

## Definição de pronto (checklist final, ao terminar as 8 tasks)

- [ ] Funciona em celular e desktop (testar o formulário de novo pedido e a tabela comparativa de cotações no viewport mobile).
- [ ] Permissões testadas: cliente não vê `/compras` nem `/fornecedores`; equipe sem o módulo `compras` não vê o link no menu; equipe com o módulo cria pedido/cotação mas não consegue marcar vencedor nem aprovar (botões somem, e uma tentativa direta via `cotacao_item_vencedora_id` é bloqueada pelo trigger `trg_restringir_vencedor_item`).
- [ ] Rastreabilidade: todo registro (`fornecedores`, `pedidos_compra`, `pedidos_compra_itens`, `cotacoes`, `cotacoes_itens`, `recebimentos_nf`) tem `criado_por`/`criado_em`.
- [ ] Migração versionada em `supabase/migrations/20260710_fase6_compras.sql`.
- [ ] Sem dados de teste esquecidos (apagar/cancelar pedidos e fornecedores criados só para testar antes de entregar ao Rodrigo).
- [ ] Rodrigo testou com um pedido real da obra piloto e deu aceite.
