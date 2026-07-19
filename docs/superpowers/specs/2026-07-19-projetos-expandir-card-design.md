# Modulo Projetos — expandir documento dentro do card — Spec de design

> Status: decisoes aprovadas por Rodrigo em 19/07/2026, aguardando plano de implementacao.
> **Substitui a opcao de layout aprovada em `2026-07-19-projetos-layout-pastas-design.md`
> (opcao B — superficie unica com colunas lista+detalhe), ja implementada e publicada
> (commits `77e6254`, `672f99c`) e testada por Rodrigo.** Depois de usar em producao, Rodrigo
> nao gostou do resultado visual e pediu pra tentar a opcao A, cogitada no mesmo brainstorming
> original (mockups comparados via companion visual) mas nao escolhida na primeira rodada.
> So frontend (`src/pages/Projetos.tsx` e `Projetos.module.css`) — nenhuma mudanca de banco.
> Responsavel pela implementacao: a definir com Rodrigo (mesmo padrao da rodada anterior —
> mudanca pequena, sem RLS/migracao, normalmente cabe ao Codex).

## 1. Objetivo

Trocar o layout de duas colunas (lista + painel de detalhe lado a lado) por um layout de
coluna unica onde o documento selecionado expande **dentro do proprio card da lista**, no
lugar de abrir um painel separado.

## 2. Escopo

Incluido:

- `.conteudo` vira uma lista vertical de largura unica (sem grid de duas colunas), dentro da
  mesma moldura branca (borda + sombra) ja usada hoje;
- cada card mostra sempre o cabecalho que ja existe hoje quando fechado: titulo, chip da
  pasta, "Atual: R0X • data" (ou "Sem revisao registrada"), botao "Abrir";
- clicar no cabecalho do card (fora do botao "Abrir") expande o corpo do documento *dentro*
  daquele card: descricao (se houver), Editar/Inativar (se `podeEditar`), formulario de edicao
  (se acionado), box "Revisao atual", botao "Nova revisao" + formulario (se aberto), "Historico
  de revisoes";
- **so um documento expandido por vez** — expandir outro fecha automaticamente o anterior;
- clicar em qualquer controle dentro do corpo expandido (botoes, campos de formulario) nao
  fecha o card — so clicar no cabecalho alterna expandir/fechar;
- ao escolher uma pasta (ou trocar de pasta), a lista comeca **totalmente fechada** — nenhum
  documento expande sozinho; o usuario expande o que quiser ver.

Fora de escopo (sem mudanca):

- gate por pasta e busca em titulo/descricao (`docs/superpowers/plans/2026-07-19-projetos-layout-pastas.md`,
  Task 1) — comportamento ja implementado e aceito, nao mexer;
- cadastro de novo documento, nova revisao, editar/inativar documento, gerenciar pastas — a
  logica de cada acao continua a mesma, so a moldura visual ao redor delas muda;
- qualquer mudanca de schema, RLS ou permissao.

## 3. Regras de comportamento

### 3.1 Expansao unica

- estado local (`selecionadoId`) continua guardando qual documento esta "aberto", mas deixa de
  ter um valor padrao/fallback automatico — ao entrar numa pasta nova (ou trocar de pasta), se
  o `selecionadoId` atual nao pertencer a lista filtrada, nenhum card aparece expandido;
- clicar no cabecalho de um card fechado expande ele e fecha qualquer outro que estivesse
  aberto (um so por vez);
- clicar no cabecalho de um card ja expandido fecha ele, sem abrir nenhum outro no lugar.

### 3.2 Isolamento de cliques dentro do card expandido

- o cabecalho (titulo, chip, meta, botao "Abrir") fica num elemento proprio, separado do corpo
  expandido — so o cabecalho recebe o clique de expandir/fechar;
- o corpo expandido (descricao, acoes, revisao atual, formularios, historico) fica em outro
  elemento, sem o clique de expandir/fechar propagando pra ele — digitar num campo ou clicar
  num botao dentro do corpo nao deve fechar o card.

### 3.3 O que nao muda

- gate por pasta, busca por titulo/descricao, permissoes (`podeEditar`/`cliente`/
  `semPermissao`), fluxo de cadastro/edicao/revisao/gerenciar pastas — tudo como esta hoje.

## 4. Layout (coluna unica)

- `.conteudo` deixa de ser grid de duas colunas — vira uma lista vertical (`display: flex;
  flex-direction: column`), mantendo a moldura externa unica (borda + sombra) já existente;
- cada `.card` mantem o estilo de hoje quando fechado (fundo nude, ativo com fundo branco +
  borda navy + sombra — mas "ativo" passa a significar "expandido", nao mais "selecionado no
  painel ao lado");
- o corpo expandido usa uma divisoria horizontal (`border-top`) acima dele, no lugar da
  divisoria vertical (`border-left`) que existia entre lista e detalhe na opcao anterior;
- no mobile (`@media max-width: 860px`), o comportamento ja e coluna unica por natureza — o
  layout deste design simplifica o CSS responsivo em vez de complicar (menos regras
  especificas de mobile do que a opcao B tinha).

## 5. Estados de tela

Sem mudanca em relacao ao que ja esta implementado: gate por pasta (mensagem "Selecione uma
pasta para ver os documentos."), "nenhum documento cadastrado", "nenhum documento encontrado
para os filtros" continuam identicos. A unica diferenca e que, quando ha documentos pra
mostrar, nenhum aparece expandido de cara.

## 6. Criterios de aceite

- [ ] A lista de documentos aparece numa coluna so, dentro de uma unica moldura (sem coluna
      lateral de detalhe).
- [ ] Ao escolher uma pasta, nenhum documento aparece expandido.
- [ ] Clicar no cabecalho de um card expande ele no lugar, mostrando descricao (se houver),
      Editar/Inativar, Revisao atual, Nova revisao e Historico.
- [ ] Clicar no cabecalho de outro card fecha o anterior e abre o novo — nunca dois
      expandidos ao mesmo tempo.
- [ ] Clicar no cabecalho do card ja expandido fecha ele.
- [ ] Clicar em botoes/campos dentro do corpo expandido (Editar, Inativar, Nova revisao,
      inputs de formulario) nao fecha o card.
- [ ] O botao "Abrir" no cabecalho continua abrindo o PDF sem expandir o card.
- [ ] Gate por pasta, busca em titulo/descricao e todo o resto do modulo continuam
      funcionando exatamente como antes desta mudanca.
- [ ] Rodrigo testou visualmente no navegador (desktop e mobile) e deu aceite.

## 7. Decisoes aprovadas

- layout: opcao A (expandir dentro do card), substituindo a opcao B implementada antes;
- lista comeca sempre fechada ao trocar de pasta — sem expansao automatica do primeiro
  documento;
- um documento expandido por vez;
- cliques dentro do corpo expandido nao podem fechar o card (isolamento de propagacao no
  cabecalho).
