# Almoxarifado — Imprimir Estoque em PDF Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Botão "🖨️ Imprimir estoque" na aba Estoque do Almoxarifado que abre um menu com as 3 categorias (Material/EPI/Escritório) e gera um PDF (código, nome, unidade, saldo atual) pra conferência física.

**Architecture:** Um arquivo novo `src/lib/estoquePdf.ts` (jsPDF client-side, mesmo estilo visual de `comprasPdf.ts`) mais a wiring do botão/menu em `src/pages/Almoxarifado.tsx`, reaproveitando os states `materiais`/`saldos` que a aba já carrega — nenhuma query nova, nenhuma migração.

**Tech Stack:** React + TypeScript + Vite, jsPDF (já é dependência do projeto). Sem framework de teste automatizado — verificação manual via `npm run build` + navegador.

## Global Constraints

- Nenhuma query nova, nenhuma tabela/coluna/migração — só filtra `materiais`/`saldos` (já carregados por `AbaEstoque`) pela categoria escolhida.
- PDF inclui **todos** os materiais ativos da categoria, mesmo com saldo zero — ignora o texto da busca da tela.
- Colunas do PDF: Código, Nome, Unidade, Saldo Atual — nada mais (sem preço, sem estoque mínimo, sem alerta).
- Estilo visual idêntico ao já usado em `src/lib/comprasPdf.ts`/`src/lib/requisicoesPdf.ts`: `NAVY = '#1A3248'`, `TERRACOTA = '#C49A7A'`, `CINZA = '#6c757d'`, mesmo cabeçalho/rodapé de marca RT.
- Reaproveitar o padrão de dropdown já existente `.autocompleteWrap`/`.sugestoes`/`.sugestao` (`Almoxarifado.module.css:392-418`) — nenhuma classe CSS nova.
- Fechar o menu com o mesmo padrão já usado no arquivo: `onBlur` no botão-gatilho com `setTimeout(..., 150)`, e `onMouseDown` (não `onClick`) nos itens do menu, pra o clique registrar antes do blur fechar.

---

## Arquivos afetados

- Criar: `src/lib/estoquePdf.ts`
- Modificar: `src/pages/Almoxarifado.tsx` — dentro de `AbaEstoque`: novo estado, função `imprimirEstoque`, botão + menu na `.topoAcoes`.
- Nenhuma mudança em `Almoxarifado.module.css` (reaproveita classes existentes).

---

### Task 1: Gerador de PDF + botão com menu de categoria

**Files:**
- Create: `src/lib/estoquePdf.ts`
- Modify: `src/pages/Almoxarifado.tsx` (dentro de `AbaEstoque`, por volta das linhas 194-345 do arquivo atual)

**Interfaces:**
- Consumes: `Material`, `CategoriaMaterial` de `../lib/supabase` (já importados em `Almoxarifado.tsx`); states `materiais: Material[]`, `saldos: Map<string, number>`, `obraAtiva` (de `useObra()`) já existentes em `AbaEstoque`; `CATEGORIA_LABEL: Record<CategoriaMaterial, string>` já definido no topo do arquivo.
- Produces: função exportada `gerarPdfEstoque(d: DadosPdfEstoque): void` em `src/lib/estoquePdf.ts`, chamada só por `Almoxarifado.tsx` nesta tarefa.

- [ ] **Step 1: Criar `src/lib/estoquePdf.ts`**

```ts
// Geração do PDF de estoque atual por categoria, pra conferência física
// (jsPDF, client-side), identidade RT Engenharia — mesmo padrão de
// comprasPdf.ts/requisicoesPdf.ts.
import { jsPDF } from 'jspdf'

const NAVY = '#1A3248'
const TERRACOTA = '#C49A7A'
const CINZA = '#6c757d'

export interface ItemEstoquePdf {
  codigo: string
  nome: string
  und: string
  saldo: number
}

export interface DadosPdfEstoque {
  categoriaLabel: string
  obraNome: string
  itens: ItemEstoquePdf[]
}

function fmtDataHoje(): string {
  const d = new Date()
  const dia = String(d.getDate()).padStart(2, '0')
  const mes = String(d.getMonth() + 1).padStart(2, '0')
  return `${dia}/${mes}/${d.getFullYear()}`
}

export function gerarPdfEstoque(d: DadosPdfEstoque): void {
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' })
  const W = 210
  const ML = 14
  const MR = 14
  const LARG = W - ML - MR
  let y = 0

  function rodape() {
    const total = pdf.getNumberOfPages()
    for (let i = 1; i <= total; i++) {
      pdf.setPage(i)
      pdf.setDrawColor(TERRACOTA)
      pdf.setLineWidth(0.5)
      pdf.line(ML, 285, W - MR, 285)
      pdf.setFontSize(7.5)
      pdf.setTextColor(CINZA)
      pdf.setFont('helvetica', 'normal')
      pdf.text('RT Engenharia — Rodrigo Teles Silva · CREA 1018712895 D/GO · Inteligência Aplicada', ML, 290)
      pdf.text(`Página ${i} de ${total}`, W - MR, 290, { align: 'right' })
    }
  }

  function novaPagina() { pdf.addPage(); y = 16 }
  function precisa(mm: number) { if (y + mm > 280) novaPagina() }

  // ---------- cabeçalho ----------
  pdf.setFillColor(NAVY)
  pdf.rect(0, 0, W, 30, 'F')
  pdf.setFillColor(TERRACOTA)
  pdf.rect(0, 30, W, 1.4, 'F')
  pdf.setTextColor('#ffffff')
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(17)
  pdf.text('RT ENGENHARIA', ML, 13)
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(8.5)
  pdf.setTextColor('#B8D4E8')
  pdf.text('Inteligência Aplicada', ML, 18.5)
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(11)
  pdf.setTextColor('#ffffff')
  pdf.text(`ESTOQUE — ${d.categoriaLabel.toUpperCase()}`, W - MR, 12, { align: 'right' })
  pdf.setFontSize(9)
  pdf.setTextColor('#D0AE95')
  pdf.text(`Emitido em ${fmtDataHoje()}`, W - MR, 18.5, { align: 'right' })
  y = 39

  // ---------- identificação ----------
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(11)
  pdf.setTextColor('#222222')
  pdf.text(`Obra: ${d.obraNome}`, ML, y)
  y += 6
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(9.5)
  pdf.setTextColor(CINZA)
  pdf.text(`${d.itens.length} ite${d.itens.length === 1 ? 'm' : 'ns'} cadastrado${d.itens.length === 1 ? '' : 's'} nesta categoria`, ML, y)
  y += 7

  // ---------- tabela ----------
  const colX = { cod: ML, nome: ML + 32, und: ML + 124, saldo: ML + 148 }
  const colW = { cod: 32, nome: 92, und: 24, saldo: LARG - (32 + 92 + 24) }

  function cabecalhoTabela() {
    precisa(10)
    pdf.setFillColor('#F0EBE3')
    pdf.rect(ML, y, LARG, 7, 'F')
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(8)
    pdf.setTextColor(NAVY)
    pdf.text('CÓDIGO', colX.cod + 1, y + 4.7)
    pdf.text('NOME', colX.nome + 1, y + 4.7)
    pdf.text('UND.', colX.und + 1, y + 4.7)
    pdf.text('SALDO ATUAL', colX.saldo + 1, y + 4.7)
    y += 7
  }

  cabecalhoTabela()

  for (const it of d.itens) {
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(9)
    const linhasNome = pdf.splitTextToSize(it.nome, colW.nome - 2) as string[]
    const alturaLinha = Math.max(linhasNome.length, 1) * 4.2 + 2.5

    precisa(alturaLinha)
    pdf.setDrawColor('#E0DAD0')
    pdf.setLineWidth(0.2)
    pdf.line(ML, y, W - MR, y)

    pdf.setTextColor('#222222')
    pdf.text(it.codigo, colX.cod + 1, y + 4.2)
    pdf.text(linhasNome, colX.nome + 1, y + 4.2)
    pdf.setTextColor(CINZA)
    pdf.text(it.und || '—', colX.und + 1, y + 4.2)
    pdf.setFont('helvetica', 'bold')
    pdf.setTextColor('#222222')
    pdf.text(String(it.saldo), colX.saldo + 1, y + 4.2)
    y += alturaLinha
  }
  pdf.setDrawColor('#E0DAD0')
  pdf.line(ML, y, W - MR, y)

  rodape()

  const dataArquivo = fmtDataHoje().replace(/\//g, '-')
  const categoriaArquivo = d.categoriaLabel.replace(/\s+/g, '_')
  pdf.save(`Estoque_${categoriaArquivo}_${dataArquivo}.pdf`)
}
```

- [ ] **Step 2: Importar `gerarPdfEstoque` em `Almoxarifado.tsx`**

Adicionar logo abaixo de `import { gerarPdfBlocoRequisicoes } from '../lib/requisicoesPdf'` (linha 9 do arquivo atual):

```tsx
import { gerarPdfEstoque } from '../lib/estoquePdf'
```

- [ ] **Step 3: Adicionar o estado do menu dentro de `AbaEstoque`**

Logo abaixo de `const [mostrarRequisicao, setMostrarRequisicao] = useState(false)` (linha 216 do arquivo atual), adicionar:

```tsx
  const [menuImpressaoAberto, setMenuImpressaoAberto] = useState(false)
```

- [ ] **Step 4: Adicionar a função `imprimirEstoque`**

Logo abaixo da função `materialCriado` (fecha na linha 270 do arquivo atual, `}`), adicionar:

```tsx
  function imprimirEstoque(categoria: CategoriaMaterial) {
    const itens = materiais
      .filter(m => m.categoria === categoria)
      .sort((a, b) => a.nome.localeCompare(b.nome))
      .map(m => ({ codigo: m.codigo, nome: m.nome, und: m.und, saldo: saldos.get(m.id) ?? 0 }))
    gerarPdfEstoque({
      categoriaLabel: CATEGORIA_LABEL[categoria],
      obraNome: obraAtiva?.nome ?? '',
      itens,
    })
    setMenuImpressaoAberto(false)
  }
```

- [ ] **Step 5: Adicionar o botão + menu na `.topoAcoes`**

Localizar em `Almoxarifado.tsx` o bloco (linhas 288-292 do arquivo atual):

```tsx
      <div className={styles.topoAcoes}>
        <button className={styles.btnSecundario} onClick={() => setMostrarSaida(true)}>− Saída avulsa</button>
        <button className={styles.btnSecundario} onClick={() => setMostrarRequisicao(true)}>📋 Lançar requisição</button>
        <button className={styles.btnPrincipal} onClick={() => setMostrarEntrada(true)}>+ Entrada de material</button>
      </div>
```

Substituir por (adiciona o botão de impressão com seu menu, antes do botão principal):

```tsx
      <div className={styles.topoAcoes}>
        <button className={styles.btnSecundario} onClick={() => setMostrarSaida(true)}>− Saída avulsa</button>
        <button className={styles.btnSecundario} onClick={() => setMostrarRequisicao(true)}>📋 Lançar requisição</button>
        <div className={styles.autocompleteWrap}>
          <button
            className={styles.btnSecundario}
            onClick={() => setMenuImpressaoAberto(a => !a)}
            onBlur={() => setTimeout(() => setMenuImpressaoAberto(false), 150)}
          >
            🖨️ Imprimir estoque
          </button>
          {menuImpressaoAberto && (
            <div className={styles.sugestoes}>
              <button className={styles.sugestao} onMouseDown={() => imprimirEstoque('material')}>Material</button>
              <button className={styles.sugestao} onMouseDown={() => imprimirEstoque('epi')}>EPI</button>
              <button className={styles.sugestao} onMouseDown={() => imprimirEstoque('escritorio')}>Escritório</button>
            </div>
          )}
        </div>
        <button className={styles.btnPrincipal} onClick={() => setMostrarEntrada(true)}>+ Entrada de material</button>
      </div>
```

- [ ] **Step 6: Verificar**

Rodar `npm run build` (TypeScript deve compilar limpo). No navegador, na aba Estoque do Almoxarifado: clicar "🖨️ Imprimir estoque", confirmar que o menu aparece com as 3 opções logo abaixo do botão (mesmo visual do dropdown de autocomplete já usado no formulário de entrada). Clicar em cada categoria e confirmar que baixa um PDF com o cabeçalho RT, o nome da categoria, o nome da obra, e a tabela com todos os materiais ativos daquela categoria (inclusive os com saldo zero) ordenados por nome, com código/nome/unidade/saldo corretos. Confirmar que materiais de outra categoria não aparecem, e que o texto da busca da tela não interfere na lista do PDF. Testar com uma categoria que tenha nome de material longo o bastante pra quebrar linha na tabela, e com estoque grande o bastante pra paginar (se disponível nos dados de teste).

- [ ] **Step 7: Commit**

```bash
git add src/lib/estoquePdf.ts src/pages/Almoxarifado.tsx
git commit -m "Almoxarifado: botão de imprimir estoque em PDF por categoria"
```

---

## Verificação final

- [ ] `npm run build` sem erros.
- [ ] PDF gerado corretamente para as 3 categorias, incluindo materiais com saldo zero.
- [ ] Menu abre/fecha corretamente (clique fora fecha via `onBlur`, clique numa opção gera o PDF e fecha o menu).
- [ ] Nenhuma mudança de comportamento na busca/filtro da tela (`busca`, `filtroCategoria`, `soAbaixoMinimo`) — o PDF é independente delas.
