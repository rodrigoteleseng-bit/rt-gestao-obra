# Controle Tecnológico — Mapa embutido no PDF + numeração CTC-001 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O PDF gerado pelo Controle Tecnológico passa a ter 2 páginas num único arquivo — página 1
é o mapa de concretagem anexado (foto ou PDF de 1 página, convertido em imagem), página 2 é a
tabela-legenda dos caminhões que já existe hoje — e cada concretagem ganha um identificador
sequencial por obra (`CTC-001`, `CTC-002`...) mostrado no cabeçalho dessa página 2.

**Architecture:** Reaproveita `pdfjs-dist` (já usado por `src/lib/pdfParaImagem.ts` na Produção
própria) para rasterizar o anexo — nenhuma biblioteca nova. `gerarPdfConcretagem` vira `async`:
baixa e converte o anexo primeiro, cria o documento jsPDF já na orientação certa pra essa imagem,
desenha a página do mapa, adiciona uma segunda página sempre paisagem com o conteúdo atual da
tabela (mais a numeração no cabeçalho), e escreve o rodapé (linha + página X de Y) em todas as
páginas do documento de uma vez, adaptado à altura real de cada página. A numeração é atribuída no
banco via trigger `BEFORE INSERT`, mesmo padrão já usado em Contratos (`CT-001`).

**Tech Stack:** Supabase (Postgres + RLS) + React 19 + TypeScript + Vite + jsPDF + pdfjs-dist (já
dependências do projeto). Sem framework de testes — verificação por SQL direto
(`apply_migration`/`execute_sql`), `npm run build`, e geração real do PDF via Node fora do
navegador quando possível (como no ajuste anterior).

## Global Constraints

- Spec completa: `docs/superpowers/specs/2026-09-10-ct-pdf-mapa-numeracao-design.md` — ler antes
  de implementar qualquer task. Refina
  `docs/superpowers/specs/2026-09-09-controle-tecnologico-concreto-design.md`.
- **Sem biblioteca nova.** `pdfjs-dist` já é dependência do projeto (`package.json`), usado hoje
  em `src/lib/pdfParaImagem.ts` pela Produção própria — é reaproveitado aqui, não reinstalado.
- **Erro é bloqueante, sem exceção**: se o download ou a conversão do anexo falhar, a geração
  inteira falha (nenhum PDF sai, nem só com a tabela). Confirmado com o Rodrigo.
- **Anexo sempre tem 1 página** quando é PDF — confirmado com o Rodrigo, não precisa lidar com
  anexo de múltiplas páginas.
- Numeração `CTC-XXX`: sequência **por obra**, atribuída **no banco via trigger na criação**
  (nunca calculada em runtime, nunca recalculada, nunca reaproveitada se uma concretagem for
  excluída) — mesmo padrão de `contratos_seq`/`proximo_numero_contrato()` em
  `supabase/migrations/20260713_fase7_contratos.sql:26-81`.
- Numeração aparece **só no PDF**, nunca em nenhuma tela do app — confirmado com o Rodrigo.
- Toda função `SECURITY DEFINER` precisa de `SET search_path = public` desde a criação (regra do
  projeto desde `20260719_hardening_pode_editar_e_triggers.sql`).
- Este módulo ainda não tem aceite de campo — não há linhas reais em `ct_concretagens` hoje (0
  registros, confirmado), então não há dado de produção a preservar/migrar nesta mudança.

---

### Task 1: Migração — numeração CTC-001 por obra

**Files:**
- Create: `supabase/migrations/20260910_ct_numeracao.sql`

**Interfaces:**
- Produces: coluna `ct_concretagens.numero` (TEXT NOT NULL, único por obra). Usada pela Task 3
  (tipo TypeScript + impressão no cabeçalho do PDF).

- [ ] **Step 1: Escrever a migração**

Criar `supabase/migrations/20260910_ct_numeracao.sql`:

```sql
-- Numeração sequencial por obra do Controle Tecnológico (CTC-001, CTC-002...),
-- atribuída no momento da criação da concretagem — nunca recalculada, nunca
-- reaproveitada. Mesmo padrão de contratos_seq/proximo_numero_contrato()
-- (ver supabase/migrations/20260713_fase7_contratos.sql:26-81). Aparece só
-- no cabeçalho do PDF (ver docs/superpowers/specs/2026-09-10-ct-pdf-mapa-numeracao-design.md).
-- Não há linhas em ct_concretagens hoje (0 registros) — sem dado a migrar.

CREATE TABLE ct_concretagens_seq (
  obra_id       UUID PRIMARY KEY REFERENCES obras(id) ON DELETE CASCADE,
  ultimo_numero INTEGER NOT NULL DEFAULT 0
);

INSERT INTO ct_concretagens_seq (obra_id, ultimo_numero)
SELECT id, 0 FROM obras
ON CONFLICT (obra_id) DO NOTHING;

ALTER TABLE ct_concretagens ADD COLUMN numero TEXT;

CREATE OR REPLACE FUNCTION proximo_numero_ctc() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_numero INTEGER;
BEGIN
  INSERT INTO ct_concretagens_seq (obra_id, ultimo_numero)
  VALUES (NEW.obra_id, 0)
  ON CONFLICT (obra_id) DO NOTHING;

  UPDATE ct_concretagens_seq
    SET ultimo_numero = ultimo_numero + 1
    WHERE obra_id = NEW.obra_id
    RETURNING ultimo_numero INTO v_numero;

  NEW.numero := 'CTC-' || lpad(v_numero::text, 3, '0');
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_numero_ctc
  BEFORE INSERT ON ct_concretagens
  FOR EACH ROW EXECUTE FUNCTION proximo_numero_ctc();

ALTER TABLE ct_concretagens ALTER COLUMN numero SET NOT NULL;
ALTER TABLE ct_concretagens ADD CONSTRAINT ct_concretagens_numero_unico UNIQUE (obra_id, numero);

ALTER TABLE ct_concretagens_seq ENABLE ROW LEVEL SECURITY;
CREATE POLICY ctcseq_select ON ct_concretagens_seq FOR SELECT
  USING (meu_papel() IN ('admin', 'equipe'));
```

- [ ] **Step 2: Aplicar a migração**

Aplicar via `mcp__claude_ai_Supabase__apply_migration` (projeto `yxshldsfmbmbzdkcymca`, nome
`ct_numeracao`).

- [ ] **Step 3: Verificar**

```sql
SELECT column_name, is_nullable FROM information_schema.columns
WHERE table_name = 'ct_concretagens' AND column_name = 'numero';
-- Esperado: numero | NO

SELECT conname FROM pg_constraint WHERE conname = 'ct_concretagens_numero_unico';
-- Esperado: 1 linha

SELECT obra_id, ultimo_numero FROM ct_concretagens_seq;
-- Esperado: 1 linha por obra cadastrada hoje, ultimo_numero = 0 em todas

SELECT prosecdef, proconfig FROM pg_proc WHERE proname = 'proximo_numero_ctc';
-- Esperado: prosecdef = true, proconfig contém 'search_path=public'
```

Teste funcional real (sem transação — INSERT/DELETE direto, mesmo padrão já usado nesta sessão
para validar a Fase 1 do Controle Tecnológico), usando a obra piloto e uma Unidade real:

```sql
INSERT INTO ct_concretagens (obra_id, unidade_id, data, anexo_url, criado_por)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  (SELECT id FROM unidades WHERE obra_id = '00000000-0000-0000-0000-000000000001' LIMIT 1),
  CURRENT_DATE, 'teste/teste-numeracao.pdf',
  (SELECT id FROM perfis_usuario WHERE papel = 'admin' LIMIT 1)
)
RETURNING id, numero;
-- Esperado: numero = 'CTC-001'

-- Lançar uma segunda pra confirmar o incremento, depois apagar as duas:
INSERT INTO ct_concretagens (obra_id, unidade_id, data, anexo_url, criado_por)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  (SELECT id FROM unidades WHERE obra_id = '00000000-0000-0000-0000-000000000001' LIMIT 1),
  CURRENT_DATE, 'teste/teste-numeracao-2.pdf',
  (SELECT id FROM perfis_usuario WHERE papel = 'admin' LIMIT 1)
)
RETURNING id, numero;
-- Esperado: numero = 'CTC-002'

DELETE FROM ct_concretagens WHERE anexo_url IN ('teste/teste-numeracao.pdf', 'teste/teste-numeracao-2.pdf');
SELECT count(*) FROM ct_concretagens;
-- Esperado: 0 (limpo, sem deixar resíduo — e ultimo_numero da obra fica em 2, o que é
-- esperado e correto: números nunca são reaproveitados, mesmo de linhas apagadas)
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260910_ct_numeracao.sql
git commit -m "feat: numeracao sequencial CTC-001 por obra no Controle Tecnologico"
```

---

### Task 2: `pdfParaImagem.ts` — preparar o anexo (PDF ou imagem) como imagem única

**Files:**
- Modify: `src/lib/pdfParaImagem.ts`

**Interfaces:**
- Consumes: nada de outras tasks — este arquivo é independente.
- Produces: `converterPdfParaImagem(arquivo: Blob): Promise<Blob>` (tipo do parâmetro ampliado de
  `File` para `Blob` — compatível com o único call site existente, `Producao.tsx:944`, que passa
  um `File`); `interface ImagemAnexo { dataUrl: string; width: number; height: number }`;
  `prepararImagemAnexo(blob: Blob, nomeArquivo: string): Promise<ImagemAnexo>`. Ambos exportados
  de `src/lib/pdfParaImagem.ts`, consumidos pela Task 3.

- [ ] **Step 1: Ler o arquivo atual**

`src/lib/pdfParaImagem.ts` hoje (24 linhas):

```ts
import * as pdfjsLib from 'pdfjs-dist'
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker

export async function converterPdfParaImagem(arquivo: File): Promise<Blob> {
  const buffer = await arquivo.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise
  const pagina = await pdf.getPage(1)
  const viewport = pagina.getViewport({ scale: 2 })
  const canvas = document.createElement('canvas')
  canvas.width = viewport.width
  canvas.height = viewport.height
  const contexto = canvas.getContext('2d')
  if (!contexto) throw new Error('Não foi possível preparar a conversão do PDF.')
  await pagina.render({ canvasContext: contexto, viewport, canvas }).promise
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('Falha ao gerar a imagem da planta.'))
    }, 'image/png')
  })
}
```

- [ ] **Step 2: Ampliar o tipo do parâmetro de `File` para `Blob`**

Trocar a linha 6 (`export async function converterPdfParaImagem(arquivo: File): Promise<Blob> {`)
por:

```ts
export async function converterPdfParaImagem(arquivo: Blob): Promise<Blob> {
```

(Todo `File` já é um `Blob` — `arquivo.arrayBuffer()` na linha seguinte já funciona em `Blob`, e o
único call site hoje, `Producao.tsx:944`, continua passando um `File` sem nenhuma mudança.)

- [ ] **Step 3: Adicionar `prepararImagemAnexo` e seus helpers, no final do arquivo**

```ts
export interface ImagemAnexo {
  dataUrl: string
  width: number
  height: number
}

function ehPdf(nomeArquivo: string): boolean {
  return nomeArquivo.toLowerCase().endsWith('.pdf')
}

async function blobParaDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as string)
    r.onerror = reject
    r.readAsDataURL(blob)
  })
}

// Normaliza QUALQUER formato de imagem que o navegador consiga decodificar
// (JPEG, PNG, WEBP, HEIC quando suportado) para PNG via canvas — evita
// depender dos formatos nativos que o jsPDF aceita (só JPEG/PNG confiáveis).
async function normalizarImagemParaPng(blob: Blob): Promise<ImagemAnexo> {
  const url = URL.createObjectURL(blob)
  try {
    const img = new Image()
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('Não foi possível carregar a imagem do anexo.'))
      img.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth
    canvas.height = img.naturalHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Não foi possível preparar a conversão da imagem.')
    ctx.drawImage(img, 0, 0)
    return { dataUrl: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height }
  } finally {
    URL.revokeObjectURL(url)
  }
}

// Devolve o anexo (PDF de 1 página ou foto) já pronto pra `pdf.addImage`,
// com as dimensões naturais — necessárias pra decidir a orientação da
// página e encaixar a imagem sem distorcer (ver desenharPaginaMapa em
// controleTecnologicoPdf.ts).
export async function prepararImagemAnexo(blob: Blob, nomeArquivo: string): Promise<ImagemAnexo> {
  if (ehPdf(nomeArquivo)) {
    const pngBlob = await converterPdfParaImagem(blob)
    const dataUrl = await blobParaDataUrl(pngBlob)
    return normalizarImagemParaPng(await (await fetch(dataUrl)).blob())
  }
  return normalizarImagemParaPng(blob)
}
```

- [ ] **Step 4: Build**

```bash
npm run build
```

Esperado: 0 erros de TypeScript. `Producao.tsx:944` continua compilando sem mudança (o tipo
`Blob` aceita o `File` que já era passado ali).

- [ ] **Step 5: Commit**

```bash
git add src/lib/pdfParaImagem.ts
git commit -m "feat: prepara anexo (PDF ou imagem) como imagem unica para PDFs gerados"
```

---

### Task 3: `controleTecnologicoPdf.ts` — página do mapa + numeração no cabeçalho

**Files:**
- Modify: `src/lib/supabase.ts` (tipo `CtConcretagem`)
- Modify: `src/lib/controleTecnologicoPdf.ts`

**Interfaces:**
- Consumes: `ct_concretagens.numero` (Task 1); `prepararImagemAnexo`, `ImagemAnexo` (Task 2).
- Produces: `CtConcretagem.numero: string` em `src/lib/supabase.ts`; `gerarPdfConcretagem` passa a
  ser `async` (`Promise<void>` em vez de `void`) — muda a assinatura consumida pela Task 4.

- [ ] **Step 1: Adicionar `numero` à interface `CtConcretagem`**

Em `src/lib/supabase.ts:268-282`, hoje:

```ts
export interface CtConcretagem {
  id: string
  obra_id: string
  unidade_id: string
  planta_id: string | null
  pavimento_identificacao: string | null
  anexo_url: string | null
  data: string
  status: StatusConcretagem
  finalizada_por: string | null
  finalizada_em: string | null
  ativo: boolean
  criado_por: string
  criado_em: string
}
```

Trocar por (linha `numero` nova, logo depois de `id`):

```ts
export interface CtConcretagem {
  id: string
  numero: string
  obra_id: string
  unidade_id: string
  planta_id: string | null
  pavimento_identificacao: string | null
  anexo_url: string | null
  data: string
  status: StatusConcretagem
  finalizada_por: string | null
  finalizada_em: string | null
  ativo: boolean
  criado_por: string
  criado_em: string
}
```

- [ ] **Step 2: Reescrever `src/lib/controleTecnologicoPdf.ts` por completo**

O arquivo hoje tem 135 linhas (1 função `gerarPdfConcretagem`, síncrona, desenha tudo direto na
página 1). Substituir o conteúdo inteiro do arquivo por:

```ts
// Geração do PDF do Controle Tecnológico do Concreto (jsPDF, client-side).
// Cabeçalho com identidade RT (mesmo padrão de todo PDF do app, ver medicoesPdf.ts) +
// dados da concretagem + tabela-legenda dos caminhões. Página 1 = mapa de
// concretagem anexado (convertido em imagem via prepararImagemAnexo — PDF de
// 1 página ou foto, nunca a ferramenta de pintura, que é Fase 2). Página 2 =
// cabeçalho + tabela-legenda, sempre paisagem.
import { jsPDF } from 'jspdf'
import { supabase, type CtConcretagem, type CtCaminhao } from './supabase'
import { larguraProporcional, type IdentidadeMarca } from './pdfBranding'
import { prepararImagemAnexo, type ImagemAnexo } from './pdfParaImagem'

const NAVY = '#1A3248'
const TERRACOTA = '#C49A7A'
const CINZA = '#6c757d'
const ML = 14
const MR = 14

export interface DadosPdfConcretagem {
  concretagem: CtConcretagem
  caminhoes: CtCaminhao[]
  identidade: IdentidadeMarca
  obraNome: string
  unidadeNome: string
}

function fmtData(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`
}

function fmtHora(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

function fmtSlumpSolicitado(nominal: number | null, tolerancia: number | null): string {
  if (nominal === null) return '—'
  return tolerancia ? `${nominal}±${tolerancia}` : `${nominal}`
}

function desenharPaginaMapa(pdf: jsPDF, imagem: ImagemAnexo, orientacao: 'landscape' | 'portrait'): void {
  const [W, H] = orientacao === 'landscape' ? [297, 210] : [210, 297]
  const M = 10
  const boxW = W - 2 * M
  const boxH = H - 2 * M
  const escala = Math.min(boxW / imagem.width, boxH / imagem.height)
  const larguraFinal = imagem.width * escala
  const alturaFinal = imagem.height * escala
  const x = (W - larguraFinal) / 2
  const y = (H - alturaFinal) / 2
  pdf.addImage(imagem.dataUrl, 'PNG', x, y, larguraFinal, alturaFinal)
}

function desenharPaginaTabela(pdf: jsPDF, d: DadosPdfConcretagem): void {
  const W = 297
  const LARG = W - ML - MR
  let y = 0

  pdf.setFillColor(NAVY)
  pdf.rect(0, 0, W, 30, 'F')
  pdf.setFillColor(TERRACOTA)
  pdf.rect(0, 30, W, 1.4, 'F')
  if (d.identidade.logoBase64) {
    const alturaLogo = 22
    const larguraLogo = larguraProporcional(pdf, d.identidade.logoBase64, alturaLogo)
    pdf.addImage(d.identidade.logoBase64, 'PNG', ML, 4, larguraLogo, alturaLogo)
  } else {
    pdf.setTextColor('#ffffff')
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(17)
    pdf.text('RT ENGENHARIA', ML, 13)
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(8.5)
    pdf.setTextColor('#B8D4E8')
    pdf.text('Inteligência Aplicada', ML, 18.5)
  }
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(14)
  pdf.setTextColor('#ffffff')
  pdf.text('CONTROLE TECNOLÓGICO DO CONCRETO', W - MR, 13, { align: 'right' })

  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(9)
  pdf.setTextColor('#D0AE95')
  const textoObraLinha = `${d.obraNome} · ${d.unidadeNome} · ${fmtData(d.concretagem.data)}`
  pdf.text(textoObraLinha, W - MR, 19, { align: 'right' })

  // Numeração (CTC-001...) fica à esquerda dessa linha, com uma folga medida
  // via getTextWidth — não uma posição fixa — pra nunca encostar no texto da
  // obra mesmo com nome de obra comprido (mesma técnica usada no ajuste do
  // fornecedor da tabela abaixo, ver docs/superpowers/plans/2026-09-10-ct-lacre-horario-slump.md).
  const larguraObraLinha = pdf.getTextWidth(textoObraLinha)
  pdf.setFont('helvetica', 'bold')
  pdf.setTextColor('#ffffff')
  pdf.text(d.concretagem.numero, W - MR - larguraObraLinha - 6, 19, { align: 'right' })
  y = 40

  const colX = { cor: ML, fornecedor: ML + 12, nf: ML + 78, amostra: ML + 97, lacre: ML + 125, volume: ML + 152, slump: ML + 167, saida: ML + 192, chegada: ML + 204, inicio: ML + 220, fim: ML + 235 }
  pdf.setFillColor('#F0EBE3')
  pdf.rect(ML, y, LARG, 7, 'F')
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(7)
  pdf.setTextColor(NAVY)
  pdf.text('', colX.cor + 1, y + 4.7)
  pdf.text('FORNECEDOR', colX.fornecedor, y + 4.7)
  pdf.text('NF', colX.nf, y + 4.7)
  pdf.text('AMOSTRA', colX.amostra, y + 4.7)
  pdf.text('LACRE', colX.lacre, y + 4.7)
  pdf.text('VOL. (M³)', colX.volume, y + 4.7)
  pdf.text('SLUMP SOL./MED.', colX.slump, y + 4.7)
  pdf.text('SAÍDA', colX.saida, y + 4.7)
  pdf.text('CHEGADA', colX.chegada, y + 4.7)
  pdf.text('IN. DESC.', colX.inicio, y + 4.7)
  pdf.text('FIM DESC.', colX.fim, y + 4.7)
  y += 7

  for (const c of d.caminhoes) {
    pdf.setDrawColor('#E0DAD0')
    pdf.setLineWidth(0.2)
    pdf.line(ML, y, W - MR, y)
    pdf.setFillColor(c.cor)
    pdf.rect(colX.cor + 1, y + 1.5, 5, 5, 'F')
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(8)
    pdf.setTextColor('#222222')
    pdf.text(c.fornecedor, colX.fornecedor, y + 5.2)
    pdf.text(c.nf, colX.nf, y + 5.2)
    pdf.text(c.numero_amostra, colX.amostra, y + 5.2)
    pdf.text(c.numero_lacre, colX.lacre, y + 5.2)
    pdf.text(`${c.volume_m3}`, colX.volume, y + 5.2)
    pdf.text(`${fmtSlumpSolicitado(c.slump_solicitado_cm, c.slump_tolerancia_cm)} / ${c.slump_medido_cm ?? '—'}`, colX.slump, y + 5.2)
    pdf.text(fmtHora(c.hora_saida_usina), colX.saida, y + 5.2)
    pdf.text(fmtHora(c.hora_chegada_obra), colX.chegada, y + 5.2)
    pdf.text(fmtHora(c.hora_inicio_descarga), colX.inicio, y + 5.2)
    pdf.text(fmtHora(c.hora_fim_descarga), colX.fim, y + 5.2)
    y += 8
  }
  pdf.setDrawColor('#E0DAD0')
  pdf.line(ML, y, W - MR, y)
  y += 6

  pdf.setFont('helvetica', 'italic')
  pdf.setFontSize(8)
  pdf.setTextColor(CINZA)
  pdf.text('Mapa de concretagem na página anterior.', ML, y)
}

// Roda por último, depois que todas as páginas existem — pdf.getNumberOfPages()
// já conta a página do mapa. Usa a altura REAL de cada página (não um valor
// fixo de paisagem), porque a página do mapa pode ser retrato.
function desenharRodapeTodasPaginas(pdf: jsPDF, rodapeTexto: string): void {
  const totalPaginas = pdf.getNumberOfPages()
  for (let i = 1; i <= totalPaginas; i++) {
    pdf.setPage(i)
    const W = pdf.internal.pageSize.getWidth()
    const H = pdf.internal.pageSize.getHeight()
    const yLinha = H - 14
    const yTexto = H - 9
    pdf.setDrawColor(TERRACOTA)
    pdf.setLineWidth(0.5)
    pdf.line(ML, yLinha, W - MR, yLinha)
    pdf.setFontSize(7.5)
    pdf.setTextColor(CINZA)
    pdf.setFont('helvetica', 'normal')
    pdf.text(rodapeTexto, ML, yTexto)
    pdf.text(`Página ${i} de ${totalPaginas}`, W - MR, yTexto, { align: 'right' })
  }
}

export async function gerarPdfConcretagem(d: DadosPdfConcretagem): Promise<void> {
  if (!d.concretagem.anexo_url) {
    throw new Error('Esta concretagem não tem mapa anexado — não é possível gerar o PDF.')
  }
  const { data: blob, error } = await supabase.storage
    .from('controle-tecnologico')
    .download(d.concretagem.anexo_url)
  if (error || !blob) {
    throw new Error(`Não foi possível baixar o mapa anexado: ${error?.message ?? 'arquivo não encontrado'}`)
  }
  const imagem = await prepararImagemAnexo(blob, d.concretagem.anexo_url)

  const orientacaoMapa = imagem.width >= imagem.height ? 'landscape' : 'portrait'
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: orientacaoMapa })
  desenharPaginaMapa(pdf, imagem, orientacaoMapa)

  pdf.addPage('a4', 'landscape')
  desenharPaginaTabela(pdf, d)

  desenharRodapeTodasPaginas(pdf, d.identidade.rodapeTexto)

  pdf.save(`Controle Tecnologico - ${d.unidadeNome} - ${fmtData(d.concretagem.data)}.pdf`)
}
```

(A frase do rodapé de texto da tabela mudou de "Mapa de concretagem anexado separadamente na tela
do app." para "Mapa de concretagem na página anterior." — o mapa deixou de ser separado, agora é
a página 1 do mesmo arquivo.)

- [ ] **Step 3: Build**

```bash
npm run build
```

Esperado: 0 erros de TypeScript. `ControleTecnologicoForm.tsx` vai mostrar erro nesta hora porque
ainda chama `gerarPdfConcretagem(...)` sem `await` e sem tratar a `Promise` — isso é esperado e é
justamente o que a Task 4 corrige a seguir. Confirmar que o erro reportado é exatamente esse (uso
de `gerarPdfConcretagem` sem await) e não algum outro problema de tipo introduzido nesta task.

- [ ] **Step 4: Commit**

```bash
git add src/lib/supabase.ts src/lib/controleTecnologicoPdf.ts
git commit -m "feat: embute o mapa anexado como pagina 1 do PDF e mostra a numeracao CTC no cabecalho"
```

---

### Task 4: Frontend — `imprimir()` assíncrono com estado de carregamento

**Files:**
- Modify: `src/pages/ControleTecnologicoForm.tsx`
- Modify: `src/pages/ControleTecnologicoForm.module.css`

**Interfaces:**
- Consumes: `gerarPdfConcretagem` agora `Promise<void>` (Task 3).

- [ ] **Step 1: Adicionar o estado `gerandoPdf`**

Em `src/pages/ControleTecnologicoForm.tsx:60` (logo depois de
`const [finalizando, setFinalizando] = useState(false)`), adicionar:

```ts
  const [gerandoPdf, setGerandoPdf] = useState(false)
```

- [ ] **Step 2: Reescrever `imprimir()` com tratamento de erro**

Em `src/pages/ControleTecnologicoForm.tsx:205-218`, hoje:

```ts
  async function imprimir() {
    if (!concretagem || !obraAtiva) return
    const { gerarPdfConcretagem } = await import('../lib/controleTecnologicoPdf')
    const { data: obraRow } = await supabase.from('obras')
      .select('nome, logo_url, rodape_pdf').eq('id', obraAtiva.id).maybeSingle()
    const { carregarIdentidadeObra } = await import('../lib/pdfBranding')
    const identidade = await carregarIdentidadeObra(obraRow)
    const nomeUnidadeAtual = unidades.find(u => u.id === concretagem.unidade_id)?.nome ?? '—'
    gerarPdfConcretagem({
      concretagem, caminhoes, identidade,
      obraNome: obraRow?.nome ?? '—',
      unidadeNome: nomeUnidadeAtual,
    })
  }
```

Trocar por:

```ts
  async function imprimir() {
    if (!concretagem || !obraAtiva) return
    setGerandoPdf(true)
    setMsgCaminhao(null)
    try {
      const { gerarPdfConcretagem } = await import('../lib/controleTecnologicoPdf')
      const { data: obraRow } = await supabase.from('obras')
        .select('nome, logo_url, rodape_pdf').eq('id', obraAtiva.id).maybeSingle()
      const { carregarIdentidadeObra } = await import('../lib/pdfBranding')
      const identidade = await carregarIdentidadeObra(obraRow)
      const nomeUnidadeAtual = unidades.find(u => u.id === concretagem.unidade_id)?.nome ?? '—'
      await gerarPdfConcretagem({
        concretagem, caminhoes, identidade,
        obraNome: obraRow?.nome ?? '—',
        unidadeNome: nomeUnidadeAtual,
      })
    } catch (e) {
      setMsgCaminhao({ tipo: 'erro', texto: e instanceof Error ? e.message : 'Erro ao gerar o PDF.' })
    } finally {
      setGerandoPdf(false)
    }
  }
```

- [ ] **Step 3: Botão "Imprimir PDF" com estado de carregamento**

Em `src/pages/ControleTecnologicoForm.tsx:390-394`, hoje:

```tsx
      {concretagem.status === 'finalizada' && (
        <div className={styles.bloco}>
          <button className={styles.btnSecundario} onClick={imprimir}>🖨️ Imprimir PDF</button>
        </div>
      )}
```

Trocar por:

```tsx
      {concretagem.status === 'finalizada' && (
        <div className={styles.bloco}>
          <button className={styles.btnSecundario} onClick={imprimir} disabled={gerandoPdf}>
            {gerandoPdf ? 'Gerando PDF…' : '🖨️ Imprimir PDF'}
          </button>
          {msgCaminhao && <p className={msgCaminhao.tipo === 'ok' ? styles.msgOk : styles.msgErro}>{msgCaminhao.texto}</p>}
        </div>
      )}
```

(A mensagem de erro precisa aparecer aqui porque o bloco de caminhões, onde `msgCaminhao` já é
exibida hoje, só existe quando `concretagem.status === 'aberta'` — uma concretagem finalizada não
passa mais por aquele bloco, então sem essa linha um erro de geração de PDF nunca apareceria na
tela.)

- [ ] **Step 4: CSS do botão desabilitado**

Em `src/pages/ControleTecnologicoForm.module.css`, depois da regra `.btnSecundario { ... }`
(linha 49), adicionar:

```css
.btnSecundario:disabled { opacity: 0.6; cursor: default; }
```

- [ ] **Step 5: Build e teste manual**

```bash
npm run build
```

Esperado: 0 erros de TypeScript — o erro reportado no fim da Task 3 (uso de
`gerarPdfConcretagem` sem `await`) some aqui.

Testar no navegador como admin: abrir uma concretagem finalizada com pelo menos 1 caminhão
lançado (a mesma usada nos testes das tasks anteriores), clicar "🖨️ Imprimir PDF". Confirmar:
- O botão mostra "Gerando PDF…" e fica desabilitado enquanto processa.
- O PDF baixado tem 2 páginas: página 1 = a imagem/PDF que foi anexado na criação da concretagem
  (orientação da página deve acompanhar a orientação da imagem — testar com um anexo retrato e um
  paisagem se possível); página 2 = a tabela de caminhões, igual à de antes, com a numeração
  `CTC-XXX` aparecendo na mesma linha de "obra · unidade · data", sem encostar nesse texto.
- O rodapé (linha terracota + texto + "Página X de Y") aparece nas duas páginas, na posição
  correta em cada uma (perto do fim de cada página, mesmo que a página 1 seja retrato).
- Testar o caminho de erro: renomear/mover temporariamente o arquivo do anexo no bucket (ou
  simular indisponibilidade) e confirmar que a tela mostra uma mensagem de erro em vez de travar
  silenciosamente ou baixar um PDF incompleto — depois desfazer a alteração no bucket.

- [ ] **Step 6: Commit**

```bash
git add src/pages/ControleTecnologicoForm.tsx src/pages/ControleTecnologicoForm.module.css
git commit -m "feat: imprimir PDF do Controle Tecnologico vira assincrono com estado de carregamento e erro"
```
