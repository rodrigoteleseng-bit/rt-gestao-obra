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

- Curva S financeira, previsto×realizado consolidado e projeção de custo final — entregues em 04/09/2026, ver "Fase 3b" abaixo.
- Anexos financeiros próprios do módulo.
- Leitura automática de NF por XML/PDF/imagem.
- Integração com Google Drive.
- Aplicação real do importador de histórico contra produção.

## Fase 3b — Curva S financeira, previsto×realizado por etapa e projeção de custo final

> Entregue em 04/09/2026. Fecha a pendência "De-para cronograma ↔ orçamento + Curva S em R$" registrada em `docs/fase2.md` desde a Fase 2. Origem: análise da planilha real de controle financeiro de outra obra da RT Engenharia (Residencial Azaleia), usada só como referência de requisito — nenhum dado dela foi importado. Spec: `docs/superpowers/specs/2026-09-04-fase3-curva-s-financeira-design.md`. Plano: `docs/superpowers/plans/2026-09-04-fase3-curva-s-financeira.md`. Implementado pelo Claude Code por handoff explícito do Rodrigo (fora do fluxo padrão Codex-executa/Claude-revisa).

- **Nenhuma tabela nova.** Tudo calculado ao vivo a partir de `servicos`, `cronograma_tarefas`/`cronograma_previsto` e `lancamentos_financeiros` — sem snapshot armazenado, sem risco de ficar desatualizado.
- **RPC `financeiro_realizado_agregado(p_obra_id)`** (`SECURITY DEFINER`): expõe os totais pagos de `lancamentos_financeiros` agregados por data/etapa/serviço, sem fornecedor/NF/descrição, para qualquer usuário que possa acessar a obra — inclusive `cliente`, que não tem acesso à tabela crua.
- **Peso híbrido R$/duração na Curva S física** (`src/lib/cronograma.ts`, `calcularPesoFinanceiro`): tarefas-folha com `servico_id` vinculado pesam pelo valor real do serviço; o restante do orçamento (o que ainda não tem vínculo direto) é distribuído pelas tarefas sem vínculo, proporcional à duração — mesma aproximação `[estimado]` de antes, agora ancorada a um total real. A Curva S física original (peso 100% por duração) não mudou de comportamento.
- **Cobertura do de-para na data desta entrega:** 702 das 1.933 tarefas-folha (36%) têm `servico_id` direto, cobrindo 29,7% do orçamento em R$ (R$ 3.093.003,42 de R$ 10.413.111,11) — número visível permanentemente na tela, nunca escondido.
- **Aba "Financeiro" em `/cronograma`** (visível a todos os papéis, incluindo cliente): Curva S financeira (cards Previsto/Realizado/Desvio + gráfico), previsto×realizado×saldo por etapa (linhas "Não classificado" para lançamentos sem etapa/serviço — 82% do realizado pago na data desta entrega, refletindo a fila "a classificar" da Fase 3a), e projeção de custo final por ritmo de gasto.
- **Projeção de custo final:** ritmo médio dos últimos 3 meses fechados (calendário — um mês sem nenhum lançamento pago conta como R$ 0, não é pulado) × meses restantes até o fim do cronograma vigente, somado ao realizado acumulado. Estimativa por tendência, não Earned Value (avaliado e descartado nesta entrega — a cobertura de 29,7% do de-para distorceria uma projeção por % físico × orçado).
- **Visibilidade:** cliente vê os agregados (Curva S financeira, saldo por etapa, projeção), nunca lançamento individual, fornecedor ou NF — a RPC nunca expõe essas colunas, e a tela em si nunca faz uma segunda consulta a `lancamentos_financeiros`.
- **Verificação:** todos os cálculos (cobertura, soma do realizado, resolução de etapa, ritmo mensal) foram conferidos contra os dados reais da obra piloto via SQL, impersonando o `auth.uid()` de um admin real — não só contra dados de teste. Essa verificação encontrou e corrigiu um bug antes do commit: `calcularRitmoMensal` pulava meses sem lançamento em vez de contá-los como R$ 0, inflando a projeção.
- **Pendente:** teste guiado em navegador real (admin + usuário `cliente` temporário) — não executado nesta entrega por falta de ferramenta de browser na sessão que implementou. Ver Task 6 Step 6 do plano.

## Evolução em análise — documentos fiscais

Rodrigo propôs usar as notas fiscais que já estão no Drive para anexar documentos ao Financeiro e, futuramente, extrair dados automaticamente.

Arquivos de referência atuais:

- `docs/superpowers/specs/2026-07-22-financeiro-notas-fiscais-insumo.md` — ideia inicial consolidada pelo Codex para análise.
- `docs/superpowers/specs/2026-07-22-financeiro-documentos-fiscais-design.md` — proposta técnica do Claude Code, ainda não aprovada pelo Rodrigo e sem plano de implementação.

Decisão atual: não implementar ainda. O próximo passo é Rodrigo revisar a proposta do Claude, responder as perguntas abertas e só então pedir um plano formal para o Codex implementar.

## Arquivos principais

- Banco: `supabase/migrations/20260721_fase3a_financeiro.sql`, `20260721_fase3a_financeiro_medicoes.sql`, `20260721_fase3a_financeiro_compras.sql`, `20260904_financeiro_curva_s_agregado.sql` e correções posteriores.
- Frontend: `src/pages/Financeiro.tsx`, `src/pages/Financeiro.module.css`, `src/pages/CompraForm.tsx`, `src/pages/Cronograma.tsx` (aba Financeiro).
- Cálculos: `src/lib/financeiro-curva.ts`, `src/lib/cronograma.ts` (`calcularPesoFinanceiro`, `montarArvore`, `folhasComPrevisto`).
- Tipos: `src/lib/supabase.ts`.
- Script: `scripts/importar-historico-financeiro.cjs`.

## Pendências

- Revisar e aplicar a planilha financeira atualizada do Rodrigo em dry-run antes de qualquer importação real.
- Decidir o escopo da próxima etapa: anexos financeiros básicos, XML fiscal, OCR/IA ou integração com Drive.
- Toda evolução com RLS/Storage/automação financeira exige revisão obrigatória do Claude Code antes de teste de campo.
- **Fase 3b:** teste guiado em navegador (admin + usuário `cliente` temporário) na aba Financeiro de `/cronograma`, confirmando que o cliente só vê agregados. Revisão pós-commit do Claude Code antes desse teste (RLS/RPC nova + cálculo financeiro, categorias de risco de `docs/colaboracao-codex-claude.md`).
- **Fase 3b:** ampliar a cobertura do de-para cronograma↔orçamento (hoje 29,7% do orçamento) deixaria a Curva S financeira e a projeção mais precisas — trabalho de mapeamento separado, não bloqueia o uso atual.
