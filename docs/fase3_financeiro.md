# Fase 3a — Financeiro: livro de lançamentos

> Entregue em 21/07/2026. Base do módulo Financeiro: livro de lançamentos, ingestão automática de Medições e Compras, baixa, edição antes do pagamento e importação futura de histórico. Por envolver RLS nova e triggers entre módulos, passou por revisão obrigatória do Claude Code antes de teste de campo.

## O que foi entregue

- **Tabela `lancamentos_financeiros`:** lançamentos por obra, com valor, favorecido, descrição, data de competência, data de vencimento, status (`a_pagar`, `pago`, `cancelado`), origem e vínculo opcional ao orçamento.
- **Permissão financeira:** função `pode_editar_financeiro()` usando o módulo `financeiro`; cliente não acessa o módulo.
- **RLS:** leitura e escrita restritas a admin/equipe com módulo financeiro, com isolamento por obra.
- **Ingestão de Medições de empreiteiros:** medição aprovada gera lançamentos financeiros automaticamente, um por item de medição com valor positivo.
- **Ingestão de Compras:** valor informado na conferência de NF por item de pedido gera lançamento financeiro vinculado ao item de compra.
- **Tela `/financeiro`:** lista, filtros, alertas de vencimento, lançamento avulso, edição de lançamento antes de pagar e baixa.
- **Fila “a classificar”:** lançamentos sem etapa/serviço aparecem como pendentes de classificação para preservar o registro sem inventar aplicação.
- **Script de histórico:** `scripts/importar-historico-financeiro.cjs` preparado para dry-run; a aplicação real depende da planilha atualizada do Rodrigo.

## Correções pós-revisão

- **Compras -> Financeiro:** a função `financeiro_ingerir_compra_item()` foi corrigida para buscar o fornecedor vencedor por `pedidos_compra_itens.cotacao_item_vencedora_id`, não por uma coluna inexistente `cotacoes_itens.vencedor`.
- **Edição antes de pagar:** a tela ganhou ação de editar lançamento em `a_pagar`, reaproveitando o padrão do lançamento avulso. Lançamento pago continua travado pela RLS.
- **Textos/mojibake:** textos quebrados no Financeiro foram corrigidos antes de liberar teste de campo.
- **Leitura de lançamentos inativados:** a policy `lf_select` passou a permitir que quem edita Financeiro veja lançamentos inativados/cancelados quando necessário para rastreabilidade.

## Fora de escopo da Fase 3a

- Curva S financeira.
- Previsto x realizado financeiro consolidado.
- Projeção de custo final.
- Anexos financeiros próprios do módulo.
- Leitura automática de NF por XML/PDF/imagem.
- Integração com Google Drive.
- Aplicação real do importador de histórico contra produção.

## Evolução em análise — documentos fiscais

Rodrigo propôs usar as notas fiscais que já estão no Drive para anexar documentos ao Financeiro e, futuramente, extrair dados automaticamente.

Arquivos de referência atuais:

- `docs/superpowers/specs/2026-07-22-financeiro-notas-fiscais-insumo.md` — ideia inicial consolidada pelo Codex para análise.
- `docs/superpowers/specs/2026-07-22-financeiro-documentos-fiscais-design.md` — proposta técnica do Claude Code, ainda não aprovada pelo Rodrigo e sem plano de implementação.

Decisão atual: não implementar ainda. O próximo passo é Rodrigo revisar a proposta do Claude, responder as perguntas abertas e só então pedir um plano formal para o Codex implementar.

## Arquivos principais

- Banco: `supabase/migrations/20260721_fase3a_financeiro.sql`, `20260721_fase3a_financeiro_medicoes.sql`, `20260721_fase3a_financeiro_compras.sql` e correções posteriores.
- Frontend: `src/pages/Financeiro.tsx`, `src/pages/Financeiro.module.css`, `src/pages/CompraForm.tsx`.
- Tipos: `src/lib/supabase.ts`.
- Script: `scripts/importar-historico-financeiro.cjs`.

## Pendências

- Revisar e aplicar a planilha financeira atualizada do Rodrigo em dry-run antes de qualquer importação real.
- Decidir o escopo da próxima etapa: anexos financeiros básicos, XML fiscal, OCR/IA ou integração com Drive.
- Toda evolução com RLS/Storage/automação financeira exige revisão obrigatória do Claude Code antes de teste de campo.
