# Fase 6 — Suprimentos: Almoxarifado (design)

> Segunda metade da Fase 6 (CLAUDE.md §5). Completa o grupo Suprimentos iniciado pela spec de Compras (`2026-07-10-fase6-compras-design.md`) e fecha a integração nº 6 do CLAUDE.md (conferência tripla cotação × recebimento × NF).
> Desenho aprovado pelo Rodrigo em 11/07/2026, após análise dos arquivos reais do almoxarifado da obra (catálogo de códigos, controle de EPIs, levantamento de ferramentas e bloco de requisições impressas 00264–00400).

## 1. Objetivo

Controle físico do canteiro: estoque de materiais com saldo (entradas amarradas ao pedido de compra, saídas amarradas à hierarquia da obra via requisição), empréstimo de ferramentas com devolução diária e alerta de não devolvida, e geração dos blocos de requisição em PDF que a equipe preenche e assina em papel — espelhando o método que a obra já usa.

## 2. Decisões (perguntas respondidas com o Rodrigo)

- **Entrada única no Almoxarifado:** o almoxarife lança a entrada apontando (opcionalmente) o pedido de compra e o item; isso atualiza sozinho `quantidade_recebida` do item do pedido — o status recebido parcial/total recalcula pelo trigger já existente de Compras. A tela de recebimento de Compras passa a apontar para o Almoxarifado (sem lançamento duplo). Entrada sem pedido continua possível (inventário inicial, doação, compra de balcão).
- **Saldo por material:** cadastro de materiais (nasce na primeira entrada ou do seed), entrada soma / saída subtrai, saída maior que o saldo é **bloqueada**.
- **Saída:** unidade de destino + quem retirou são obrigatórios; tarefa/serviço do cronograma é opcional. Aplicação (texto) por item.
- **Ferramentas individuais:** cada ferramenta é um item próprio (Enxada 01, Andaime 07, Betoneira 02…), com estado disponível/emprestada.
- **Devolução diária:** empréstimo não devolvido até o fim do dia da retirada fica **em atraso** a partir do dia seguinte. Alerta: banner no dashboard (padrão do banner de RDO não assinado) + destaque na tela do módulo.
- **Requisições — papel primeiro (fluxo real da obra):**
  1. O app **gera blocos de requisição em PDF** pré-numerados para imprimir (ex.: "gerar 100" → reserva 00401–00500). Layout fiel ao modelo atual: nº, data, 7 linhas de itens (descrição / código do produto / quantidade / aplicação), autorização obrigatória com linhas de assinatura do mestre de obras e do engenheiro responsável; empresa e obra vêm do cadastro. Cada bloco gerado é registrado (quem, quando, faixa de números) e o PDF pode ser baixado de novo.
  2. Preenchimento e assinaturas acontecem **no papel**, na obra.
  3. O almoxarife **lança a retirada** no app transcrevendo a folha: nº da requisição + unidade de destino + quem retirou + itens (autocomplete por código/nome + quantidade + aplicação). Cada item lançado vira uma saída de estoque vinculada ao nº da requisição.
  - Assinatura digital de requisição: **fora de escopo** (modelo é papel; estrutura fica pronta para digitalizar no futuro).
- **Numeração das requisições:** sequencial por obra; obra piloto continua do bloco impresso — primeira digital é **00401**. Obra nova começa em 00001. Exibição com 5 dígitos.
- **Categorias de estoque:** estoque único com campo categoria — `material` | `epi` | `escritorio` — filtro na tela; mesmos fluxos de entrada/saída/requisição para todas.
- **Estoque mínimo:** campo opcional por material ("nível para nova encomenda" da planilha de EPIs); saldo abaixo do mínimo gera destaque de reposição na tela de estoque.
- **Códigos de material:** preserva os códigos existentes COD001–COD161; material novo recebe código sequencial automático (COD162, COD163…).
- **Movimento lançado errado:** admin inativa (soft delete); saldo recalcula; histórico preservado (CLAUDE.md §6).

## 3. Cargas iniciais (seed, dos arquivos reais de 11/07/2026)

- **152 materiais** COD001–COD161 (código, nome, unidade Kg/Unidade, observação de conversão quando existir — ex.: conduíte rolo 25 m = 1 unid) — categoria `material`, saldo zero até o inventário.
- **EPIs** do CSV de controle (nome + variação/tamanho na descrição), com **saldo atual do CSV** carregado como inventário inicial e estoque mínimo quando informado — categoria `epi`. Códigos novos na sequência.
- **~110 ferramentas individuais** numeradas a partir do levantamento de equipamentos (7 enxadas → Enxada 01–07; 30 andaimes → Andaime 01–30; 2 betoneiras, 2 vibradores etc.).
- **Saldo inicial dos materiais COD001–161:** [lacuna] Rodrigo vai enviar a aba do controle de junho/2026 com as quantidades — será carregada como inventário inicial em movimento próprio, autor e data registrados. Até lá os materiais ficam com saldo zero.

## 4. Modelo de dados

```sql
materiais
  id, obra_id,
  codigo TEXT NOT NULL,            -- COD001…; novo = próximo da sequência
  nome TEXT NOT NULL,
  descricao TEXT,                  -- variação/tamanho (EPIs) ou observação de conversão
  und TEXT NOT NULL DEFAULT 'un',
  categoria categoria_material NOT NULL DEFAULT 'material',  -- material | epi | escritorio
  estoque_minimo NUMERIC(14,4),    -- opcional; saldo < mínimo → destaque de reposição
  ativo, criado_por, criado_em
  UNIQUE (obra_id, codigo)

estoque_movimentos
  id, obra_id, material_id,
  tipo tipo_movimento NOT NULL,    -- entrada | saida
  quantidade NUMERIC(14,4) NOT NULL CHECK (quantidade > 0),
  -- entrada:
  pedido_item_id UUID REFERENCES pedidos_compra_itens (NULLABLE),
  -- saída:
  requisicao_numero INTEGER,       -- nº da folha de requisição preenchida (opcional)
  unidade_id UUID REFERENCES unidades (NULLABLE — obrigatória p/ saída, validada por trigger),
  retirado_por TEXT,               -- obrigatório p/ saída (validado por trigger)
  tarefa_id UUID REFERENCES cronograma_tarefas (NULLABLE),
  aplicacao TEXT,
  observacao TEXT,
  ativo, criado_por, criado_em

requisicoes_seq
  obra_id UUID PRIMARY KEY, ultimo_numero INTEGER NOT NULL
  -- seed obra piloto: 400 (bloco impresso vai até 00400); obra nova: 0

requisicoes_blocos                 -- registro de cada bloco de PDF gerado
  id, obra_id,
  numero_inicial INTEGER NOT NULL, numero_final INTEGER NOT NULL,
  criado_por, criado_em

ferramentas
  id, obra_id,
  nome TEXT NOT NULL,              -- "Enxada 03", "Betoneira 01"
  descricao TEXT,
  ativo, criado_por, criado_em

ferramenta_emprestimos
  id, ferramenta_id,
  retirado_por TEXT NOT NULL,
  unidade_id UUID REFERENCES unidades (NULLABLE),
  observacao TEXT,
  retirada_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  devolvida_em TIMESTAMPTZ,        -- NULL = emprestada
  devolvida_recebida_por UUID,     -- quem registrou a devolução
  criado_por, criado_em
```

Regras de banco:
- **Saldo** = função `saldo_material(material_id)` (soma entradas − saídas dos movimentos ativos). Tela de estoque usa view agregada.
- **Trigger de saída:** valida `unidade_id` e `retirado_por` obrigatórios e **bloqueia saída > saldo**.
- **Trigger de entrada com pedido:** `pedido_item_id` preenchido → soma em `pedidos_compra_itens.quantidade_recebida` (dispara o recálculo de status já existente). Inativação do movimento reverte a soma.
- **Empréstimo:** ferramenta com empréstimo aberto (devolvida_em IS NULL) não pode receber novo empréstimo (constraint parcial/trigger). Atrasada = `retirada_em::date < hoje` e não devolvida.
- **Requisição:** RPC `gerar_bloco_requisicoes(p_qtd)` reserva a faixa na sequência e grava o bloco; o PDF é gerado no cliente (mesmo padrão dos PDFs de RDO/FVS/pedido).

## 5. Telas

1. **`/almoxarifado` — Estoque:** lista de materiais com código, nome, categoria, saldo e destaque de reposição (saldo < mínimo); filtros por categoria e busca; botões Entrada / Saída / Lançar requisição. Clique no material → extrato de movimentações (tipo, quantidade, pedido/requisição vinculados, destino, autor, data).
2. **Entrada:** material (autocomplete; cria novo na hora com código automático), quantidade, data, vínculo opcional a pedido de compra (select de pedidos aprovados/enviados → item), observação.
3. **Saída avulsa:** material, quantidade (≤ saldo), unidade destino, quem retirou, nº de requisição opcional, tarefa opcional, aplicação.
4. **Lançar requisição:** nº da folha + unidade destino + quem retirou + lista de itens (autocomplete + quantidade + aplicação) → gera uma saída por item, todas com o mesmo nº.
5. **Gerar bloco de requisições:** quantidade de folhas → PDF pré-numerado para impressão (2 requisições por página, layout do modelo atual, identidade RT); lista de blocos já gerados com re-download.
6. **Ferramentas:** lista com estado (disponível / emprestada / **em atraso** destacado), cadastro, botão Emprestar (quem levou, unidade opcional) e Devolver (1 clique). Histórico de empréstimos por ferramenta.
7. **Dashboard:** banner "N ferramenta(s) não devolvida(s)" (quem levou, há quantos dias) — padrão do banner de RDOs não assinados.
8. **Pedido de compra (Compras):** painel de **conferência tripla** por item — quantidade aprovada na cotação × soma das entradas no almoxarifado × quantidade/valor conferidos da NF; divergência em qualquer ponta ganha alerta visual. A seção de recebimento manual passa a orientar o lançamento pela entrada do Almoxarifado.
9. **Usuários:** checkbox `almoxarifado` (novo valor no enum `modulo_app`, se ainda não existir).

## 6. RLS

Padrão do projeto (`meu_papel()`, `meus_modulos()`):

```sql
pode_editar_almoxarifado() = admin OR (equipe AND 'almoxarifado' = ANY(meus_modulos()))
```

- **Leitura:** admin e equipe. **Cliente não vê** o módulo.
- **Escrita** (materiais, movimentos, ferramentas, empréstimos, blocos): `pode_editar_almoxarifado()`.
- **Inativar movimento:** só admin.
- Histórico de empréstimos: sem UPDATE após devolução (imutável).

## 7. Fora de escopo

- Assinatura digital na requisição (fluxo é papel; base fica pronta).
- Notificações push/e-mail de atraso ou reposição — Fase 7 (Alertas); aqui o alerta é visual no app.
- Custo/valorização do estoque (preço médio etc.) — o financeiro do material vem da Fase 3 pelo pedido/NF.
- Transferência entre obras (só existe uma obra ativa).

## 8. Definição de pronto

Checklist padrão CLAUDE.md §8: celular + desktop, permissões dos 3 papéis testadas, rastreabilidade em todos os registros, migração versionada, seeds das cargas iniciais versionados, Rodrigo testou com movimentos reais (incluindo gerar um bloco de requisições e lançar uma folha preenchida) e deu aceite.
