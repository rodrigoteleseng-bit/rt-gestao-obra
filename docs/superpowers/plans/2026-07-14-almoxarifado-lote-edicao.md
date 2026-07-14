# Almoxarifado — Lançamento em Lote + Edição de Entrada Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lançar vários insumos da mesma NF de uma vez (fornecedor/NF/pedido compartilhados, um material+quantidade por linha), e permitir que o admin corrija quantidade/material/fornecedor/NF de uma entrada já lançada, sem precisar inativar e relançar.

**Architecture:** `PainelEntrada` (`src/pages/Almoxarifado.tsx`) generaliza de "1 material por lançamento" pra uma lista de insumos (mesmo padrão `+ Adicionar item` já usado em Contratos/Compras) — um único `INSERT` com várias linhas, atômico de graça (é uma única instrução SQL). No extrato do material, um novo botão "Editar" (admin, só entrada ativa) abre um formulário inline substituindo a linha, salvando via `UPDATE`. Uma migração corrige um gap técnico: o trigger que soma `quantidade_recebida` no pedido de compra só reagia a mudança do campo `ativo` — precisa reagir também a mudança de quantidade/vínculo, senão corrigir uma entrada vinculada a pedido deixaria esse número desatualizado.

**Tech Stack:** React + TypeScript (mesmo padrão de estado em lista já usado em `ContratoForm.tsx`/`CompraForm.tsx`), Supabase/Postgres. Sem framework de teste — verificação via `npx tsc --noEmit`/`npm run build` e consultas SQL diretas via Supabase MCP pra validar o trigger (mesmo padrão usado nas fases anteriores deste projeto).

## Global Constraints

- **Edição de entrada é exclusiva do admin** — RLS (`mov_update`) já permite isso hoje, sem migração de policy necessária.
- **Não edita o vínculo com pedido de compra** (`pedido_item_id`) — só Material, Quantidade, Fornecedor, Nº da NF.
- **Editar não aparece para `tipo === 'saida'`** nem para entradas já inativadas (`ativo === false`).
- **Toda correção grava `editado_por`/`editado_em`** — nunca sobrescreve `criado_por`/`criado_em` original.
- **O trigger de sincronização com `quantidade_recebida`** precisa reverter o efeito antigo da linha e aplicar o novo em qualquer `UPDATE` que mude `quantidade` ou `pedido_item_id` (não só `ativo`) — ver Task 1.
- **Toda escrita (`update`) deve checar não só `error` mas também se a linha foi realmente afetada** (`.select()` + checar array vazio) — lição já aplicada em Medições/Compras neste mesmo projeto (RLS pode bloquear silenciosamente).
- Lançamento em lote continua exigindo só permissão de `pode_editar_almoxarifado()` (admin ou equipe com o módulo) — sem mudança de permissão.

---

## Arquivos afetados

- Criar: `supabase/migrations/20260714_almoxarifado_edicao_entrada.sql`
- Modificar: `src/lib/supabase.ts` (`EstoqueMovimento` ganha `editado_por`/`editado_em`)
- Modificar: `src/pages/Almoxarifado.tsx` (`PainelEntrada` reescrito; `AbaEstoque` ganha edição no extrato)
- Modificar: `src/pages/Almoxarifado.module.css` (`.btnRemoverItem`/`.btnAddItem` novos; `.itemLinhaReq` ganha `position: relative`)
- Modificar: `docs/fase6_almoxarifado.md`, `CLAUDE.md`

---

### Task 1: Migração de banco + tipos TypeScript

**Files:**
- Create: `supabase/migrations/20260714_almoxarifado_edicao_entrada.sql`
- Modify: `src/lib/supabase.ts`

**Interfaces:**
- Consumes: tabela `estoque_movimentos`, `pedidos_compra_itens` e trigger `sincroniza_recebimento_pedido()` (`supabase/migrations/20260711_fase6_almoxarifado.sql:137-155`) já existentes.
- Produces: colunas `editado_por`/`editado_em` em `estoque_movimentos`; trigger corrigido — consumidos pela Task 3 (formulário de edição) e pelo `EstoqueMovimento` type usado nas Tasks 2-3.

- [ ] **Step 1: Criar a migração**

```sql
-- ============================================================
-- ALMOXARIFADO — edição de entrada por admin + correção do trigger
-- de sincronização com quantidade_recebida do pedido de compra
-- ============================================================
-- Spec: docs/superpowers/specs/2026-07-14-almoxarifado-lote-edicao-design.md
--
-- editado_por/editado_em: rastreabilidade de correção (CLAUDE.md §6) —
-- nunca sobrescreve criado_por/criado_em original.
ALTER TABLE estoque_movimentos
  ADD COLUMN editado_por UUID REFERENCES perfis_usuario(id),
  ADD COLUMN editado_em  TIMESTAMPTZ;

-- O trigger original só reagia a UPDATE OF ativo (inativar), então uma
-- correção de quantidade/vínculo numa entrada já ligada a um item de
-- pedido deixava quantidade_recebida desatualizado. Generaliza pra
-- sempre reverter o efeito antigo da linha e aplicar o novo — cobre
-- quantidade, pedido_item_id e ativo com a mesma lógica, em vez de
-- tratar cada campo separadamente.
CREATE OR REPLACE FUNCTION sincroniza_recebimento_pedido()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.tipo = 'entrada' AND NEW.pedido_item_id IS NOT NULL THEN
    UPDATE pedidos_compra_itens
    SET quantidade_recebida = quantidade_recebida + NEW.quantidade
    WHERE id = NEW.pedido_item_id;

  ELSIF TG_OP = 'UPDATE' AND NEW.tipo = 'entrada' THEN
    IF OLD.ativo AND OLD.pedido_item_id IS NOT NULL THEN
      UPDATE pedidos_compra_itens
      SET quantidade_recebida = GREATEST(quantidade_recebida - OLD.quantidade, 0)
      WHERE id = OLD.pedido_item_id;
    END IF;
    IF NEW.ativo AND NEW.pedido_item_id IS NOT NULL THEN
      UPDATE pedidos_compra_itens
      SET quantidade_recebida = quantidade_recebida + NEW.quantidade
      WHERE id = NEW.pedido_item_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Precisa recriar o trigger pra escutar também UPDATE OF quantidade,
-- pedido_item_id (antes só escutava UPDATE OF ativo).
DROP TRIGGER trg_sincroniza_recebimento ON estoque_movimentos;
CREATE TRIGGER trg_sincroniza_recebimento
  AFTER INSERT OR UPDATE OF ativo, quantidade, pedido_item_id ON estoque_movimentos
  FOR EACH ROW EXECUTE FUNCTION sincroniza_recebimento_pedido();
```

- [ ] **Step 2: Aplicar a migração no banco Supabase**

Usar a ferramenta MCP do Supabase (`apply_migration`, projeto `yxshldsfmbmbzdkcymca` — nome
`rt-gestao-obra`) com o nome `almoxarifado_edicao_entrada` e o SQL acima. **Pedir confirmação
explícita ao Rodrigo antes de aplicar** (altera o banco de produção — aditivo, só adiciona
colunas e recria um trigger existente com escopo mais amplo, sem impacto em dados existentes).

Depois de aplicada, confirmar com queries via `execute_sql`:

```sql
SELECT column_name FROM information_schema.columns
WHERE table_name = 'estoque_movimentos' AND column_name IN ('editado_por', 'editado_em');
-- esperado: 2 linhas

SELECT tgname, pg_get_triggerdef(oid) FROM pg_trigger
WHERE tgname = 'trg_sincroniza_recebimento' AND NOT tgisinternal;
-- esperado: a definição menciona "UPDATE OF ativo, quantidade, pedido_item_id"
```

- [ ] **Step 3: Testar a correção do trigger diretamente no banco (via `execute_sql`)**

O trigger não depende de sessão autenticada — dá pra testar direto por SQL, criando dados de
teste descartáveis (não usar um pedido/material real):

```sql
-- Cria material, fornecedor, obra existente, pedido e item de teste descartáveis
INSERT INTO materiais (obra_id, codigo, nome, und)
SELECT id, 'TESTE-EDICAO', 'Material de teste (apagar)', 'un' FROM obras LIMIT 1
RETURNING id;
-- anotar como <MATERIAL_TESTE_ID>

INSERT INTO pedidos_compra (obra_id, descricao)
SELECT id, 'Pedido de teste (apagar)' FROM obras LIMIT 1
RETURNING id;
-- anotar como <PEDIDO_TESTE_ID>

INSERT INTO pedidos_compra_itens (pedido_id, descricao_item, quantidade_pedida, und)
VALUES ('<PEDIDO_TESTE_ID>', 'Item de teste', 100, 'un')
RETURNING id, quantidade_recebida;
-- anotar como <ITEM_TESTE_ID>, quantidade_recebida deve vir 0

-- Insere uma entrada de 10 unidades vinculada ao item de teste
INSERT INTO estoque_movimentos (obra_id, material_id, tipo, quantidade, pedido_item_id, criado_por)
SELECT obra_id, '<MATERIAL_TESTE_ID>', 'entrada', 10, '<ITEM_TESTE_ID>', id
FROM pedidos_compra_itens, perfis_usuario WHERE perfis_usuario.papel = 'admin' LIMIT 1
RETURNING id;
-- anotar como <MOVIMENTO_TESTE_ID>

SELECT quantidade_recebida FROM pedidos_compra_itens WHERE id = '<ITEM_TESTE_ID>';
-- esperado: 10 (0 + 10, efeito do INSERT)

-- Corrige a quantidade pra 25 (simula uma edição de admin)
UPDATE estoque_movimentos SET quantidade = 25 WHERE id = '<MOVIMENTO_TESTE_ID>';

SELECT quantidade_recebida FROM pedidos_compra_itens WHERE id = '<ITEM_TESTE_ID>';
-- esperado: 25 (reverteu os 10 antigos, aplicou os 25 novos — NÃO deve dar 35)

-- Limpeza
DELETE FROM estoque_movimentos WHERE id = '<MOVIMENTO_TESTE_ID>';
DELETE FROM pedidos_compra_itens WHERE id = '<ITEM_TESTE_ID>';
DELETE FROM pedidos_compra WHERE id = '<PEDIDO_TESTE_ID>';
DELETE FROM materiais WHERE id = '<MATERIAL_TESTE_ID>';
```

Se o segundo `SELECT quantidade_recebida` não vier exatamente `25`, a correção do trigger está
com bug — voltar ao Step 1 antes de prosseguir (não seguir pras próximas tasks com essa regra
quebrada, já que a Task 3 depende dela pra edição ser segura).

- [ ] **Step 4: Adicionar os campos em `src/lib/supabase.ts`**

Localizar a interface `EstoqueMovimento` (hoje termina em `fornecedor_id`/`numero_nf`) e
adicionar ao final:

```ts
export interface EstoqueMovimento {
  id: string; obra_id: string; material_id: string; tipo: TipoMovimentoEstoque
  quantidade: number; pedido_item_id: string | null; requisicao_numero: number | null
  unidade_id: string | null; retirado_por: string | null; tarefa_id: string | null
  aplicacao: string | null; observacao: string | null; ativo: boolean
  criado_por: string; criado_em: string
  fornecedor_id: string | null; numero_nf: string | null
  editado_por: string | null; editado_em: string | null
}
```

(Substituir a interface inteira por essa versão — só os dois campos finais são novos.)

- [ ] **Step 5: Verificar**

Rodar `npx tsc --noEmit` — deve compilar limpo (os campos novos ainda não são usados em
lugar nenhum).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260714_almoxarifado_edicao_entrada.sql src/lib/supabase.ts
git commit -m "Almoxarifado: migração de edição de entrada + correção do trigger de sincronização"
```

---

### Task 2: Lançamento em lote (`PainelEntrada`)

**Files:**
- Modify: `src/pages/Almoxarifado.tsx` (função `PainelEntrada`, aprox. linhas 847-1124)
- Modify: `src/pages/Almoxarifado.module.css`

**Interfaces:**
- Consumes: `Material`, `CategoriaMaterial`, `Fornecedor`, `PedidoCompra`, `PedidoCompraItem` de `../lib/supabase` (já importados no arquivo); props `PainelEntradaProps` (`materiais`, `fornecedores`, `onFechar`, `onMaterialCriado`, `onSucesso`) — inalteradas.
- Produces: `PainelEntrada` continua exportado do mesmo jeito, montado em `AbaEstoque` sem nenhuma mudança na chamada (`<PainelEntrada materiais={...} fornecedores={...} onFechar={...} onMaterialCriado={...} onSucesso={...} />`, linha ~330) — a Task 2 não muda a assinatura do componente, só o que acontece dentro dele.

- [ ] **Step 1: Adicionar as classes CSS novas em `Almoxarifado.module.css`**

Localizar `.itemLinhaReq` (hoje sem `position: relative`) e adicionar essa propriedade:

```css
.itemLinhaReq {
  border: 1.5px solid var(--cinza-200);
  border-radius: var(--radius-sm);
  padding: 10px 12px;
  margin-bottom: 10px;
  position: relative;
}
```

Logo depois da regra `.autocompleteWrap { position: relative; }` (ou em qualquer lugar do
arquivo — CSS não depende de ordem entre seletores independentes), adicionar:

```css
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
  margin-top: 4px;
}
```

- [ ] **Step 2: Substituir a função `PainelEntrada` inteira em `Almoxarifado.tsx`**

Localizar a função `PainelEntrada` (começa em `function PainelEntrada({ materiais, fornecedores, onFechar, onMaterialCriado, onSucesso }: PainelEntradaProps) {`, aprox. linha 847, termina no `}` que fecha a função antes do comentário `// ---------- Saída avulsa ----------`). Substituir pelo código abaixo. Adicionar também, logo ANTES da definição de `PainelEntrada` (antes de `interface PainelEntradaProps`), as duas novas definições auxiliares:

```tsx
interface InsumoLinha {
  chave: string
  buscaMaterial: string
  materialId: string | null
  sugestoesAbertas: boolean
  quantidade: string
  itemSel: string
  observacao: string
}

function insumoVazio(): InsumoLinha {
  return {
    chave: crypto.randomUUID(),
    buscaMaterial: '',
    materialId: null,
    sugestoesAbertas: false,
    quantidade: '',
    itemSel: '',
    observacao: '',
  }
}
```

Depois, a função `PainelEntrada` completa (substitui a versão atual inteira):

```tsx
function PainelEntrada({ materiais, fornecedores, onFechar, onMaterialCriado, onSucesso }: PainelEntradaProps) {
  const { obraAtiva } = useObra()

  const [insumos, setInsumos] = useState<InsumoLinha[]>([insumoVazio()])

  const [criandoMaterialPara, setCriandoMaterialPara] = useState<string | null>(null)
  const [novoNome, setNovoNome] = useState('')
  const [novoUnd, setNovoUnd] = useState('')
  const [novaCategoria, setNovaCategoria] = useState<CategoriaMaterial>('material')
  const [salvandoMaterial, setSalvandoMaterial] = useState(false)

  const [fornecedorSel, setFornecedorSel] = useState('')
  const [numeroNf, setNumeroNf] = useState('')

  const [pedidos, setPedidos] = useState<PedidoCompra[] | null>(null)
  const [pedidoSel, setPedidoSel] = useState('')
  const [itensPedido, setItensPedido] = useState<PedidoCompraItem[]>([])
  const [carregandoItens, setCarregandoItens] = useState(false)

  const [salvando, setSalvando] = useState(false)
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)

  useEffect(() => {
    if (!obraAtiva) return
    supabase.from('pedidos_compra').select('*')
      .eq('obra_id', obraAtiva.id).in('status', PEDIDO_STATUS_VINCULAVEL).order('numero')
      .then(({ data }) => setPedidos(data ?? []))
  }, [obraAtiva])

  function sugestoesMateriais(busca: string): Material[] {
    const t = busca.trim().toLowerCase()
    if (!t) return materiais
    return materiais.filter(m => m.nome.toLowerCase().includes(t) || m.codigo.toLowerCase().includes(t))
  }

  function atualizarInsumo(chave: string, patch: Partial<InsumoLinha>) {
    setInsumos(prev => prev.map(i => i.chave === chave ? { ...i, ...patch } : i))
  }

  function escolherMaterialInsumo(chave: string, m: Material) {
    atualizarInsumo(chave, { materialId: m.id, buscaMaterial: `${m.codigo} — ${m.nome}`, sugestoesAbertas: false })
  }

  function removerInsumo(chave: string) {
    setInsumos(prev => prev.length > 1 ? prev.filter(i => i.chave !== chave) : prev)
  }

  function adicionarInsumo() {
    setInsumos(prev => [...prev, insumoVazio()])
  }

  async function criarMaterial() {
    if (!obraAtiva || !criandoMaterialPara) return
    if (!novoNome.trim()) {
      setMsg({ tipo: 'erro', texto: 'Informe o nome do novo material.' })
      return
    }
    setSalvandoMaterial(true)
    setMsg(null)
    const isDuplicidade = (e: { message?: string; code?: string } | null | undefined) =>
      !!e && (e.code === '23505' || (e.message ?? '').includes('duplicate key'))

    async function tentarInserir() {
      const { data: codigo, error: eCodigo } = await supabase.rpc('proximo_codigo_material', { p_obra: obraAtiva!.id })
      if (eCodigo || !codigo) {
        return { novo: null, error: eCodigo, falhaCodigo: true as const }
      }
      const { data: novo, error } = await supabase.from('materiais').insert({
        obra_id: obraAtiva!.id,
        codigo,
        nome: novoNome.trim(),
        und: novoUnd.trim() || 'un',
        categoria: novaCategoria,
      }).select().single()
      return { novo, error, falhaCodigo: false as const }
    }

    let resultado = await tentarInserir()
    if (resultado.falhaCodigo) {
      setSalvandoMaterial(false)
      setMsg({ tipo: 'erro', texto: `Falha ao gerar código: ${resultado.error?.message}` })
      return
    }
    if (resultado.error && isDuplicidade(resultado.error)) {
      resultado = await tentarInserir()
      if (resultado.falhaCodigo) {
        setSalvandoMaterial(false)
        setMsg({ tipo: 'erro', texto: `Falha ao gerar código: ${resultado.error?.message}` })
        return
      }
      if (resultado.error && isDuplicidade(resultado.error)) {
        setSalvandoMaterial(false)
        setMsg({ tipo: 'erro', texto: 'Outro usuário criou um material ao mesmo tempo — tente novamente.' })
        return
      }
    }
    setSalvandoMaterial(false)
    if (resultado.error || !resultado.novo) {
      setMsg({ tipo: 'erro', texto: `Falha ao criar material: ${resultado.error?.message}` })
      return
    }
    onMaterialCriado(resultado.novo)
    escolherMaterialInsumo(criandoMaterialPara, resultado.novo)
    setCriandoMaterialPara(null)
    setNovoNome(''); setNovoUnd(''); setNovaCategoria('material')
  }

  async function selecionarPedido(pedidoId: string) {
    setPedidoSel(pedidoId)
    setInsumos(prev => prev.map(i => ({ ...i, itemSel: '' })))
    setItensPedido([])
    if (!pedidoId) return
    setCarregandoItens(true)
    const { data } = await supabase.from('pedidos_compra_itens').select('*')
      .eq('pedido_id', pedidoId).eq('ativo', true).order('criado_em')
    setItensPedido(data ?? [])
    setCarregandoItens(false)
  }

  function faltaReceber(it: PedidoCompraItem): number {
    return it.quantidade_pedida - it.quantidade_recebida
  }

  async function salvar() {
    if (!obraAtiva) return
    const linhasValidas = insumos.filter(i => i.materialId && Number(i.quantidade) > 0)
    if (linhasValidas.length === 0) {
      setMsg({ tipo: 'erro', texto: 'Adicione ao menos um insumo com material e quantidade.' })
      return
    }
    setSalvando(true)
    setMsg(null)
    const { error } = await supabase.from('estoque_movimentos').insert(
      linhasValidas.map(i => ({
        obra_id: obraAtiva.id,
        material_id: i.materialId,
        tipo: 'entrada' as const,
        quantidade: Number(i.quantidade),
        pedido_item_id: i.itemSel || null,
        fornecedor_id: fornecedorSel || null,
        numero_nf: numeroNf.trim() || null,
        observacao: i.observacao.trim() || null,
      }))
    )
    setSalvando(false)
    if (error) {
      setMsg({ tipo: 'erro', texto: `Falha ao registrar entrada: ${error.message}` })
      return
    }
    onSucesso()
  }

  return (
    <div className={styles.painelForm}>
      <div className={styles.painelHeader}>
        <h2>Entrada de material</h2>
        <button className={styles.btnFechar} onClick={onFechar}>✕</button>
      </div>

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

      <label className={styles.campo}>
        Pedido de compra (opcional)
        <select value={pedidoSel} onChange={e => selecionarPedido(e.target.value)}>
          <option value="">Sem vínculo — entrada avulsa</option>
          {(pedidos ?? []).map(p => (
            <option key={p.id} value={p.id}>
              {String(p.numero).padStart(3, '0')}{p.descricao ? ` — ${p.descricao}` : ''}
            </option>
          ))}
        </select>
      </label>

      <h2 style={{ marginTop: 12 }}>Insumos</h2>
      {insumos.map(insumo => {
        const sugestoes = insumo.sugestoesAbertas ? sugestoesMateriais(insumo.buscaMaterial) : []
        return (
          <div key={insumo.chave} className={styles.itemLinhaReq}>
            {insumos.length > 1 && (
              <button className={styles.btnRemoverItem} onClick={() => removerInsumo(insumo.chave)}>✕</button>
            )}
            <div className={styles.campo}>
              Material *
              <div className={styles.autocompleteWrap}>
                <input
                  value={insumo.buscaMaterial}
                  onChange={e => atualizarInsumo(insumo.chave, { buscaMaterial: e.target.value, materialId: null, sugestoesAbertas: true })}
                  onFocus={() => atualizarInsumo(insumo.chave, { sugestoesAbertas: true })}
                  onBlur={() => setTimeout(() => atualizarInsumo(insumo.chave, { sugestoesAbertas: false }), 150)}
                  placeholder="Buscar por código ou nome…"
                  disabled={criandoMaterialPara === insumo.chave}
                />
                {sugestoes.length > 0 && (
                  <div className={styles.sugestoes}>
                    {sugestoes.map(m => (
                      <button key={m.id} className={styles.sugestao} onMouseDown={() => escolherMaterialInsumo(insumo.chave, m)}>
                        <span className={styles.sugestaoCodigo}>{m.codigo}</span>{m.nome}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {insumo.materialId
                ? <span className={styles.vinculoOk}>✓ material selecionado</span>
                : <span className={styles.vinculoAusente}>⚠ nenhum material selecionado</span>}

              {criandoMaterialPara !== insumo.chave ? (
                <button className={styles.btnSecundario} onClick={() => setCriandoMaterialPara(insumo.chave)} style={{ marginTop: 6 }}>
                  + Criar material
                </button>
              ) : (
                <div className={styles.blocoAninhado}>
                  <div className={styles.linha2}>
                    <label className={styles.campo}>
                      Nome *
                      <input value={novoNome} onChange={e => setNovoNome(e.target.value)} placeholder="Ex.: Cimento CP II" />
                    </label>
                    <label className={styles.campo}>
                      Unidade
                      <input value={novoUnd} onChange={e => setNovoUnd(e.target.value)} placeholder="sc, kg, un…" />
                    </label>
                    <label className={styles.campo}>
                      Categoria
                      <select value={novaCategoria} onChange={e => setNovaCategoria(e.target.value as CategoriaMaterial)}>
                        <option value="material">Material</option>
                        <option value="epi">EPI</option>
                        <option value="escritorio">Escritório</option>
                      </select>
                    </label>
                  </div>
                  <div className={styles.acoesInline}>
                    <button className={styles.btnSecundario} onClick={() => setCriandoMaterialPara(null)}>Cancelar</button>
                    <button className={styles.btnPrincipal} onClick={criarMaterial} disabled={salvandoMaterial}>
                      {salvandoMaterial ? 'Criando…' : 'Criar material'}
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className={styles.linha2}>
              <label className={styles.campo}>
                Quantidade *
                <input type="number" min="0" step="0.01" value={insumo.quantidade}
                  onChange={e => atualizarInsumo(insumo.chave, { quantidade: e.target.value })} />
              </label>
              <label className={styles.campo}>
                Observação
                <input value={insumo.observacao} onChange={e => atualizarInsumo(insumo.chave, { observacao: e.target.value })} placeholder="Opcional" />
              </label>
            </div>

            {pedidoSel && (
              <label className={styles.campo}>
                Item do pedido
                <select value={insumo.itemSel} onChange={e => atualizarInsumo(insumo.chave, { itemSel: e.target.value })} disabled={carregandoItens}>
                  <option value="">{carregandoItens ? 'Carregando…' : 'Selecione…'}</option>
                  {itensPedido.map(it => {
                    const falta = faltaReceber(it)
                    const jaRecebido = falta <= 0
                    return (
                      <option key={it.id} value={it.id} disabled={jaRecebido}>
                        {it.descricao_item} — {jaRecebido ? 'já recebido' : `falta receber ${falta} ${it.und ?? ''}`}
                      </option>
                    )
                  })}
                </select>
              </label>
            )}
          </div>
        )
      })}
      <button className={styles.btnAddItem} onClick={adicionarInsumo}>+ Adicionar insumo</button>

      {msg && <p className={msg.tipo === 'ok' ? styles.msgOk : styles.msgErro}>{msg.texto}</p>}
      <button className={styles.btnPrincipal} onClick={salvar} disabled={salvando} style={{ marginTop: 12 }}>
        {salvando ? 'Salvando…' : 'Registrar entrada'}
      </button>
    </div>
  )
}
```

**Nota sobre atomicidade:** a spec (§3) previa risco de linhas parciais se o lote falhasse no
meio. Não é o caso aqui: `supabase.from('estoque_movimentos').insert([...])` com um array manda
uma única instrução SQL `INSERT ... VALUES (...), (...), (...)` — atômica no Postgres (tudo ou
nada). Se um item do lote violar uma constraint (ex.: quantidade ≤ 0 barrada pelo `CHECK` da
tabela), a instrução inteira falha e nenhuma linha é gravada. Isso é melhor do que a spec previa
— não precisa de nenhuma mitigação extra.

- [ ] **Step 3: Verificar**

Rodar `npx tsc --noEmit` — deve compilar limpo. Em seguida `npm run build`. No navegador,
logado como admin ou equipe com módulo `almoxarifado`: abrir "+ Entrada de material", confirmar
que aparece 1 insumo vazio por padrão, adicionar 2 insumos a mais (3 no total), preencher
fornecedor + NF uma vez só, material+quantidade em cada insumo, clicar "Registrar entrada" e
confirmar que 3 movimentos aparecem no extrato de cada material correspondente, todos com o
mesmo fornecedor/NF. Testar também "+ Criar material" dentro de um insumo específico (não o
primeiro) e confirmar que o material criado é vinculado à linha certa.

- [ ] **Step 4: Commit**

```bash
git add src/pages/Almoxarifado.tsx src/pages/Almoxarifado.module.css
git commit -m "Almoxarifado: lançamento de entrada em lote (vários insumos por NF)"
```

---

### Task 3: Editar entrada (admin)

**Files:**
- Modify: `src/pages/Almoxarifado.tsx` (função `AbaEstoque`, o bloco de estado + a renderização do `.timeline`/`.movLinha`)

**Interfaces:**
- Consumes: `EstoqueMovimento.editado_por`/`editado_em` (Task 1); `materiais`, `fornecedores`, `admin`, `materialSel`, `perfil` já existentes em `AbaEstoque`.
- Produces: nada consumido por outra task — é a última peça de UI do plano.

- [ ] **Step 1: Adicionar estado de edição em `AbaEstoque`**

Logo após a linha `const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)` (dentro de `AbaEstoque`, próximo ao topo da função), adicionar:

```tsx
  const [editandoMovId, setEditandoMovId] = useState<string | null>(null)
  const [editBuscaMaterial, setEditBuscaMaterial] = useState('')
  const [editMaterialId, setEditMaterialId] = useState<string | null>(null)
  const [editSugestoesAbertas, setEditSugestoesAbertas] = useState(false)
  const [editQuantidade, setEditQuantidade] = useState('')
  const [editFornecedorSel, setEditFornecedorSel] = useState('')
  const [editNumeroNf, setEditNumeroNf] = useState('')
  const [salvandoEdicao, setSalvandoEdicao] = useState(false)
```

- [ ] **Step 2: Adicionar as funções de edição**

Logo após a função `inativarMovimento` já existente (que termina com `setMsg({ tipo: 'ok', texto: 'Movimento inativado.' })` seguido de `}`), adicionar:

```tsx
  function abrirEdicao(mv: EstoqueMovimento) {
    setEditandoMovId(mv.id)
    const m = materiais.find(x => x.id === mv.material_id)
    setEditBuscaMaterial(m ? `${m.codigo} — ${m.nome}` : '')
    setEditMaterialId(mv.material_id)
    setEditQuantidade(String(mv.quantidade))
    setEditFornecedorSel(mv.fornecedor_id ?? '')
    setEditNumeroNf(mv.numero_nf ?? '')
    setMsg(null)
  }

  function fecharEdicao() {
    setEditandoMovId(null)
  }

  function sugestoesMateriaisEdit(): Material[] {
    const t = editBuscaMaterial.trim().toLowerCase()
    if (!t) return materiais
    return materiais.filter(m => m.nome.toLowerCase().includes(t) || m.codigo.toLowerCase().includes(t))
  }

  async function salvarEdicao(mv: EstoqueMovimento) {
    if (!editMaterialId) { setMsg({ tipo: 'erro', texto: 'Selecione o material.' }); return }
    const qtd = Number(editQuantidade)
    if (!qtd || qtd <= 0) { setMsg({ tipo: 'erro', texto: 'Informe uma quantidade maior que zero.' }); return }
    setSalvandoEdicao(true)
    setMsg(null)
    const { data, error } = await supabase.from('estoque_movimentos').update({
      material_id: editMaterialId,
      quantidade: qtd,
      fornecedor_id: editFornecedorSel || null,
      numero_nf: editNumeroNf.trim() || null,
      editado_por: perfil?.id,
      editado_em: new Date().toISOString(),
    }).eq('id', mv.id).select()
    setSalvandoEdicao(false)
    if (error) { setMsg({ tipo: 'erro', texto: `Erro ao editar: ${error.message}` }); return }
    if (!data || data.length === 0) {
      setMsg({ tipo: 'erro', texto: 'Não foi possível salvar — o movimento pode ter sido alterado por outra pessoa.' })
      return
    }
    setEditandoMovId(null)
    await recarregarSaldos()
    if (materialSel) await abrirExtrato(materialSel)
    setMsg({ tipo: 'ok', texto: 'Entrada corrigida.' })
  }
```

- [ ] **Step 3: Atualizar a renderização do extrato**

Localizar o bloco que renderiza `movimentos.map(mv => ( ... ))` dentro de `.timeline` (o `<div key={mv.id} className={...movLinha...}>`). Substituir o conteúdo interno desse `<div>` (tudo entre a abertura do `<div>` e seu fechamento `</div>`, que hoje é `.movTopo` + `.movDetalhes` + `.movRodape`) por:

```tsx
                  {editandoMovId === mv.id ? (
                    <div className={styles.blocoAninhado}>
                      <label className={styles.campo}>
                        Material *
                        <div className={styles.autocompleteWrap}>
                          <input
                            value={editBuscaMaterial}
                            onChange={e => { setEditBuscaMaterial(e.target.value); setEditMaterialId(null); setEditSugestoesAbertas(true) }}
                            onFocus={() => setEditSugestoesAbertas(true)}
                            onBlur={() => setTimeout(() => setEditSugestoesAbertas(false), 150)}
                          />
                          {editSugestoesAbertas && sugestoesMateriaisEdit().length > 0 && (
                            <div className={styles.sugestoes}>
                              {sugestoesMateriaisEdit().map(m => (
                                <button key={m.id} className={styles.sugestao}
                                  onMouseDown={() => { setEditMaterialId(m.id); setEditBuscaMaterial(`${m.codigo} — ${m.nome}`); setEditSugestoesAbertas(false) }}>
                                  <span className={styles.sugestaoCodigo}>{m.codigo}</span>{m.nome}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </label>
                      <div className={styles.linha2}>
                        <label className={styles.campo}>
                          Quantidade *
                          <input type="number" min="0" step="0.01" value={editQuantidade} onChange={e => setEditQuantidade(e.target.value)} />
                        </label>
                        <label className={styles.campo}>
                          Fornecedor
                          <select value={editFornecedorSel} onChange={e => setEditFornecedorSel(e.target.value)}>
                            <option value="">Selecione…</option>
                            {fornecedores.map(f => <option key={f.id} value={f.id}>{f.nome}</option>)}
                          </select>
                        </label>
                      </div>
                      <label className={styles.campo}>
                        Nº da NF
                        <input value={editNumeroNf} onChange={e => setEditNumeroNf(e.target.value)} placeholder="Opcional" />
                      </label>
                      <div className={styles.acoesInline}>
                        <button className={styles.btnSecundario} onClick={fecharEdicao}>Cancelar</button>
                        <button className={styles.btnPrincipal} onClick={() => salvarEdicao(mv)} disabled={salvandoEdicao}>
                          {salvandoEdicao ? 'Salvando…' : 'Salvar'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className={styles.movTopo}>
                        <span className={`${styles.chip} ${mv.tipo === 'entrada' ? styles.chip_entrada : styles.chip_saida}`}>
                          {mv.tipo === 'entrada' ? 'Entrada' : 'Saída'}
                        </span>
                        <span className={styles.movQtd}>{mv.quantidade} {materialSel!.und}</span>
                        {!mv.ativo && <span className={styles.movInativoTag}>inativado</span>}
                      </div>
                      <div className={styles.movDetalhes}>
                        {mv.requisicao_numero !== null && <span>Req. {String(mv.requisicao_numero).padStart(5, '0')}</span>}
                        {mv.pedido_item_id !== null && <span>Pedido de compra</span>}
                        {mv.fornecedor_id !== null && <span>Fornecedor: {nomeFornecedor.get(mv.fornecedor_id) ?? '?'}</span>}
                        {mv.numero_nf && <span>NF: {mv.numero_nf}</span>}
                        {mv.unidade_id !== null && <span>Destino: {nomeUnidade.get(mv.unidade_id) ?? '?'}</span>}
                        {mv.retirado_por && <span>Retirado por: {mv.retirado_por}</span>}
                        {mv.aplicacao && <span>Aplicação: {mv.aplicacao}</span>}
                        {mv.observacao && <span>Obs.: {mv.observacao}</span>}
                        {mv.editado_em && <span>Corrigido em {fmtDataHora(mv.editado_em)}</span>}
                      </div>
                      <div className={styles.movRodape}>
                        <span>{autores.get(mv.criado_por) ?? '?'} · {fmtDataHora(mv.criado_em)}</span>
                        <div style={{ display: 'flex', gap: 8 }}>
                          {admin && mv.tipo === 'entrada' && mv.ativo && (
                            <button className={styles.btnSecundario} onClick={() => abrirEdicao(mv)}>Editar</button>
                          )}
                          {admin && mv.ativo && (
                            <button className={styles.btnInativar} onClick={() => inativarMovimento(mv)}>Inativar</button>
                          )}
                        </div>
                      </div>
                    </>
                  )}
```

(`materialSel!.und` mantém o `!` já usado no código original nessa mesma posição — o bloco só
renderiza quando `materialSel` não é nulo, garantido pelo componente pai.)

- [ ] **Step 4: Verificar**

Rodar `npx tsc --noEmit` e `npm run build` — devem compilar limpo. No navegador, logado como
admin: abrir o extrato de um material com pelo menos uma entrada ativa, clicar "Editar",
alterar a quantidade e o fornecedor, salvar, confirmar que a linha atualiza e mostra "Corrigido
em ...". Testar também trocar o material de uma entrada e confirmar que ela desaparece do
extrato do material antigo e passa a aparecer no do material novo (com saldo dos dois
recalculado corretamente). Logado como equipe (não-admin) com módulo `almoxarifado`: confirmar
que o botão "Editar" não aparece. Confirmar que uma entrada de um item vinculado a pedido de
compra, ao ter a quantidade editada, atualiza corretamente `quantidade_recebida` do pedido
(visível na tela de detalhe do pedido em Compras).

- [ ] **Step 5: Commit**

```bash
git add src/pages/Almoxarifado.tsx
git commit -m "Almoxarifado: edição de entrada de material pelo admin"
```

---

### Task 4: Verificação manual e documentação de entrega

**Files:**
- Modify: `docs/fase6_almoxarifado.md`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: nada de código novo — documenta o que as Tasks 1-3 entregaram.

- [ ] **Step 1: Checklist de verificação manual (sem código, além do que já foi feito por task)**

Já coberto por task (Task 2 Step 3, Task 3 Step 4). Confirmar adicionalmente, de ponta a ponta:

1. Lançar uma NF real com 2-3 insumos reais (um deles vinculado a um item de um pedido de
   compra existente e aprovado/enviado), confirmar que os saldos batem e que o pedido de compra
   mostra o recebimento corretamente.
2. Editar a quantidade dessa entrada vinculada, confirmar que o pedido de compra reflete a
   correção sem duplicar nem ficar com valor antigo.
3. Editar uma entrada sem vínculo com pedido, trocando o material — confirmar que o saldo do
   material antigo cai e o do novo sobe pela quantidade certa.

- [ ] **Step 2: Atualizar `docs/fase6_almoxarifado.md`**

Adicionar ao final do arquivo (ou na seção de histórico de ajustes, se existir uma):

```markdown

## Ajustes de 14/07/2026 — lançamento em lote + edição de entrada

- **Entrada de material em lote:** a tela "+ Entrada de material" agora aceita vários insumos
  de uma vez (mesmo padrão "+ Adicionar item" já usado em Contratos/Compras). Fornecedor, Nº da
  NF e Pedido de compra ficam no topo, compartilhados; cada insumo tem seu próprio material,
  quantidade, item do pedido (se um pedido foi selecionado) e observação. Um único `INSERT` com
  várias linhas — atômico (tudo ou nada), sem risco de lançamento parcial.
- **Editar entrada (admin):** no extrato do material, ao lado do "Inativar" já existente, um
  novo botão "Editar" (só admin, só entradas ativas) corrige material, quantidade, fornecedor e
  NF sem precisar inativar e relançar. Não edita o vínculo com pedido de compra. Grava
  `editado_por`/`editado_em`, exibido no extrato como "Corrigido em ...".
- **Correção de trigger:** `sincroniza_recebimento_pedido()` só reagia à inativação de um
  movimento; agora reage também a mudança de quantidade e de vínculo com pedido, revertendo o
  efeito antigo e aplicando o novo — sem isso, editar a quantidade de uma entrada vinculada a
  pedido deixaria `quantidade_recebida` desatualizado.
```

- [ ] **Step 3: Atualizar `CLAUDE.md` §0**

Localizar o parágrafo de Almoxarifado que começa com `**Almoxarifado — dois acréscimos em
13/07/2026:**` e adicionar, logo depois dele, um novo parágrafo:

```markdown
- **Almoxarifado — lançamento em lote + edição de entrada (14/07/2026):** "+ Entrada de material" agora aceita vários insumos de uma NF numa única tela (fornecedor/NF/pedido compartilhados, material+quantidade por insumo) — mesmo padrão de lista já usado em Contratos/Compras, com `INSERT` único atômico. Admin ganhou botão "Editar" no extrato do material (ao lado do "Inativar" já existente) pra corrigir quantidade/material/fornecedor/NF de uma entrada lançada errada, sem inativar e relançar — grava `editado_por`/`editado_em`. Corrigido também um gap técnico: o trigger que soma `quantidade_recebida` no pedido de compra só reagia à inativação; agora reage também a mudança de quantidade/vínculo, senão uma correção deixaria esse número desatualizado.
```

Atualizar o changelog no final do arquivo, adicionando antes da entrada "Versão 1.10":

```markdown
*Versão 1.11 — 14/07/2026 — §0 registra dois ajustes no Almoxarifado: lançamento de entrada em lote (vários insumos por NF, mesmo padrão de lista de Contratos/Compras) e edição de entrada pelo admin (corrige quantidade/material/fornecedor/NF sem inativar e relançar, grava editado_por/editado_em). Corrigido também o trigger `sincroniza_recebimento_pedido()`, que só reagia à inativação — agora reage a mudança de quantidade/vínculo também, requisito pra edição ser segura sem desatualizar o pedido de compra vinculado.*
```

E ajustar o número da versão no topo do índice, se houver (não há linha de versão no cabeçalho
deste arquivo além do changelog no rodapé, conforme já observado em edições anteriores).

- [ ] **Step 4: Commit**

```bash
git add docs/fase6_almoxarifado.md CLAUDE.md
git commit -m "Docs: registra lançamento em lote e edição de entrada no Almoxarifado"
```

---

## Self-Review

**Cobertura da spec:** §2 (correção do trigger) → Task 1; §3 (lançamento em lote) → Task 2 (e a
nota sobre atomicidade genuína, melhor do que a spec previa); §4 (editar entrada) → Task 3; §5
(permissões) → Global Constraints + RLS já existente, sem migração nova de policy; §6 (fora de
escopo) → não implementado, consistente; §7 (critérios de aceite) → Task 4 Step 1 + verificações
por task.

**Consistência de tipos:** `InsumoLinha` (Task 2) e o uso de `EstoqueMovimento.editado_por`/
`editado_em` (Task 1 → Task 3) usados de forma consistente. `PainelEntradaProps` não muda de
assinatura entre Task 1 e Task 2 — a chamada existente em `AbaEstoque` (linha ~330) continua
válida sem alteração.
