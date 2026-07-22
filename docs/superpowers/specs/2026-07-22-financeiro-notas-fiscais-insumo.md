# Financeiro — Anexos e leitura de notas fiscais

Documento de insumo para análise do Claude Code.

Este arquivo não é uma spec aprovada nem um plano de implementação. É a consolidação da ideia discutida com Rodrigo para o Claude Code analisar, criticar tecnicamente e transformar em spec/plano formal antes de qualquer implementação pelo Codex.

## 1. Contexto

O módulo Financeiro já começou pela Fase 3a, com livro de lançamentos financeiros, lançamentos vindos de medições e compras, filtros, baixa e fila de itens a classificar.

Rodrigo informou que possui as notas fiscais lançadas na planilha financeira e que os arquivos correspondentes estão no Drive. A intenção é entender como o app pode aproveitar essas notas fiscais para reduzir digitação, melhorar rastreabilidade e preparar o previsto x realizado financeiro.

## 2. Objetivo da ideia

Permitir que lançamentos financeiros sejam criados ou complementados a partir de documentos fiscais anexados ao app.

O usuário idealmente anexaria PDF, imagem ou XML da nota fiscal. O sistema extrairia os dados principais automaticamente quando possível, e o usuário apenas conferiria os dados e informaria a aplicação na obra.

## 3. Problema prático que queremos resolver

Hoje, para registrar uma nota no financeiro, o usuário precisa digitar manualmente informações que já existem no documento fiscal:

- fornecedor/favorecido;
- número da nota;
- data de emissão;
- data de vencimento, quando existir;
- valor total;
- itens ou descrição;
- CNPJ;
- chave de acesso, no caso de NF-e;
- vínculo com pedido de compra, quando existir;
- aplicação no orçamento.

Na prática, isso gera retrabalho e risco de erro de digitação.

## 4. Fluxo operacional desejado

Fluxo recomendado para uso em obra/escritório:

1. Financeiro recebe ou localiza a nota fiscal no Drive.
2. Usuário entra no módulo Financeiro ou Compras.
3. Usuário anexa o documento fiscal ao lançamento, pedido ou item.
4. O sistema lê os dados possíveis.
5. O usuário confere fornecedor, número, data e valor.
6. O usuário informa a aplicação: unidade, etapa e serviço.
7. O sistema grava o lançamento financeiro.
8. Quando o pagamento for feito, o usuário anexa comprovante e dá baixa.

## 5. Tipos de arquivo previstos

Arquivos que devem ser considerados:

- XML de NF-e;
- XML de NFS-e, quando disponível;
- PDF de nota fiscal;
- imagem/foto da nota;
- boleto;
- comprovante de pagamento;
- outros anexos financeiros complementares.

## 6. Melhor ordem técnica sugerida

Não começar diretamente por IA/OCR. A recomendação é criar a base de rastreabilidade primeiro.

Ordem sugerida:

1. Criar estrutura de anexos financeiros.
2. Permitir anexar PDF/XML/imagem ao lançamento financeiro.
3. Adicionar campos fiscais ao lançamento financeiro: número da nota, chave, CNPJ, fornecedor, data de emissão, vencimento e origem.
4. Criar tela para revisar dados extraídos antes de gravar.
5. Implementar leitura automática de XML, por ser o formato mais confiável.
6. Depois implementar leitura assistida de PDF/imagem com OCR/IA, sempre como sugestão revisável pelo usuário.
7. Integrar com Drive somente depois que o fluxo de anexos internos estiver estável.

## 7. Leitura por XML

XML deve ser a prioridade técnica para extração automática porque é estruturado.

Dados que podem ser extraídos:

- CNPJ do emitente;
- nome do fornecedor;
- número da nota;
- série;
- chave de acesso;
- data de emissão;
- valor total;
- itens;
- CFOP/NCM, se futuramente útil;
- impostos, se futuramente útil;
- dados de vencimento, quando existirem no XML.

Regra importante: mesmo quando o XML for lido corretamente, o usuário deve revisar antes de o lançamento financeiro ser gravado ou classificado.

## 8. Leitura por PDF ou imagem

PDF e imagem podem ser lidos por OCR/IA, mas com menor confiabilidade que XML.

Uso recomendado:

- extrair sugestões de fornecedor, número, data e valor;
- marcar dados como “sugeridos” até confirmação do usuário;
- exigir revisão manual antes de gravar lançamento definitivo;
- guardar o arquivo original como fonte do lançamento.

Não permitir que IA grave lançamento financeiro definitivo sem confirmação humana.

## 9. Vínculo com Compras

Quando a nota fiscal estiver relacionada a um pedido de compra:

- a NF pode ser anexada no pedido, na conferência de NF ou no lançamento financeiro;
- o sistema deve manter vínculo entre pedido, item, fornecedor, nota e lançamento financeiro;
- a comparação deve considerar cotação aprovada, valor da NF e quantidade recebida;
- divergências podem virar alerta futuro;
- item sem aplicação continua indo para fila “a classificar”.

Esse fluxo deve respeitar o que já existe na Fase 3a: Compras pode gerar lançamentos financeiros automaticamente quando o valor da NF é informado.

## 10. Fila “a classificar”

Se a aplicação não estiver definida, o lançamento não deve ser perdido.

O lançamento pode nascer com:

- fornecedor identificado;
- valor identificado;
- documento anexado;
- data identificada;
- aplicação pendente.

Depois, Rodrigo ou usuário com permissão financeira classifica o lançamento no orçamento.

## 11. Campos possíveis no lançamento financeiro

Analisar se estes campos devem entrar diretamente em `lancamentos_financeiros` ou em tabela auxiliar fiscal:

- numero_documento;
- tipo_documento;
- chave_acesso;
- cnpj_fornecedor;
- fornecedor_id, quando casado com cadastro existente;
- data_emissao;
- data_vencimento;
- origem_documento;
- arquivo_principal_id;
- dados_extraidos_json;
- dados_confirmados_por;
- dados_confirmados_em.

Ponto de análise: separar “lançamento financeiro” de “documento fiscal” pode ser mais limpo, porque uma nota pode ter mais de um item/aplicação e um lançamento pode ter comprovantes adicionais.

## 12. Modelo de dados a analisar

Possível desenho:

- `financeiro_documentos`
  - documento fiscal ou comprovante anexado;
  - tipo: nf_pdf, nf_xml, imagem, boleto, comprovante, outro;
  - bucket/path no Storage;
  - hash/checksum opcional;
  - metadados extraídos;
  - status da leitura: pendente, lido, erro, confirmado;
  - autor/data.

- `financeiro_documentos_lancamentos`
  - vínculo N:N entre documentos e lançamentos;
  - permite uma nota alimentar vários lançamentos;
  - permite um lançamento ter NF, boleto e comprovante.

- Campos adicionais em `lancamentos_financeiros`
  - número de documento;
  - vencimento;
  - fornecedor/favorecido revisado;
  - referência fiscal consolidada.

## 13. Integração com Drive

Rodrigo tem as notas no Drive.

Possibilidades:

1. Importação manual: usuário baixa/seleciona o arquivo e sobe no app.
2. Integração assistida com Drive: app lista arquivos de uma pasta autorizada e permite importar.
3. Rotina de importação em lote: script lê uma pasta do Drive e cadastra documentos pendentes no Financeiro.

Recomendação inicial: começar por upload manual no app. A integração com Drive deve vir depois, para reduzir complexidade de autenticação, permissões e organização de pastas.

## 14. Permissões e segurança

Esse fluxo é sensível porque envolve documentos fiscais e dados financeiros.

Regras esperadas:

- cliente não acessa documentos financeiros;
- apenas admin e equipe com módulo financeiro acessam;
- RLS obrigatória em todas as tabelas novas;
- Storage privado, com policy por obra;
- nenhum documento fiscal pode vazar entre obras;
- anexos não devem ser apagados fisicamente, salvo decisão explícita;
- correções devem manter rastreabilidade.

## 15. Riscos técnicos

Pontos que o Claude Code deve analisar com atenção:

- RLS nova e Storage privado;
- vínculo correto com obra;
- nota fiscal com múltiplos itens e múltiplas aplicações;
- nota fiscal sem pedido de compra;
- nota fiscal de serviço versus produto;
- XML de NF-e e XML de NFS-e podem ter estruturas diferentes;
- OCR/IA pode errar valor, data ou CNPJ;
- duplicidade de nota já importada;
- necessidade de bloquear ou avisar se mesma chave de acesso já existe;
- impacto no livro financeiro já criado na Fase 3a;
- compatibilidade com importação futura de histórico financeiro.

## 16. Critérios de aceite desejados

Antes de liberar para teste de campo:

- upload de PDF/XML/imagem funcionando;
- documento fica vinculado à obra correta;
- lançamento financeiro mostra o anexo;
- usuário consegue revisar os dados antes de confirmar;
- XML extrai pelo menos fornecedor, número, data e valor;
- PDF/imagem, se implementado nesta fase, entra como sugestão revisável;
- item sem aplicação entra como “a classificar”;
- build passa;
- policies de RLS e Storage revisadas;
- revisão pós-commit obrigatória do Claude Code se houver tabela nova, policy nova, função, trigger, Storage policy ou automação de leitura.

## 17. Perguntas para o Claude Code analisar

1. Isso deve ser uma continuação da Fase 3a, uma Fase 3b ou uma etapa separada de “Documentos financeiros”?
2. Qual é o melhor modelo: anexos ligados diretamente a `lancamentos_financeiros` ou uma entidade separada `financeiro_documentos`?
3. Como tratar uma NF com vários itens aplicados em serviços diferentes?
4. Como evitar duplicidade de nota por chave de acesso, número, fornecedor e valor?
5. A primeira entrega deve incluir apenas XML ou também PDF/imagem?
6. Vale integrar com Drive agora ou deixar para uma etapa posterior?
7. Quais campos devem ficar em tabela normalizada e quais podem ficar em JSON de metadados extraídos?
8. Como manter compatibilidade com Compras -> Financeiro já implementado?
9. Como tratar notas antigas da planilha financeira no importador de histórico?
10. Quais riscos exigem revisão obrigatória antes de teste de campo?

## 18. Recomendação inicial para planejamento

Recomenda-se dividir em etapas:

### Etapa 1 — Base de anexos financeiros

- Criar tabela de documentos financeiros.
- Criar vínculo com lançamentos.
- Criar Storage/policies.
- Permitir upload e visualização.
- Sem IA/OCR ainda.

### Etapa 2 — XML fiscal

- Upload de XML.
- Parser de XML.
- Tela de revisão.
- Criação ou atualização de lançamento financeiro.
- Detecção de duplicidade por chave de acesso.

### Etapa 3 — PDF/imagem com leitura assistida

- OCR/IA para sugerir dados.
- Nunca gravar sem confirmação.
- Guardar metadados extraídos e dados confirmados.

### Etapa 4 — Integração com Drive

- Importação assistida de arquivos do Drive.
- Possível rotina em lote para documentos antigos.
- Mapeamento com lançamentos já importados da planilha.

## 19. Prompt sugerido para o Claude Code

Leia `AGENTS.md`, `docs/colaboracao-codex-claude.md`, a spec da Fase 3a do Financeiro e este arquivo:

`docs/superpowers/specs/2026-07-22-financeiro-notas-fiscais-insumo.md`

Analise a proposta de anexos e leitura de notas fiscais no módulo Financeiro. Não implemente. Produza primeiro uma avaliação técnica com:

- aderência ao modelo atual do Financeiro;
- riscos de RLS/Storage/duplicidade/rastreabilidade;
- sugestão de arquitetura;
- divisão recomendada em fases;
- perguntas que precisam de decisão do Rodrigo;
- escopo mínimo da primeira entrega;
- indicação se isso deve virar Fase 3b, 3c ou módulo auxiliar.

Depois da análise, se Rodrigo aprovar o caminho, transformar em spec e plano de implementação para o Codex executar.
