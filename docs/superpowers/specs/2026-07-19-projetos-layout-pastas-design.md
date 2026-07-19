# Modulo Projetos — painel unico + pasta obrigatoria — Spec de design

> Status: decisoes aprovadas por Rodrigo em 19/07/2026, aguardando plano de implementacao.
> Ajuste visual/UX sobre o modulo Projetos ja entregue (`docs/fase7_projetos.md`,
> `docs/superpowers/specs/2026-07-18-projetos-design.md`, `2026-07-18-projetos-pastas-design.md`)
> — pedido do Rodrigo apos usar a tela em produção com os 26 documentos reais ja cadastrados.
> So frontend (`src/pages/Projetos.tsx` e `Projetos.module.css`) — nenhuma mudanca de banco.
> Responsavel pela implementacao: a definir com Rodrigo (mudanca pequena, sem RLS/migracao).

## 1. Objetivo

Dois ajustes na tela de Projetos:

1. A lista de documentos e o painel de detalhe (Editar/Inativar/Revisao atual/Historico) hoje
   parecem duas caixas brancas soltas lado a lado. Devem virar uma unica superficie visual.
2. Com 26 documentos reais ja cadastrados em 3 pastas, entrar em `/projetos` e ver a lista
   inteira de uma vez ficou poluido. A pasta passa a ser escolhida antes de qualquer documento
   aparecer.

## 2. Escopo

Incluido:

- unificar visualmente lista + detalhe numa so moldura (mesma borda/sombra externa, sem a
  quebra visual no meio);
- remover a opcao "Todas as pastas" do filtro — o seletor so lista pastas de verdade;
- ao entrar na tela (ou ao limpar a pasta escolhida), nenhum documento aparece ate uma pasta
  ser selecionada — mostra uma mensagem convidando a escolher uma pasta;
- excecao: o campo de busca por titulo continua funcionando sem pasta escolhida (mostra
  resultado de todas as pastas) — e passa a buscar tambem na descricao do documento, nao so
  no titulo;
- com pasta escolhida e busca preenchida ao mesmo tempo, os dois filtros continuam combinando
  (E logico), como ja acontece hoje.

Fora de escopo:

- cartoes de pasta clicaveis na tela vazia (decisao do Rodrigo: manter so o dropdown existente);
- pre-selecionar a pasta do filtro no formulario de "Novo documento";
- qualquer mudanca de schema, RLS ou regra de permissao — o modulo ja tem tudo isso resolvido;
- mudar o fluxo de nova revisao, edicao ou gerenciar pastas.

## 3. Regras de comportamento

### 3.1 Gate por pasta

- o dropdown mantem uma primeira opcao com valor vazio, so que com o rotulo trocado de "Todas
  as pastas" para algo neutro como "Selecione uma pasta" — o valor vazio passa a significar
  "nada escolhido ainda", nao "mostrar tudo junto". As demais opcoes (pastas de verdade) nao
  mudam;
- estado inicial da tela (opcao vazia selecionada e sem termo de busca): nao renderiza a lista
  nem o painel de detalhe — mostra uma mensagem tipo "Selecione uma pasta para ver os
  documentos" no lugar deles;
- assim que uma pasta real e escolhida no dropdown, a lista (e o detalhe do primeiro documento
  dela) aparece normalmente, do jeito que funciona hoje;
- voltar a opcao vazia do dropdown volta ao estado de gate, a nao ser que haja um termo de
  busca preenchido (ver 3.2).

### 3.2 Busca como atalho, mesmo sem pasta

- digitar um termo no campo de busca mostra resultados imediatamente, mesmo sem pasta
  selecionada — busca em `titulo` **e** `descricao` (case-insensitive, substring), igual ja
  funciona hoje so pra titulo;
- com pasta selecionada e busca preenchida ao mesmo tempo, o resultado e a intersecao dos dois
  filtros (como hoje).

### 3.3 O que nao muda

- cadastro de novo documento, nova revisao, editar/inativar documento, gerenciar pastas
  (renomear/inativar) seguem exatamente como estao;
- permissoes (`podeEditar`, `cliente`, `semPermissao`) nao mudam.

## 4. Layout do detalhe (unificacao visual)

- lista (esquerda) e detalhe (direita) continuam na mesma estrutura de grid de duas colunas
  (`.conteudo`), mas passam a compartilhar uma unica moldura externa (borda + sombra), em vez
  de cada lado ter a sua propria caixa branca separada;
- uma linha divisoria fina entre as duas colunas substitui o gap/sombra dupla atual;
- no mobile (`@media (max-width: 860px)`), onde as colunas ja empilham verticalmente, a
  moldura unica se adapta para continuar parecendo uma superficie so, nao duas caixas
  empilhadas.

## 5. Estados de tela

Prever:

- estado inicial / gate: nenhuma pasta escolhida, campo de busca vazio → mensagem de "escolha
  uma pasta", sem lista nem detalhe;
- pasta escolhida, mas sem nenhum documento nela → mensagem ja existente hoje ("Nenhum
  documento cadastrado" / "Nenhum documento encontrado para os filtros"), sem mudanca;
- busca preenchida sem pasta escolhida, sem nenhum resultado → mesma mensagem de "nenhum
  documento encontrado", nao a mensagem de gate;
- obra sem nenhuma pasta cadastrada ainda → o dropdown fica vazio; o gate continua valendo (a
  criacao da primeira pasta acontece pelo formulario de "Novo documento", que ja tem essa
  logica implementada).

## 6. Criterios de aceite

- [ ] Entrar em `/projetos` sem nenhuma pasta escolhida nao mostra nenhum documento — so a
      mensagem de gate.
- [ ] Escolher uma pasta no dropdown mostra os documentos so daquela pasta, no layout de
      superficie unica.
- [ ] Digitar um termo de busca sem pasta escolhida mostra resultados de todas as pastas,
      buscando em titulo e descricao.
- [ ] Pasta escolhida + busca preenchida juntas continuam combinando os dois filtros.
- [ ] "Todas as pastas" nao existe mais como opcao no dropdown.
- [ ] Lista e detalhe nao parecem mais duas caixas brancas separadas — moldura unica, com ou
      sem documento selecionado.
- [ ] Nenhuma mudanca de comportamento em cadastro/edicao/revisao/gerenciar pastas.
- [ ] Rodrigo testou visualmente no navegador (desktop e mobile) e deu aceite.

## 7. Decisoes aprovadas

- layout do detalhe: opcao B (superficie unica, sem cartoes clicaveis de pasta na tela vazia);
- pasta obrigatoria pra ver documentos, "Todas as pastas" removida do seletor;
- busca por titulo E descricao continua funcionando sem pasta escolhida, como atalho;
- escolha da pasta continua so pelo dropdown ja existente (sem cartoes novos na tela vazia).
