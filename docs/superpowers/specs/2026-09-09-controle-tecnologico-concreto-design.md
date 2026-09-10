# Qualidade — Controle Tecnológico do Concreto Usinado · Spec de design

> Status: aprovado por Rodrigo em 09/09/2026, aguardando plano de implementação.
> Terceiro submódulo do grupo "Qualidade" no Dashboard, ao lado de Pendências e FVS.
> Explorado com o companheiro visual (mockup das 3 formas de marcar o mapa) — Rodrigo escolheu
> pintura livre com borracha.

## 1. Objetivo

Registrar cada carga (caminhão) de concreto usinado que chega na obra — dados da usina, NF,
horários, slump, número da amostra do laboratório — acompanhar o prazo de 30 dias até o laudo de
ruptura chegar, e permitir marcar visualmente num mapa da concretagem (planta pintada à mão no
app, ou foto/PDF já marcado) qual área cada caminhão cobriu, gerando um PDF final com o mapa e a
legenda de cada carga.

## 2. Modelo de dados

### `ct_plantas` (catálogo reutilizável de plantas)

```sql
CREATE TABLE ct_plantas (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  obra_id       UUID NOT NULL REFERENCES obras(id),
  nome          TEXT NOT NULL CHECK (btrim(nome) <> ''),  -- "Laje Térreo", "Laje Tipo", "Pilares Tipo"...
  reutilizavel  BOOLEAN NOT NULL DEFAULT false,  -- se true, cada uso pede em qual pavimento está sendo aplicada
  pdf_path      TEXT NOT NULL,
  imagem_path   TEXT NOT NULL,  -- PDF convertido em imagem no upload, mesmo padrão de producao_plantas
  ativo         BOOLEAN NOT NULL DEFAULT true,
  criado_por    UUID NOT NULL DEFAULT auth.uid() REFERENCES perfis_usuario(id),
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Cadastro feito uma vez (tela própria de administração das plantas, como já existe em Produção
própria) e reaproveitado em várias concretagens — **catálogo separado**, não compartilhado com o
catálogo de plantas de alvenaria (`producao_plantas`), porque geralmente são plantas diferentes
(forma/estrutural vs. alvenaria).

### `ct_concretagens` (evento — um por dia/laje/elemento concretado)

```sql
CREATE TYPE status_concretagem AS ENUM ('aberta', 'finalizada');

CREATE TABLE ct_concretagens (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  obra_id                 UUID NOT NULL REFERENCES obras(id),
  unidade_id              UUID NOT NULL REFERENCES unidades(id),
  planta_id               UUID REFERENCES ct_plantas(id),
  pavimento_identificacao TEXT,  -- só usado quando planta_id aponta pra uma planta reutilizável
  anexo_url               TEXT,  -- caminho no bucket, alternativa a planta_id (foto/PDF já marcado à mão)
  data                    DATE NOT NULL,
  status                  status_concretagem NOT NULL DEFAULT 'aberta',
  finalizada_por          UUID REFERENCES perfis_usuario(id),
  finalizada_em           TIMESTAMPTZ,
  ativo                   BOOLEAN NOT NULL DEFAULT true,
  criado_por              UUID NOT NULL DEFAULT auth.uid() REFERENCES perfis_usuario(id),
  criado_em               TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ct_concretagem_planta_xor_anexo CHECK (
    (planta_id IS NOT NULL AND anexo_url IS NULL) OR
    (planta_id IS NULL AND anexo_url IS NOT NULL)
  )
);
```

Vínculo à hierarquia vai só até **Unidade** (não até Etapa/Serviço, diferente da maioria dos
outros lançamentos do app) — decisão explícita do Rodrigo ao confirmar essa pergunta durante o
brainstorming, não uma omissão.

Ao criar, a tela pergunta: usar uma planta do catálogo (pra pintar no app) **ou** anexar uma
foto/PDF já marcado à mão — as duas opções que o Rodrigo pediu, sempre uma ou outra, nunca as
duas juntas no mesmo evento. "Finalizar" trava a lista de caminhões e a pintura (não edita mais)
e é o gatilho pra gerar o PDF — o acompanhamento do laudo de cada caminhão continua depois disso,
sem depender da concretagem estar aberta.

### `ct_caminhoes` (cada carga/caminhão dentro de uma concretagem)

```sql
CREATE TYPE status_laudo_concreto AS ENUM ('pendente', 'aprovado', 'reprovado');

CREATE TABLE ct_caminhoes (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  concretagem_id        UUID NOT NULL REFERENCES ct_concretagens(id),
  fornecedor            TEXT NOT NULL CHECK (btrim(fornecedor) <> ''),  -- usina
  nf                    TEXT NOT NULL CHECK (btrim(nf) <> ''),
  numero_amostra        TEXT NOT NULL CHECK (btrim(numero_amostra) <> ''),  -- nº dado pelo laboratório
  hora_saida_usina      TIMESTAMPTZ,
  hora_chegada_obra     TIMESTAMPTZ,
  hora_inicio_descarga  TIMESTAMPTZ,
  hora_fim_descarga     TIMESTAMPTZ,
  volume_m3             NUMERIC(8,2) NOT NULL CHECK (volume_m3 > 0),
  slump_solicitado_cm   NUMERIC(5,1),
  slump_medido_cm       NUMERIC(5,1),
  cor                   TEXT NOT NULL,  -- hex, ex '#C49A7A' — usada na pintura e na legenda do PDF
  pintura_url           TEXT,  -- camada PNG (transparente) desse caminhão, só quando a concretagem usa planta
  status_laudo          status_laudo_concreto NOT NULL DEFAULT 'pendente',
  laudo_url             TEXT,
  laudo_anexado_em      TIMESTAMPTZ,
  validado_por          UUID REFERENCES perfis_usuario(id),
  validado_em           TIMESTAMPTZ,
  pendencia_id          UUID REFERENCES pendencias(id),  -- preenchido quando reprovado gera pendência
  ativo                 BOOLEAN NOT NULL DEFAULT true,
  criado_por            UUID NOT NULL DEFAULT auth.uid() REFERENCES perfis_usuario(id),
  criado_em             TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

`pintura_url` é a camada isolada daquele caminhão (imagem PNG com fundo transparente, mesmo
tamanho da planta) — dá pra reabrir a ferramenta de pintura e corrigir só essa camada com a
borracha, sem risco de apagar a pintura de outro caminhão já lançado. Na tela, as camadas de
todos os caminhões da concretagem ficam empilhadas em cima da planta (CSS, sem processamento de
imagem no servidor); ao finalizar, tudo é achatado numa imagem só na hora de montar o PDF
(client-side, mesmo `jsPDF` já usado no resto do app).

### Storage

Bucket privado `controle-tecnologico`, caminho `{obra_id}/{concretagem_id}/...`, mesmo padrão de
isolamento por obra já usado em `rdo`/`fvs`/`pendencias`/`projetos`. Guarda: imagem das plantas
do catálogo, pintura de cada caminhão (PNG), anexo de mapa já marcado à mão (PDF/foto), e o laudo
de ruptura (PDF/foto) de cada caminhão. Aceita PDF e imagem, 25MB — mesmo limite já usado nos
buckets equivalentes.

## 3. Alerta de laudo pendente (30 dias)

Sem job/cron — mesmo padrão já usado no banner de ferramenta em atraso do Dashboard
(`Dashboard.tsx:156-189`): busca os caminhões com `status_laudo = 'pendente'` da obra ativa,
calcula em JavaScript quantos dias se passaram desde `ct_concretagens.data`, e mostra no Dashboard
os que já passaram de 30 dias. Puramente de leitura, recalculado a cada carregamento da tela.

## 4. Integração com Pendências

Quando o admin marca um caminhão como `reprovado` (depois de anexar o laudo), uma função no banco
cria automaticamente uma Pendência vinculada à `unidade_id` da concretagem, com a descrição citando
a amostra/NF/caminhão, e grava o `id` da pendência criada de volta em `ct_caminhoes.pendencia_id`
— mesmo padrão de rastreabilidade já usado quando um item de FVS reprova.

## 5. Permissões

Novo valor no enum `modulo_app`: `'controle_tecnologico'`.

- **Lançar caminhão, pintar/corrigir a pintura, finalizar concretagem, cadastrar planta**: admin,
  ou equipe com o módulo `controle_tecnologico`.
- **Anexar e validar o laudo (aprovar/reprovar)**: exclusivo do admin — trava em nível de banco
  (trigger), não só na interface, mesmo padrão de "aprovação exclusiva do admin" já usado em
  Medições e FVS.
- **Visualizar**: mesma régua de quem lança (admin/equipe com o módulo).
- **Cliente**: não acessa nada deste submódulo — mesma regra de FVS/Pendências hoje.

## 6. Interface

1. **Plantas** (tela de cadastro, dentro de Controle Tecnológico): lista + upload de novas
   plantas do catálogo, marcação de "reutilizável".
2. **Controle Tecnológico** (lista): concretagens da obra ativa, com status (aberta/finalizada),
   data, Unidade. Botão "+ Nova concretagem".
3. **Nova concretagem**: escolhe Unidade, e escolhe planta do catálogo *ou* anexa foto/PDF já
   marcado (nunca os dois). Se a planta é reutilizável, pede a identificação do pavimento.
4. **Detalhe da concretagem (aberta)**: "+ Lançar caminhão" abre o formulário completo (usina, NF,
   amostra, horários, volume, slump solicitado/medido, cor) — se a concretagem usa planta do
   catálogo, ao salvar abre a ferramenta de pintura (pincel na cor escolhida + borracha) pra
   marcar a área desse caminhão. Lista os caminhões já lançados, cada um com o status do laudo.
5. **"Finalizar concretagem"**: disponível quando não há mais caminhão a lançar — trava a lista e
   a pintura, e libera o botão de gerar o PDF (mapa achatado + legenda por caminhão: cor, NF,
   amostra, horários, slump).
6. **Acompanhamento de laudo** (por caminhão, a qualquer momento depois de lançado, mesmo com a
   concretagem já finalizada): anexa o PDF/foto do laudo, admin marca aprovado ou reprovado.

## 7. Fora de escopo (deferido)

- Controle individual de corpos de prova (7/14/28 dias) — o laboratório já cuida disso
  internamente; o app só acompanha a amostra como um todo (decisão explícita do Rodrigo).
- Mapa interativo depois de pronto (tocar numa área pintada pra ver os dados do caminhão) — o
  Rodrigo confirmou que não precisa; a legenda no PDF já resolve.
- Compartilhar o catálogo de plantas com o módulo Produção própria — catálogos deliberadamente
  separados.
- Qualquer acesso do cliente a este submódulo.

## 8. Critérios de aceite

- [ ] Funciona no celular e desktop (a ferramenta de pintura precisa funcionar por toque).
- [ ] Cadastro de planta funciona (upload de PDF vira imagem, marcação de reutilizável).
- [ ] Criar concretagem exige Unidade e (planta OU anexo), nunca os dois.
- [ ] Lançar caminhão grava todos os campos e, com planta, abre a ferramenta de pintura
      (pincel + borracha) na cor escolhida.
- [ ] Corrigir a pintura de um caminhão não afeta a pintura de outro já lançado.
- [ ] Finalizar concretagem trava edição e gera o PDF com mapa achatado + legenda.
- [ ] Aos 30 dias sem laudo, o caminhão aparece no alerta do Dashboard.
- [ ] Reprovar um laudo cria a Pendência automaticamente, vinculada à Unidade certa.
- [ ] Equipe sem o módulo `controle_tecnologico` e o papel `cliente` não veem nada deste submódulo.
- [ ] Equipe com o módulo lança caminhão e pinta, mas não vê botão de aprovar/reprovar laudo.
