# Roteiro de aceites e próximos módulos

Data: 18/07/2026  
Responsável pelo aceite final: Rodrigo Teles Silva  
Sequência aprovada: aprovar módulos pendentes -> Tarefas -> Projetos -> Planejamento lookahead/PPC -> Financeiro por último.

## 1. Objetivo

Fechar formalmente os módulos já entregues com dados reais da obra piloto e, em seguida,
iniciar os módulos pendentes na ordem mais prática para a operação.

## 2. Aceites pendentes

### 2.1 Compras

Objetivo do teste: confirmar o fluxo completo de pedido de compra com cotação,
aprovação, envio e conferência.

Roteiro:

1. Criar um pedido real vinculado à obra, unidade, etapa e serviço.
2. Inserir pelo menos uma cotação com fornecedor e anexo.
3. Comparar as cotações, mesmo que exista só uma.
4. Aprovar o pedido como admin.
5. Marcar pedido enviado.
6. Receber parcialmente ou totalmente os itens.
7. Conferir com NF quando houver nota.
8. Gerar o PDF do pedido.

Critério de aceite:

- Pedido percorre o fluxo sem erro oculto.
- Valores, quantidades e fornecedor ficam corretos.
- PDF sai utilizável.
- Equipe não aprova pedido sem permissão de admin.

Status: pendente de teste real.

### 2.2 Almoxarifado

Objetivo do teste: validar estoque, entradas, saídas, requisições e ferramentas.

Roteiro:

1. Fazer uma entrada real de material.
2. Fazer uma saída avulsa para uma unidade.
3. Lançar uma requisição com número e vários itens.
4. Conferir se o saldo atualizou corretamente.
5. Registrar empréstimo de ferramenta.
6. Registrar devolução.
7. Testar uma ferramenta em atraso e conferir o alerta no Dashboard.
8. Imprimir estoque.

Critério de aceite:

- Saldo bate com os movimentos.
- Saída exige unidade destino e quem retirou.
- Requisição fica rastreável.
- Ferramenta em atraso aparece no Dashboard.

Status: pendente de teste real.

### 2.3 Efetivo

Objetivo do teste: confirmar cadastro de trabalhadores e chamada diária integrada ao RDO.

Roteiro:

1. Cadastrar ou revisar trabalhadores reais.
2. Editar um trabalhador para corrigir dado.
3. Fazer chamada diária.
4. Abrir RDO do mesmo dia.
5. Confirmar que o RDO puxa o efetivo da chamada.
6. Assinar RDO e confirmar que o efetivo ficou congelado.

Critério de aceite:

- Chamada fica correta por dia.
- RDO em rascunho lê a chamada.
- RDO assinado não muda depois.

Status: pendente de teste real.

### 2.4 Definições de Projeto

Objetivo do teste: validar decisões pendentes de cliente/proprietário.

Roteiro:

1. Criar uma decisão real pendente.
2. Definir prazo e responsável.
3. Visualizar como cliente.
4. Resolver a decisão.
5. Conferir mudança no Dashboard.

Critério de aceite:

- Admin/equipe com permissão cria e resolve.
- Cliente vê em modo leitura.
- Status e prazo ficam claros.

Status: pendente de teste real.

### 2.5 Contratos

Objetivo do teste: validar cadastro e ativação de contrato real com empreiteiro.

Roteiro:

1. Cadastrar ou selecionar empreiteiro real.
2. Criar contrato em rascunho.
3. Inserir itens vinculados ao orçamento.
4. Conferir quantidade, unidade e valor.
5. Ativar contrato como admin.
6. Confirmar que itens ficam travados fora do rascunho.

Critério de aceite:

- Numeração do contrato correta.
- Total do contrato bate com os itens.
- Fluxo rascunho -> ativo funciona.
- Itens não mudam depois de ativo.

Status: pendente de teste real.

### 2.6 Medições de Empreiteiros

Objetivo do teste: validar medição de contrato ativo.

Roteiro:

1. Abrir contrato ativo.
2. Criar medição.
3. Lançar quantidade executada por item.
4. Conferir saldo contratual.
5. Conferir bruto, retenção e líquido.
6. Aprovar medição como admin.
7. Gerar PDF.

Critério de aceite:

- Sistema bloqueia medição acima do saldo.
- Valores calculados ficam corretos.
- Aprovação congela a medição.
- PDF fica utilizável.

Status: pendente de teste real.

### 2.7 Produção Própria

Objetivo do teste: validar produção por parede, dias salariais e medição MP.

Roteiro:

1. Conferir plantas e paredes cadastradas.
2. Ajustar rótulo de parede no desktop e no celular.
3. Lançar produção real por parede/unidade/profissional.
4. Cancelar um lançamento de teste e conferir que ele não bloqueia dia salarial.
5. Registrar período de dias salariais sem produção.
6. Criar medição de produção própria.
7. Aprovar medição como admin.
8. Marcar como paga quando aplicável.
9. Gerar PDF.

Critério de aceite:

- Produção calcula área e valor corretamente.
- Parede cancelada/excluída preserva histórico.
- Dia salarial não conflita com produção cancelada.
- Medição MP consolida produção + dias salariais.

Status: pendente de teste real.

## 3. Próximos módulos

### 3.1 Tarefas

Recomendação: iniciar primeiro.

O que faz:

- cria tarefas avulsas da obra e do escritório;
- define responsável, prazo, prioridade e status;
- permite comentários ou histórico simples;
- pode vincular a obra, unidade, etapa ou serviço quando fizer sentido;
- serve para cobranças, providências, lembretes e follow-ups que não são RDO,
  Pendência, Compra ou Medição.

Exemplos práticos:

- Cobrar fornecedor sobre entrega.
- Pedir conferência de medida em campo.
- Solicitar orçamento complementar.
- Lembrar de enviar documento ao cliente.
- Cobrar retorno de empreiteiro.

Por que começar por ele:

- é transversal;
- é menor que Projetos e Lookahead;
- ajuda a organizar os próximos módulos;
- pode virar base para alertas e acompanhamento semanal.

### 3.2 Projetos

Recomendação: iniciar depois de Tarefas.

O que faz:

- centraliza projetos e documentos técnicos;
- separa por disciplina, unidade, etapa e versão;
- identifica versão vigente;
- preserva histórico de revisões;
- evita uso de arquivo antigo em campo.

Exemplos práticos:

- Arquitetônico aprovado.
- Estrutural versão R02.
- Projeto hidráulico revisado.
- Memorial descritivo.
- Detalhe executivo enviado pelo projetista.

Por que vem depois:

- tarefas podem apontar para pendências de projeto;
- o módulo de Projetos precisa de regras mais claras de versão vigente, revisão e anexo.

### 3.3 Planejamento Lookahead/PPC

Recomendação: iniciar depois de Tarefas e Projetos.

O que faz:

- planeja curto prazo, normalmente 1 a 6 semanas;
- lista atividades prometidas para a semana;
- registra responsáveis;
- controla restrições antes da execução;
- mede PPC: percentual de promessas concluídas;
- mostra causas de não cumprimento.

Exemplos práticos:

- Semana 30: subir alvenaria Sobrado 04.
- Restrição: falta material, projeto, equipe ou liberação.
- Promessa: empreiteiro entrega reboco até sexta.
- Resultado: concluído, parcial ou não concluído.
- Motivo: chuva, material, mão de obra, projeto, prioridade alterada.

Por que vem depois:

- depende de tarefas bem organizadas;
- pode se beneficiar da central de projetos;
- tem impacto direto na rotina semanal e precisa de desenho mais cuidadoso.

### 3.4 Financeiro

Recomendação: deixar por último, conforme decisão do Rodrigo.

O que faz:

- contas a pagar;
- notas fiscais;
- pagamentos;
- retenções;
- vínculos com compras, contratos e medições;
- curva financeira;
- previsto x realizado;
- projeção de custo final.

Por que deixar por último:

- depende dos módulos anteriores estarem confiáveis;
- envolve cálculo financeiro e fluxo de aprovação;
- exige revisão arquitetural prévia do Claude Code;
- tem maior risco operacional.

## 4. Sequência operacional aprovada

1. Rodar os aceites pendentes com dados reais.
2. Corrigir defeitos encontrados nos aceites.
3. Aprovar formalmente os módulos testados.
4. Especificar o módulo Tarefas.
5. Implementar Tarefas.
6. Testar e aprovar Tarefas.
7. Especificar Projetos.
8. Implementar Projetos.
9. Especificar Planejamento lookahead/PPC.
10. Implementar Planejamento lookahead/PPC.
11. Iniciar análise arquitetural do Financeiro com Claude Code.

