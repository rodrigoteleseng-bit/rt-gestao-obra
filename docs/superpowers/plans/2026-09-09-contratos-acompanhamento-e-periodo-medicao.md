# Contratos — Painel de acompanhamento + Medição com período Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) ou superpowers:executing-plans para implementar este plano task-by-task. Steps
> usam checkbox (`- [ ]`) para acompanhamento.
>
> **Responsável pela implementação:** Codex (execução contínua padrão do projeto — ver
> `docs/colaboracao-codex-claude.md`). Claude Code fez este plano e precisa revisar **pós-commit**
> antes de qualquer teste de campo: a Task 2 troca a assinatura de uma RPC existente (`DROP
> FUNCTION` + `CREATE` com parâmetros diferentes) e a Task 1 remove uma coluna em produção
> (`data_referencia`) — as duas entram na categoria de risco do protocolo (mudança de schema +
> RPC alterada) que exige revisão antes de uso real.

**Goal:** (A) Mostrar na tela do Contrato um resumo de acompanhamento — total já medido, retenção
acumulada, valor líquido, saldo do contrato e % executado — e trocar a lista de medições (hoje
botões soltos com só número/status/valor) por cards com período e retenção. (B) Trocar o campo
único `data_referencia` da medição por um período (`data_inicio`/`data_fim`), replicando o padrão
já usado em Produção própria (`producao_medicoes`) e confirmado como o formato real usado em
medições de campo (planilha real da Prudência Serviços Ltda, contrato de armação/carpintaria —
analisada em 09/09/2026).

**Architecture:** Item B é pré-requisito de schema pro Item A (o card de medição no painel mostra
o período). Sequência: migração de schema (Task 1) → migração de RPC (Task 2) → frontend do
período na Medição (Task 3) → painel de acompanhamento no Contrato (Task 4), que já consome os
campos novos da Task 3. Nenhuma mudança em Compras, Almoxarifado, Produção própria ou qualquer
outro módulo. Nenhum componente novo — tudo inline nos arquivos já existentes (`ContratoForm.tsx`,
`MedicaoForm.tsx`), seguindo o padrão do projeto de não introduzir abstração além do necessário.

**Tech Stack:** Supabase (Postgres + RLS) + React 19 + TypeScript + Vite. Sem framework de testes
no projeto — verificação por SQL direto (`apply_migration`/`execute_sql`) para as migrações, e
`npm run build` + teste manual no navegador para o frontend.

## Global Constraints

- Medição aprovada continua imutável (trigger `restringir_status_medicao()` já existente) — as
  duas tasks de frontend (3 e 4) são só leitura/exibição de dados já calculados, nenhuma delas
  escreve em `medicoes` fora do fluxo que já existe hoje (criar rascunho, salvar itens, aprovar,
  cancelar).
- Toda função `SECURITY DEFINER`/`SECURITY INVOKER` nova ou recriada precisa de
  `SET search_path = public` desde a criação (regra do projeto, gap fechado em 19/07/2026 — não
  repetir).
- `criar_medicao_com_itens` tem hoje a assinatura `(p_contrato UUID, p_data_referencia DATE,
  p_itens JSONB)` — como o tipo do parâmetro muda (uma DATE vira duas), não dá pra usar só
  `CREATE OR REPLACE` (isso criaria uma segunda função sobrecarregada em vez de substituir); a
  Task 2 precisa de `DROP FUNCTION` explícito da assinatura antiga antes do `CREATE`.
- `data_referencia` é removida da tabela `medicoes` na mesma migração que adiciona
  `data_inicio`/`data_fim` (Task 1) — sem coluna "morta" nem shim de compatibilidade, seguindo a
  regra do projeto de não deixar código/coluna não usada pra trás. Isso significa que o deploy do
  frontend (Task 3) precisa acontecer junto/logo depois da migração — não há uma janela em que
  metade do app espera a coluna antiga e a outra metade não.
- Único dado real hoje: contrato `CT-001` (JFC Instalações, obra Tharsos Imperial) com uma
  medição, nº 1, já **cancelada** (não conta pro resumo da Task 4, que soma só `status =
  'aprovada'` — o resumo real vai mostrar zeros pra esse contrato até haver uma medição aprovada).
  Verificação da Task 4 deve incluir um teste com dado de teste real aprovado e depois desfeito,
  não só o caso zerado.

---

### Task 1: Migração — período em vez de data única em `medicoes`

**Files:**
- Create: `supabase/migrations/20260909_medicoes_periodo.sql`

**Interfaces:**
- Produces: colunas `medicoes.data_inicio DATE NOT NULL`, `medicoes.data_fim DATE NOT NULL`,
  constraint `CHECK (data_fim >= data_inicio)` — usadas pela Task 2 (RPC) e Task 3 (frontend).
  Remove `medicoes.data_referencia`.

- [ ] **Step 1: Escrever a migração**

Criar `supabase/migrations/20260909_medicoes_periodo.sql`:

```sql
-- Medições (empreiteiros): troca data_referencia (uma data) por um
-- período (data_inicio/data_fim) — formato real confirmado numa planilha
-- de medição de campo (Prudência Serviços Ltda, análise de 09/09/2026).
-- Mesmo padrão já usado em producao_medicoes (20260716_fase7_producao_propria.sql:100-101).

ALTER TABLE medicoes
  ADD COLUMN data_inicio DATE,
  ADD COLUMN data_fim    DATE;

-- Backfill precisa contornar trg_restringir_status_medicao: esse trigger bloqueia
-- QUALQUER UPDATE numa medição aprovada/cancelada (mesmo de migração de schema) —
-- achado ao tentar aplicar esta migração contra o dado real (CT-001/JFC, já cancelada).
-- Desabilitado só para este UPDATE pontual, reabilitado logo em seguida.
ALTER TABLE medicoes DISABLE TRIGGER trg_restringir_status_medicao;

UPDATE medicoes SET data_inicio = data_referencia, data_fim = data_referencia
WHERE data_inicio IS NULL;

ALTER TABLE medicoes ENABLE TRIGGER trg_restringir_status_medicao;

ALTER TABLE medicoes
  ALTER COLUMN data_inicio SET NOT NULL,
  ALTER COLUMN data_fim    SET NOT NULL,
  ADD CONSTRAINT chk_medicoes_periodo CHECK (data_fim >= data_inicio),
  DROP COLUMN data_referencia;
```

- [ ] **Step 2: Aplicar a migração**

Aplicar via `mcp__claude_ai_Supabase__apply_migration` (nome: `medicoes_periodo`) ou
`supabase db push`, conforme o fluxo já usado neste projeto.

- [ ] **Step 3: Verificar**

```sql
SELECT column_name, is_nullable FROM information_schema.columns
WHERE table_name = 'medicoes' AND column_name IN ('data_inicio', 'data_fim', 'data_referencia');
-- Esperado: data_inicio e data_fim com is_nullable='NO'; data_referencia ausente (0 linhas pra ela)

SELECT id, numero, data_inicio, data_fim FROM medicoes WHERE ativo = true;
-- Esperado: a medição nº1 do CT-001 (JFC) com data_inicio = data_fim = '2026-07-14'
-- (era o data_referencia original — conferir contra o valor antes da migração)
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260909_medicoes_periodo.sql
git commit -m "feat: troca data_referencia por periodo (data_inicio/data_fim) em medicoes"
```

---

### Task 2: Migração — RPC `criar_medicao_com_itens` com período

**Files:**
- Create: `supabase/migrations/20260909_medicoes_periodo_rpc.sql`

**Interfaces:**
- Consumes: colunas da Task 1.
- Produces: `criar_medicao_com_itens(p_contrato UUID, p_data_inicio DATE, p_data_fim DATE, p_itens
  JSONB) RETURNS UUID` — substitui a assinatura antiga `(UUID, DATE, JSONB)`. Usada pela Task 3
  via `supabase.rpc('criar_medicao_com_itens', {...})`. `salvar_itens_medicao` não muda (só edita
  quantidade de item, nunca período).

- [ ] **Step 1: Escrever a migração**

Criar `supabase/migrations/20260909_medicoes_periodo_rpc.sql`:

```sql
-- Assinatura muda de tipo (1 DATE -> 2 DATE) — CREATE OR REPLACE criaria uma
-- segunda função sobrecarregada em vez de substituir; precisa DROP explícito
-- da assinatura antiga primeiro.
DROP FUNCTION IF EXISTS criar_medicao_com_itens(UUID, DATE, JSONB);

CREATE OR REPLACE FUNCTION criar_medicao_com_itens(
  p_contrato UUID, p_data_inicio DATE, p_data_fim DATE, p_itens JSONB
)
RETURNS UUID LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE v_medicao_id UUID; v_obra UUID; v_item JSONB;
BEGIN
  SELECT obra_id INTO v_obra FROM contratos WHERE id=p_contrato AND ativo=true AND status='ativo' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Contrato inexistente ou fora do status ativo.'; END IF;
  IF NOT pode_editar_medicoes() OR NOT pode_acessar_obra(v_obra) THEN RAISE EXCEPTION 'Sem permissao para criar medicao neste contrato.'; END IF;
  IF p_data_inicio IS NULL OR p_data_fim IS NULL THEN RAISE EXCEPTION 'Periodo da medicao obrigatorio.'; END IF;
  IF p_data_fim < p_data_inicio THEN RAISE EXCEPTION 'Data fim nao pode ser anterior a data inicio.'; END IF;
  IF jsonb_typeof(p_itens)<>'array' OR jsonb_array_length(p_itens)=0 THEN RAISE EXCEPTION 'A medicao precisa de itens.'; END IF;

  INSERT INTO medicoes (contrato_id,data_inicio,data_fim) VALUES (p_contrato,p_data_inicio,p_data_fim) RETURNING id INTO v_medicao_id;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_itens) LOOP
    IF COALESCE((v_item->>'quantidade_periodo')::NUMERIC,-1)<0 THEN RAISE EXCEPTION 'Quantidade medida nao pode ser negativa.'; END IF;
    IF NOT EXISTS (SELECT 1 FROM contratos_itens WHERE id=(v_item->>'contrato_item_id')::UUID AND contrato_id=p_contrato AND ativo=true) THEN
      RAISE EXCEPTION 'Item nao pertence ao contrato da medicao.';
    END IF;
    INSERT INTO medicoes_itens (medicao_id,contrato_item_id,quantidade_periodo)
    VALUES (v_medicao_id,(v_item->>'contrato_item_id')::UUID,(v_item->>'quantidade_periodo')::NUMERIC);
  END LOOP;
  RETURN v_medicao_id;
END;
$$;

REVOKE ALL ON FUNCTION criar_medicao_com_itens(UUID,DATE,DATE,JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION criar_medicao_com_itens(UUID,DATE,DATE,JSONB) TO authenticated;
```

- [ ] **Step 2: Aplicar a migração**

Aplicar via `mcp__claude_ai_Supabase__apply_migration` (nome: `medicoes_periodo_rpc`).

- [ ] **Step 3: Verificar com teste real (transação de teste, sem efeito permanente)**

```sql
BEGIN;
SET LOCAL request.jwt.claims = '{"sub": "<uuid de um admin real>", "role": "authenticated"}';
SET LOCAL role authenticated;

-- 1. data_fim antes de data_inicio deve falhar
SELECT criar_medicao_com_itens('cc2823c3-954a-44d9-8a9a-1f9cb18ce529', '2026-09-10', '2026-09-01', '[]'::jsonb);
-- Esperado: erro "Data fim nao pode ser anterior a data inicio."

-- 2. assinatura antiga não existe mais
SELECT criar_medicao_com_itens('cc2823c3-954a-44d9-8a9a-1f9cb18ce529', '2026-09-01'::date, '[]'::jsonb);
-- Esperado: erro de função inexistente com essa assinatura (3 args)

ROLLBACK;
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260909_medicoes_periodo_rpc.sql
git commit -m "feat: atualiza criar_medicao_com_itens para periodo (data_inicio/data_fim)"
```

---

### Task 3: Frontend — tipo, PDF e formulário de Medição com período

**Files:**
- Modify: `src/lib/supabase.ts` (interface `Medicao`)
- Modify: `src/lib/medicoesPdf.ts`
- Modify: `src/pages/MedicaoForm.tsx`
- Modify: `src/pages/MedicaoForm.module.css`

**Interfaces:**
- Consumes: RPC `criar_medicao_com_itens` (Task 2); `hojeISO()` de `../lib/cronograma`
  (`src/pages/ProducaoMedicaoForm.tsx:6,69-70` — mesmo padrão de período usado lá).

- [ ] **Step 1: Atualizar o tipo `Medicao` em `src/lib/supabase.ts`**

Em `src/lib/supabase.ts:712-729`, trocar a linha `716`:

```ts
  data_referencia: string
```

por:

```ts
  data_inicio: string
  data_fim: string
```

- [ ] **Step 2: Atualizar o PDF em `src/lib/medicoesPdf.ts`**

Em `src/lib/medicoesPdf.ts:141`, trocar:

```ts
  pdf.text(`Data de referência: ${fmtData(d.medicao.data_referencia)}`, ML, y)
```

por:

```ts
  pdf.text(`Período: ${fmtData(d.medicao.data_inicio)} a ${fmtData(d.medicao.data_fim)}`, ML, y)
```

(mesmo formato já usado em `src/lib/producaoMedicaoPdf.ts` pro período da medição de produção
própria — não inventa um formato novo.)

- [ ] **Step 3: Trocar o estado e os usos de `dataReferencia` em `MedicaoForm.tsx`**

Em `src/pages/MedicaoForm.tsx:1-12`, adicionar o import de `hojeISO` (mesma linha de import já
usada em `ProducaoMedicaoForm.tsx:6`):

```ts
import { hojeISO } from '../lib/cronograma'
```

Em `src/pages/MedicaoForm.tsx:52`, trocar:

```ts
  const [dataReferencia, setDataReferencia] = useState(() => new Date().toISOString().slice(0, 10))
```

por (mesmo default de "início do mês até hoje" já usado em
`ProducaoMedicaoForm.tsx:69-70`):

```ts
  const [dataInicio, setDataInicio] = useState(() => hojeISO().slice(0, 8) + '01')
  const [dataFim, setDataFim] = useState(() => hojeISO())
```

Em `src/pages/MedicaoForm.tsx:103`, trocar:

```ts
      if (atual) setDataReferencia(atual.data_referencia)
```

por:

```ts
      if (atual) { setDataInicio(atual.data_inicio); setDataFim(atual.data_fim) }
```

Em `src/pages/MedicaoForm.tsx:151` (dentro de `salvarNova`, chamada ao RPC), trocar:

```ts
      p_data_referencia: dataReferencia,
```

por:

```ts
      p_data_inicio: dataInicio,
      p_data_fim: dataFim,
```

- [ ] **Step 4: Trocar o campo único pelo par de campos no formulário**

Em `src/pages/MedicaoForm.tsx:313-319`, trocar:

```tsx
      <div className={styles.bloco}>
        <label className={styles.campo}>
          Data de referência *
          <input type="date" value={dataReferencia} onChange={e => setDataReferencia(e.target.value)}
            disabled={!nova} />
        </label>
      </div>
```

por:

```tsx
      <div className={styles.bloco}>
        <div className={styles.linha2}>
          <label className={styles.campo}>
            Data início *
            <input type="date" value={dataInicio} onChange={e => setDataInicio(e.target.value)}
              disabled={!nova} />
          </label>
          <label className={styles.campo}>
            Data fim *
            <input type="date" value={dataFim} onChange={e => setDataFim(e.target.value)}
              disabled={!nova} />
          </label>
        </div>
      </div>
```

- [ ] **Step 5: Adicionar `.linha2` em `MedicaoForm.module.css`**

`MedicaoForm.module.css` ainda não tem essa classe (existe em `ContratoForm.module.css:71-72`).
Adicionar no fim do arquivo:

```css
.linha2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.linha2 .campo { margin-bottom: 0; }
```

- [ ] **Step 6: Build e teste manual**

```bash
npm run build
```

Testar no navegador como admin: abrir o CT-001, criar uma medição nova de teste — confirmar que
os dois campos de data aparecem lado a lado, com os defaults (1º dia do mês até hoje), que ficam
bloqueados depois de criada, e que o PDF (botão "Imprimir PDF") mostra "Período: dd/mm/aaaa a
dd/mm/aaaa" no lugar de "Data de referência". Cancelar/inativar a medição de teste depois (mesmo
padrão usado nos testes anteriores desta sessão — nunca deixar dado de teste como se fosse real).

- [ ] **Step 7: Commit**

```bash
git add src/lib/supabase.ts src/lib/medicoesPdf.ts src/pages/MedicaoForm.tsx src/pages/MedicaoForm.module.css
git commit -m "feat: medicao de empreiteiro passa a usar periodo (data_inicio/data_fim)"
```

---

### Task 4: Frontend — painel de acompanhamento no Contrato

**Files:**
- Modify: `src/pages/ContratoForm.tsx`
- Modify: `src/pages/ContratoForm.module.css`

**Interfaces:**
- Consumes: `medicoes` (estado já existente em `DetalheContrato`, `ContratoForm.tsx:334-341`) e os
  campos `data_inicio`/`data_fim` da Task 3.

- [ ] **Step 1: Adicionar um helper de data em `ContratoForm.tsx`**

`ContratoForm.tsx` ainda não tem um formatador de data. Adicionar perto do topo do arquivo (depois
dos imports, antes de `interface ItemNovo`), o mesmo formato já usado em
`src/lib/medicoesPdf.ts:32-35` e `src/pages/MedicaoForm.tsx` (via PDF):

```ts
function fmtData(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`
}
```

- [ ] **Step 2: Calcular os totais dentro de `DetalheContrato`**

Em `ContratoForm.tsx`, logo depois do bloco `useEffect` que carrega `medicoes`
(`ContratoForm.tsx:337-341`), adicionar:

```ts
  const medicoesAprovadas = medicoes.filter(m => m.status === 'aprovada')
  const totalBruto = medicoesAprovadas.reduce((s, m) => s + m.valor_bruto, 0)
  const totalRetido = medicoesAprovadas.reduce((s, m) => s + m.valor_retido, 0)
  const totalLiquido = medicoesAprovadas.reduce((s, m) => s + m.valor_liquido, 0)
  const saldoContrato = contrato.valor_total - totalBruto
  const pctExecutado = contrato.valor_total > 0 ? (totalBruto / contrato.valor_total) * 100 : 0
```

(Só medições `aprovada` contam — `rascunho` ainda não é definitivo e `cancelada` foi desfeita,
mesmo critério já usado em `validar_saldo_medicao()` no banco.)

- [ ] **Step 3: Trocar o bloco "Medições" (resumo + lista em cards)**

Em `ContratoForm.tsx:568-588`, trocar o bloco inteiro:

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
              {m.numero}ª medição — {STATUS_MEDICAO_LABEL[m.status]} — R$ {formatarMoeda(m.valor_liquido)}
            </button>
          ))}
        </div>
      )}
```

por:

```tsx
      {(contrato.status === 'ativo' || contrato.status === 'encerrado') && (
        <div className={styles.bloco}>
          <div className={styles.header} style={{ marginBottom: 10 }}>
            <h2 style={{ margin: 0 }}>Medições</h2>
            {podeEditarMedicoes && contrato.status === 'ativo' && (
              <button className={styles.btnSecundario} onClick={() => navigate(`/contratos/${contrato.id}/medicoes/nova`)}>
                + Nova medição
              </button>
            )}
          </div>

          {!carregandoMedicoes && medicoes.length > 0 && (
            <div className={styles.resumoAcompanhamento}>
              <div className={styles.resumoLinha}><span>Total medido (bruto)</span><strong>R$ {formatarMoeda(totalBruto)}</strong></div>
              <div className={styles.resumoLinha}><span>Retenção acumulada</span><strong>− R$ {formatarMoeda(totalRetido)}</strong></div>
              <div className={styles.resumoLinha}><span>Total líquido (pago/a pagar)</span><strong>R$ {formatarMoeda(totalLiquido)}</strong></div>
              <div className={styles.resumoLinha}><span>Saldo do contrato</span><strong>R$ {formatarMoeda(saldoContrato)}</strong></div>
              <div className={styles.resumoLinha}><span>% executado</span><strong>{pctExecutado.toFixed(1)}%</strong></div>
            </div>
          )}

          {carregandoMedicoes && <p className={styles.vazio}>Carregando…</p>}
          {!carregandoMedicoes && medicoes.length === 0 && <p className={styles.vazio}>Nenhuma medição lançada.</p>}
          {medicoes.map(m => (
            <button key={m.id} className={styles.card}
              onClick={() => navigate(`/contratos/${contrato.id}/medicoes/${m.id}`)}>
              <div className={styles.cardTopo}>
                <span className={styles.cardNumero}>{m.numero}ª medição</span>
                <span className={`${styles.chip} ${styles[`chip_${m.status}`]}`}>{STATUS_MEDICAO_LABEL[m.status]}</span>
              </div>
              <div className={styles.cardDesc}>{fmtData(m.data_inicio)} a {fmtData(m.data_fim)}</div>
              <div className={styles.cardRodape}>
                <span>Bruto: R$ {formatarMoeda(m.valor_bruto)}</span>
                <span>Retenção: R$ {formatarMoeda(m.valor_retido)}</span>
                <span>Líquido: R$ {formatarMoeda(m.valor_liquido)}</span>
              </div>
            </button>
          ))}
        </div>
      )}
```

- [ ] **Step 4: Adicionar as classes CSS novas em `ContratoForm.module.css`**

`.resumoLinha` (copiado de `MedicaoForm.module.css:103-108`), mais um separador visual, e o
padrão de card já usado em `Contratos.module.css:61-91` (aqui sem `.cardDesc` genérico — a versão
de `Contratos.module.css` já serve, só falta declarar localmente porque `ContratoForm.module.css`
é um arquivo CSS Module separado). Adicionar no fim de `ContratoForm.module.css`:

```css
.resumoAcompanhamento {
  margin-bottom: 14px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--cinza-200);
}

.resumoLinha {
  display: flex;
  justify-content: space-between;
  font-size: 14px;
  padding: 4px 0;
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

.chip_aprovada { background: #e3f4e3; color: #1e6b2e; }
.chip_cancelada { background: #fde5e5; color: #942828; }
```

(`.chip_rascunho` já existe em `ContratoForm.module.css:37` pro status do contrato e é
reaproveitado aqui pro status `rascunho` da medição — mesma cor cinza, sem precisar duplicar.
`.chip_aprovada`/`.chip_cancelada` usam exatamente os mesmos tokens de cor já usados em
`MedicaoForm.module.css` pros mesmos status.)

- [ ] **Step 5: Build e teste manual com dado real**

```bash
npm run build
```

Testar no navegador como admin, no CT-001 (JFC, Tharsos Imperial):
1. Confirmar que o painel aparece (contrato está `ativo`) e mostra zeros no resumo (a única
   medição real está `cancelada`, não conta).
2. Confirmar que o card da medição nº1 mostra o chip vermelho "Cancelada" e o período
   14/07/2026 a 14/07/2026 (veio do backfill da Task 1).
3. Criar uma medição de teste nova, lançar alguma quantidade, aprovar como admin — confirmar que
   o resumo passa a refletir os valores (bruto/retenção/líquido/saldo/%). Cancelar a medição de
   teste depois (mesmo padrão de limpeza já usado nesta sessão pros testes de PDF).

- [ ] **Step 6: Commit**

```bash
git add src/pages/ContratoForm.tsx src/pages/ContratoForm.module.css
git commit -m "feat: adiciona painel de acompanhamento (resumo + cards) na tela de contrato"
```

---

## Revisão obrigatória

Ao final das 4 tasks, Codex deve reportar como fez nas entregas anteriores (Fase 3a, cancelamento
de medição) para que o Claude Code revise antes de qualquer teste de campo real: a Task 1 remove
uma coluna de uma tabela em produção e a Task 2 troca a assinatura de uma RPC (`DROP FUNCTION` +
`CREATE`) — as duas entram na categoria de risco do protocolo
(`docs/colaboracao-codex-claude.md`) que exige revisão pós-commit.
