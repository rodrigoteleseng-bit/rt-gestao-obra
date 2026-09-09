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

## Fase 3c — Exportação Excel do Financeiro (formato ENGEFER)

> Entregue e testada em produção em 09/09/2026. Origem: a planilha real da ENGEFER (`Financeiro Realizado - Residencial Azaleia.xlsx`, analisada no início desta sessão) é o formato que o cliente da obra ENGEFER Sudoeste já está acostumado a receber semanalmente. Rodrigo vai passar a lançar o financeiro dessa obra pelo app em vez da planilha manual, mas precisa continuar apresentando ao cliente no mesmo formato. Spec: `docs/superpowers/specs/2026-09-08-exportacao-excel-financeiro-design.md`. Plano: `docs/superpowers/plans/2026-09-08-exportacao-excel-financeiro.md`. Implementado via subagent-driven-development (4 tasks + revisão final de branch inteiro).

- **Campo novo `lancamentos_financeiros.nf_numero`** (nullable, sem invenção de dado quando vazio) — editável na criação e na edição do lançamento avulso, mesmo padrão do campo `observacao` já existente.
- **Biblioteca `exceljs`**, client-side, carregada sob demanda (`import()` dinâmico no clique do botão, mesmo padrão de code-splitting já usado pelos geradores de PDF) — escolhida no lugar de `xlsx`/SheetJS porque a versão gratuita do SheetJS não estiliza célula (negrito, formato de moeda/percentual), e o arquivo vai direto pro cliente.
- **Botão "Exportar Excel" em `/financeiro`**, mesma régua de acesso da tela (admin/equipe com módulo `financeiro`; `cliente` não vê). Busca todos os lançamentos pagos da obra ativa e monta o arquivo na hora — nunca um snapshot guardado.
- **Estrutura do arquivo:** um par de abas por mês, do mês do primeiro lançamento pago da obra até o mês atual, **nunca pulando um mês vazio**. Aba "RF MM-YY": uma linha por lançamento pago daquele mês (data, Nº NF, fornecedor, aplicação, valor, total acumulado desde o início da obra, % sobre o orçamento total). Aba "MM-YY": orçamento agrupado por **unidade → etapa → serviço** (orçado/gasto no mês/gasto acumulado/saldo) — o agrupamento por unidade foi um acréscimo feito no plano além do que a spec original pedia, necessário porque `etapas.ordem` é escopado por unidade (recomeça em cada sobrado); agrupar só por etapa intercalaria etapas de unidades diferentes numa obra com várias unidades, como o Tharsos Imperial (13 sobrados).
- **Dois bugs de reconciliação entre as duas abas, encontrados só na revisão final de branch inteiro** (depois de cada task já ter sido aprovada individualmente — nenhum dos dois aparecia isolado numa única task):
  1. Lançamento vinculado a um serviço que foi inativado depois (ou com `etapa_id` órfão) sumia silenciosamente de toda soma da aba de orçamento, enquanto seguia aparecendo normalmente na aba do ledger — as duas abas discordavam entre si. Corrigido com um resolvedor `etapaAlvo()` dedicado em `src/lib/financeiroExcel.ts`, que garante que todo lançamento pago cai em exatamente um balde (serviço, etapa, ou "Não classificado"), nunca em nenhum.
  2. O denominador do "% Acum." somava serviços de **todas as obras que o usuário logado acessa**, não só a obra ativa — a RLS de `servicos` libera todas as obras pra um `admin`, e a consulta que carrega os serviços em `/financeiro` não tinha filtro de obra (o filtro real vem da hierarquia unidade→etapa→serviço, usada corretamente no resto do arquivo). Pra um admin com acesso a mais de uma obra (caso real do Rodrigo), o percentual saía sistematicamente subestimado. Corrigido escopando a soma pelas etapas da obra ativa.
- **Teste com dados reais:** 7 lançamentos de teste criados no Tharsos Imperial (única obra com orçamento completo — a ENGEFER Sudoeste ainda não tem orçamento importado no app), cobrindo Sobrado 01 e 02, 3 meses, com e sem Nº de NF, vinculado a serviço/direto na etapa/sem vínculo nenhum. Rodrigo testou pelo servidor local (`npm run dev`, mesmo Supabase de produção — não há banco de teste separado) e confirmou que o formato saiu correto. Lançamentos de teste inativados (soft delete) depois da validação.
- **Fora de escopo:** envio automático (e-mail/WhatsApp) — o arquivo só é gerado e baixado; abas "Orçamento"/"Orçamento Editado" da planilha original (o app já tem o orçamento em `/orcamento`); documento vivo/editável depois de exportado.

## Evolução em análise — documentos fiscais

Rodrigo propôs usar as notas fiscais que já estão no Drive para anexar documentos ao Financeiro e, futuramente, extrair dados automaticamente.

Arquivos de referência atuais:

- `docs/superpowers/specs/2026-07-22-financeiro-notas-fiscais-insumo.md` — ideia inicial consolidada pelo Codex para análise.
- `docs/superpowers/specs/2026-07-22-financeiro-documentos-fiscais-design.md` — proposta técnica do Claude Code, ainda não aprovada pelo Rodrigo e sem plano de implementação.

Decisão atual: não implementar ainda. O próximo passo é Rodrigo revisar a proposta do Claude, responder as perguntas abertas e só então pedir um plano formal para o Codex implementar.

## Arquivos principais

- Banco: `supabase/migrations/20260721_fase3a_financeiro.sql`, `20260721_fase3a_financeiro_medicoes.sql`, `20260721_fase3a_financeiro_compras.sql`, `20260904_financeiro_curva_s_agregado.sql`, `20260908_financeiro_nf_numero.sql` e correções posteriores.
- Frontend: `src/pages/Financeiro.tsx`, `src/pages/Financeiro.module.css`, `src/pages/CompraForm.tsx`, `src/pages/Cronograma.tsx` (aba Financeiro).
- Cálculos: `src/lib/financeiro-curva.ts`, `src/lib/cronograma.ts` (`calcularPesoFinanceiro`, `montarArvore`, `folhasComPrevisto`), `src/lib/financeiroExcel.ts` (exportação Excel, Fase 3c).
- Tipos: `src/lib/supabase.ts`.
- Script: `scripts/importar-historico-financeiro.cjs`.

## Pendências

- Revisar e aplicar a planilha financeira atualizada do Rodrigo em dry-run antes de qualquer importação real.
- Decidir o escopo da próxima etapa: anexos financeiros básicos, XML fiscal, OCR/IA ou integração com Drive.
- Toda evolução com RLS/Storage/automação financeira exige revisão obrigatória do Claude Code antes de teste de campo.
- **Fase 3b:** teste guiado em navegador (admin + usuário `cliente` temporário) na aba Financeiro de `/cronograma`, confirmando que o cliente só vê agregados. Revisão pós-commit do Claude Code antes desse teste (RLS/RPC nova + cálculo financeiro, categorias de risco de `docs/colaboracao-codex-claude.md`).
- **Fase 3b:** ampliar a cobertura do de-para cronograma↔orçamento (hoje 29,7% do orçamento) deixaria a Curva S financeira e a projeção mais precisas — trabalho de mapeamento separado, não bloqueia o uso atual.
