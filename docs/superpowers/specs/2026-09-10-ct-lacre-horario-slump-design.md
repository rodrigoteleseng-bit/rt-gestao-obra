# Controle Tecnológico — Lacre, horário só-hora e slump com tolerância · Spec de design

> Status: aprovado por Rodrigo em 10/09/2026, aguardando plano de implementação.
> Ajuste de campos no submódulo Controle Tecnológico (Fase 1, ainda não aceito — primeiro teste
> de campo do Rodrigo apontou essas 3 lacunas). Refina `docs/superpowers/specs/2026-09-09-controle-tecnologico-concreto-design.md`,
> não substitui.

## 1. Objetivo

Três ajustes no lançamento de caminhão do Controle Tecnológico, encontrados no primeiro teste de
campo real:

1. Falta o número do lacre da betoneira (controle de rastreabilidade da carga, tão obrigatório
   quanto NF e amostra).
2. Os 4 campos de horário (saída da usina, chegada na obra, início e fim da descarga) pedem data
   + hora (`datetime-local`), mas a data já foi definida no cabeçalho da concretagem — pedir de
   novo é redundante e, segundo o Rodrigo, uma concretagem nunca atravessa a meia-noite na
   prática, então não há ambiguidade em assumir a data da concretagem para todo horário lançado.
3. O slump solicitado nunca é um valor fixo — é sempre lançado com tolerância simétrica (ex.:
   "12 ± 2"). O slump medido continua um valor único (leitura real do ensaio, sem tolerância).

## 2. Modelo de dados

Migração nova em `supabase/migrations/20260910_ct_lacre_slump_tolerancia.sql`, sobre as tabelas já
existentes (`docs/superpowers/specs/2026-09-09-controle-tecnologico-concreto-design.md` §2):

```sql
ALTER TABLE ct_caminhoes ADD COLUMN numero_lacre TEXT;
ALTER TABLE ct_caminhoes ADD COLUMN slump_tolerancia_cm NUMERIC(4,1);
```

`slump_solicitado_cm` (já existente) passa a ser o valor **nominal** — não é renomeada, só ganha
a companheira `slump_tolerancia_cm`. `slump_tolerancia_cm` fica nula quando o solicitado também
está vazio; quando preenchida, é sempre um ± simétrico (nunca faixa assimétrica min/max —
confirmado com o Rodrigo). Exibição: `"{nominal} ± {tolerância} cm"` quando a tolerância estiver
preenchida e maior que zero, senão só `"{nominal} cm"`.

Nenhuma mudança nas colunas de horário (`hora_saida_usina`, `hora_chegada_obra`,
`hora_inicio_descarga`, `hora_fim_descarga`) — continuam `TIMESTAMPTZ`. Só muda como o frontend
as preenche (ver §3).

Depois de adicionar a coluna, `numero_lacre` vira `NOT NULL` com o mesmo padrão de
`nf`/`numero_amostra`:

```sql
ALTER TABLE ct_caminhoes ALTER COLUMN numero_lacre SET NOT NULL;
ALTER TABLE ct_caminhoes ADD CONSTRAINT ct_caminhoes_lacre_nao_vazio CHECK (btrim(numero_lacre) <> '');
```

Isso exige que não sobre nenhuma linha com `numero_lacre` nulo no momento da migração — ver §4.

## 3. Frontend — lançar caminhão

**Campo novo:** "Número do lacre" (texto, obrigatório), ao lado de NF/amostra no formulário e na
lista de caminhões da concretagem — mesmo tratamento de validação que NF/amostra já têm hoje
(bloqueia o lançamento com mensagem se vazio).

**Horário — hora em vez de data+hora:** os 4 inputs trocam de `type="datetime-local"` para
`type="time"`. Ao lançar o caminhão, o valor da hora é combinado com `concretagem.data` (já
carregada em memória) pra montar o `TIMESTAMPTZ`:

```ts
function horaOuNulo(valorHora: string, dataConcretagem: string): string | null {
  return valorHora ? new Date(`${dataConcretagem}T${valorHora}`).toISOString() : null
}
```

Nenhuma tela de edição de caminhão existe hoje — não há necessidade de reconstruir o valor de hora
a partir do `TIMESTAMPTZ` salvo para reabrir num `<input type="time">`; a exibição (lista e PDF)
já é sempre formatada para leitura, nunca reaberta em formulário.

**Slump:** o campo único "Slump solicitado (cm)" vira dois campos lado a lado — "Slump nominal
(cm)" e "Tolerância (± cm)" — enviando `slump_solicitado_cm` e `slump_tolerancia_cm`. "Slump
medido (cm)" não muda.

**Lista de caminhões (detalhe da concretagem):** passa a mostrar o lacre, os horários só com hora
(`HH:mm`, sem data), e o slump no formato `"{nominal} ± {tolerância} / {medido}"` (com as mesmas
regras de omissão de §2 quando tolerância for nula/zero, e `—` quando o valor não existir).

## 4. Limpeza de dados antes de aplicar a migração

`numero_lacre NOT NULL` exige que nenhuma linha existente fique nula. Hoje existem 3 caminhões em
`ct_caminhoes`, todos de teste (nenhum aceite ainda, ver `docs/superpowers/plans/2026-09-09-controle-tecnologico-fase1.md`):

- 1 sintético, criado só para simular o alerta de 30 dias no Dashboard (`TESTE ALERTA 30 DIAS`,
  concretagem própria com data retroativa) — apagar caminhão + concretagem.
- 2 reais, lançados pelo Rodrigo durante o teste de campo de hoje (COOPERMIX, NF 005.665 e
  660.444), na mesma concretagem, já **finalizada**. Como a concretagem está finalizada, a trava
  de RLS (`20260909_ct_travar_caminhao_finalizada.sql`) impede completar o lacre nesses registros
  lançando de novo — não dá pra só editar. Decisão do Rodrigo: apagar a concretagem inteira (os 2
  caminhões + o registro da concretagem) e relançar do zero depois que o ajuste estiver no ar.

Ordem de execução: apagar os 3 caminhões e as 2 concretagens envolvidas **antes** de aplicar
`ALTER COLUMN numero_lacre SET NOT NULL` — via `execute_sql` direto, fora de migração versionada
(é limpeza de dado de teste, não estrutura de schema).

## 5. PDF (`src/lib/controleTecnologicoPdf.ts`)

- Nova coluna **LACRE** na tabela-legenda de caminhões.
- Colunas de horário (SAÍDA USINA / CHEGADA OBRA / INÍCIO DESC. / FIM DESC.) passam a imprimir só
  `HH:mm` em vez de `DD/MM HH:mm` — a data já aparece uma vez no cabeçalho do PDF
  (`${obraNome} · ${unidadeNome} · ${data}`), então repetir por caminhão é redundante. Isso também
  libera a largura horizontal necessária para caber a coluna LACRE sem apertar as demais.
- Coluna **SLUMP SOL./MED.** passa a imprimir `"{nominal}±{tolerância} / {medido}"` (ex.:
  `"12±2 / 13"`), com as mesmas regras de omissão do §2.
- Larguras exatas das colunas (`colX` em `controleTecnologicoPdf.ts:66`) são redistribuídas na
  implementação para caber a coluna nova — não fixadas nesta spec, é detalhe de layout.

## 6. Fora de escopo

- Edição de caminhão já lançado (não existe hoje, este ajuste não introduz).
- Slump assimétrico (min/max independentes) — confirmado com o Rodrigo que não é necessário.
- Qualquer mudança em `ct_plantas`/ferramenta de pintura (Fase 2, continua fora desta fase).
