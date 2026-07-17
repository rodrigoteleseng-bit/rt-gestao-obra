# Colaboração Codex + Claude Code — RT Gestão de Obra

## Objetivo

Usar as duas IAs com responsabilidades complementares, sem alterações concorrentes, migrações duplicadas ou perda de rastreabilidade.

## Responsabilidades padrão

### Codex — responsável pela execução contínua

- transformar as decisões do Rodrigo em requisitos e critérios de aceite;
- implementar alterações funcionais, UI/UX, Supabase, RLS e migrações;
- testar celular e desktop, executar build, criar commit, publicar e verificar o deploy;
- investigar erros do aplicativo online e aplicar as correções confirmadas;
- receber e validar tecnicamente as revisões do Claude Code.

### Claude Code — arquiteto e revisor independente

- revisar arquitetura, segurança, RLS, cálculos e integração entre módulos;
- mapear impactos amplos e dívida técnica;
- revisar commits concluídos, inicialmente em modo somente leitura;
- planejar módulos grandes e registrar lacunas antes da implementação;
- não editar arquivos que estejam sob responsabilidade ativa do Codex.

## Regras de coordenação

1. Apenas uma IA implementa uma tarefa ou conjunto de arquivos por vez.
2. Antes do trabalho, registrar: responsável, escopo, arquivos previstos e commit-base.
3. A IA revisora começa em modo somente leitura e entrega achados com evidências.
4. Achados são classificados como crítico, alto, médio ou baixo.
5. A IA implementadora confirma cada achado no código antes de corrigir.
6. Migrações Supabase são sempre versionadas; nenhuma alteração manual fica sem arquivo correspondente.
7. Nunca incluir arquivos ou mudanças do usuário que não pertençam à tarefa.
8. Deploy em produção ocorre somente depois de build e verificações proporcionais ao risco.
9. O aceite final continua sendo do Rodrigo, preferencialmente com dados reais, sujeito
   à revisão obrigatória por categoria de risco (abaixo) quando aplicável.

## Categorias de risco com revisão obrigatória

O critério de quando o Claude Code revisa não é mais só "módulo grande" — é a
**categoria da mudança**, independente do tamanho. Isso existe porque uma correção
pontual pode mexer exatamente na parte mais sensível do sistema (foi o caso da fix de
17/07/2026 que tornou Compras/Contratos/Medições transacionais: pequena em linhas,
alto risco em conteúdo, e só foi revisada depois do deploy).

Qualquer mudança que se enquadre em uma das categorias abaixo exige revisão do Claude
Code — não é uma decisão do Codex sobre se "o risco justifica":

- RLS (policy nova ou alterada);
- trigger novo ou alterado;
- RPC que escreve em mais de uma tabela na mesma transação;
- cálculo financeiro (valor, retenção, saldo, rateio);
- máquina de estado de aprovação (mudança de status irreversível ou exclusiva de um papel).

Regra de sequência:

- Se o desenho ainda está aberto (a mudança ainda não foi implementada), a revisão é
  **prévia** (Etapa 3 de `docs/sequencia-trabalho-codex-claude.md`), mesmo em correção
  pontual.
- Se a mudança já foi implementada e commitada, a revisão é **pós-commit** (Etapa 8) e
  precisa estar concluída, com os achados tratados, **antes** de o Rodrigo validar o
  fluxo com dados reais (Etapa 10). O Codex não deve pedir o teste de campo do Rodrigo
  nessas categorias sem antes passar pela revisão.

## Roteamento por tipo de tarefa

Quando não há dúvida sobre o que fazer, mas há dúvida sobre **qual IA deve fazer**, usar
esta tabela como padrão — a IA que receber o pedido decide sozinha por ela, sem esperar
o Rodrigo escolher a cada vez.

| Tipo de tarefa | Responsável padrão | Por quê |
|---|---|---|
| Implementação de escopo já aprovado (tela, fluxo, ajuste) | Codex | Execução direta, iteração rápida com build/teste |
| Investigação de erro em produção | Codex | Acesso ao ciclo de deploy e correção rápida |
| Importação/carga de dados (planilha, CSV, cadastro em massa) | Codex | Tarefa mecânica e repetitiva |
| UI/UX — ajuste visual, responsividade, polimento de tela existente | Codex | Execução de uma decisão já tomada |
| UI/UX — auditoria ou redesenho estrutural (ex.: "essa tabela não funciona no celular, o que fazer?") | Claude Code decide o desenho primeiro, Codex implementa depois | Decisão de arquitetura de experiência antes de mexer em código |
| Documentação de módulo/fase (`docs/faseN.md`, `CLAUDE.md`, `AGENTS.md`) | Codex | Quem implementou sabe exatamente o que documentar |
| Documentação do próprio protocolo Codex+Claude (este arquivo e `docs/sequencia-trabalho-codex-claude.md`) | Quem for solicitado a escrever, sempre com aprovação explícita do Rodrigo | Não é execução de produto, é acordo operacional entre as duas IAs |
| Arquitetura, RLS, integração entre módulos, categorias de risco (seção acima) | Claude Code, revisão obrigatória | Ver "Categorias de risco com revisão obrigatória" |
| Revisão de commit concluído | Claude Code | Segunda opinião independente de quem não escreveu o código |

Pedido ambíguo, ou enviado pras duas IAs ao mesmo tempo: a IA que receber primeiro
confere esta tabela. Se a tarefa bater com uma linha do Claude Code (arquitetura,
categoria de risco, auditoria estrutural), ela direciona pra mim antes de qualquer
implementação — inclusive avisando o Codex para não implementar em paralelo. Se bater
com uma linha do Codex, ele segue direto, sem esperar revisão prévia.

## Formato obrigatório de uma revisão

Cada achado deve informar:

- gravidade;
- módulo e cenário;
- arquivo e linha;
- evidência observada;
- impacto funcional, visual ou de segurança;
- correção recomendada;
- como validar depois da correção.

## Prompt padrão para o Claude Code

```text
Você atuará como arquiteto e revisor independente do projeto RT Gestão de Obra.

Leia integralmente o CLAUDE.md e docs/colaboracao-codex-claude.md antes de agir.

Responsável atual pela implementação: Codex.
Sua atuação nesta tarefa é SOMENTE LEITURA: não altere arquivos, não aplique migrações,
não faça commit, push ou deploy.

Revise o escopo ou commit informado por Rodrigo verificando:
1. funcionamento e regras de negócio;
2. segurança, permissões, RLS e rastreabilidade;
3. cálculos e integridade dos dados;
4. integrações e possíveis regressões nos demais módulos;
5. UI/UX responsiva no celular e desktop;
6. estados de carregamento, vazio, sucesso e erro;
7. acessibilidade e clareza das ações;
8. desempenho e uso de memória, especialmente com fotos e listas grandes.

Classifique cada achado em crítico, alto, médio ou baixo. Para cada um, informe
módulo, cenário, arquivo, linha, evidência, impacto, correção recomendada e teste de
validação. Diferencie defeito comprovado de sugestão. Se não houver achados, diga
explicitamente quais verificações foram realizadas.
```

## Handoff de implementação

Quando o Claude Code for autorizado a implementar, Rodrigo deve informar explicitamente:

```text
Responsável pela implementação: Claude Code.
Escopo: [descrever].
Arquivos ou módulos reservados: [listar].
Commit-base: [hash].
Codex ficará somente como revisor até a conclusão e o commit desta tarefa.
```

