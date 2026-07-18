# Produção própria — Excluir parede e redimensionar rótulo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Na aba Plantas de Produção própria, permitir excluir (inativar) uma parede cadastrada por engano e redimensionar o rótulo (nome) de cada parede na planta clicável.

**Architecture:** Duas mudanças independentes, sem RLS/trigger/RPC novos. Excluir é um `UPDATE producao_paredes SET ativo = false` direto, coberto pela policy de SELECT que já existe. Redimensionar adiciona uma coluna `rotulo_escala` em `producao_paredes` e estende o componente `PlantaClicavel` (já existente, cobre mover/girar o rótulo) para também aplicar uma escala via `transform: scale()`, ajustada por botões `A−`/`A+` na lista de paredes.

**Tech Stack:** PostgreSQL (Supabase) pra migração; React 19 + TypeScript + Vite 6 pro resto. Sem framework de teste automatizado neste projeto — verificação via `npm run build` + navegador, mesmo padrão usado em todas as fases anteriores.

## Global Constraints

- **Inativação lógica, nunca `DELETE`** — segue `CLAUDE.md` §6.4 ("nada se apaga, tudo se inativa"). Exclusão de parede é sempre `UPDATE ... SET ativo = false`.
- **Nenhuma mudança de RLS necessária** — a policy `prod_paredes_select` já tem `(ativo AND meu_papel() IN ('admin','equipe')) OR pode_editar_medicoes()`, então quem edita continua vendo a parede inativa se precisar; a policy `prod_paredes_update` não exige `ativo = true` no `WITH CHECK`, então o `UPDATE` de inativação passa sem trigger de bug de RLS (mesma lição do achado crítico de 13/07/2026).
- **Permissão:** as duas ações usam a permissão já existente para editar parede, `pode_editar_medicoes()` (admin ou equipe com o módulo liberado) — não é ação exclusiva de admin.
- **Sem `window.confirm`/`window.prompt` nativos** (`docs/auditoria-geral-2026-07-17.md`) — a confirmação de exclusão usa `useConfirmDialog` (`src/components/ConfirmDialogContext.ts`), já usado em Almoxarifado/Contratos/Efetivo/FVS/Usuários.
- **Faixa da escala do rótulo:** `0.5` a `2.0`, passo `0.1`, padrão `1.0` (tamanho atual, sem mudança visual para paredes não ajustadas).
- Spec de referência: `docs/superpowers/specs/2026-07-18-producao-excluir-redimensionar-parede-design.md`.

---

## Arquivos afetados

- Criar: `supabase/migrations/20260718_producao_paredes_rotulo_escala.sql`
- Modificar: `src/lib/supabase.ts` — `ProducaoParede` ganha `rotulo_escala: number`.
- Modificar: `src/components/PlantaClicavel.tsx` — `RotuloAjustado` ganha `escala`; renderização aplica `scale()`.
- Modificar: `src/pages/Producao.tsx` — componente `Plantas`: botão "Excluir" na lista de paredes (com `useConfirmDialog`) e controles `A−`/`A+` de escala.
- Modificar: `src/pages/Producao.module.css` — classes `.btnExcluir` e `.escalaControle`/`.btnEscala`.

---

### Task 1: Migração — coluna `rotulo_escala`

**Files:**
- Create: `supabase/migrations/20260718_producao_paredes_rotulo_escala.sql`

**Interfaces:**
- Consumes: tabela `producao_paredes` (`supabase/migrations/20260718_producao_plantas_paredes.sql`).
- Produces: coluna `producao_paredes.rotulo_escala NUMERIC(3,2)` — consumida pela Task 2 (tipo TypeScript) e Task 4 (UI).

- [ ] **Step 1: Criar a migração**

```sql
-- Tamanho do rótulo (nome) de cada parede na planta clicável, ajustável por
-- botões A-/A+ na aba Plantas — resolve nomes de parede que não cabem no
-- espaço disponível mesmo depois de arrastados/girados. Coluna opcional na
-- prática (tem padrão): parede sem ajuste continua no tamanho atual.
-- Pedido do Rodrigo em teste real em 18/07/2026 — ver
-- docs/superpowers/specs/2026-07-18-producao-excluir-redimensionar-parede-design.md

ALTER TABLE producao_paredes
  ADD COLUMN rotulo_escala NUMERIC(3,2) NOT NULL DEFAULT 1
    CHECK (rotulo_escala >= 0.5 AND rotulo_escala <= 2.0);
```

- [ ] **Step 2: Aplicar a migração e verificar**

Aplicar via MCP do Supabase (`apply_migration`) ou `supabase db push`, mesmo fluxo já usado nas migrações anteriores deste projeto. Confirmar com uma consulta:

```sql
SELECT column_name, data_type, numeric_precision, numeric_scale, column_default
FROM information_schema.columns
WHERE table_name = 'producao_paredes' AND column_name = 'rotulo_escala';
-- Esperado: 1 linha, data_type = numeric, column_default = 1.

SELECT rotulo_escala FROM producao_paredes LIMIT 3;
-- Esperado: paredes já existentes voltam com rotulo_escala = 1 (padrão aplicado
-- retroativamente pelo ALTER TABLE).
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260718_producao_paredes_rotulo_escala.sql
git commit -m "feat: coluna de escala do rótulo da parede em produção própria"
```

---

### Task 2: Tipo TypeScript + `PlantaClicavel` — renderizar escala

**Files:**
- Modify: `src/lib/supabase.ts:199-205` (interface `ProducaoParede`)
- Modify: `src/components/PlantaClicavel.tsx`

**Interfaces:**
- Consumes: coluna `rotulo_escala` da Task 1.
- Produces: `ProducaoParede.rotulo_escala: number`; `RotuloAjustado.escala: number` — consumidos pela Task 4 (`Producao.tsx`, componente `Plantas`).

- [ ] **Step 1: Adicionar o campo ao tipo `ProducaoParede`**

Em `src/lib/supabase.ts`, localizar (linhas 199-205):

```ts
export interface ProducaoParede {
  id: string; planta_id: string; nome: string
  pos_x: number; pos_y: number; largura: number; altura_px: number
  meta_alvenaria_m2: number | null; meta_reboco_a_m2: number | null; meta_reboco_b_m2: number | null
  rotulo_pos_x: number | null; rotulo_pos_y: number | null; rotulo_rotacao: number
  ativo: boolean; criado_por: string; criado_em: string
}
```

Substituir por:

```ts
export interface ProducaoParede {
  id: string; planta_id: string; nome: string
  pos_x: number; pos_y: number; largura: number; altura_px: number
  meta_alvenaria_m2: number | null; meta_reboco_a_m2: number | null; meta_reboco_b_m2: number | null
  rotulo_pos_x: number | null; rotulo_pos_y: number | null; rotulo_rotacao: number; rotulo_escala: number
  ativo: boolean; criado_por: string; criado_em: string
}
```

- [ ] **Step 2: Estender `RotuloAjustado` e o cálculo do rótulo padrão**

Em `src/components/PlantaClicavel.tsx`, localizar (linhas 7 e 19-27):

```ts
export type RotuloAjustado = { pos_x: number; pos_y: number; rotacao: number }

const LEVANTA_ROTULO_PADRAO = 3

function rotuloPadrao(parede: ProducaoParede): RotuloAjustado {
  return {
    pos_x: parede.rotulo_pos_x ?? parede.pos_x,
    pos_y: parede.rotulo_pos_y ?? Math.max(0, parede.pos_y - LEVANTA_ROTULO_PADRAO),
    rotacao: parede.rotulo_rotacao,
  }
}
```

Substituir por:

```ts
export type RotuloAjustado = { pos_x: number; pos_y: number; rotacao: number; escala: number }

const LEVANTA_ROTULO_PADRAO = 3

function rotuloPadrao(parede: ProducaoParede): RotuloAjustado {
  return {
    pos_x: parede.rotulo_pos_x ?? parede.pos_x,
    pos_y: parede.rotulo_pos_y ?? Math.max(0, parede.pos_y - LEVANTA_ROTULO_PADRAO),
    rotacao: parede.rotulo_rotacao,
    escala: parede.rotulo_escala,
  }
}
```

- [ ] **Step 3: Aplicar a escala no `transform` do rótulo**

No mesmo arquivo, localizar dentro do `return` (por volta da linha 168):

```tsx
            style={{ left: `${rotulo.pos_x}%`, top: `${rotulo.pos_y}%`, transform: `rotate(${rotulo.rotacao}deg)` }}
```

Substituir por:

```tsx
            style={{ left: `${rotulo.pos_x}%`, top: `${rotulo.pos_y}%`, transform: `rotate(${rotulo.rotacao}deg) scale(${rotulo.escala})` }}
```

`transform-origin: left center` já está definido em `.rotulo` no CSS module (`PlantaClicavel.module.css`) — a escala parte do mesmo ponto de ancoragem do giro, sem exigir mudança no CSS.

- [ ] **Step 4: Build**

```bash
npm run build
```

Esperado: build sem erros de tipo. `arrastandoRotulo`/`girandoRotulo` (`aoMover`, `aoSoltar` em `PlantaClicavel.tsx`) continuam funcionando sem alteração — eles só leem/escrevem `pos_x`/`pos_y`/`rotacao` a partir de `rotuloAtual(parede)`, que agora inclui `escala` automaticamente por já vir de `rotuloPadrao`/`rotulosLocais`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/supabase.ts src/components/PlantaClicavel.tsx
git commit -m "feat: componente da planta clicável aplica escala do rótulo"
```

---

### Task 3: Excluir parede — aba Plantas

**Files:**
- Modify: `src/pages/Producao.tsx`
- Modify: `src/pages/Producao.module.css`

**Interfaces:**
- Consumes: `useConfirmDialog` (`src/components/ConfirmDialogContext.ts:22-26`, retorna `{ confirmar }` com assinatura `confirmar(opcoes: DialogOptions) => Promise<boolean>`); tabela `producao_paredes_progresso` (`src/lib/supabase.ts:206-210`, campo `produzido_m2: number`); função `carregar()` já existente no componente `Plantas` (`src/pages/Producao.tsx:664-672`).
- Produces: função `excluirParede(parede: ProducaoParede): Promise<void>` — não é consumida por nenhuma outra task deste plano.

- [ ] **Step 1: Importar `useConfirmDialog`**

Em `src/pages/Producao.tsx`, localizar a linha 21:

```ts
import PlantaClicavel, { type ZonaDesenhada, type RotuloAjustado } from "../components/PlantaClicavel";
```

Adicionar logo abaixo:

```ts
import { useConfirmDialog } from "../components/ConfirmDialogContext";
```

- [ ] **Step 2: Obter `confirmar` dentro do componente `Plantas`**

Localizar o início da função `Plantas` (`src/pages/Producao.tsx:646-647`):

```ts
function Plantas() {
  const { obraAtiva } = useObra();
```

Substituir por:

```ts
function Plantas() {
  const { obraAtiva } = useObra();
  const { confirmar } = useConfirmDialog();
```

- [ ] **Step 3: Escrever `excluirParede`**

Logo após a função `salvarEdicaoParede` (que termina na linha 774 com `}`, antes do `return (` da linha 776), adicionar:

```ts
  async function excluirParede(parede: ProducaoParede) {
    const { data } = await supabase
      .from("producao_paredes_progresso")
      .select("produzido_m2")
      .eq("parede_id", parede.id);
    const total = (data ?? []).reduce((soma, linha) => soma + Number(linha.produzido_m2), 0);
    const mensagem = total > 0
      ? `Esta parede já tem ${total.toFixed(2)} m² de produção lançada (somando todos os sobrados). O histórico continua preservado, mas a parede some da lista e da planta de lançamento.`
      : "A parede some da lista e da planta de lançamento. Nenhuma produção foi lançada nela ainda.";
    if (!await confirmar({ titulo: "Excluir parede", mensagem, confirmarTexto: "Excluir parede", perigoso: true })) return;
    const { error } = await supabase.from("producao_paredes").update({ ativo: false }).eq("id", parede.id);
    if (error) { setMsg({ tipo: "erro", texto: error.message }); return; }
    await carregar();
  }
```

- [ ] **Step 4: Adicionar o botão "Excluir" na lista de paredes**

Localizar (`src/pages/Producao.tsx:806-816`):

```tsx
            <div className={styles.lista}>
              {paredesDaPlanta.map((p) => (
                <div className={styles.linha} key={p.id}>
                  <strong>{p.nome}</strong>
                  <div className={styles.meta}>
                    {p.meta_alvenaria_m2 != null && `Alvenaria: ${p.meta_alvenaria_m2.toFixed(2)} m²`}
                    {p.meta_reboco_a_m2 != null && ` · Reboco A: ${p.meta_reboco_a_m2.toFixed(2)} m²`}
                    {p.meta_reboco_b_m2 != null && ` · Reboco B: ${p.meta_reboco_b_m2.toFixed(2)} m²`}
                  </div>
                  <button className={styles.btnSec} onClick={() => abrirEdicao(p)}>Editar</button>
                </div>
              ))}
            </div>
```

Substituir por:

```tsx
            <div className={styles.lista}>
              {paredesDaPlanta.map((p) => (
                <div className={styles.linha} key={p.id}>
                  <strong>{p.nome}</strong>
                  <div className={styles.meta}>
                    {p.meta_alvenaria_m2 != null && `Alvenaria: ${p.meta_alvenaria_m2.toFixed(2)} m²`}
                    {p.meta_reboco_a_m2 != null && ` · Reboco A: ${p.meta_reboco_a_m2.toFixed(2)} m²`}
                    {p.meta_reboco_b_m2 != null && ` · Reboco B: ${p.meta_reboco_b_m2.toFixed(2)} m²`}
                  </div>
                  <button className={styles.btnSec} onClick={() => abrirEdicao(p)}>Editar</button>
                  <button className={styles.btnExcluir} onClick={() => excluirParede(p)}>Excluir</button>
                </div>
              ))}
            </div>
```

- [ ] **Step 5: Adicionar o estilo `.btnExcluir`**

Em `src/pages/Producao.module.css`, ao final do arquivo (linha 2), adicionar:

```css
.btnExcluir{background:none;border:1.5px solid #a33030;color:#a33030;border-radius:var(--radius-sm);font-size:12px;font-weight:600;padding:4px 10px;cursor:pointer}
```

(Mesmo estilo já usado em `.btnInativar` de `src/pages/Almoxarifado.module.css:299-308`, mantendo a identidade visual consistente entre módulos.)

- [ ] **Step 6: Build**

```bash
npm run build
```

Esperado: build sem erros.

- [ ] **Step 7: Teste manual no navegador**

1. Rodar `npm run dev`, abrir Produção própria → aba Plantas → um pavimento com paredes cadastradas.
2. Clicar "Excluir" numa parede sem produção lançada ainda → confirmar no diálogo → parede some da lista e da planta.
3. Reabrir a aba Lançamentos do mesmo pavimento → confirmar que a parede excluída não aparece mais para seleção.
4. Cadastrar uma parede nova, lançar alguma produção nela (aba Lançamentos), depois excluir essa parede na aba Plantas → confirmar que a mensagem do diálogo cita o m² já produzido, e que a exclusão ainda é permitida.

- [ ] **Step 8: Commit**

```bash
git add src/pages/Producao.tsx src/pages/Producao.module.css
git commit -m "feat: permite excluir parede cadastrada por engano"
```

---

### Task 4: Redimensionar rótulo — botões A−/A+ na aba Plantas

**Files:**
- Modify: `src/pages/Producao.tsx`
- Modify: `src/pages/Producao.module.css`

**Interfaces:**
- Consumes: `ProducaoParede.rotulo_escala` (Task 2); `setParedes` (state já existente no componente `Plantas`, `src/pages/Producao.tsx:649`).
- Produces: função `ajustarEscalaRotulo(parede: ProducaoParede, delta: number): Promise<void>` — não é consumida por nenhuma outra task deste plano.

- [ ] **Step 1: Escrever `ajustarEscalaRotulo`**

Logo após a função `excluirParede` escrita na Task 3 (antes do `return (`), adicionar:

```ts
  async function ajustarEscalaRotulo(parede: ProducaoParede, delta: number) {
    const atual = parede.rotulo_escala ?? 1;
    const nova = Math.min(2, Math.max(0.5, Math.round((atual + delta) * 10) / 10));
    if (nova === atual) return;
    const { error } = await supabase.from("producao_paredes").update({ rotulo_escala: nova }).eq("id", parede.id);
    if (error) { setMsg({ tipo: "erro", texto: error.message }); return; }
    setParedes((lista) => lista.map((item) => (item.id === parede.id ? { ...item, rotulo_escala: nova } : item)));
  }
```

- [ ] **Step 2: Adicionar os botões `A−`/`A+` na lista de paredes**

Localizar o trecho já modificado pela Task 3 (`src/pages/Producao.tsx`, dentro do `.map` de `paredesDaPlanta`):

```tsx
                  <button className={styles.btnSec} onClick={() => abrirEdicao(p)}>Editar</button>
                  <button className={styles.btnExcluir} onClick={() => excluirParede(p)}>Excluir</button>
                </div>
```

Substituir por:

```tsx
                  <div className={styles.escalaControle}>
                    <button className={styles.btnEscala} onClick={() => ajustarEscalaRotulo(p, -0.1)} aria-label="Diminuir nome da parede">A−</button>
                    <span>{Math.round(p.rotulo_escala * 100)}%</span>
                    <button className={styles.btnEscala} onClick={() => ajustarEscalaRotulo(p, 0.1)} aria-label="Aumentar nome da parede">A+</button>
                  </div>
                  <button className={styles.btnSec} onClick={() => abrirEdicao(p)}>Editar</button>
                  <button className={styles.btnExcluir} onClick={() => excluirParede(p)}>Excluir</button>
                </div>
```

- [ ] **Step 3: Adicionar os estilos `.escalaControle`/`.btnEscala`**

Em `src/pages/Producao.module.css`, logo após a linha `.btnExcluir{...}` adicionada na Task 3, adicionar:

```css
.escalaControle{display:flex;align-items:center;gap:4px;font-size:12px;color:var(--cinza-600)}
.btnEscala{border:1.5px solid var(--cinza-200);background:var(--branco);color:var(--navy);border-radius:var(--radius-sm);width:24px;height:24px;font-weight:700;font-size:13px;line-height:1;cursor:pointer;padding:0}
```

- [ ] **Step 4: Build**

```bash
npm run build
```

Esperado: build sem erros.

- [ ] **Step 5: Teste manual no navegador**

1. Rodar `npm run dev`, abrir Produção própria → aba Plantas → um pavimento com paredes cadastradas.
2. Clicar `A+` várias vezes numa parede → confirmar que o texto do rótulo cresce na planta em tempo real, e que o percentual ao lado dos botões sobe de 10 em 10 (110%, 120%...) até parar em 200%.
3. Clicar `A−` até o mínimo → confirmar que para em 50% e não passa disso.
4. Recarregar a página (F5) → confirmar que o tamanho ajustado persiste (veio do banco, não só do estado local).
5. Confirmar que arrastar/girar o rótulo dessa mesma parede continua funcionando normalmente depois do ajuste de escala.

- [ ] **Step 6: Commit**

```bash
git add src/pages/Producao.tsx src/pages/Producao.module.css
git commit -m "feat: permite redimensionar o nome da parede na planta clicável"
```

---

### Task 5: Verificação final

**Files:** nenhum (apenas verificação)

- [ ] **Step 1: Build limpo**

```bash
rm -rf node_modules/.vite && npm run build
```

Esperado: sem erros.

- [ ] **Step 2: Roteiro de teste guiado (para o Rodrigo)**

1. Produção própria → Plantas → escolher um pavimento com paredes.
2. Cadastrar uma parede de teste, depois excluí-la sem ter lançado nada — confirmar que some sem aviso de produção.
3. Cadastrar outra parede de teste, lançar uma produção pequena nela (aba Lançamentos), voltar em Plantas e excluí-la — confirmar que o aviso cita o m² lançado e ainda permite excluir.
4. Numa parede real já cadastrada, ajustar o tamanho do nome com `A+`/`A−` até caber no espaço da planta, testar em conjunto com arrastar/girar.
5. Conferir no celular (toque) que os botões `A−`/`A+` e `Excluir` são fáceis de acertar sem clicar em cima da faixa da parede ao lado.
