# Medições (empreiteiros) — Cancelar medição aprovada Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Responsável pela implementação:** Codex (execução contínua padrão do projeto — ver
> `docs/colaboracao-codex-claude.md`). Claude Code fez a arquitetura (spec) e este plano; a
> categoria de risco (trigger alterado + RPC nova que escreve em duas tabelas) exige revisão
> obrigatória do Claude Code **pós-commit**, antes de qualquer uso real do botão "Cancelar
> medição" (ver `docs/colaboracao-codex-claude.md`, categorias de risco).

**Goal:** Permitir que o admin cancele uma medição de empreiteiro já aprovada, com motivo
obrigatório, liberando automaticamente o saldo do contrato-item e removendo do Financeiro os
lançamentos que essa medição gerou — sem nunca apagar o registro (preservado com selo
"Cancelada").

**Architecture:** Novo valor `'cancelada'` no enum `status_medicao` (migração própria, sem uso na
mesma transação). Trigger `restringir_status_medicao()` ganha uma exceção explícita para a
transição `aprovada → cancelada` com motivo obrigatório. RPC nova `medicoes_cancelar_medicao`
(`SECURITY DEFINER`, admin-only) faz a transição e a reversão do Financeiro numa única transação
atômica. Frontend reaproveita o `solicitarTexto()` já existente em `useConfirmDialog` (mesmo
padrão usado por Produção própria em `ProducaoMedicaoForm.tsx:32`) — nenhum componente de diálogo
novo.

**Tech Stack:** Supabase (Postgres + RLS) + React 19 + TypeScript + Vite. Sem framework de testes
no projeto — verificação por SQL direto (`apply_migration`/`execute_sql`) para as migrações, e
`npm run build` + teste manual no navegador para o frontend.

## Global Constraints

- Spec completa em `docs/superpowers/specs/2026-07-22-medicoes-cancelamento-design.md` — ler
  antes de implementar qualquer task.
- `ALTER TYPE status_medicao ADD VALUE 'cancelada'` precisa estar em migração própria, sem
  nenhuma referência ao valor `'cancelada'` na mesma transação (armadilha documentada em
  CLAUDE.md §0 — já causou retrabalho antes).
- Toda função `SECURITY DEFINER` precisa de `SET search_path = public` desde a criação (regra do
  projeto, gap fechado em 19/07/2026 — não repetir).
- Medição aprovada continua imutável para **qualquer** outra mudança — a única exceção nova ao
  trigger é a transição específica `aprovada → cancelada` com motivo preenchido.
- Nomes de coluna devem seguir exatamente o padrão já usado em `producao_medicoes`
  (`ProducaoMedicao` em `src/lib/supabase.ts:238`): `cancelada_por`, `cancelada_em`,
  `motivo_cancelamento`.
- Nenhuma mudança em Produção própria, Compras ou qualquer outro módulo.

---

### Task 1: Migração — enum, colunas novas e trigger de transição

**Files:**
- Create: `supabase/migrations/20260722_medicoes_cancelamento.sql`

**Interfaces:**
- Produces: valor `'cancelada'` em `status_medicao`; colunas `medicoes.motivo_cancelamento`,
  `medicoes.cancelada_por`, `medicoes.cancelada_em`; trigger `restringir_status_medicao()`
  atualizado — usados pela Task 2 (RPC) e pela Task 3 (frontend).

- [ ] **Step 1: Escrever a migração**

Criar `supabase/migrations/20260722_medicoes_cancelamento.sql`:

```sql
-- Medições (empreiteiros): permite cancelar uma medição aprovada,
-- preservando o registro. Ver docs/superpowers/specs/2026-07-22-medicoes-cancelamento-design.md
-- ALTER TYPE ... ADD VALUE não pode ser referenciado na mesma transação
-- (CLAUDE.md §0) — por isso esta migração só adiciona o valor e as colunas;
-- o trigger e a RPC que os referenciam ficam na migração seguinte.

ALTER TYPE status_medicao ADD VALUE 'cancelada';

ALTER TABLE medicoes
  ADD COLUMN motivo_cancelamento TEXT,
  ADD COLUMN cancelada_por       UUID REFERENCES perfis_usuario(id),
  ADD COLUMN cancelada_em        TIMESTAMPTZ;
```

- [ ] **Step 2: Aplicar a migração**

Aplicar via `mcp__claude_ai_Supabase__apply_migration` (nome: `medicoes_cancelamento`) ou
`supabase db push`, conforme o fluxo já usado neste projeto.

- [ ] **Step 3: Verificar**

```sql
SELECT enumlabel FROM pg_enum
JOIN pg_type ON pg_type.oid = pg_enum.enumtypid
WHERE pg_type.typname = 'status_medicao';
-- Esperado: rascunho, aprovada, cancelada

SELECT column_name FROM information_schema.columns
WHERE table_name = 'medicoes' AND column_name IN
  ('motivo_cancelamento','cancelada_por','cancelada_em');
-- Esperado: as 3 colunas
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260722_medicoes_cancelamento.sql
git commit -m "feat: adiciona status cancelada em medicoes (enum + colunas)"
```

---

### Task 2: Migração — trigger de transição e RPC de cancelamento

**Files:**
- Create: `supabase/migrations/20260722_medicoes_cancelamento_rpc.sql`

**Interfaces:**
- Consumes: enum `status_medicao` com `'cancelada'`, colunas de Task 1.
- Produces: `restringir_status_medicao()` atualizada; RPC
  `medicoes_cancelar_medicao(p_medicao_id UUID, p_motivo TEXT) RETURNS medicoes` — usada pela
  Task 3 (frontend) via `supabase.rpc('medicoes_cancelar_medicao', {...})`.

- [ ] **Step 1: Escrever a migração**

Criar `supabase/migrations/20260722_medicoes_cancelamento_rpc.sql`:

```sql
-- Trigger: passa a permitir aprovada -> cancelada com motivo obrigatório.
-- Qualquer outra alteração numa medição aprovada ou cancelada continua
-- bloqueada, sem exceção para admin.
CREATE OR REPLACE FUNCTION restringir_status_medicao() RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status = 'aprovada' AND NEW.status = 'cancelada' THEN
    IF NEW.motivo_cancelamento IS NULL OR btrim(NEW.motivo_cancelamento) = '' THEN
      RAISE EXCEPTION 'Motivo do cancelamento é obrigatório.';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status = 'aprovada' THEN
    RAISE EXCEPTION 'Medição aprovada não pode ser alterada.';
  END IF;
  IF OLD.status = 'cancelada' THEN
    RAISE EXCEPTION 'Medição cancelada não pode ser alterada.';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND meu_papel() <> 'admin' THEN
    RAISE EXCEPTION 'Somente o admin pode aprovar uma medição.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- RPC: cancela uma medição aprovada e reverte o Financeiro na mesma
-- transação. O saldo do contrato-item volta sozinho, porque
-- validar_saldo_medicao() só soma medições com status = 'aprovada'.
CREATE OR REPLACE FUNCTION medicoes_cancelar_medicao(p_medicao_id UUID, p_motivo TEXT)
RETURNS medicoes
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_medicao medicoes;
BEGIN
  IF meu_papel() <> 'admin' THEN
    RAISE EXCEPTION 'Somente o admin pode cancelar uma medição.';
  END IF;
  IF p_motivo IS NULL OR btrim(p_motivo) = '' THEN
    RAISE EXCEPTION 'Motivo do cancelamento é obrigatório.';
  END IF;

  UPDATE medicoes
  SET status = 'cancelada',
      motivo_cancelamento = p_motivo,
      cancelada_por = auth.uid(),
      cancelada_em = now()
  WHERE id = p_medicao_id AND status = 'aprovada'
  RETURNING * INTO v_medicao;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Medição não encontrada ou não está aprovada.';
  END IF;

  UPDATE lancamentos_financeiros
  SET ativo = false
  WHERE ativo = true
    AND medicao_item_id IN (
      SELECT id FROM medicoes_itens WHERE medicao_id = p_medicao_id
    );

  RETURN v_medicao;
END;
$$;

-- Mesmo padrão de producao_cancelar_medicao (20260716_fase7_producao_propria.sql:432,434):
-- a checagem de admin é feita dentro da função, mas o EXECUTE em si
-- só é concedido a authenticated, nunca a PUBLIC.
REVOKE ALL ON FUNCTION medicoes_cancelar_medicao(UUID,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION medicoes_cancelar_medicao(UUID,TEXT) TO authenticated;
```

- [ ] **Step 2: Aplicar a migração**

Aplicar via `mcp__claude_ai_Supabase__apply_migration` (nome: `medicoes_cancelamento_rpc`).

- [ ] **Step 3: Verificar com teste real (transação de teste, sem efeito permanente)**

Rodar em uma transação com `ROLLBACK` no final, simulando um usuário admin autenticado
(`SET LOCAL request.jwt.claims`), sobre uma medição de teste real ou uma cópia temporária —
confirmar:

1. Chamar `medicoes_cancelar_medicao` com motivo vazio → deve falhar com "Motivo do cancelamento
   é obrigatório."
2. Chamar com uma medição em `status='rascunho'` → deve falhar com "Medição não encontrada ou não
   está aprovada."
3. Chamar com uma medição `aprovada` e motivo preenchido → deve retornar a linha com
   `status='cancelada'`, `cancelada_por`/`cancelada_em` preenchidos.
4. Tentar um `UPDATE medicoes SET status='rascunho' WHERE id = <mesma medicao>` direto (sem passar
   pela RPC) depois do cancelamento → deve falhar com "Medição cancelada não pode ser alterada."

```sql
BEGIN;
SET LOCAL request.jwt.claims = '{"sub": "<uuid de um admin real>", "role": "authenticated"}';
SET LOCAL role authenticated;
-- rodar os 4 testes acima
ROLLBACK;
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260722_medicoes_cancelamento_rpc.sql
git commit -m "feat: adiciona RPC medicoes_cancelar_medicao com reversao de saldo e financeiro"
```

---

### Task 3: Frontend — botão "Cancelar medição" em MedicaoForm.tsx

**Files:**
- Modify: `src/lib/supabase.ts` (tipo `StatusMedicao` e interface `Medicao`)
- Modify: `src/pages/MedicaoForm.tsx`
- Modify: `src/pages/MedicaoForm.module.css`

**Interfaces:**
- Consumes: RPC `medicoes_cancelar_medicao` (Task 2); `solicitarTexto` de
  `useConfirmDialog()` (`src/components/ConfirmDialogContext.ts:17`,
  `Promise<string | null>`).

- [ ] **Step 1: Atualizar o tipo `Medicao` em `src/lib/supabase.ts`**

Em `src/lib/supabase.ts:687-703`, trocar:

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
```

por:

```ts
export type StatusMedicao = 'rascunho' | 'aprovada' | 'cancelada'

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
  motivo_cancelamento: string | null
  cancelada_por: string | null
  cancelada_em: string | null
  ativo: boolean
  criado_em: string
  criado_por: string
}
```

- [ ] **Step 2: Adicionar o rótulo "Cancelada" em `MedicaoForm.tsx`**

Em `src/pages/MedicaoForm.tsx:13-16`, trocar:

```ts
export const STATUS_MEDICAO_LABEL: Record<StatusMedicao, string> = {
  rascunho: 'Rascunho',
  aprovada: 'Aprovada',
}
```

por:

```ts
export const STATUS_MEDICAO_LABEL: Record<StatusMedicao, string> = {
  rascunho: 'Rascunho',
  aprovada: 'Aprovada',
  cancelada: 'Cancelada',
}
```

- [ ] **Step 3: Importar `solicitarTexto` e escrever a função `cancelar()`**

Em `src/pages/MedicaoForm.tsx:31`, trocar:

```ts
const { confirmar } = useConfirmDialog()
```

por:

```ts
const { confirmar, solicitarTexto } = useConfirmDialog()
```

Depois da função `aprovar()` (que termina em `MedicaoForm.tsx:200-202`), adicionar:

```ts
  async function cancelar() {
    if (!medicao) return
    const motivo = await solicitarTexto({
      titulo: 'Cancelar medição',
      mensagem: 'A medição será preservada no histórico com o selo "Cancelada". O saldo do contrato volta a ficar disponível e os lançamentos gerados no Financeiro serão removidos.',
      confirmarTexto: 'Cancelar medição',
      perigoso: true,
      campo: { rotulo: 'Motivo do cancelamento', placeholder: 'Descreva o motivo…' },
    })
    if (!motivo) return
    setSalvando(true)
    setMsg(null)
    const { error } = await supabase.rpc('medicoes_cancelar_medicao', {
      p_medicao_id: medicao.id, p_motivo: motivo,
    })
    setSalvando(false)
    if (error) {
      setMsg({ tipo: 'erro', texto: `Erro ao cancelar: ${error.message}` })
      return
    }
    if (contratoId) carregar(contratoId)
  }
```

- [ ] **Step 4: Adicionar o botão no bloco de ações**

Em `src/pages/MedicaoForm.tsx:330-334`, depois do bloco do botão "Aprovar medição", adicionar:

```tsx
        {!nova && ehAdmin && medicao?.status === 'aprovada' && (
          <button className={styles.btnPerigo} onClick={cancelar} disabled={salvando}>
            {salvando ? 'Cancelando…' : 'Cancelar medição'}
          </button>
        )}
```

- [ ] **Step 5: Exibir motivo e dados do cancelamento quando `status === 'cancelada'`**

Depois do bloco de resumo (`src/pages/MedicaoForm.tsx:311-315`, que termina com o
`</div>` da linha "Valor líquido"), adicionar:

```tsx
      {medicao?.status === 'cancelada' && (
        <div className={styles.blocoCancelada}>
          <strong>Motivo do cancelamento:</strong> {medicao.motivo_cancelamento}
        </div>
      )}
```

- [ ] **Step 6: Adicionar classes CSS novas em `MedicaoForm.module.css`**

Em `src/pages/MedicaoForm.module.css:38`, logo depois de `.chip_aprovada { background: #e3f4e3; color: #1e6b2e; }`, adicionar:

```css
.chip_cancelada { background: #fde5e5; color: #942828; }
```

Depois de `.btnSecundario { ... }` (linhas 128-137), adicionar:

```css
.btnPerigo {
  background: var(--branco);
  color: #a33030;
  border: 1.5px solid #a33030;
  border-radius: var(--radius-sm);
  padding: 12px 16px;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
}

.btnPerigo:disabled { opacity: 0.6; cursor: default; }
```

Depois de `.resumoLinha { ... }` (linhas 102-107), adicionar:

```css
.blocoCancelada {
  background: #fde5e5;
  color: #942828;
  border-radius: var(--radius-md);
  padding: 12px 16px;
  margin-bottom: 12px;
  font-size: 13px;
}
```

(Cores e espaçamentos reaproveitam exatamente os tokens já usados neste arquivo: `#a33030` é a
mesma cor de `.msgErro`, `var(--radius-md)` é o mesmo raio de `.bloco`.)

- [ ] **Step 7: Build e teste manual**

```bash
npm run build
```

Testar no navegador como admin: abrir uma medição aprovada de teste, clicar "Cancelar medição",
tentar confirmar com o motivo vazio (deve bloquear no próprio diálogo — `solicitarTexto` já exige
texto não vazio para resolver a Promise, conferir esse comportamento existente), depois cancelar
com motivo preenchido — confirmar que o selo muda para "Cancelada", o motivo aparece, e os botões
de aprovar/editar itens somem.

- [ ] **Step 8: Commit**

```bash
git add src/lib/supabase.ts src/pages/MedicaoForm.tsx src/pages/MedicaoForm.module.css
git commit -m "feat: adiciona cancelamento de medicao aprovada na tela de medicao"
```

---

### Task 4: Frontend — filtro "Cancelada" na lista de medições

**Files:**
- Modify: `src/pages/Medicoes.tsx`

**Interfaces:**
- Consumes: `StatusMedicao` atualizado (Task 3); `.chip_cancelada` já existe em
  `Medicoes.module.css:75-78` (reaproveitado de Produção própria) — nenhuma mudança de CSS aqui.

- [ ] **Step 1: Adicionar a opção "Cancelada" no filtro de status**

Em `src/pages/Medicoes.tsx:21`, dentro do `<select className={styles.selectFiltro} ...>` da aba
"Empreiteiros", trocar:

```tsx
<option value="">Todos os status</option><option value="rascunho">Rascunho</option><option value="aprovada">Aprovada</option>
```

por:

```tsx
<option value="">Todos os status</option><option value="rascunho">Rascunho</option><option value="aprovada">Aprovada</option><option value="cancelada">Cancelada</option>
```

Nenhuma outra mudança necessária nesse arquivo: o chip já renderiza qualquer status
dinamicamente (`styles[`chip_${m.status}`]`), e `.chip_cancelada` já existe no CSS desde a
Produção própria.

- [ ] **Step 2: Build e teste manual**

```bash
npm run build
```

Testar no navegador: filtrar por "Cancelada" na aba Empreiteiros e confirmar que a medição
cancelada na Task 3 aparece com o chip vermelho.

- [ ] **Step 3: Commit**

```bash
git add src/pages/Medicoes.tsx
git commit -m "feat: adiciona filtro Cancelada na lista de medicoes"
```

---

### Task 5: Aplicar retroativamente à medição JFC

**Files:** nenhum arquivo novo — execução única de SQL/uso da tela, depois que as Tasks 1-4
estiverem em produção.

**Interfaces:**
- Consumes: RPC `medicoes_cancelar_medicao` (Task 2).

- [ ] **Step 1: Confirmar que a medição ainda está como esperado**

```sql
SELECT id, status, valor_liquido FROM medicoes WHERE id = '875f3d53-51b6-4763-9bde-7b4186e0af9d';
-- Esperado: status = 'aprovada', valor_liquido = 96448.75
```

- [ ] **Step 2: Cancelar via RPC (autenticado como admin, pela própria tela ou via SQL com contexto de admin)**

```sql
SELECT medicoes_cancelar_medicao(
  '875f3d53-51b6-4763-9bde-7b4186e0af9d',
  'Medição aproximada, substituída pelos lançamentos reais importados da planilha de histórico em 22/07/2026 — não corresponde a nenhum pagamento real da JFC.'
);
```

- [ ] **Step 3: Verificar**

```sql
SELECT status, motivo_cancelamento, cancelada_por, cancelada_em
FROM medicoes WHERE id = '875f3d53-51b6-4763-9bde-7b4186e0af9d';
-- Esperado: status = 'cancelada', motivo preenchido, cancelada_por/cancelada_em preenchidos

SELECT ativo, count(*) FROM lancamentos_financeiros lf
JOIN medicoes_itens mi ON mi.id = lf.medicao_item_id
WHERE mi.medicao_id = '875f3d53-51b6-4763-9bde-7b4186e0af9d'
GROUP BY ativo;
-- Esperado: só ativo=false, count=17 (sem mudança — já estavam inativados manualmente em 22/07)
```

- [ ] **Step 4: Reportar ao Rodrigo**

Confirmar que a medição JFC agora aparece com o selo "Cancelada" e o motivo visível na tela,
fechando o ciclo desta correção.

---

## Revisão obrigatória

Ao final das Tasks 1-4 (a Task 5 é só execução de dados, não precisa de revisão de código),
Codex deve reportar como fez nas entregas anteriores (Fase 3a, Aluguéis) para que o Claude Code
revise: trigger alterado + RPC nova que grava em duas tabelas (`medicoes` e
`lancamentos_financeiros`) entram na categoria de risco do protocolo
(`docs/colaboracao-codex-claude.md`) que exige revisão pós-commit antes de qualquer teste de
campo com uma medição real.
