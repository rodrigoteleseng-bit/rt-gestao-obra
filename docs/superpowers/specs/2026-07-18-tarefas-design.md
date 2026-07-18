# Modulo Tarefas - Spec de design

> Status: proposta inicial para aprovacao de Rodrigo.
> Sequencia aprovada em 18/07/2026: Tarefas -> Projetos -> Planejamento lookahead/PPC -> Financeiro por ultimo.
> Responsavel pela implementacao futura: Codex. Revisor recomendado: Claude Code, especialmente por envolver tabela nova, RLS e integracoes.

## 1. Objetivo

Criar uma central simples de tarefas operacionais da obra e do escritorio, para registrar
providencias que hoje ficam soltas em conversa, memoria, WhatsApp ou anotacoes.

O modulo deve permitir criar uma tarefa, definir responsavel, prazo, prioridade, status,
vinculo opcional com a hierarquia da obra e acompanhar o historico ate a conclusao.

Exemplos praticos:

- cobrar fornecedor sobre entrega;
- pedir conferencia de medida em campo;
- solicitar orcamento complementar;
- lembrar envio de documento ao cliente;
- cobrar retorno de empreiteiro;
- pedir ajuste em pendencia de qualidade;
- registrar providencia administrativa ligada a uma obra.

## 2. Escopo do MVP

Incluido:

- lista de tarefas por obra;
- cadastro de tarefa;
- detalhe da tarefa;
- edicao de tarefa aberta;
- responsavel;
- prazo;
- prioridade;
- status;
- comentarios/historico simples;
- vinculo opcional com obra, unidade, etapa e servico;
- filtros por status, responsavel, prioridade e atraso;
- indicador de tarefas atrasadas;
- permissao por modulo;
- cliente sem acesso ao modulo.

Fora do MVP:

- quadro Kanban completo;
- recorrencia automatica;
- notificacao push;
- chat em tempo real;
- checklist interno por subtarefa;
- aprovacao formal;
- assinatura;
- integracao automatica com Financeiro;
- criacao automatica de tarefa por todos os outros modulos;
- anexos/fotos, salvo se Rodrigo decidir incluir ja no MVP.

## 3. Regras de negocio

### 3.1 Status

Status sugeridos:

- `aberta`: tarefa criada e ainda nao iniciada;
- `em_andamento`: responsavel ja esta tratando;
- `concluida`: tarefa finalizada;
- `cancelada`: tarefa nao sera mais executada.

Regras:

- toda tarefa nova nasce como `aberta`;
- `concluida` grava quem concluiu e quando;
- `cancelada` grava quem cancelou, quando e motivo obrigatorio;
- tarefa concluida ou cancelada fica em modo leitura, exceto para admin reabrir se for necessario;
- tarefa atrasada e toda tarefa ativa com prazo anterior a hoje e status diferente de `concluida`/`cancelada`.

### 3.2 Prioridade

Prioridades sugeridas:

- `baixa`;
- `normal`;
- `alta`;
- `urgente`.

Padrao: `normal`.

### 3.3 Responsavel

- responsavel pode ser um usuario cadastrado no app;
- criador e responsavel podem ser pessoas diferentes;
- se a tarefa ainda nao tiver dono definido, pode ficar sem responsavel e aparecer no filtro "Sem responsavel";
- quando o responsavel muda, o historico registra a alteracao.

### 3.4 Vinculo com a obra

Toda tarefa pertence a uma obra.

Vinculos adicionais sao opcionais:

- unidade;
- etapa;
- servico.

O objetivo e nao forcar um vinculo artificial quando a tarefa for administrativa, mas permitir
rastreabilidade quando ela estiver ligada diretamente a um ponto da EAP.

### 3.5 Comentarios e historico

A tarefa deve ter um historico simples com dois tipos de registro:

- comentario manual;
- evento automatico.

Eventos automaticos sugeridos:

- tarefa criada;
- responsavel alterado;
- prazo alterado;
- prioridade alterada;
- status alterado;
- tarefa concluida;
- tarefa cancelada.

Comentarios nao devem ser editados nem apagados no MVP. Se houver erro, registra-se novo
comentario corrigindo.

## 4. Modelo de dados proposto

### 4.1 Enums

```sql
CREATE TYPE status_tarefa AS ENUM (
  'aberta',
  'em_andamento',
  'concluida',
  'cancelada'
);

CREATE TYPE prioridade_tarefa AS ENUM (
  'baixa',
  'normal',
  'alta',
  'urgente'
);
```

### 4.2 `tarefas`

```sql
CREATE TABLE tarefas (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  obra_id         UUID NOT NULL REFERENCES obras(id),
  unidade_id      UUID REFERENCES unidades(id),
  etapa_id        UUID REFERENCES etapas(id),
  servico_id      UUID REFERENCES servicos(id),
  titulo          TEXT NOT NULL,
  descricao       TEXT,
  status          status_tarefa NOT NULL DEFAULT 'aberta',
  prioridade      prioridade_tarefa NOT NULL DEFAULT 'normal',
  prazo           DATE,
  responsavel_id  UUID REFERENCES perfis_usuario(id),
  concluida_por   UUID REFERENCES perfis_usuario(id),
  concluida_em    TIMESTAMPTZ,
  cancelada_por   UUID REFERENCES perfis_usuario(id),
  cancelada_em    TIMESTAMPTZ,
  motivo_cancelamento TEXT,
  ativo           BOOLEAN NOT NULL DEFAULT true,
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
  criado_por      UUID NOT NULL DEFAULT auth.uid() REFERENCES perfis_usuario(id),
  atualizado_em   TIMESTAMPTZ
);
```

### 4.3 `tarefas_comentarios`

```sql
CREATE TABLE tarefas_comentarios (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tarefa_id   UUID NOT NULL REFERENCES tarefas(id),
  tipo        TEXT NOT NULL DEFAULT 'comentario',
  comentario  TEXT NOT NULL,
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT now(),
  criado_por  UUID NOT NULL DEFAULT auth.uid() REFERENCES perfis_usuario(id)
);
```

## 5. Permissoes e RLS

Modulo sugerido no enum `modulo_app`: `tarefas`.

Regras:

- admin tem acesso total;
- equipe com modulo `tarefas` pode criar, comentar, editar tarefa ativa e alterar status;
- cliente nao ve o modulo e nao acessa as rotas/tabelas;
- leitura limitada a obras acessiveis pelo usuario, mantendo isolamento usuario x obra;
- soft delete segue a regra aprendida no projeto: policy de SELECT nao pode bloquear update para `ativo = false`;
- comentarios sao append-only no MVP.

Como o modulo cria tabelas novas e RLS, a revisao previa do Claude Code e obrigatoria pelo
protocolo de risco antes da implementacao.

## 6. Telas e fluxo

### 6.1 Menu

Entrada no menu principal e lateral:

- modulo: **Tarefas**;
- icone simples;
- sem submodulos no MVP.

### 6.2 Lista de tarefas

Elementos:

- filtros: status, responsavel, prioridade, atrasadas;
- busca por titulo/descricao;
- botao `Nova tarefa`;
- cards ou tabela responsiva;
- chips de status e prioridade;
- destaque visual para atrasadas.

Colunas/dados:

- titulo;
- responsavel;
- prazo;
- prioridade;
- status;
- vinculo com unidade/etapa/servico, quando houver;
- data de criacao.

### 6.3 Nova tarefa

Campos:

- titulo obrigatorio;
- descricao;
- responsavel;
- prazo;
- prioridade;
- unidade/etapa/servico opcionais.

### 6.4 Detalhe da tarefa

Mostra:

- dados principais;
- vinculos;
- historico;
- comentarios;
- acoes de status.

Acoes:

- salvar alteracoes;
- iniciar;
- concluir;
- cancelar;
- reabrir, somente admin na recomendacao inicial.

## 7. Integracoes futuras

Integracoes planejadas, mas nao obrigatorias no MVP:

- Pendencias: criar tarefa a partir de uma pendencia;
- RDO: listar tarefas concluidas no dia ou criar tarefa a partir do RDO;
- Compras: tarefa de follow-up de fornecedor/pedido;
- Projetos: tarefa vinculada a revisao ou documento;
- Lookahead/PPC: usar tarefas como restricoes ou providencias da semana;
- Alertas: tarefa atrasada vira alerta no Dashboard;
- Financeiro: tarefas de cobranca/conferencia sem lancamento financeiro automatico.

## 8. Estados de tela

Prever:

- carregando;
- lista vazia;
- filtro sem resultado;
- erro ao salvar;
- erro ao alterar status;
- confirmacao antes de cancelar;
- feedback claro apos salvar/comentar/concluir.

## 9. Criterios de aceite

- [ ] Funciona no desktop e celular.
- [ ] Admin cria, edita, comenta, conclui, cancela e reabre tarefa.
- [ ] Equipe com modulo `tarefas` cria, edita, comenta e altera status conforme regra aprovada.
- [ ] Cliente nao ve o modulo e nao acessa a rota.
- [ ] Tarefa sempre pertence a uma obra.
- [ ] Vinculo com unidade/etapa/servico e opcional e salva corretamente.
- [ ] Tarefa atrasada aparece destacada.
- [ ] Historico registra alteracoes principais.
- [ ] Comentarios ficam rastreados por autor e data.
- [ ] Soft delete nao sofre bloqueio de RLS.
- [ ] Isolamento entre obras preservado.
- [ ] Migracao versionada em `supabase/migrations`.
- [ ] Rodrigo testou com tarefas reais e deu aceite.

## 10. Lacunas para decisao de Rodrigo

1. A equipe pode concluir qualquer tarefa do modulo ou apenas tarefas em que seja responsavel?
2. Tarefa concluida pode ser reaberta por equipe ou somente admin?
3. Comentarios devem aceitar anexos/fotos ja no MVP ou deixamos anexos para depois?
4. A tarefa pode ficar sem prazo ou prazo deve ser obrigatorio?
5. Deseja notificar visualmente no Dashboard ja no MVP, ou apenas listar dentro do modulo Tarefas?

## 11. Recomendacao inicial

Recomendacao para o MVP:

- prazo opcional;
- responsavel opcional;
- equipe com modulo `tarefas` pode concluir tarefas;
- reabertura somente admin;
- anexos fora do MVP inicial;
- Dashboard mostra apenas contador de tarefas atrasadas e tarefas abertas do usuario;
- integracoes automaticas ficam para uma segunda rodada.

Essa versao entrega valor rapido e prepara base segura para Projetos e Lookahead/PPC.
