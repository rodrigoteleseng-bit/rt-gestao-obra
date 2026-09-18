# Fase 6 — Suprimentos: Compras

> Detalhes técnicos do módulo de Compras. Entregue em 10/07/2026, aguardando teste de campo com pedido real da obra piloto e aceite do Rodrigo — ver CLAUDE.md §0 e §7.

## O que foi entregue

- Pedido de compra com múltiplos itens, cada um vinculado (quando possível) a um serviço do orçamento via autocomplete; item sem correspondência fica marcado "a classificar".
- Data de necessidade e flag de urgência por item.
- Cotações por fornecedor, com anexo obrigatório, condição de pagamento e prazo de entrega; comparação lado a lado; vencedor definido por item (exclusivo do admin).
- Aprovação do pedido (admin) — bloqueada até todos os itens terem vencedor.
- Fluxo de status: rascunho → em_cotacao → aprovado → enviado → recebido_parcial/recebido_total (automático, via trigger) → conferido_nf → encerrado, com cancelamento (motivo obrigatório) possível em qualquer ponto antes de encerrado.
- Cadastro de fornecedores reaproveitável entre pedidos.
- Numeração sequencial por obra: obra piloto começa em 065 (64 pedidos já feitos fora do app antes da Fase 6); obras novas começam em 001.

## Refinamentos pós-entrega (10–11/07/2026, uso real pelo Rodrigo)

- Campo **Aplicação** separado do Item, com autocomplete que mostra a lista completa do orçamento ao focar; rótulo do prazo virou "Data na Obra".
- **PDF do pedido de compra** com identidade RT, nome de arquivo no padrão do Rodrigo.
- Itens do pedido **editáveis enquanto rascunho** (adicionar/remover/alterar). O pedido sai de rascunho automaticamente ao registrar a 1ª cotação (`em_cotacao`) — a partir daí os itens travam.
- **Importar CSV de cotação:** botão na tela de cotação que lê um CSV com fornecedor, condição de pagamento, prazo e preços por item. Trabalha em dupla com a skill `leitura-cotacao-fornecedor` (instalada): Rodrigo anexa o orçamento do fornecedor (PDF/foto) numa conversa, a skill extrai os dados e gera o CSV pronto para importar.
- Correções de layout: breakpoint mobile do formulário; campo Data na Obra não estoura mais o cartão no desktop (`min-width: 0` nos campos da grade de itens — input date tem largura mínima nativa grande).

## Exclusão de pedido de teste

Não existe exclusão pelo app (por desenho — rastreabilidade, §6 do CLAUDE.md; o app só oferece cancelamento com motivo). Para apagar um pedido de teste: DELETE direto no banco (itens/cotações/recebimentos caem por `ON DELETE CASCADE`), apagar anexos do Storage (bucket `cotacoes-nf`, pasta = id do pedido) e **decrementar `pedidos_compra_seq`** para devolver o número consumido.

## Fora de escopo (spec separada)

- Almoxarifado (entrada/saída de estoque, empréstimo de ferramentas).
- Conferência tripla automática cotação × recebimento no almoxarifado × NF — depende do Almoxarifado existir.
- Alertas automáticos (pedido urgente parado, prazo estourado) — Fase 7.

## Onde estão as regras de negócio

RLS e triggers em `supabase/migrations/20260710_fase6_compras.sql`. Ver `docs/superpowers/specs/2026-07-10-fase6-compras-design.md` para o desenho completo e as decisões tomadas com o Rodrigo.

## Evolução — Atendimento de pedidos (18/09/2026)

- Cada item de pedido passa a ser classificado como **Material**, **Serviço** ou **Locação**. Pedidos anteriores são preservados como Material.
- A nova tela `/atendimento` é a fila operacional de itens de pedidos enviados: Material mantém o atalho para o Almoxarifado; Serviço aceita execução parcial ou total; Locação registra a chegada e cria o vínculo com a aba Aluguéis.
- Serviço registra evento imutável com quantidade, data efetiva, observação, autor e data/hora. Erros não são sobrescritos: somente o autor ou admin pode cancelar o evento, com motivo obrigatório.
- Locação só é considerada atendida quando devolvida integralmente no controle existente de Aluguéis. Chegada, devolução parcial e encerramento permanecem com uma única fonte de verdade nessa aba.
- Novo módulo de acesso: **Atendimento de pedidos**. Deve ser marcado na tela Usuários para Almoxarife e Encarregado. Ele não concede acesso a cotações, preços, aprovação ou NF; Compras e Admin preservam esses acessos.
- A situação `recebido parcial/total` do pedido passa a considerar: entrada no Almoxarifado para materiais, execução acumulada para serviços e encerramento para locações.
- Banco: `20260918_atendimento_pedidos.sql` (enum, RLS, eventos, vínculos e triggers). [em validação técnica e pendente de aplicação no projeto Supabase]
