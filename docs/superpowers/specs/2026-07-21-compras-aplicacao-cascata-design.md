# Compras — cascata Unidade → Etapa → Serviço no campo "Aplicação" · Spec de design

> Status: aprovado por Rodrigo em 21/07/2026, aguardando plano de implementação.
> Escopo: só o módulo Compras (`CompraForm.tsx`). Mudança 100% de frontend — sem migração de banco.

## 1. Objetivo

Hoje, no formulário de pedido de compra (novo pedido e edição de itens em rascunho), o campo
"Aplicação" é um autocomplete de texto único que filtra os ~897 serviços do orçamento por
nome/código, numa lista plana — sem indicar a qual Sobrado/Unidade cada serviço pertence.

Rodrigo pediu para o campo virar uma seleção guiada, separada por Unidade (Sobrado 01…13,
Canteiro de Obras, Portaria, Área Comum) e, dentro dela, por Serviço e subserviço — mantendo a
possibilidade de digitar para filtrar.

## 2. Mapeamento de conceitos

A hierarquia mestre do app já é `OBRA → UNIDADE → ETAPA → SERVIÇO` (ver CLAUDE.md §4). Confirmado
com Rodrigo: "serviço" no pedido de compra = **Etapa** (Fundação, Alvenaria, Cobertura…) e
"subserviço" = **Serviço** do orçamento (o item orçável em si, ex.: "Chapisco - parede externa").
Ou seja, a cascata é:

```
Unidade  (tabela unidades, ordenada por `ordem`)
  └── Etapa   (tabela etapas, unidade_id = unidade escolhida, placeholder = false, ordenada por `ordem`)
        └── Serviço (tabela servicos, etapa_id = etapa escolhida, ativo = true, ordenado por `codigo`)
```

O valor persistido continua sendo só `servico_id` (ou `null`) no item do pedido — igual hoje. A
Unidade e a Etapa são apenas estado transitório de navegação na UI; não são gravadas separadamente
no item, porque já estão implícitas no `servico_id` escolhido.

## 3. Carregamento de dados

`CompraForm.tsx` hoje só carrega `servicos` (paginado, função `carregarTodosServicos`). Passa a
carregar também `unidades` e `etapas` (tabelas pequenas da obra ativa, sem necessidade de
paginação), replicando exatamente o padrão já usado em `Orcamento.tsx`:

```ts
supabase.from('unidades').select('id,obra_id,nome,tipo,ordem').eq('obra_id', obraId).order('ordem')
supabase.from('etapas').select('id,unidade_id,nome,codigo,ordem,placeholder')
  .in('unidade_id', uniIds).eq('placeholder', false).order('ordem')
```

`servicos` continua carregado como hoje (paginado, `ativo = true`), sem mudança na consulta.

## 4. Componente novo: cascata reutilizável

Criar `src/components/AplicacaoCascata.tsx`, um componente controlado com três campos digitáveis
em cascata (Unidade, Etapa, Serviço), cada um reaproveitando o padrão visual de autocomplete que já
existe no arquivo (`.autocompleteWrap` / `.sugestoes` / `.sugestao` do `CompraForm.module.css`,
promovido para um módulo CSS próprio do componente ou mantido compartilhado).

**Props:**
- `unidades: Unidade[]`, `etapas: Etapa[]`, `servicos: Servico[]` — já carregados pelo formulário pai.
- `servicoId: string | null` — valor atual (controlado pelo pai).
- `onSelecionar(servicoId: string | null): void` — chamado quando o usuário escolhe um Serviço final ou limpa a seleção.

**Estado interno:** `unidadeId` e `etapaId` selecionados na navegação atual, mais o texto digitado em
cada um dos três campos (para filtro) e qual campo está com a lista de sugestões aberta.

**Comportamento:**
- Se `servicoId` já vier preenchido (edição de item existente), o componente deriva `etapaId` (do
  `servico.etapa_id`) e `unidadeId` (do `etapa.unidade_id`) e pré-preenche os três campos com os
  nomes correspondentes.
- Escolher uma Unidade limpa Etapa e Serviço (inclusive chama `onSelecionar(null)`).
- Escolher uma Etapa limpa Serviço (`onSelecionar(null)`).
- Escolher um Serviço chama `onSelecionar(servico.id)`.
- Cada campo filtra sua lista de opções por texto digitado (nome ou código), igual ao autocomplete
  atual — Etapa só lista etapas da Unidade escolhida; Serviço só lista serviços da Etapa escolhida.
- Etapa e Serviço ficam desabilitados (placeholder "Selecione a Unidade primeiro" / "Selecione a
  Etapa primeiro") até o nível anterior estar escolhido.
- Sem nenhuma Unidade escolhida, os três campos aparecem vazios — nenhuma Unidade é ocultada mesmo
  que não tenha itens no momento.

## 5. Uso nos dois formulários existentes

`CompraForm.tsx` hoje duplica quase a mesma lógica em dois lugares: a lista de itens do "Novo
pedido" (`ItemNovo`, funções `sugestoesPara`/`escolherServico`) e a lista de itens editáveis do
pedido em rascunho (`ItemEditavel`, funções `sugestoesParaEdit`/`escolherServicoEdit`). Os dois
passam a usar `<AplicacaoCascata />`, eliminando essas quatro funções duplicadas e os campos
`buscaAplicacao`/`buscaAberta`/`servicoCodigo` das interfaces `ItemNovo`/`ItemEditavel` (o
componente cuida do próprio estado de busca/abertura).

O aviso "✓ {código} vinculado" / "⚠ sem vínculo — vai para 'a classificar'" continua existindo,
condicionado a `servico_id` presente ou não — igual hoje.

## 6. Casos de borda

- **Sem vínculo intencional:** deixar os três campos vazios continua válido — item vai para "a
  classificar" (regra de negócio existente, não muda).
- **Etapas placeholder:** excluídas do dropdown de Etapa (`placeholder = false`), mesmo filtro já
  aplicado em `Orcamento.tsx`.
- **RPC/banco:** nenhuma mudança — `criar_pedido_compra_com_itens` e `salvar_itens_pedido_compra`
  continuam recebendo `servico_id` (ou `null`) por item, exatamente como hoje.
- **Volume:** ~897 serviços e ~15 unidades carregam inteiros no cliente hoje (servicos já paginado);
  unidades/etapas são pequenas o bastante para não precisar paginação.
- **Layout:** a célula "Aplicação" do grid de item (`itemGrid`, 5 colunas) passa a conter os três
  campos empilhados em vez de um único input — sem mudança na grade em si; no mobile já colapsa
  para 1 coluna como hoje.

## 7. Fora de escopo

- Módulo Contratos (`ContratoForm.tsx`) tem um autocomplete de serviço parecido, mas não foi pedido
  — não mexer.
- Campo "Aplicação" de texto livre no Almoxarifado (saída avulsa/requisição) é conceitualmente
  diferente (não vinculado a serviço do orçamento) — fora de escopo.
