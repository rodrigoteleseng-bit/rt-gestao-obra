# Cabeçalho do PDF de Pedido de Compra Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir a linha única "Obra: {nome}" do PDF de Pedido de Compra por um bloco com
obra, empreendimento, endereço e solicitante (nome + e-mail).

**Architecture:** Um campo novo em `obras` (`nome_empreendimento`); o gerador de PDF
(`comprasPdf.ts`) ganha 3 campos de entrada e reescreve só o bloco de identificação (a faixa navy
e a tabela de itens não mudam); a tela que chama o gerador (`CompraForm.tsx`) busca esses dados
antes de gerar o PDF, no mesmo lugar onde já busca `logo_url`/`rodape_pdf`; `/dados-obra` ganha um
campo de texto novo no formulário que já existe.

**Tech Stack:** React 19 + TypeScript + Vite, Supabase (Postgres + RLS), jsPDF.

## Global Constraints

- Spec de origem: `docs/superpowers/specs/2026-09-08-cabecalho-pedido-compra-design.md`.
- **Sem framework de testes automatizados neste repositório** — verificação real é `npm run
  build` (checagem de tipo), seguindo o mesmo padrão já usado nas duas entregas anteriores desta
  sessão.
- **A faixa navy do cabeçalho (logo/marca) e a tabela de itens não mudam nesta entrega** — só o
  bloco de identificação entre as duas.
- Campo novo (`nome_empreendimento`) é nullable — obra sem esse dado preenchido mostra só o nome
  da obra, nunca um traço vazio ou texto inventado.
- Responsável padrão pela execução do projeto é o Codex; nesta sessão, Rodrigo autorizou o Claude
  Code a implementar diretamente (mesmo handoff das duas entregas anteriores).

---

### Task 1: Migração — `obras.nome_empreendimento`

**Files:**
- Create: `supabase/migrations/20260908_pedido_compra_empreendimento.sql`

**Interfaces:**
- Produces: coluna `obras.nome_empreendimento TEXT` (nullable). Consumida pelas Tasks 2, 3 e 4.

- [ ] **Step 1: Escrever a migração**

```sql
-- Nome comercial do empreendimento, distinto do nome da obra (código interno do app).
-- Usado no cabeçalho do PDF de Pedido de Compra. Nullable: obra sem esse dado
-- preenchido mostra só o nome da obra, sem inventar texto.
ALTER TABLE obras ADD COLUMN nome_empreendimento TEXT;
```

- [ ] **Step 2: Aplicar a migração via Supabase MCP**

Chamar `apply_migration` com `project_id` do projeto `rt-gestao-obra` (`yxshldsfmbmbzdkcymca`),
`name: pedido_compra_empreendimento`, `query` = o SQL acima.

- [ ] **Step 3: Verificar**

```sql
SELECT column_name, data_type, is_nullable FROM information_schema.columns
WHERE table_name = 'obras' AND column_name = 'nome_empreendimento';
```

Expected: uma linha, `data_type = text`, `is_nullable = YES`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260908_pedido_compra_empreendimento.sql
git commit -m "feat: coluna obras.nome_empreendimento"
```

---

### Task 2: `Obra` + bloco de identificação em `comprasPdf.ts`

**Files:**
- Modify: `src/lib/supabase.ts` (interface `Obra`)
- Modify: `src/lib/comprasPdf.ts:13-19,86-102`

**Interfaces:**
- Consumes: nada novo além do que já existe.
- Produces: `Obra.nome_empreendimento: string | null`; `DadosPdfPedido` ganha
  `nomeEmpreendimento: string | null`, `enderecoObra: string | null`, `cidadeObra: string | null`,
  `estadoObra: string | null`, `solicitanteNome: string`, `solicitanteEmail: string`. Consumido
  pela Task 3 (quem monta esse objeto).

- [ ] **Step 1: Adicionar o campo em `Obra` (`src/lib/supabase.ts`)**

```ts
export interface Obra {
  id: string
  nome: string
  descricao: string | null
  endereco: string | null
  cidade: string | null
  estado: string | null
  data_inicio: string | null
  data_fim_prevista: string | null
  status: StatusObra
  logo_url: string | null
  rodape_pdf: string | null
  nome_empreendimento: string | null
}
```

- [ ] **Step 2: Ampliar `DadosPdfPedido` em `src/lib/comprasPdf.ts`**

Substituir (linhas 13-19 atuais):

```ts
export interface DadosPdfPedido {
  pedido: PedidoCompra
  itens: PedidoCompraItem[]
  obraNome: string
  identidade: IdentidadeMarca
  servicos: Servico[]
}
```

por:

```ts
export interface DadosPdfPedido {
  pedido: PedidoCompra
  itens: PedidoCompraItem[]
  obraNome: string
  nomeEmpreendimento: string | null
  enderecoObra: string | null
  cidadeObra: string | null
  estadoObra: string | null
  identidade: IdentidadeMarca
  solicitanteNome: string
  solicitanteEmail: string
  servicos: Servico[]
}
```

- [ ] **Step 3: Função de formatação de endereço**

Adicionar logo abaixo de `fmtData` (depois da linha 30 atual, antes de `export function
gerarPdfPedido`):

```ts
function formatarEnderecoObra(endereco: string | null, cidade: string | null, estado: string | null): string | null {
  const cidadeEstado = [cidade, estado].filter((v): v is string => Boolean(v)).join(' - ')
  const partes = [endereco, cidadeEstado].filter((v): v is string => Boolean(v))
  return partes.length > 0 ? partes.join(', ') : null
}
```

- [ ] **Step 4: Reescrever o bloco de identificação**

Substituir (linhas 86-102 atuais):

```ts
  // ---------- identificação ----------
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(11)
  pdf.setTextColor('#222222')
  pdf.text(`Obra: ${d.obraNome}`, ML, y)
  y += 7

  if (d.pedido.descricao) {
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(9.5)
    pdf.setTextColor(CINZA)
    const linhas = pdf.splitTextToSize(d.pedido.descricao, LARG) as string[]
    pdf.text(linhas, ML, y)
    y += linhas.length * 4.6 + 3
  } else {
    y += 2
  }
```

por:

```ts
  // ---------- identificação ----------
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(13)
  pdf.setTextColor(NAVY)
  const tituloObra = d.nomeEmpreendimento ? `${d.obraNome} — ${d.nomeEmpreendimento}` : d.obraNome
  pdf.text(tituloObra, ML, y)
  y += 6

  const endereco = formatarEnderecoObra(d.enderecoObra, d.cidadeObra, d.estadoObra)
  if (endereco) {
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(9.5)
    pdf.setTextColor(CINZA)
    pdf.text(endereco, ML, y)
    y += 5
  }

  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(8.5)
  pdf.setTextColor(CINZA)
  pdf.text(`Solicitante: ${d.solicitanteNome} · E-mail: ${d.solicitanteEmail}`, ML, y)
  y += 6

  if (d.pedido.descricao) {
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(9.5)
    pdf.setTextColor(CINZA)
    const linhas = pdf.splitTextToSize(d.pedido.descricao, LARG) as string[]
    pdf.text(linhas, ML, y)
    y += linhas.length * 4.6 + 3
  } else {
    y += 2
  }
```

- [ ] **Step 5: Checagem de tipo**

Run: `npm run build`
Expected: erro de tipo esperado só em `src/pages/CompraForm.tsx` (o único lugar que monta
`DadosPdfPedido`, ainda não atualizado — isso é resolvido na Task 3, não nesta). Nenhum erro deve
vir de dentro de `comprasPdf.ts` nem de `supabase.ts`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/supabase.ts src/lib/comprasPdf.ts
git commit -m "feat: bloco de identificacao (obra/empreendimento/endereco/solicitante) no PDF de pedido"
```

---

### Task 3: `CompraForm.tsx` — buscar os dados novos antes de gerar o PDF

**Files:**
- Modify: `src/pages/CompraForm.tsx:419-429`

**Interfaces:**
- Consumes: `DadosPdfPedido` (Task 2).
- Produces: nenhuma interface nova — só o ponto de chamada correto.

- [ ] **Step 1: Ampliar a busca de dados da obra e adicionar a busca do solicitante**

Substituir (linhas 419-429 atuais):

```ts
  async function baixarPdf() {
    setGerandoPdf(true)
    try {
      const { gerarPdfPedido } = await import('../lib/comprasPdf')
      const { data: obraRow } = await supabase.from('obras').select('logo_url, rodape_pdf').eq('id', pedido.obra_id).maybeSingle()
      const identidade = await carregarIdentidadeObra(obraRow)
      gerarPdfPedido({ pedido, itens, obraNome, identidade, servicos })
    } finally {
      setGerandoPdf(false)
    }
  }
```

por:

```ts
  async function baixarPdf() {
    setGerandoPdf(true)
    try {
      const { gerarPdfPedido } = await import('../lib/comprasPdf')
      const [{ data: obraRow }, { data: solicitanteRow }] = await Promise.all([
        supabase.from('obras').select('logo_url, rodape_pdf, nome_empreendimento, endereco, cidade, estado').eq('id', pedido.obra_id).maybeSingle(),
        supabase.from('perfis_usuario').select('nome, email').eq('id', pedido.criado_por).maybeSingle(),
      ])
      const identidade = await carregarIdentidadeObra(obraRow)
      gerarPdfPedido({
        pedido,
        itens,
        obraNome,
        nomeEmpreendimento: obraRow?.nome_empreendimento ?? null,
        enderecoObra: obraRow?.endereco ?? null,
        cidadeObra: obraRow?.cidade ?? null,
        estadoObra: obraRow?.estado ?? null,
        identidade,
        solicitanteNome: solicitanteRow?.nome ?? '—',
        solicitanteEmail: solicitanteRow?.email ?? '—',
        servicos,
      })
    } finally {
      setGerandoPdf(false)
    }
  }
```

`pedido.criado_por` já existe em `PedidoCompra` (`src/lib/supabase.ts`) — a busca em
`perfis_usuario` por esse id é permitida pela RLS existente (`pode_ver_perfil`, ver spec §2:
qualquer usuário que compartilhe uma obra com o solicitante pode ver seu perfil, e quem gera este
PDF necessariamente acessa a mesma obra do pedido).

- [ ] **Step 2: Checagem de tipo**

Run: `npm run build`
Expected: build passa sem erro — esta é a task que fecha o tipo aberto pela Task 2.

- [ ] **Step 3: Commit**

```bash
git add src/pages/CompraForm.tsx
git commit -m "feat: busca empreendimento/endereco/solicitante antes de gerar o PDF do pedido"
```

---

### Task 4: Campo "Nome do empreendimento" em `/dados-obra`

**Files:**
- Modify: `src/pages/DadosObra.tsx`

**Interfaces:**
- Consumes: `Obra.nome_empreendimento` (Task 2).

- [ ] **Step 1: Novo estado**

Adicionar, junto aos outros `useState`, logo depois de `const [descricao, setDescricao] =
useState('')` (linha 25 atual):

```ts
  const [nomeEmpreendimento, setNomeEmpreendimento] = useState('')
```

- [ ] **Step 2: Popular/limpar ao abrir o formulário**

Em `abrirNovo()` (linha 47-54 atual), adicionar `setNomeEmpreendimento('')` junto aos outros
`set...('')`. Em `abrirEdicao(o: Obra)` (linha 56-71 atual), adicionar logo após `setDescricao(o.descricao
?? '')`:

```ts
    setNomeEmpreendimento(o.nome_empreendimento ?? '')
```

- [ ] **Step 3: Incluir no `dados` salvo em `salvar()`**

Em `salvar()`, no objeto `dados` (linhas 101-112 atuais), adicionar o campo junto aos demais:

```ts
    const dados = {
      nome: nome.trim(),
      descricao: descricao.trim() || null,
      nome_empreendimento: nomeEmpreendimento.trim() || null,
      endereco: endereco.trim() || null,
      cidade: cidade.trim() || null,
      estado: estado.trim().toUpperCase() || null,
      data_inicio: dataInicio || null,
      data_fim_prevista: dataFimPrevista || null,
      status,
      logo_url: novoLogoUrl,
      rodape_pdf: rodapePdf.trim() || null,
    }
```

- [ ] **Step 4: Campo no formulário**

No JSX, logo depois do `<label>` de Descrição (linha 152 atual, antes do `<label>` de Endereço),
adicionar:

```tsx
            <label className={styles.campo}>
              Nome do empreendimento (comercial, se diferente do nome da obra)
              <input
                value={nomeEmpreendimento}
                onChange={e => setNomeEmpreendimento(e.target.value)}
                placeholder="Ex.: Residencial Azaleia"
              />
            </label>
```

- [ ] **Step 5: Checagem de tipo**

Run: `npm run build`
Expected: build passa sem erro.

- [ ] **Step 6: Commit**

```bash
git add src/pages/DadosObra.tsx
git commit -m "feat: campo nome do empreendimento em /dados-obra"
```
