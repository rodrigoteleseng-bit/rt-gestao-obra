# Gestão de Efetivo (Fase 7) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cadastro nominal de trabalhadores com chamada diária de presença, substituindo o lançamento manual de efetivo por função/quantidade no RDO — o RDO passa a ler a chamada do dia automaticamente.

**Architecture:** Mesmo padrão das fases anteriores — Supabase (Postgres + RLS) com migração versionada; React + Vite com CSS Modules; nenhuma dependência nova. O resumo de presença é convertido para o mesmo formato que `RdoEfetivo` já usa em `RDOForm.tsx` e `rdoPdf.ts`, para reaproveitar a renderização existente sem tocar nesses dois arquivos.

**Tech Stack:** React 18 + Vite + TypeScript, Supabase JS, CSS Modules.

**Spec:** `docs/superpowers/specs/2026-07-12-fase7-efetivo-design.md` (aprovada 12/07/2026).

## Global Constraints

- Paleta oficial (tokens.css): navy `#1A3248`, terracota `#C49A7A`, `--navy-light` `#3A7CA5`, `--erro`, `--sucesso`, `--alerta`, `--cinza-*`. Nunca hex novo sem citar a skill `rt-manual-marca` (CLAUDE.md §1).
- Rastreabilidade: todo registro grava `criado_por` (default `auth.uid()`, NUNCA enviado manualmente pelo client — a policy de INSERT exige `criado_por = auth.uid()`) e `criado_em` (CLAUDE.md §6). Nada se apaga — soft delete via `ativo` em `trabalhadores`.
- RLS obrigatória: cliente NÃO vê o módulo. Escrita exige `pode_editar_efetivo()`.
- O enum `modulo_app` **já contém** `'efetivo'` no banco e em `src/lib/supabase.ts` — NÃO recriar. Checkbox em Usuários, item de menu em `Layout.tsx` (`/efetivo`, sob a seção "RDO") e sub-card em `Dashboard.tsx` **já existem**, apontando hoje para `<EmConstrucao modulo="Gestão de Efetivo" fase={7} />` em `App.tsx:60`.
- `Rdo.data` é uma string `YYYY-MM-DD`. `efetivo_chamadas.data` deve usar o mesmo formato para comparação direta por igualdade de string.
- Reaproveitar `dataHoje()` e `dataLocalISO()` de `src/lib/almoxarifado.ts` (já corrigidos para fuso local, não UTC) em vez de duplicar lógica de data.
- Typecheck: `$env:Path = "C:\Program Files\nodejs;" + $env:Path; npx tsc --noEmit -p tsconfig.json` — deve passar limpo antes de cada commit.
- Supabase project_id: `yxshldsfmbmbzdkcymca`. Migrações aplicadas via MCP `apply_migration` E salvas em `supabase/migrations/`.

---

### Task 1: Migração do banco (tabelas, RLS, função de permissão)

**Files:**
- Create: `supabase/migrations/20260712_fase7_efetivo.sql`

**Interfaces:**
- Produces: tabelas `trabalhadores`, `efetivo_chamadas`, `efetivo_presencas`; função `pode_editar_efetivo()`.

- [ ] **Step 1: Escrever a migração**

```sql
-- ============================================================
-- Fase 7 — Gestão de Efetivo | RT Engenharia
-- Spec: docs/superpowers/specs/2026-07-12-fase7-efetivo-design.md
-- ============================================================

CREATE TABLE trabalhadores (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  obra_id        UUID NOT NULL REFERENCES obras(id) ON DELETE CASCADE,
  nome           TEXT NOT NULL,
  funcao         TEXT NOT NULL,
  empresa        TEXT,
  data_admissao  DATE,
  ativo          BOOLEAN NOT NULL DEFAULT true,
  criado_por     UUID NOT NULL DEFAULT auth.uid() REFERENCES perfis_usuario(id),
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_trabalhadores_obra ON trabalhadores(obra_id) WHERE ativo;

CREATE TABLE efetivo_chamadas (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  obra_id     UUID NOT NULL REFERENCES obras(id) ON DELETE CASCADE,
  data        DATE NOT NULL,
  criado_por  UUID NOT NULL DEFAULT auth.uid() REFERENCES perfis_usuario(id),
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (obra_id, data)
);

CREATE TABLE efetivo_presencas (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chamada_id      UUID NOT NULL REFERENCES efetivo_chamadas(id) ON DELETE CASCADE,
  trabalhador_id  UUID NOT NULL REFERENCES trabalhadores(id),
  presente        BOOLEAN NOT NULL,
  criado_por      UUID NOT NULL DEFAULT auth.uid() REFERENCES perfis_usuario(id),
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (chamada_id, trabalhador_id)
);
CREATE INDEX idx_presencas_chamada ON efetivo_presencas(chamada_id);

-- ---------- permissão ----------
CREATE OR REPLACE FUNCTION pode_editar_efetivo()
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT meu_papel() = 'admin'
    OR (meu_papel() = 'equipe' AND 'efetivo' = ANY(meus_modulos()))
$$;

-- ---------- RLS ----------
ALTER TABLE trabalhadores       ENABLE ROW LEVEL SECURITY;
ALTER TABLE efetivo_chamadas    ENABLE ROW LEVEL SECURITY;
ALTER TABLE efetivo_presencas   ENABLE ROW LEVEL SECURITY;

-- Leitura: admin e equipe (qualquer módulo — quem lê RDO precisa ver o resumo
-- de presença sem precisar do módulo 'efetivo' habilitado). Cliente não vê.
CREATE POLICY trab_select ON trabalhadores FOR SELECT
  USING (ativo = true AND meu_papel() IN ('admin', 'equipe'));
CREATE POLICY trab_insert ON trabalhadores FOR INSERT
  WITH CHECK (pode_editar_efetivo() AND criado_por = auth.uid());
CREATE POLICY trab_update ON trabalhadores FOR UPDATE
  USING (pode_editar_efetivo()) WITH CHECK (pode_editar_efetivo());

CREATE POLICY chamada_select ON efetivo_chamadas FOR SELECT
  USING (meu_papel() IN ('admin', 'equipe'));
CREATE POLICY chamada_insert ON efetivo_chamadas FOR INSERT
  WITH CHECK (pode_editar_efetivo() AND criado_por = auth.uid());

CREATE POLICY presenca_select ON efetivo_presencas FOR SELECT
  USING (meu_papel() IN ('admin', 'equipe'));
CREATE POLICY presenca_insert ON efetivo_presencas FOR INSERT
  WITH CHECK (pode_editar_efetivo() AND criado_por = auth.uid());
CREATE POLICY presenca_update ON efetivo_presencas FOR UPDATE
  USING (pode_editar_efetivo()) WITH CHECK (pode_editar_efetivo());
```

- [ ] **Step 2: Aplicar via MCP** `apply_migration` (project_id `yxshldsfmbmbzdkcymca`, name `fase7_efetivo`) com o SQL acima.

- [ ] **Step 3: Verificar no banco**

Run (execute_sql): `SELECT count(*) FROM trabalhadores;` → Expected: `0` (tabela vazia, sem erro).
Run: `SELECT pode_editar_efetivo();` (como usuário anônimo/sem sessão — ou apenas confirme que a função existe) via `SELECT proname FROM pg_proc WHERE proname = 'pode_editar_efetivo';` → Expected: 1 linha.
Run: `SELECT tablename, rowsecurity FROM pg_tables WHERE tablename IN ('trabalhadores','efetivo_chamadas','efetivo_presencas');` → Expected: `rowsecurity = true` nas 3.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260712_fase7_efetivo.sql
git commit -m "Fase 7: banco da Gestao de Efetivo (trabalhadores, chamada, RLS)"
```

---

### Task 2: Tipos TS + tela de Trabalhadores (cadastro)

**Files:**
- Modify: `src/lib/supabase.ts` (adicionar tipos ao final da seção de tipos)
- Create: `src/pages/Efetivo.tsx`, `src/pages/Efetivo.module.css`
- Modify: `src/App.tsx:60` (trocar `EmConstrucao` por `Efetivo`)

**Interfaces:**
- Produces (em `supabase.ts`):

```ts
export interface Trabalhador {
  id: string
  obra_id: string
  nome: string
  funcao: string
  empresa: string | null
  data_admissao: string | null
  ativo: boolean
  criado_por: string
  criado_em: string
}
export interface EfetivoChamada {
  id: string
  obra_id: string
  data: string
  criado_por: string
  criado_em: string
}
export interface EfetivoPresenca {
  id: string
  chamada_id: string
  trabalhador_id: string
  presente: boolean
  criado_por: string
  criado_em: string
}
```

- Página `Efetivo.tsx` com abas internas (estado local `aba: 'trabalhadores' | 'chamada'`, mesmo padrão de `Almoxarifado.tsx`): esta task entrega a aba **Trabalhadores**; a aba **Chamada** é um placeholder `<p>Em breve.</p>` até a Task 3.

- [ ] **Step 1: Tipos em `supabase.ts`** (bloco acima, ao final da seção de tipos existente).

- [ ] **Step 2: Página `Efetivo.tsx` — aba Trabalhadores:**
  - Guard de cliente: `if (perfil?.papel === 'cliente') return <div className={styles.page}><p className={styles.vazio}>Módulo de uso interno da equipe.</p></div>` (padrão de `Pendencias.tsx`).
  - `podeEditar = perfil?.papel === 'admin' || temModulo('efetivo')`.
  - Carrega `trabalhadores`: `supabase.from('trabalhadores').select('*').eq('obra_id', obraAtiva.id).eq('ativo', true).order('nome')`.
  - Lista: nome, função, empresa (se houver), data de admissão formatada (`slice(8,10)/slice(5,7)/slice(0,4)`), botão "Inativar" (só se `podeEditar`, com `window.confirm`, `update({ativo:false})`, recarrega).
  - Busca por texto (nome/função) e filtro por função (select com as funções distintas já cadastradas).
  - Formulário "+ Novo trabalhador" (painel inline, mesmo padrão de `PainelEntrada` em `Almoxarifado.tsx`): nome (obrigatório), função (input com `<datalist>` das funções já usadas — sem tabela travada), empresa (opcional), data de admissão (input `type="date"`, opcional). Insert em `trabalhadores` **sem enviar `criado_por`** (a policy exige `= auth.uid()`, o default cobre isso).
  - Mensagens de erro/sucesso no mesmo padrão dos outros formulários do app (`{tipo: 'ok'|'erro', texto: string}`).

- [ ] **Step 3: Rota em `App.tsx`** — trocar `<EmConstrucao modulo="Gestão de Efetivo" fase={7} />` por `<Efetivo />` (import no topo do arquivo).

- [ ] **Step 4: Typecheck** — `$env:Path = "C:\Program Files\nodejs;" + $env:Path; npx tsc --noEmit -p tsconfig.json` deve passar limpo.

- [ ] **Step 5: Commit**

```bash
git add src/lib/supabase.ts src/pages/Efetivo.tsx src/pages/Efetivo.module.css src/App.tsx
git commit -m "Fase 7: cadastro de trabalhadores (aba Trabalhadores do Efetivo)"
```

---

### Task 3: Chamada diária de presença

**Files:**
- Modify: `src/pages/Efetivo.tsx`, `src/pages/Efetivo.module.css`

**Interfaces:**
- Consumes: `trabalhadores` (Task 2); `EfetivoChamada`, `EfetivoPresenca` (Task 2).
- Produces: fluxo de chamada consumido pela Task 4 (RDOForm) e Task 5 (Dashboard) via leitura direta de `efetivo_chamadas`/`efetivo_presencas`.

- [ ] **Step 1: Aba Chamada — carregar/criar:**
  - Estado: `dataChamada` (string `YYYY-MM-DD`, padrão `dataHoje()` de `../lib/almoxarifado`), `presencas: Map<string /*trabalhador_id*/, boolean>`.
  - Ao mudar `dataChamada` (ou montar), buscar: `supabase.from('efetivo_chamadas').select('*').eq('obra_id', obraAtiva.id).eq('data', dataChamada).maybeSingle()`.
    - Se existe: buscar `efetivo_presencas` dessa `chamada_id` e montar o `Map` a partir dos registros salvos.
    - Se não existe: montar o `Map` com todos os `trabalhadores` ativos como `presente = true` por padrão (nada é gravado ainda — só ao salvar).
  - Input de data no topo (`type="date"`, `max` = hoje — não permite chamada futura).

- [ ] **Step 2: Lista de trabalhadores com toggle:**
  - Para cada trabalhador ativo: nome + função, botão/toggle Presente (verde, `var(--sucesso)`) / Ausente (vermelho, `var(--erro)`), alterna o valor no `Map` local (sem gravar ainda).
  - Contador no topo: `"${presentesCount} de ${trabalhadores.length} presentes"`.
  - Se não houver nenhum trabalhador cadastrado: mensagem "Nenhum trabalhador cadastrado. Vá para a aba Trabalhadores." com botão que troca a aba.

- [ ] **Step 3: Salvar chamada:**
  - Se a chamada da data não existe: `insert` em `efetivo_chamadas` (`obra_id`, `data` — sem `criado_por` manual) `.select().single()` para obter o `id`; depois `insert` em lote (`.insert(array)`) em `efetivo_presencas` uma linha por trabalhador do `Map` (`chamada_id`, `trabalhador_id`, `presente`).
  - Se já existe: para cada trabalhador, `upsert` em `efetivo_presencas` com `onConflict: 'chamada_id,trabalhador_id'` (a constraint `UNIQUE (chamada_id, trabalhador_id)` da Task 1 viabiliza isso).
  - Tratar erro do Postgres com mensagem amigável (`error.message`, já em português quando é constraint) e mostrar sucesso "Chamada de {data formatada} salva: X de Y presentes." ao concluir.

- [ ] **Step 4: Verificar via SQL (sem tocar dados reais):** usar transação com `ROLLBACK` (ToolSearch → `execute_sql`, project_id `yxshldsfmbmbzdkcymca`) simulando: `BEGIN;` inserir uma chamada de teste para uma data fictícia distante (ex. `'2020-01-01'`) + 1 presença; confirmar leitura; `ROLLBACK;`. Registrar as saídas no relatório da task.

- [ ] **Step 5: Typecheck + commit**

```bash
git add src/pages/Efetivo.tsx src/pages/Efetivo.module.css
git commit -m "Fase 7: chamada diaria de presenca (aba Chamada do Efetivo)"
```

---

### Task 4: Integração com o RDO

**Files:**
- Create: `src/lib/efetivo.ts`
- Modify: `src/pages/RDOForm.tsx`

**Interfaces:**
- Consumes: `efetivo_chamadas`, `efetivo_presencas`, `trabalhadores` (Tasks 1–3); tipo `RdoEfetivo` já existente em `supabase.ts` (`{id, rdo_id, funcao, quantidade, empresa, ativo}`).
- Produces: `agruparPresencasComoEfetivo(presencas: {trabalhador: Trabalhador; presente: boolean}[]): RdoEfetivo[]` — usado por `RDOForm.tsx` e reutilizável por `rdoPdf.ts` sem alterar esse arquivo (a função devolve objetos que satisfazem a interface `RdoEfetivo` já consumida pelo PDF).

- [ ] **Step 1: Criar `src/lib/efetivo.ts`:**

```ts
// Converte a chamada nominal do dia (Fase 7) no mesmo formato agregado que
// RDOForm.tsx e rdoPdf.ts já sabem renderizar (RdoEfetivo: função + quantidade
// + empresa), para reaproveitar a UI e o PDF do RDO sem alterá-los.
import type { RdoEfetivo, Trabalhador } from './supabase'

export function agruparPresencasComoEfetivo(
  presencas: { trabalhador: Trabalhador; presente: boolean }[]
): RdoEfetivo[] {
  const grupos = new Map<string, { funcao: string; empresa: string | null; quantidade: number }>()
  for (const p of presencas) {
    if (!p.presente) continue
    const chave = `${p.trabalhador.funcao}::${p.trabalhador.empresa ?? ''}`
    const atual = grupos.get(chave)
    if (atual) atual.quantidade += 1
    else grupos.set(chave, { funcao: p.trabalhador.funcao, empresa: p.trabalhador.empresa, quantidade: 1 })
  }
  return Array.from(grupos.entries()).map(([chave, g], i) => ({
    id: `chamada-${chave}-${i}`, rdo_id: '', ativo: true,
    funcao: g.funcao, empresa: g.empresa, quantidade: g.quantidade,
  }))
}
```

- [ ] **Step 2: `RDOForm.tsx` — ler a chamada do dia:**
  - Ler o arquivo primeiro para localizar o `useEffect`/função de carregamento (`carregar`, por volta da linha 112-118, onde busca `rdo_efetivo`).
  - Junto do `Promise.all` existente, buscar a chamada da data do RDO: `supabase.from('efetivo_chamadas').select('*').eq('obra_id', r.obra_id).eq('data', r.data).maybeSingle()`. Se existir, buscar `efetivo_presencas` dessa `chamada_id` com join em `trabalhadores` (`.select('presente, trabalhadores(id, nome, funcao, empresa, obra_id, ativo, criado_por, criado_em, data_admissao)')`).
  - Se a chamada existir: `setEfetivo(agruparPresencasComoEfetivo(presencasComTrabalhador))` — a variável `efetivo` e sua renderização (linha ~500-536) **não mudam**, já aceitam `RdoEfetivo[]`.
  - Se a chamada NÃO existir para a data do RDO: manter o comportamento atual (efetivo vem de `rdo_efetivo`, editável manualmente como hoje) e exibir um aviso adicional acima do bloco: `{styles.avisoFoto}` (classe já usada para avisos no arquivo) com texto "Chamada do dia ainda não feita." e um link/botão que navega para `/efetivo`.
  - Quando a chamada EXISTE, os controles de edição manual (`addEfetivo`/`removerEfetivo`, chips de função) ficam ocultos — a fonte da verdade passa a ser a chamada; mostrar em vez disso um botão "Editar chamada" que navega para `/efetivo`.

- [ ] **Step 3: Verificar** — sem chamada feita para a data do RDO ativo, o comportamento antigo (edição manual) continua idêntico ao de antes desta task (regressão zero); com uma chamada de teste inserida via SQL (mesma técnica de `ROLLBACK` da Task 3) para a data de um RDO existente, o bloco "Efetivo do dia" deve mostrar o resumo agrupado.

- [ ] **Step 4: Typecheck + commit**

```bash
git add src/lib/efetivo.ts src/pages/RDOForm.tsx
git commit -m "Fase 7: RDO le a chamada do dia em vez do lancamento manual"
```

---

### Task 5: Aviso no Dashboard

**Files:**
- Modify: `src/pages/Dashboard.tsx`, `src/pages/Dashboard.module.css`

**Interfaces:**
- Consumes: `dataHoje()` de `../lib/almoxarifado`; `efetivo_chamadas`, `efetivo_presencas` (Tasks 1 e 3).

- [ ] **Step 1: `Dashboard.module.css` — variante informativa do banner:**

```css
.bannerInfo {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  width: 100%;
  background: var(--azul-gelo);
  border: 1.5px solid var(--navy-light);
  border-radius: var(--radius-md);
  padding: 12px 16px;
  margin-bottom: 20px;
  cursor: pointer;
  text-align: left;
  font-family: inherit;
}

.bannerInfo:hover {
  background: #a8c8dc;
}
```

- [ ] **Step 2: `Dashboard.tsx` — carregar estado da chamada de hoje:**
  - Novo estado: `chamadaHoje: { feita: boolean; presentes: number; total: number } | null`.
  - `const veEfetivo = perfil?.papel !== 'cliente' && temModulo('efetivo')` (mesmo padrão de `vePainelAlmoxarifado`, linha 80).
  - `useEffect` (mesmo padrão do de ferramentas, linhas 82-116): se `!obra || !veEfetivo`, limpa e retorna. Senão:
    - `supabase.from('trabalhadores').select('id').eq('obra_id', obra.id).eq('ativo', true)` → `total = data?.length ?? 0`.
    - Se `total === 0`: não mostrar banner (sem trabalhador cadastrado ainda).
    - `supabase.from('efetivo_chamadas').select('id').eq('obra_id', obra.id).eq('data', dataHoje()).maybeSingle()`.
    - Se não existe chamada: `setChamadaHoje({ feita: false, presentes: 0, total })`.
    - Se existe: buscar `supabase.from('efetivo_presencas').select('presente').eq('chamada_id', chamada.id).eq('presente', true)` → `presentes = data?.length ?? 0`; `setChamadaHoje({ feita: true, presentes, total })`.
  - Banner (inserido após o banner de ferramentas em atraso, mesma estrutura condicional):
    - Se `chamadaHoje && !chamadaHoje.feita`: `<button className={styles.bannerInfo} onClick={() => navigate('/efetivo')}><span className={styles.bannerIcon}>👷</span><span className={styles.bannerTexto}>Chamada de hoje ainda não foi feita ({chamadaHoje.total} trabalhador{chamadaHoje.total > 1 ? 'es' : ''} cadastrado{chamadaHoje.total > 1 ? 's' : ''}).</span></button>`.
    - Se `chamadaHoje?.feita`: mesma estrutura, texto `"${chamadaHoje.presentes} de ${chamadaHoje.total} presentes hoje."`, mesmo `onClick`.

- [ ] **Step 3: Verificar** — sem trabalhador cadastrado: nenhum banner. Com trabalhadores e sem chamada de hoje: banner de aviso. Com chamada feita (testar via SQL com `ROLLBACK`, mesma técnica das tasks anteriores, usando a data de hoje real): banner com contagem.

- [ ] **Step 4: Typecheck + commit**

```bash
git add src/pages/Dashboard.tsx src/pages/Dashboard.module.css
git commit -m "Fase 7: aviso de chamada no Dashboard"
```

---

### Task 6: Documentação e verificação final

**Files:**
- Create: `docs/fase7_efetivo.md`
- Modify: `CLAUDE.md` (§0: Gestão de Efetivo entregue, aguardando teste de campo; rodapé de versão)
- Modify: memória `project_estado_fases.md` (fora do repo)

- [ ] **Step 1: Escrever `docs/fase7_efetivo.md`** seguindo o padrão de `docs/fase6_almoxarifado.md`: o que foi entregue (cadastro de trabalhadores, chamada diária, integração com RDO, aviso no Dashboard), decisões da spec, onde estão as regras (arquivo de migração), roteiro de teste guiado para o Rodrigo:
  1. Cadastrar 2-3 trabalhadores reais em `/efetivo` (aba Trabalhadores).
  2. Fazer a chamada de hoje (aba Chamada), marcar 1 ausente, salvar.
  3. Ver o Dashboard mostrar "X de Y presentes hoje".
  4. Abrir/criar o RDO de hoje e confirmar que o bloco "Efetivo do dia" mostra o resumo da chamada, sem precisar digitar de novo.
  5. Abrir um RDO de um dia anterior a esta fase e confirmar que ele continua mostrando o que já estava salvo manualmente (nada muda retroativamente).
  - Lacunas explícitas: nenhuma migração retroativa de nomes; motivo de falta fora de escopo.

- [ ] **Step 2: Atualizar `CLAUDE.md` §0** — adicionar linha "Fase 7 (Gestão de Efetivo): entregue em [data], aguardando teste de campo e aceite" no mesmo padrão das outras fases; atualizar "Próxima etapa"; subir a versão no rodapé (verificar o número atual no arquivo e incrementar).

- [ ] **Step 3: Typecheck final** — `$env:Path = "C:\Program Files\nodejs;" + $env:Path; npx tsc --noEmit -p tsconfig.json` deve passar limpo.

- [ ] **Step 4: Commit**

```bash
git add docs/fase7_efetivo.md CLAUDE.md
git commit -m "Fase 7: docs da Gestao de Efetivo e atualizacao do CLAUDE.md"
```

---

## Self-review (executado na escrita)

- **Cobertura da spec:** cadastro de trabalhadores (T2), chamada diária (T3), integração RDO (T4), aviso Dashboard (T5), RLS/permissões (T1), docs/roteiro (T6). Fora de escopo da spec (motivo de falta, presença por unidade, vínculo com fornecedores, cálculo de diária) — nenhuma task os implementa, conforme decidido.
- **Placeholders:** nenhum "TBD"; todos os steps têm código ou comando completo.
- **Consistência de tipos:** `Trabalhador`, `EfetivoChamada`, `EfetivoPresenca` (Task 2) usados identicamente nas Tasks 3-5; `agruparPresencasComoEfetivo` (Task 4) retorna exatamente o shape de `RdoEfetivo` já existente em `supabase.ts`, sem exigir mudança em `rdoPdf.ts`.
