# Almoxarifado — imprimir estoque em PDF (design)

> Pedido do Rodrigo em 13/07/2026: um jeito de imprimir o estoque atual pra conferência física, escolhendo a categoria (material, EPI ou escritório).

## 1. Objetivo

Botão na aba Estoque do Almoxarifado que gera um PDF com a lista de materiais de uma categoria escolhida (código, nome, unidade, saldo atual), pronto pra impressão e conferência física.

## 2. Decisões (perguntas respondidas com o Rodrigo em 13/07/2026)

- **Localização:** barra de ações do topo da aba Estoque (`.topoAcoes`), ao lado de "+ Entrada de material", "− Saída avulsa" e "📋 Lançar requisição". Botão "🖨️ Imprimir estoque".
- **Seleção de categoria:** clicar no botão abre um menu pequeno suspenso com as 3 opções (Material / EPI / Escritório); escolher uma gera o PDF na hora — sem modal, sem tela própria.
- **Escopo dos materiais:** todos os materiais **ativos** da categoria escolhida, **incluindo os com saldo zero** (útil pra conferir o que falta repor). Ignora completamente o que estiver digitado na busca da tela (`busca`) — é sempre a categoria inteira.
- **Colunas do PDF:** Código, Nome, Unidade, Saldo Atual. Sem estoque mínimo, sem preço, sem alerta de "abaixo do mínimo" (isso já existe só na tela).
- **Estilo do PDF:** mesma identidade visual já usada em `src/lib/comprasPdf.ts`/`requisicoesPdf.ts` — cabeçalho navy+terracota, tabela desenhada manualmente (sem lib de tabela), rodapé com marca RT e paginação.

## 3. Fluxo de dados

- **Sem query nova.** Reaproveita os states que `AbaEstoque` já carrega: `materiais` (tabela `materiais`, já filtrada por `ativo = true` e `obra_id`) e `saldos` (`Map<material_id, saldo>` da view `estoque_saldos`).
- Ao escolher uma categoria no menu: filtra `materiais` por `categoria === escolhida`, ordena por nome, monta a lista `{ codigo, nome, und, saldo: saldos.get(id) ?? 0 }` e chama a função de geração de PDF com essa lista + nome da obra + categoria + data de emissão (hoje).
- **Nome do arquivo:** `Estoque_{Categoria}_{DD-MM-AAAA}.pdf` (ex.: `Estoque_Material_13-07-2026.pdf`).

## 4. Arquivos e componentes

- **Criar `src/lib/estoquePdf.ts`** — função `gerarPdfEstoque(dados)`, seguindo o padrão de `comprasPdf.ts`: cabeçalho navy (`RT ENGENHARIA` + "Inteligência Aplicada" + título "ESTOQUE — {CATEGORIA}" + nome da obra + data de emissão), tabela com 4 colunas desenhada linha a linha com paginação manual (`precisa(mm)`), rodapé com marca RT e "Página X de Y" (idêntico ao rodapé já usado nos outros dois arquivos).
- **Modificar `src/pages/Almoxarifado.tsx`** — dentro de `AbaEstoque`: novo estado `menuImpressaoAberto: boolean`, botão "🖨️ Imprimir estoque" na `.topoAcoes` que abre/fecha o menu, e o menu suspenso com os 3 botões de categoria que chamam `gerarPdfEstoque(...)` e fecham o menu.
- **Modificar `src/pages/Almoxarifado.module.css`** — reaproveita o padrão já existente `.autocompleteWrap`/`.sugestoes`/`.sugestao` (usado no autocomplete de material da entrada de estoque) para o menu suspenso — sem CSS novo além de talvez um wrapper `position: relative` no botão.

## 5. Fora de escopo

- Nenhuma tabela/coluna/migração nova.
- Nenhuma mudança na tela (o filtro de busca/categoria da tela continua igual, o PDF é independente dele).
- Sem exportação em Excel — só PDF, como pedido.
