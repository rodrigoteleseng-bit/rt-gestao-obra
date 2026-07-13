# Efetivo — botão Editar trabalhador (design)

> Pedido do Rodrigo em 13/07/2026: caso um dado de trabalhador seja digitado errado (nome, função, empresa, data de admissão), precisa de como corrigir sem precisar inativar e recriar.

## 1. Objetivo

Botão "Editar" ao lado de "Inativar" em cada trabalhador na aba Trabalhadores do Efetivo, abrindo o mesmo painel de "+ Novo trabalhador" pré-preenchido com os dados atuais.

## 2. Decisão (pergunta respondida com o Rodrigo em 13/07/2026)

- Reaproveita o mesmo painel `PainelNovoTrabalhador` — mesmo padrão já usado em `DadosObra.tsx` e `Definicoes.tsx` (um único formulário, alternando entre modo criar/editar via um prop/estado opcional).

## 3. Mudanças

- `PainelNovoTrabalhadorProps` ganha `trabalhador?: Trabalhador` (opcional).
- Quando `trabalhador` está presente: título vira "Editar trabalhador", os 4 campos (nome, função, empresa, data de admissão) começam pré-preenchidos com os valores do trabalhador, e `salvar()` faz `update(...).eq('id', trabalhador.id)` em vez de `insert(...)`.
- Quando `trabalhador` está ausente (uso atual do "+ Novo trabalhador"): comportamento idêntico ao de hoje, sem mudança.
- Novo botão "Editar" em `AbaTrabalhadores`, ao lado do "Inativar" existente, com a mesma gate de permissão (`podeEditar`). Abre `PainelNovoTrabalhador` passando o trabalhador clicado.
- Ao salvar uma edição com sucesso: atualiza a lista local (substitui o trabalhador editado, sem precisar recarregar tudo do banco) e fecha o painel.

## 4. Fora de escopo

- Nenhuma mudança de permissão nova — usa exatamente `podeEditar` que já existe.
- Nenhuma mudança na tabela `trabalhadores` nem na RLS — só UI e uma query `UPDATE` que já é permitida pela policy existente (`pode_editar_efetivo()`).
