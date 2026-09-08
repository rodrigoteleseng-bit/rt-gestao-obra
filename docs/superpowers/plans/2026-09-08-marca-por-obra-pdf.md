# Identidade Visual por Obra nos PDFs — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que uma obra tenha logo e rodapé próprios nos 8 PDFs gerados pelo app (RDO, FVS,
Compras, Requisições, Estoque, Medições, Produção, Gantt), aplicando isso já na obra ENGEFER
Sudoeste, sem mudar nada visualmente para nenhuma outra obra.

**Architecture:** Um módulo novo (`src/lib/pdfBranding.ts`) centraliza só a decisão de identidade
(RT padrão vs. logo/rodapé próprios de uma obra) — não o desenho do cabeçalho, que continua no
código de cada gerador (são 3 geometrias diferentes, ver spec §2). Cada gerador ganha um ramo novo
"com logo" ao lado do código atual, que fica intocado no ramo "sem logo".

**Tech Stack:** React 19 + TypeScript + Vite, Supabase (Postgres + RLS + Storage), jsPDF. Sem
framework de testes automatizados no projeto.

## Global Constraints

- Spec de origem: `docs/superpowers/specs/2026-09-04-marca-por-obra-pdf-design.md`.
- **Sem framework de testes automatizados neste repositório** — verificação real é
  `npm run build` (checagem de tipo) + geração de um PDF de teste de verdade (jsPDF roda em Node,
  não só no navegador) inspecionado com a ferramenta de leitura de PDF, já que este ambiente não
  tem navegador disponível.
- **O ramo "sem logo" de cada gerador precisa ficar byte a byte igual ao código atual** — é o
  caminho usado por toda obra hoje (inclusive a obra piloto). Qualquer diferença ali é regressão.
- Categorias de risco desta entrega (`docs/colaboracao-codex-claude.md`): RLS/Storage nova (Task 1).
- Responsável padrão pela execução: Codex; nesta sessão, Rodrigo autorizou o Claude Code a
  implementar diretamente (mesmo handoff do plano anterior desta sessão).
- Bucket novo só aceita `image/png`, até 2MB — a logo é um arquivo pequeno preparado à mão, não uma
  foto de obra.
- Texto de rodapé da ENGEFER Sudoeste (fornecido por Rodrigo, usar literalmente):
  `"ENGEFER - Eng. Civil Rodrigo Teles - CREA 1018712895 D/GO"`.
- Arquivo pronto para aplicar na ENGEFER Sudoeste (id `e13b37c5-e317-4a5b-b5b9-c3337e30680a`):
  `C:\Users\rodri.000\Desktop\engefer-logo-branca-pdf.png` (PNG, fundo transparente, traço branco,
  1600×521px).

---

### Task 1: Migração de banco + bucket de Storage

**Files:**
- Create: `supabase/migrations/20260908_marca_por_obra_pdf.sql`

**Interfaces:**
- Produces: colunas `obras.logo_url TEXT` (nullable) e `obras.rodape_pdf TEXT` (nullable); bucket
  `obras-logos` com policies `obraslogos_storage_select`/`_insert`/`_update`. Consumido pelas
  Tasks 2, 7 e 8.

- [ ] **Step 1: Escrever a migração**

```sql
-- Identidade visual por obra nos PDFs: obra sem logo continua usando a marca RT
-- padrão em todo lugar (colunas NULL = sem mudança de comportamento).
-- Ver docs/superpowers/specs/2026-09-04-marca-por-obra-pdf-design.md.

ALTER TABLE obras ADD COLUMN logo_url TEXT;
ALTER TABLE obras ADD COLUMN rodape_pdf TEXT;

INSERT INTO storage.buckets (id, name, public) VALUES ('obras-logos', 'obras-logos', false)
ON CONFLICT (id) DO NOTHING;
UPDATE storage.buckets
SET file_size_limit = 2097152, allowed_mime_types = ARRAY['image/png']
WHERE id = 'obras-logos';

-- SELECT: qualquer usuário que acesse a obra (não só admin) — quem gera o PDF é
-- o navegador de quem estiver logado, não só o admin que fez o upload.
CREATE POLICY obraslogos_storage_select ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'obras-logos' AND pode_acessar_obra(split_part(name,'/',1)::UUID));

-- INSERT/UPDATE: só admin (mesma régua de /dados-obra hoje). UPDATE cobre o caso
-- de reenviar uma logo corrigida por cima da existente (upsert).
CREATE POLICY obraslogos_storage_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'obras-logos' AND meu_papel() = 'admin' AND pode_acessar_obra(split_part(name,'/',1)::UUID));
CREATE POLICY obraslogos_storage_update ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'obras-logos' AND meu_papel() = 'admin')
  WITH CHECK (bucket_id = 'obras-logos' AND meu_papel() = 'admin' AND pode_acessar_obra(split_part(name,'/',1)::UUID));
```

- [ ] **Step 2: Aplicar a migração via Supabase MCP**

Chamar `apply_migration` com `project_id` do projeto `rt-gestao-obra` (`yxshldsfmbmbzdkcymca`),
`name: marca_por_obra_pdf`, `query` = o SQL acima.

- [ ] **Step 3: Verificar as colunas e o bucket**

```sql
SELECT column_name, data_type, is_nullable FROM information_schema.columns
WHERE table_name = 'obras' AND column_name IN ('logo_url', 'rodape_pdf');

SELECT id, public, file_size_limit, allowed_mime_types FROM storage.buckets WHERE id = 'obras-logos';
```

Expected: as duas colunas `TEXT`/`YES` (nullable); o bucket com `public = false`,
`file_size_limit = 2097152`, `allowed_mime_types = {image/png}`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260908_marca_por_obra_pdf.sql
git commit -m "feat: colunas de logo/rodape por obra e bucket obras-logos"
```

---

### Task 2: Tipo `Obra` + módulo `pdfBranding.ts`

**Files:**
- Modify: `src/lib/supabase.ts:25-35` (interface `Obra`)
- Create: `src/lib/pdfBranding.ts`

**Interfaces:**
- Produces: `Obra.logo_url: string | null`, `Obra.rodape_pdf: string | null`;
  `interface IdentidadeMarca { logoBase64: string | null; nomeMarca: string; tagline: string;
  rodapeTexto: string }`; `carregarIdentidadeObra(obra: { logo_url: string | null; rodape_pdf:
  string | null } | null | undefined): Promise<IdentidadeMarca>`; `larguraProporcional(pdf: jsPDF,
  dataUrl: string, alturaMm: number): number`. Consumido pelas Tasks 3, 4, 5 e 6.

- [ ] **Step 1: Adicionar os dois campos em `Obra` (`src/lib/supabase.ts`)**

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
}
```

- [ ] **Step 2: Criar `src/lib/pdfBranding.ts`**

```ts
// Identidade visual por obra nos PDFs (logo/rodapé próprios) — decide qual marca usar.
// Não desenha nenhum cabeçalho: cada gerador de PDF mantém sua própria geometria
// (são 3 diferentes hoje — ver docs/superpowers/specs/2026-09-04-marca-por-obra-pdf-design.md §2).
import type { jsPDF } from 'jspdf'
import { supabase } from './supabase'

export interface IdentidadeMarca {
  logoBase64: string | null   // null = sem logo própria, usa o texto padrão RT
  nomeMarca: string           // 'RT ENGENHARIA' por padrão; '' quando há logo (a imagem já tem o nome)
  tagline: string             // 'Inteligência Aplicada' por padrão; '' quando há logo
  rodapeTexto: string
}

const IDENTIDADE_PADRAO_RT: IdentidadeMarca = {
  logoBase64: null,
  nomeMarca: 'RT ENGENHARIA',
  tagline: 'Inteligência Aplicada',
  rodapeTexto: 'RT Engenharia — Rodrigo Teles Silva · CREA 1018712895 D/GO · Inteligência Aplicada',
}

async function blobParaDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as string)
    r.onerror = reject
    r.readAsDataURL(blob)
  })
}

export async function carregarIdentidadeObra(
  obra: { logo_url: string | null; rodape_pdf: string | null } | null | undefined,
): Promise<IdentidadeMarca> {
  if (!obra?.logo_url) return IDENTIDADE_PADRAO_RT
  const { data: blob, error } = await supabase.storage.from('obras-logos').download(obra.logo_url)
  if (error || !blob) return IDENTIDADE_PADRAO_RT
  const logoBase64 = await blobParaDataUrl(blob)
  return {
    logoBase64,
    nomeMarca: '',
    tagline: '',
    rodapeTexto: obra.rodape_pdf || IDENTIDADE_PADRAO_RT.rodapeTexto,
  }
}

// Largura proporcional (mm) da logo, dada a altura desejada — evita distorcer a
// imagem quando a proporção real não é conhecida de antemão (obras diferentes podem
// ter logos com proporções diferentes da usada na ENGEFER Sudoeste).
export function larguraProporcional(pdf: jsPDF, dataUrl: string, alturaMm: number): number {
  const props = pdf.getImageProperties(dataUrl)
  return alturaMm * (props.width / props.height)
}
```

- [ ] **Step 3: Checagem de tipo**

Run: `npm run build`
Expected: build passa sem erro.

- [ ] **Step 4: Commit**

```bash
git add src/lib/supabase.ts src/lib/pdfBranding.ts
git commit -m "feat: modulo pdfBranding com identidade por obra"
```

---

### Task 3: Os 6 geradores de faixa padrão (30mm) — RDO, FVS, Compras, Estoque, Medições, Produção

**Files:**
- Modify: `src/lib/rdoPdf.ts:105-112,59`
- Modify: `src/lib/fvsPdf.ts:110-117,67`
- Modify: `src/lib/comprasPdf.ts:61-68,48`
- Modify: `src/lib/estoquePdf.ts:61-68,48`
- Modify: `src/lib/medicoesPdf.ts:66-73,53`
- Modify: `src/lib/producaoMedicaoPdf.ts:64-72,175`

**Interfaces:**
- Consumes: `carregarIdentidadeObra`, `larguraProporcional`, `IdentidadeMarca` (Task 2).
- Produces: cada `DadosPdfX`/`DadosProducaoPdf` ganha o campo `identidade: IdentidadeMarca`.
  Consumido pela Task 6 (quem monta esses objetos nas telas).

Em todos os 6 arquivos, o padrão é o mesmo: a régua terracota + banda navy (linhas antes do bloco
mostrado) não mudam; só o bloco de texto da marca à esquerda (`'RT ENGENHARIA'` +
`'Inteligência Aplicada'`) vira um `if/else`, e a string do rodapé passa a vir de
`d.identidade.rodapeTexto`. O lado direito (tipo de documento/referência) não muda em nenhum dos 6.

- [ ] **Step 1: `src/lib/rdoPdf.ts`**

Adicionar ao import do topo do arquivo:

```ts
import { carregarIdentidadeObra, larguraProporcional, type IdentidadeMarca } from './pdfBranding'
```

Em `DadosPdfRdo` (linhas 15-25), adicionar o campo:

```ts
export interface DadosPdfRdo {
  rdo: Rdo
  obraNome: string
  identidade: IdentidadeMarca
  atividades: RdoAtividade[]
  efetivo: RdoEfetivo[]
  fotos: RdoFoto[]
  audios: RdoAudio[]
  avancosDia: AvancoDoDia[]
  fvsDia?: FvsDoDiaPdf[]
  unidades: Unidade[]
}
```

No rodapé (`rodape()`, linha 59), substituir:

```ts
      pdf.text('RT Engenharia — Rodrigo Teles Silva · CREA 1018712895 D/GO · Inteligência Aplicada', ML, 290)
```

por:

```ts
      pdf.text(d.identidade.rodapeTexto, ML, 290)
```

No cabeçalho, substituir o bloco (linhas 105-112 atuais):

```ts
  pdf.setTextColor('#ffffff')
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(17)
  pdf.text('RT ENGENHARIA', ML, 13)
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(8.5)
  pdf.setTextColor('#B8D4E8')
  pdf.text('Inteligência Aplicada', ML, 18.5)
```

por:

```ts
  pdf.setTextColor('#ffffff')
  if (d.identidade.logoBase64) {
    const alturaLogo = 22
    const larguraLogo = larguraProporcional(pdf, d.identidade.logoBase64, alturaLogo)
    pdf.addImage(d.identidade.logoBase64, 'PNG', ML, 4, larguraLogo, alturaLogo)
  } else {
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(17)
    pdf.text('RT ENGENHARIA', ML, 13)
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(8.5)
    pdf.setTextColor('#B8D4E8')
    pdf.text('Inteligência Aplicada', ML, 18.5)
  }
```

(As linhas seguintes — `pdf.setFont('helvetica', 'bold'); pdf.setFontSize(12); ...` que desenham
"RELATÓRIO DIÁRIO DE OBRA" à direita — continuam exatamente como estão, sem mudança.)

- [ ] **Step 2: `src/lib/fvsPdf.ts`** — mesmo padrão do Step 1

Import igual ao Step 1. Em `DadosPdfFvs` (linhas 35-45), adicionar `identidade: IdentidadeMarca`
logo após `obraNome: string`. No rodapé (linha 67), trocar o literal por `d.identidade.rodapeTexto`.
No cabeçalho, trocar o bloco (linhas 110-117 atuais — idêntico ao de `rdoPdf.ts`) pelo mesmo
if/else do Step 1 (o texto do lado direito, "FICHA DE VERIFICAÇÃO DE SERVIÇO", não muda).

- [ ] **Step 3: `src/lib/comprasPdf.ts`** — mesmo padrão

Import igual ao Step 1. Em `DadosPdfPedido` (linhas 12-17), adicionar `identidade: IdentidadeMarca`
após `obraNome: string`. Rodapé (linha 48): trocar pelo texto de `d.identidade.rodapeTexto`.
Cabeçalho (linhas 61-68 atuais): mesmo if/else (o lado direito, "PEDIDO DE COMPRA", não muda).

**Atenção:** `gerarPdfPedido` é `export function` (síncrona, sem `async`) — **não precisa virar
async** para isso funcionar, porque `identidade` já chega pronta (resolvida pela tela antes de
chamar a função, ver Task 6). Não mude a assinatura da função.

- [ ] **Step 4: `src/lib/estoquePdf.ts`** — mesmo padrão

Import igual ao Step 1. Em `DadosPdfEstoque` (linhas 17-21), adicionar `identidade:
IdentidadeMarca` após `obraNome: string`. Rodapé (linha 48) e cabeçalho (linhas 61-68) — mesmo
padrão (lado direito "ESTOQUE — {categoria}" não muda). `gerarPdfEstoque` continua síncrona.

- [ ] **Step 5: `src/lib/medicoesPdf.ts`** — mesmo padrão

Import igual ao Step 1. Em `DadosPdfMedicao` (linhas 23-28) **não existe `obraNome` hoje** —
adicionar só `identidade: IdentidadeMarca` (a tela que monta esses dados vai carregar a identidade
a partir do `contrato.obra_id`, não do nome — ver Task 6, Step 5). Rodapé (linha 53) e cabeçalho
(linhas 66-73) — mesmo padrão (lado direito "MEDIÇÃO" não muda). `gerarPdfMedicao` continua
síncrona.

- [ ] **Step 6: `src/lib/producaoMedicaoPdf.ts`** — mesmo padrão, com um cuidado a mais

Import igual ao Step 1. Em `DadosProducaoPdf` (linhas 23-30), adicionar `identidade:
IdentidadeMarca` após `obraNome: string`. Rodapé (linha 175): trocar pelo texto de
`d.identidade.rodapeTexto`.

Cabeçalho — **este arquivo é diferente dos outros 5**: hoje o bloco da direita ("MEDIÇÃO MP-xxx" /
status) não redefine cor/fonte antes de desenhar, aproveitando o estado deixado pelo bloco da
esquerda (branco, depois normal 8.5). Se o bloco da esquerda virar uma imagem em vez de texto, esse
estado de cor/fonte não é mais definido — o lado direito ficaria com a formatação de antes de
qualquer chamada nesta função. Por isso, ao trocar o bloco, o lado direito precisa redefinir
explicitamente cor/fonte, independente do que aconteceu à esquerda. Substituir (linhas 64-73
atuais):

```ts
  pdf.setTextColor('#ffffff')
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(17)
  pdf.text('RT ENGENHARIA', ML, 13)
  pdf.setFontSize(10)
  pdf.text(`MEDIÇÃO MP-${String(d.medicao.numero).padStart(3, '0')}`, W - MR, 13, { align: 'right' })
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(8.5)
  pdf.text('Inteligência Aplicada', ML, 19)
  pdf.text(d.medicao.status.toUpperCase(), W - MR, 19, { align: 'right' })
```

por:

```ts
  if (d.identidade.logoBase64) {
    const alturaLogo = 22
    const larguraLogo = larguraProporcional(pdf, d.identidade.logoBase64, alturaLogo)
    pdf.addImage(d.identidade.logoBase64, 'PNG', ML, 4, larguraLogo, alturaLogo)
  } else {
    pdf.setTextColor('#ffffff')
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(17)
    pdf.text('RT ENGENHARIA', ML, 13)
  }
  pdf.setTextColor('#ffffff')
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(10)
  pdf.text(`MEDIÇÃO MP-${String(d.medicao.numero).padStart(3, '0')}`, W - MR, 13, { align: 'right' })
  if (!d.identidade.logoBase64) {
    pdf.setTextColor('#ffffff')
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(8.5)
    pdf.text('Inteligência Aplicada', ML, 19)
  }
  pdf.setTextColor('#ffffff')
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(8.5)
  pdf.text(d.medicao.status.toUpperCase(), W - MR, 19, { align: 'right' })
```

`gerarPdfProducao` continua síncrona.

- [ ] **Step 7: Checagem de tipo**

Run: `npm run build`
Expected: build passa sem erro. Se algum dos 6 arquivos acusar erro de tipo, é sinal de que uma
tela que monta `DadosPdfX`/`DadosProducaoPdf` ainda não foi atualizada — isso é esperado até a
Task 6; ignore erros nos arquivos de `src/pages/*.tsx` nesta checagem, só confirme que os 6
arquivos de `src/lib/*Pdf.ts` desta task não têm erro de tipo dentro deles mesmos.

- [ ] **Step 8: Gerar um PDF de teste real com a logo da ENGEFER, sem UI**

Sem navegador disponível nesta sessão, a forma de verificar visualmente o resultado é gerar um PDF
de verdade com jsPDF em Node (jsPDF roda fora do navegador também) e inspecionar o arquivo gerado.
Criar um script temporário (fora do app, não faz parte do commit):

```js
// scratch: gerar-teste-marca.mjs — apagar depois de usar
import { jsPDF } from 'jspdf'
import fs from 'fs'

const logoBase64 = 'data:image/png;base64,' + fs.readFileSync('C:/Users/rodri.000/Desktop/engefer-logo-branca-pdf.png').toString('base64')

const pdf = new jsPDF({ unit: 'mm', format: 'a4' })
const W = 210, ML = 14, MR = 14
pdf.setFillColor('#1A3248')
pdf.rect(0, 0, W, 30, 'F')
pdf.setFillColor('#C49A7A')
pdf.rect(0, 30, W, 1.4, 'F')
const props = pdf.getImageProperties(logoBase64)
const alturaLogo = 22
const larguraLogo = alturaLogo * (props.width / props.height)
pdf.addImage(logoBase64, 'PNG', ML, 4, larguraLogo, alturaLogo)
pdf.setFont('helvetica', 'bold')
pdf.setFontSize(12)
pdf.setTextColor('#ffffff')
pdf.text('RELATÓRIO DIÁRIO DE OBRA', W - MR, 12, { align: 'right' })
pdf.setFontSize(10)
pdf.setTextColor('#D0AE95')
pdf.text('RDO Nº 001 · 08/09/2026', W - MR, 18.5, { align: 'right' })
pdf.setDrawColor('#C49A7A')
pdf.setLineWidth(0.5)
pdf.line(ML, 285, W - MR, 285)
pdf.setFontSize(7.5)
pdf.setTextColor('#6c757d')
pdf.text('ENGEFER - Eng. Civil Rodrigo Teles - CREA 1018712895 D/GO', ML, 290)
fs.writeFileSync('C:/Users/rodri.000/Desktop/teste-marca-engefer.pdf', Buffer.from(pdf.output('arraybuffer')))
```

Run: `node scratch/gerar-teste-marca.mjs` (ajustar caminho conforme onde o script foi salvo).
Expected: gera `C:\Users\rodri.000\Desktop\teste-marca-engefer.pdf` sem erro.

Depois, ler o PDF gerado com a ferramenta de leitura de arquivos (suporta PDF) e conferir
visualmente: faixa navy, logo branca legível à esquerda, "RELATÓRIO DIÁRIO DE OBRA" e "RDO Nº
001..." à direita, régua terracota, rodapé com o texto da ENGEFER. Se bater, o padrão está
validado para os 6 arquivos (todos usam a mesma lógica); apagar o script e o PDF de teste depois
(não fazem parte do commit).

- [ ] **Step 9: Commit**

```bash
git add src/lib/rdoPdf.ts src/lib/fvsPdf.ts src/lib/comprasPdf.ts src/lib/estoquePdf.ts src/lib/medicoesPdf.ts src/lib/producaoMedicaoPdf.ts
git commit -m "feat: identidade por obra nos 6 PDFs de faixa padrao"
```

---

### Task 4: `ganttPlanejamentoPdf.ts` (faixa condensada, carrega a própria obra)

**Files:**
- Modify: `src/lib/ganttPlanejamentoPdf.ts:1-3,44-46,162-171,257`

**Interfaces:**
- Consumes: `carregarIdentidadeObra`, `larguraProporcional` (Task 2).
- Produces: nenhuma mudança de assinatura pública — `gerarPdfGanttPlanejamento(obraId,
  semanaAtualId)` continua igual, porque este arquivo já carrega seus próprios dados do Supabase
  internamente (diferente dos outros 7, que recebem um objeto `Dados...` pronto).

- [ ] **Step 1: Import**

```ts
import { carregarIdentidadeObra, larguraProporcional } from './pdfBranding'
```

- [ ] **Step 2: Carregar a identidade junto com o nome da obra**

Substituir (linhas 44-46 atuais):

```ts
export async function gerarPdfGanttPlanejamento(obraId: string, semanaAtualId: string) {
  const obraResp = await supabase.from('obras').select('nome').eq('id', obraId).maybeSingle()
  const obraNome = obraResp.data?.nome ?? 'Obra'
```

por:

```ts
export async function gerarPdfGanttPlanejamento(obraId: string, semanaAtualId: string) {
  const obraResp = await supabase.from('obras').select('nome, logo_url, rodape_pdf').eq('id', obraId).maybeSingle()
  const obraNome = obraResp.data?.nome ?? 'Obra'
  const identidade = await carregarIdentidadeObra(obraResp.data)
```

- [ ] **Step 3: Cabeçalho — trocar o texto da marca por imagem quando houver**

Dentro de `desenharTopo()`, substituir (linhas 163-168 atuais):

```ts
    pdf.setFillColor(NAVY)
    pdf.rect(0, 0, W, 16, 'F')
    pdf.setTextColor(BRANCO)
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(13)
    pdf.text('RT ENGENHARIA - GANTT DO PLANEJAMENTO', 10, 9.5)
```

por:

```ts
    pdf.setFillColor(NAVY)
    pdf.rect(0, 0, W, 16, 'F')
    pdf.setTextColor(BRANCO)
    if (identidade.logoBase64) {
      const alturaLogo = 10
      const larguraLogo = larguraProporcional(pdf, identidade.logoBase64, alturaLogo)
      pdf.addImage(identidade.logoBase64, 'PNG', 10, 3, larguraLogo, alturaLogo)
      pdf.setFont('helvetica', 'bold')
      pdf.setFontSize(9)
      pdf.text('GANTT DO PLANEJAMENTO', 10 + larguraLogo + 4, 9.5)
    } else {
      pdf.setFont('helvetica', 'bold')
      pdf.setFontSize(13)
      pdf.text('RT ENGENHARIA - GANTT DO PLANEJAMENTO', 10, 9.5)
    }
```

(A linha seguinte, `pdf.text(obraNome, W - MR, 9.5, { align: 'right' })`, não muda.)

- [ ] **Step 4: Rodapé**

Dentro de `desenharRodape()`, substituir (linha 257 atual):

```ts
    pdf.text('RT Engenharia · Rodrigo Teles Silva · CREA 1018712895 D/GO · Inteligência Aplicada', ML, H - 6)
```

por:

```ts
    pdf.text(identidade.rodapeTexto, ML, H - 6)
```

`desenharRodape()` já está dentro do escopo de `gerarPdfGanttPlanejamento`, então `identidade`
(declarada no Step 2) já está acessível ali sem parâmetro novo.

- [ ] **Step 5: Checagem de tipo**

Run: `npm run build`
Expected: build passa sem erro.

- [ ] **Step 6: Commit**

```bash
git add src/lib/ganttPlanejamentoPdf.ts
git commit -m "feat: identidade por obra no PDF do Gantt de planejamento"
```

---

### Task 5: `requisicoesPdf.ts` (cabeçalho por ficha, texto embutido numa frase)

**Files:**
- Modify: `src/lib/requisicoesPdf.ts:1,10-14,43-57`

**Interfaces:**
- Consumes: `IdentidadeMarca` (Task 2, tipo só — este arquivo não chama `carregarIdentidadeObra`
  diretamente, recebe pronto do chamador, igual aos 6 da Task 3).
- Produces: `DadosPdfBlocoRequisicoes` ganha `identidade: IdentidadeMarca`.

Este arquivo é diferente dos outros: "RT Engenharia" aparece dentro de uma frase
(`Empresa: RT Engenharia · Obra: X`), não como um bloco de texto isolado — e o título dominante do
cabeçalho de cada ficha é "REQUISIÇÃO DE MATERIAL — ALMOXARIFADO", não o nome da empresa.

- [ ] **Step 1: Import e interface**

```ts
import { type IdentidadeMarca } from './pdfBranding'
```

Em `DadosPdfBlocoRequisicoes` (linhas 10-14 atuais), adicionar o campo:

```ts
export interface DadosPdfBlocoRequisicoes {
  obraNome: string
  identidade: IdentidadeMarca
  numeroInicial: number
  numeroFinal: number
}
```

- [ ] **Step 2: Cabeçalho de cada ficha — sem mudança de desenho, só o campo novo na interface**

Por decisão da spec §8 ("Fora de escopo"), o layout desta ficha impressa em branco não muda —
"RT Engenharia" continua fixo dentro da frase `Empresa: RT Engenharia · Obra: X`
(`desenharFicha()`, linha 57 atual), sem `if`/`else` nem uso de `d.identidade` no desenho. O
`identidade: IdentidadeMarca` adicionado ao `DadosPdfBlocoRequisicoes` no Step 1 existe só para
manter a mesma assinatura de dados nos 8 geradores (a Task 6 monta o mesmo tipo de objeto para
todos) — nenhuma linha de `desenharFicha()` muda nesta task.

- [ ] **Step 3: Checagem de tipo**

Run: `npm run build`
Expected: build passa sem erro.

- [ ] **Step 4: Commit**

```bash
git add src/lib/requisicoesPdf.ts
git commit -m "feat: adiciona campo identidade em DadosPdfBlocoRequisicoes (sem mudanca de layout)"
```

---

### Task 6: Telas que chamam os geradores — carregar a identidade antes de gerar o PDF

**Files:**
- Modify: `src/pages/RDOForm.tsx:550-551` (região)
- Modify: `src/pages/FvsForm.tsx:346-347` (região)
- Modify: `src/pages/CompraForm.tsx:418-425` (região)
- Modify: `src/pages/estoquePdf` caller — `src/pages/Almoxarifado.tsx:702-712` (região)
- Modify: `src/pages/Almoxarifado.tsx:542-548,554-560` (região, 2 chamadas)
- Modify: `src/pages/MedicaoForm.tsx:236-251` (região)
- Modify: `src/pages/ProducaoMedicaoForm.tsx:233-244` (região)
- Modify: `src/pages/Planejamento.tsx` — **sem mudança** (já resolvido dentro de
  `gerarPdfGanttPlanejamento`, Task 4).

**Interfaces:**
- Consumes: `carregarIdentidadeObra` (Task 2), `gerarPdfX` com o novo campo `identidade`/
  `DadosPdfX` (Tasks 3 e 5).

- [ ] **Step 1: `src/pages/RDOForm.tsx`**

Ler a região em torno da linha 550 antes de editar (o import dinâmico `await import('../lib/rdoPdf')`
já existe, a função já é `async`, `obraAtiva` já está disponível neste arquivo — confirmar antes de
editar). Adicionar `import { carregarIdentidadeObra } from '../lib/pdfBranding'` no topo do
arquivo. No corpo da função que gera o PDF, antes da chamada a `gerarPdfRdo({...})`, adicionar:

```ts
      const identidade = await carregarIdentidadeObra(obraAtiva)
```

E incluir `identidade,` no objeto passado para `gerarPdfRdo({ ... })` (junto aos outros campos já
existentes, como `obraNome`).

- [ ] **Step 2: `src/pages/FvsForm.tsx`** — mesmo padrão do Step 1

Adicionar o import, `const identidade = await carregarIdentidadeObra(obraAtiva)` antes de
`gerarPdfFvs({...})`, e `identidade,` no objeto passado.

- [ ] **Step 3: `src/pages/CompraForm.tsx`**

`baixarPdf()` já é `async function`, `obraAtiva` já está disponível (linha 104). Adicionar o
import. Substituir (linhas 420-422 atuais):

```ts
      const { gerarPdfPedido } = await import('../lib/comprasPdf')
      gerarPdfPedido({ pedido, itens, obraNome, servicos })
```

por:

```ts
      const { gerarPdfPedido } = await import('../lib/comprasPdf')
      const identidade = await carregarIdentidadeObra(obraAtiva)
      gerarPdfPedido({ pedido, itens, obraNome, identidade, servicos })
```

- [ ] **Step 4: `src/pages/Almoxarifado.tsx` — as 3 chamadas**

Adicionar o import no topo. `obraAtiva` já está disponível (linha 111).

`imprimirEstoque` (linha 702) é hoje `function` síncrona — trocar para `async function` (o uso em
JSX é `onMouseDown={() => imprimirEstoque('material')}`, que continua funcionando sem mudança
nenhuma com uma função async). Substituir (linhas 702-712 atuais):

```ts
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
```

por:

```ts
  async function imprimirEstoque(categoria: CategoriaMaterial) {
    const itens = materiais
      .filter(m => m.categoria === categoria)
      .sort((a, b) => a.nome.localeCompare(b.nome))
      .map(m => ({ codigo: m.codigo, nome: m.nome, und: m.und, saldo: saldos.get(m.id) ?? 0 }))
    const identidade = await carregarIdentidadeObra(obraAtiva)
    gerarPdfEstoque({
      categoriaLabel: CATEGORIA_LABEL[categoria],
      obraNome: obraAtiva?.nome ?? '',
      identidade,
      itens,
    })
    setMenuImpressaoAberto(false)
```

`baixarBloco` (linha 554) também é `function` síncrona — trocar para `async function`. Substituir
(linhas 554-560 atuais):

```ts
  function baixarBloco(b: RequisicaoBloco) {
    if (!obraAtiva) return
    gerarPdfBlocoRequisicoes({
      obraNome: obraAtiva.nome,
      numeroInicial: b.numero_inicial,
      numeroFinal: b.numero_final,
    })
```

por:

```ts
  async function baixarBloco(b: RequisicaoBloco) {
    if (!obraAtiva) return
    const identidade = await carregarIdentidadeObra(obraAtiva)
    gerarPdfBlocoRequisicoes({
      obraNome: obraAtiva.nome,
      identidade,
      numeroInicial: b.numero_inicial,
      numeroFinal: b.numero_final,
    })
```

A terceira chamada (linha ~542, dentro de uma função que já é `async` — confirmar antes de editar)
recebe o mesmo tratamento: `const identidade = await carregarIdentidadeObra(obraAtiva)` antes da
chamada, e `identidade,` adicionado ao objeto passado para `gerarPdfBlocoRequisicoes`.

- [ ] **Step 5: `src/pages/MedicaoForm.tsx`**

Este arquivo **não usa `useObra()`** — não tem `obraAtiva` disponível. O `contrato` carregado (que
já é passado para `gerarPdfMedicao`) tem `contrato.obra_id`. Adicionar o import. `imprimir()` é
hoje `function` síncrona (usada em `onClick={imprimir}`) — trocar para `async function` (o `onClick`
não precisa mudar, aceita uma função que retorna Promise sem esperar por ela). Substituir (linhas
236-251 atuais):

```ts
  function imprimir() {
    if (!contrato || !medicao) return
    gerarPdfMedicao({
      contrato,
      medicao,
      empreiteiroNome,
      itens: linhas.map(l => ({
        servicoCodigo: l.servicoCodigo,
        servicoNome: l.servicoNome,
        unidadeNome: l.unidadeNome,
        quantidadeContratada: l.quantidadeContratada,
        jaAprovado: l.jaAprovado,
        quantidadePeriodo: Number(l.quantidadePeriodo) || 0,
        valorUnitario: l.valorUnitario,
      })),
    })
  }
```

por:

```ts
  async function imprimir() {
    if (!contrato || !medicao) return
    const { data: obraRow } = await supabase.from('obras').select('logo_url, rodape_pdf').eq('id', contrato.obra_id).maybeSingle()
    const identidade = await carregarIdentidadeObra(obraRow)
    gerarPdfMedicao({
      contrato,
      medicao,
      identidade,
      empreiteiroNome,
      itens: linhas.map(l => ({
        servicoCodigo: l.servicoCodigo,
        servicoNome: l.servicoNome,
        unidadeNome: l.unidadeNome,
        quantidadeContratada: l.quantidadeContratada,
        jaAprovado: l.jaAprovado,
        quantidadePeriodo: Number(l.quantidadePeriodo) || 0,
        valorUnitario: l.valorUnitario,
      })),
    })
  }
```

- [ ] **Step 6: `src/pages/ProducaoMedicaoForm.tsx`**

`imprimir()` já é `async function`, `obraAtiva` já está disponível (linha 62). Adicionar o import.
Substituir (linhas 233-244 atuais):

```ts
  async function imprimir() {
    if (!medicao || !obraAtiva) return
    const t = trabalhadores.find((x) => x.id === trab)
    const { gerarPdfProducao } = await import('../lib/producaoMedicaoPdf')
    gerarPdfProducao({
      medicao,
      obraNome: obraAtiva.nome,
      profissionalNome: t?.nome ?? 'Profissional',
      funcao: t?.funcao ?? '',
      producao: prod,
      dias,
    })
  }
```

por:

```ts
  async function imprimir() {
    if (!medicao || !obraAtiva) return
    const t = trabalhadores.find((x) => x.id === trab)
    const { gerarPdfProducao } = await import('../lib/producaoMedicaoPdf')
    const identidade = await carregarIdentidadeObra(obraAtiva)
    gerarPdfProducao({
      medicao,
      obraNome: obraAtiva.nome,
      identidade,
      profissionalNome: t?.nome ?? 'Profissional',
      funcao: t?.funcao ?? '',
      producao: prod,
      dias,
    })
  }
```

- [ ] **Step 7: Checagem de tipo**

Run: `npm run build`
Expected: build passa sem erro — este é o primeiro momento em que o build inteiro (libs + páginas)
precisa fechar sem nenhum erro de tipo, já que todas as `DadosPdfX`/`DadosProducaoPdf` agora exigem
`identidade`.

- [ ] **Step 8: Commit**

```bash
git add src/pages/RDOForm.tsx src/pages/FvsForm.tsx src/pages/CompraForm.tsx src/pages/Almoxarifado.tsx src/pages/MedicaoForm.tsx src/pages/ProducaoMedicaoForm.tsx
git commit -m "feat: telas carregam a identidade da obra antes de gerar PDF"
```

---

### Task 7: Upload de logo/rodapé em `/dados-obra`

**Files:**
- Modify: `src/pages/DadosObra.tsx`

**Interfaces:**
- Consumes: bucket `obras-logos` (Task 1), colunas `Obra.logo_url`/`rodape_pdf` (Task 2).

- [ ] **Step 1: Novo estado**

Adicionar, junto aos outros `useState` do componente (após a linha `const [status, setStatus] =
useState<StatusObra>('ativa')`):

```ts
  const [logoUrl, setLogoUrl] = useState<string | null>(null)
  const [rodapePdf, setRodapePdf] = useState('')
  const [logoArquivo, setLogoArquivo] = useState<File | null>(null)
  const [enviandoLogo, setEnviandoLogo] = useState(false)
```

- [ ] **Step 2: Popular ao abrir edição e limpar ao abrir cadastro novo**

Em `abrirNovo()`, adicionar depois de `setStatus('ativa')`:

```ts
    setLogoUrl(null); setRodapePdf(''); setLogoArquivo(null)
```

Em `abrirEdicao(o: Obra)`, adicionar depois de `setStatus(o.status)`:

```ts
    setLogoUrl(o.logo_url)
    setRodapePdf(o.rodape_pdf ?? '')
    setLogoArquivo(null)
```

- [ ] **Step 3: Upload da imagem e gravação dos dois campos em `salvar()`**

Substituir (linhas 65-94 atuais):

```ts
  async function salvar() {
    if (!nome.trim()) {
      setMsg({ tipo: 'erro', texto: 'Informe o nome da obra.' })
      return
    }
    setSalvando(true)
    setMsg(null)
    const dados = {
      nome: nome.trim(),
      descricao: descricao.trim() || null,
      endereco: endereco.trim() || null,
      cidade: cidade.trim() || null,
      estado: estado.trim().toUpperCase() || null,
      data_inicio: dataInicio || null,
      data_fim_prevista: dataFimPrevista || null,
      status,
    }
    const { error } = editandoId
      ? await supabase.from('obras').update(dados).eq('id', editandoId)
      : await supabase.from('obras').insert({ ...dados, criado_por: perfil?.id })
    setSalvando(false)
    if (error) {
      setMsg({ tipo: 'erro', texto: `Erro ao salvar: ${error.message}` })
      return
    }
    setMsg({ tipo: 'ok', texto: editandoId ? 'Obra atualizada.' : 'Obra cadastrada.' })
    setFormAberto(false)
    carregar()
    recarregar()
  }
```

por:

```ts
  async function salvar() {
    if (!nome.trim()) {
      setMsg({ tipo: 'erro', texto: 'Informe o nome da obra.' })
      return
    }
    if (logoArquivo && !rodapePdf.trim()) {
      setMsg({ tipo: 'erro', texto: 'Informe o texto do rodapé junto com a logo.' })
      return
    }
    setSalvando(true)
    setMsg(null)

    let novoLogoUrl = logoUrl
    if (logoArquivo && editandoId) {
      setEnviandoLogo(true)
      const caminho = `${editandoId}/logo.png`
      const { error: erroUpload } = await supabase.storage
        .from('obras-logos')
        .upload(caminho, logoArquivo, { upsert: true, contentType: 'image/png' })
      setEnviandoLogo(false)
      if (erroUpload) {
        setSalvando(false)
        setMsg({ tipo: 'erro', texto: `Erro ao enviar a logo: ${erroUpload.message}` })
        return
      }
      novoLogoUrl = caminho
    }

    const dados = {
      nome: nome.trim(),
      descricao: descricao.trim() || null,
      endereco: endereco.trim() || null,
      cidade: cidade.trim() || null,
      estado: estado.trim().toUpperCase() || null,
      data_inicio: dataInicio || null,
      data_fim_prevista: dataFimPrevista || null,
      status,
      logo_url: novoLogoUrl,
      rodape_pdf: rodapePdf.trim() || null,
    }
    const { error } = editandoId
      ? await supabase.from('obras').update(dados).eq('id', editandoId)
      : await supabase.from('obras').insert({ ...dados, criado_por: perfil?.id })
    setSalvando(false)
    if (error) {
      setMsg({ tipo: 'erro', texto: `Erro ao salvar: ${error.message}` })
      return
    }
    setMsg({ tipo: 'ok', texto: editandoId ? 'Obra atualizada.' : 'Obra cadastrada.' })
    setFormAberto(false)
    carregar()
    recarregar()
  }
```

(Obra nova não tem `id` até ser inserida — por isso o upload só acontece com `editandoId` definido,
igual decidido na spec §7. Cadastrar uma obra nova continua sem campo de logo até a primeira
edição.)

- [ ] **Step 4: Campo no formulário**

No JSX, depois do bloco `<label className={styles.campo}>Status ... </label>` (linha 154 atual,
antes do `</div>` que fecha `styles.campos`), adicionar, **só quando `editandoId` não é `null`**:

```tsx
            {editandoId && (
              <>
                <label className={styles.campo}>
                  Logo para os PDFs desta obra (PNG, fundo transparente)
                  <input
                    type="file"
                    accept="image/png"
                    onChange={e => setLogoArquivo(e.target.files?.[0] ?? null)}
                  />
                  {logoUrl && !logoArquivo && <small>Já existe uma logo cadastrada — escolher um arquivo novo substitui.</small>}
                  {enviandoLogo && <small>Enviando…</small>}
                </label>
                <label className={styles.campo}>
                  Texto do rodapé dos PDFs (deixe vazio para usar o padrão RT Engenharia)
                  <input
                    value={rodapePdf}
                    onChange={e => setRodapePdf(e.target.value)}
                    placeholder="Ex.: ENGEFER - Eng. Civil Rodrigo Teles - CREA 1018712895 D/GO"
                  />
                </label>
              </>
            )}
```

- [ ] **Step 5: Checagem de tipo**

Run: `npm run build`
Expected: build passa sem erro.

- [ ] **Step 6: Commit**

```bash
git add src/pages/DadosObra.tsx
git commit -m "feat: upload de logo e rodape por obra em /dados-obra"
```

---

### Task 8: Aplicar a logo real na obra ENGEFER Sudoeste

**Files:** nenhum arquivo de código — só dados em produção (Storage + tabela `obras`), via
Supabase MCP.

**Interfaces:**
- Consumes: bucket `obras-logos` (Task 1).

- [ ] **Step 1: Confirmar que não há caminho de upload binário via MCP (já verificado)**

O Supabase MCP disponível nesta sessão só expõe `apply_migration`/`execute_sql` (SQL) e operações
de gestão de projeto — nenhuma ferramenta faz upload de um arquivo binário para o Storage (o
conteúdo de um objeto de Storage não vive em `storage.objects` via SQL, vive no backend de
armazenamento por trás dele; um `INSERT` em `storage.objects` não cria o arquivo de verdade). Por
isso, o upload real da logo **precisa acontecer pela tela construída na Task 7** (login como admin,
editar a obra ENGEFER Sudoeste, escolher `C:\Users\rodri.000\Desktop\engefer-logo-branca-pdf.png`,
salvar) — não por SQL direto. Este step não tem ação, só documenta por que o Step 2 é uma
pendência, não algo resolvido nesta task.

- [ ] **Step 2: Pendência registrada — upload real pela tela, depois da Task 7 em produção**

Sem ação de código ou banco aqui. Assim que a Task 7 estiver aplicada e implantada, logar como
admin, abrir `/dados-obra`, editar "ENGEFER SUDOESTE" e enviar o arquivo do Step 1. Marcar este
step como concluído só depois que o upload de verdade tiver acontecido (conferir com o Step 4
abaixo, que consulta `logo_url` na tabela).

- [ ] **Step 3: Gravar o texto do rodapé (isso sim é uma coluna normal, dá para gravar por SQL)**

```sql
UPDATE obras
SET rodape_pdf = 'ENGEFER - Eng. Civil Rodrigo Teles - CREA 1018712895 D/GO'
WHERE id = 'e13b37c5-e317-4a5b-b5b9-c3337e30680a';
```

Rodar via `execute_sql` no projeto `yxshldsfmbmbzdkcymca`.

- [ ] **Step 4: Verificar**

```sql
SELECT id, nome, logo_url, rodape_pdf FROM obras WHERE id = 'e13b37c5-e317-4a5b-b5b9-c3337e30680a';
```

Expected: `rodape_pdf` preenchido; `logo_url` ainda `NULL` até o upload real acontecer pela tela
(Step 2 explica por quê SQL sozinho não resolve isso).

- [ ] **Step 5: Sem commit** (nenhuma mudança de arquivo nesta task — é aplicação de dado em
  produção).

---

## Observação sobre a Task 8

Diferente da Task 8 do plano anterior desta sessão (onde tudo podia ser feito por `execute_sql`), o
upload de um arquivo binário para o Storage não é algo que uma migração SQL consiga fazer — o
conteúdo do arquivo vive fora do Postgres. A forma correta de aplicar a logo real é logar como
admin depois que a Task 7 estiver em produção e usar a tela nova. Isso deve ficar registrado como
pendência explícita para Rodrigo (ou para quem revisar antes do teste de campo), não como algo já
resolvido.
