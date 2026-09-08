# Cabeçalho do PDF de Pedido de Compra — Spec de design

> Status: desenho aprovado por Rodrigo em conversa (08/09/2026), incluindo mockup visual testado
> no companheiro do brainstorming (3 opções mostradas, Opção B escolhida).
>
> Origem: Rodrigo enviou um formulário de cotação real da ENGEFER
> (`83 - QC - PINTURA.pdf`, obra Residencial Azaleia) com um cabeçalho em grade (logo, razão
> social/CNPJ, endereços, contato) e pediu para aplicar esse estilo no PDF de Pedido de Compra do
> app, com um subconjunto de campos: logo, nome da obra, nome do empreendimento, endereço, nome e
> e-mail do solicitante.

## 1. Objetivo

Substituir a linha única "Obra: {nome}" que o cabeçalho do Pedido de Compra tem hoje por um bloco
de identificação mais completo — obra, empreendimento, endereço e solicitante — sem transformar o
documento num formulário de cotação com colunas de preço em branco (decisão explícita: o Pedido de
Compra continua sendo o mesmo documento interno de hoje, listando itens já pedidos).

## 2. Estado real levantado

- `src/lib/comprasPdf.ts` (`gerarPdfPedido`) já foi atualizado numa entrega anterior desta mesma
  sessão para suportar logo por obra (`docs/superpowers/plans/2026-09-08-marca-por-obra-pdf.md`).
  O cabeçalho da faixa navy não muda nesta entrega — só o bloco de "identificação" logo abaixo
  (hoje: `pdf.text('Obra: ${d.obraNome}', ML, y)`, uma linha só, seguida da descrição opcional do
  pedido e da tabela de itens).
- `obras` não tem nenhum campo de "nome do empreendimento" — é um dado novo. `endereco`/`cidade`/
  `estado` já existem (usados hoje em `/dados-obra`).
- `PedidoCompra` (`src/lib/supabase.ts`) tem `criado_por: string` (FK pra `perfis_usuario`) — o
  "solicitante" é quem criou o pedido, não um campo novo a digitar; só precisa ser buscado.
  `perfis_usuario` já tem `nome`/`email`.
- RLS de `perfis_usuario` (`pode_ver_perfil`, `supabase/migrations/20260717_isolamento_usuario_obra.sql:61`)
  já permite que qualquer usuário veja o perfil de outro usuário que compartilhe uma obra com ele
  — como o solicitante necessariamente tem acesso à mesma obra do pedido, buscar seu nome/e-mail
  não esbarra em RLS para nenhum papel que já acesse o módulo Compras.
- `src/pages/CompraForm.tsx`, `baixarPdf()` (dentro do componente `DetalhePedido`) já busca
  `logo_url`/`rodape_pdf` da obra antes de gerar o PDF (via `pedido.obra_id`, não `obraAtiva` —
  achado da entrega anterior, `DetalhePedido` não tem `obraAtiva` no escopo). O mesmo ponto de
  busca é o lugar natural para também buscar `nome_empreendimento` e o perfil do solicitante.

## 3. Modelo de dados

Uma coluna nova, nullable — obra sem empreendimento cadastrado simplesmente não mostra essa linha
(nunca inventa texto vazio):

```sql
ALTER TABLE obras ADD COLUMN nome_empreendimento TEXT;
```

Editável em `/dados-obra`, mesmo formulário que já edita nome/endereço/logo/rodapé — sem tela nova.

## 4. Layout do cabeçalho (Opção B, aprovada visualmente)

Abaixo da faixa navy (que não muda), três linhas substituem o atual "Obra: {nome}":

1. **Linha em destaque** (bold, navy, ~13px): `{obra.nome}` — e, se `nome_empreendimento` estiver
   preenchido, ` — {nome_empreendimento}` (obra sem empreendimento mostra só o nome da obra).
2. **Endereço** (cinza, ~10px, uma linha abaixo): junta os campos já existentes que estiverem
   preenchidos, nesta ordem exata: `{endereco}, {cidade} - {estado}` — omitindo qualquer parte
   ausente e a pontuação que a acompanha (ex.: sem `cidade`, fica só `{endereco}` seguido de
   ` - {estado}` se houver; sem nenhum dos três campos, a linha inteira não aparece).
3. **Tira fina** (cinza claro, ~9px): `Solicitante: {nome} · E-mail: {email}`.

Sem bordas, sem tabela — texto direto, no mesmo espírito visual do resto do documento. A descrição
opcional do pedido (`d.pedido.descricao`) continua exatamente onde está hoje, logo abaixo desse
bloco, antes da tabela de itens.

## 5. Mudanças de interface

`DadosPdfPedido` (`src/lib/comprasPdf.ts`) ganha três campos:

```ts
export interface DadosPdfPedido {
  pedido: PedidoCompra
  itens: PedidoCompraItem[]
  obraNome: string
  nomeEmpreendimento: string | null
  identidade: IdentidadeMarca
  solicitanteNome: string
  solicitanteEmail: string
  servicos: Servico[]
}
```

`CompraForm.tsx`, `baixarPdf()`: a query que já busca `logo_url, rodape_pdf` de `obras` passa a
buscar também `nome_empreendimento`; uma query nova busca `nome, email` de `perfis_usuario` pelo
`pedido.criado_por`.

## 6. Fora de escopo

- Qualquer campo do formulário original da ENGEFER que não foi pedido: Razão Social/CNPJ,
  Inscrição Estadual, Endereço de Faturamento (separado do endereço da obra), Telefone — decisão
  explícita de manter o cabeçalho enxuto (ver conversa de brainstorming).
  Fica pendente para revisitação com Rodrigo se algum desses dados vier a fazer falta (essa
  entrega não fecha nenhuma porta — inserir esses campos depois é aditivo, colunas novas
  nullable, não uma mudança estrutural).
- Transformar o Pedido de Compra num formulário de cotação com colunas de preço em branco —
  decisão explícita de manter o documento como está hoje, só o cabeçalho muda.
- Qualquer mudança nos outros 7 geradores de PDF do app — esta entrega toca só
  `comprasPdf.ts`.

## 7. Decisões tomadas nesta conversa (08/09/2026)

1. Escopo: só o estilo do cabeçalho aplicado ao Pedido de Compra já existente, não um novo
   formulário de cotação com preços em branco.
2. "Nome da obra" e "nome do empreendimento" são dados diferentes — `nome_empreendimento` é um
   campo novo em `obras`.
3. Cabeçalho enxuto: sem Razão Social/CNPJ/Inscrição Estadual/Endereço de faturamento/Telefone.
4. Layout: Opção B (tira compacta sem bordas), escolhida entre 3 mockups testados visualmente.

## 8. Arquivos relevantes

- Banco: migração nova para `obras.nome_empreendimento`.
- Geração de PDF: `src/lib/comprasPdf.ts`.
- Tela de edição: `src/pages/DadosObra.tsx`.
- Ponto de chamada: `src/pages/CompraForm.tsx` (`baixarPdf()`, dentro de `DetalhePedido`).
- Tipos: `src/lib/supabase.ts` (`Obra`).
