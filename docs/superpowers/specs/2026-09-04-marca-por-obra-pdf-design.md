# Identidade visual por obra nos PDFs · Spec de design

> Status: desenho aprovado por Rodrigo em conversa (04/09/2026), incluindo mockups visuais do
> cabeçalho testados no companheiro visual do brainstorming.
>
> Origem: Rodrigo enviou a logo da ENGEFER Engenharia e pediu para usá-la, no lugar da identidade
> RT Engenharia, em todos os PDFs gerados para a obra "ENGEFER SUDOESTE" (id
> `e13b37c5-e317-4a5b-b5b9-c3337e30680a`, já ativa em produção — não é uma obra nova).

## 1. Objetivo

Permitir que uma obra tenha logo e rodapé próprios nos PDFs do app, substituindo a identidade RT
Engenharia só para aquela obra. Aplicar isso primeiro na ENGEFER Sudoeste; construir de forma
reaproveitável para qualquer obra futura de cliente com marca própria, não como caso especial
hardcoded.

## 2. Estado real levantado — por que o desenho não é "um helper de cabeçalho único"

Investigação nos 9 geradores de PDF (`src/lib/*Pdf.ts`, todos jsPDF client-side, nenhum usa HTML-to-PDF) encontrou:

- **Nenhum módulo compartilhado hoje.** Cada arquivo redefine `NAVY`/`TERRACOTA`/`CINZA` e desenha
  seu próprio cabeçalho/rodapé, com os literais `'RT ENGENHARIA'`, `'Inteligência Aplicada'` e
  `'RT Engenharia — Rodrigo Teles Silva · CREA 1018712895 D/GO · Inteligência Aplicada'` hardcoded.
- **Três geometrias de cabeçalho diferentes, não uma:**
  1. **Faixa padrão** (`rdoPdf.ts`, `fvsPdf.ts`, `comprasPdf.ts`, `estoquePdf.ts`,
     `medicoesPdf.ts`, `producaoMedicaoPdf.ts` — 6 arquivos): banda navy de 30mm + régua terracota
     de 1.4mm, "RT ENGENHARIA" em branco à esquerda (17pt) + tagline (8.5pt), tipo de
     documento/referência à direita.
  2. **Faixa condensada** (`ganttPlanejamentoPdf.ts`, paisagem): banda navy de 16mm, uma linha só,
     `'RT ENGENHARIA - GANTT DO PLANEJAMENTO'` + nome da obra à direita, sem tagline, sem régua.
  3. **Cabeçalho por ficha** (`requisicoesPdf.ts`): não é uma banda de página inteira — é um
     cabeçalho de 22mm dentro de cada "ficha" impressa (2 por página), onde o título dominante é
     `'REQUISIÇÃO DE MATERIAL — ALMOXARIFADO'` e "RT Engenharia" aparece só como texto secundário
     (`Empresa: RT Engenharia · Obra: X`, uma linha só).
  4. **Sem cabeçalho** (`producaoPlantaPdf.ts`) — não muda, decidido fora de escopo (§7).
- **Conclusão:** tentar unificar as 3 geometrias numa função `desenharCabecalho()` única exigiria
  tantos parâmetros de posição/tamanho que a função viraria um "faz tudo" sem forma clara — e ainda
  arriscaria mudar pixel a pixel o layout que já funciona para a RT hoje, coisa que a Fase 0 nunca
  pediu para mudar. **A parte de verdade compartilhável não é o desenho, é a decisão de qual marca
  usar** — isso sim é idêntico nos 8 arquivos (`producaoPlantaPdf.ts` fica de fora) e vale a pena
  centralizar.
- `rdoPdf.ts` já tem o padrão de carregar imagem do Storage pra dentro de um PDF jsPDF
  (`blobParaDataUrl()`, linha 30, usado com `supabase.storage.from('rdo').download(...)` e
  `pdf.addImage(dataUrl, 'JPEG', ...)` para as fotos do RDO) — mesmo padrão reaproveitado aqui para
  a logo.
- `obras` (`supabase/migrations/20260707_fase0_fundacao.sql`) não tem nenhuma coluna de
  logo/identidade visual hoje; `Obra` em `src/lib/supabase.ts` também não. Nunca houve
  `ALTER TABLE obras` desde a Fase 0.
- `/dados-obra` (`src/pages/DadosObra.tsx`, admin-only) não tem upload de imagem nenhum hoje —
  só campos de texto/data/select.
- Buckets privados existentes seguem o padrão `{obra_id}/...` validado por
  `pode_acessar_obra(split_part(name,'/',1)::UUID)` (ex.: `producao-plantas`, com
  `allowed_mime_types = ARRAY['application/pdf','image/*']`, `file_size_limit = 25MB`) — mesmo
  molde reaproveitado para o bucket novo.

## 3. Preparo da imagem — decisão sobre o que o app faz e o que é feito por fora

A logo original (`WhatsApp Image 2026-09-04 at 11.48.54.jpeg`) é um desenho preto sobre fundo
quase-branco. Testado no companheiro visual: colocada direto sobre a faixa navy, a versão só com
fundo removido (preta, transparente) fica ilegível — pouquíssimo contraste preto sobre navy escuro.
Uma versão recolorida em branco (mesmo traço, cor trocada para `#ffffff`, fundo transparente) fica
perfeitamente legível na mesma faixa, sem precisar de nenhuma caixa/plaquinha branca por trás.

**Decisão:** o app não processa imagem nenhuma (não remove fundo, não recolore). A tela de upload
(§6) espera receber o arquivo **já pronto** — fundo transparente, cor legível sobre navy — preparado
por fora (por mim, com Python/Pillow, ou por qualquer ferramenta de edição de imagem). Para a
ENGEFER, o arquivo final (`engefer-logo-branca.png`, 1600×521px, fundo transparente, traço branco)
já foi gerado nesta sessão e fica pronto para ser enviado pela tela quando ela existir.

## 4. Modelo de dados

Duas colunas novas em `obras`, nullable — obra sem marca própria mantém as duas `NULL` e usa a
identidade RT padrão em todo lugar, sem nenhuma mudança de comportamento:

```sql
ALTER TABLE obras ADD COLUMN logo_url TEXT;
ALTER TABLE obras ADD COLUMN rodape_pdf TEXT;
```

- `logo_url`: caminho do objeto no bucket `obras-logos` (ex.: `e13b37c5-.../logo.png`), não uma URL
  pública — o bucket é privado.
- `rodape_pdf`: texto literal do rodapé (ex.: `"ENGEFER - Eng. Civil Rodrigo Teles - CREA
  1018712895 D/GO"`, texto exato fornecido por Rodrigo).
- Uma obra é "de marca própria" quando `logo_url IS NOT NULL`. A tela de upload (§6) sempre grava
  os dois campos juntos — nunca existe `logo_url` preenchido com `rodape_pdf` vazio.

## 5. Storage

Bucket privado novo, mesmo molde de `producao-plantas`:

```sql
INSERT INTO storage.buckets (id, name, public) VALUES ('obras-logos', 'obras-logos', false)
ON CONFLICT (id) DO NOTHING;
UPDATE storage.buckets
SET file_size_limit = 2097152, allowed_mime_types = ARRAY['image/png']
WHERE id = 'obras-logos';

CREATE POLICY obraslogos_storage_select ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'obras-logos' AND pode_acessar_obra(split_part(name,'/',1)::UUID));
CREATE POLICY obraslogos_storage_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'obras-logos' AND meu_papel() = 'admin' AND pode_acessar_obra(split_part(name,'/',1)::UUID));
```

`SELECT` é para qualquer usuário que acesse a obra (não só admin) porque quem gera o PDF é o
navegador de quem estiver logado — um `equipe` lançando um RDO também precisa baixar a logo.
`INSERT` é só admin, mesma régua de `/dados-obra` hoje. Limite de 2MB e só PNG — a logo é um
arquivo pequeno preparado à mão, não uma foto de obra.

## 6. `carregarIdentidadeObra` — o que é realmente compartilhado

Novo módulo `src/lib/pdfBranding.ts`:

```ts
export interface IdentidadeMarca {
  logoBase64: string | null   // null = sem logo, usa o texto padrão RT
  nomeMarca: string           // 'RT ENGENHARIA' por padrão; '' quando há logo
  tagline: string             // 'Inteligência Aplicada' por padrão; '' quando há logo
  rodapeTexto: string
}

export async function carregarIdentidadeObra(
  obra: { logo_url: string | null; rodape_pdf: string | null }
): Promise<IdentidadeMarca>
```

Se `obra.logo_url` é `null`, retorna a identidade padrão RT sem tocar no Storage. Se existe, baixa
o PNG (`supabase.storage.from('obras-logos').download(...)`), converte pra base64 (mesmo
`blobParaDataUrl` já usado em `rdoPdf.ts`, copiado para este módulo — não vale a pena importar de
`rdoPdf.ts` só por essa função de 6 linhas) e retorna `nomeMarca`/`tagline` vazios (a logo já tem o
nome escrito nela) e `rodapeTexto = obra.rodape_pdf`.

**Cada um dos 8 arquivos chama essa função uma vez** (recebendo o `obra` que já carregam hoje) e
usa o resultado no lugar dos literais atuais:

```ts
// no lugar do bloco de texto fixo "RT ENGENHARIA" / "Inteligência Aplicada":
if (identidade.logoBase64) {
  pdf.addImage(identidade.logoBase64, 'PNG', ML, 4, 0, 22)   // posição escolhida por arquivo
} else {
  // exatamente o código que já existe hoje, sem nenhuma mudança
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(17); pdf.setTextColor('#ffffff')
  pdf.text('RT ENGENHARIA', ML, 13)
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8.5); pdf.setTextColor('#B8D4E8')
  pdf.text('Inteligência Aplicada', ML, 18.5)
}

// no rodapé, troca só a string:
pdf.text(identidade.rodapeTexto, ML, 290)   // era o literal fixo
```

O ramo "sem logo" fica **byte a byte igual ao código atual** — zero risco de regressão visual para
qualquer obra sem marca própria (todas, hoje). O ramo "com logo" é território novo, com posição
escolhida caso a caso por arquivo (a largura `0` no `addImage` do jsPDF calcula a proporção
automaticamente a partir da altura pedida, preservando a proporção real do PNG).

## 7. Tela `/dados-obra`

Campo de upload (`<input type="file" accept="image/png">`) + campo de texto para o rodapé,
visíveis só quando editando uma obra já existente (mesma regra de "editar", não "criar" — obra nova
não tem `id` ainda para nomear o caminho no bucket). Ao selecionar um arquivo: upload para
`obras-logos/{obra.id}/logo.png` (`upsert: true`, sobrescreve se já existir), grava `logo_url` e
`rodape_pdf` em `obras` no mesmo `update()` que já existe hoje na tela.

## 8. Fora de escopo

- Remoção de fundo / recoloração de imagem automática dentro do app (§3 — decisão explícita).
- `producaoPlantaPdf.ts` ganhar cabeçalho — decidido fora de escopo antes (nunca teve, não ganha
  agora, nem para RT nem para obra de marca própria).
- Editar o texto do lado direito do cabeçalho (tipo de documento, nº, status) por obra — continua
  vindo de cada gerador como hoje; só a marca (logo/nome + tagline) e o rodapé trocam.
- Aplicar em `requisicoesPdf.ts`: como o cabeçalho ali é "por ficha" e o texto "RT Engenharia"
  aparece dentro de uma frase (`Empresa: RT Engenharia · Obra: X`), a troca por imagem exige um
  layout de ficha ligeiramente diferente do desenhado em §6 — tratar como o mesmo padrão
  (`identidade.logoBase64` ? imagem pequena : texto), adaptado à ficha, no plano de implementação.

## 9. Decisões tomadas nesta conversa (04/09/2026)

1. Rodapé da ENGEFER substitui completamente o da RT (nenhuma menção a RT/CREA-RT nos PDFs dessa
   obra) — texto exato: `"ENGEFER - Eng. Civil Rodrigo Teles - CREA 1018712895 D/GO"`.
2. Arquitetura: módulo compartilhado para a **decisão de identidade** (não para o desenho do
   cabeçalho, que continua por arquivo — ver §2).
3. `producaoPlantaPdf.ts` não ganha cabeçalho novo.
4. Layout do cabeçalho (testado visualmente): logo branca (fundo transparente) à esquerda na mesma
   faixa navy de sempre + tipo de documento/obra à direita — mesma estrutura que a RT já usa hoje,
   só troca o texto da esquerda pela imagem.
5. Solução reaproveitável (upload em `/dados-obra`), não hardcoded só para a ENGEFER.

## 10. Arquivos relevantes

- Geradores a alterar: `src/lib/rdoPdf.ts`, `fvsPdf.ts`, `comprasPdf.ts`, `estoquePdf.ts`,
  `medicoesPdf.ts`, `producaoMedicaoPdf.ts`, `ganttPlanejamentoPdf.ts`, `requisicoesPdf.ts`.
- Novo: `src/lib/pdfBranding.ts`.
- Tipos: `src/lib/supabase.ts` (`Obra`).
- Tela: `src/pages/DadosObra.tsx`.
- Migração nova: banco (§4) + Storage (§5).
- Ativo pronto para upload assim que a tela existir:
  `C:\Users\rodri.000\Desktop\engefer-logo-branca-pdf.png` (PNG, fundo transparente, traço branco,
  1600×521px — pronto para a faixa navy, sem processamento adicional).
