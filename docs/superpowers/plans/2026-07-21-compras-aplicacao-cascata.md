# Compras — cascata Unidade → Etapa → Serviço no campo "Aplicação" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trocar o campo "Aplicação" do pedido de compra (novo pedido e edição de itens em
rascunho) de um autocomplete de texto único e plano para uma cascata de três campos digitáveis —
Unidade → Etapa → Serviço — reaproveitados nos dois formulários.

**Architecture:** Componente novo e reutilizável `AplicacaoCascata` (frontend puro, React +
TypeScript), consumido por `CompraForm.tsx` nos dois lugares que hoje duplicam a lógica de
autocomplete. Sem migração de banco — RPCs existentes continuam recebendo só `servico_id`.

**Tech Stack:** React 19 + TypeScript + Vite. Sem framework de testes no projeto (não há
jest/vitest configurado) — verificação por `npm run build` (typecheck via `tsc -b`) e teste manual
no navegador, mesmo padrão já usado neste repositório.

## Global Constraints

- Nenhuma migração de banco: RPCs `criar_pedido_compra_com_itens` e `salvar_itens_pedido_compra`
  continuam recebendo `servico_id` (ou `null`) por item, sem mudança de contrato.
- Etapas com `placeholder = true` nunca aparecem no dropdown de Etapa (mesmo filtro já usado em
  `src/pages/Orcamento.tsx:73`).
- Deixar o campo Aplicação totalmente vazio continua válido — item vai para "a classificar" (aviso
  "⚠ sem vínculo").
- Variáveis de cor/raio (`--navy`, `--terracota`, `--cinza-100/200/600`, `--branco`, `--radius-sm`,
  `--sombra-sm`) são globais, definidas em `src/styles/tokens.css` — não precisam de import em
  nenhum CSS module.
- Não mexer em `ContratoForm.tsx` nem no campo "Aplicação" de texto livre do Almoxarifado — fora de
  escopo (ver spec §7).

---

### Task 1: Componente `AplicacaoCascata`

**Files:**
- Create: `src/components/AplicacaoCascata.tsx`
- Create: `src/components/AplicacaoCascata.module.css`

**Interfaces:**
- Consumes: tipos `Unidade`, `Etapa`, `Servico` de `src/lib/supabase.ts` (já existentes:
  `Unidade { id, obra_id, nome, tipo, ordem }`, `Etapa { id, unidade_id, nome, codigo, ordem,
  placeholder }`, `Servico { id, etapa_id, codigo, nome, grupo, und, quant, valor_unit, total,
  ativo }`).
- Produces: componente default-exportado `AplicacaoCascata` com props
  `{ unidades: Unidade[]; etapas: Etapa[]; servicos: Servico[]; servicoId: string | null;
  onSelecionar: (servicoId: string | null) => void }` — este é o contrato que as Tasks 2 e 3 vão
  consumir.

- [ ] **Step 1: Criar o CSS module**

Criar `src/components/AplicacaoCascata.module.css` com o conteúdo abaixo (estilos portados de
`src/pages/CompraForm.module.css`, que vão ser removidos de lá na Task 4):

```css
.wrap {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  font-weight: 600;
  color: var(--cinza-600);
}

.nivel {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 6px;
}

.nivel input {
  width: 100%;
  min-width: 0;
  max-width: 100%;
  box-sizing: border-box;
  padding: 10px 12px;
  border: 1.5px solid var(--cinza-200);
  border-radius: var(--radius-sm);
  font-size: 14px;
  font-family: inherit;
  background: var(--branco);
}

.nivel input:focus { border-color: var(--navy); outline: none; }
.nivel input:disabled { background: var(--cinza-100); cursor: not-allowed; }

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

.vinculoOk { color: #1e6b2e; font-size: 11px; margin-top: 6px; }
.vinculoAusente { color: #a35c00; font-size: 11px; margin-top: 6px; }
```

- [ ] **Step 2: Criar o componente**

Criar `src/components/AplicacaoCascata.tsx` com o conteúdo abaixo:

```tsx
import { useEffect, useRef, useState } from 'react'
import type { Unidade, Etapa, Servico } from '../lib/supabase'
import styles from './AplicacaoCascata.module.css'

interface AplicacaoCascataProps {
  unidades: Unidade[]
  etapas: Etapa[]
  servicos: Servico[]
  servicoId: string | null
  onSelecionar: (servicoId: string | null) => void
}

function rotuloEtapa(e: Etapa): string {
  return `${e.codigo ?? ''} ${e.nome}`.trim()
}

function rotuloServico(s: Servico): string {
  return `${s.codigo ?? ''} ${s.nome}`.trim()
}

export default function AplicacaoCascata({ unidades, etapas, servicos, servicoId, onSelecionar }: AplicacaoCascataProps) {
  const [unidadeId, setUnidadeId] = useState<string | null>(null)
  const [etapaId, setEtapaId] = useState<string | null>(null)
  const [textoUnidade, setTextoUnidade] = useState('')
  const [textoEtapa, setTextoEtapa] = useState('')
  const [textoServico, setTextoServico] = useState('')
  const [abertoUnidade, setAbertoUnidade] = useState(false)
  const [abertoEtapa, setAbertoEtapa] = useState(false)
  const [abertoServico, setAbertoServico] = useState(false)
  const inicializado = useRef(false)

  // Deriva a seleção inicial (Unidade/Etapa a partir do servico_id já salvo) só uma vez —
  // espera os dados carregarem se ainda não chegaram (evita apagar a digitação do usuário
  // depois que ele já começou a navegar na cascata).
  useEffect(() => {
    if (inicializado.current) return
    if (servicoId) {
      const s = servicos.find(sv => sv.id === servicoId)
      if (!s) return
      const e = etapas.find(et => et.id === s.etapa_id)
      const u = e ? unidades.find(un => un.id === e.unidade_id) : undefined
      inicializado.current = true
      setUnidadeId(u?.id ?? null)
      setEtapaId(e?.id ?? null)
      setTextoUnidade(u?.nome ?? '')
      setTextoEtapa(e ? rotuloEtapa(e) : '')
      setTextoServico(rotuloServico(s))
    } else {
      inicializado.current = true
    }
  }, [servicoId, servicos, etapas, unidades])

  function unidadesFiltradas(): Unidade[] {
    const t = textoUnidade.trim().toLowerCase()
    if (!t) return unidades
    return unidades.filter(u => u.nome.toLowerCase().includes(t))
  }

  function etapasFiltradas(): Etapa[] {
    if (!unidadeId) return []
    const daUnidade = etapas.filter(e => e.unidade_id === unidadeId)
    const t = textoEtapa.trim().toLowerCase()
    if (!t) return daUnidade
    return daUnidade.filter(e => e.nome.toLowerCase().includes(t) || (e.codigo ?? '').toLowerCase().includes(t))
  }

  function servicosFiltrados(): Servico[] {
    if (!etapaId) return []
    const daEtapa = servicos.filter(s => s.etapa_id === etapaId)
    const t = textoServico.trim().toLowerCase()
    if (!t) return daEtapa
    return daEtapa.filter(s => s.nome.toLowerCase().includes(t) || (s.codigo ?? '').toLowerCase().includes(t))
  }

  function mudarTextoUnidade(v: string) {
    setTextoUnidade(v)
    setAbertoUnidade(true)
    if (unidadeId !== null) {
      setUnidadeId(null)
      setEtapaId(null)
      setTextoEtapa('')
      setTextoServico('')
    }
    if (servicoId !== null) onSelecionar(null)
  }

  function selecionarUnidade(u: Unidade) {
    setUnidadeId(u.id)
    setTextoUnidade(u.nome)
    setAbertoUnidade(false)
    setEtapaId(null)
    setTextoEtapa('')
    setTextoServico('')
    if (servicoId !== null) onSelecionar(null)
  }

  function mudarTextoEtapa(v: string) {
    setTextoEtapa(v)
    setAbertoEtapa(true)
    if (etapaId !== null) {
      setEtapaId(null)
      setTextoServico('')
    }
    if (servicoId !== null) onSelecionar(null)
  }

  function selecionarEtapa(e: Etapa) {
    setEtapaId(e.id)
    setTextoEtapa(rotuloEtapa(e))
    setAbertoEtapa(false)
    setTextoServico('')
    if (servicoId !== null) onSelecionar(null)
  }

  function mudarTextoServico(v: string) {
    setTextoServico(v)
    setAbertoServico(true)
    if (servicoId !== null) onSelecionar(null)
  }

  function selecionarServico(s: Servico) {
    setTextoServico(rotuloServico(s))
    setAbertoServico(false)
    onSelecionar(s.id)
  }

  const servicoAtual = servicoId ? servicos.find(s => s.id === servicoId) : undefined
  const sugestoesUnidade = abertoUnidade ? unidadesFiltradas() : []
  const sugestoesEtapa = abertoEtapa ? etapasFiltradas() : []
  const sugestoesServico = abertoServico ? servicosFiltrados() : []

  return (
    <div className={styles.wrap}>
      Aplicação
      <div className={styles.nivel}>
        <div className={styles.autocompleteWrap}>
          <input
            value={textoUnidade}
            onChange={ev => mudarTextoUnidade(ev.target.value)}
            onFocus={() => setAbertoUnidade(true)}
            onBlur={() => setTimeout(() => setAbertoUnidade(false), 150)}
            placeholder="Unidade — Sobrado, Portaria, Área Comum…"
          />
          {sugestoesUnidade.length > 0 && (
            <div className={styles.sugestoes}>
              {sugestoesUnidade.map(u => (
                <button key={u.id} type="button" className={styles.sugestao} onMouseDown={() => selecionarUnidade(u)}>
                  {u.nome}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className={styles.nivel}>
        <div className={styles.autocompleteWrap}>
          <input
            value={textoEtapa}
            disabled={!unidadeId}
            onChange={ev => mudarTextoEtapa(ev.target.value)}
            onFocus={() => unidadeId && setAbertoEtapa(true)}
            onBlur={() => setTimeout(() => setAbertoEtapa(false), 150)}
            placeholder={unidadeId ? 'Etapa — Fundação, Alvenaria…' : 'Selecione a Unidade primeiro'}
          />
          {sugestoesEtapa.length > 0 && (
            <div className={styles.sugestoes}>
              {sugestoesEtapa.map(e => (
                <button key={e.id} type="button" className={styles.sugestao} onMouseDown={() => selecionarEtapa(e)}>
                  {e.codigo && <span className={styles.sugestaoCodigo}>{e.codigo}</span>}{e.nome}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className={styles.nivel}>
        <div className={styles.autocompleteWrap}>
          <input
            value={textoServico}
            disabled={!etapaId}
            onChange={ev => mudarTextoServico(ev.target.value)}
            onFocus={() => etapaId && setAbertoServico(true)}
            onBlur={() => setTimeout(() => setAbertoServico(false), 150)}
            placeholder={etapaId ? 'Serviço — ex.: chapisco' : 'Selecione a Etapa primeiro'}
          />
          {sugestoesServico.length > 0 && (
            <div className={styles.sugestoes}>
              {sugestoesServico.map(s => (
                <button key={s.id} type="button" className={styles.sugestao} onMouseDown={() => selecionarServico(s)}>
                  <span className={styles.sugestaoCodigo}>{s.codigo}</span>{s.nome}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      {servicoAtual
        ? <span className={styles.vinculoOk}>✓ {rotuloServico(servicoAtual)}</span>
        : <span className={styles.vinculoAusente}>⚠ sem vínculo — vai para "a classificar"</span>}
    </div>
  )
}
```

- [ ] **Step 3: Verificar que o projeto compila**

Run: `npm run build`
Expected: build conclui sem erros (o componente novo ainda não é importado por ninguém, então não
afeta nada em execução — este passo só confirma que o arquivo novo, isolado, é TypeScript válido).

- [ ] **Step 4: Commit**

```bash
git add src/components/AplicacaoCascata.tsx src/components/AplicacaoCascata.module.css
git commit -m "feat: componente AplicacaoCascata (Unidade > Etapa > Servico)"
```

---

### Task 2: Integrar no formulário de "Novo pedido"

**Files:**
- Modify: `src/pages/CompraForm.tsx:1-235` (imports, estado, `ItemNovo`, `itemVazio`, funções de
  autocomplete, carregamento de unidades/etapas, bloco JSX "Aplicação" do novo pedido)

**Interfaces:**
- Consumes: `AplicacaoCascata` da Task 1 (`{ unidades, etapas, servicos, servicoId, onSelecionar
  }`).
- Produces: `CompraForm` passa a manter `unidades: Unidade[]` e `etapas: Etapa[]` no estado do
  componente — a Task 3 vai reaproveitar esse mesmo estado (não recarregar de novo).

- [ ] **Step 1: Atualizar os imports de tipos**

Em `src/pages/CompraForm.tsx:5`, trocar:

```ts
import { supabase, type Servico, type PedidoCompra, type PedidoCompraItem, type Cotacao, type CotacaoItem, type Fornecedor, type RecebimentoNf } from '../lib/supabase'
```

por:

```ts
import { supabase, type Servico, type Unidade, type Etapa, type PedidoCompra, type PedidoCompraItem, type Cotacao, type CotacaoItem, type Fornecedor, type RecebimentoNf } from '../lib/supabase'
```

E adicionar, logo abaixo dos imports existentes:

```ts
import AplicacaoCascata from '../components/AplicacaoCascata'
```

- [ ] **Step 2: Simplificar a interface `ItemNovo` e `itemVazio()`**

Em `src/pages/CompraForm.tsx:10-36`, substituir todo o bloco (interface `ItemNovo` + `itemVazio`)
por:

```ts
interface ItemNovo {
  chave: string
  descricao_item: string
  servico_id: string | null
  quantidade_pedida: string
  und: string
  data_necessaria: string
  urgente: boolean
}

function itemVazio(): ItemNovo {
  return {
    chave: crypto.randomUUID(),
    descricao_item: '',
    servico_id: null,
    quantidade_pedida: '',
    und: '',
    data_necessaria: '',
    urgente: false,
  }
}
```

(Isso remove os campos `servicoCodigo`, `buscaAplicacao` e `buscaAberta`, que deixam de ser
necessários — o novo componente cuida do próprio estado de busca.)

- [ ] **Step 3: Adicionar estado e carregamento de `unidades`/`etapas`**

Em `src/pages/CompraForm.tsx`, dentro do componente `CompraForm`, logo após a linha que declara
`const [servicos, setServicos] = useState<Servico[]>([])` (linha 89), adicionar:

```ts
  const [unidades, setUnidades] = useState<Unidade[]>([])
  const [etapas, setEtapas] = useState<Etapa[]>([])
```

Depois, logo após a função `carregarTodosServicos` (antes de `function itemEditVazio()`, por volta
da linha 64), adicionar a função de carregamento:

```ts
async function carregarUnidadesEEtapas(obraId: string): Promise<{ unidades: Unidade[]; etapas: Etapa[] }> {
  const { data: unis } = await supabase.from('unidades').select('*').eq('obra_id', obraId).order('ordem')
  const listaUnidades = unis ?? []
  const uniIds = listaUnidades.map(u => u.id)
  if (uniIds.length === 0) return { unidades: listaUnidades, etapas: [] }
  const { data: etps } = await supabase.from('etapas').select('*').in('unidade_id', uniIds).eq('placeholder', false).order('ordem')
  return { unidades: listaUnidades, etapas: etps ?? [] }
}
```

E, no corpo do componente `CompraForm`, junto do `useEffect` que já chama `carregarTodosServicos`
(por volta da linha 147-149), adicionar um novo efeito:

```ts
  useEffect(() => {
    if (!obraAtiva) return
    carregarUnidadesEEtapas(obraAtiva.id).then(({ unidades, etapas }) => {
      setUnidades(unidades)
      setEtapas(etapas)
    })
  }, [obraAtiva])
```

- [ ] **Step 4: Remover as funções de autocomplete substituídas**

Em `src/pages/CompraForm.tsx`, remover as funções `sugestoesPara` (por volta das linhas 151-155) e
`escolherServico` (por volta das linhas 161-170) — ambas só eram usadas pelo bloco JSX "Aplicação"
que será substituído no próximo passo. Manter `atualizarItem` e `removerItem` como estão.

- [ ] **Step 5: Substituir o bloco JSX "Aplicação" do novo pedido**

Em `src/pages/CompraForm.tsx`, dentro do `.map(it => ...)` da lista de itens do "Novo pedido",
localizar o bloco (originalmente linhas 250-276):

```tsx
                <div className={styles.campo}>
                  Aplicação
                  <div className={styles.autocompleteWrap}>
                    <input
                      value={it.buscaAplicacao}
                      onChange={e => atualizarItem(it.chave, {
                        buscaAplicacao: e.target.value, servico_id: null, servicoCodigo: '', buscaAberta: true,
                      })}
                      onFocus={() => atualizarItem(it.chave, { buscaAberta: true })}
                      onBlur={() => setTimeout(() => atualizarItem(it.chave, { buscaAberta: false }), 150)}
                      placeholder="Ex.: chapisco"
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
                    ? <span className={styles.vinculoOk}>✓ {it.servicoCodigo}</span>
                    : <span className={styles.vinculoAusente}>⚠ sem vínculo — vai para "a classificar"</span>}
                </div>
```

e substituir por:

```tsx
                <AplicacaoCascata
                  unidades={unidades}
                  etapas={etapas}
                  servicos={servicos}
                  servicoId={it.servico_id}
                  onSelecionar={sid => atualizarItem(it.chave, { servico_id: sid })}
                />
```

Também remover a linha logo acima que calculava `const sugestoes = it.buscaAberta ?
sugestoesPara(it.buscaAplicacao) : []` (por volta da linha 235), já que não é mais usada nesse
bloco.

- [ ] **Step 6: Rodar o build e verificar manualmente no navegador**

Run: `npm run build`
Expected: build conclui sem erros de tipo (nenhuma referência restante a `buscaAplicacao`,
`buscaAberta`, `servicoCodigo`, `sugestoesPara` ou `escolherServico` no fluxo de novo pedido).

Depois, com o servidor local rodando (`npm run dev`), abrir `/compras/novo` no navegador:
1. No campo Aplicação do item, digitar o nome de um sobrado (ex.: "Sobrado 04") no primeiro
   campo — confirmar que a lista de sugestões mostra só unidades e fecha ao clicar numa.
2. Confirmar que o segundo campo (Etapa) fica desabilitado com o placeholder "Selecione a
   Unidade primeiro" até a Unidade ser escolhida.
3. Escolher uma Etapa e confirmar que o terceiro campo (Serviço) habilita e, ao digitar, filtra só
   os serviços daquela etapa.
4. Escolher um Serviço e confirmar que aparece "✓ {código} {nome}" abaixo dos três campos.
5. Trocar a Unidade escolhida e confirmar que Etapa e Serviço voltam a ficar vazios/desabilitados.
6. Deixar os três campos vazios em um item e confirmar que aparece o aviso "⚠ sem vínculo — vai
   para 'a classificar'" e que o pedido ainda pode ser criado.

- [ ] **Step 7: Commit**

```bash
git add src/pages/CompraForm.tsx
git commit -m "feat: cascata Unidade > Etapa > Servico no novo pedido de compra"
```

---

### Task 3: Integrar na edição de itens do pedido em rascunho

**Files:**
- Modify: `src/pages/CompraForm.tsx` (interface `ItemEditavel`, `itemEditVazio`, `DetalhePedidoProps`,
  função `DetalhePedido`, chamada de `<DetalhePedido />`)

**Interfaces:**
- Consumes: `AplicacaoCascata` (Task 1); `unidades`/`etapas` já carregados pelo `CompraForm` pai
  (Task 2) — passados como novas props para `DetalhePedido`.

- [ ] **Step 1: Simplificar `ItemEditavel` e `itemEditVazio()`**

Em `src/pages/CompraForm.tsx:38-80`, substituir o bloco (interface `ItemEditavel` + `itemEditVazio`)
por:

```ts
interface ItemEditavel {
  id: string | null
  chave: string
  descricao_item: string
  servico_id: string | null
  quantidade_pedida: string
  und: string
  data_necessaria: string
  urgente: boolean
  removido: boolean
}

function itemEditVazio(): ItemEditavel {
  return {
    id: null,
    chave: crypto.randomUUID(),
    descricao_item: '',
    servico_id: null,
    quantidade_pedida: '',
    und: '',
    data_necessaria: '',
    urgente: false,
    removido: false,
  }
}
```

- [ ] **Step 2: Passar `unidades`/`etapas` para `DetalhePedido`**

Em `src/pages/CompraForm.tsx`, no `return` do componente `CompraForm` para o caso `!novo` (por
volta da linha 209-216), adicionar as duas novas props na chamada:

```tsx
    return (
      <DetalhePedido
        pedido={pedido} itens={itensPedido} cotacoes={cotacoes} cotacoesItens={cotacoesItens}
        fornecedores={fornecedores} recebimentos={recebimentos} servicos={servicos}
        unidades={unidades} etapas={etapas}
        somaAlmoxarifado={somaAlmoxarifado}
        obraNome={obraAtiva?.nome ?? '—'} onRecarregar={() => carregarPedido(pedido.id)}
      />
    )
```

E na interface `DetalhePedidoProps` (por volta das linhas 313-324), adicionar os dois campos:

```ts
interface DetalhePedidoProps {
  pedido: PedidoCompra
  itens: PedidoCompraItem[]
  cotacoes: Cotacao[]
  cotacoesItens: CotacaoItem[]
  fornecedores: Fornecedor[]
  recebimentos: RecebimentoNf[]
  servicos: Servico[]
  unidades: Unidade[]
  etapas: Etapa[]
  somaAlmoxarifado: Map<string, number>
  obraNome: string
  onRecarregar: () => void
}
```

E na assinatura da função `DetalhePedido` (por volta da linha 326), incluir `unidades, etapas` na
desestruturação:

```tsx
function DetalhePedido({ pedido, itens, cotacoes, cotacoesItens, fornecedores, recebimentos, servicos, unidades, etapas, somaAlmoxarifado, obraNome, onRecarregar }: DetalhePedidoProps) {
```

- [ ] **Step 3: Remover `buscaAplicacao`/`buscaAberta` do preenchimento de `itensEdit`**

Em `src/pages/CompraForm.tsx`, dentro do `useEffect` que popula `itensEdit` a partir de `itens`
(por volta das linhas 346-362), remover as duas linhas `buscaAplicacao: ...` e `buscaAberta: false`
do objeto mapeado — o restante do `useEffect` continua igual.

- [ ] **Step 4: Remover as funções de autocomplete duplicadas do modo edição**

Remover `sugestoesParaEdit` (por volta das linhas 364-368) e `escolherServicoEdit` (por volta das
linhas 374-382) — ambas só eram usadas pelo bloco JSX de edição que será substituído a seguir.
Manter `atualizarItemEdit` e `removerItemEdit` como estão.

- [ ] **Step 5: Substituir o bloco JSX "Aplicação" da edição de itens**

Dentro do `.map(it => ...)` de `itensEdit.filter(it => !it.removido)`, localizar o bloco
(originalmente linhas 757-783):

```tsx
                  <div className={styles.campo}>
                    Aplicação
                    <div className={styles.autocompleteWrap}>
                      <input
                        value={it.buscaAplicacao}
                        onChange={e => atualizarItemEdit(it.chave, {
                          buscaAplicacao: e.target.value, servico_id: null, buscaAberta: true,
                        })}
                        onFocus={() => atualizarItemEdit(it.chave, { buscaAberta: true })}
                        onBlur={() => setTimeout(() => atualizarItemEdit(it.chave, { buscaAberta: false }), 150)}
                        placeholder="Ex.: chapisco"
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
                      ? <span className={styles.vinculoOk}>✓ {codigoAplicacao(it.servico_id)}</span>
                      : <span className={styles.vinculoAusente}>⚠ sem vínculo — vai para "a classificar"</span>}
                  </div>
```

e substituir por:

```tsx
                  <AplicacaoCascata
                    unidades={unidades}
                    etapas={etapas}
                    servicos={servicos}
                    servicoId={it.servico_id}
                    onSelecionar={sid => atualizarItemEdit(it.chave, { servico_id: sid })}
                  />
```

Também remover a linha logo acima que calculava `const sugestoes = it.buscaAberta ?
sugestoesParaEdit(it.buscaAplicacao) : []` (por volta da linha 746), já que não é mais usada nesse
bloco. A função `codigoAplicacao` **não** deve ser removida — ela continua em uso na tabela
somente-leitura de itens do pedido (fora do modo edição).

- [ ] **Step 6: Rodar o build e verificar manualmente no navegador**

Run: `npm run build`
Expected: build conclui sem erros de tipo.

Depois, com o servidor local rodando, abrir um pedido em status "rascunho" (ou criar um novo e
voltar para ele) em `/compras/:id`:
1. Confirmar que os itens já existentes aparecem com Unidade/Etapa/Serviço pré-preenchidos
   corretamente a partir do `servico_id` salvo.
2. Adicionar um item novo na lista de edição e escolher Unidade → Etapa → Serviço do zero.
3. Trocar a Etapa de um item já vinculado e confirmar que o Serviço anterior é limpo e o aviso
   volta para "⚠ sem vínculo" até escolher um novo Serviço.
4. Salvar as alterações e confirmar que a tabela somente-leitura de itens (que aparece quando o
   pedido sai do rascunho) continua mostrando a coluna "Aplicação" corretamente — para conferir
   isso, é possível registrar uma cotação nesse pedido (o que muda o status para "em_cotacao" e
   troca para a visão de tabela).

- [ ] **Step 7: Commit**

```bash
git add src/pages/CompraForm.tsx
git commit -m "feat: cascata Unidade > Etapa > Servico na edicao de itens do pedido"
```

---

### Task 4: Limpeza final e verificação combinada

**Files:**
- Modify: `src/pages/CompraForm.module.css:100-131`

- [ ] **Step 1: Remover as classes CSS que migraram para `AplicacaoCascata.module.css`**

Em `src/pages/CompraForm.module.css`, remover o bloco de linhas 100-131 (`.autocompleteWrap`,
`.sugestoes`, `.sugestao:hover`, `.sugestao`, `.sugestaoCodigo`, `.vinculoOk`, `.vinculoAusente`) —
essas classes não são mais referenciadas em `CompraForm.tsx` depois das Tasks 2 e 3, e já existem
equivalentes em `AplicacaoCascata.module.css` (Task 1).

Antes de remover, confirmar que não sobrou nenhuma referência:

Run: `grep -n "styles.autocompleteWrap\|styles.sugestoes\|styles.sugestao\|styles.vinculoOk\|styles.vinculoAusente" src/pages/CompraForm.tsx`
Expected: nenhuma linha encontrada (saída vazia).

- [ ] **Step 2: Build completo**

Run: `npm run build`
Expected: build conclui sem erros e sem warnings de CSS module não usado.

- [ ] **Step 3: Verificação manual combinada no navegador**

Com `npm run dev` rodando, repetir o roteiro mínimo pelos dois fluxos (novo pedido e edição de
rascunho) descritos nas Tasks 2 e 3, desta vez sem interrupção, para confirmar que a remoção do CSS
não quebrou nada visualmente (campos ainda com borda, dropdown de sugestões ainda com sombra/borda
navy, avisos de vínculo/sem vínculo com as cores certas).

- [ ] **Step 4: Commit**

```bash
git add src/pages/CompraForm.module.css
git commit -m "chore: remove CSS de autocomplete duplicado em CompraForm apos migrar para AplicacaoCascata"
```

---

## Depois de concluído

Atualizar `CLAUDE.md` §0 com uma entrada nova registrando a melhoria (campo Aplicação de Compras
virou cascata Unidade → Etapa → Serviço), incluindo a data e apontando para esta pasta de plano —
seguindo o padrão já usado nas entradas anteriores do arquivo. Isso fica para depois do teste
manual do Rodrigo, não faz parte das tasks de código acima.
