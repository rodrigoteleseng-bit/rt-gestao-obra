# Fase 6 — Suprimentos: Compras (design)

> Spec da primeira metade da Fase 6 (Suprimentos), conforme CLAUDE.md §5. Almoxarifado é um spec separado, a desenhar depois que Compras estiver em uso.

## 1. Objetivo

Módulo de compras vinculado ao orçamento: pedido → cotações de fornecedores (com anexo obrigatório) → aprovação do vencedor por item → acompanhamento de entrega → conferência com nota fiscal. Cobre as regras já fixadas em CLAUDE.md §5 (fluxo de status, aprovação exclusiva do admin, número de cotações livre) e resolve a lacuna do §9 item 8 (cadastro de fornecedores).

## 2. Decisões (perguntas respondidas com o Rodrigo)

- **Fornecedores:** cadastro próprio, reaproveitável entre pedidos (não é campo livre por cotação).
- **Quem cria pedido/cotação:** equipe e admin, qualquer um com o módulo `compras` habilitado. Aprovação de vencedor e do pedido é exclusiva do admin (regra já definida no CLAUDE.md).
- **Granularidade do pedido:** um pedido tem múltiplos itens (insumos), cada item vinculado a um serviço do orçamento.
- **Vínculo com orçamento:** ao digitar o nome do insumo, autocomplete busca nos `servicos` do orçamento e sugere o item (código + nome) pra confirmar a aplicação. Se nada bater, o item é criado sem vínculo (`servico_id` nulo) e entra numa fila "a classificar" — mesmo padrão do CLAUDE.md §5.1 para gastos financeiros sem vínculo. Não bloqueia a criação do pedido.
- **Data de necessidade e urgência:** por item (não por pedido) — cada insumo tem sua própria data em que precisa estar na obra, e um flag `urgente` independente.
- **Vencedor da cotação:** por item, não por pedido inteiro — o admin pode compor o pedido final com fornecedores diferentes por linha.
- **Dados da cotação:** preço unitário por item + condição de pagamento + prazo de entrega informado pelo fornecedor + anexo obrigatório (PDF/foto do orçamento do fornecedor).
- **Quem confere o recebimento/NF:** equipe e admin (mesmo grupo que cria pedidos).
- **Cancelamento:** pedido pode ser cancelado com motivo obrigatório, em qualquer status antes de "encerrado" (soft — nunca se apaga, regra CLAUDE.md §6).
- **Status "recebido parcial/total":** calculado automaticamente a partir da quantidade recebida por item vs. quantidade pedida (não é escolha manual).
- **Conferência com NF (escopo desta fase, sem Almoxarifado ainda):** anexar a(s) NF(s) e confirmar quantidade/valor recebido por item. Sistema sinaliza divergência de quantidade ou valor, mas sem baixa automática de estoque (isso entra quando o Almoxarifado existir).
- **Numeração do pedido:** sequencial por obra, exibida com 3 dígitos (065, 066…). Para a obra piloto começa em **065** (seed na migration, porque já existem 64 pedidos feitos fora do app). Qualquer obra nova cadastrada no futuro começa em 001.

## 3. Modelo de dados

```sql
fornecedores
  id, nome, contato, cnpj (opcional), ativo, criado_em, criado_por

pedidos_compra
  id, obra_id,
  numero INTEGER NOT NULL,               -- sequencial por obra_id, exibido com 3 dígitos
  status status_pedido_compra NOT NULL DEFAULT 'rascunho',
  descricao TEXT,                        -- ex: "Lista de material - fundação Sobrado 04"
  motivo_cancelamento TEXT,               -- preenchido só se status = cancelado
  aprovado_por, aprovado_em,
  criado_por, criado_em
  UNIQUE (obra_id, numero)

pedidos_compra_itens
  id, pedido_id,
  servico_id UUID REFERENCES servicos (NULLABLE — nulo = "a classificar"),
  descricao_item TEXT NOT NULL,
  quantidade_pedida NUMERIC(14,4) NOT NULL,
  und TEXT,
  data_necessaria DATE,
  urgente BOOLEAN NOT NULL DEFAULT false,
  cotacao_item_vencedora_id UUID REFERENCES cotacoes_itens (NULLABLE),
  quantidade_recebida NUMERIC(14,4) NOT NULL DEFAULT 0,
  valor_recebido NUMERIC(14,2)

cotacoes
  id, pedido_id, fornecedor_id,
  condicao_pagamento TEXT,
  prazo_entrega_dias INTEGER,
  anexo_url TEXT NOT NULL,               -- bucket cotacoes-nf
  criado_por, criado_em

cotacoes_itens
  id, cotacao_id,
  pedido_item_id UUID REFERENCES pedidos_compra_itens,
  preco_unitario NUMERIC(14,4) NOT NULL

recebimentos_nf
  id, pedido_id,
  anexo_nf_url TEXT NOT NULL,            -- bucket cotacoes-nf
  observacao TEXT,
  criado_por, criado_em
  -- um pedido pode ter mais de uma NF (entrega parcial em notas separadas)
```

`status_pedido_compra`: `rascunho | em_cotacao | aprovado | enviado | recebido_parcial | recebido_total | conferido_nf | encerrado | cancelado`.

Trigger recalcula `recebido_parcial`/`recebido_total` sempre que `quantidade_recebida` de algum item muda, comparando com `quantidade_pedida` de todos os itens do pedido.

## 4. Telas

1. **Lista de Pedidos** (`/compras`) — filtros por status e urgência (destaque visual pra itens urgentes pendentes), unidade. Botão "Novo pedido".
2. **Novo Pedido / Detalhe** — cabeçalho (descrição, obra) + itens editáveis: autocomplete de insumo contra o orçamento (mostra código + nome sugerido), quantidade, unidade (auto-preenchida quando vinculado), data necessária, checkbox urgente. Item sem vínculo mostra badge "a classificar".
3. **Cotações do Pedido** — por fornecedor: formulário (fornecedor, condição de pagamento, prazo, anexo obrigatório) + preço unitário por item. Tabela comparativa fornecedor × item × preço, botão "marcar vencedor" por item (só admin).
4. **Aprovação** — admin revisa vencedores por item e aprova o pedido. Itens sem vencedor bloqueiam a aprovação.
5. **Recebimento** — lançamento de quantidade recebida por item + anexo de NF (múltiplas NFs por pedido). Status recalculado automaticamente; divergência de quantidade/valor sinalizada.
6. **Fornecedores** — cadastro simples (nome, contato, CNPJ opcional) e lista.
7. **Usuários** — checkbox `compras` na tela de permissões (padrão já existente, `modulo_app` enum).

## 5. RLS

Padrão idêntico ao já usado em Pendências/FVS (`meu_papel()`, `meus_modulos()`):

```sql
CREATE OR REPLACE FUNCTION pode_editar_compras()
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT meu_papel() = 'admin'
    OR (meu_papel() = 'equipe' AND 'compras' = ANY(meus_modulos()))
$$;
```

- **Leitura:** admin e equipe. Cliente **não** vê Compras (não está entre os módulos do papel `cliente`, CLAUDE.md §2).
- **Criar pedido / itens / cotações / recebimento:** `pode_editar_compras()`.
- **Marcar vencedor por item, aprovar, cancelar:** só `meu_papel() = 'admin'`.
- **Fornecedores:** leitura admin+equipe; escrita `pode_editar_compras()`.
- Bucket de storage `cotacoes-nf` (anexos de cotação e de NF), privado — mesmo padrão do bucket `pendencias`.
- `ALTER TYPE modulo_app ADD VALUE 'compras'`.

## 6. Fluxo de status

```
rascunho ──► em_cotacao ──► aprovado ──► enviado ──► recebido_parcial ──► recebido_total ──► conferido_nf ──► encerrado
                                                  └──► recebido_total direto (se tudo vier de uma vez)

(qualquer status antes de "encerrado") ──► cancelado  (motivo obrigatório)
```

- `rascunho → em_cotacao`: automático ao registrar a 1ª cotação.
- `em_cotacao → aprovado`: admin aprova; exige vencedor definido em todos os itens.
- `aprovado → enviado`: manual (admin ou equipe).
- `enviado → recebido_parcial/total`: automático via trigger, a cada lançamento de recebimento.
- `recebido_total → conferido_nf`: manual, ao anexar NF(s) e confirmar valores.
- `conferido_nf → encerrado`: manual (admin).
- `cancelado`: admin, motivo obrigatório, bloqueado após "encerrado".

## 7. Fora de escopo desta spec

- Almoxarifado (entrada/saída de estoque, empréstimo de ferramentas) — spec separada, próxima.
- Conferência tripla automática (cotação × recebimento no almoxarifado × NF) — depende do Almoxarifado existir; nesta fase a conferência de NF é manual, item a item, sem baixa de estoque.
- Alertas automáticos (pedido urgente parado há X dias, prazo estourado) — fica para a Fase 7 "Alertas", já planejada para isso.

## 8. Definição de pronto

Segue o checklist padrão do CLAUDE.md §8: funciona em celular e desktop, permissões dos 3 papéis testadas, rastreabilidade (autor + data + vínculo) em todos os registros, migração versionada, dados de teste removidos, Rodrigo testou com pedido real da obra piloto e deu aceite.
