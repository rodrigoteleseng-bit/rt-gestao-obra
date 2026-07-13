# Almoxarifado — Fornecedor + NF na Entrada Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dois campos opcionais (fornecedor, número da NF) na "+ Entrada de material" do Almoxarifado, visíveis no extrato do material, coexistindo com o vínculo a pedido de compra já existente.

**Architecture:** Migração de banco (2 colunas nullable em `estoque_movimentos`) + wiring em `Almoxarifado.tsx` (fetch de `fornecedores`, campos no formulário `PainelEntrada`, exibição no extrato de `AbaEstoque`). Sem tabela nova, sem RLS nova (as policies de `estoque_movimentos` já cobrem a tabela inteira).

**Tech Stack:** PostgreSQL (Supabase) para a migração; React + TypeScript + Vite pro resto. Sem framework de teste automatizado — verificação manual via `npm run build` + navegador.

## Global Constraints

- `fornecedor_id` e `numero_nf` são **sempre opcionais** — nenhuma regra de obrigatoriedade, nenhum `CHECK`, nenhum `NOT NULL`.
- Coexistem com `pedido_item_id` — nenhuma lógica que zere um quando o outro é preenchido.
- Sem campo de preço, sem anexo de NF — só os dois campos.
- Reaproveitar o padrão de select de fornecedor já usado em `src/pages/CompraForm.tsx:895-897` (mesmo texto "Selecione…", mesma estrutura `<select><option value="">...</option>{fornecedores.map(...)}</select>`).
- Nenhuma mudança em `PainelSaida` nem em `PainelRequisicao` — os campos novos existem só na entrada.

---

## Arquivos afetados

- Criar: `supabase/migrations/20260713_almoxarifado_fornecedor_nf.sql`
- Modificar: `src/lib/supabase.ts` — `EstoqueMovimento` ganha 2 campos.
- Modificar: `src/pages/Almoxarifado.tsx` — fetch de fornecedores em `AbaEstoque`, campos novos em `PainelEntrada`, exibição no extrato.

---

### Task 1: Migração de banco + tipo TypeScript

**Files:**
- Create: `supabase/migrations/20260713_almoxarifado_fornecedor_nf.sql`
- Modify: `src/lib/supabase.ts` (interface `EstoqueMovimento`)

**Interfaces:**
- Consumes: tabela `estoque_movimentos` (já existe, `supabase/migrations/20260711_fase6_almoxarifado.sql:24-42`); tabela `fornecedores` (já existe).
- Produces: colunas `fornecedor_id`/`numero_nf` em `estoque_movimentos`, tipadas em `EstoqueMovimento` como `string | null`, consumidas pela Task 2.

- [ ] **Step 1: Criar a migração**

```sql
-- Fornecedor + NF opcionais na entrada de material, coexistindo com o
-- vínculo a pedido de compra (pedido_item_id). Sem preço, sem anexo —
-- só rastreabilidade de "de qual fornecedor veio" pra consulta futura.
ALTER TABLE estoque_movimentos
  ADD COLUMN fornecedor_id UUID REFERENCES fornecedores(id),
  ADD COLUMN numero_nf     TEXT;
```

- [ ] **Step 2: Aplicar a migração no banco Supabase**

Usar a ferramenta MCP do Supabase (`apply_migration`) com o nome `almoxarifado_fornecedor_nf` e o SQL acima — **pedir confirmação explícita ao Rodrigo antes de aplicar**, já que altera o banco de produção (mudança reversível — `ADD COLUMN` nullable — mas ainda assim uma alteração de schema ao vivo). Depois de aplicada, confirmar com `list_tables` ou uma query simples que as duas colunas existem em `estoque_movimentos`.

- [ ] **Step 3: Atualizar o tipo `EstoqueMovimento` em `src/lib/supabase.ts`**

Localizar a interface (bloco atual):

```ts
export interface EstoqueMovimento {
  id: string; obra_id: string; material_id: string; tipo: TipoMovimentoEstoque
  quantidade: number; pedido_item_id: string | null; requisicao_numero: number | null
  unidade_id: string | null; retirado_por: string | null; tarefa_id: string | null
  aplicacao: string | null; observacao: string | null; ativo: boolean
  criado_por: string; criado_em: string
}
```

Substituir por:

```ts
export interface EstoqueMovimento {
  id: string; obra_id: string; material_id: string; tipo: TipoMovimentoEstoque
  quantidade: number; pedido_item_id: string | null; requisicao_numero: number | null
  unidade_id: string | null; retirado_por: string | null; tarefa_id: string | null
  aplicacao: string | null; observacao: string | null; ativo: boolean
  criado_por: string; criado_em: string
  fornecedor_id: string | null; numero_nf: string | null
}
```

- [ ] **Step 4: Verificar**

Rodar `npm run build` — TypeScript deve compilar limpo (o tipo novo ainda não é usado em lugar nenhum nesta tarefa, então não deve gerar erro). Confirmar via Supabase (SQL Editor ou `execute_sql` do MCP) que `SELECT fornecedor_id, numero_nf FROM estoque_movimentos LIMIT 1;` roda sem erro.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260713_almoxarifado_fornecedor_nf.sql src/lib/supabase.ts
git commit -m "Almoxarifado: migração fornecedor_id/numero_nf em estoque_movimentos"
```

---

### Task 2: Campos no formulário de entrada + exibição no extrato

**Files:**
- Modify: `src/pages/Almoxarifado.tsx` (import de `Fornecedor`, fetch em `AbaEstoque`, props/campos/save em `PainelEntrada`, exibição no extrato)

**Interfaces:**
- Consumes: `Fornecedor` de `../lib/supabase` (interface já existe: `{ id, nome, contato, cnpj, ativo, criado_em, criado_por }`); colunas `fornecedor_id`/`numero_nf` da Task 1.
- Produces: nenhuma interface nova para tarefas seguintes — última tarefa do plano.

- [ ] **Step 1: Importar o tipo `Fornecedor`**

Ajustar o import de `../lib/supabase` no topo de `Almoxarifado.tsx` (linhas 4-8 do arquivo atual) para incluir `Fornecedor`:

```tsx
import {
  supabase, type Material, type CategoriaMaterial, type EstoqueMovimento, type Unidade,
  type PedidoCompra, type PedidoCompraItem, type CronogramaTarefa, type RequisicaoBloco,
  type Ferramenta, type FerramentaEmprestimo, type Fornecedor,
} from '../lib/supabase'
```

- [ ] **Step 2: Buscar fornecedores em `AbaEstoque`**

Adicionar o estado logo abaixo de `const [unidades, setUnidades] = useState<Unidade[]>([])` (linha 201 do arquivo atual):

```tsx
  const [fornecedores, setFornecedores] = useState<Fornecedor[]>([])
```

Ajustar o `useEffect` que hoje busca materiais/saldos/unidades (linhas 218-231 do arquivo atual):

```tsx
  useEffect(() => {
    if (!obraAtiva) return
    setCarregando(true)
    Promise.all([
      supabase.from('materiais').select('*').eq('obra_id', obraAtiva.id).eq('ativo', true).order('nome'),
      supabase.from('estoque_saldos').select('*'),
      supabase.from('unidades').select('*').eq('obra_id', obraAtiva.id).order('ordem'),
      supabase.from('fornecedores').select('*').eq('ativo', true).order('nome'),
    ]).then(([m, s, u, f]) => {
      setMateriais(m.data ?? [])
      setSaldos(new Map((s.data ?? []).map((r: { material_id: string; saldo: number }) => [r.material_id, r.saldo])))
      setUnidades(u.data ?? [])
      setFornecedores(f.data ?? [])
      setCarregando(false)
    })
  }, [obraAtiva])
```

- [ ] **Step 3: Criar o mapa de nomes de fornecedor pro extrato**

Logo abaixo de `const nomeUnidade = useMemo(() => new Map(unidades.map(u => [u.id, u.nome])), [unidades])` (linha 233 do arquivo atual), adicionar:

```tsx
  const nomeFornecedor = useMemo(() => new Map(fornecedores.map(f => [f.id, f.nome])), [fornecedores])
```

- [ ] **Step 4: Exibir fornecedor/NF no extrato**

Localizar o bloco `.movDetalhes` (linhas 439-445 do arquivo atual):

```tsx
                  <div className={styles.movDetalhes}>
                    {mv.requisicao_numero !== null && <span>Req. {String(mv.requisicao_numero).padStart(5, '0')}</span>}
                    {mv.pedido_item_id !== null && <span>Pedido de compra</span>}
                    {mv.unidade_id !== null && <span>Destino: {nomeUnidade.get(mv.unidade_id) ?? '?'}</span>}
                    {mv.retirado_por && <span>Retirado por: {mv.retirado_por}</span>}
                    {mv.aplicacao && <span>Aplicação: {mv.aplicacao}</span>}
                    {mv.observacao && <span>Obs.: {mv.observacao}</span>}
                  </div>
```

Substituir por (acrescenta fornecedor e NF, mesmo estilo dos demais):

```tsx
                  <div className={styles.movDetalhes}>
                    {mv.requisicao_numero !== null && <span>Req. {String(mv.requisicao_numero).padStart(5, '0')}</span>}
                    {mv.pedido_item_id !== null && <span>Pedido de compra</span>}
                    {mv.fornecedor_id !== null && <span>Fornecedor: {nomeFornecedor.get(mv.fornecedor_id) ?? '?'}</span>}
                    {mv.numero_nf && <span>NF: {mv.numero_nf}</span>}
                    {mv.unidade_id !== null && <span>Destino: {nomeUnidade.get(mv.unidade_id) ?? '?'}</span>}
                    {mv.retirado_por && <span>Retirado por: {mv.retirado_por}</span>}
                    {mv.aplicacao && <span>Aplicação: {mv.aplicacao}</span>}
                    {mv.observacao && <span>Obs.: {mv.observacao}</span>}
                  </div>
```

- [ ] **Step 5: Passar `fornecedores` como prop pro `PainelEntrada`**

Localizar a chamada (linhas 326-333 do arquivo atual aproximadamente, após as mudanças anteriores):

```tsx
        <PainelEntrada
          materiais={materiais}
          onFechar={() => setMostrarEntrada(false)}
          onMaterialCriado={materialCriado}
          onSucesso={async () => {
            await recarregarSaldos()
            setMostrarEntrada(false)
            setMsg({ tipo: 'ok', texto: 'Entrada registrada.' })
          }}
        />
```

Adicionar a prop `fornecedores={fornecedores}`:

```tsx
        <PainelEntrada
          materiais={materiais}
          fornecedores={fornecedores}
          onFechar={() => setMostrarEntrada(false)}
          onMaterialCriado={materialCriado}
          onSucesso={async () => {
            await recarregarSaldos()
            setMostrarEntrada(false)
            setMsg({ tipo: 'ok', texto: 'Entrada registrada.' })
          }}
        />
```

- [ ] **Step 6: Atualizar `PainelEntradaProps` e o estado do componente**

Localizar (linhas 832-837 do arquivo atual):

```tsx
interface PainelEntradaProps {
  materiais: Material[]
  onFechar: () => void
  onMaterialCriado: (m: Material) => void
  onSucesso: () => void
}
```

Substituir por:

```tsx
interface PainelEntradaProps {
  materiais: Material[]
  fornecedores: Fornecedor[]
  onFechar: () => void
  onMaterialCriado: (m: Material) => void
  onSucesso: () => void
}
```

Localizar a assinatura da função (linha 839):

```tsx
function PainelEntrada({ materiais, onFechar, onMaterialCriado, onSucesso }: PainelEntradaProps) {
```

Substituir por:

```tsx
function PainelEntrada({ materiais, fornecedores, onFechar, onMaterialCriado, onSucesso }: PainelEntradaProps) {
```

Adicionar os dois novos estados logo abaixo de `const [observacao, setObservacao] = useState('')` (linha 853 do arquivo atual):

```tsx
  const [fornecedorSel, setFornecedorSel] = useState('')
  const [numeroNf, setNumeroNf] = useState('')
```

- [ ] **Step 7: Incluir os campos no `insert` de `salvar()`**

Localizar (linhas 968-975 do arquivo atual):

```tsx
    const { error } = await supabase.from('estoque_movimentos').insert({
      obra_id: obraAtiva.id,
      material_id: materialId,
      tipo: 'entrada',
      quantidade: qtd,
      pedido_item_id: itemSel || null,
      observacao: observacao.trim() || null,
    })
```

Substituir por:

```tsx
    const { error } = await supabase.from('estoque_movimentos').insert({
      obra_id: obraAtiva.id,
      material_id: materialId,
      tipo: 'entrada',
      quantidade: qtd,
      pedido_item_id: itemSel || null,
      fornecedor_id: fornecedorSel || null,
      numero_nf: numeroNf.trim() || null,
      observacao: observacao.trim() || null,
    })
```

- [ ] **Step 8: Adicionar os campos no JSX do formulário**

Localizar o bloco `.linha2` de Quantidade/Observação (linhas 1052-1061 do arquivo atual):

```tsx
      <div className={styles.linha2}>
        <label className={styles.campo}>
          Quantidade *
          <input type="number" min="0" step="0.01" value={quantidade} onChange={e => setQuantidade(e.target.value)} />
        </label>
        <label className={styles.campo}>
          Observação
          <input value={observacao} onChange={e => setObservacao(e.target.value)} placeholder="Opcional" />
        </label>
      </div>
```

Adicionar logo depois (antes do bloco "Pedido de compra (opcional)"):

```tsx
      <div className={styles.linha2}>
        <label className={styles.campo}>
          Fornecedor (opcional)
          <select value={fornecedorSel} onChange={e => setFornecedorSel(e.target.value)}>
            <option value="">Selecione…</option>
            {fornecedores.map(f => <option key={f.id} value={f.id}>{f.nome}</option>)}
          </select>
        </label>
        <label className={styles.campo}>
          Nº da NF (opcional)
          <input value={numeroNf} onChange={e => setNumeroNf(e.target.value)} placeholder="Ex.: 12345" />
        </label>
      </div>
```

- [ ] **Step 9: Verificar**

Rodar `npm run build` (TypeScript deve compilar limpo). No navegador, na aba Estoque do Almoxarifado: abrir "+ Entrada de material", confirmar que aparecem os campos "Fornecedor (opcional)" e "Nº da NF (opcional)" logo após Quantidade/Observação. Testar 3 cenários: (1) lançar entrada sem preencher nenhum dos dois — deve salvar normalmente, como hoje; (2) lançar entrada preenchendo fornecedor + NF, sem pedido de compra — confirmar que aparece "Fornecedor: X" e "NF: Y" no extrato do material; (3) lançar entrada vinculada a um pedido de compra E preenchendo fornecedor + NF — confirmar que "Pedido de compra", "Fornecedor: X" e "NF: Y" aparecem juntos no extrato, sem um sobrescrever o outro.

- [ ] **Step 10: Commit**

```bash
git add src/pages/Almoxarifado.tsx
git commit -m "Almoxarifado: campos de fornecedor e NF na entrada de material"
```

---

## Verificação final

- [ ] `npm run build` sem erros.
- [ ] Migração aplicada no Supabase (colunas `fornecedor_id`/`numero_nf` existem em `estoque_movimentos`).
- [ ] Entrada sem fornecedor/NF continua funcionando exatamente como antes (nenhuma regressão).
- [ ] Entrada com fornecedor/NF e sem pedido de compra funciona.
- [ ] Entrada com fornecedor/NF e com pedido de compra funciona (coexistência confirmada).
- [ ] Extrato do material mostra as tags novas corretamente, no mesmo estilo visual das já existentes.
