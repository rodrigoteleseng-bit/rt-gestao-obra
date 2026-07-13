# Fase 7 — Contratos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Módulo novo `/contratos` (+ `/empreiteiros`) — contratos com empreiteiros terceirizados por serviço, vinculando itens (serviço do orçamento × unidade) com quantidade e valor negociados, e ciclo de status rascunho → ativo → encerrado. Base para o futuro módulo de Medições.

**Architecture:** Duas tabelas novas de cadastro/documento (`empreiteiros`, `contratos`) + tabela de itens (`contratos_itens`), seguindo exatamente o padrão já estabelecido pelo módulo Compras (`fornecedores`/`pedidos_compra`/`pedidos_compra_itens`): numeração sequencial por trigger, `pode_editar_contratos()` para RLS, transição de status restrita a admin via trigger, soft delete com a cláusula `OR pode_editar_contratos()` na policy de SELECT desde o início (regra aprendida em 13/07/2026). Frontend: `Empreiteiros.tsx` (cópia de `Fornecedores.tsx` com 2 campos a mais), `Contratos.tsx` (cópia de `Compras.tsx`), `ContratoForm.tsx` (cópia simplificada de `CompraForm.tsx` — sem cotações/NF/anexos, com um segundo seletor de unidade por item). Toda a infraestrutura de permissão (`modulo_app` já tem `'contratos'`, label em `Usuarios.tsx` já existe, item de menu em `Layout.tsx` já existe, rota-placeholder em `App.tsx` já existe) foi preparada antecipadamente — só falta o schema e as páginas reais.

**Tech Stack:** PostgreSQL (Supabase) pra migração; React + TypeScript + Vite pro resto. Sem framework de teste automatizado neste projeto — verificação via `npm run build` + navegador (mesmo padrão usado em todas as fases anteriores).

## Global Constraints

- **Cliente nunca vê Contratos nem Empreiteiros** — mesmo bloqueio total usado em Compras/Fornecedores (`if (perfil?.papel === 'cliente') return <aviso>`), não o modo leitura usado em Definições de Projeto.
- **RLS é a aplicação real da permissão, nunca só a interface** (CLAUDE.md §3/§6) — toda ação restrita a admin (Ativar/Encerrar contrato) tem também um trigger de banco que bloqueia a mudança pra quem não é admin, e toda policy de SELECT que filtra por `ativo = true` já nasce com `OR pode_editar_contratos()` (regra do fix crítico de 13/07/2026 — sem isso, inativar um item trava silenciosamente).
- **Numeração** dos contratos é `CT-001`, `CT-002`... por obra, gerada só pelo trigger — toda obra começa do zero (diferente de Compras, que herdou 64 pedidos em papel).
- **Um contrato só é criado como `rascunho`**; vira `ativo`/`encerrado` só por ação explícita do admin na tela de detalhe. Itens só são editáveis enquanto o contrato está em `rascunho`.
- **`valor_total` do contrato nunca é digitado** — é sempre a soma dos itens ativos, mantida por trigger no banco (`recalcular_valor_contrato`).
- Nenhuma migração de `modulo_app` nem de `Usuarios.tsx`/`Layout.tsx` é necessária — os três já têm `'contratos'` cadastrado desde 07/07/2026.

---

## Arquivos afetados

- Criar: `supabase/migrations/20260713_fase7_contratos.sql`
- Modificar: `src/lib/supabase.ts` — novos tipos `StatusContrato`, `Empreiteiro`, `Contrato`, `ContratoItem`.
- Criar: `src/pages/Empreiteiros.tsx`, `src/pages/Empreiteiros.module.css`
- Criar: `src/pages/Contratos.tsx`, `src/pages/Contratos.module.css`
- Criar: `src/pages/ContratoForm.tsx`, `src/pages/ContratoForm.module.css`
- Modificar: `src/App.tsx` — imports + rotas `/empreiteiros`, `/contratos`, `/contratos/:id` (substitui o stub `EmConstrucao` de Contratos).

---

### Task 1: Migração de banco + tipos TypeScript

**Files:**
- Create: `supabase/migrations/20260713_fase7_contratos.sql`
- Modify: `src/lib/supabase.ts`

**Interfaces:**
- Consumes: `meu_papel()`/`meus_modulos()` de `supabase/migrations/20260707_fase0_fundacao.sql:76-84`; tabelas `obras`, `unidades`, `servicos`, `perfis_usuario` já existentes; enum `modulo_app` (já tem `'contratos'`, `supabase/migrations/20260707_fase7_modulos_extras_enum.sql:4`).
- Produces: tabelas `empreiteiros`, `contratos_seq`, `contratos`, `contratos_itens`; função `pode_editar_contratos()`; tipos `StatusContrato`, `Empreiteiro`, `Contrato`, `ContratoItem` — consumidos pelas Tasks 2-4.

- [ ] **Step 1: Criar a migração**

```sql
-- ============================================================
-- FASE 7 — CONTRATOS | RT Engenharia
-- ============================================================
-- Contratos com empreiteiros terceirizados por serviço: cabeçalho
-- (empreiteiro, objeto, condição de pagamento, retenção %) + itens
-- (serviço do orçamento × unidade, quantidade e valor negociados).
-- Base para o futuro módulo de Medições (lança execução por item).
-- Cliente NÃO vê Contratos (CLAUDE.md §2). Decisões do Rodrigo em
-- 13/07/2026 — ver docs/superpowers/specs/2026-07-13-fase7-contratos-design.md.
--
-- O valor 'contratos' do enum modulo_app já existe
-- (20260707_fase7_modulos_extras_enum.sql) — nada a alterar ali.

CREATE TABLE empreiteiros (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome          TEXT NOT NULL,
  documento     TEXT,
  contato       TEXT,
  especialidade TEXT,
  pix           TEXT,
  ativo         BOOLEAN NOT NULL DEFAULT true,
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
  criado_por    UUID NOT NULL DEFAULT auth.uid() REFERENCES perfis_usuario(id)
);

-- Contador de numeração sequencial por obra (só a função
-- proximo_numero_contrato(), SECURITY DEFINER, escreve aqui).
-- Diferente de pedidos_compra_seq: não há contratos formais em
-- papel a incorporar, então toda obra começa do zero (CT-001).
CREATE TABLE contratos_seq (
  obra_id       UUID PRIMARY KEY REFERENCES obras(id) ON DELETE CASCADE,
  ultimo_numero INTEGER NOT NULL DEFAULT 0
);

INSERT INTO contratos_seq (obra_id, ultimo_numero)
SELECT id, 0 FROM obras
ON CONFLICT (obra_id) DO NOTHING;

CREATE TYPE status_contrato AS ENUM ('rascunho', 'ativo', 'encerrado');

CREATE TABLE contratos (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  obra_id             UUID NOT NULL REFERENCES obras(id) ON DELETE CASCADE,
  numero              TEXT NOT NULL,
  empreiteiro_id      UUID NOT NULL REFERENCES empreiteiros(id),
  objeto              TEXT NOT NULL,
  condicao_pagamento  TEXT,
  retencao_pct        NUMERIC(5,2),
  valor_total         NUMERIC(14,2) NOT NULL DEFAULT 0,
  status              status_contrato NOT NULL DEFAULT 'rascunho',
  ativado_por         UUID REFERENCES perfis_usuario(id),
  ativado_em          TIMESTAMPTZ,
  encerrado_por       UUID REFERENCES perfis_usuario(id),
  encerrado_em        TIMESTAMPTZ,
  ativo               BOOLEAN NOT NULL DEFAULT true,
  criado_em           TIMESTAMPTZ NOT NULL DEFAULT now(),
  criado_por          UUID NOT NULL DEFAULT auth.uid() REFERENCES perfis_usuario(id),
  UNIQUE (obra_id, numero)
);

CREATE OR REPLACE FUNCTION proximo_numero_contrato() RETURNS TRIGGER AS $$
DECLARE
  v_numero INTEGER;
BEGIN
  INSERT INTO contratos_seq (obra_id, ultimo_numero)
  VALUES (NEW.obra_id, 0)
  ON CONFLICT (obra_id) DO NOTHING;

  UPDATE contratos_seq
    SET ultimo_numero = ultimo_numero + 1
    WHERE obra_id = NEW.obra_id
    RETURNING ultimo_numero INTO v_numero;

  NEW.numero := 'CT-' || lpad(v_numero::text, 3, '0');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_numero_contrato
  BEFORE INSERT ON contratos
  FOR EACH ROW EXECUTE FUNCTION proximo_numero_contrato();

-- Só admin pode alterar o status do contrato (Ativar/Encerrar) —
-- mesma lógica de restringir_vencedor_item em Compras: enforcement
-- real no banco, não só no botão da tela.
CREATE OR REPLACE FUNCTION restringir_status_contrato() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status AND meu_papel() <> 'admin' THEN
    RAISE EXCEPTION 'Somente o admin pode alterar o status do contrato.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_restringir_status_contrato
  BEFORE UPDATE ON contratos
  FOR EACH ROW EXECUTE FUNCTION restringir_status_contrato();

CREATE TABLE contratos_itens (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contrato_id     UUID NOT NULL REFERENCES contratos(id) ON DELETE CASCADE,
  servico_id      UUID NOT NULL REFERENCES servicos(id),
  unidade_id      UUID NOT NULL REFERENCES unidades(id),
  quantidade      NUMERIC(14,4) NOT NULL,
  valor_unitario  NUMERIC(14,4) NOT NULL,
  valor_total     NUMERIC(14,2) NOT NULL,
  ativo           BOOLEAN NOT NULL DEFAULT true,
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
  criado_por      UUID NOT NULL DEFAULT auth.uid() REFERENCES perfis_usuario(id)
);

-- Recalcula o valor total do contrato a partir da soma dos itens
-- ativos sempre que um item é inserido, alterado ou inativado.
CREATE OR REPLACE FUNCTION recalcular_valor_contrato() RETURNS TRIGGER AS $$
DECLARE
  v_contrato_id UUID := COALESCE(NEW.contrato_id, OLD.contrato_id);
BEGIN
  UPDATE contratos SET valor_total = (
    SELECT COALESCE(SUM(valor_total), 0) FROM contratos_itens
    WHERE contrato_id = v_contrato_id AND ativo = true
  ) WHERE id = v_contrato_id;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_recalcular_valor_contrato
  AFTER INSERT OR UPDATE ON contratos_itens
  FOR EACH ROW EXECUTE FUNCTION recalcular_valor_contrato();

CREATE INDEX idx_contratos_obra_status    ON contratos(obra_id, status);
CREATE INDEX idx_contratos_itens_contrato ON contratos_itens(contrato_id);
CREATE INDEX idx_contratos_itens_servico  ON contratos_itens(servico_id);

-- ── RLS ──
ALTER TABLE empreiteiros    ENABLE ROW LEVEL SECURITY;
ALTER TABLE contratos_seq   ENABLE ROW LEVEL SECURITY;
ALTER TABLE contratos       ENABLE ROW LEVEL SECURITY;
ALTER TABLE contratos_itens ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION pode_editar_contratos()
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT meu_papel() = 'admin'
    OR (meu_papel() = 'equipe' AND 'contratos' = ANY(meus_modulos()))
$$;

-- Regra de soft delete (CLAUDE.md §3): toda policy de SELECT que
-- filtra por ativo = true já nasce com "OR pode_editar_contratos()",
-- pra não bloquear silenciosamente a inativação (fix de 13/07/2026).

CREATE POLICY emp_select ON empreiteiros FOR SELECT
  USING ((ativo = true AND meu_papel() = ANY (ARRAY['admin', 'equipe']::papel_usuario[])) OR pode_editar_contratos());
CREATE POLICY emp_insert ON empreiteiros FOR INSERT
  WITH CHECK (pode_editar_contratos());
CREATE POLICY emp_update ON empreiteiros FOR UPDATE
  USING (pode_editar_contratos()) WITH CHECK (pode_editar_contratos());

-- Sem policy de INSERT/UPDATE: só proximo_numero_contrato() (SECURITY DEFINER) escreve.
CREATE POLICY ctrseq_select ON contratos_seq FOR SELECT
  USING (meu_papel() IN ('admin', 'equipe'));

CREATE POLICY ctr_select ON contratos FOR SELECT
  USING ((ativo = true AND meu_papel() = ANY (ARRAY['admin', 'equipe']::papel_usuario[])) OR pode_editar_contratos());
CREATE POLICY ctr_insert ON contratos FOR INSERT
  WITH CHECK (pode_editar_contratos() AND status = 'rascunho');
CREATE POLICY ctr_update ON contratos FOR UPDATE
  USING (pode_editar_contratos()) WITH CHECK (pode_editar_contratos());

CREATE POLICY ci_select ON contratos_itens FOR SELECT
  USING ((ativo = true AND meu_papel() = ANY (ARRAY['admin', 'equipe']::papel_usuario[])) OR pode_editar_contratos());
CREATE POLICY ci_insert ON contratos_itens FOR INSERT
  WITH CHECK (
    pode_editar_contratos()
    AND EXISTS (SELECT 1 FROM contratos c WHERE c.id = contrato_id AND (c.status = 'rascunho' OR meu_papel() = 'admin'))
  );
CREATE POLICY ci_update ON contratos_itens FOR UPDATE
  USING (pode_editar_contratos())
  WITH CHECK (
    pode_editar_contratos()
    AND EXISTS (SELECT 1 FROM contratos c WHERE c.id = contrato_id AND (c.status = 'rascunho' OR meu_papel() = 'admin'))
  );
```

- [ ] **Step 2: Aplicar a migração no banco Supabase**

Usar a ferramenta MCP do Supabase (`apply_migration`, projeto `yxshldsfmbmbzdkcymca` — nome `rt-gestao-obra`) com o nome `fase7_contratos` e o SQL acima. **Pedir confirmação explícita ao Rodrigo antes de aplicar** (altera o banco de produção — criação de tabelas novas, aditiva e sem impacto em dados existentes, mas ainda uma mudança de schema ao vivo). Depois de aplicada, confirmar com queries simples:

```sql
SELECT count(*) FROM contratos_seq;         -- 1 linha por obra existente, ultimo_numero = 0
SELECT enum_range(NULL::status_contrato);   -- {rascunho,ativo,encerrado}
```

- [ ] **Step 3: Adicionar os tipos em `src/lib/supabase.ts`**

Ao final do arquivo (depois da interface `EfetivoPresenca`, que hoje termina na última linha do arquivo), adicionar:

```ts

export type StatusContrato = 'rascunho' | 'ativo' | 'encerrado'

export interface Empreiteiro {
  id: string
  nome: string
  documento: string | null
  contato: string | null
  especialidade: string | null
  pix: string | null
  ativo: boolean
  criado_em: string
  criado_por: string
}

export interface Contrato {
  id: string
  obra_id: string
  numero: string
  empreiteiro_id: string
  objeto: string
  condicao_pagamento: string | null
  retencao_pct: number | null
  valor_total: number
  status: StatusContrato
  ativado_por: string | null
  ativado_em: string | null
  encerrado_por: string | null
  encerrado_em: string | null
  ativo: boolean
  criado_em: string
  criado_por: string
}

export interface ContratoItem {
  id: string
  contrato_id: string
  servico_id: string
  unidade_id: string
  quantidade: number
  valor_unitario: number
  valor_total: number
  ativo: boolean
  criado_em: string
  criado_por: string
}
```

- [ ] **Step 4: Verificar**

Rodar `npm run build` — TypeScript deve compilar limpo (os novos tipos ainda não são usados em lugar nenhum, então não há erro possível aqui além de sintaxe).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260713_fase7_contratos.sql src/lib/supabase.ts
git commit -m "Contratos: migração de banco (empreiteiros, contratos, itens) e tipos TypeScript"
```

---

### Task 2: Página `/empreiteiros` (cadastro)

**Files:**
- Create: `src/pages/Empreiteiros.tsx`
- Create: `src/pages/Empreiteiros.module.css`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `Empreiteiro` de `../lib/supabase` (Task 1); `useAuth()` (`perfil`, `temModulo`); tabela `empreiteiros` (Task 1).
- Produces: componente `Empreiteiros` default-exportado, montado na rota `/empreiteiros` — rota linkada por um botão em `Contratos.tsx` (Task 3) e pela navegação de volta em `ContratoForm.tsx` (Task 4); nenhum dos dois importa o componente diretamente, só a tabela `empreiteiros` que esta task passa a popular.

- [ ] **Step 1: Criar `src/pages/Empreiteiros.module.css`**

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

- [ ] **Step 2: Criar `src/pages/Empreiteiros.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { supabase, type Empreiteiro } from '../lib/supabase'
import styles from './Empreiteiros.module.css'

export default function Empreiteiros() {
  const { perfil, temModulo } = useAuth()
  const navigate = useNavigate()
  const podeEditar = perfil?.papel === 'admin' || temModulo('contratos')

  const [empreiteiros, setEmpreiteiros] = useState<Empreiteiro[]>([])
  const [carregando, setCarregando] = useState(true)
  const [nome, setNome] = useState('')
  const [documento, setDocumento] = useState('')
  const [contato, setContato] = useState('')
  const [especialidade, setEspecialidade] = useState('')
  const [pix, setPix] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)

  useEffect(() => { carregar() }, [])

  function carregar() {
    setCarregando(true)
    supabase.from('empreiteiros').select('*').eq('ativo', true).order('nome')
      .then(({ data }) => { setEmpreiteiros(data ?? []); setCarregando(false) })
  }

  async function criar() {
    if (!nome.trim()) {
      setMsg({ tipo: 'erro', texto: 'Informe o nome do empreiteiro.' })
      return
    }
    setSalvando(true)
    setMsg(null)
    const { error } = await supabase.from('empreiteiros').insert({
      nome: nome.trim(),
      documento: documento.trim() || null,
      contato: contato.trim() || null,
      especialidade: especialidade.trim() || null,
      pix: pix.trim() || null,
    })
    setSalvando(false)
    if (error) {
      setMsg({ tipo: 'erro', texto: `Erro ao criar: ${error.message}` })
      return
    }
    setNome(''); setDocumento(''); setContato(''); setEspecialidade(''); setPix('')
    setMsg({ tipo: 'ok', texto: 'Empreiteiro cadastrado.' })
    carregar()
  }

  if (perfil?.papel === 'cliente') {
    return <div className={styles.page}><p className={styles.vazio}>Módulo de uso interno da equipe.</p></div>
  }

  return (
    <div className={styles.page}>
      <button className={styles.voltar} onClick={() => navigate('/contratos')}>← Contratos</button>
      <h1>Empreiteiros</h1>
      <p className={styles.sub}>Cadastro reaproveitável entre contratos.</p>

      {podeEditar && (
        <div className={styles.bloco}>
          <div className={styles.campos}>
            <label className={styles.campo}>
              Nome *
              <input value={nome} onChange={e => setNome(e.target.value)} placeholder="Ex.: José Hidráulica Ltda" />
            </label>
            <div className={styles.linha}>
              <label className={styles.campo}>
                CPF/CNPJ
                <input value={documento} onChange={e => setDocumento(e.target.value)} placeholder="Opcional" />
              </label>
              <label className={styles.campo}>
                Contato
                <input value={contato} onChange={e => setContato(e.target.value)} placeholder="Telefone, e-mail…" />
              </label>
            </div>
            <div className={styles.linha}>
              <label className={styles.campo}>
                Especialidade
                <input value={especialidade} onChange={e => setEspecialidade(e.target.value)} placeholder="Ex.: Hidráulica" />
              </label>
              <label className={styles.campo}>
                Chave PIX
                <input value={pix} onChange={e => setPix(e.target.value)} placeholder="Opcional" />
              </label>
            </div>
          </div>
          {msg && <p className={msg.tipo === 'ok' ? styles.msgOk : styles.msgErro}>{msg.texto}</p>}
          <button className={styles.btnPrincipal} onClick={criar} disabled={salvando} style={{ marginTop: 12 }}>
            {salvando ? 'Salvando…' : '+ Cadastrar empreiteiro'}
          </button>
        </div>
      )}

      {carregando && <p className={styles.vazio}>Carregando…</p>}
      {!carregando && empreiteiros.length === 0 && <p className={styles.vazio}>Nenhum empreiteiro cadastrado.</p>}
      {empreiteiros.map(e => (
        <div key={e.id} className={styles.card}>
          <div className={styles.cardNome}>{e.nome}</div>
          <div className={styles.cardMeta}>
            {e.especialidade && <span>🔧 {e.especialidade}</span>}
            {e.contato && <span>📞 {e.contato}</span>}
            {e.documento && <span>🧾 {e.documento}</span>}
          </div>
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 3: Registrar a rota em `src/App.tsx`**

Adicionar o import logo após `import Fornecedores from './pages/Fornecedores'` (linha 17 do arquivo atual):

```tsx
import Empreiteiros from './pages/Empreiteiros'
```

Adicionar a rota logo após `<Route path="fornecedores" element={<Fornecedores />} />` (linha 59 do arquivo atual):

```tsx
        <Route path="empreiteiros" element={<Empreiteiros />} />
```

- [ ] **Step 4: Verificar**

Rodar `npm run build`. No navegador, logado como admin: acessar `/empreiteiros` direto pela URL, cadastrar um empreiteiro de teste (nome + especialidade), confirmar que aparece na lista com o ícone de especialidade. Logado como cliente: acessar `/empreiteiros` e confirmar o aviso "Módulo de uso interno da equipe."

- [ ] **Step 5: Commit**

```bash
git add src/pages/Empreiteiros.tsx src/pages/Empreiteiros.module.css src/App.tsx
git commit -m "Contratos: página de cadastro de Empreiteiros"
```

---

### Task 3: Página `/contratos` (lista)

**Files:**
- Create: `src/pages/Contratos.tsx`
- Create: `src/pages/Contratos.module.css`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `Contrato`, `Empreiteiro`, `StatusContrato` de `../lib/supabase` (Task 1); `useAuth()`, `useObra()`.
- Produces: componente `Contratos` default-exportado (rota `/contratos`, substitui o stub `EmConstrucao`); `export const STATUS_LABEL: Record<StatusContrato, string>` — consumido por `ContratoForm.tsx` na Task 4 (mesmo padrão de `STATUS_LABEL` exportado por `Compras.tsx` e importado por `CompraForm.tsx`).

- [ ] **Step 1: Criar `src/pages/Contratos.module.css`**

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

.acoesHeader { display: flex; gap: 8px; }

.btnSecundario {
  background: var(--branco);
  color: var(--navy);
  border: 1.5px solid var(--navy);
  border-radius: var(--radius-sm);
  padding: 10px 16px;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  white-space: nowrap;
}

.btnNova {
  background: var(--terracota);
  color: var(--branco);
  border: none;
  border-radius: var(--radius-sm);
  padding: 10px 16px;
  font-size: 13px;
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
.chip_ativo { background: #e3f4e3; color: #1e6b2e; }
.chip_encerrado { background: #e0e0e0; color: #424242; }

.vazio { color: var(--cinza-600); font-size: 14px; padding: 12px 0; }
```

- [ ] **Step 2: Criar `src/pages/Contratos.tsx`**

```tsx
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useObra } from '../contexts/ObraContext'
import { supabase, type Contrato, type Empreiteiro, type StatusContrato } from '../lib/supabase'
import styles from './Contratos.module.css'

export const STATUS_LABEL: Record<StatusContrato, string> = {
  rascunho: 'Rascunho',
  ativo: 'Ativo',
  encerrado: 'Encerrado',
}

export default function Contratos() {
  const { perfil, temModulo } = useAuth()
  const { obraAtiva } = useObra()
  const navigate = useNavigate()
  const podeEditar = perfil?.papel === 'admin' || temModulo('contratos')

  const [contratos, setContratos] = useState<Contrato[]>([])
  const [empreiteiros, setEmpreiteiros] = useState<Empreiteiro[]>([])
  const [carregando, setCarregando] = useState(true)
  const [filtroStatus, setFiltroStatus] = useState<StatusContrato | ''>('')
  const [filtroEmpreiteiro, setFiltroEmpreiteiro] = useState('')

  useEffect(() => {
    if (!obraAtiva) return
    setCarregando(true)
    Promise.all([
      supabase.from('contratos').select('*').eq('obra_id', obraAtiva.id).eq('ativo', true)
        .order('numero', { ascending: false }),
      supabase.from('empreiteiros').select('*').eq('ativo', true).order('nome'),
    ]).then(([c, e]) => {
      setContratos(c.data ?? [])
      setEmpreiteiros(e.data ?? [])
      setCarregando(false)
    })
  }, [obraAtiva])

  const nomeEmpreiteiro = useMemo(() => new Map(empreiteiros.map(e => [e.id, e.nome])), [empreiteiros])

  const filtrados = useMemo(() => {
    return contratos.filter(c =>
      (!filtroStatus || c.status === filtroStatus) &&
      (!filtroEmpreiteiro || c.empreiteiro_id === filtroEmpreiteiro)
    )
  }, [contratos, filtroStatus, filtroEmpreiteiro])

  if (perfil?.papel === 'cliente') {
    return <div className={styles.page}><p className={styles.vazio}>Módulo de uso interno da equipe.</p></div>
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1>Contratos</h1>
          <p className={styles.sub}>Contratos com empreiteiros por serviço — base para as Medições.</p>
        </div>
        <div className={styles.acoesHeader}>
          <button className={styles.btnSecundario} onClick={() => navigate('/empreiteiros')}>Empreiteiros</button>
          {podeEditar && (
            <button className={styles.btnNova} onClick={() => navigate('/contratos/novo')}>+ Novo contrato</button>
          )}
        </div>
      </div>

      <div className={styles.filtros}>
        <select className={styles.selectFiltro} value={filtroStatus}
          onChange={e => setFiltroStatus(e.target.value as StatusContrato | '')}>
          <option value="">Todos os status</option>
          {(Object.keys(STATUS_LABEL) as StatusContrato[]).map(s => (
            <option key={s} value={s}>{STATUS_LABEL[s]}</option>
          ))}
        </select>
        <select className={styles.selectFiltro} value={filtroEmpreiteiro}
          onChange={e => setFiltroEmpreiteiro(e.target.value)}>
          <option value="">Todos os empreiteiros</option>
          {empreiteiros.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}
        </select>
      </div>

      {carregando && <p className={styles.vazio}>Carregando…</p>}
      {!carregando && filtrados.length === 0 && (
        <p className={styles.vazio}>{contratos.length === 0 ? 'Nenhum contrato registrado.' : 'Nenhum contrato com esses filtros.'}</p>
      )}

      {filtrados.map(c => (
        <button key={c.id} className={styles.card} onClick={() => navigate(`/contratos/${c.id}`)}>
          <div className={styles.cardTopo}>
            <span className={styles.cardNumero}>{c.numero}</span>
            <span className={`${styles.chip} ${styles[`chip_${c.status}`]}`}>{STATUS_LABEL[c.status]}</span>
          </div>
          <div className={styles.cardDesc}>{nomeEmpreiteiro.get(c.empreiteiro_id) ?? '—'} — {c.objeto}</div>
          <div className={styles.cardRodape}>
            <span>R$ {c.valor_total.toFixed(2)}</span>
          </div>
        </button>
      ))}
    </div>
  )
}
```

- [ ] **Step 3: Substituir o stub em `src/App.tsx`**

Adicionar o import logo após `import Compras from './pages/Compras'` (linha 20 do arquivo atual):

```tsx
import Contratos from './pages/Contratos'
```

Localizar a linha atual (linha 61):

```tsx
        <Route path="contratos" element={<EmConstrucao modulo="Controle de Contratos" fase={7} />} />
```

Substituir por:

```tsx
        <Route path="contratos" element={<Contratos />} />
```

- [ ] **Step 4: Verificar**

Rodar `npm run build`. No navegador, logado como admin: acessar `/contratos`, confirmar que a lista aparece vazia ("Nenhum contrato registrado."), que "+ Novo contrato" navega pra `/contratos/novo` (vai dar 404/tela em branco até a Task 4 — esperado nesta etapa), e que "Empreiteiros" navega pra `/empreiteiros`. Logado como cliente: confirmar o aviso de módulo interno.

- [ ] **Step 5: Commit**

```bash
git add src/pages/Contratos.tsx src/pages/Contratos.module.css src/App.tsx
git commit -m "Contratos: página de lista com filtros por status e empreiteiro"
```

---

### Task 4: `ContratoForm.tsx` — criar, detalhar, editar itens, Ativar/Encerrar

**Files:**
- Create: `src/pages/ContratoForm.tsx`
- Create: `src/pages/ContratoForm.module.css`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `STATUS_LABEL` de `./Contratos` (Task 3); `Servico`, `Unidade`, `Empreiteiro`, `Contrato`, `ContratoItem`, `StatusContrato` de `../lib/supabase` (Task 1); `useAuth()`, `useObra()`.
- Produces: componente `ContratoForm` default-exportado, montado nas rotas `/contratos/novo` e `/contratos/:id` — última tarefa do plano.

- [ ] **Step 1: Criar `src/pages/ContratoForm.module.css`**

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

.chip_rascunho { background: #eceff1; color: #546e7a; }
.chip_ativo { background: #e3f4e3; color: #1e6b2e; }
.chip_encerrado { background: #e0e0e0; color: #424242; }

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

.linha2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.linha2 .campo { margin-bottom: 0; }

.itemLinha {
  border: 1.5px solid var(--cinza-200);
  border-radius: var(--radius-sm);
  padding: 12px;
  margin-bottom: 10px;
  position: relative;
}

.itemGrid {
  display: grid;
  grid-template-columns: 1.8fr 1.2fr 0.9fr 1fr;
  gap: 10px;
}

.itemGrid .campo { margin-bottom: 0; min-width: 0; }
.itemGrid .campo input, .itemGrid .campo select { width: 100%; min-width: 0; box-sizing: border-box; }

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

.metaLista { display: flex; gap: 14px; flex-wrap: wrap; font-size: 12px; color: var(--cinza-600); margin-bottom: 10px; }

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

@media (max-width: 640px) {
  .itemGrid {
    grid-template-columns: 1fr;
  }

  .linha2 {
    grid-template-columns: 1fr;
  }
}
```

- [ ] **Step 2: Criar `src/pages/ContratoForm.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useObra } from '../contexts/ObraContext'
import { useAuth } from '../contexts/AuthContext'
import {
  supabase, type Servico, type Unidade, type Empreiteiro,
  type Contrato, type ContratoItem,
} from '../lib/supabase'
import { STATUS_LABEL } from './Contratos'
import styles from './ContratoForm.module.css'

interface ItemNovo {
  chave: string
  servico_id: string | null
  servicoCodigo: string
  buscaAplicacao: string
  buscaAberta: boolean
  unidade_id: string
  quantidade: string
  valor_unitario: string
}

function itemVazio(): ItemNovo {
  return {
    chave: crypto.randomUUID(),
    servico_id: null,
    servicoCodigo: '',
    buscaAplicacao: '',
    buscaAberta: false,
    unidade_id: '',
    quantidade: '',
    valor_unitario: '',
  }
}

interface ItemEditavel extends ItemNovo {
  id: string | null
  removido: boolean
}

function itemEditVazio(): ItemEditavel {
  return { ...itemVazio(), id: null, removido: false }
}

export default function ContratoForm() {
  const { id } = useParams()
  const novo = id === 'novo'
  const navigate = useNavigate()
  const { obraAtiva } = useObra()
  const { perfil, temModulo } = useAuth()
  const podeEditar = perfil?.papel === 'admin' || temModulo('contratos')

  const [servicos, setServicos] = useState<Servico[]>([])
  const [unidades, setUnidades] = useState<Unidade[]>([])
  const [empreiteiros, setEmpreiteiros] = useState<Empreiteiro[]>([])

  const [empreiteiroId, setEmpreiteiroId] = useState('')
  const [objeto, setObjeto] = useState('')
  const [condicaoPagamento, setCondicaoPagamento] = useState('')
  const [retencaoPct, setRetencaoPct] = useState('')
  const [itens, setItens] = useState<ItemNovo[]>([itemVazio()])
  const [salvando, setSalvando] = useState(false)
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)

  const [contrato, setContrato] = useState<Contrato | null>(null)
  const [itensContrato, setItensContrato] = useState<ContratoItem[]>([])
  const [carregandoContrato, setCarregandoContrato] = useState(!novo)

  useEffect(() => {
    Promise.all([
      supabase.from('servicos').select('*').eq('ativo', true).order('codigo'),
      supabase.from('empreiteiros').select('*').eq('ativo', true).order('nome'),
    ]).then(([s, e]) => {
      setServicos(s.data ?? [])
      setEmpreiteiros(e.data ?? [])
    })
  }, [])

  useEffect(() => {
    if (!obraAtiva) return
    supabase.from('unidades').select('*').eq('obra_id', obraAtiva.id).order('ordem')
      .then(({ data }) => setUnidades(data ?? []))
  }, [obraAtiva])

  useEffect(() => {
    if (!novo && id) carregarContrato(id)
  }, [id, novo])

  async function carregarContrato(contratoId: string) {
    setCarregandoContrato(true)
    const [{ data: c }, { data: its }] = await Promise.all([
      supabase.from('contratos').select('*').eq('id', contratoId).single(),
      supabase.from('contratos_itens').select('*').eq('contrato_id', contratoId).eq('ativo', true).order('criado_em'),
    ])
    setContrato(c ?? null)
    setItensContrato(its ?? [])
    setCarregandoContrato(false)
  }

  function sugestoesPara(texto: string): Servico[] {
    const t = texto.trim().toLowerCase()
    if (!t) return servicos
    return servicos.filter(s => s.nome.toLowerCase().includes(t) || (s.codigo ?? '').toLowerCase().includes(t))
  }

  function atualizarItem(chave: string, patch: Partial<ItemNovo>) {
    setItens(prev => prev.map(it => it.chave === chave ? { ...it, ...patch } : it))
  }

  function escolherServico(chave: string, s: Servico) {
    setItens(prev => prev.map(it => it.chave === chave ? {
      ...it,
      servico_id: s.id,
      servicoCodigo: s.codigo || s.nome,
      buscaAplicacao: `${s.codigo ?? ''} ${s.nome}`.trim(),
      buscaAberta: false,
    } : it))
  }

  function removerItem(chave: string) {
    setItens(prev => prev.length > 1 ? prev.filter(it => it.chave !== chave) : prev)
  }

  async function criar() {
    if (!obraAtiva) return
    if (!empreiteiroId) {
      setMsg({ tipo: 'erro', texto: 'Selecione o empreiteiro.' })
      return
    }
    if (!objeto.trim()) {
      setMsg({ tipo: 'erro', texto: 'Informe o objeto do contrato.' })
      return
    }
    const itensValidos = itens.filter(it =>
      it.servico_id && it.unidade_id && Number(it.quantidade) > 0 && Number(it.valor_unitario) > 0
    )
    if (itensValidos.length === 0) {
      setMsg({ tipo: 'erro', texto: 'Adicione ao menos um item com serviço, unidade, quantidade e valor unitário.' })
      return
    }
    setSalvando(true)
    setMsg(null)
    const { data: novoContrato, error } = await supabase.from('contratos').insert({
      obra_id: obraAtiva.id,
      empreiteiro_id: empreiteiroId,
      objeto: objeto.trim(),
      condicao_pagamento: condicaoPagamento.trim() || null,
      retencao_pct: retencaoPct ? Number(retencaoPct) : null,
    }).select().single()
    if (error || !novoContrato) {
      setSalvando(false)
      setMsg({ tipo: 'erro', texto: `Erro ao criar contrato: ${error?.message}` })
      return
    }
    const { error: eItens } = await supabase.from('contratos_itens').insert(
      itensValidos.map(it => ({
        contrato_id: novoContrato.id,
        servico_id: it.servico_id,
        unidade_id: it.unidade_id,
        quantidade: Number(it.quantidade),
        valor_unitario: Number(it.valor_unitario),
        valor_total: Number(it.quantidade) * Number(it.valor_unitario),
      }))
    )
    setSalvando(false)
    if (eItens) {
      setMsg({ tipo: 'erro', texto: `Contrato criado, mas falhou ao salvar itens: ${eItens.message}` })
      return
    }
    navigate(`/contratos/${novoContrato.id}`, { replace: true })
  }

  if (perfil?.papel === 'cliente') {
    return <div className={styles.page}><p className={styles.vazio}>Módulo de uso interno da equipe.</p></div>
  }

  if (!novo) {
    if (carregandoContrato) return <div className={styles.page}><p className={styles.vazio}>Carregando…</p></div>
    if (!contrato) return <div className={styles.page}><p className={styles.vazio}>Contrato não encontrado.</p></div>
    return (
      <DetalheContrato
        contrato={contrato} itens={itensContrato} servicos={servicos} unidades={unidades} empreiteiros={empreiteiros}
        podeEditar={podeEditar} ehAdmin={perfil?.papel === 'admin'} perfilId={perfil?.id}
        onRecarregar={() => carregarContrato(contrato.id)}
      />
    )
  }

  if (!podeEditar) {
    return <div className={styles.page}><p className={styles.vazio}>Você não tem permissão para criar contratos.</p></div>
  }

  return (
    <div className={styles.page}>
      <button className={styles.voltar} onClick={() => navigate('/contratos')}>← Contratos</button>
      <h1>Novo contrato</h1>

      <div className={styles.bloco}>
        <label className={styles.campo}>
          Empreiteiro *
          <select value={empreiteiroId} onChange={e => setEmpreiteiroId(e.target.value)}>
            <option value="">Selecione…</option>
            {empreiteiros.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}
          </select>
        </label>
        <label className={styles.campo}>
          Objeto *
          <input value={objeto} onChange={e => setObjeto(e.target.value)}
            placeholder="Ex.: Hidráulica — 13 sobrados" />
        </label>
        <div className={styles.linha2}>
          <label className={styles.campo}>
            Condição de pagamento
            <input value={condicaoPagamento} onChange={e => setCondicaoPagamento(e.target.value)}
              placeholder="Ex.: medição quinzenal, 30 dias" />
          </label>
          <label className={styles.campo}>
            Retenção (%)
            <input type="number" min="0" max="100" step="0.1" value={retencaoPct}
              onChange={e => setRetencaoPct(e.target.value)} placeholder="Opcional" />
          </label>
        </div>
      </div>

      <div className={styles.bloco}>
        <h2>Itens</h2>
        {itens.map(it => {
          const sugestoes = it.buscaAberta ? sugestoesPara(it.buscaAplicacao) : []
          const servicoOrcado = servicos.find(s => s.id === it.servico_id)
          return (
            <div key={it.chave} className={styles.itemLinha}>
              {itens.length > 1 && (
                <button className={styles.btnRemoverItem} onClick={() => removerItem(it.chave)}>✕</button>
              )}
              <div className={styles.itemGrid}>
                <div className={styles.campo}>
                  Serviço *
                  <div className={styles.autocompleteWrap}>
                    <input
                      value={it.buscaAplicacao}
                      onChange={e => atualizarItem(it.chave, {
                        buscaAplicacao: e.target.value, servico_id: null, servicoCodigo: '', buscaAberta: true,
                      })}
                      onFocus={() => atualizarItem(it.chave, { buscaAberta: true })}
                      onBlur={() => setTimeout(() => atualizarItem(it.chave, { buscaAberta: false }), 150)}
                      placeholder="Ex.: hidráulica"
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
                    ? <span className={styles.vinculoOk}>✓ {it.servicoCodigo}{servicoOrcado?.valor_unit != null ? ` — orçado R$ ${servicoOrcado.valor_unit.toFixed(2)}` : ''}</span>
                    : <span className={styles.vinculoAusente}>⚠ selecione um serviço do orçamento</span>}
                </div>
                <label className={styles.campo}>
                  Unidade *
                  <select value={it.unidade_id} onChange={e => atualizarItem(it.chave, { unidade_id: e.target.value })}>
                    <option value="">Selecione…</option>
                    {unidades.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}
                  </select>
                </label>
                <label className={styles.campo}>
                  Quantidade *
                  <input type="number" min="0" step="0.0001" value={it.quantidade}
                    onChange={e => atualizarItem(it.chave, { quantidade: e.target.value })} />
                </label>
                <label className={styles.campo}>
                  Valor unit. (R$) *
                  <input type="number" min="0" step="0.01" value={it.valor_unitario}
                    onChange={e => atualizarItem(it.chave, { valor_unitario: e.target.value })} />
                </label>
              </div>
            </div>
          )
        })}
        <button className={styles.btnAddItem} onClick={() => setItens(prev => [...prev, itemVazio()])}>+ Adicionar item</button>
      </div>

      {msg && <p className={msg.tipo === 'ok' ? styles.msgOk : styles.msgErro}>{msg.texto}</p>}
      <button className={styles.btnPrincipal} onClick={criar} disabled={salvando}>
        {salvando ? 'Salvando…' : 'Criar contrato'}
      </button>
    </div>
  )
}

interface DetalheContratoProps {
  contrato: Contrato
  itens: ContratoItem[]
  servicos: Servico[]
  unidades: Unidade[]
  empreiteiros: Empreiteiro[]
  podeEditar: boolean
  ehAdmin: boolean
  perfilId: string | undefined
  onRecarregar: () => void
}

function DetalheContrato({ contrato, itens, servicos, unidades, empreiteiros, podeEditar, ehAdmin, perfilId, onRecarregar }: DetalheContratoProps) {
  const navigate = useNavigate()
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)
  const [processando, setProcessando] = useState(false)

  const [editando, setEditando] = useState(false)
  const [itensEdit, setItensEdit] = useState<ItemEditavel[]>([])
  const [salvandoItens, setSalvandoItens] = useState(false)

  const nomeServico = new Map(servicos.map(s => [s.id, s]))
  const nomeUnidade = new Map(unidades.map(u => [u.id, u.nome]))
  const empreiteiro = empreiteiros.find(e => e.id === contrato.empreiteiro_id)

  const podeEditarItens = podeEditar && contrato.status === 'rascunho'

  function abrirEdicaoItens() {
    setItensEdit(itens.map(it => {
      const s = nomeServico.get(it.servico_id)
      return {
        id: it.id,
        chave: it.id,
        servico_id: it.servico_id,
        servicoCodigo: s?.codigo || s?.nome || '',
        buscaAplicacao: `${s?.codigo ?? ''} ${s?.nome ?? ''}`.trim(),
        buscaAberta: false,
        unidade_id: it.unidade_id,
        quantidade: String(it.quantidade),
        valor_unitario: String(it.valor_unitario),
        removido: false,
      }
    }))
    setEditando(true)
  }

  function sugestoesPara(texto: string): Servico[] {
    const t = texto.trim().toLowerCase()
    if (!t) return servicos
    return servicos.filter(s => s.nome.toLowerCase().includes(t) || (s.codigo ?? '').toLowerCase().includes(t))
  }

  function atualizarItemEdit(chave: string, patch: Partial<ItemEditavel>) {
    setItensEdit(prev => prev.map(it => it.chave === chave ? { ...it, ...patch } : it))
  }

  function escolherServicoEdit(chave: string, s: Servico) {
    setItensEdit(prev => prev.map(it => it.chave === chave ? {
      ...it, servico_id: s.id, servicoCodigo: s.codigo || s.nome,
      buscaAplicacao: `${s.codigo ?? ''} ${s.nome}`.trim(), buscaAberta: false,
    } : it))
  }

  async function salvarItens() {
    setSalvandoItens(true)
    setMsg(null)
    for (const it of itensEdit) {
      if (it.removido) {
        if (it.id) {
          const { error } = await supabase.from('contratos_itens').update({ ativo: false }).eq('id', it.id)
          if (error) { setSalvandoItens(false); setMsg({ tipo: 'erro', texto: `Erro ao remover item: ${error.message}` }); return }
        }
        continue
      }
      if (!it.servico_id || !it.unidade_id || !(Number(it.quantidade) > 0) || !(Number(it.valor_unitario) > 0)) continue
      const valores = {
        servico_id: it.servico_id,
        unidade_id: it.unidade_id,
        quantidade: Number(it.quantidade),
        valor_unitario: Number(it.valor_unitario),
        valor_total: Number(it.quantidade) * Number(it.valor_unitario),
      }
      const { error } = it.id
        ? await supabase.from('contratos_itens').update(valores).eq('id', it.id)
        : await supabase.from('contratos_itens').insert({ ...valores, contrato_id: contrato.id })
      if (error) { setSalvandoItens(false); setMsg({ tipo: 'erro', texto: `Erro ao salvar item: ${error.message}` }); return }
    }
    setSalvandoItens(false)
    setEditando(false)
    onRecarregar()
  }

  async function ativarContrato() {
    setProcessando(true)
    const { error } = await supabase.from('contratos').update({
      status: 'ativo', ativado_por: perfilId, ativado_em: new Date().toISOString(),
    }).eq('id', contrato.id)
    setProcessando(false)
    if (error) { setMsg({ tipo: 'erro', texto: `Erro ao ativar: ${error.message}` }); return }
    onRecarregar()
  }

  async function encerrarContrato() {
    if (!confirm('Encerrar este contrato? Ele deixará de aceitar alterações.')) return
    setProcessando(true)
    const { error } = await supabase.from('contratos').update({
      status: 'encerrado', encerrado_por: perfilId, encerrado_em: new Date().toISOString(),
    }).eq('id', contrato.id)
    setProcessando(false)
    if (error) { setMsg({ tipo: 'erro', texto: `Erro ao encerrar: ${error.message}` }); return }
    onRecarregar()
  }

  return (
    <div className={styles.page}>
      <button className={styles.voltar} onClick={() => navigate('/contratos')}>← Contratos</button>
      <div className={styles.header}>
        <h1>{contrato.numero}</h1>
        <span className={`${styles.chip} ${styles[`chip_${contrato.status}`]}`}>{STATUS_LABEL[contrato.status]}</span>
      </div>

      <div className={styles.bloco}>
        <div className={styles.metaLista}>
          <span>👷 {empreiteiro?.nome ?? '—'}</span>
          {contrato.condicao_pagamento && <span>💳 {contrato.condicao_pagamento}</span>}
          {contrato.retencao_pct != null && <span>🔒 Retenção {contrato.retencao_pct}%</span>}
        </div>
        <p>{contrato.objeto}</p>
        <p><strong>Valor total: R$ {contrato.valor_total.toFixed(2)}</strong></p>
      </div>

      {ehAdmin && contrato.status === 'rascunho' && (
        <div className={styles.bloco}>
          <button className={styles.btnPrincipal} onClick={ativarContrato} disabled={processando}>
            {processando ? 'Ativando…' : 'Ativar contrato'}
          </button>
        </div>
      )}
      {ehAdmin && contrato.status === 'ativo' && (
        <div className={styles.bloco}>
          <button className={styles.btnSecundario} onClick={encerrarContrato} disabled={processando}>
            {processando ? 'Encerrando…' : 'Encerrar contrato'}
          </button>
        </div>
      )}

      {msg && <p className={msg.tipo === 'ok' ? styles.msgOk : styles.msgErro}>{msg.texto}</p>}

      <div className={styles.bloco}>
        <h2>Itens</h2>
        {!editando && (
          <>
            <table className={styles.tabelaComparativa}>
              <thead>
                <tr><th>Serviço</th><th>Unidade</th><th>Qtd.</th><th>Valor unit.</th><th>Valor total</th><th>Orçado (unit.)</th></tr>
              </thead>
              <tbody>
                {itens.map(it => {
                  const s = nomeServico.get(it.servico_id)
                  return (
                    <tr key={it.id}>
                      <td>{s?.codigo ? `${s.codigo} — ` : ''}{s?.nome ?? '—'}</td>
                      <td>{nomeUnidade.get(it.unidade_id) ?? '—'}</td>
                      <td>{it.quantidade}</td>
                      <td>R$ {it.valor_unitario.toFixed(2)}</td>
                      <td>R$ {it.valor_total.toFixed(2)}</td>
                      <td>{s?.valor_unit != null ? `R$ ${s.valor_unit.toFixed(2)}` : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {podeEditarItens && (
              <button className={styles.btnSecundario} onClick={abrirEdicaoItens} style={{ marginTop: 10 }}>Editar itens</button>
            )}
          </>
        )}

        {editando && (
          <>
            {itensEdit.filter(it => !it.removido).map(it => {
              const sugestoes = it.buscaAberta ? sugestoesPara(it.buscaAplicacao) : []
              return (
                <div key={it.chave} className={styles.itemLinha}>
                  <button className={styles.btnRemoverItem} onClick={() => atualizarItemEdit(it.chave, { removido: true })}>✕</button>
                  <div className={styles.itemGrid}>
                    <div className={styles.campo}>
                      Serviço *
                      <div className={styles.autocompleteWrap}>
                        <input
                          value={it.buscaAplicacao}
                          onChange={e => atualizarItemEdit(it.chave, {
                            buscaAplicacao: e.target.value, servico_id: null, servicoCodigo: '', buscaAberta: true,
                          })}
                          onFocus={() => atualizarItemEdit(it.chave, { buscaAberta: true })}
                          onBlur={() => setTimeout(() => atualizarItemEdit(it.chave, { buscaAberta: false }), 150)}
                        />
                        {sugestoes.length > 0 && (
                          <div className={styles.sugestoes}>
                            {sugestoes.map(s => (
                              <button key={s.id} className={styles.sugestao}
                                onMouseDown={() => escolherServicoEdit(it.chave, s)}>
                                <span className={styles.sugestaoCodigo}>{s.codigo}</span>{s.nome}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      {it.servico_id
                        ? <span className={styles.vinculoOk}>✓ {it.servicoCodigo}</span>
                        : <span className={styles.vinculoAusente}>⚠ selecione um serviço</span>}
                    </div>
                    <label className={styles.campo}>
                      Unidade *
                      <select value={it.unidade_id} onChange={e => atualizarItemEdit(it.chave, { unidade_id: e.target.value })}>
                        <option value="">Selecione…</option>
                        {unidades.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}
                      </select>
                    </label>
                    <label className={styles.campo}>
                      Quantidade *
                      <input type="number" min="0" step="0.0001" value={it.quantidade}
                        onChange={e => atualizarItemEdit(it.chave, { quantidade: e.target.value })} />
                    </label>
                    <label className={styles.campo}>
                      Valor unit. (R$) *
                      <input type="number" min="0" step="0.01" value={it.valor_unitario}
                        onChange={e => atualizarItemEdit(it.chave, { valor_unitario: e.target.value })} />
                    </label>
                  </div>
                </div>
              )
            })}
            <button className={styles.btnAddItem} onClick={() => setItensEdit(prev => [...prev, itemEditVazio()])}>+ Adicionar item</button>
            <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
              <button className={styles.btnPrincipal} onClick={salvarItens} disabled={salvandoItens}>
                {salvandoItens ? 'Salvando…' : 'Salvar itens'}
              </button>
              <button className={styles.btnSecundario} onClick={() => setEditando(false)}>Cancelar</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Registrar as rotas em `src/App.tsx`**

Adicionar o import logo após `import Contratos from './pages/Contratos'` (adicionado na Task 3):

```tsx
import ContratoForm from './pages/ContratoForm'
```

Adicionar a rota logo após `<Route path="contratos" element={<Contratos />} />`:

```tsx
        <Route path="contratos/:id" element={<ContratoForm />} />
```

- [ ] **Step 4: Verificar**

Rodar `npm run build`. No navegador, logado como **admin**:
1. Acessar `/contratos/novo`, selecionar um empreiteiro (cadastrado na Task 2), preencher objeto, adicionar 2 itens com serviços diferentes (usando o autocomplete) em unidades diferentes, quantidade e valor unitário — confirmar que "Criar contrato" navega pra `/contratos/<id>` mostrando `CT-001`, status **Rascunho**, os 2 itens na tabela e o valor total correto (soma dos 2).
2. Clicar "Editar itens", alterar a quantidade de um item, remover o outro, adicionar um novo item, salvar — confirmar que a tabela reflete a mudança e o valor total recalculou (validação direta do trigger `recalcular_valor_contrato`).
3. Clicar "Ativar contrato" — confirmar que o status muda pra **Ativo**, "Editar itens" some da tela (contrato ativo é imutável) e "Encerrar contrato" aparece no lugar de "Ativar".
4. Clicar "Encerrar contrato", confirmar no popup — confirmar status **Encerrado**, sem nenhuma ação restante.
5. Voltar pra `/contratos` e confirmar que o card do contrato aparece com número, empreiteiro, objeto, valor e chip de status corretos; testar o filtro por status e por empreiteiro.

Logado como **equipe com o módulo `contratos` habilitado** (usar um usuário de teste temporário, removido depois): confirmar que consegue criar contrato e editar itens em rascunho, mas os botões "Ativar contrato"/"Encerrar contrato" não aparecem (só admin). Tentar forçar via chamada direta ao Supabase (opcional, apenas se quiser confirmar o trigger `restringir_status_contrato` — não é obrigatório pro teste manual).

Logado como **cliente**: confirmar que `/contratos`, `/contratos/novo` e `/contratos/<id>` mostram o aviso de módulo interno.

- [ ] **Step 5: Commit**

```bash
git add src/pages/ContratoForm.tsx src/pages/ContratoForm.module.css src/App.tsx
git commit -m "Contratos: criação, detalhe, edição de itens em rascunho e Ativar/Encerrar (admin)"
```

---

## Verificação final

- [ ] `npm run build` sem erros.
- [ ] Migração aplicada no Supabase (tabelas `empreiteiros`, `contratos_seq`, `contratos`, `contratos_itens` existem; enum `status_contrato` tem os 3 valores).
- [ ] Fluxo completo testado como admin: cadastrar empreiteiro → criar contrato com itens → editar itens em rascunho → ativar → encerrar.
- [ ] Numeração sequencial `CT-001`, `CT-002`... sem colisão entre contratos da mesma obra.
- [ ] Valor total do contrato sempre reflete a soma dos itens ativos (testado após editar/remover/adicionar item).
- [ ] Equipe com módulo `contratos` cria/edita rascunho mas não vê os botões Ativar/Encerrar.
- [ ] Cliente não acessa `/contratos`, `/contratos/:id` nem `/empreiteiros` (aviso de módulo interno em todas).
- [ ] Soft delete de item de contrato não é bloqueado pelo RLS (policy de SELECT já nasce com `OR pode_editar_contratos()`).
- [ ] Migração versionada em `supabase/migrations`.
- [ ] Rodrigo testou com um contrato real e deu aceite.
