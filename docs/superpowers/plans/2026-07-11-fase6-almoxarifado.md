# Almoxarifado (Fase 6 — Suprimentos) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Módulo Almoxarifado completo: estoque com saldo por material, entradas integradas ao pedido de compra, saídas via requisição em papel (blocos PDF pré-numerados), ferramentas individuais com empréstimo/devolução diária e alerta, conferência tripla no pedido.

**Architecture:** Mesmo padrão das fases anteriores — Supabase (Postgres + RLS + RPCs SECURITY DEFINER) com migração versionada; React + Vite com CSS Modules; PDFs client-side com jsPDF. Sem framework de teste no projeto: o ciclo de verificação de cada task é `npx tsc --noEmit` + SQL de conferência no banco + preview no browser.

**Tech Stack:** React 18 + Vite + TypeScript, Supabase JS, jsPDF, CSS Modules.

**Spec:** `docs/superpowers/specs/2026-07-11-fase6-almoxarifado-design.md` (aprovada 11/07/2026).

## Global Constraints

- Paleta oficial (tokens.css): navy `#1A3248`, terracota `#C49A7A`, acento `--navy-light` `#3A7CA5`. Nunca inventar hex (CLAUDE.md §1).
- Rastreabilidade: todo registro grava `criado_por` (auth.uid()) e `criado_em` (CLAUDE.md §6). Nada se apaga — soft delete (`ativo`).
- RLS obrigatória: cliente NÃO vê o módulo; escrita exige `pode_editar_almoxarifado()`.
- RPC do Postgres: mudar nº de parâmetros exige `DROP FUNCTION` explícito antes (armadilha documentada).
- Typecheck: `$env:Path = "C:\Program Files\nodejs;" + $env:Path; npx tsc --noEmit -p tsconfig.json` — deve passar limpo antes de cada commit.
- Supabase project_id: `yxshldsfmbmbzdkcymca`. Migrações aplicadas via MCP `apply_migration` E salvas em `supabase/migrations/`.
- Numeração de requisição: sequência da obra piloto começa em 400 (primeira digital = 00401), exibida com 5 dígitos.
- Enum `modulo_app` JÁ CONTÉM `'almoxarifado'` (banco e `src/lib/supabase.ts`); checkbox em Usuários e link no sidebar já existem. NÃO recriar.

---

### Task 1: Migração do banco (tabelas, funções, triggers, RLS)

**Files:**
- Create: `supabase/migrations/20260711_fase6_almoxarifado.sql`

**Interfaces:**
- Produces: tabelas `materiais`, `estoque_movimentos`, `requisicoes_seq`, `requisicoes_blocos`, `ferramentas`, `ferramenta_emprestimos`; função `pode_editar_almoxarifado()`; view `estoque_saldos`; RPC `gerar_bloco_requisicoes(p_qtd integer) RETURNS TABLE(numero_inicial int, numero_final int)`; RPC `proximo_codigo_material() RETURNS text`.

- [ ] **Step 1: Escrever a migração**

```sql
-- ============================================================
-- Fase 6 — Almoxarifado | RT Engenharia
-- Spec: docs/superpowers/specs/2026-07-11-fase6-almoxarifado-design.md
-- ============================================================

CREATE TYPE categoria_material AS ENUM ('material', 'epi', 'escritorio');
CREATE TYPE tipo_movimento_estoque AS ENUM ('entrada', 'saida');

CREATE TABLE materiais (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  obra_id       UUID NOT NULL REFERENCES obras(id) ON DELETE CASCADE,
  codigo        TEXT NOT NULL,
  nome          TEXT NOT NULL,
  descricao     TEXT,
  und           TEXT NOT NULL DEFAULT 'un',
  categoria     categoria_material NOT NULL DEFAULT 'material',
  estoque_minimo NUMERIC(14,4),
  ativo         BOOLEAN NOT NULL DEFAULT true,
  criado_por    UUID NOT NULL DEFAULT auth.uid() REFERENCES perfis(id),
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (obra_id, codigo)
);

CREATE TABLE estoque_movimentos (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  obra_id       UUID NOT NULL REFERENCES obras(id) ON DELETE CASCADE,
  material_id   UUID NOT NULL REFERENCES materiais(id),
  tipo          tipo_movimento_estoque NOT NULL,
  quantidade    NUMERIC(14,4) NOT NULL CHECK (quantidade > 0),
  -- entrada:
  pedido_item_id UUID REFERENCES pedidos_compra_itens(id),
  -- saída:
  requisicao_numero INTEGER,
  unidade_id    UUID REFERENCES unidades(id),
  retirado_por  TEXT,
  tarefa_id     UUID REFERENCES cronograma_tarefas(id),
  aplicacao     TEXT,
  observacao    TEXT,
  ativo         BOOLEAN NOT NULL DEFAULT true,
  criado_por    UUID NOT NULL DEFAULT auth.uid() REFERENCES perfis(id),
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_estoque_mov_material ON estoque_movimentos(material_id) WHERE ativo;
CREATE INDEX idx_estoque_mov_pedido_item ON estoque_movimentos(pedido_item_id) WHERE pedido_item_id IS NOT NULL;

CREATE TABLE requisicoes_seq (
  obra_id       UUID PRIMARY KEY REFERENCES obras(id) ON DELETE CASCADE,
  ultimo_numero INTEGER NOT NULL
);
-- Obra piloto: bloco impresso vai até 00400; primeira digital = 00401.
INSERT INTO requisicoes_seq (obra_id, ultimo_numero)
SELECT id, 400 FROM obras;

CREATE TABLE requisicoes_blocos (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  obra_id        UUID NOT NULL REFERENCES obras(id) ON DELETE CASCADE,
  numero_inicial INTEGER NOT NULL,
  numero_final   INTEGER NOT NULL,
  criado_por     UUID NOT NULL DEFAULT auth.uid() REFERENCES perfis(id),
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE ferramentas (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  obra_id       UUID NOT NULL REFERENCES obras(id) ON DELETE CASCADE,
  nome          TEXT NOT NULL,
  descricao     TEXT,
  ativo         BOOLEAN NOT NULL DEFAULT true,
  criado_por    UUID NOT NULL DEFAULT auth.uid() REFERENCES perfis(id),
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE ferramenta_emprestimos (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ferramenta_id  UUID NOT NULL REFERENCES ferramentas(id),
  retirado_por   TEXT NOT NULL,
  unidade_id     UUID REFERENCES unidades(id),
  observacao     TEXT,
  retirada_em    TIMESTAMPTZ NOT NULL DEFAULT now(),
  devolvida_em   TIMESTAMPTZ,
  devolvida_recebida_por UUID REFERENCES perfis(id),
  criado_por     UUID NOT NULL DEFAULT auth.uid() REFERENCES perfis(id),
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- uma ferramenta só pode ter 1 empréstimo aberto
CREATE UNIQUE INDEX uniq_emprestimo_aberto ON ferramenta_emprestimos(ferramenta_id)
  WHERE devolvida_em IS NULL;

-- ---------- permissão ----------
CREATE OR REPLACE FUNCTION pode_editar_almoxarifado()
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT meu_papel() = 'admin'
    OR (meu_papel() = 'equipe' AND 'almoxarifado' = ANY(meus_modulos()))
$$;

-- ---------- saldo ----------
CREATE OR REPLACE VIEW estoque_saldos AS
SELECT m.id AS material_id,
  COALESCE(SUM(CASE WHEN e.tipo = 'entrada' THEN e.quantidade
                    WHEN e.tipo = 'saida'   THEN -e.quantidade END), 0) AS saldo
FROM materiais m
LEFT JOIN estoque_movimentos e ON e.material_id = m.id AND e.ativo
GROUP BY m.id;

CREATE OR REPLACE FUNCTION saldo_material(p_material UUID)
RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT COALESCE(SUM(CASE WHEN tipo = 'entrada' THEN quantidade ELSE -quantidade END), 0)
  FROM estoque_movimentos WHERE material_id = p_material AND ativo
$$;

-- ---------- validações de movimento ----------
CREATE OR REPLACE FUNCTION valida_movimento_estoque()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.tipo = 'saida' THEN
    IF NEW.unidade_id IS NULL THEN
      RAISE EXCEPTION 'Saída exige unidade de destino';
    END IF;
    IF NEW.retirado_por IS NULL OR btrim(NEW.retirado_por) = '' THEN
      RAISE EXCEPTION 'Saída exige quem retirou';
    END IF;
    IF saldo_material(NEW.material_id) < NEW.quantidade THEN
      RAISE EXCEPTION 'Saldo insuficiente: saldo atual %', saldo_material(NEW.material_id);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_valida_movimento
  BEFORE INSERT ON estoque_movimentos
  FOR EACH ROW EXECUTE FUNCTION valida_movimento_estoque();

-- ---------- integração entrada → pedido de compra ----------
-- Entrada vinculada a item de pedido soma em quantidade_recebida
-- (dispara o trigger de status recebido_parcial/total já existente em Compras).
-- Inativar o movimento (soft delete) reverte a soma.
CREATE OR REPLACE FUNCTION sincroniza_recebimento_pedido()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.tipo = 'entrada' AND NEW.pedido_item_id IS NOT NULL THEN
    UPDATE pedidos_compra_itens
    SET quantidade_recebida = quantidade_recebida + NEW.quantidade
    WHERE id = NEW.pedido_item_id;
  ELSIF TG_OP = 'UPDATE' AND OLD.ativo AND NOT NEW.ativo
        AND NEW.tipo = 'entrada' AND NEW.pedido_item_id IS NOT NULL THEN
    UPDATE pedidos_compra_itens
    SET quantidade_recebida = GREATEST(quantidade_recebida - NEW.quantidade, 0)
    WHERE id = NEW.pedido_item_id;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_sincroniza_recebimento
  AFTER INSERT OR UPDATE OF ativo ON estoque_movimentos
  FOR EACH ROW EXECUTE FUNCTION sincroniza_recebimento_pedido();

-- ---------- RPC: gerar bloco de requisições ----------
CREATE OR REPLACE FUNCTION gerar_bloco_requisicoes(p_obra UUID, p_qtd integer)
RETURNS TABLE(numero_inicial integer, numero_final integer)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_ini integer;
  v_fim integer;
BEGIN
  IF NOT pode_editar_almoxarifado() THEN
    RAISE EXCEPTION 'Sem permissão para gerar requisições';
  END IF;
  IF p_qtd < 1 OR p_qtd > 500 THEN
    RAISE EXCEPTION 'Quantidade deve ser entre 1 e 500';
  END IF;
  UPDATE requisicoes_seq
  SET ultimo_numero = ultimo_numero + p_qtd
  WHERE obra_id = p_obra
  RETURNING ultimo_numero - p_qtd + 1, ultimo_numero INTO v_ini, v_fim;
  IF NOT FOUND THEN
    INSERT INTO requisicoes_seq (obra_id, ultimo_numero) VALUES (p_obra, p_qtd);
    v_ini := 1; v_fim := p_qtd;
  END IF;
  INSERT INTO requisicoes_blocos (obra_id, numero_inicial, numero_final, criado_por)
  VALUES (p_obra, v_ini, v_fim, auth.uid());
  RETURN QUERY SELECT v_ini, v_fim;
END;
$$;

-- ---------- RPC: próximo código de material ----------
CREATE OR REPLACE FUNCTION proximo_codigo_material(p_obra UUID)
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT 'COD' || lpad((COALESCE(MAX(substring(codigo FROM '^COD(\d+)$')::int), 0) + 1)::text, 3, '0')
  FROM materiais WHERE obra_id = p_obra
$$;

-- ---------- RLS ----------
ALTER TABLE materiais              ENABLE ROW LEVEL SECURITY;
ALTER TABLE estoque_movimentos     ENABLE ROW LEVEL SECURITY;
ALTER TABLE requisicoes_seq        ENABLE ROW LEVEL SECURITY;
ALTER TABLE requisicoes_blocos     ENABLE ROW LEVEL SECURITY;
ALTER TABLE ferramentas            ENABLE ROW LEVEL SECURITY;
ALTER TABLE ferramenta_emprestimos ENABLE ROW LEVEL SECURITY;

CREATE POLICY mat_select ON materiais FOR SELECT
  USING (ativo = true AND meu_papel() IN ('admin', 'equipe'));
CREATE POLICY mat_insert ON materiais FOR INSERT WITH CHECK (pode_editar_almoxarifado());
CREATE POLICY mat_update ON materiais FOR UPDATE
  USING (pode_editar_almoxarifado()) WITH CHECK (pode_editar_almoxarifado());

CREATE POLICY mov_select ON estoque_movimentos FOR SELECT
  USING (meu_papel() IN ('admin', 'equipe'));
CREATE POLICY mov_insert ON estoque_movimentos FOR INSERT WITH CHECK (pode_editar_almoxarifado());
-- inativar (soft delete) só admin
CREATE POLICY mov_update ON estoque_movimentos FOR UPDATE
  USING (meu_papel() = 'admin') WITH CHECK (meu_papel() = 'admin');

CREATE POLICY rseq_select ON requisicoes_seq FOR SELECT
  USING (meu_papel() IN ('admin', 'equipe'));
CREATE POLICY rbl_select ON requisicoes_blocos FOR SELECT
  USING (meu_papel() IN ('admin', 'equipe'));

CREATE POLICY fer_select ON ferramentas FOR SELECT
  USING (ativo = true AND meu_papel() IN ('admin', 'equipe'));
CREATE POLICY fer_insert ON ferramentas FOR INSERT WITH CHECK (pode_editar_almoxarifado());
CREATE POLICY fer_update ON ferramentas FOR UPDATE
  USING (pode_editar_almoxarifado()) WITH CHECK (pode_editar_almoxarifado());

CREATE POLICY femp_select ON ferramenta_emprestimos FOR SELECT
  USING (meu_papel() IN ('admin', 'equipe'));
CREATE POLICY femp_insert ON ferramenta_emprestimos FOR INSERT WITH CHECK (pode_editar_almoxarifado());
-- devolução = UPDATE preenchendo devolvida_em; empréstimo já devolvido é imutável
CREATE POLICY femp_update ON ferramenta_emprestimos FOR UPDATE
  USING (pode_editar_almoxarifado() AND devolvida_em IS NULL)
  WITH CHECK (pode_editar_almoxarifado());
```

- [ ] **Step 2: Aplicar via MCP** `apply_migration` (project_id `yxshldsfmbmbzdkcymca`, name `fase6_almoxarifado`) com o SQL acima.

- [ ] **Step 3: Verificar no banco**

Run (execute_sql): `SELECT gerar_bloco_requisicoes(id, 0) FROM obras LIMIT 1;`
Expected: erro "Quantidade deve ser entre 1 e 500" (função existe e valida).
Run: `SELECT proximo_codigo_material(id) FROM obras LIMIT 1;`
Expected: `COD001` (sem materiais ainda).
Run: `SELECT ultimo_numero FROM requisicoes_seq;`
Expected: `400`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260711_fase6_almoxarifado.sql
git commit -m "Fase 6: banco do Almoxarifado (estoque, requisicoes, ferramentas, RLS)"
```

---

### Task 2: Seeds — catálogo de materiais, EPIs com saldo e ferramentas individuais

**Files:**
- Create: `supabase/migrations/20260711_fase6_almoxarifado_seed.sql` (gerado por script)
- Create (temporário, scratchpad): `gera_seed_almoxarifado.py`

**Interfaces:**
- Consumes: tabelas da Task 1; CSVs em `C:\Users\rodri.000\Desktop\almoxariafdo\` (Lista de códigos dos materiais / Controle estoque EPI / Levantamento de Equipamento).
- Produces: 152 materiais categoria `material` (COD001–COD161, saldo 0); ~44 EPIs categoria `epi` com código novo na sequência (COD162+), saldo inicial via movimento `entrada` com observação "Inventário inicial (planilha EPI 11/07/2026)" e `estoque_minimo` quando preenchido; ~110 ferramentas individuais numeradas ("Enxada 01"…"Andaime 30").

- [ ] **Step 1: Script Python** no scratchpad lendo os 3 CSVs e emitindo SQL:
  - materiais: `INSERT INTO materiais (obra_id, codigo, nome, descricao, und, categoria) SELECT id, ... FROM obras` — nome título-caso preservando o original; coluna 4/5 do CSV de códigos vira `descricao` (ex.: "rolo 25 m = 1 unid").
  - EPIs: dedup por (nome, descrição/tamanho); código sequencial a partir do maior COD dos materiais; `estoque_minimo` da coluna "Nível para nova encomenda" quando numérica; para cada EPI com quantidade > 0, um `INSERT INTO estoque_movimentos (obra_id, material_id, tipo, quantidade, observacao)` de entrada "Inventário inicial (planilha EPI 11/07/2026)".
  - ferramentas: para cada linha do levantamento com quantidade N, gerar N itens "Nome 01".."Nome NN" (`lpad` 2 dígitos).
  - `criado_por`: usar o id do perfil admin (SELECT do perfil do Rodrigo) — movimentos de seed também são rastreáveis.
- [ ] **Step 2: Aplicar** via `apply_migration` (name `fase6_almoxarifado_seed`).
- [ ] **Step 3: Verificar**

Run: `SELECT categoria, count(*) FROM materiais GROUP BY categoria;`
Expected: material=152, epi≈44.
Run: `SELECT count(*) FROM ferramentas;`
Expected: ≈110.
Run: `SELECT count(*) FROM estoque_movimentos WHERE tipo='entrada';`
Expected: nº de EPIs com saldo > 0 no CSV.

- [ ] **Step 4: Commit** (`git add supabase/migrations/... ; git commit -m "Fase 6: seed do almoxarifado (catalogo COD, EPIs com saldo, ferramentas)"`)

> Saldo inicial dos materiais COD001–161: [lacuna] aguardando planilha de junho do Rodrigo — quando chegar, gerar migração `*_seed_saldos.sql` análoga (entradas "Inventário inicial junho/2026").

---

### Task 3: Tipos TS + rota + tela Estoque (lista com saldo e extrato)

**Files:**
- Modify: `src/lib/supabase.ts` (adicionar tipos ao final da seção de tipos)
- Modify: `src/App.tsx:50` (trocar EmConstrucao pela página real; adicionar rota `/almoxarifado/material/:id` se optar por rota — usar painel inline na mesma página, padrão FVS)
- Create: `src/pages/Almoxarifado.tsx`, `src/pages/Almoxarifado.module.css`

**Interfaces:**
- Produces (em `supabase.ts`):

```ts
export type CategoriaMaterial = 'material' | 'epi' | 'escritorio'
export type TipoMovimentoEstoque = 'entrada' | 'saida'
export interface Material {
  id: string; obra_id: string; codigo: string; nome: string
  descricao: string | null; und: string; categoria: CategoriaMaterial
  estoque_minimo: number | null; ativo: boolean; criado_por: string; criado_em: string
}
export interface EstoqueMovimento {
  id: string; obra_id: string; material_id: string; tipo: TipoMovimentoEstoque
  quantidade: number; pedido_item_id: string | null; requisicao_numero: number | null
  unidade_id: string | null; retirado_por: string | null; tarefa_id: string | null
  aplicacao: string | null; observacao: string | null; ativo: boolean
  criado_por: string; criado_em: string
}
export interface Ferramenta {
  id: string; obra_id: string; nome: string; descricao: string | null
  ativo: boolean; criado_por: string; criado_em: string
}
export interface FerramentaEmprestimo {
  id: string; ferramenta_id: string; retirado_por: string; unidade_id: string | null
  observacao: string | null; retirada_em: string; devolvida_em: string | null
  devolvida_recebida_por: string | null; criado_por: string; criado_em: string
}
export interface RequisicaoBloco {
  id: string; obra_id: string; numero_inicial: number; numero_final: number
  criado_por: string; criado_em: string
}
```

- Página `/almoxarifado` com abas internas (estado local, padrão simples): **Estoque** | **Ferramentas** | **Requisições**. Task 3 entrega a aba Estoque; Tasks 6–7 as demais (aba mostra "em construção" até lá).

- [ ] **Step 1: Tipos em supabase.ts** (bloco acima).
- [ ] **Step 2: Página Almoxarifado — aba Estoque:**
  - Carrega `materiais` (ordenado por nome) + saldos: `supabase.from('estoque_saldos').select('*')` → `Map<material_id, saldo>`. Atenção ao limite de 1000 linhas do Supabase JS (aqui ~200, ok).
  - Filtros: busca texto (código+nome), select de categoria (Todos/Material/EPI/Escritório), checkbox "só abaixo do mínimo".
  - Linha: código · nome (+descrição em cinza) · categoria (chip) · saldo + und · destaque `⚠ repor` quando `estoque_minimo != null && saldo < estoque_minimo` (cor `--alerta`).
  - Clique na linha abre painel de extrato (mesma página): movimentos do material (`estoque_movimentos` where material_id, order criado_em desc) com tipo, quantidade, vínculos (nº requisição / pedido), destino (nome da unidade), quem retirou, autor, data. Admin vê botão "Inativar" por movimento (confirm + `update ativo=false`).
  - Cliente (`perfil.papel === 'cliente'`): página retorna aviso "módulo interno" (padrão Pendencias.tsx:77).
  - Botões de ação no topo (Entrada / Saída / Lançar requisição / Gerar bloco) — nesta task apenas Entrada/Saída desabilitados com tooltip? NÃO: deixar os botões fora até a task que os implementa (YAGNI — cada task entrega algo completo).
- [ ] **Step 3: Rota em App.tsx** — substituir `<EmConstrucao modulo="Almoxarifado" fase={6} />` por `<Almoxarifado />` (import).
- [ ] **Step 4: Typecheck + preview** — `/almoxarifado` lista os ~196 materiais com saldos (EPIs com saldo do seed), filtro por categoria funciona, extrato de um EPI mostra a entrada de inventário.
- [ ] **Step 5: Commit** `"Fase 6: tela de estoque do almoxarifado (saldo, filtros, extrato)"`

---

### Task 4: Entrada de material (com vínculo opcional a pedido de compra)

**Files:**
- Modify: `src/pages/Almoxarifado.tsx` (formulário de entrada em painel/modal da aba Estoque)
- Modify: `src/pages/CompraForm.tsx` (seção de recebimento: nota orientando lançamento pelo Almoxarifado + link)

**Interfaces:**
- Consumes: trigger `trg_sincroniza_recebimento` (Task 1) — inserir movimento de entrada com `pedido_item_id` atualiza o pedido sozinho.
- Produces: fluxo de entrada usado também pela conferência tripla (Task 8).

- [ ] **Step 1: Formulário Entrada:**
  - Autocomplete de material por código/nome (padrão do autocomplete de serviços em CompraForm). Se não existir: botão "+ Criar material" inline — nome, unidade, categoria; código vem de `supabase.rpc('proximo_codigo_material', { p_obra: obraAtiva.id })`.
  - Campos: quantidade (obrigatória, > 0), observação.
  - Vínculo opcional: select "Pedido de compra" listando pedidos status `aprovado|enviado|recebido_parcial` (número + descrição) → ao escolher, select de itens do pedido (descrição + qtd pedida − recebida) → grava `pedido_item_id`.
  - Insert em `estoque_movimentos` tipo `entrada`; sucesso recarrega saldos.
- [ ] **Step 2: CompraForm** — na seção de recebimento, trocar o formulário manual por aviso: "Recebimento é lançado pela Entrada do Almoxarifado" + botão que navega para `/almoxarifado` (a exibição das quantidades recebidas por item permanece).
- [ ] **Step 3: Verificar integração** — criar entrada vinculada a um item de pedido de teste via preview; conferir por SQL que `quantidade_recebida` somou e que o status do pedido recalculou. Inativar o movimento (admin) e conferir reversão.
- [ ] **Step 4: Typecheck + commit** `"Fase 6: entrada de estoque com vinculo ao pedido (recebimento unico)"`

---

### Task 5: Saída avulsa + Lançar requisição preenchida

**Files:**
- Modify: `src/pages/Almoxarifado.tsx`

**Interfaces:**
- Consumes: trigger `trg_valida_movimento` (bloqueio de saldo, unidade/retirado_por obrigatórios).
- Produces: saídas com `requisicao_numero` — exibidas no extrato e na conferência.

- [ ] **Step 1: Formulário Saída avulsa:** material (autocomplete, mostra saldo atual), quantidade (max = saldo, validação client + erro do trigger tratado), unidade destino (select obrigatório), quem retirou (texto obrigatório), nº requisição (opcional, number), tarefa (select opcional das tarefas da unidade, padrão PendenciaForm), aplicação, observação.
- [ ] **Step 2: Lançar requisição:** cabeçalho (nº da folha obrigatório, unidade destino, quem retirou, data) + lista dinâmica de itens (autocomplete material + quantidade + aplicação; botão + item, padrão itens do pedido em CompraForm). Salvar = um insert por item, todos com o mesmo `requisicao_numero`/unidade/retirado_por. Erro de saldo em um item: transação client-side não existe — inserir sequencialmente e, se falhar, mostrar quais itens entraram e qual falhou (mensagem clara), sem duplicar os que já entraram.
- [ ] **Step 3: Verificar:** saída maior que o saldo → erro amigável ("Saldo insuficiente…"); requisição de 2 itens gera 2 saídas com mesmo nº; extrato mostra "Req. 00401" e destino.
- [ ] **Step 4: Typecheck + commit** `"Fase 6: saida de estoque e lancamento de requisicao preenchida"`

---

### Task 6: Gerar bloco de requisições em PDF

**Files:**
- Create: `src/lib/requisicoesPdf.ts`
- Modify: `src/pages/Almoxarifado.tsx` (aba Requisições)

**Interfaces:**
- Consumes: RPC `gerar_bloco_requisicoes(p_obra, p_qtd)`; tabela `requisicoes_blocos`.
- Produces: `gerarPdfBlocoRequisicoes(d: { obraNome: string; numeroInicial: number; numeroFinal: number }): void` — baixa o PDF.

- [ ] **Step 1: `requisicoesPdf.ts`** (jsPDF, padrão comprasPdf.ts): 2 requisições por página A4, cada uma com:
  - faixa de cabeçalho navy com "REQUISIÇÃO DE MATERIAL — ALMOXARIFADO" + identidade RT (padrão do cabeçalho de comprasPdf), linha "Empresa: RT Engenharia · Obra: {obraNome}" e "Nº REQUISIÇÃO {NNNNN}" (5 dígitos, fonte título, destaque terracota);
  - "Data da Solicitação: ____/____/______";
  - tabela de 7 linhas numeradas com colunas Descrição do Material | Código do produto | Quantidade | Aplicação (bordas cinza, linhas em branco pra preencher à mão);
  - bloco "AUTORIZAÇÃO (OBRIGATÓRIA) — Autorizo a retirada do material acima solicitado." com duas linhas de assinatura: "MESTRE DE OBRAS" e "ENGENHEIRO RESPONSÁVEL";
  - rodapé padrão RT (função `rodape()` de comprasPdf).
  - Nome do arquivo: `Requisicoes_{NNNNN}_a_{NNNNN}.pdf` (padrão do arquivo atual do Rodrigo).
- [ ] **Step 2: Aba Requisições:** input quantidade (1–500) + botão "Gerar bloco" → `supabase.rpc('gerar_bloco_requisicoes', ...)` → gera o PDF com a faixa retornada. Lista de blocos gerados (faixa, autor, data) com botão "⬇ PDF" que regenera o mesmo arquivo.
- [ ] **Step 3: Verificar:** gerar bloco de 2 → PDF com 1 página/2 fichas, números 00401–00402; sequência avança (próximo bloco começa em 00403); bloco listado com autor.
- [ ] **Step 4: Typecheck + commit** `"Fase 6: geracao de blocos de requisicao em PDF pre-numerados"`

---

### Task 7: Ferramentas — empréstimo, devolução e atraso

**Files:**
- Modify: `src/pages/Almoxarifado.tsx` (aba Ferramentas)

**Interfaces:**
- Consumes: `ferramentas`, `ferramenta_emprestimos`, índice `uniq_emprestimo_aberto`.
- Produces: contagem de atrasadas consumida pelo banner (Task 8).

- [ ] **Step 1: Aba Ferramentas:** carregar ferramentas + empréstimos abertos (`devolvida_em is null`). Estado por ferramenta: Disponível (verde) / Emprestada (chip amarelo: quem, desde quando) / **Em atraso** (chip vermelho: `retirada_em::date < hoje`, "há N dia(s)"). Filtro por estado + busca. Atrasadas sempre no topo.
- [ ] **Step 2: Emprestar** (ferramenta disponível): quem levou (obrigatório), unidade (opcional), observação → insert. Erro do índice único tratado ("já emprestada").
- [ ] **Step 3: Devolver** (1 clique + confirm): `update devolvida_em = now(), devolvida_recebida_por = perfil.id` no empréstimo aberto.
- [ ] **Step 4: Histórico** da ferramenta (clique): lista de empréstimos com retirado_por, retirada, devolução, quem recebeu.
- [ ] **Step 5: Cadastrar ferramenta** (botão +): nome, descrição.
- [ ] **Step 6: Verificar** fluxo completo no preview (emprestar → aparece emprestada → devolver → histórico) e atraso via SQL (retroagir `retirada_em` de um empréstimo de teste 1 dia e conferir chip; desfazer).
- [ ] **Step 7: Typecheck + commit** `"Fase 6: ferramentas com emprestimo, devolucao e atraso"`

---

### Task 8: Banner no dashboard + conferência tripla no pedido

**Files:**
- Modify: `src/pages/Dashboard.tsx` (banner, padrão do banner de RDOs não assinados já existente no arquivo)
- Modify: `src/pages/CompraForm.tsx` (painel de conferência tripla no detalhe do pedido)

**Interfaces:**
- Consumes: empréstimos atrasados (Task 7); `estoque_movimentos.pedido_item_id` (Task 4); dados de cotação vencedora e NF já existentes em CompraForm.

- [ ] **Step 1: Banner dashboard:** query de empréstimos abertos com `retirada_em::date < hoje` (join ferramentas p/ nome). Se N > 0, banner (mesma classe visual do banner de RDO): "🔧 N ferramenta(s) não devolvida(s): Furadeira 01 (João, há 2 dias)…" — clicável → `/almoxarifado`. Visível para admin e equipe com módulo; cliente não vê.
- [ ] **Step 2: Conferência tripla em CompraForm:** para pedidos em status `recebido_parcial|recebido_total|conferido_nf|encerrado`, painel por item com 3 colunas: **Aprovado** (qtd pedida × preço unitário vencedor), **Almoxarifado** (soma das entradas vinculadas ao item — query em `estoque_movimentos`), **NF** (qtd/valor conferidos — dados já existentes). Divergência (≠ entre quaisquer colunas, tolerância 0) → linha com fundo `#fdeaea` e ícone ⚠ + legenda do que diverge.
- [ ] **Step 3: Verificar** com o pedido real em andamento (somente leitura — não alterar os dados do Rodrigo) e/ou pedido de teste.
- [ ] **Step 4: Typecheck + commit** `"Fase 6: banner de ferramenta em atraso e conferencia tripla no pedido"`

---

### Task 9: Documentação, verificação final e entrega

**Files:**
- Create: `docs/fase6_almoxarifado.md`
- Modify: `CLAUDE.md` (§0: Almoxarifado entregue, aguardando teste de campo; rodapé de versão)
- Modify: memória `project_estado_fases.md`

- [ ] **Step 1: Roteiro de teste guiado** no docs (CLAUDE.md §7 passo 5): conferir estoque seedado, dar entrada vinculada ao pedido real, gerar bloco 00401+, lançar uma folha preenchida, emprestar/devolver ferramenta, ver banner de atraso, conferência tripla.
- [ ] **Step 2: Checklist de pronto (§8):** mobile + desktop no preview (resize_window), papéis (cliente não vê módulo — testar RLS por SQL com role anon/cliente se houver usuário de teste), rastreabilidade (autor/data em todos os inserts).
- [ ] **Step 3: Verificação final:** typecheck limpo, preview sem erros de console, push.
- [ ] **Step 4: Commit + push** `"Fase 6: docs do Almoxarifado e atualizacao do CLAUDE.md"`

---

## Self-review (executado na escrita)

- **Cobertura da spec:** estoque/saldo/mínimo (T1–T3), entrada única (T4), saída+requisição (T5), blocos PDF (T6), ferramentas+atraso (T7), banner+conferência tripla (T8), seeds (T2), docs/pronto (T9). Lacuna registrada: saldos de junho (migração futura, fora deste plano).
- **Placeholders:** nenhum "TBD"; único pendente é a lacuna de dados do Rodrigo, explícita.
- **Consistência de nomes:** `estoque_saldos`, `saldo_material`, `gerar_bloco_requisicoes`, `proximo_codigo_material`, tipos TS — conferidos entre tasks.
