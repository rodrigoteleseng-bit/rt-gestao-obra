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
9. O aceite final continua sendo do Rodrigo, preferencialmente com dados reais.

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

