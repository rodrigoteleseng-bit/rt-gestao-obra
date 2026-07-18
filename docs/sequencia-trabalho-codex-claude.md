# Sequência de trabalho — Codex + Claude Code

Data de criação: 17/07/2026  
Projeto: RT Gestão de Obra  
Responsável pelo aceite final: Rodrigo Teles Silva

## 1. Objetivo

Este documento é o ponto de entrada operacional para continuar o desenvolvimento do
RT Gestão de Obra usando Codex e Claude Code com responsabilidades complementares.

Ele define:

- o que fazer primeiro;
- quem é responsável por cada atividade;
- como iniciar uma sessão em cada ferramenta;
- como transferir uma tarefa entre Codex e Claude Code;
- como evitar edições concorrentes;
- quando uma tarefa pode ser considerada concluída.

Antes de trabalhar, as duas ferramentas devem ler integralmente:

1. `AGENTS.md` ou `CLAUDE.md`, conforme a ferramenta;
2. `docs/colaboracao-codex-claude.md`;
3. este documento;
4. os documentos da fase ou do módulo envolvido.

## 2. Responsabilidades permanentes

### 2.1 Codex — executor principal

O Codex é, por padrão, responsável por:

- transformar as decisões do Rodrigo em requisitos e critérios de aceite;
- preparar planos detalhados para aprovação antes da implementação;
- implementar frontend, backend, Supabase, RLS e migrações;
- executar testes técnicos, build e verificações de regressão;
- testar celular e desktop quando houver acesso ao ambiente;
- criar commits, publicar e verificar o deploy;
- investigar erros do aplicativo em produção;
- confirmar tecnicamente os achados apontados pelo Claude Code;
- aplicar as correções confirmadas;
- atualizar a documentação do projeto.

### 2.2 Claude Code — arquiteto e revisor independente

O Claude Code é, por padrão, responsável por:

- analisar a arquitetura de módulos grandes antes da implementação;
- identificar lacunas de negócio e dependências;
- revisar segurança, RLS, cálculos e integridade dos dados;
- revisar integrações e possíveis regressões;
- revisar commits concluídos pelo Codex;
- apontar dívida técnica e impactos amplos;
- atuar inicialmente em modo somente leitura;
- entregar achados com evidência, gravidade e forma de validação.

O Claude Code não deve editar arquivos, aplicar migrações, criar commits, executar
push ou publicar enquanto o Codex for o responsável ativo pela implementação.

### 2.3 Rodrigo — decisão e validação real

Rodrigo é responsável por:

- aprovar objetivos, planos e mudanças de escopo;
- fornecer dados reais, planilhas e documentos;
- decidir regras de negócio ainda abertas;
- executar ou acompanhar testes reais na obra e no escritório;
- confirmar se o resultado atende à operação;
- dar o aceite final de cada módulo.

### 2.4 Roteamento por tipo de tarefa

Quando um pedido não indicar explicitamente qual IA deve executar, ou for enviado pras
duas ao mesmo tempo, usar a tabela de roteamento em `docs/colaboracao-codex-claude.md`
("Roteamento por tipo de tarefa") — a IA que receber o pedido decide sozinha por ela,
sem esperar o Rodrigo escolher a cada vez.

## 3. Regra principal de segurança operacional

Somente uma IA pode implementar uma tarefa ou editar um conjunto de arquivos por vez.

Antes de qualquer implementação, registrar:

```text
Responsável pela implementação: Codex ou Claude Code
Escopo: descrição objetiva da tarefa
Arquivos ou módulos reservados: lista prevista
Commit-base: hash do commit antes do início
Revisor: Claude Code ou Codex
```

Se não houver declaração explícita transferindo a implementação, aplica-se o padrão:

```text
Responsável pela implementação: Codex
Claude Code: somente leitura
```

## 4. Sequência geral de cada trabalho

### Etapa 1 — Atualizar o estado

Responsável: Codex.

1. Ler as instruções e documentos aplicáveis.
2. Conferir `git status`, branch e commits recentes.
3. Verificar se existem mudanças locais de outra sessão.
4. Confirmar o último commit publicado.
5. Registrar o responsável, escopo, arquivos previstos e commit-base.
6. Não alterar arquivos que pertençam a outra tarefa em andamento.

### Etapa 2 — Entender e definir

Responsáveis: Rodrigo + Codex.

1. Confirmar o objetivo com palavras claras.
2. Listar dados [extraídos], [estimados], [lacunas] e [sugestões].
3. Identificar decisões que alteram banco, permissões, fluxo ou escopo.
4. Resolver lacunas estruturais antes da implementação.
5. Definir critérios de aceite verificáveis.

### Etapa 3 — Arquitetura ou revisão prévia

Responsável: Claude Code, para módulos grandes ou sempre que o escopo se enquadrar em
uma categoria de risco definida em `docs/colaboracao-codex-claude.md` (RLS, trigger,
RPC de escrita composta, cálculo financeiro, máquina de estado de aprovação). Nessas
categorias a revisão prévia é obrigatória mesmo em correção pontual — não é uma opção
do Codex decidir se pula esta etapa.

O Claude Code deve trabalhar em modo somente leitura e analisar:

- regras de negócio;
- modelo de dados;
- RLS e separação entre obras;
- papéis e permissões;
- rastreabilidade;
- cálculos e consistência;
- integrações;
- riscos de duplicidade;
- desempenho;
- impacto no celular;
- possíveis regressões.

Saída esperada: lacunas, riscos, alternativas e recomendação, sem editar arquivos.

### Etapa 4 — Plano de implementação

Responsável: Codex.

O plano deve apresentar:

- objetivo;
- escopo incluído e fora de escopo;
- telas e fluxos;
- tabelas e campos;
- RLS, RPCs, triggers e Storage, quando aplicável;
- integrações;
- migrações previstas;
- testes;
- riscos;
- critérios de aceite;
- ordem de execução.

Nenhum módulo novo deve ser implementado antes da aprovação explícita do Rodrigo.

### Etapa 5 — Implementação

Responsável padrão: Codex.

1. Confirmar que o plano foi aprovado.
2. Implementar apenas o escopo aprovado.
3. Versionar todas as mudanças de banco em `supabase/migrations`.
4. Aplicar RLS no banco, nunca somente na interface.
5. Preservar autoria, data/hora e vínculo com a hierarquia da obra.
6. Checar todos os retornos de erro do Supabase.
7. Usar operações transacionais em fluxos compostos.
8. Aplicar a regra de soft delete definida no `AGENTS.md`.
9. Preservar mudanças do usuário que não pertençam à tarefa.
10. Atualizar a documentação aplicável.

### Etapa 6 — Validação técnica

Responsável: Codex.

Conforme o risco da tarefa:

- executar TypeScript e build;
- testar funções e cálculos;
- testar RLS e permissões;
- testar admin, equipe e cliente;
- verificar isolamento entre obras;
- testar estados de carregamento, vazio, sucesso e erro;
- testar celular e desktop;
- verificar console e rede;
- validar PDFs, arquivos e uploads;
- confirmar que não houve regressão nos módulos integrados.

### Etapa 7 — Commit e deploy

Responsável: Codex.

1. Revisar o diff.
2. Garantir que somente arquivos da tarefa sejam incluídos.
3. Executar as verificações finais.
4. Criar commit descritivo.
5. Enviar ao repositório remoto.
6. Aguardar o deploy.
7. Verificar a aplicação publicada.
8. Registrar o hash revisável.

### Etapa 8 — Revisão independente

Responsável: Claude Code, em modo somente leitura.

O Claude Code deve revisar o commit informado. Cada achado deve conter:

- gravidade: crítico, alto, médio ou baixo;
- módulo e cenário;
- arquivo e linha;
- evidência;
- impacto;
- correção recomendada;
- teste para validar a correção;
- indicação clara se é defeito comprovado ou sugestão.

### Etapa 9 — Tratamento dos achados

Responsável: Codex.

1. Confirmar cada achado no código e no comportamento real.
2. Corrigir achados confirmados.
3. Justificar tecnicamente achados não confirmados.
4. Repetir os testes afetados.
5. Criar novo commit e publicar.
6. Solicitar nova revisão do Claude Code sempre que o commit se enquadrar em uma
   categoria de risco (`docs/colaboracao-codex-claude.md`); para as demais mudanças,
   a critério do risco observado.

### Etapa 10 — Teste real e aceite

Responsáveis: Rodrigo + Codex.

Se o commit se enquadrar em uma categoria de risco (`docs/colaboracao-codex-claude.md`),
as Etapas 8 e 9 precisam estar concluídas — achados tratados, não só entregues — antes
de iniciar este teste com dados reais.

1. Codex prepara um roteiro simples e verificável.
2. Rodrigo executa o fluxo com dados reais.
3. Codex registra erros e ajustes solicitados.
4. Codex aplica e publica as correções aprovadas.
5. Rodrigo dá o aceite formal.
6. Codex atualiza `AGENTS.md`, `CLAUDE.md` e o documento da fase.

## 5. Fila atual de trabalho

### Bloco A — fechamento pós-auditoria

Responsável: Codex.

- atualizar `AGENTS.md` e `CLAUDE.md` informando que a auditoria foi encerrada;
- sincronizar commits locais com o repositório remoto;
- confirmar build, deploy e versão publicada;
- verificar a rotina de backup semanal;
- manter `docs/auditoria-geral-2026-07-17.md` como relatório final.

Revisão: Claude Code verifica somente a coerência documental e o estado registrado.

### Bloco B — aceites com dados reais

Responsáveis: Rodrigo + Codex.

Ordem recomendada:

1. Compras;
2. Almoxarifado;
3. Gestão de Efetivo;
4. Contratos;
5. Medições de empreiteiros;
6. Produção própria;
7. Definições de Projeto, caso ainda não exista aceite formal separado.

O Codex prepara os roteiros, acompanha os resultados, corrige defeitos confirmados,
publica e atualiza a documentação. O Claude Code revisa os commits de correção.

### Bloco C — dados operacionais pendentes

Responsáveis: Rodrigo fornece; Codex prepara e importa.

- saldo inicial dos materiais do Almoxarifado;
- cadastro mestre de fornecedores;
- trabalhadores, funções, empresas e salários;
- contratos vigentes;
- responsáveis e permissões por módulo.

### Bloco D — Financeiro

Sequência obrigatória:

1. Claude Code faz análise arquitetural em modo somente leitura.
2. Rodrigo responde às lacunas e aprova as regras de negócio.
3. Codex transforma as decisões em especificação e plano detalhado.
4. Rodrigo aprova o plano.
5. Codex implementa, testa, cria commit, publica e verifica.
6. Claude Code revisa os commits.
7. Codex trata os achados confirmados.
8. Rodrigo testa com lançamentos reais e dá o aceite.

Questões que precisam ser definidas antes da implementação:

- financeiro somente por obra ou também empresarial;
- regime de caixa, competência ou ambos;
- contas a pagar, parcelas, adiantamentos e retenções;
- fluxo de lançamento, conferência, aprovação e pagamento;
- integração com Compras, NF, Contratos e Medições;
- visibilidade do cliente;
- Curva S financeira e projeção de custo final;
- integração bancária agora ou posteriormente.

### Bloco E — módulos seguintes

Após o aceite do Financeiro:

1. Planejamento lookahead/PPC;
2. Central de Alertas;
3. Projetos e documentos versionados;
4. Exportações Excel/PDF e relatórios gerenciais;
5. integrações automáticas entre módulos;
6. assistente de implantação de novas obras;
7. preparação futura para múltiplas empresas e comercialização.

Cada módulo repete integralmente as etapas 1 a 10 deste documento.

## 6. Prompt para iniciar no Codex

Copiar e enviar no Codex:

```text
Leia integralmente o AGENTS.md, docs/colaboracao-codex-claude.md e
docs/sequencia-trabalho-codex-claude.md.

Atue como responsável principal pela execução contínua. Antes de editar, confira o
estado atual do Git, os commits recentes, mudanças locais e documentos do módulo.
Informe o commit-base, o escopo e os arquivos previstos. Preserve qualquer mudança
que não pertença à tarefa.

Retome a primeira atividade ainda não concluída da fila definida em
docs/sequencia-trabalho-codex-claude.md. Siga o fluxo obrigatório do projeto:
objetivo, lacunas, plano para aprovação, implementação somente após aprovação,
testes, commit, deploy, revisão independente e aceite real.

Nesta sessão, informe primeiro:
1. qual é a primeira atividade pendente;
2. o estado atual encontrado;
3. o que pode ser executado agora;
4. o que depende de decisão ou dado do Rodrigo;
5. o que deverá ser enviado ao Claude Code para revisão.
```

## 7. Prompt para iniciar no Claude Code

Copiar e enviar no Claude Code:

```text
Leia integralmente o CLAUDE.md, docs/colaboracao-codex-claude.md e
docs/sequencia-trabalho-codex-claude.md.

O Codex é o responsável atual pela implementação. Atue como arquiteto e revisor
independente em modo SOMENTE LEITURA. Não altere arquivos, não aplique migrações,
não faça commit, push ou deploy.

Confira o estado atual do projeto e identifique a primeira atividade atribuída ao
Claude Code na fila de docs/sequencia-trabalho-codex-claude.md. Antes de revisar,
confirme o escopo e o commit que servirá como base.

Quando revisar código, classifique cada achado como crítico, alto, médio ou baixo e
informe módulo, cenário, arquivo, linha, evidência, impacto, correção recomendada e
teste de validação. Diferencie defeito comprovado de sugestão.

Nesta sessão, informe primeiro:
1. qual atividade cabe ao Claude Code agora;
2. quais documentos e commits foram considerados;
3. se há algum conflito com trabalho ativo do Codex;
4. quais lacunas ou riscos precisam ser tratados antes da próxima implementação;
5. qual deve ser o próximo handoff para o Codex ou para Rodrigo.
```

## 8. Prompt de revisão de um commit pelo Claude Code

```text
Responsável pela implementação: Codex.
Responsável pela revisão: Claude Code, somente leitura.
Escopo implementado: [descrever].
Commit-base: [hash anterior].
Commit para revisão: [hash implementado].

Leia CLAUDE.md, docs/colaboracao-codex-claude.md,
docs/sequencia-trabalho-codex-claude.md e os documentos do módulo.

Revise funcionamento, regras de negócio, RLS, permissões, rastreabilidade, cálculos,
integridade, integrações, regressões, UI/UX responsiva, acessibilidade, estados de
erro e desempenho. Não altere arquivos.

Para cada achado, informe gravidade, arquivo, linha, evidência, impacto, correção e
teste de validação. Diferencie defeito comprovado de sugestão. Se não houver achados,
registre explicitamente o que foi verificado.
```

## 9. Prompt para tratar a revisão no Codex

```text
Leia AGENTS.md, docs/colaboracao-codex-claude.md,
docs/sequencia-trabalho-codex-claude.md e a revisão abaixo.

Responsável pela implementação e tratamento dos achados: Codex.
Commit revisado: [hash].
Revisão do Claude Code: [colar revisão ou indicar arquivo].

Confirme cada achado no código antes de alterar. Para cada item, informe se foi
confirmado, parcialmente confirmado, não confirmado ou se é sugestão. Corrija os
achados confirmados dentro do escopo, execute testes proporcionais ao risco, revise
o diff, crie commit, publique e verifique o deploy. Não inclua mudanças alheias.
```

## 10. Transferência excepcional da implementação ao Claude Code

O Claude Code só pode implementar quando Rodrigo enviar uma autorização explícita
no seguinte formato:

```text
Responsável pela implementação: Claude Code.
Escopo: [descrever].
Arquivos ou módulos reservados: [listar].
Commit-base: [hash].
Codex ficará somente como revisor até a conclusão e o commit desta tarefa.
```

Ao concluir, o Claude Code deve informar arquivos alterados, testes, commit e pontos
de atenção. O Codex não deve editar os arquivos reservados até o handoff formal.

## 11. Critério de conclusão

Uma atividade somente está concluída quando, conforme aplicável:

- objetivo e escopo foram aprovados;
- lacunas estruturais foram resolvidas;
- implementação está versionada;
- banco e RLS estão cobertos por migração;
- build e testes passaram;
- celular e desktop foram verificados;
- permissões dos três papéis foram testadas;
- isolamento entre obras foi preservado;
- revisão independente foi tratada — obrigatória, não opcional, se a mudança se
  enquadrar em uma categoria de risco (`docs/colaboracao-codex-claude.md`);
- deploy foi verificado;
- documentação foi atualizada;
- dados de teste foram removidos ou identificados;
- Rodrigo testou com dados reais e deu aceite.

## 12. Regra de continuidade

Ao iniciar uma nova sessão, nenhuma ferramenta deve recomeçar o projeto do zero.

Deve:

1. ler os documentos obrigatórios;
2. conferir o estado real do repositório;
3. localizar a primeira atividade ainda não concluída;
4. respeitar decisões já aprovadas;
5. continuar do último commit e handoff registrados;
6. pedir ao Rodrigo somente decisões que não possam ser obtidas do projeto.

