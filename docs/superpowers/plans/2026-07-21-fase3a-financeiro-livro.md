# Fase 3a — Financeiro: Livro de Lançamentos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Responsável pela implementação:** Codex (execução contínua padrão do projeto — ver
> `docs/colaboracao-codex-claude.md`). Claude Code fez a arquitetura (spec) e este plano; a
> categoria de risco (RLS nova + tabela nova + trigger que escreve entre módulos) exige revisão
> obrigatória do Claude Code **pós-commit**, antes de qualquer teste de campo com dados reais
> (ver `docs/colaboracao-codex-claude.md`, categorias de risco).

**Goal:** Criar o livro de lançamentos financeiros (`lancamentos_financeiros`) que ingere
automaticamente o valor já calculado por Medições de empreiteiro e por Compras/NF, aceita
lançamento avulso manual, e separa custo incorrido ("a pagar") de pagamento efetivado ("pago").

**Architecture:** Tabela nova com FK tipada por origem (não ponteiro polimórfico), dois triggers
`SECURITY DEFINER` de ingestão automática (um por origem), tela nova `/financeiro` reaproveitando
o componente `AplicacaoCascata` já existente, e um script de importação de histórico preparado
para quando o Rodrigo enviar a planilha atualizada.

**Tech Stack:** Supabase (Postgres + RLS) + React 19 + TypeScript + Vite. Sem framework de
testes no projeto — verificação por SQL direto (via `apply_migration`/`execute_sql`) para as
migrações, e `npm run build` + teste manual no navegador para o frontend, mesmo padrão já usado
neste repositório.

## Global Constraints

- Nenhuma edição concorrente com o Codex em arquivos que ele já esteja usando — confirmar
  responsável ativo antes de começar (`docs/colaboracao-codex-claude.md`).
- Todo lançamento grava autor e data/hora (CLAUDE.md §6.1) — sem exceção.
- Cláusula de SELECT para soft delete é sempre `ativo = true OR pode_editar_financeiro()` — nunca
  só `ativo = true` sozinho onde há inativação possível (CLAUDE.md §3). **Exceção deliberada
  nesta spec:** a tabela `lancamentos_financeiros` desta fase não tem nenhum fluxo de inativação
  (não há "excluir lançamento" no escopo), então a policy de SELECT usa
  `ativo = true AND pode_editar_financeiro()` (ver Task 1) — revisitar se um fluxo de inativação
  for adicionado depois.
- Toda função `SECURITY DEFINER` precisa de `SET search_path = public` desde a criação (gap já
  fechado uma vez em 19/07/2026 — não repetir).
- Isolamento por obra em toda tabela nova via policy `RESTRICTIVE FOR ALL` com
  `pode_acessar_obra(obra_id)`.
- Cliente não vê `/financeiro` nesta fase (RLS via `pode_editar_financeiro()`, que nunca é
  verdadeiro para `papel = 'cliente'`).
- Produção própria está **fora de escopo** — não criar nenhuma FK nem trigger relacionada a
  `producao_medicoes` nesta fase.
- Spec completa em `docs/superpowers/specs/2026-07-21-fase3a-financeiro-livro-design.md` — ler
  antes de implementar qualquer task, principalmente §3 (modelo de dados) e §10 (importação de
  histórico).

---

### Task 1: Migração — schema base, permissão e RLS

**Files:**
- Create: `supabase/migrations/20260721_fase3a_financeiro.sql`

**Interfaces:**
- Produces: tabela `lancamentos_financeiros`, enum `status_lancamento_financeiro`, função
  `pode_editar_financeiro()` — usados por todas as tasks seguintes.

- [ ] **Step 1: Escrever a migração**

Criar `supabase/migrations/20260721_fase3a_financeiro.sql`:

```sql
-- Fase 3a — Financeiro: livro de lançamentos (contas a pagar + gasto avulso).
-- Ver docs/superpowers/specs/2026-07-21-fase3a-financeiro-livro-design.md

CREATE TYPE status_lancamento_financeiro AS ENUM ('a_pagar', 'pago');

CREATE TABLE lancamentos_financeiros (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  obra_id             UUID NOT NULL REFERENCES obras(id) ON DELETE CASCADE,
  unidade_id          UUID REFERENCES unidades(id),
  etapa_id            UUID REFERENCES etapas(id),
  servico_id          UUID REFERENCES servicos(id),
  descricao           TEXT NOT NULL,
  favorecido          TEXT NOT NULL,
  valor               NUMERIC(14,2) NOT NULL CHECK (valor > 0),

  -- origem: exatamente uma preenchida, ou nenhuma (avulso/histórico) — FK tipada
  medicao_item_id     UUID REFERENCES medicoes_itens(id),
  pedido_item_id      UUID REFERENCES pedidos_compra_itens(id),
  CONSTRAINT origem_unica CHECK (
    (CASE WHEN medicao_item_id IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN pedido_item_id  IS NOT NULL THEN 1 ELSE 0 END) <= 1
  ),

  status              status_lancamento_financeiro NOT NULL DEFAULT 'a_pagar',
  data_vencimento      DATE,
  data_pagamento       DATE,
  forma_pagamento      TEXT,
  conta_origem         TEXT,
  observacao           TEXT,

  ativo               BOOLEAN NOT NULL DEFAULT true,
  criado_por          UUID NOT NULL DEFAULT auth.uid() REFERENCES perfis_usuario(id),
  criado_em           TIMESTAMPTZ NOT NULL DEFAULT now(),
  pago_por            UUID REFERENCES perfis_usuario(id),
  pago_em             TIMESTAMPTZ,
  CHECK (status = 'a_pagar' OR (data_pagamento IS NOT NULL AND forma_pagamento IS NOT NULL))
);

CREATE INDEX idx_lancamentos_obra_vencimento
  ON lancamentos_financeiros(obra_id, data_vencimento)
  WHERE ativo AND status = 'a_pagar';

-- ---------- permissão ----------
CREATE OR REPLACE FUNCTION pode_editar_financeiro()
RETURNS boolean LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT meu_papel() = 'admin'
    OR (meu_papel() = 'equipe' AND 'financeiro' = ANY(meus_modulos()))
$$;

-- ---------- RLS ----------
ALTER TABLE lancamentos_financeiros ENABLE ROW LEVEL SECURITY;

CREATE POLICY lf_select ON lancamentos_financeiros FOR SELECT TO authenticated
  USING (ativo = true AND pode_editar_financeiro());

CREATE POLICY lf_insert ON lancamentos_financeiros FOR INSERT TO authenticated
  WITH CHECK (pode_editar_financeiro() AND criado_por = auth.uid());

CREATE POLICY lf_update ON lancamentos_financeiros FOR UPDATE TO authenticated
  USING (pode_editar_financeiro() AND status = 'a_pagar')
  WITH CHECK (pode_editar_financeiro());

CREATE POLICY isolamento_obra ON lancamentos_financeiros AS RESTRICTIVE FOR ALL TO authenticated
  USING (pode_acessar_obra(obra_id))
  WITH CHECK (pode_acessar_obra(obra_id));
```

- [ ] **Step 2: Aplicar a migração**

Usar `apply_migration` (MCP Supabase) com `name: "fase3a_financeiro"` e o conteúdo acima, no
projeto `rt-gestao-obra` (`yxshldsfmbmbzdkcymca`).

- [ ] **Step 3: Verificar**

Rodar via `execute_sql`:

```sql
SELECT p.proname, p.prosecdef, p.proconfig FROM pg_proc p WHERE p.proname = 'pode_editar_financeiro';
```

Expected: 1 linha, `prosecdef = false`, `proconfig` contendo `search_path=public` (mesmo padrão
de `pode_editar_almoxarifado`, não `SECURITY DEFINER`).

```sql
SELECT tablename, policyname, cmd FROM pg_policies WHERE tablename = 'lancamentos_financeiros' ORDER BY policyname;
```

Expected: 4 policies (`isolamento_obra`, `lf_insert`, `lf_select`, `lf_update`).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260721_fase3a_financeiro.sql
git commit -m "feat: cria tabela lancamentos_financeiros e permissao do modulo financeiro"
```

---

### Task 2: Migração — ingestão automática de Medições de empreiteiro

**Files:**
- Create: `supabase/migrations/20260721_fase3a_financeiro_medicoes.sql`

**Interfaces:**
- Consumes: `lancamentos_financeiros` (Task 1); tabelas existentes `medicoes`, `medicoes_itens`,
  `contratos`, `contratos_itens`, `empreiteiros`, `servicos`.
- Produces: trigger que popula `lancamentos_financeiros.medicao_item_id` quando uma medição é
  aprovada — Task 4 (interface) exibe o badge "Medição" a partir desse campo preenchido.

- [ ] **Step 1: Escrever a migração**

Criar `supabase/migrations/20260721_fase3a_financeiro_medicoes.sql`:

```sql
-- Fase 3a — Financeiro: ingestao automatica de medicoes de empreiteiro aprovadas.

CREATE OR REPLACE FUNCTION financeiro_ingerir_medicao()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_obra_id UUID;
  v_favorecido TEXT;
BEGIN
  IF NEW.status = 'aprovada' AND (OLD.status IS DISTINCT FROM 'aprovada') THEN
    SELECT c.obra_id, e.nome INTO v_obra_id, v_favorecido
    FROM contratos c JOIN empreiteiros e ON e.id = c.empreiteiro_id
    WHERE c.id = NEW.contrato_id;

    INSERT INTO lancamentos_financeiros (
      obra_id, unidade_id, etapa_id, servico_id, descricao, favorecido, valor,
      medicao_item_id, criado_por
    )
    SELECT
      v_obra_id, ci.unidade_id, s.etapa_id, ci.servico_id,
      'Medição ' || NEW.numero || ' — ' || s.nome,
      v_favorecido,
      ROUND(mi.valor_total_item * (NEW.valor_liquido / NEW.valor_bruto), 2),
      mi.id,
      NEW.aprovada_por
    FROM medicoes_itens mi
    JOIN contratos_itens ci ON ci.id = mi.contrato_item_id
    JOIN servicos s ON s.id = ci.servico_id
    WHERE mi.medicao_id = NEW.id AND mi.ativo = true;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_financeiro_ingerir_medicao
  AFTER UPDATE ON medicoes
  FOR EACH ROW EXECUTE FUNCTION financeiro_ingerir_medicao();

-- Backfill: medições já aprovadas antes desta migração existir (hoje: 1 real — ver spec §2/§10,
-- contrato JFC Instalações). Idempotente (NOT EXISTS), seguro rodar mais de uma vez.
INSERT INTO lancamentos_financeiros (
  obra_id, unidade_id, etapa_id, servico_id, descricao, favorecido, valor,
  medicao_item_id, criado_por
)
SELECT
  c.obra_id, ci.unidade_id, s.etapa_id, ci.servico_id,
  'Medição ' || m.numero || ' — ' || s.nome,
  e.nome,
  ROUND(mi.valor_total_item * (m.valor_liquido / m.valor_bruto), 2),
  mi.id,
  m.aprovada_por
FROM medicoes m
JOIN contratos c ON c.id = m.contrato_id
JOIN empreiteiros e ON e.id = c.empreiteiro_id
JOIN medicoes_itens mi ON mi.medicao_id = m.id AND mi.ativo = true
JOIN contratos_itens ci ON ci.id = mi.contrato_item_id
JOIN servicos s ON s.id = ci.servico_id
WHERE m.status = 'aprovada'
  AND NOT EXISTS (
    SELECT 1 FROM lancamentos_financeiros lf WHERE lf.medicao_item_id = mi.id
  );
```

- [ ] **Step 2: Aplicar a migração**

`apply_migration` com `name: "fase3a_financeiro_medicoes"`, projeto `yxshldsfmbmbzdkcymca`.

- [ ] **Step 3: Verificar o backfill da medição já aprovada**

```sql
SELECT descricao, favorecido, valor, medicao_item_id IS NOT NULL AS tem_origem
FROM lancamentos_financeiros ORDER BY criado_em;
```

Expected: pelo menos 1 linha com `favorecido` contendo o nome do empreiteiro do contrato ativo
(JFC Instalações), `tem_origem = true`, e a soma dos valores batendo com `medicoes.valor_liquido`
(R$ 96.448,75, a menos que já tenham entrado novos dados reais desde a spec).

- [ ] **Step 4: Verificar que o trigger dispara pra uma nova aprovação (smoke test, dado
  descartável)**

Em transação com `ROLLBACK` (não aplicar de verdade), simular:

```sql
BEGIN;
-- usar um contrato/medicao de teste já existente em status 'rascunho', ou criar um descartável
-- ...UPDATE medicoes SET status = 'aprovada', aprovada_por = <um perfil real>, aprovada_em = now() WHERE id = '<id de teste>';
-- SELECT * FROM lancamentos_financeiros WHERE medicao_item_id IN (SELECT id FROM medicoes_itens WHERE medicao_id = '<id de teste>');
ROLLBACK;
```

Se não houver dado de teste seguro disponível, documentar no relatório da task que este passo
foi pulado e por quê — não usar dado real da obra piloto pra esse teste.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260721_fase3a_financeiro_medicoes.sql
git commit -m "feat: ingestao automatica de medicoes de empreiteiro no livro financeiro"
```

---

### Task 3: Compras — valor por item na conferência de NF + ingestão automática

**Files:**
- Modify: `src/pages/CompraForm.tsx` (seção "Conferência com nota fiscal" dentro de
  `DetalhePedido`)
- Create: `supabase/migrations/20260721_fase3a_financeiro_compras.sql`

**Interfaces:**
- Consumes: `lancamentos_financeiros` (Task 1); `pedidos_compra_itens.valor_recebido` (coluna já
  existente, hoje nunca escrita — ver spec §4).
- Produces: trigger que popula `lancamentos_financeiros.pedido_item_id` quando
  `valor_recebido` passa de `NULL` para preenchido.

**Pré-requisito confirmado na spec:** `pedidos_compra_itens.valor_recebido` existe na tabela e já
é lida em `CompraForm.tsx` (linhas ~958,977, conferência tripla) mas nunca é escrita — a tela
"Conferência com nota fiscal" hoje só anexa o arquivo da NF e uma observação. Este task adiciona
o campo que faltava.

- [ ] **Step 1: Confirmar o texto atual de `registrarNf()`**

Em `src/pages/CompraForm.tsx`, a função `registrarNf()` (verificada em 21/07/2026, pode ter
shiftado de linha mas o conteúdo deve bater) é exatamente:

```tsx
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
    if (error) {
      setSalvandoRecebimento(false)
      setMsgRecebimento({ tipo: 'erro', texto: `Falha ao registrar a NF: ${error.message}` })
      return
    }
    if (['recebido_parcial', 'recebido_total'].includes(pedido.status)) {
      const { error: eStatus } = await supabase.from('pedidos_compra').update({ status: 'conferido_nf' }).eq('id', pedido.id)
      if (eStatus) {
        setSalvandoRecebimento(false)
        setMsgRecebimento({ tipo: 'erro', texto: `NF registrada, mas falhou ao atualizar o status do pedido: ${eStatus.message}` })
        onRecarregar()
        return
      }
    }
    setSalvandoRecebimento(false)
    setArquivoNf(null); setObsNf('')
    setMsgRecebimento({ tipo: 'ok', texto: 'NF registrada.' })
    onRecarregar()
  }
```

Se o texto encontrado divergir significativamente disso (não só números de linha), reportar o
que mudou em vez de adaptar às cegas.

- [ ] **Step 2: Adicionar estado para os valores por item**

Junto às outras declarações de estado de `DetalhePedido` (perto de `arquivoNf`/`obsNf`),
adicionar:

```tsx
  const [valoresNf, setValoresNf] = useState<Record<string, string>>({})
```

- [ ] **Step 3: Adicionar os campos de valor por item no formulário de conferência**

No bloco JSX "Conferência com nota fiscal", antes do campo "Observação", adicionar um input de
valor por item (só para itens ainda sem `valor_recebido`):

```tsx
          {itens.filter(it => it.valor_recebido === null).map(it => (
            <label key={it.id} className={styles.campo}>
              Valor da NF — {it.descricao_item} ({it.und})
              <input type="number" min="0" step="0.01" value={valoresNf[it.id] ?? ''}
                onChange={e => setValoresNf(prev => ({ ...prev, [it.id]: e.target.value }))} />
            </label>
          ))}
```

- [ ] **Step 4: Gravar os valores ao registrar a NF**

Substituir o corpo completo de `registrarNf()` (texto confirmado no Step 1) por:

```tsx
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
    if (error) {
      setSalvandoRecebimento(false)
      setMsgRecebimento({ tipo: 'erro', texto: `Falha ao registrar a NF: ${error.message}` })
      return
    }
    const itensComValor = Object.entries(valoresNf).filter(([, v]) => Number(v) > 0)
    if (itensComValor.length > 0) {
      const resultados = await Promise.all(
        itensComValor.map(([itemId, valor]) =>
          supabase.from('pedidos_compra_itens').update({ valor_recebido: Number(valor) }).eq('id', itemId)
        )
      )
      const erroValor = resultados.find(r => r.error)
      if (erroValor?.error) {
        setSalvandoRecebimento(false)
        setMsgRecebimento({ tipo: 'erro', texto: `NF registrada, mas falhou ao gravar valor de algum item: ${erroValor.error.message}` })
        onRecarregar()
        return
      }
    }
    if (['recebido_parcial', 'recebido_total'].includes(pedido.status)) {
      const { error: eStatus } = await supabase.from('pedidos_compra').update({ status: 'conferido_nf' }).eq('id', pedido.id)
      if (eStatus) {
        setSalvandoRecebimento(false)
        setMsgRecebimento({ tipo: 'erro', texto: `NF registrada, mas falhou ao atualizar o status do pedido: ${eStatus.message}` })
        onRecarregar()
        return
      }
    }
    setSalvandoRecebimento(false)
    setArquivoNf(null); setObsNf(''); setValoresNf({})
    setMsgRecebimento({ tipo: 'ok', texto: 'NF registrada.' })
    onRecarregar()
  }
```

A gravação por item entra logo depois do `INSERT` em `recebimentos_nf` ter sucesso e antes da
atualização de status do pedido — assim, se falhar ao gravar o valor de um item, o status do
pedido ainda não avançou para `conferido_nf`, evitando um estado inconsistente (NF conferida sem
todos os valores gravados).

- [ ] **Step 5: Escrever a migração de ingestão**

Criar `supabase/migrations/20260721_fase3a_financeiro_compras.sql`:

```sql
-- Fase 3a — Financeiro: ingestao automatica de itens de compra com NF conferida.

CREATE OR REPLACE FUNCTION financeiro_ingerir_compra_item()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_obra_id UUID;
  v_favorecido TEXT;
  v_etapa_id UUID;
BEGIN
  IF NEW.valor_recebido IS NOT NULL AND OLD.valor_recebido IS NULL THEN
    SELECT p.obra_id INTO v_obra_id FROM pedidos_compra p WHERE p.id = NEW.pedido_id;

    SELECT f.nome INTO v_favorecido
    FROM cotacoes_itens cit
    JOIN cotacoes cot ON cot.id = cit.cotacao_id
    JOIN fornecedores f ON f.id = cot.fornecedor_id
    WHERE cit.id = NEW.cotacao_item_vencedora_id;

    IF NEW.servico_id IS NOT NULL THEN
      SELECT s.etapa_id INTO v_etapa_id FROM servicos s WHERE s.id = NEW.servico_id;
    END IF;

    INSERT INTO lancamentos_financeiros (
      obra_id, etapa_id, servico_id, descricao, favorecido, valor,
      pedido_item_id, criado_por
    ) VALUES (
      v_obra_id, v_etapa_id, NEW.servico_id, NEW.descricao_item,
      COALESCE(v_favorecido, 'Fornecedor não identificado — ver pedido de compra'),
      NEW.valor_recebido, NEW.id, auth.uid()
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_financeiro_ingerir_compra_item
  AFTER UPDATE OF valor_recebido ON pedidos_compra_itens
  FOR EACH ROW EXECUTE FUNCTION financeiro_ingerir_compra_item();
```

Nota: `servico_id`/`etapa_id` nascem `NULL` quando o item está "a classificar" — o lançamento
ainda é criado (não pode travar o fluxo de Compras), fica na fila a classificar (Task 4 trata a
exibição disso).

- [ ] **Step 6: Aplicar a migração**

`apply_migration` com `name: "fase3a_financeiro_compras"`, projeto `yxshldsfmbmbzdkcymca`.

- [ ] **Step 7: Verificar**

Rodar `npm run build` (a partir da raiz do projeto) — confirma que `CompraForm.tsx` continua
compilando sem erros de tipo.

Depois, com `npm run dev` rodando, abrir um pedido de compra em status `recebido_parcial` ou
`recebido_total` (ou levar um pedido de teste até esse status) e:
1. Confirmar que aparece um campo de valor por item na seção "Conferência com nota fiscal".
2. Preencher um valor, anexar a NF e registrar.
3. Confirmar no banco (`SELECT * FROM lancamentos_financeiros WHERE pedido_item_id IS NOT NULL`)
   que o lançamento foi criado com o valor e o fornecedor certos.
4. Repetir a conferência tripla existente (linhas 958/977) e confirmar que ela mostra o valor
   preenchido corretamente (não devia ter mudado, só passou a ter dado real pela primeira vez).

- [ ] **Step 8: Commit**

```bash
git add src/pages/CompraForm.tsx supabase/migrations/20260721_fase3a_financeiro_compras.sql
git commit -m "feat: registra valor da NF por item e ingere automaticamente no livro financeiro"
```

---

### Task 4: Tela `/financeiro`

**Files:**
- Modify: `src/lib/supabase.ts` (tipos novos)
- Modify: `src/App.tsx` (trocar o placeholder `EmConstrucao` pela tela real)
- Create: `src/pages/Financeiro.tsx`
- Create: `src/pages/Financeiro.module.css`

**Interfaces:**
- Consumes: `lancamentos_financeiros` (Tasks 1-3); `AplicacaoCascata` (já existente, prop
  contract `{ unidades, etapas, servicos, servicoId, onSelecionar }`); `diasEntre`/`dataHoje` de
  `src/lib/almoxarifado.ts`; `formatarMoeda` de `src/lib/formato.ts`.
- Nota: **não** é preciso mexer em `src/components/Layout.tsx` (o item de menu "Financeiro" já
  existe, gated por `temModulo('financeiro')`) nem em `src/pages/Usuarios.tsx` (o checkbox
  "Financeiro" já existe na lista de módulos) — ambos já foram adicionados preventivamente antes
  desta fase.

- [ ] **Step 1: Adicionar os tipos em `src/lib/supabase.ts`**

Junto aos demais tipos do arquivo (perto de `FerramentaLocacao` ou de `PedidoCompraItem`),
adicionar:

```ts
export type StatusLancamentoFinanceiro = 'a_pagar' | 'pago'
export interface LancamentoFinanceiro {
  id: string
  obra_id: string
  unidade_id: string | null
  etapa_id: string | null
  servico_id: string | null
  descricao: string
  favorecido: string
  valor: number
  medicao_item_id: string | null
  pedido_item_id: string | null
  status: StatusLancamentoFinanceiro
  data_vencimento: string | null
  data_pagamento: string | null
  forma_pagamento: string | null
  conta_origem: string | null
  observacao: string | null
  ativo: boolean
  criado_por: string
  criado_em: string
  pago_por: string | null
  pago_em: string | null
}
```

- [ ] **Step 2: Criar o CSS module**

Criar `src/pages/Financeiro.module.css` reaproveitando as classes já estabelecidas em
`Almoxarifado.module.css` — copiar (não importar entre módulos, CSS modules não permitem) as
classes usadas neste componente: `.page`, `.header`, `.sub`, `.topoAcoes`, `.btnPrincipal`,
`.btnSecundario`, `.filtros`, `.busca`, `.selectFiltro`, `.alertaLocacoes` (mantido com esse
nome — funcionalmente idêntico ao padrão já revisado em Aluguel de Ferramentas), `.lista`,
`.linha`, `.linhaInfo`, `.linhaTopo`, `.linhaNome`, `.linhaDesc`, `.linhaMeta`, `.painelForm`,
`.painelHeader`, `.btnFechar`, `.linha2`, `.campo`, `.msgOk`, `.msgErro`, `.vazio`.

O componente usa `styles[\`chip_${estado}\`]` para 6 valores possíveis de `EstadoVencimento`
(Step 3) — criar exatamente estas 6 classes, todas variantes de `.chip` (mesma base já usada em
Almoxarifado: `border-radius: 999px`, `padding`, `font-size`, `font-weight`):

- `.chip_sem_data` — cinza neutro (`var(--cinza-600)` sobre `var(--cinza-100)`), não é alerta,
  é "ainda não preenchido".
- `.chip_em_dia` — navy sobre `#edf4fa` (mesmo tom de `chip_em_dia` em Almoxarifado).
- `.chip_vence_amanha` — `var(--alerta)` sobre `#fdf3d7`, `font-weight: 800`.
- `.chip_vence_hoje` — `var(--erro)` sobre `#fdeaea`, `font-weight: 800`.
- `.chip_vencida` — `var(--erro)` sobre `#fdeaea`, `font-weight: 900`.
- `.chip_pago` — `var(--sucesso)` sobre `#e3f4e3`.

- [ ] **Step 3: Criar a tela**

Criar `src/pages/Financeiro.tsx`:

```tsx
import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useObra } from '../contexts/ObraContext'
import { supabase, type LancamentoFinanceiro, type StatusLancamentoFinanceiro, type Unidade, type Etapa, type Servico } from '../lib/supabase'
import { dataHoje, diasEntre } from '../lib/almoxarifado'
import { formatarMoeda } from '../lib/formato'
import AplicacaoCascata from '../components/AplicacaoCascata'
import { useConfirmDialog } from '../components/ConfirmDialogContext'
import styles from './Financeiro.module.css'

type EstadoVencimento = 'sem_data' | 'em_dia' | 'vence_amanha' | 'vence_hoje' | 'vencida' | 'pago'
type FiltroStatus = '' | StatusLancamentoFinanceiro

const ESTADO_LABEL: Record<EstadoVencimento, string> = {
  sem_data: 'Sem vencimento definido',
  em_dia: 'Em dia',
  vence_amanha: 'Vence amanhã',
  vence_hoje: 'Vence hoje',
  vencida: 'Vencida',
  pago: 'Pago',
}

function estadoDoLancamento(l: LancamentoFinanceiro): { estado: EstadoVencimento; dias: number } {
  if (l.status === 'pago') return { estado: 'pago', dias: 0 }
  if (!l.data_vencimento) return { estado: 'sem_data', dias: 0 }
  const dias = diasEntre(dataHoje(), l.data_vencimento)
  if (dias < 0) return { estado: 'vencida', dias: Math.abs(dias) }
  if (dias === 0) return { estado: 'vence_hoje', dias: 0 }
  if (dias === 1) return { estado: 'vence_amanha', dias: 1 }
  return { estado: 'em_dia', dias }
}

// Supabase limita 1000 linhas por consulta — pagina até trazer tudo
async function carregarTodosServicos(): Promise<Servico[]> {
  const todos: Servico[] = []
  const PAGINA = 1000
  for (let de = 0; ; de += PAGINA) {
    const { data } = await supabase.from('servicos').select('*').eq('ativo', true).order('codigo')
      .range(de, de + PAGINA - 1)
    const lote = data ?? []
    todos.push(...lote)
    if (lote.length < PAGINA) break
  }
  return todos
}

async function carregarUnidadesEEtapas(obraId: string): Promise<{ unidades: Unidade[]; etapas: Etapa[] }> {
  const { data: unis } = await supabase.from('unidades').select('*').eq('obra_id', obraId).order('ordem')
  const listaUnidades = unis ?? []
  const uniIds = listaUnidades.map(u => u.id)
  if (uniIds.length === 0) return { unidades: listaUnidades, etapas: [] }
  const { data: etps } = await supabase.from('etapas').select('*').in('unidade_id', uniIds).eq('placeholder', false).order('ordem')
  return { unidades: listaUnidades, etapas: etps ?? [] }
}

export default function Financeiro() {
  const { perfil } = useAuth()
  const { obraAtiva } = useObra()
  const { confirmar } = useConfirmDialog()

  const [lancamentos, setLancamentos] = useState<LancamentoFinanceiro[]>([])
  const [unidades, setUnidades] = useState<Unidade[]>([])
  const [etapas, setEtapas] = useState<Etapa[]>([])
  const [servicos, setServicos] = useState<Servico[]>([])
  const [carregando, setCarregando] = useState(true)
  const [busca, setBusca] = useState('')
  const [filtroStatus, setFiltroStatus] = useState<FiltroStatus>('')
  const [mostrarNovo, setMostrarNovo] = useState(false)
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)

  async function carregar() {
    if (!obraAtiva) return
    setCarregando(true)
    const { data, error } = await supabase.from('lancamentos_financeiros').select('*')
      .eq('obra_id', obraAtiva.id).order('data_vencimento', { nullsFirst: true })
    setCarregando(false)
    if (error) {
      setMsg({ tipo: 'erro', texto: `Erro ao carregar lançamentos: ${error.message}` })
      return
    }
    setLancamentos(data ?? [])
  }

  useEffect(() => { carregar() }, [obraAtiva])
  useEffect(() => { carregarTodosServicos().then(setServicos) }, [])
  useEffect(() => {
    if (!obraAtiva) return
    carregarUnidadesEEtapas(obraAtiva.id).then(({ unidades, etapas }) => {
      setUnidades(unidades)
      setEtapas(etapas)
    })
  }, [obraAtiva])

  const linhas = useMemo(() => {
    const termo = busca.trim().toLowerCase()
    const peso: Record<EstadoVencimento, number> = { vencida: 0, vence_hoje: 1, vence_amanha: 2, sem_data: 3, em_dia: 4, pago: 5 }
    return lancamentos
      .map(l => ({ lancamento: l, ...estadoDoLancamento(l) }))
      .filter(l =>
        (!termo || l.lancamento.descricao.toLowerCase().includes(termo) || l.lancamento.favorecido.toLowerCase().includes(termo)) &&
        (!filtroStatus || l.lancamento.status === filtroStatus)
      )
      .sort((a, b) => peso[a.estado] - peso[b.estado])
  }, [lancamentos, busca, filtroStatus])

  const resumoAlertas = useMemo(() => {
    const abertos = lancamentos.map(estadoDoLancamento)
    return {
      vencidos: abertos.filter(l => l.estado === 'vencida').length,
      hoje: abertos.filter(l => l.estado === 'vence_hoje').length,
      amanha: abertos.filter(l => l.estado === 'vence_amanha').length,
    }
  }, [lancamentos])

  async function darBaixa(l: LancamentoFinanceiro) {
    if (!perfil) return
    const dataPagamento = dataHoje()
    if (!await confirmar({
      titulo: 'Dar baixa no pagamento',
      mensagem: `Confirma que "${l.descricao}" (R$ ${formatarMoeda(l.valor)}) foi pago?`,
      confirmarTexto: 'Confirmar pagamento',
    })) return
    const { error } = await supabase.from('lancamentos_financeiros').update({
      status: 'pago', data_pagamento: dataPagamento, forma_pagamento: 'Não informado',
      pago_por: perfil.id, pago_em: new Date().toISOString(),
    }).eq('id', l.id).eq('status', 'a_pagar')
    if (error) {
      setMsg({ tipo: 'erro', texto: `Falha ao dar baixa: ${error.message}` })
      return
    }
    await carregar()
    setMsg({ tipo: 'ok', texto: 'Baixa registrada.' })
  }

  if (perfil?.papel === 'cliente') {
    return (
      <div className={styles.page}>
        <h1>Financeiro</h1>
        <p className={styles.vazio}>Este módulo é de uso interno da equipe de obra.</p>
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1>Financeiro</h1>
          <p className={styles.sub}>Contas a pagar e lançamentos vinculados ao orçamento.</p>
        </div>
      </div>

      <div className={styles.topoAcoes}>
        <button className={styles.btnPrincipal} onClick={() => setMostrarNovo(true)}>+ Lançamento avulso</button>
      </div>

      {mostrarNovo && (
        <PainelLancamentoAvulso
          unidades={unidades} etapas={etapas} servicos={servicos}
          onFechar={() => setMostrarNovo(false)}
          onSucesso={async () => {
            setMostrarNovo(false)
            await carregar()
            setMsg({ tipo: 'ok', texto: 'Lançamento cadastrado.' })
          }}
        />
      )}

      {(resumoAlertas.vencidos > 0 || resumoAlertas.hoje > 0 || resumoAlertas.amanha > 0) && (
        <div className={styles.alertaLocacoes}>
          {resumoAlertas.vencidos > 0 && <span>{resumoAlertas.vencidos} vencido(s)</span>}
          {resumoAlertas.hoje > 0 && <span>{resumoAlertas.hoje} vence(m) hoje</span>}
          {resumoAlertas.amanha > 0 && <span>{resumoAlertas.amanha} vence(m) amanhã</span>}
        </div>
      )}

      <div className={styles.filtros}>
        <input className={styles.busca} value={busca} onChange={e => setBusca(e.target.value)}
          placeholder="Buscar por descrição ou favorecido…" />
        <select className={styles.selectFiltro} value={filtroStatus} onChange={e => setFiltroStatus(e.target.value as FiltroStatus)}>
          <option value="">Todos os status</option>
          <option value="a_pagar">A pagar</option>
          <option value="pago">Pago</option>
        </select>
      </div>

      {msg && <p className={msg.tipo === 'ok' ? styles.msgOk : styles.msgErro}>{msg.texto}</p>}
      {carregando && <p className={styles.vazio}>Carregando…</p>}
      {!carregando && linhas.length === 0 && (
        <p className={styles.vazio}>
          {lancamentos.length === 0 ? 'Nenhum lançamento cadastrado.' : 'Nenhum lançamento com esses filtros.'}
        </p>
      )}

      {!carregando && linhas.length > 0 && (
        <div className={styles.lista}>
          {linhas.map(({ lancamento: l, estado }) => {
            const semVinculo = !l.etapa_id
            return (
              <div key={l.id} className={styles.linha}>
                <div className={styles.linhaInfo}>
                  <div className={styles.linhaTopo}>
                    <span className={styles.linhaNome}>{l.descricao}</span>
                    <span className={`${styles.chip} ${styles[`chip_${estado}`]}`}>{ESTADO_LABEL[estado]}</span>
                  </div>
                  <div className={styles.linhaDesc}>
                    {l.favorecido} · R$ {formatarMoeda(l.valor)}
                    {l.data_vencimento && ` · vencimento ${new Date(l.data_vencimento + 'T00:00:00').toLocaleDateString('pt-BR')}`}
                    {l.medicao_item_id && ' · origem: Medição'}
                    {l.pedido_item_id && ' · origem: Compras'}
                    {!l.medicao_item_id && !l.pedido_item_id && ' · Avulso'}
                  </div>
                  {semVinculo && <div className={styles.linhaDesc}>⚠ fila a classificar — sem etapa/serviço do orçamento vinculado.</div>}
                  {l.observacao && <div className={styles.linhaDesc}>Obs.: {l.observacao}</div>}
                </div>
                <div className={styles.linhaMeta}>
                  {l.status === 'a_pagar' && (
                    <button className={styles.btnSecundario} onClick={() => darBaixa(l)}>Dar baixa</button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

interface PainelLancamentoAvulsoProps {
  unidades: Unidade[]
  etapas: Etapa[]
  servicos: Servico[]
  onFechar: () => void
  onSucesso: () => void
}

function PainelLancamentoAvulso({ unidades, etapas, servicos, onFechar, onSucesso }: PainelLancamentoAvulsoProps) {
  const { obraAtiva } = useObra()

  const [descricao, setDescricao] = useState('')
  const [favorecido, setFavorecido] = useState('')
  const [valor, setValor] = useState('')
  const [servicoId, setServicoId] = useState<string | null>(null)
  const [dataVencimento, setDataVencimento] = useState('')
  const [observacao, setObservacao] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)

  async function salvar() {
    if (!obraAtiva) return
    if (!descricao.trim()) { setMsg({ tipo: 'erro', texto: 'Informe a descrição do gasto.' }); return }
    if (!favorecido.trim()) { setMsg({ tipo: 'erro', texto: 'Informe o favorecido.' }); return }
    if (!(Number(valor) > 0)) { setMsg({ tipo: 'erro', texto: 'Informe um valor maior que zero.' }); return }
    if (!dataVencimento) { setMsg({ tipo: 'erro', texto: 'Informe a data de vencimento.' }); return }

    const servico = servicoId ? servicos.find(s => s.id === servicoId) : undefined
    const etapa = servico ? etapas.find(e => e.id === servico.etapa_id) : undefined

    setSalvando(true)
    setMsg(null)
    const { error } = await supabase.from('lancamentos_financeiros').insert({
      obra_id: obraAtiva.id,
      unidade_id: etapa?.unidade_id ?? null,
      etapa_id: etapa?.id ?? null,
      servico_id: servicoId,
      descricao: descricao.trim(),
      favorecido: favorecido.trim(),
      valor: Number(valor),
      data_vencimento: dataVencimento,
      observacao: observacao.trim() || null,
    })
    setSalvando(false)
    if (error) {
      setMsg({ tipo: 'erro', texto: `Falha ao cadastrar lançamento: ${error.message}` })
      return
    }
    onSucesso()
  }

  return (
    <div className={styles.painelForm}>
      <div className={styles.painelHeader}>
        <h2>Novo lançamento avulso</h2>
        <button className={styles.btnFechar} onClick={onFechar}>✕</button>
      </div>
      <div className={styles.linha2}>
        <label className={styles.campo}>
          Descrição *
          <input value={descricao} onChange={e => setDescricao(e.target.value)} placeholder="Ex.: Taxa de ITBI" />
        </label>
        <label className={styles.campo}>
          Favorecido *
          <input value={favorecido} onChange={e => setFavorecido(e.target.value)} placeholder="Nome de quem recebe" />
        </label>
        <label className={styles.campo}>
          Valor *
          <input type="number" min="0" step="0.01" value={valor} onChange={e => setValor(e.target.value)} />
        </label>
      </div>
      <AplicacaoCascata unidades={unidades} etapas={etapas} servicos={servicos} servicoId={servicoId} onSelecionar={setServicoId} />
      <div className={styles.linha2}>
        <label className={styles.campo}>
          Vencimento *
          <input type="date" value={dataVencimento} onChange={e => setDataVencimento(e.target.value)} />
        </label>
        <label className={styles.campo}>
          Observação
          <input value={observacao} onChange={e => setObservacao(e.target.value)} placeholder="Opcional" />
        </label>
      </div>
      {msg && <p className={msg.tipo === 'ok' ? styles.msgOk : styles.msgErro}>{msg.texto}</p>}
      <button className={styles.btnPrincipal} onClick={salvar} disabled={salvando}>
        {salvando ? 'Salvando…' : 'Cadastrar lançamento'}
      </button>
    </div>
  )
}
```

Nota sobre a ação "Dar baixa": esta implementação simplificada preenche `forma_pagamento = 'Não
informado'` direto ao confirmar, sem um formulário próprio de baixa (data/forma/conta). A spec
(§6, §8) previa uma ação de baixa com esses três campos — **se quem implementar tiver tempo,
considerar expandir para um mini-formulário (data de pagamento editável, forma de pagamento,
conta) em vez do valor fixo acima; se não, registrar como pendência para revisão posterior**, já
que o mínimo funcional (não deixar `pago` sem `forma_pagamento`, conforme o `CHECK` de Task 1) já
está coberto.

- [ ] **Step 4: Trocar o placeholder pela tela real**

Em `src/App.tsx`, adicionar o import lazy junto aos demais (perto de `const Almoxarifado = ...`):

```tsx
const Financeiro = lazy(() => import('./pages/Financeiro'))
```

E trocar a rota existente (linha ~72):

```tsx
        <Route path="financeiro" element={<EmConstrucao modulo="Financeiro" fase={3} />} />
```

por:

```tsx
        <Route path="financeiro" element={<Financeiro />} />
```

- [ ] **Step 5: Verificar**

Rodar `npm run build` — confirma que compila sem erros de tipo.

Com `npm run dev` rodando:
1. Entrar como admin, abrir `/financeiro` — confirmar que a lista carrega (deve mostrar pelo
   menos o lançamento da medição JFC, vindo do backfill da Task 2).
2. Cadastrar um lançamento avulso vinculando Unidade→Etapa→Serviço via `AplicacaoCascata`,
   confirmar que aparece na lista.
3. Dar baixa num lançamento "a pagar" e confirmar que o status muda pra "pago" e o botão some.
4. Tentar acessar `/financeiro` como um usuário `equipe` sem o módulo `financeiro` marcado —
   confirmar que a lista vem vazia (RLS bloqueando a leitura) e considerar se precisa de um gate
   de página como o que existe em Almoxarifado (`Layout.tsx` já esconde o item de menu via
   `temModulo`, mas a rota em si não bloqueia acesso direto por URL — decidir com o Rodrigo se
   isso precisa de um gate explícito na página, seguindo o padrão revisado em Aluguel de
   Ferramentas em 21/07/2026, ou se a lista vazia já é suficiente).
5. Confirmar que `perfil.papel === 'cliente'` vê a mensagem de "uso interno", não a lista.
6. Testar em mobile (celular ou emulação no navegador) — reaproveita classes já testadas em
   Almoxarifado, mas confirmar visualmente.

- [ ] **Step 6: Commit**

```bash
git add src/lib/supabase.ts src/App.tsx src/pages/Financeiro.tsx src/pages/Financeiro.module.css
git commit -m "feat: tela /financeiro com lista de lancamentos e lancamento avulso"
```

---

### Task 5: Script de importação de histórico (preparado, execução pendente)

**Files:**
- Create: `scripts/importar-historico-financeiro.cjs`

**Interfaces:**
- Consumes: `lancamentos_financeiros` (Task 1); tabelas `unidades`, `etapas`, `servicos`
  (para resolver `codigo` → `unidade_id`/`etapa_id`/`servico_id`).
- Produz um arquivo SQL (mesmo padrão de `scripts/importar-orcamento.cjs`) — **não executa a
  importação real nesta task**, porque a planilha do Rodrigo está desatualizada (falta o
  período de final de maio/2026 até hoje — ver spec §10). A execução real acontece depois, numa
  ação separada, quando ele enviar o arquivo atualizado.

- [ ] **Step 1: Escrever o script**

Criar `scripts/importar-historico-financeiro.cjs`:

```js
// Importa o histórico de gastos da planilha "Relatório Thiago Abrantes" para
// lancamentos_financeiros. Ver docs/superpowers/specs/2026-07-21-fase3a-financeiro-livro-design.md §10.
//
// Uso: node scripts/importar-historico-financeiro.cjs <caminho-da-planilha.xlsx> <obra_id>
// Gera scripts/historico_financeiro_import.sql — revisar antes de aplicar.
//
// Exclui automaticamente linhas cuja descrição bata com um contrato/medição já existente no
// app (lista EXCLUSOES abaixo) — ajustar essa lista a cada novo contrato antes de reimportar.

const XLSX = require('xlsx')
const fs = require('fs')

const ARQUIVO = process.argv[2]
const OBRA_ID = process.argv[3]
if (!ARQUIVO || !OBRA_ID) {
  console.error('Uso: node importar-historico-financeiro.cjs <planilha.xlsx> <obra_id>')
  process.exit(1)
}

// Trechos de descrição já cobertos por Contrato/Medição no app — não importar como avulso
// (evita contar em dobro). Adicionar um trecho novo aqui antes de reimportar, para cada
// contrato que passar a ter medição no app.
const EXCLUSOES = [
  'instalações hidrossanitárias (JFC INSTALAÇÕES)',
]

function normalizarValor(v) {
  return Number(String(v).replace(/[^\d,.-]/g, '').replace(/,/g, '')) || 0
}

function normalizarData(v) {
  // planilha usa M/D/AA (ex.: "3/25/24") — Excel já converte com cellDates, mas via header:1
  // vem como string; parse manual pra não depender de locale do Node.
  const m = String(v).match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/)
  if (!m) return null
  const [, mes, dia, ano] = m
  const anoCompleto = ano.length === 2 ? `20${ano}` : ano
  return `${anoCompleto}-${mes.padStart(2, '0')}-${dia.padStart(2, '0')}`
}

function extrairFavorecido(descricao) {
  const m = descricao.match(/\(([^)]+)\)\s*$/)
  return m ? m[1] : descricao
}

const wb = XLSX.readFile(ARQUIVO, { cellDates: true })
const ws = wb.Sheets['RELATÓRIO DESPESAS DE OBRA']
const linhas = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' })

const inserts = []
let excluidas = 0
let semCodigo = 0
let ambiguoSobrado = 0

for (let i = 15; i < linhas.length; i++) {
  const l = linhas[i]
  if (!l[6] || !String(l[6]).trim()) continue // linha vazia
  const data = normalizarData(l[2])
  const codigo = String(l[5]).trim()
  const valor = normalizarValor(l[6])
  const descricaoBruta = String(l[7]).trim()
  const nfRef = String(l[8]).trim()

  if (EXCLUSOES.some(trecho => descricaoBruta.includes(trecho))) { excluidas++; continue }

  const favorecido = extrairFavorecido(descricaoBruta).replace(/'/g, "''")
  const descricao = descricaoBruta.replace(/'/g, "''")
  const nf = nfRef && nfRef !== '-' ? ` (${nfRef})` : ''
  const observacao = `Importado do histórico — planilha Thiago Abrantes${nf}`.replace(/'/g, "''")

  let etapaSql = 'NULL', servicoSql = 'NULL', unidadeSql = 'NULL'
  if (!codigo || codigo === '-' || /validar/i.test(codigo)) {
    semCodigo++
  } else if (/^1\.3\./.test(codigo)) {
    // ambíguo entre os 13 sobrados — vincula só a etapa genérica, resolvido manualmente depois
    ambiguoSobrado++
    etapaSql = `(SELECT id FROM etapas e JOIN unidades u ON u.id = e.unidade_id WHERE e.codigo = '${codigo.replace(/\.\d+$/, '')}' AND u.obra_id = '${OBRA_ID}' LIMIT 1)`
  } else {
    servicoSql = `(SELECT id FROM servicos s JOIN etapas e ON e.id = s.etapa_id JOIN unidades u ON u.id = e.unidade_id WHERE s.codigo = '${codigo}' AND u.obra_id = '${OBRA_ID}' LIMIT 1)`
    etapaSql = `(SELECT etapa_id FROM servicos WHERE id = ${servicoSql})`
    unidadeSql = `(SELECT unidade_id FROM etapas WHERE id = ${etapaSql})`
  }

  inserts.push(
    `INSERT INTO lancamentos_financeiros (obra_id, unidade_id, etapa_id, servico_id, descricao, favorecido, valor, status, data_pagamento, forma_pagamento, observacao) VALUES ('${OBRA_ID}', ${unidadeSql}, ${etapaSql}, ${servicoSql}, '${descricao}', '${favorecido}', ${valor}, 'pago', ${data ? `'${data}'` : 'NULL'}, 'Histórico — forma não registrada na planilha', '${observacao}');`
  )
}

fs.writeFileSync('scripts/historico_financeiro_import.sql', inserts.join('\n') + '\n')
console.log(`Gerado scripts/historico_financeiro_import.sql com ${inserts.length} lançamentos.`)
console.log(`Excluídas (já cobertas por contrato/medição no app): ${excluidas}`)
console.log(`Sem código do orçamento (fila a classificar): ${semCodigo}`)
console.log(`Código ambíguo entre sobrados (vinculado só à etapa): ${ambiguoSobrado}`)
```

- [ ] **Step 2: Testar com a planilha desatualizada disponível hoje (dry-run, sem aplicar no
  banco)**

```bash
node scripts/importar-historico-financeiro.cjs "c:/Users/rodri.000/Desktop/Relatório Thiago Abrantes - 5 Jardim Imperial.xlsx" <obra_id-da-obra-piloto>
```

Expected na saída do console: total de linhas geradas próximo de 545 menos as excluídas (4
linhas da JFC), contagem de "sem código" próxima de 203 e "ambíguo" de 9 (números exatos batendo
com a spec §10, a menos que a planilha usada não seja exatamente a mesma revisada em
21/07/2026). Abrir `scripts/historico_financeiro_import.sql` gerado e ler uma amostra de 10-15
linhas para confirmar que os valores, datas e nomes de favorecido saíram corretos.

**Não rodar esse SQL gerado contra o banco de produção nesta task** — a planilha usada está
desatualizada (falta o período de final de maio/2026 em diante, conforme o Rodrigo avisou). A
aplicação real fica pendente do arquivo atualizado.

- [ ] **Step 3: Commit**

```bash
git add scripts/importar-historico-financeiro.cjs
git commit -m "feat: script de importacao de historico financeiro (execucao pendente do arquivo atualizado)"
```

---

## Depois de concluído

1. **Revisão obrigatória do Claude Code** (categoria de risco: RLS nova, tabela nova, dois
   triggers que escrevem entre módulos) antes de qualquer teste de campo com dados reais — ver
   `docs/colaboracao-codex-claude.md`.
2. Quando o Rodrigo enviar a planilha atualizada: rodar
   `scripts/importar-historico-financeiro.cjs` com o arquivo novo, revisar o SQL gerado, e
   aplicar via `apply_migration` ou `execute_sql` (ajuste transacional único, mesmo padrão da
   importação de estoque de julho/2026) — não é uma migração versionada de schema, é uma carga de
   dados, então decidir com o Rodrigo se versiona como migração ou aplica direto.
3. Atualizar `docs/fase6_compras.md` (novo campo de valor por item na conferência de NF) e criar
   `docs/fase3a_financeiro.md` — documentação de módulo é tarefa de quem implementou (Codex),
   conforme `docs/colaboracao-codex-claude.md`.
4. Atualizar `CLAUDE.md` §0 registrando a entrega, após o teste de campo e aceite do Rodrigo.
