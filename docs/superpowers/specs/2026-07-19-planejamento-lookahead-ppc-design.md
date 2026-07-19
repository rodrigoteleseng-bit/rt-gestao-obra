# Módulo Planejamento (Lookahead + PPC) — Spec de design

> Status: decisões aprovadas por Rodrigo em 19/07/2026, aguardando plano de implementação.
> Substitui o conceito anterior registrado em memória (inspirado no FlowPlanner) — este design
> foi refeito do zero a partir do problema real do Rodrigo: saber toda semana o que está
> travando um serviço antes que ele atrase.
> Novo módulo (Fase 7, item aprovado mas não construído). Toca RLS nova, trigger novo e uma
> máquina de estado de aprovação (fechar semana) — categorias de revisão obrigatória do
> Claude Code por `docs/colaboracao-codex-claude.md`. Esta spec já cobre a arquitetura
> (Etapa 3); revisão prévia antes da implementação está embutida neste documento.

## 1. Objetivo

Dar visibilidade, em três horizontes de tempo, sobre o que pode atrasar o cronograma —
**antes** de atrasar:

- **Mensal (lookahead):** lista de restrições (o que falta resolver) nas tarefas com data
  prevista chegando, organizadas por categoria e prazo.
- **Semanal (compromisso + PPC):** só tarefas sem restrição aberta entram no compromisso da
  semana, com meta de % de avanço; no fim da semana, mede quanto foi cumprido de fato.
- **Trimestral (marcos macro):** visão agregada das etapas do Cronograma, sem cadastro novo.

Tudo em cima do Cronograma (Fase 2) já existente — nenhuma tarefa nova é criada por este
módulo; ele referencia `cronograma_tarefas` diretamente, então mudanças no cronograma
(remanejamento de data, etc.) refletem automaticamente aqui.

## 2. Escopo

Incluído:

- cadastro de restrições vinculadas a uma tarefa do cronograma, com categoria fixa,
  responsável, prazo e status aberta/resolvida;
- regra dura (banco, não só UI): tarefa com restrição aberta não pode entrar no compromisso
  semanal;
- montagem do compromisso semanal: escolher tarefas elegíveis (sem restrição aberta) e definir
  meta de % de avanço para a semana;
- fechamento da semana (exclusivo do admin): puxa o % real já lançado em Avanço Físico pra
  cada tarefa comprometida, decide cumprida/não cumprida, exige motivo (mesma categoria das
  restrições) pras não cumpridas, calcula e trava o PPC da semana como histórico imutável;
- visão trimestral: agregação read-only das etapas do cronograma (data prevista de término,
  % médio de avanço), sem tabela nova;
- módulo fora do que o cliente vê (mesmo grupo de Contratos/Medições).

Fora de escopo:

- criar ou editar tarefas do cronograma a partir deste módulo (isso continua só no Cronograma,
  Fase 2);
- vínculo automático com Financeiro (Fase 3 não existe ainda);
- alertas automáticos de restrição vencendo (isso é o módulo Alertas, separado, ainda não
  construído — pode vir a consumir dados deste módulo no futuro, mas não faz parte deste
  escopo);
- edição de uma semana já fechada — histórico imutável, sem exceção pra admin (mesmo padrão já
  usado em Medições/Contratos).

## 3. Regras de negócio

### 3.1 Restrição

- toda restrição vincula obrigatoriamente a uma tarefa ativa de `cronograma_tarefas` da obra;
- uma tarefa pode ter várias restrições abertas ao mesmo tempo (ex.: falta material **e** falta
  mão de obra);
- categoria é obrigatória, de uma lista fixa: **Material, Mão de obra, Projeto/documentação,
  Decisão pendente, Equipamento, Financeiro, Serviço predecessor, Clima**;
- responsável é opcional (nem toda restrição tem um dono claro no momento do cadastro — mesmo
  padrão de Tarefas);
- prazo (data em que precisa estar resolvida) é obrigatório;
- resolver uma restrição (aberta → resolvida) grava quem resolveu e quando; **não pode ser
  reaberta** — se a mesma trava voltar a existir, cadastra-se uma restrição nova;
- criar e resolver restrição: admin ou equipe com o módulo `planejamento`.

### 3.2 Elegibilidade pro compromisso semanal

- uma tarefa só pode ser adicionada a um compromisso semanal se **não tiver nenhuma restrição
  com status aberta** — verificado no banco (trigger), não só na tela;
- tentar comprometer uma tarefa com restrição aberta falha com mensagem clara, não silenciosa.

### 3.3 Compromisso semanal

- toda semana (`planejamento_semanas`) pertence a uma obra, com data de início e fim;
- ao adicionar uma tarefa ao compromisso da semana, o sistema grava o % de avanço físico da
  tarefa **naquele momento** (ponto de partida) e o usuário define a **meta de % pro fim da
  semana** (deve ser maior que o ponto de partida e no máximo 100);
- uma tarefa pode ter no máximo um compromisso ativo por semana (não faz sentido comprometer a
  mesma tarefa duas vezes na mesma semana);
- criar/editar compromissos da semana (enquanto ela estiver aberta): admin ou equipe com o
  módulo `planejamento`.

### 3.4 Fechamento da semana (PPC)

- fechar a semana é **exclusivo do admin**;
- ao fechar, pra cada compromisso da semana: o sistema busca o % de avanço físico mais recente
  lançado pra aquela tarefa até a data de fim da semana e grava como "% real"; compara com a
  meta — bateu ou passou = **cumprida**, ficou abaixo = **não cumprida**;
- toda tarefa não cumprida exige categoria do motivo (mesma lista das restrições) antes da
  semana poder ser fechada — o banco bloqueia o fechamento se sobrar algum compromisso não
  cumprido sem motivo;
- PPC da semana = (compromissos cumpridos ÷ total de compromissos da semana) × 100, calculado e
  gravado no momento do fechamento;
- semana fechada é histórico imutável — nenhum campo de um compromisso já fechado pode ser
  alterado depois, sem exceção pra admin (mesmo padrão de Medições/Contratos).

### 3.5 Visão trimestral

- sem tabela nova: agrega `etapas` + `cronograma_previsto` (da versão vigente do cronograma,
  `cronograma_versoes.vigente = true`) + o % de avanço físico mais recente de cada tarefa,
  mostrando data prevista de término por etapa e o andamento médio dela;
- é só leitura — não existe ação de escrita nesta visão.

## 4. Modelo de dados proposto

### 4.1 Novos valores de enum

```sql
ALTER TYPE modulo_app ADD VALUE 'planejamento';

CREATE TYPE categoria_restricao AS ENUM (
  'material', 'mao_de_obra', 'projeto_documentacao', 'decisao_pendente',
  'equipamento', 'financeiro', 'servico_predecessor', 'clima'
);

CREATE TYPE status_restricao AS ENUM ('aberta', 'resolvida');
CREATE TYPE status_semana_planejamento AS ENUM ('aberta', 'fechada');
```

### 4.2 `restricoes`

```sql
CREATE TABLE restricoes (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  obra_id        UUID NOT NULL REFERENCES obras(id) ON DELETE CASCADE,
  tarefa_id      UUID NOT NULL REFERENCES cronograma_tarefas(id),
  categoria      categoria_restricao NOT NULL,
  responsavel_id UUID REFERENCES perfis_usuario(id),
  prazo          DATE NOT NULL,
  status         status_restricao NOT NULL DEFAULT 'aberta',
  observacao     TEXT,
  resolvida_por  UUID REFERENCES perfis_usuario(id),
  resolvida_em   TIMESTAMPTZ,
  ativo          BOOLEAN NOT NULL DEFAULT true,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now(),
  criado_por     UUID NOT NULL DEFAULT auth.uid() REFERENCES perfis_usuario(id)
);
```

### 4.3 `planejamento_semanas`

```sql
CREATE TABLE planejamento_semanas (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  obra_id      UUID NOT NULL REFERENCES obras(id) ON DELETE CASCADE,
  data_inicio  DATE NOT NULL,
  data_fim     DATE NOT NULL,
  status       status_semana_planejamento NOT NULL DEFAULT 'aberta',
  ppc          NUMERIC(5,2),
  fechada_por  UUID REFERENCES perfis_usuario(id),
  fechada_em   TIMESTAMPTZ,
  ativo        BOOLEAN NOT NULL DEFAULT true,
  criado_em    TIMESTAMPTZ NOT NULL DEFAULT now(),
  criado_por   UUID NOT NULL DEFAULT auth.uid() REFERENCES perfis_usuario(id),
  CONSTRAINT planejamento_semanas_datas_validas CHECK (data_fim > data_inicio)
);

CREATE UNIQUE INDEX idx_planejamento_semanas_unica
  ON planejamento_semanas(obra_id, data_inicio) WHERE ativo;
```

### 4.4 `planejamento_compromissos`

```sql
CREATE TABLE planejamento_compromissos (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  semana_id          UUID NOT NULL REFERENCES planejamento_semanas(id) ON DELETE CASCADE,
  tarefa_id          UUID NOT NULL REFERENCES cronograma_tarefas(id),
  percentual_inicio  NUMERIC(5,2) NOT NULL,
  meta_percentual    NUMERIC(5,2) NOT NULL,
  percentual_fim     NUMERIC(5,2),
  cumprido           BOOLEAN,
  motivo_categoria   categoria_restricao,
  motivo_observacao  TEXT,
  ativo              BOOLEAN NOT NULL DEFAULT true,
  criado_em          TIMESTAMPTZ NOT NULL DEFAULT now(),
  criado_por         UUID NOT NULL DEFAULT auth.uid() REFERENCES perfis_usuario(id),
  CONSTRAINT planejamento_compromissos_meta_valida
    CHECK (meta_percentual > percentual_inicio AND meta_percentual <= 100)
);

CREATE UNIQUE INDEX idx_planejamento_compromissos_unico
  ON planejamento_compromissos(semana_id, tarefa_id) WHERE ativo;
```

### 4.5 Triggers e travas

- **`bloquear_tarefa_com_restricao_aberta()`** — trigger `BEFORE INSERT` em
  `planejamento_compromissos`: se existir alguma `restricoes` com `tarefa_id` igual e
  `status = 'aberta'` (e `ativo`), `RAISE EXCEPTION`. Implementa a regra 3.2.
- **`travar_compromisso_fechado()`** — trigger `BEFORE UPDATE` em `planejamento_compromissos`:
  se a semana (`semana_id`) já estiver `fechada`, bloqueia qualquer `UPDATE` nesse compromisso,
  sem exceção pra admin. Implementa a imutabilidade da regra 3.4.
- **`fechar_semana_planejamento(p_semana UUID)`** — função `SECURITY DEFINER`, chamada só por
  quem tem `meu_papel() = 'admin'` (senão `RAISE EXCEPTION`): pra cada compromisso ativo da
  semana, busca o `percentual` mais recente em `avancos_fisicos` pra aquela `tarefa_id` com
  `data_referencia <= data_fim` da semana; grava em `percentual_fim`; define `cumprido =
  percentual_fim >= meta_percentual`. Se sobrar algum compromisso com `cumprido = false` e
  `motivo_categoria IS NULL`, a função **não fecha a semana** e retorna erro listando quais
  tarefas ainda precisam de motivo (fluxo de duas etapas: primeiro calcula e mostra o que falta
  motivo, depois o usuário preenche e chama de novo pra confirmar). Quando tudo estiver
  completo, grava `ppc`, `status = 'fechada'`, `fechada_por`, `fechada_em`.

## 5. Permissões e RLS

- `restricoes`, `planejamento_semanas`, `planejamento_compromissos`: isolamento por obra com
  policy `AS RESTRICTIVE` desde a migração que cria as tabelas (mesmo padrão do resto do app);
  policy de SELECT com a cláusula de soft delete já estabelecida (`ativo = true OR
  pode_editar_planejamento()`);
- nova função `pode_editar_planejamento()` — `admin` ou (`equipe` e `'planejamento' = ANY
  (meus_modulos())`), mesmo padrão de todas as outras `pode_editar_X()`;
- INSERT/UPDATE em `restricoes` e em `planejamento_compromissos` (enquanto a semana estiver
  aberta): `pode_editar_planejamento()`;
- fechar a semana (`UPDATE` de `status` em `planejamento_semanas` pra `'fechada'`, ou a RPC
  `fechar_semana_planejamento`): só `meu_papel() = 'admin'`;
- cliente: sem nenhuma policy de SELECT — módulo inteiro fora do que ele vê, mesmo grupo de
  Contratos/Medições.

## 6. Telas e fluxo

### 6.1 Mensal (lookahead)

- lista de restrições da obra, com filtro por categoria e por status (aberta/resolvida);
- cada linha mostra a tarefa vinculada (nome, etapa, unidade, data prevista do cronograma),
  categoria, responsável, prazo;
- cadastrar restrição: escolher a tarefa (busca no cronograma), categoria, responsável
  (opcional), prazo, observação;
- resolver restrição: um clique, grava resolvida_por/resolvida_em.

### 6.2 Semanal (compromisso + PPC)

- escolher/criar a semana (data início);
- adicionar tarefa ao compromisso: busca só entre tarefas **sem restrição aberta** (a busca já
  filtra; tentar via API direta ainda é bloqueado pelo trigger); mostra o % atual de avanço
  físico como ponto de partida; usuário define a meta;
- enquanto a semana está aberta: pode adicionar/remover compromissos livremente;
- "Calcular fechamento": preview de quais tarefas bateriam a meta hoje (sem travar nada) —
  ajuda a decidir se ainda dá tempo de agir antes do fim da semana;
- fechar semana (admin): dispara `fechar_semana_planejamento`; se faltar motivo em alguma não
  cumprida, mostra quais faltam preencher; depois de completo, mostra o PPC final e trava a
  semana.

### 6.3 Trimestral (marcos)

- lista de etapas da obra com data prevista de término (da versão vigente do cronograma) e %
  médio de avanço das tarefas dela — só leitura, sem formulário.

## 7. Estados de tela

Prever:

- nenhuma restrição cadastrada ainda (obra nova no módulo);
- tentativa de comprometer tarefa com restrição aberta — mensagem clara explicando qual
  restrição está travando;
- semana sem nenhum compromisso ainda;
- fechamento de semana com compromissos sem motivo preenchido — lista clara do que falta antes
  de tentar fechar de novo;
- semana já fechada — tela some os controles de edição, mostra só o resultado (PPC, motivos);
- cronograma sem versão vigente definida — visão trimestral fica vazia com aviso, em vez de
  erro.

## 8. Critérios de aceite

- [ ] Restrição vinculada a uma tarefa do cronograma; mudança de data na tarefa reflete na
      tela de restrições sem precisar duplicar dado.
- [ ] Tarefa com restrição aberta não pode ser adicionada a um compromisso semanal (bloqueado
      no banco, testado tentando via API direta).
- [ ] Resolver restrição grava autor e data; não pode ser reaberta.
- [ ] Meta de % da semana precisa ser maior que o ponto de partida e no máximo 100 (constraint
      de banco).
- [ ] Fechar semana com compromisso não cumprido sem motivo é bloqueado, com mensagem clara.
- [ ] PPC calculado corretamente (cumpridos ÷ total × 100) e gravado só no fechamento.
- [ ] Semana fechada não aceita nenhuma alteração em seus compromissos, sem exceção pra admin.
- [ ] Visão trimestral mostra data prevista e % médio por etapa, sem exigir cadastro novo.
- [ ] Cliente não vê nenhuma tela do módulo.
- [ ] Isolamento entre obras preservado (RESTRICTIVE desde a criação das tabelas).
- [ ] Migração versionada em `supabase/migrations`.
- [ ] Rodrigo testou com restrições e uma semana real e deu aceite.

## 9. Decisões aprovadas

- módulo construído em cima do Cronograma existente, por referência viva (não snapshot);
- restrição trava a tarefa de entrar no compromisso semanal — regra dura no banco;
- categoria fixa de restrição: Material, Mão de obra, Projeto/documentação, Decisão pendente,
  Equipamento, Financeiro, Serviço predecessor, Clima;
- três horizontes com funções diferentes: trimestral = marcos macro (automático das etapas),
  mensal = lista de restrições, semanal = compromisso + PPC;
- cumprimento da meta semanal é puxado do Avanço Físico já existente, sem lançamento duplicado;
- meta semanal é um % alvo pra aquela semana (não precisa ser 100% — serve pra tarefas longas);
- motivo do não cumprimento é obrigatório e reaproveita as mesmas categorias de restrição;
- fechar semana é exclusivo do admin, semana fechada é histórico imutável;
- cliente não vê nenhuma parte do módulo.
