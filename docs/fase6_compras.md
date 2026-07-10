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

## Fora de escopo (spec separada)

- Almoxarifado (entrada/saída de estoque, empréstimo de ferramentas).
- Conferência tripla automática cotação × recebimento no almoxarifado × NF — depende do Almoxarifado existir.
- Alertas automáticos (pedido urgente parado, prazo estourado) — Fase 7.

## Onde estão as regras de negócio

RLS e triggers em `supabase/migrations/20260710_fase6_compras.sql`. Ver `docs/superpowers/specs/2026-07-10-fase6-compras-design.md` para o desenho completo e as decisões tomadas com o Rodrigo.
