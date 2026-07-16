# Fase 7 — Produção própria · Spec de design

> Status: proposta técnica baseada nas decisões de Rodrigo em 16/07/2026; aguarda aprovação
> final antes da implementação. Complementa, sem alterar, as Medições de empreiteiros.

## 1. Objetivo

Medir e pagar profissionais próprios por um regime híbrido:

- produção diária de alvenaria e reboco, em m²;
- parcela salarial proporcional para dias expressamente classificados como “dia salarial”;
- fechamento por profissional e período, com memória diária, aprovação exclusiva do admin e
  histórico imutável.

`total da medição = produção atribuída + (salário mensal vigente ÷ 30 × dias salariais)`

## 2. Decisões aprovadas [extraído]

- Alvenaria e reboco são lançamentos independentes. No reboco, cada face é uma parede própria.
- Parede: comprimento × altura, menos a soma de várias portas, janelas ou outros vãos.
- Um lançamento pode ter vários profissionais; área e valor são divididos igualmente.
- O preço por m² é informado no lançamento e congelado. Reajuste vale só para frente.
- Um dia é classificado, por profissional, como produção, salarial integral, não trabalhado ou
  ainda não classificado. Não haverá meio dia no MVP.
- Dia com produção não pode receber parcela salarial para o mesmo profissional.
- Qualquer data pode ser marcada expressamente como salarial, inclusive sábado, domingo ou
  feriado. O app não presume calendário de trabalho.
- Divisor salarial fixo de 30, independentemente do mês.
- Salários iniciais: ajudante de obras R$ 2.405,60; pedreiro R$ 4.405,60.
- Fechamento gera medição numerada e aprovada; somente admin aprova, cancela e marca como paga.
- Cliente não visualiza o módulo.

## 3. Integração com o app atual

- Reutiliza `trabalhadores` para o profissional nominal; não cria cadastro paralelo.
- Reutiliza a permissão `medicoes`: equipe autorizada prepara lançamentos e rascunhos; admin
  aprova/cancela/paga; cliente não lê.
- Reutiliza `obra → unidade`. O serviço é um enum próprio (`alvenaria`, `reboco`) porque o preço
  e a geometria pertencem ao regime de produção, não ao item contratual.
- `/medicoes` passa a ser a porta de entrada com dois regimes: **Empreiteiros** e
  **Produção própria**. As medições contratuais existentes não mudam.

## 4. Modelo de dados

### 4.1 `producao_salarios`

Histórico de salário por profissional e vigência:

```sql
id, obra_id, trabalhador_id, funcao, salario_mensal, vigente_desde,
vigente_ate, ativo, criado_por, criado_em
```

Regras: valor positivo; períodos do mesmo trabalhador não se sobrepõem; atualização não
reescreve vigência anterior. Os dois valores iniciais serão cadastrados pela interface, não
seedados para todos os trabalhadores sem identificação.

### 4.2 `producao_lancamentos`

```sql
id, obra_id, unidade_id, data_producao, servico, parede_nome,
comprimento, altura, area_bruta, area_aberturas, area_liquida,
preco_m2, valor_total, observacao, ativo, criado_por, criado_em,
editado_por, editado_em
```

Áreas e valor são derivados no banco, nunca confiados ao frontend. Precisão: medidas e áreas
`NUMERIC(14,4)`; preço e valores `NUMERIC(14,2)`. A área líquida deve ser maior que zero.

### 4.3 `producao_aberturas`

```sql
id, lancamento_id, tipo, identificacao, comprimento, altura,
area, ativo, criado_por, criado_em
```

Permite N aberturas. A soma não pode igualar ou superar a área bruta.

### 4.4 `producao_participantes`

```sql
id, lancamento_id, trabalhador_id, fracao, area_atribuida,
valor_atribuido, ativo, criado_por, criado_em
```

O usuário seleciona apenas os profissionais. Trigger recalcula `fracao = 1/N`, área e valor.
Não há percentual manual no MVP. Um profissional aparece uma vez por lançamento.

### 4.5 `producao_dias_salariais`

```sql
id, obra_id, trabalhador_id, data, salario_id, salario_mensal_snapshot,
divisor_snapshot, valor_dia, motivo, medicao_id, ativo, criado_por, criado_em
```

`UNIQUE` ativo por profissional/data. O salário aplicável é o vigente na data. Divisor
congelado em 30. O banco bloqueia dia salarial se existir produção ativa atribuída ao mesmo
profissional/data, e bloqueia produção se o dia já for salarial.

### 4.6 `producao_medicoes`

```sql
id, obra_id, trabalhador_id, numero, data_inicio, data_fim, status,
valor_producao, valor_salarial, valor_total, aprovada_por, aprovada_em,
paga_por, paga_em, cancelada_por, cancelada_em, motivo_cancelamento,
ativo, criado_por, criado_em
```

Status: `rascunho → aprovada → paga`; `rascunho → cancelada` ou `aprovada → cancelada` apenas
pelo admin, sempre com motivo. Cancelar não apaga: libera lançamentos/dias para novo fechamento
somente por uma função transacional auditável. Numeração `MP-001...` por obra.

### 4.7 Snapshots da medição

`producao_medicao_lancamentos` congela cada participação incluída: lançamento, data, serviço,
parede, área total, fração, área atribuída, preço e valor atribuído.

`producao_medicao_dias` congela data, salário mensal, divisor, valor diário e motivo.

Esses snapshots são a fonte do PDF e permanecem imutáveis depois da aprovação.

## 5. Regras críticas no banco

1. Medidas, áreas, rateios e valores são calculados por triggers/funções `SECURITY DEFINER`
   com `search_path` fixo.
2. Lançamento/aberturas/participantes incluídos em medição aprovada ou paga são imutáveis.
3. Um lançamento participante não entra em duas medições ativas do mesmo profissional.
4. Sobreposição produção × dia salarial é bloqueada em ambas as direções.
5. Aprovação é atômica: valida período, titular, itens, conflitos e valores; cria snapshots e
   muda status numa única função RPC.
6. Valores totais do cabeçalho são derivados dos snapshots e não podem ser escritos diretamente.
7. Soft delete: SELECT deve usar `ativo = true OR pode_editar_medicoes()` para permitir a
   inativação sem repetir o bug de RLS já conhecido.
8. Toda mutação confere `obra_id` e autoria; cliente não possui policy de leitura.

## 6. Telas e rotas

### `/medicoes`

Duas abas: **Empreiteiros** (lista atual) e **Produção própria**. A segunda mostra medições
`MP-...`, profissional, período, status, produção, salário e total.

### `/producao`

Abas **Lançamentos diários**, **Dias salariais**, **Salários**.

- Lançamentos: filtros por data/profissional/serviço/unidade; botão “Nova produção”.
- Dias salariais: profissional + período + calendário/lista diária; seleção explícita e motivo.
- Salários: histórico por profissional, função, valor e início da vigência.

### `/producao/nova` e `/producao/:id`

Data, unidade, serviço, parede/face, profissionais, preço/m², geometria, N aberturas, memória de
cálculo e total. Em edição, recalcula rateio integralmente.

### `/medicoes/producao/nova`

Seleciona profissional e período. Exibe conferência diária com estados produção/salarial/não
trabalhado/não classificado. Dias não classificados geram alerta, mas não entram no valor. O
usuário confirma antes de criar o rascunho.

### `/medicoes/producao/:id`

Resumo por dia e serviço, memória de paredes/rateios, dias salariais, total, aprovação, PDF,
cancelamento e registro de pagamento.

## 7. Cálculos e arredondamento

- Área bruta e aberturas: 4 casas; área líquida: 4 casas.
- Valor total do lançamento: `ROUND(area_liquida × preco_m2, 2)`.
- Rateio: cada participante recebe `1/N`; áreas com 4 casas. Valores individuais são
  distribuídos em centavos, e eventual centavo residual é atribuído deterministicamente ao
  participante de menor UUID, garantindo que a soma seja exatamente o total.
- Valor diário salarial mantém precisão interna de 6 casas (`salário ÷ 30`); parcela salarial
  da medição é arredondada em centavos após somar os dias.
- O PDF mostra a memória e explicita divisor 30.

## 8. Permissões

- Admin: tudo; aprovação, cancelamento e pagamento exclusivos.
- Equipe com `medicoes`: cria/edita/inativa lançamentos livres, dias salariais e rascunhos.
- Equipe sem `medicoes`: sem menu e sem acesso por API.
- Cliente: sem leitura e sem menu.

## 9. PDF `MP-###`

Identidade RT; obra, profissional, função, período e status; resumo diário; alvenaria/reboco;
paredes, áreas, preço e rateio; dias salariais com salário/divisor/valor; total de produção,
parcela salarial e total aprovado; autoria/aprovação/pagamento.

## 10. Fora de escopo do MVP

- Meio dia ou produção + salário no mesmo dia.
- Rateio desigual entre profissionais.
- Encargos, INSS, FGTS, descontos, adiantamentos e folha contábil.
- Integração financeira real/bancária e comprovante de pagamento.
- Outros serviços além de alvenaria e reboco.
- Apropriação automática no orçamento ou avanço físico.

## 11. Critérios de aceite

- N aberturas e cálculo conferem com cálculo manual.
- Dois ou mais profissionais recebem rateio igual e soma exata.
- Alvenaria e cada face de reboco são independentes.
- Preço e salário históricos não mudam retroativamente.
- Produção e dia salarial não coexistem por profissional/data.
- Divisor 30 é aplicado em qualquer mês.
- Aprovação congela memória e impede duplicidade.
- Cancelamento auditável libera corretamente os itens; paga não altera valores.
- RLS é validada para admin, equipe com/sem permissão e cliente.
- Funciona em celular e desktop; PDF reproduz os totais.

