# Exportação Excel do Financeiro (formato ENGEFER) — Spec de design

> Status: desenho aprovado por Rodrigo em conversa (08/09/2026).
>
> Origem: a planilha real da ENGEFER analisada no início desta sessão
> (`Financeiro Realizado - Residencial Azaleia.xlsx`) é o formato que o cliente da obra ENGEFER
> Sudoeste já está acostumado a receber semanalmente. Rodrigo vai passar a lançar o financeiro
> dessa obra pelo app (Fase 3a, já em produção) e precisa conseguir exportar pro mesmo formato pra
> continuar apresentando ao cliente — sem duplicar o problema estrutural da planilha original
> (~22.800 linhas copiadas manualmente mês a mês).

## 1. Objetivo

Um botão em `/financeiro` que gera um `.xlsx` com um par de abas por mês (ledger de pagamentos +
orçamento com previsto/realizado/saldo), replicando o formato que a ENGEFER já usa, a partir dos
dados reais já lançados no app — nunca um snapshot guardado, sempre recalculado na hora da
exportação.

## 2. Estado real levantado

- **Sem biblioteca de geração de Excel no projeto hoje** (`package.json` não tem `xlsx` nem
  `exceljs`). A skill `xlsx` citada no `CLAUDE.md` §4 como "instalada" não está disponível neste
  ambiente — referência desatualizada, não vale como base.
- **`lancamentos_financeiros` não tem campo de nota fiscal** — só `descricao`/`observacao` em
  texto livre. Precisa de um campo novo (`nf_numero`, decisão tomada nesta conversa).
- **`financeiro_realizado_agregado`** (RPC criada na entrega de hoje, Fase 3b) agrega por
  `(data_pagamento, etapa_id, servico_id)` e **nunca expõe fornecedor/NF** — foi desenhada de
  propósito pra alimentar telas que o `cliente` acessa (Curva S financeira). **Não serve pra este
  export**: o ledger precisa do fornecedor e da NF por lançamento, informação que essa RPC omite
  deliberadamente. A exportação roda a partir de `/financeiro`, tela já restrita a
  admin/equipe-com-módulo — pode ler `lancamentos_financeiros` direto pela mesma RLS que a tela já
  usa hoje (`supabase.from('lancamentos_financeiros').select('*')`), sem precisar de RPC nova.
- **`calcularSaldoPorEtapa`** (`src/lib/financeiro-curva.ts`, entrega de hoje) agrega só até o
  nível de etapa — a aba "MM-YY" da planilha original detalha por **serviço** dentro de cada
  etapa, granularidade mais fina do que essa função entrega hoje. A exportação precisa da própria
  lógica de agregação por serviço (reaproveitando os mesmos dados — `servicos`, `etapas`,
  `lancamentos_financeiros` — não a função pronta).
- `servicos.etapa_id` já liga todo serviço à sua etapa; `etapas.unidade_id` à unidade — dá pra
  formar a hierarquia completa (o `codigo` de `etapas`/`servicos` já existe pra ordenar como no
  orçamento original).

## 3. Campo novo — número da NF

```sql
ALTER TABLE lancamentos_financeiros ADD COLUMN nf_numero TEXT;
```

Nullable, sem invenção de dado quando vazio. Editável em `/financeiro` nos três lugares onde
`observacao` já é editável hoje (criação do lançamento avulso, baixa/pagamento, edição antes de
pagar) — mesmo padrão de campo, mesmo texto simples.

## 4. Biblioteca

**`exceljs`**, gerado no navegador (mesmo padrão client-side já usado pelo jsPDF no resto do app).
Escolhida em vez de `xlsx`/SheetJS porque a versão gratuita do SheetJS não estiliza células
(negrito, cor, formato de moeda) — `exceljs` estiliza de verdade, o que importa aqui porque o
arquivo vai direto pro cliente, não é uso só interno.

## 5. Estrutura do arquivo gerado

Um par de abas por mês, do mês do **primeiro lançamento pago da obra** até o mês atual (inclusive
meses sem nenhum lançamento — aparecem com os valores do mês zerados, saldo igual ao do mês
anterior, nunca pulados).

### Aba "RF MM-YY" (ledger do mês)

Uma linha por lançamento **pago** (`status = 'pago'`) com `data_pagamento` dentro daquele mês,
ordenado por data:

| Coluna | Origem |
|---|---|
| Data de Pagamento | `data_pagamento` |
| Nº NF | `nf_numero` (campo novo, §3) — vazio se não preenchido |
| Fornecedor | `favorecido` |
| Aplicação | nome do `servico_id` vinculado se houver; senão nome do `etapa_id`; senão "Não classificado" (mesma regra de resolução já usada em `calcularSaldoPorEtapa`) |
| Valor | `valor` |
| Total acumulado | soma de todo pagamento da obra desde o primeiro, até e incluindo esta linha |
| % Acum. | Total acumulado ÷ valor total do orçamento (`SUM(servicos.total)`) |

Sem colunas de rateio (ITEM/VALOR repetidos) como na planilha original — decisão já tomada na
entrega de hoje: uma NF que cobre vários itens já é lançada como vários lançamentos, cada um com
sua própria linha aqui.

### Aba "MM-YY" (orçamento no fim daquele mês)

Uma linha de subtotal por etapa (negrito) seguida de uma linha por serviço dentro dela, na ordem
de `etapas.ordem`/`servicos.codigo` (mesma ordem do orçamento):

| Coluna | Cálculo |
|---|---|
| Orçado | `servicos.total` (soma dos serviços, na linha da etapa) |
| Gasto no mês | soma de `lancamentos_financeiros.valor` pagos com `data_pagamento` dentro do mês, vinculados àquele item |
| Gasto acumulado | soma de todo pagamento vinculado àquele item com `data_pagamento` ≤ fim do mês |
| Saldo | Orçado − Gasto acumulado |

Cada valor tem sua % ao lado (sobre o Orçado da linha), igual ao "FINANCEIRO MENSAL/ACUMULADO/
SALDO" da planilha original. Lançamentos sem etapa/serviço vinculado somam numa linha
"Não classificado" ao final, fora da hierarquia do orçamento — nunca somados a um item que não é
o deles.

## 6. Onde fica

Botão "Exportar Excel" na tela `/financeiro` (mesma régua de acesso que a tela já tem —
admin/equipe com módulo `financeiro`; `cliente` não acessa `/financeiro` e não vê este botão,
consistente com o resto do módulo). Ao clicar, busca todos os lançamentos pagos da obra ativa (sem
paginação de UI — a mesma paginação de 1000 linhas já usada em outras telas do app cobre isso),
monta os meses e gera o arquivo pra download direto no navegador.

## 7. Fora de escopo

- Qualquer automação de envio (e-mail, WhatsApp) — o arquivo só é gerado e baixado, o envio ao
  cliente continua manual.
- Abas "Orçamento"/"Orçamento Editado" da planilha original — o app já tem o orçamento em
  `/orcamento`, não faz sentido duplicá-lo dentro do Excel exportado.
- Editar o arquivo depois de gerado (é um export, não um documento vivo).
- Qualquer mudança em `financeiro_realizado_agregado` ou nas telas que o `cliente` acessa — este
  export lê `lancamentos_financeiros` direto, sem tocar nessa RPC.

## 8. Decisões tomadas nesta conversa (08/09/2026)

1. Exportar as duas abas por mês (RF + orçamento), não só uma.
2. Reconstruir todos os meses desde o início da obra a cada exportação, não só o mês atual.
3. Adicionar campo `nf_numero` de verdade ao lançamento, em vez de deixar a coluna vazia.

## 9. Arquivos relevantes

- Migração nova: `lancamentos_financeiros.nf_numero`.
- Tela: `src/pages/Financeiro.tsx` (campo novo + botão de exportação).
- Novo: módulo de geração do Excel (mesmo espírito de `src/lib/*Pdf.ts`, mas pra `.xlsx`).
- Referência de layout: `src/lib/financeiro-curva.ts` (`calcularSaldoPorEtapa` — padrão a adaptar
  pra granularidade de serviço, não reaproveitar literalmente).
