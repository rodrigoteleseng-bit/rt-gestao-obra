# Modulo Tarefas - Spec de design

> Status: decisoes principais aprovadas por Rodrigo em 18/07/2026, aguardando plano de implementacao.
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
- prazo obrigatorio;
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
- equipe so pode concluir tarefa em que esteja como responsavel;
- admin pode concluir qualquer tarefa;
- reabertura de tarefa concluida/cancelada e exclusiva do admin.

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
  prazo           DATE NOT NULL,
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
- equipe so conclui tarefas em que seja responsavel;
- reabertura fica restrita ao admin;
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
- prazo obrigatorio;
- prioridade;
- status;
- vinculo com unidade/etapa/servico, quando houver;
- data de criacao.

### 6.3 Nova tarefa

Campos:

- titulo obrigatorio;
- descricao;
- responsavel;
- prazo obrigatorio;
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
- reabrir, somente admin.

## 7. Integracoes futuras

Integracoes planejadas, mas nao obrigatorias no MVP:

- Pendencias: criar tarefa a partir de uma pendencia;
- RDO: listar tarefas concluidas no dia ou criar tarefa a partir do RDO;
- Compras: tarefa de follow-up de fornecedor/pedido;
- Projetos: tarefa vinculada a revisao ou documento;
- Lookahead/PPC: usar tarefas como restricoes ou providencias da semana;
- Dashboard/Alertas: contador de tarefas atrasadas ja no MVP; alerta detalhado pode ficar para depois;
- Financeiro: tarefas de cobranca/conferencia sem lancamento financeiro automatico.
- Fotos: depois do MVP, permitir anexar fotos do problema resolvido na tarefa.

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
- [ ] Equipe com modulo `tarefas` cria, edita e comenta tarefas.
- [ ] Equipe so conclui tarefas em que esteja como responsavel.
- [ ] Reabertura de tarefa concluida/cancelada funciona somente para admin.
- [ ] Cliente nao ve o modulo e nao acessa a rota.
- [ ] Tarefa sempre pertence a uma obra.
- [ ] Prazo obrigatorio e validado no formulario e no banco.
- [ ] Vinculo com unidade/etapa/servico e opcional e salva corretamente.
- [ ] Tarefa atrasada aparece destacada.
- [ ] Dashboard mostra contador simples de tarefas atrasadas.
- [ ] Historico registra alteracoes principais.
- [ ] Comentarios ficam rastreados por autor e data.
- [ ] Soft delete nao sofre bloqueio de RLS.
- [ ] Isolamento entre obras preservado.
- [ ] Migracao versionada em `supabase/migrations`.
- [ ] Rodrigo testou com tarefas reais e deu aceite.
## 10. Lacunas para decisao de Rodrigo

1. [respondida] Equipe conclui apenas tarefas em que seja responsavel.
2. [respondida] Tarefa concluida/cancelada so pode ser reaberta por admin.
3. [respondida] Fotos/anexos ficam depois do MVP; objetivo futuro e anexar fotos do problema resolvido.
4. [respondida] Prazo deve ser obrigatorio.
5. [respondida] Dashboard deve mostrar contador simples de tarefas atrasadas ja no MVP.

## 11. Decisoes aprovadas para o MVP

- prazo obrigatorio;
- responsavel opcional na criacao, mas equipe so conclui quando for a responsavel;
- reabertura somente admin;
- anexos fora do MVP inicial;
- Dashboard mostra contador de tarefas atrasadas e tarefas abertas do usuario;
- integracoes automaticas ficam para uma segunda rodada.

Essa versao entrega valor rapido e prepara base segura para Projetos e Lookahead/PPC.
