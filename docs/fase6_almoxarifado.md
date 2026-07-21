# Fase 6 — Suprimentos: Almoxarifado

> Segunda metade da Fase 6 (CLAUDE.md §5), completa o grupo Suprimentos iniciado pela Fase 6 — Compras (`docs/fase6_compras.md`). Entregue em 11/07/2026, aguardando teste de campo com movimentos reais e aceite do Rodrigo — ver CLAUDE.md §0 e §7.

## O que foi entregue

- **Tela `/almoxarifado` com 3 abas:**
  - **Estoque** — lista de materiais com código, nome, categoria (`material` | `epi` | `escritorio`), saldo e destaque visual quando saldo < estoque mínimo cadastrado; filtro por categoria e busca por código/nome. Clique no material abre o extrato de movimentações (tipo, quantidade, pedido/requisição vinculados, unidade de destino, autor, data). Botões de Entrada, Saída avulsa e Lançar requisição.
  - **Ferramentas** — lista com estado disponível / emprestada / **em atraso** (destaque visual), cadastro de ferramenta, Emprestar (quem levou + unidade opcional) e Devolver em 1 clique. Histórico de empréstimos por ferramenta. Atraso: empréstimo não devolvido até o fim do dia da retirada fica em atraso a partir do dia seguinte, calculado com data local (fuso corrigido na revisão da Task 7 — usa `dataLocalISO`/`dataHoje`, não UTC).
  - **Requisições** — gerar bloco de requisições em PDF pré-numerado (reserva a faixa via RPC `gerar_bloco_requisicoes`), lista de blocos já gerados com re-download. PDF replica o layout físico atual da obra (nº, data, linhas de item, assinaturas do mestre de obras e do engenheiro).
- **Entrada de material:** autocomplete de material (cria novo na hora com código automático via RPC `proximo_codigo_material`), quantidade, data, vínculo opcional a um item de pedido de compra aprovado/enviado — a entrada alimenta `pedidos_compra_itens.quantidade_recebida` por trigger, substituindo o recebimento manual que existia em Compras.
- **Saída avulsa:** material, quantidade (bloqueada acima do saldo por trigger), unidade de destino e quem retirou (obrigatórios), nº de requisição e tarefa opcionais, aplicação em texto livre.
- **Lançar requisição preenchida:** nº da folha (transcrito do papel) + unidade de destino + quem retirou + lista de itens (autocomplete + quantidade + aplicação) — gera uma saída de estoque por item, todas com o mesmo nº de requisição.
- **Dashboard:** banner "N ferramenta(s) não devolvida(s)" (nomes + há quantos dias), clicável para `/almoxarifado`, oculto para o papel `cliente` e para quem não tem o módulo `almoxarifado`.
- **Conferência tripla no pedido de compra (`CompraForm.tsx`):** painel comparando quantidade/valor aprovado na cotação × soma independente das entradas no almoxarifado (query direta em `estoque_movimentos`, não o campo `quantidade_recebida` derivado por trigger — decisão da revisão da Task 8, para que a conferência compare fontes de dado realmente distintas) × valor da NF quando informado. Divergência em qualquer ponta ganha destaque visual (`#fdeaea`) e mensagem específica. Visível apenas nos status `recebido_parcial | recebido_total | conferido_nf | encerrado`, oculto para o papel `cliente`.

## Cargas iniciais (seed)

- **152 materiais** COD001–COD161 do catálogo real da obra, categoria `material`, saldo zero.
- **46 EPIs** (COD162 em diante) do CSV de controle, com **saldo atual do CSV já carregado** como inventário inicial e estoque mínimo quando informado ("nível para nova encomenda").
- **118 ferramentas individuais** numeradas a partir do levantamento de equipamentos (ex. Enxada 01–07, Andaime 01–30, Betoneira 01–02).
- Sequência de requisições da obra piloto começa em **00401** (bloco impresso físico vai até 00400). Um bloco real 00401–00402 já foi consumido em produção durante testes automatizados das tasks anteriores — o Rodrigo já sabe e autorizou seguir a numeração normalmente a partir de 00403.

## Decisões

- **Recebimento unificado:** a entrada no Almoxarifado é o único ponto que atualiza `quantidade_recebida` do pedido de compra — a tela de recebimento manual de Compras foi substituída por um link direto para o Almoxarifado, evitando lançamento duplo (ver `docs/fase6_compras.md`).
- **Conferência tripla usa soma independente do almoxarifado**, não o campo já sincronizado por trigger — para não mascarar um cenário em que o trigger falhe ou fique defasado (registrado no relatório da Task 8).
- **NF sem valor por item:** o app hoje só grava anexo + observação por pedido, não quantidade/valor por item de NF. Por regra do projeto (CLAUDE.md §6.3 — nunca inventar valor), a coluna NF do painel mostra "NF anexada — valor por item não informado" quando não há esse dado, em vez de simular um número. Se o campo `valor_recebido` for preenchido no futuro (tela nova, fora deste plano), o painel já compara e sinaliza.
- **Categorias no mesmo estoque:** material, EPI e escritório compartilham a mesma tabela e os mesmos fluxos de entrada/saída/requisição, diferenciados só pelo filtro de categoria.
- **Assinatura digital de requisição:** fora de escopo — o fluxo é papel (a estrutura de dados fica pronta para digitalizar depois, se decidido).

## Onde estão as regras de negócio

- Banco: `supabase/migrations/20260711_fase6_almoxarifado.sql` (tabelas, RLS, RPCs, triggers de saldo/saída/entrada com pedido), `20260711_fase6_almoxarifado_fix.sql` (trigger de sincronização do recebimento), `20260711_fase6_almoxarifado_view_rls.sql` (`security_invoker=true` na view `estoque_saldos`, correção pós-revisão da Task 3).
- Seed: `20260711_fase6_almoxarifado_seed.sql`.
- Inventário de materiais: `20260717164000_importacao_estoque_julho.sql` — 148 saldos da coluna SALDO da planilha de julho/2026, total 11.164 unidades, aplicado em produção em 17/07/2026 como ajuste de diferença com conferência transacional.
- Frontend: `src/pages/Almoxarifado.tsx` (+ `.module.css`), helpers de data/atraso compartilhados com o Dashboard em `src/lib/almoxarifado.ts`, painel de conferência tripla em `src/pages/CompraForm.tsx`, banner em `src/pages/Dashboard.tsx`.
- Desenho completo e decisões tomadas com o Rodrigo: `docs/superpowers/specs/2026-07-11-fase6-almoxarifado-design.md`.

## Roteiro de teste guiado (Rodrigo)

1. Abrir `/almoxarifado` (celular e desktop) → aba **Estoque**: confirmar os saldos reais dos materiais importados em 17/07/2026 e os EPIs. Conferir por amostragem COD029 = 5, COD034 = 4, COD153 = 1.900 e COD154 = 1.900; testar o filtro por categoria e a busca por código/nome.
2. Clicar num material com movimento (se já houver) para ver o extrato; senão, seguir para o passo 3.
3. Lançar uma **entrada** vinculada a um pedido de compra real (se houver algum aprovado/enviado) — confirmar que o saldo do material sobe e que, ao abrir o pedido em Compras, `quantidade_recebida` do item também subiu.
4. Lançar uma **saída avulsa** de um material com saldo (ex. um EPI) e confirmar o saldo descontado e o registro no extrato com autor/data.
5. Ir à aba **Requisições** → gerar um **bloco pequeno** (ex. 2 números) e abrir o PDF gerado — confirmar visualmente o layout (numeração, campos, linhas de assinatura). Depois, na mesma aba, **lançar uma folha preenchida** (simulando o papel já assinado) com 2–3 itens e confirmar que cada item gerou uma saída de estoque com o mesmo nº de requisição.
6. Ir à aba **Ferramentas**: emprestar uma ferramenta (informar quem levou) e depois devolvê-la — confirmar que o estado muda corretamente nos dois passos.
7. Simular um empréstimo em atraso: pedir para eu (ou o almoxarife) rodar uma retirada com data de ontem sem devolver, ver o **banner no Dashboard** aparecer com o nome da ferramenta e "há 1 dia", depois devolver e confirmar que o banner desaparece.
8. Se houver algum pedido de compra em `recebido_parcial` ou mais avançado, abrir seu detalhe em Compras e conferir o **painel de conferência tripla** (aprovado × almoxarifado × NF) — sem pedido nessa fase ainda, este passo fica pendente do primeiro pedido real que avançar o suficiente.

## Lacunas

- **Saldo dos 152 materiais de obra (COD001–COD161) está zerado.** Aguardando o Rodrigo enviar a aba do controle de junho/2026 com as quantidades reais para carregar como inventário inicial (movimento próprio, com autor e data registrados) — [lacuna], não resolvida nesta fase. Os EPIs já têm saldo real porque vieram com saldo no CSV de origem.
- **Estoque mínimo** só existe para os poucos EPIs que já tinham "nível para nova encomenda" na planilha de origem; os demais materiais ficam sem destaque de reposição até o Rodrigo informar um mínimo por item.
- **Conferência tripla ainda não foi validada com um pedido real** — nenhum pedido do Rodrigo chegou a `recebido_parcial` ou além até a entrega desta task; testado apenas com dados sintéticos inseridos e removidos via SQL (ver relatório da Task 8).

## Débitos conhecidos (não são bugs a corrigir agora)

- **View `estoque_saldos` sem `obra_id`:** hoje só existe uma obra ativa, então não há ambiguidade — se uma segunda obra entrar no app, a view precisa ser revisada para filtrar por obra.
- **NF só a nível de pedido, não por item:** ver decisão acima sobre `valor_recebido`.
- **Aviso visual de divergência na conferência tripla usa tolerância zero:** durante um recebimento parcial em andamento (pedido ainda recebendo por partes), a diferença entre aprovado e recebido no almoxarifado é esperada e normal, não uma divergência real — o aviso aparece do mesmo jeito porque o painel não distingue "ainda recebendo" de "divergência real". Avaliar se vale a pena diferenciar isso numa fase futura.
- **Estoque mínimo vazio na maioria dos materiais** (ver Lacunas acima).

## Verificações realizadas (tasks 1–8)

- Typecheck limpo (`npx tsc --noEmit -p tsconfig.json`) ao final de cada task e novamente nesta.
- Mobile e desktop testados no preview durante as tasks 3, 5, 6, 7 e 8 (resize do viewport).
- RLS: policies exigem `criado_por = auth.uid()` nos inserts (corrigido na revisão da Task 1); leitura restrita a `admin`/`equipe` com o módulo `almoxarifado` — papel `cliente` não vê o módulo (verificado no banner do Dashboard e no painel de conferência tripla, ambos ocultos para `cliente`).
- Rastreabilidade: todo registro de `estoque_movimentos`, `ferramenta_emprestimos` e `requisicoes_blocos` grava `criado_por` e `criado_em`; devolução de ferramenta grava `devolvida_recebida_por` e `devolvida_em`; nenhum UPDATE após devolução (histórico imutável).
- Dados de teste inseridos durante a verificação das Tasks 7 e 8 (empréstimos, cadeia de pedido/cotação/NF sintética) foram removidos via SQL após a confirmação visual — sem alteração de dados reais do Rodrigo.

## Ajustes pós-entrega (12/07/2026, uso real pelo Rodrigo)

- **PDF de requisição:** 7 → **10 linhas de itens por ficha** (cabe 2 pedidos por folha impressa) e assinatura "MESTRE DE OBRAS" renomeada para **"MESTRE DE OBRAS / ENCARREGADO"**, centralizada sob a linha (a de "ENGENHEIRO RESPONSÁVEL" também passou a centralizar).
- **Esclarecimentos de uso** (dúvidas reais do Rodrigo testando):
  - A Entrada só oferece vínculo com pedidos `aprovado|enviado|recebido_parcial` — um pedido em `rascunho` (sem cotação lançada) não aparece na lista até avançar no fluxo de Compras.
  - Saída avulsa (1 item, sem folha) e Lançar requisição (N itens, transcrição de folha assinada) são o mesmo tipo de movimento por dentro; a diferença é só o volume/origem do lançamento.
  - Unidade destino e quem retirou são obrigatórios em toda saída — o sistema bloqueia com mensagem clara ("Selecione a unidade de destino.") antes de gravar, nunca falha silenciosamente. Usar a unidade "Canteiro de Obras" para retiradas sem sobrado específico.

## Ajustes de 14/07/2026 — lançamento em lote + edição de entrada

- **Entrada de material em lote:** a tela "+ Entrada de material" agora aceita vários insumos
  de uma vez (mesmo padrão "+ Adicionar item" já usado em Contratos/Compras). Fornecedor, Nº da
  NF e Pedido de compra ficam no topo, compartilhados; cada insumo tem seu próprio material,
  quantidade, item do pedido (se um pedido foi selecionado) e observação. Um único `INSERT` com
  várias linhas — atômico (tudo ou nada), sem risco de lançamento parcial.
- **Editar entrada (admin):** no extrato do material, ao lado do "Inativar" já existente, um
  novo botão "Editar" (só admin, só entradas ativas) corrige material, quantidade, fornecedor e
  NF sem precisar inativar e relançar. Não edita o vínculo com pedido de compra. Grava
  `editado_por`/`editado_em`, exibido no extrato como "Corrigido em ...".
- **Correção de trigger:** `sincroniza_recebimento_pedido()` só reagia à inativação de um
  movimento; agora reage também a mudança de quantidade e de vínculo com pedido, revertendo o
  efeito antigo e aplicando o novo — sem isso, editar a quantidade de uma entrada vinculada a
  pedido deixaria `quantidade_recebida` desatualizado.

## Ajuste de 21/07/2026 — aluguel de ferramentas

- **Nova aba "Aluguéis" no Almoxarifado:** controla ferramentas locadas por obra, separadas das
  ferramentas próprias emprestadas aos funcionários.
- **Campos registrados:** ferramenta/equipamento alugado, locadora, modalidade (`diária`,
  `semanal` ou `mensal`), data de chegada na obra, data de entrega prevista, observação,
  autor/data de cadastro e entrega real quando baixada.
- **Alertas visuais:** a lista destaca locações vencidas, vencendo hoje e vencendo amanhã
  (alerta com 1 dia de antecedência). A ação "Registrar entrega" baixa a locação sem apagar o
  histórico.
- **Banco:** migração `20260721_ferramenta_locacoes.sql`, com tabela própria
  `ferramenta_locacoes`, enum `modalidade_locacao_ferramenta`, RLS por módulo `almoxarifado`
  e isolamento por obra.

## Fora de escopo (registrado na spec, não entregue nesta fase)

- Assinatura digital na requisição.
- Notificações push/e-mail de atraso ou reposição (Fase 7 — Alertas); aqui o alerta é só visual no app.
- Custo/valorização de estoque (preço médio etc.).
- Transferência entre obras.
