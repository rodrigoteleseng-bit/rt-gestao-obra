# Controle Tecnológico — Mapa embutido no PDF + numeração CTC-001 · Spec de design

> Status: aprovado por Rodrigo em 10/09/2026, aguardando plano de implementação.
> Segundo ajuste pós-teste-de-campo do submódulo Controle Tecnológico (o primeiro foi
> `docs/superpowers/specs/2026-09-10-ct-lacre-horario-slump-design.md`, já implementado e no ar).
> Refina `docs/superpowers/specs/2026-09-09-controle-tecnologico-concreto-design.md`, não substitui.

## 1. Objetivo

Dois acréscimos ao PDF gerado pelo Controle Tecnológico (`gerarPdfConcretagem`,
`src/lib/controleTecnologicoPdf.ts`), pedidos pelo Rodrigo após o primeiro teste de campo real:

1. **Embutir o mapa de concretagem no mesmo arquivo.** Hoje o anexo (`ct_concretagens.anexo_url`
   — foto ou PDF já marcado à mão, obrigatório na criação da concretagem) só é acessível
   separadamente na tela via `.download()` do bucket. O PDF final passa a ser um único arquivo de
   2 páginas: **página 1 = o mapa anexado**, **página 2 = a tabela-legenda dos caminhões** (código
   já existente).
2. **Numeração sequencial por obra.** Cada concretagem ganha um identificador `CTC-001`,
   `CTC-002`... atribuído no momento da criação (nunca recalculado), por obra — mesmo padrão já
   usado em Contratos (`CT-001`, ver `supabase/migrations/20260713_fase7_contratos.sql:26-81`).
   Aparece só no cabeçalho do PDF, não na tela do app.

## 2. Por que isso não precisa de biblioteca nova

A spec original (`2026-09-09-...design.md`, Global Constraints) adiou o mapa embutido pra "Fase 2"
justamente porque "embutir um PDF/foto arbitrário exigiria uma biblioteca de rasterização que este
app não usa em nenhum outro lugar". Isso deixou de ser verdade: o módulo Produção própria já
resolve exatamente esse problema — `src/lib/pdfParaImagem.ts` usa `pdfjs-dist` (já uma dependência
do projeto, `package.json`) pra renderizar a página 1 de um PDF anexado num `<canvas>` e exportar
como PNG, usado hoje pra converter a planta de alvenaria que o usuário sobe antes de pintar as
paredes. Esta spec reaproveita essa mesma função pro anexo do Controle Tecnológico — sem trazer
`pdf-lib` nem nenhuma outra lib de mesclagem de PDF.

## 3. Preparar o anexo como imagem (`src/lib/pdfParaImagem.ts`)

**Mudança 1 — ampliar o tipo do parâmetro existente**, de `File` para `Blob` (todo `File` já É um
`Blob`, então nenhum call site existente quebra):

```ts
export async function converterPdfParaImagem(arquivo: Blob): Promise<Blob> {
  // corpo inalterado — arquivo.arrayBuffer() já funciona em Blob
}
```

**Mudança 2 — nova função exportada**, que decide PDF vs. imagem pela extensão do nome do arquivo
e devolve um `dataUrl` pronto pro `jsPDF.addImage`, junto com as dimensões naturais (necessárias
pra decidir a orientação da página e encaixar a imagem sem distorcer):

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

export async function prepararImagemAnexo(blob: Blob, nomeArquivo: string): Promise<ImagemAnexo> {
  if (ehPdf(nomeArquivo)) {
    const pngBlob = await converterPdfParaImagem(blob)
    const dataUrl = await blobParaDataUrl(pngBlob)
    return normalizarImagemParaPng(await (await fetch(dataUrl)).blob())
  }
  return normalizarImagemParaPng(blob)
}
```

(A dupla conversão no caminho PDF — `converterPdfParaImagem` já devolve PNG, então
`normalizarImagemParaPng` roda de novo só pra extrair `width`/`height` do canvas já renderizado.
Aceitável: o anexo é sempre 1 página, conforme confirmado com o Rodrigo — custo extra é o de
recarregar uma imagem já pequena, não o de re-renderizar um PDF.)

## 4. Geração do PDF (`src/lib/controleTecnologicoPdf.ts`)

`gerarPdfConcretagem` passa a ser `async` e ganha uma página nova antes da tabela:

```ts
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
  desenharPaginaTabela(pdf, d)   // todo o conteúdo que hoje está direto em gerarPdfConcretagem

  pdf.save(`Controle Tecnologico - ${d.unidadeNome} - ${fmtData(d.concretagem.data)}.pdf`)
}
```

`desenharPaginaMapa` centra a imagem dentro de uma margem de 10mm, preservando a proporção (mesma
lógica de `larguraProporcional` em `pdfBranding.ts:52-55`, adaptada pra "encaixar dentro de uma
caixa" em vez de "altura fixa, largura proporcional"):

```ts
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
```

`desenharPaginaTabela` é o corpo atual de `gerarPdfConcretagem` (cabeçalho + tabela-legenda),
extraído para uma função própria sem nenhuma mudança de lógica — só passa a incluir a numeração
(ver §6).

**`anexo_url` sempre existe na prática**: `ct_concretagens.anexo_url` é obrigatório na criação
(Fase 1, sem a ferramenta de pintura — `planta_id` fica sempre nulo, ver CHECK
`ct_concretagem_planta_xor_anexo`), e "Imprimir PDF" só fica visível quando a concretagem está
`finalizada` (`ControleTecnologicoForm.tsx:364-368`), que por sua vez exige pelo menos 1 caminhão
lançado — ou seja, a concretagem já passou pela criação, que sempre grava `anexo_url`. Mesmo assim
o código faz a checagem explícita em runtime (em vez de assumir com um non-null assertion) — regra
geral do projeto de nunca confiar silenciosamente numa invariante externa ao TypeScript.

## 5. Erro é bloqueante, sem PDF parcial

Confirmado com o Rodrigo: se o download ou a conversão do anexo falhar por qualquer motivo, a
geração inteira falha — nenhum PDF sai (nem só com a tabela). O `imprimir()` em
`ControleTecnologicoForm.tsx` captura o erro e mostra a mensagem, sem chamar `pdf.save()`:

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

Botão "🖨️ Imprimir PDF" ganha `disabled={gerandoPdf}` e o rótulo "Gerando PDF…" enquanto roda —
a conversão do anexo deixa de ser instantânea (baixa o arquivo + renderiza num canvas), sobretudo
num PDF grande pelo celular.

## 6. Numeração `CTC-001`

Mesmo padrão de `contratos_seq`/`proximo_numero_contrato()`
(`supabase/migrations/20260713_fase7_contratos.sql:26-81`), aplicado a `ct_concretagens`:

```sql
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

CREATE POLICY ctcseq_select ON ct_concretagens_seq FOR SELECT
  USING (meu_papel() IN ('admin', 'equipe'));
ALTER TABLE ct_concretagens_seq ENABLE ROW LEVEL SECURITY;
```

`numero` é adicionada como coluna solta primeiro e só vira `NOT NULL` depois de criar o trigger —
não há linhas existentes em `ct_concretagens` hoje (confirmado: 0 registros reais no banco), então
a ordem aqui é só uma questão de estilo/segurança, não uma necessidade de limpeza como na spec
anterior. Diferente da versão de Contratos, esta função já nasce com
`SET search_path = public` (regra do projeto desde 20260719 — a versão de Contratos ficou de fora
daquela varredura e continua sem essa proteção; fora do escopo desta spec, mas vale registrar como
achado pro Rodrigo decidir separadamente se quer fechar esse gap também).

**Tipo TypeScript**: `CtConcretagem.numero: string` novo em `src/lib/supabase.ts`.

### Onde aparece no PDF

Na página da tabela (`desenharPaginaTabela`), mesma linha de `obra · unidade · data`
(`controleTecnologicoPdf.ts:68`, y=19), alinhado à esquerda, com uma folga medida via
`pdf.getTextWidth` — mesma técnica usada no ajuste de ontem para a coluna de fornecedor (ver
`docs/superpowers/plans/2026-09-10-ct-lacre-horario-slump.md`), pra garantir que nunca encosta no
texto da obra/unidade/data mesmo com nome de obra comprido:

```ts
pdf.setFont('helvetica', 'bold')
pdf.setFontSize(9)
pdf.setTextColor('#ffffff')
pdf.text(d.concretagem.numero, ML, 19)
```

(`ML = 14`, mesma margem esquerda usada em todo o resto do cabeçalho — o texto da obra continua
right-aligned em `W - MR`; como o texto do fornecedor mais longo testado ontem tinha ~62mm e a
página tem 297mm de largura, sobra espaço de sobra entre `ML` e o início do bloco direito para o
`CTC-XXX` sem risco de colisão em qualquer obra cadastrada hoje — confirmar visualmente no teste
manual desta implementação, do mesmo jeito que o bug de ontem só apareceu ao gerar o PDF de
verdade.)

Numeração **não aparece em nenhuma tela do app** (lista de concretagens, cabeçalho da concretagem
aberta) — confirmado com o Rodrigo, é só identificação do documento impresso.

## 7. Fora de escopo

- Corrigir o gap de `search_path` em `proximo_numero_contrato()` (achado incidental, não é sobre
  o Controle Tecnológico).
- Numeração aparecer em qualquer tela do app.
- Suporte a anexo em PDF de múltiplas páginas (confirmado com o Rodrigo: sempre 1 página).
- Qualquer mudança em `ct_plantas`/ferramenta de pintura (Fase 2, continua fora desta fase).
- Renumeração ou reaproveitamento de número de concretagem excluída — mesmo comportamento que
  Contratos já tem hoje (número nunca volta a ser usado).
