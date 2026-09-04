# Financeiro — Curva S financeira, peso híbrido e projeção de custo final · Spec de design

> Status: **desenho aprovado por Rodrigo em conversa (04/09/2026).** Falta o plano de
> implementação formal (writing-plans) antes de qualquer entrega ao Codex.
>
> Origem: análise da planilha real `Financeiro Realizado - Residencial Azaleia.xlsx` (controle
> financeiro de outra obra da RT Engenharia, 43 meses de histórico, ~530 itens de EAP) trazida por
> Rodrigo para avaliar prós/contras e como incorporar ao app. A conclusão da análise foi que o
> ganho mais direto da planilha — Curva S financeira, previsto×realizado por item, projeção de
> custo final — já era uma pendência registrada em `docs/fase2.md` linha 92 ("De-para cronograma ↔
> orçamento + Curva S em R$ — Fase 3"), não uma ideia nova.

## 1. Objetivo

Fechar a pendência do de-para cronograma ↔ orçamento: dar à Curva S física um peso em R$ (hoje é
só duração prevista, aproximação documentada como `[estimado]`) e entregar a Curva S financeira
(previsto × realizado × projeção de custo final) que a Fase 3a deixou de fora de propósito —
usando o modelo da planilha do Azaleia como referência de requisito, mas resolvendo os dois
problemas estruturais que ela tem:

1. **Duplicação mensal do orçamento inteiro** (a planilha recopia as ~530 linhas do EAP em cada
   uma das 43 abas mensais só para anexar 3 colunas). Aqui, previsto/realizado/saldo por item
   nunca é armazenado como snapshot — é sempre calculado ao vivo a partir da fonte única
   (`servicos` + `lancamentos_financeiros`), com um parâmetro de data de corte.
2. **Rateio sem validação de soma** (um pagamento dividido em texto livre entre vários códigos de
   item, sem trava garantindo que a soma bate). Não se aplica aqui — decisão já tomada na mesma
   conversa: quando uma NF real cobre vários itens do orçamento, a solução é vários
   `lancamentos_financeiros` (um por item, como já acontece hoje via Compras/Medições) ligados ao
   mesmo documento — não dividir o valor de um lançamento único. Essa parte já está coberta pela
   spec pendente `2026-07-22-financeiro-documentos-fiscais-design.md` (fora do escopo deste
   documento).

## 2. Estado real levantado (base de toda decisão abaixo)

- **`servicos.total`** (Fase 1) é o valor orçado por item — fonte única de "quanto foi orçado".
- **`cronograma_tarefas.servico_id`** (Fase 2) já vincula **702 das 1.933 tarefas-folha** a um
  único serviço do orçamento — início do de-para, feito por `scripts/carregar-quantidades.cjs`
  (08/07/2026). Mais **195 tarefas** têm `quant_total` definida por soma de vários serviços da
  mesma unidade (ex.: armação = soma das bitolas) — **sem um `servico_id` único atribuível**, por
  isso não entram no peso em R$ desta entrega (ver §4). As **1.036 tarefas-folha restantes** não
  têm vínculo nenhum ainda (casos ambíguos documentados em `docs/fase2.md` — instalações como
  verba única por casa, estruturas combinadas no orçamento, Portaria/Área Comum/Canteiro).
- **`cronograma_previsto`** (por tarefa, por versão de baseline `vigente`) já tem início/fim —
  usado hoje para o peso por duração da Curva S física.
- **`lancamentos_financeiros`** (Fase 3a) já tem o realizado: `valor`, `status`
  (`a_pagar`/`pago`), `data_pagamento`, vínculo opcional a `etapa_id`/`servico_id`, `obra_id`,
  soft delete (`ativo`). Lançamento sem etapa/serviço cai na fila "a classificar" já existente.
- **Curva S física hoje** (`src/lib/cronograma.ts`, tela `/cronograma` aba Curva S): peso por
  tarefa = duração prevista; previsto até uma data = soma do peso das tarefas cujo intervalo
  `[início, fim]` já começou, proporcional (100% se `fim <= data`, fração linear se `data` está
  entre início e fim, 0% se não começou); realizado = mesmo cálculo usando o % de avanço físico
  lançado. Visível a todos os papéis, incluindo cliente, com cards Previsto/Realizado/Desvio,
  gráfico semanal e box "de onde vêm estes números".
- **Nenhuma tabela nova é necessária** para nada deste documento — tudo é consulta sobre dados que
  já existem.

## 3. Cobertura real — limite que precisa ficar visível na tela

Só 702 de 1.933 tarefas-folha (36% por contagem) têm valor único atribuível hoje. A cobertura em
**R$** tende a ser maior que 36% (serviços com vínculo direto tendem a ser os de escopo mais
delimitado, geralmente também os de maior valor individual — hipótese razoável, não verificada
numericamente; o plano de implementação deve calcular o número real antes de expor qualquer
percentual). De qualquer forma, a tela precisa expor esse percentual de cobertura de forma
permanente e visível (ex.: "62% do orçamento vinculado ao cronograma"), nunca escondido — regra de
rastreabilidade nº 3 do CLAUDE.md (nunca preencher com estimativa silenciosa).

## 4. Curva S física — peso híbrido R$ + duração

Substituir o peso inteiro de duração por R$ pioraria a precisão hoje, já que 64% das tarefas por
contagem não têm valor único. Proposta: dividir o orçamento total em duas fatias, sempre somando
100% do valor orçado da obra.

```
V_total  = SUM(servicos.total) de todos os serviços do orçamento da obra
V_vinc   = SUM(servicos.total) dos serviços com exatamente 1 tarefa-folha vinculada por servico_id
V_resto  = V_total - V_vinc

peso(tarefa vinculada)   = servicos.total do serviço vinculado
peso(tarefa não vinculada) = V_resto × (duração da tarefa / SUM(duração de todas as tarefas
                              não vinculadas, incluindo as 195 com quant_total por soma))
```

`V_resto` é sempre um valor real (resíduo do orçamento total, não uma estimativa por item) —
distribuí-lo por duração entre as tarefas sem vínculo é a mesma aproximação `[estimado]` já
documentada em `docs/fase2.md` §"Decisões de projeto", só que agora ancorada a um total real em
vez de pesos arbitrários. A soma dos dois pesos é sempre igual a `V_total`.

**Verificação necessária na implementação:** confirmar que nenhum `servico_id` é referenciado por
mais de uma tarefa-folha (o de-para de 08/07/2026 assume correspondência 1:1). Se existir um caso
de serviço compartilhado por duas tarefas, `V_vinc` ficaria inflado por dupla contagem — checar com
uma query de `GROUP BY servico_id HAVING COUNT(*) > 1` antes de implementar a fórmula acima.

## 5. Curva S financeira (previsto × realizado × desvio)

Mesmo layout já existente na aba Curva S de `/cronograma` (cards Previsto até hoje / Realizado /
Desvio, gráfico SVG semanal com linha de "hoje", box "de onde vêm estes números"), em R$:

- **Previsto até a data** = soma do `peso(tarefa)` (§4) de cada tarefa, ponderado pela fração
  temporal já decorrida do intervalo `[início, fim]` da tarefa — mesma lógica de proporção linear
  já usada na curva física atual.
- **Realizado até a data** = `SUM(lancamentos_financeiros.valor) WHERE status = 'pago' AND
  data_pagamento <= data AND obra_id = X AND ativo = true`.
- **Desvio** = realizado − previsto, na mesma data.

## 6. Previsto × Realizado × Saldo por item (substitui as 43 abas mensais do Azaleia)

Uma tela ou seção com a mesma árvore do Orçamento (etapa → serviço), com, por linha:

- `orçado` = `servicos.total` (agregado por etapa quando a linha é uma etapa).
- `realizado acumulado` = soma de `lancamentos_financeiros.valor` com `status = 'pago'` vinculados
  àquela etapa/serviço, até a data de corte escolhida (padrão: hoje).
- `saldo` = orçado − realizado acumulado.
- `% consumido` = realizado acumulado ÷ orçado.

Sempre calculado ao vivo — nunca existe uma "aba do mês passado" para desatualizar. Ver um mês
específico do passado é só escolher a data de corte; não há necessidade de nenhum snapshot
armazenado. Lançamentos sem etapa/serviço (fila "a classificar" da Fase 3a) aparecem separados
como "não classificado" no total geral da obra — nunca somados silenciosamente a nenhum item nem
escondidos da tela.

## 7. Projeção de custo final (ritmo de gasto)

Método por tendência, não Earned Value (EVM foi avaliado e descartado para esta entrega — ver §9,
a cobertura de 36% do de-para distorceria uma projeção por % físico × orçado).

```
ritmo_mensal        = média do realizado pago (§5) nos últimos 3 meses fechados (calendário);
                       se houver menos de 3 meses de histórico, usa os meses disponíveis;
                       se não houver nenhum mês fechado, exibir "sem dados suficientes"
                       (nunca inventar um número).
meses_restantes      = (data fim máxima de cronograma_previsto da versão vigente − hoje) em meses,
                       nunca negativo (floor em 0 se o cronograma já terminou).
custo_final_projetado = realizado_acumulado_total_obra + (ritmo_mensal × meses_restantes)
desvio_projetado     = custo_final_projetado − V_total (orçamento total da obra)
```

Rotular explicitamente na UI como "projeção por tendência de gasto" — não uma projeção técnica de
engenharia. A régua de rastreabilidade (regra 2) exige mostrar a fórmula/período usado, não só o
número final.

## 8. Visibilidade e RLS

- **Cliente vê os agregados**: Curva S financeira (§5), previsto×realizado×saldo por etapa (§6,
  sem drill-down a lançamento individual) e projeção de custo final (§7) — mesmo nível de detalhe
  que a Curva S física já mostra a todos os papéis hoje. Consistente com CLAUDE.md §2 ("cliente
  vê valores em R$ e percentuais" em Curva S).
- **Financeiro (lançamentos individuais, fornecedor, NF, status de pagamento) continua exclusivo**
  de admin/equipe com módulo `financeiro` — nenhuma mudança na RLS de `lancamentos_financeiros`
  (Fase 3a). As telas agregadas leem os mesmos dados via uma consulta/RPC que expõe só os totais
  agregados por etapa/data, nunca a linha crua do lançamento, para o papel `cliente`.
- Nenhuma tabela nova, logo nenhuma policy nova de tabela — só uma função/RPC de agregação (a
  desenhar no plano de implementação) com `SECURITY DEFINER` se necessário para o cliente ler o
  agregado sem enxergar `lancamentos_financeiros` diretamente.

## 9. Fora de escopo desta entrega

- Projeção por Earned Value (% físico executado × valor orçado) — fica para quando a cobertura do
  de-para cronograma↔orçamento crescer significativamente além dos 36% atuais.
- Qualquer mudança em `lancamentos_financeiros` ou na spec pendente de documentos fiscais/rateio
  (`2026-07-22-financeiro-documentos-fiscais-design.md`) — tratada separadamente.
- Ampliar a cobertura do de-para (vincular as 1.231 tarefas-folha restantes a um serviço) — troca
  a precisão dos cálculos acima, mas é trabalho de mapeamento manual/heurístico separado, não
  bloqueia esta entrega.
- Importação de qualquer dado da planilha do Azaleia em si — ela serviu só de referência de
  requisito, não é uma fonte de dados a importar para a obra piloto.
- Reimportação de baseline do cronograma (pendência separada, já registrada em `docs/fase2.md`).

## 10. Decisões tomadas nesta conversa (04/09/2026)

1. Rateio de pagamento entre vários itens do orçamento: resolvido por **vários lançamentos ligados
   ao mesmo documento** (não por dividir o valor de um lançamento único) — mantém o schema de
   `lancamentos_financeiros` intocado.
2. Projeção de custo final: **ritmo de gasto** (não Earned Value) para esta entrega.
3. Curva S física: **migrar para peso híbrido R$/duração já nesta entrega** (não adiar), usando o
   de-para já existente da Fase 2.
4. Cliente **vê os agregados** da Curva S financeira e do previsto×realizado×saldo por etapa, mas
   nunca lançamentos individuais.

## 11. Arquivos relevantes

- Curva S física atual: `src/lib/cronograma.ts`, `src/pages/Cronograma.tsx`.
- Orçamento: `supabase/migrations/20260707_fase1_orcamento.sql` (`servicos.total`).
- Cronograma: `supabase/migrations/20260707_fase2_cronograma.sql` (`cronograma_tarefas`,
  `cronograma_previsto`), `docs/fase2.md`.
- Financeiro: `supabase/migrations/20260721_fase3a_financeiro*.sql`, `docs/fase3_financeiro.md`,
  `src/pages/Financeiro.tsx`.
- De-para existente: `scripts/carregar-quantidades.cjs`, `scripts/depara_quantidades.csv`.
- Spec relacionada (rateio via documento, não implementada ainda):
  `docs/superpowers/specs/2026-07-22-financeiro-documentos-fiscais-design.md`.
