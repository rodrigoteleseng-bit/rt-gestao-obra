# AGENTS.md — App de Gestão de Obra | RT Engenharia

> Documento de regras do projeto. Este arquivo governa todo o desenvolvimento do aplicativo.
> Nenhuma implementação contraria o que está aqui sem aprovação explícita do Rodrigo.
>
> Legenda de dados: [extraído] = definido pelo Rodrigo · [estimado] = proposta técnica do Codex, base citada · [lacuna] = pendente de definição · [sugestão] = opcional, aguarda aprovação

---

## 0. Estado atual (ler primeiro)

- **Fix crítico de Storage (18/07/2026) — upload bloqueado em `rdo`/`fvs`/`pendencias`/`cotacoes-nf` para a obra piloto desde 17/07/2026.** Achado durante o teste de campo de Projetos: a policy `isolamento_obra_storage` (criada na auditoria de 17/07) valida o `obra_id` no path do arquivo com um regex que exige UUID versão 1-5 e variante RFC4122. O `obra_id` da obra piloto (`00000000-0000-0000-0000-000000000001`) foi seedado manualmente na Fase 0 e não tem esses nibbles — nunca bateu com esse regex. Qualquer upload novo para esses quatro buckets falhava silenciosamente com "new row violates row-level security policy" desde a criação da policy, sem que ninguém tivesse percebido (nenhuma foto de RDO com data de 18/07 no banco até a correção). Corrigido trocando o regex por um validador de formato UUID genérico, sem exigir versão/variante. Migração `20260718_storage_fix_regex_uuid.sql` (renomeada em 19/07/2026 — nome original `20260718_fix_regex_uuid_storage.sql` sortava antes de `20260718_projetos.sql` em ordem alfabética, então um reset completo do banco a partir das migrations locais reintroduziria o bug ao reaplicar `projetos.sql` por cima; produção nunca foi afetada porque as migrações foram aplicadas incrementalmente na ordem correta). **Se você usa RDO/FVS/Pendências no dia a dia, vale confirmar que o anexo de foto voltou a funcionar.**

- **Fase 0 (Fundação): concluída e aceita** — detalhes em `docs/fase0.md`. Adição posterior (09/07/2026): botão "Nova senha" em /usuarios (admin envia link de redefinição sem depender do usuário clicar "Esqueci minha senha").
- **Fase 1 (Orçamento): concluída e aceita** — detalhes em `docs/fase1.md`. Pendência transferida: exportação Excel/PDF.
- **Fase 2 (Cronograma + Avanço físico): concluída e aceita** (09/07/2026) — detalhes em `docs/fase2.md`. Inclui medição por quantidade (m, m², m³, unid.), carga automática de quantidades do orçamento (897 tarefas preenchidas).
- **Fase 4 (RDO): concluída e aceita** (09/07/2026, teste de campo positivo) — detalhes em `docs/fase4.md`. Inclui carimbo GPS nas fotos, áudio, ditado, assinatura digital, PDF com identidade RT, banner de RDOs não assinados, integração automática com Galeria.
- **Fase 5 (Qualidade — Pendências + FVS): concluída e aceita** (11/07/2026, validada com dados reais de obra; Rodrigo segue acompanhando em uso contínuo) — detalhes em `docs/fase5.md`. Ajustes finais no aceite: chapisco incorporado à FVS-004 (2 seções novas; FVS-008 passou a tê-lo como pré-requisito único), responsável nas pendências automáticas da FVS (campo na conclusão da verificação) e editável no detalhe da pendência, filtro por responsável na lista. Pendências: fluxo aberta → em correção → resolvida, fotos GPS, histórico imutável. FVS: 17 modelos seedados (renumerados p/ sequência da obra, pré-requisitos sempre primeiro) + 2 novos (Reboco, Forro), item NC gera pendência automática, rodadas de verificação com estado "Aguardando" (conferência por partes), assinatura digital na conclusão, PDF próprio, "Aprovada com restrição", mapa da qualidade, exclusão pelo admin, integração automática com RDO. Cliente não vê o módulo.
- **Fase 6 (Suprimentos — Compras): entregue em 10/07/2026, aguardando teste de campo com pedido real e aceite** — detalhes em `docs/fase6_compras.md`. Pedido com itens vinculados ao orçamento (autocomplete + campo Aplicação), numeração iniciando em 065, cotações por fornecedor com anexo obrigatório, comparação lado a lado, vencedor por item, aprovação (admin), envio, recebimento por item, conferência com NF, cancelamento/encerramento, PDF do pedido, importação de CSV de cotação (via skill `leitura-cotacao-fornecedor`). Em 11/07 Rodrigo iniciou o teste de campo com um pedido real.
- **Fase 6 (Suprimentos — Almoxarifado): entregue em 11/07/2026, aguardando teste de campo com movimentos reais e aceite** — detalhes em `docs/fase6_almoxarifado.md`. Completa a Fase 6. Estoque de materiais/EPIs/escritório com saldo, entrada vinculada a pedido de compra (substitui o recebimento manual de Compras — só habilitada para pedidos aprovado/enviado/recebido_parcial, por isso um pedido em rascunho não aparece pra vínculo), saída avulsa (retirada pontual sem folha) e lançamento de requisição (transcrição de folha física já preenchida/assinada, N itens vinculados ao mesmo nº de requisição), blocos de requisição em PDF pré-numerados (10 itens por ficha, assinatura "Mestre de Obras / Encarregado" centralizada, ajustado em 12/07/2026; sequência da obra piloto segue de 00403), ferramentas individuais com empréstimo/devolução e atraso calculado por dia, banner de ferramenta em atraso no Dashboard, conferência tripla (aprovado × almoxarifado × NF, soma independente de estoque_movimentos) no pedido de compra. Unidade destino e quem retirou são obrigatórios em toda saída (bloqueado com mensagem, não é silencioso) — usar "Canteiro de Obras" para retiradas genéricas sem sobrado específico. Inventário dos materiais atualizado em 17/07/2026: 148 códigos receberam o saldo-alvo da coluna SALDO da planilha de julho/2026 (total 11.164 unidades), por ajuste transacional que preserva o histórico; quatro códigos ausentes da planilha (COD032, COD079, COD144 e COD148) foram mantidos sem alteração. Migração `20260717164000_importacao_estoque_julho.sql`.
- **Fase 7 (Projetos) — entregue em 18/07/2026; evolução para pastas livres por obra também aplicada em produção no mesmo dia, aguardando teste de campo com pastas reais e aceite** — detalhes em `docs/fase7_projetos.md`. Repositório versionado de documentos da obra (`/projetos`), com revisão atual + histórico, upload PDF no bucket privado `projetos`, signed URL para abertura, cliente em leitura e escrita para admin/equipe com módulo `projetos`. Categorias fixas substituídas por `projetos_pastas` (nome único por obra, criação inline no cadastro de documento, renomear/inativar); os 2 documentos já existentes migraram automaticamente para a pasta "Projeto Executivo". Revisão prévia e pós-commit do Claude Code concluídas para as duas versões (categorias e pastas).
- **Fase 7 (Extras) — parcial:** Galeria de Fotos implementada (09/07/2026); Gestão de Efetivo entregue em 12/07/2026 (fix crítico de RLS em 13/07 — ver abaixo), com botão **Editar trabalhador** acrescentado em 13/07/2026 (corrige nome/função/empresa/data de admissão digitados errado sem inativar e recriar); aguardando teste de campo com trabalhadores reais e aceite — detalhes em `docs/fase7_efetivo.md`. Cadastro nominal de trabalhadores, chamada diária de presença, RDO em rascunho passa a ler a chamada automaticamente (RDO assinado nunca lê a chamada; ao assinar, o efetivo da chamada é materializado em `rdo_efetivo`). **Definições de Projeto** (`/definicoes`) entregue em 13/07/2026 — decisões pendentes do cliente/proprietário (cor, modelo, acabamento) com prazo, responsável e status pendente/resolvida; **cliente vê a lista em modo leitura** (exceção à regra geral — é a única tela hoje com essa exceção deliberada), admin/equipe com módulo `definicoes` cria/edita/resolve; card próprio no Dashboard. Demais extras da Fase 7 (Alertas, Planejamento lookahead/PPC) pendentes — ver decisões do Rodrigo sobre a análise do FlowPlanner em memória.
- **Contratos (`/contratos`, `/empreiteiros`) — entregue em 13/07/2026, aguardando teste de campo com um contrato real e aceite** — detalhes em `docs/fase7_contratos.md`. Cadastro de empreiteiros; contrato com itens (serviço do orçamento × unidade, quantidade e valor negociados), numeração `CT-001...` por obra; fluxo rascunho → ativo → encerrado exclusivo do admin, em ordem única; itens imutáveis fora do rascunho (travado na tela e no RLS, sem exceção pra admin); `valor_total` sempre derivado da soma dos itens por trigger. Base para o futuro módulo de Medições — spec/plano em `docs/superpowers/specs/2026-07-13-fase7-contratos-design.md` e `docs/superpowers/plans/2026-07-13-fase7-contratos.md`. Cliente não vê o módulo.
- **Medições (`/contratos/:id/medicoes`, `/medicoes`) — regime empreiteiros entregue em 14/07/2026, aguardando teste de campo com uma medição real e aceite** — detalhes em `docs/fase7_medicoes.md`. Lança quantidade executada por item de contrato ativo (aceita fração, ex.: 1,2), acumula saldo frente à quantidade contratada, calcula valor bruto/retido/líquido (primeiro uso real do campo retenção % do contrato), aprovação exclusiva do admin com trava de saldo no banco sem exceção. PDF com identidade RT. Implementado via subagent-driven-development (5 tasks, cada uma revisada antes de avançar); a revisão da Task 1 encontrou 3 lacunas próprias de RLS/trigger (reatribuição de item de medição aprovada, trava de saldo somando por linha em vez de por item, valores calculados graváveis direto) — todas fechadas no mesmo dia antes de construir a interface, em `supabase/migrations/20260713_fase7_medicoes_travas.sql`. Fora de escopo: lançamento financeiro real (Fase 3 não existe), anexo de comprovante assinado (adiado a pedido do Rodrigo), vínculo automático com Avanço Físico. Cliente não vê o módulo.
- **Medições — regime Produção própria (16/07/2026), segundo regime dentro do mesmo módulo `/medicoes`, aguardando teste de campo e aceite** — detalhes em `docs/fase7_producao_propria.md`. Cadastro de salário por trabalhador com vigência histórica e divisor fixo 30; produção diária de alvenaria/reboco por parede/face (comprimento × altura, descontando vãos), preço por m² congelado por lançamento, rateio igual entre N profissionais; dia salarial integral com motivo e bloqueio de conflito com produção na mesma data; medição `MP-001...` por profissional e período; aprovação exclusiva do admin, snapshots imutáveis, status paga e cancelamento auditável. Migração `20260716_fase7_producao_propria.sql` (9 tabelas `producao_%`, 21 policies, 15 funções). Fora do MVP: meio dia, rateio desigual, encargos/descontos, integração bancária/financeira, serviços além de alvenaria/reboco, vínculo automático com orçamento/avanço físico. Cliente não vê o módulo.
- **Tarefas (`/tarefas`) — entregue e aceita em 18/07/2026** — detalhes em `docs/fase7_tarefas.md`. Rodrigo testou em produção como admin, equipe com módulo `tarefas`, equipe sem o módulo e cliente, seguindo o roteiro de permissão/status/RLS das revisões obrigatórias; incluiu correção final de layout mobile nos campos Responsável/Prazo. Tarefas por obra com prazo obrigatório, responsável opcional, vínculo opcional à EAP (unidade/etapa/serviço), histórico de comentários/eventos, soft delete, contador no Dashboard, isolamento por obra via RLS restritiva, máquina de status em trigger e auditoria de conclusão/cancelamento forçada no servidor. Cliente não vê o módulo.
- **Dashboard reestruturado (09/07/2026, redesenhado visualmente em 12/07/2026):** RDO agrupa Galeria + Efetivo; card "Suprimentos" agrupa Compras + Almoxarifado; card "Qualidade" agrupa FVS + Pendências. Redesign de 12/07: card-herói (data, saudação, Prazo/Semana/Restam), 4 KPI-pílulas clicáveis (Efetivo/Pedidos/Pendências/Ferramenta em atraso), widget "RDO de hoje", card "Dados da Obra" (admin) e card "Definições de Projeto" fora dos grupos, nota "Em preparação" no rodapé.
- **Dados da Obra (`/dados-obra`) — entregue em 12/07/2026:** tela admin-only para editar nome/endereço/datas/status da obra e criar novas obras (o app não tinha nenhuma UI pra isso antes — dados só existiam via SQL direto). Ao salvar, o `ObraContext` recarrega automaticamente (função `recarregar()`) sem precisar de F5. Trocar a obra ativa continua sendo só pelo seletor no cabeçalho (`Layout.tsx`), que aparece sozinho quando há mais de uma obra.
- **Almoxarifado — dois acréscimos em 13/07/2026:** (1) botão "🖨️ Imprimir estoque" na aba Estoque, gera PDF por categoria (material/EPI/escritório) com código/nome/unidade/saldo, incluindo saldo zero; (2) campos opcionais **Fornecedor** e **Nº da NF** na "+ Entrada de material" (coexistem com o vínculo a pedido de compra), visíveis no extrato do material — prepara consulta futura de "em quais fornecedores já comprei esse material" e histórico de preço (preço em si ainda fora de escopo).
- **Almoxarifado — lançamento em lote + edição de entrada (14/07/2026):** "+ Entrada de material" agora aceita vários insumos de uma NF numa única tela (fornecedor/NF/pedido compartilhados, material+quantidade por insumo) — mesmo padrão de lista já usado em Contratos/Compras, com `INSERT` único atômico. Admin ganhou botão "Editar" no extrato do material (ao lado do "Inativar" já existente) pra corrigir quantidade/material/fornecedor/NF de uma entrada lançada errada, sem inativar e relançar — grava `editado_por`/`editado_em`. Corrigido também um gap técnico: o trigger que soma `quantidade_recebida` no pedido de compra só reagia à inativação; agora reage também a mudança de quantidade/vínculo, senão uma correção deixaria esse número desatualizado.
- **Fix crítico de RLS (13/07/2026) — soft delete silenciosamente bloqueado em 7 tabelas.** Causa raiz: quando a política de SELECT de uma tabela exige `ativo = true`, o Postgres exige que a linha, **depois** de um UPDATE, ainda satisfaça essa mesma política — mesmo que a política de UPDATE não mencione `ativo`. Inativar um registro (`true → false`) faz a linha deixar de bater com `ativo = true`, e o Postgres barra o UPDATE com "new row violates row-level security policy", **mesmo para admin**. Sintoma: apagar foto/serviço/áudio/efetivo no RDO (e item de pedido, trabalhador, foto de FVS) parecia funcionar na tela mas voltava ao reabrir — o app não checava o erro do `update`. Corrigido em `rdo_atividades`, `rdo_fotos`, `rdo_audios`, `rdo_efetivo`, `pedidos_compra_itens`, `trabalhadores`, `fvs_fotos`: a política de SELECT passou a permitir ver a linha inativa quando o usuário pode editar aquele módulo (`ativo = true OR pode_editar_X()`). **Regra pra qualquer tabela nova com soft delete:** a política de SELECT precisa dessa cláusula OR desde o início, senão o mesmo bug se repete.
- **Paleta corrigida para o manual de marca oficial (10/07/2026)** — navy `#1A3248`, terracota `#C49A7A` (era um tom improvisado desde a Fase 0). Ver §1 e `docs/fase0.md`.
- **Reset de dados de teste (10/07/2026):** a pedido do Rodrigo, FVS/Pendências/RDO/Avanços físicos/Galeria foram apagados definitivamente para começar o lançamento real (17 modelos de FVS, cronograma e orçamento preservados). Detalhes em `docs/fase5.md`.
- **RDO — fotos no mobile (16/07/2026):** carregamento de fotos em lotes (evita estourar memória do celular) e exibição de uma foto por vez no visualizador mobile.
- **Auditoria geral de segurança e UX: concluída e aceita em 17/07/2026** — relatório final em `docs/auditoria-geral-2026-07-17.md`. Foram corrigidos e validados em produção: leitura anônima de 11 tabelas; execução anônima e `search_path` de funções privilegiadas; cabeçalhos HTTP; tela branca pós-deploy do PWA; limites e MIME types dos quatro buckets; responsividade mobile; falhas de gravação ocultadas; code-splitting por rota (download inicial comprimido reduzido em ~60%); tabelas mobile; diálogos de confirmação; atomicidade de FVS/Pendências/Compras/Contratos/Medições; e isolamento usuário × obra em 52 tabelas e quatro buckets. Permissões foram testadas com perfis reais de equipe e uma conta temporária real de cliente, removida após o teste. Rodrigo aprovou a validação visual no celular. Não restam achados abertos.
- **Próxima etapa:** seguir `docs/sequencia-trabalho-codex-claude.md`: fechar os aceites formais com dados reais da Fase 6 completa (Compras + Almoxarifado), Gestão de Efetivo/Definições de Projeto, Contratos e Medições (empreiteiros e produção própria); completar os dados operacionais pendentes; então planejar o Financeiro (Fase 3) com análise arquitetural prévia do Claude Code e implementação pelo Codex após aprovação do Rodrigo. Módulos aprovados mas ainda não construídos: Planejamento lookahead/PPC e Alertas. Pedido do Rodrigo em 13/07/2026 de anexar contrato assinado (PDF/foto) foi adiado — ver `docs/superpowers/specs/2026-07-13-fase7-medicoes-design.md` §9.
- Ao iniciar qualquer fase, ler `docs/faseN.md` das fases anteriores relevantes em vez de redescobrir o código.

## 1. Contexto do negócio

- **Empresa:** RT Engenharia — Rodrigo Teles Silva, engenheiro civil, CREA 1018712895 D/GO, Goiânia/GO. [extraído]
- **Atuação:** administração de obras, empreitada global, projetos e reformas, com controle de qualidade, cronograma físico-financeiro e compras. [extraído]
- **Obra piloto do app:** incorporação com **13 sobrados + portaria + área comum** (referência: Tharsos Imperial – Sobrado Tipo, Aparecida de Goiânia). [extraído]
- **Orçamento base:** existe levantamento de quantitativos em planilha Excel multi-abas já elaborado. A Fase 1 é de **importação e estruturação**, não de criação do zero. [extraído]
- **Identidade visual:** paleta navy `#1A3248` + terracota `#C49A7A` (nude), acento azul-médio `#3A7CA5`, suporte azul-gelo `#B8D4E8`, fundo nude `#F0EBE3`; tipografia Sora (títulos) / Inter (corpo); tagline "Inteligência Aplicada". Fonte de verdade: skill `rt-manual-marca` (instalada) — **sempre consultá-la antes de estimar cor/tom novo**, nunca inventar um hex. Aplicar em todo o app e nos PDFs exportados (RDO, FVS, relatórios). [extraído — corrigido em 10/07/2026, ver `docs/fase0.md`]

## 2. Usuários e permissões

| Papel | Quem é | Permissão |
|---|---|---|
| `admin` | Rodrigo | Total: configura obra, orçamento, usuários, edita e exclui tudo |
| `equipe` | 2 a 5 colaboradores de campo/escritório | Lança RDO, avanço, financeiro, almoxarifado, pendências. Não altera orçamento base nem cronograma aprovado |
| `cliente` | Clientes/investidores | **Somente leitura** de dashboards, Curva S, avanço, RDO e galeria. **Vê valores em R$ e percentuais** [extraído — confirmado em 07/07/2026] |

[extraído] — os três papéis foram definidos pelo Rodrigo. Equipe atual (4 pessoas): Rodrigo (admin), Estagiário (RDO/avanço/pendências), Almoxarife (almoxarifado), Financeiro (compras/notas). Permissões por módulo via checkboxes na tela Usuários.

**Regra dura:** toda permissão é implementada com Row Level Security no banco (Supabase RLS), nunca só na interface.

## 3. Stack e arquitetura [extraído — aprovado pelo Rodrigo em 07/07/2026]

- **Backend/banco:** Supabase (Postgres + Auth + Storage + RLS).
- **Frontend:** aplicativo web responsivo **PWA** (instalável no celular, funciona em desktop). React + Vite. [estimado — padrão de mercado para PWA; alternativas serão apresentadas na Fase 0 se relevante]
- **Fotos:** Supabase Storage, organizadas por obra/unidade/data.
- **Georreferenciamento:** API de geolocalização do navegador, gravada em cada RDO (lat/long + precisão + timestamp).
- **Hospedagem do frontend:** Vercel (https://rt-gestao-obra.vercel.app), deploy automático no push para `main`. Domínio próprio: a definir. [extraído]
- **Migrações de banco:** versionadas no repositório (`/supabase/migrations`), nunca alteração manual direta em produção.
- **Regra de RLS pra soft delete (aprendida em 13/07/2026, ver §0):** toda tabela que usa `ativo = true` na política de SELECT e é inativada (`ativo = false`) por um UPDATE precisa que a política de SELECT seja `USING (ativo = true OR pode_editar_X())` — nunca só `USING (ativo = true)`. Sem isso, o Postgres bloqueia silenciosamente a inativação mesmo para admin (o app não vê erro se não checar `error` do `update`, então sempre checar). Aplicar essa cláusula em toda tabela nova que tiver um fluxo de "apagar/inativar".

## 4. Modelo de dados mestre

Hierarquia que **todos os módulos respeitam**. Nenhum módulo cria hierarquia paralela.

```
OBRA
 └── UNIDADE (Sobrado 01…13, Portaria, Área Comum, Canteiro)
      └── ETAPA (fases macro da EAP: fundação, estrutura, alvenaria, cobertura, instalações, acabamento…)
           └── SERVIÇO (item orçável: quantitativo + unidade + valor unitário)
```

- A EAP do app deriva da EAP/escopo já usados na metodologia RT Engenharia. [extraído]
- A estrutura exata de etapas e serviços da obra piloto vem da **planilha de orçamento do Rodrigo** — importada na Fase 1. [extraído]
- Todo lançamento (nota, avanço, RDO, pendência, movimentação de almoxarifado) referencia obrigatoriamente um nó dessa hierarquia — no mínimo até ETAPA; idealmente até SERVIÇO.

### Skills RT/Engenhar.IA instaladas — quando usar

Estas skills geram **documentos avulsos** (`.md`/`.xlsx`, fora do app) e não substituem os módulos do app — usar quando o Rodrigo pedir algo que o app ainda não faz, ou para uma obra nova antes de ela entrar no app. Pipeline em sequência, cada uma alimenta a próxima:

| Skill | Quando acionar |
|---|---|
| `diagnostico-obra` | Rodrigo anexa projetos (PDF/DWG) de uma obra nova e pede para extrair dados — gera 2 documentos (análise técnica + leitura de planejamento/orçamento) |
| `escopo-obra` | Definir o escopo técnico executivo de uma obra nova, serviço por serviço (sem quantitativo/preço) |
| `eap-obra` | Estruturar a EAP a partir do escopo — é a base que o app espera (Unidade → Etapa → Serviço) |
| `estrutura-orcamento-obra` | Estruturar orçamento (quantitativos + valores) a partir da EAP — antes de importar no módulo Orçamento |
| `cronograma-obra` | Gerar cronograma físico do zero (sem arquivo MS Project) — 2 fases: parâmetros/produtividade validados → planilha `.xlsx` |
| `rt-manual-marca` | Qualquer trabalho visual/PDF novo — cores, logo, tipografia (ver §1) |
| `rt-documentos-obra` | Documento avulso pontual: relatório de acompanhamento, proposta de empreitada, ata de reunião, diário de obra, pedido de compras — em Markdown |

Para a obra piloto (Tharsos Imperial), escopo/EAP/orçamento/cronograma já foram importados diretamente das planilhas/MS Project do Rodrigo (Fases 1 e 2) — essas skills entram em cena para **obras futuras** ou peças avulsas, não para retrabalhar o que já está importado.

## 5. Módulos e fases de desenvolvimento [extraído — plano aprovado]

Ordem aprovada. Cada fase só inicia após a anterior ser validada pelo Rodrigo em uso real.

| Fase | Módulo | Entrega principal |
|---|---|---|
| 0 | Fundação | Modelo de dados, cadastro da obra piloto (13 sobrados + portaria + área comum), login, papéis, RLS |
| 1 | Orçamento | Importação da planilha existente, estrutura com quantitativos e valores unitários |
| 2 | Cronograma + Avanço físico | Previsto por tarefa, preenchimento semanal do executado, dashboard real x planejado |
| 3 | Financeiro | Lançamento de notas/gastos/materiais vinculados ao orçamento, previsto x realizado, **Curva S**, projeção de custo final |
| 4 | RDO | Relatório diário com geolocalização, fotos, clima, efetivo, exportação PDF com identidade RT |
| 5 | Pendências | Por unidade (seleciona Sobrado 1 → serviços pendentes + observações), status e responsável |
| 6 | Suprimentos (Compras + Almoxarifado) | **Compras:** pedido vinculado ao orçamento → cotações com anexos → aprovação → conferência com NF. **Almoxarifado:** entrada/saída de materiais, empréstimo de ferramentas com devolução diária e alerta de não devolvido |
| 7 | Extras (**todos aprovados**) | Medições de empreiteiros · Controle de contratos · FVS/checklist de qualidade · Galeria de fotos por unidade · Gestão de efetivo · Alertas (ferramenta não devolvida, etapa estourando orçamento, tarefa atrasada) |

> **Nota de execução (09/07/2026):** por decisão do Rodrigo, FVS foi antecipado e entregue junto com Pendências como grupo **"Qualidade"** (Fase 5), em vez de esperar a Fase 7 isolada. Galeria de Fotos também foi antecipada (Fase 7 → entregue junto com RDO). Demais itens da Fase 7 seguem a ordem original.

### Amarrações entre módulos (regras de integração)
1. **Financeiro ↔ Orçamento:** todo gasto lançado aponta para uma etapa/serviço do orçamento. Gasto sem vínculo não é aceito pelo sistema — vai para fila "a classificar".
2. **Avanço físico ↔ Cronograma:** o % executado semanal alimenta o dashboard real x planejado e a Curva S física.
3. **Medição ↔ Avanço ↔ Financeiro (Fase 7):** avanço aprovado → medição liberada → lançamento financeiro. Ciclo fechado, sem etapa pulada.
4. **RDO ↔ Efetivo ↔ Almoxarifado:** efetivo do dia e retiradas de ferramenta alimentam o RDO automaticamente quando existirem.
5. **Pendência ↔ FVS (Fase 7):** serviço só muda para "concluído" com checklist de verificação aprovado, quando o FVS estiver ativo para aquela etapa.
6. **Compras ↔ Almoxarifado ↔ Financeiro (conferência tripla):** cotação aprovada x quantidade recebida no almoxarifado x NF lançada. Divergência em valor ou quantidade em qualquer ponta gera alerta automático. NF sem pedido de compra vinculado vai para fila "a classificar".

### Regras do módulo Suprimentos — Compras [extraído em 07/07/2026]
- **Fluxo:** pedido de compra (vinculado a etapa/serviço do orçamento) → recebimento de cotações com **anexo obrigatório** do orçamento do fornecedor (PDF/foto) → comparação lado a lado → aprovação → acompanhamento de entrega → conferência com NF.
- **Aprovação:** exclusiva do papel `admin` (Rodrigo). Equipe cria pedidos e cadastra cotações, mas não aprova.
- **Número de cotações:** livre — aprovação permitida com 1 cotação. O sistema apenas registra quantas cotações o pedido teve (rastreabilidade, sem bloqueio).
- **Rastreabilidade:** toda aprovação grava aprovador, data/hora, cotação vencedora, cotações preteridas e anexos. Nada se sobrescreve.
- **Status do pedido:** rascunho → em cotação → aprovado → pedido enviado → recebido parcial/total → conferido com NF → encerrado.

## 6. Regras de rastreabilidade (prioridade máxima do projeto)

1. Todo registro grava **autor, data/hora e vínculo à hierarquia** (obra → unidade → etapa → serviço). Sem exceção.
2. **Nenhum dado calculado sem fonte:** dashboards, Curva S e projeções exibem de onde vem cada número (soma de quais lançamentos, qual período).
3. **Nunca inventar valor:** campo sem dado fica vazio e sinalizado como pendente — jamais preenchido com estimativa silenciosa. Estimativas, quando existirem, são marcadas como tal e citam base.
4. **Nada se apaga, tudo se inativa:** exclusões são lógicas (soft delete) com registro de quem e quando. Histórico de alterações em lançamentos financeiros e medições.
5. **Exportação:** qualquer tabela do app exporta para Excel/PDF preservando os vínculos e a autoria.

## 7. Fluxo de trabalho por fase (obrigatório para o Codex)

Para **cada fase**, o Codex segue exatamente esta sequência:

1. **Confirmar o objetivo** da fase com as próprias palavras.
2. **Perguntas estratégicas** — listar o que falta definir e o que melhora a assertividade. Não implementar com lacuna estrutural aberta.
3. **Plano em etapas** — desenho do módulo (telas, tabelas, regras) para o Rodrigo **validar antes de executar**.
4. **Implementação** — só após aprovação explícita.
5. **Teste guiado** — roteiro simples para o Rodrigo testar na obra/escritório.
6. **Ajustes e aceite** — fase só fecha com aceite do Rodrigo. Aí abre a próxima.

Na entrega de qualquer análise ou documento: marcar dados como [extraído], [estimado] ou [lacuna]; citar base de cada estimativa; sinalizar opcionais como [sugestão].

## 7.1 Colaboração com o Claude Code

Quando Codex e Claude Code forem usados no mesmo projeto, ler e cumprir integralmente
`docs/colaboracao-codex-claude.md`. Por padrão, o Codex é o responsável pela execução
contínua e o Claude Code atua como arquiteto/revisor independente em modo somente
leitura. O Claude Code só pode assumir implementação quando Rodrigo declarar
explicitamente o escopo, os arquivos reservados e o commit-base. Nunca editar ao mesmo
tempo arquivos que estejam sob responsabilidade ativa do outro agente.

## 8. Definição de pronto (por módulo)

Um módulo só é considerado entregue quando:

- [ ] Funciona no celular e no desktop (testado nos dois);
- [ ] Permissões dos 3 papéis testadas (equipe não edita o que não deve; cliente só visualiza);
- [ ] Rastreabilidade verificada: autor + data + vínculo em todos os registros;
- [ ] Migração de banco versionada no repositório;
- [ ] Dados de teste removidos ou claramente marcados;
- [ ] Rodrigo testou com dados reais da obra piloto e deu aceite.

## 9. Lacunas — situação atual

Respondidas em 07/07/2026 [extraído]:

1. ~~Planilha de orçamento~~ — recebida e importada (ver `docs/fase1.md`).
2. ~~Cliente vê valores?~~ — sim, R$ e percentuais.
3. ~~Usuários da equipe~~ — 4 pessoas com escopos definidos (ver §2).
4. ~~Formato do RDO~~ — sem modelo em papel; campos definidos: cabeçalho, horário de início, descrição dos serviços, vínculo à hierarquia, clima por período, acidentes (sim/não + descrição), fotos com GPS/data/hora, observações (com opção por voz), assinatura digital.
5. ~~Hospedagem~~ — Vercel. Domínio próprio: a definir depois. [lacuna]
6. ~~Cronograma~~ — existe em MS Project; Rodrigo vai compartilhar o arquivo na Fase 2. [lacuna: arquivo pendente]
7. ~~Medição de empreiteiros~~ — por % concluída de cada serviço, subdividida por sobrado (ex.: "Alvenaria do Sobrado 03 = 40%").
8. Cadastro de fornecedores — em aberto; perguntar na Fase 6. [lacuna]

---

*Versão 1.18 — 18/07/2026 — §0 registra fix crítico de Storage encontrado no teste de campo de Projetos: a policy `isolamento_obra_storage` (auditoria de 17/07) usava um regex de UUID versão 1-5/variante RFC4122 que rejeitava o `obra_id` seedado manualmente da obra piloto, bloqueando upload novo em `rdo`/`fvs`/`pendencias`/`cotacoes-nf` desde 17/07/2026 sem detecção. Corrigido com regex de formato UUID genérico. Ver `docs/superpowers/plans/2026-07-18-projetos.md`.*
*Versão 1.17 — 18/07/2026 — §0 registra o módulo Projetos (`/projetos`) implementado: repositório versionado de documentos da obra (projeto executivo, memorial, administrativo), revisão atual + histórico, upload PDF em bucket privado com policy de leitura estendida ao cliente (segunda exceção do app à regra geral), isolamento por obra desde a migração inicial, hardening de função SECURITY DEFINER. Aguardando commit externo (sandbox do Codex com `.git` somente leitura), revisão pós-commit obrigatória do Claude Code e aplicação da migração no Supabase antes de qualquer teste com dados reais. Ver `docs/fase7_projetos.md`.*
*Versão 1.16 — 18/07/2026 — §0 registra o módulo Tarefas (`/tarefas`) entregue e aceito em produção: teste real do Rodrigo como admin, equipe com/sem módulo `tarefas` e cliente; RLS restritiva por obra, máquina de status em trigger, auditoria servidor-side de conclusão/cancelamento, histórico preservado em soft delete, tarefa fechada somente leitura, hardening de funções SECURITY DEFINER e correção mobile dos campos Responsável/Prazo. Ver `docs/fase7_tarefas.md`.*
*Versão 1.15 — 17/07/2026 — §0 registra a importação transacional do inventário de julho/2026 no Almoxarifado: 148 saldos vindos da coluna SALDO, total de 11.164 unidades, histórico preservado e quatro códigos ausentes mantidos sem alteração.*
*Versão 1.14 — 17/07/2026 — §0 encerra formalmente a auditoria geral de segurança e UX, registra a validação em produção dos achados, o teste ponta a ponta com cliente temporário e o aceite visual no celular, sem achados abertos. A próxima etapa passa a seguir `docs/sequencia-trabalho-codex-claude.md`, com Codex como executor e Claude Code como arquiteto/revisor em somente leitura por padrão.*
*Versão 1.13 — 17/07/2026 — §0 registra o regime Produção própria de Medições (16/07/2026, segundo regime dentro de `/medicoes` — salário com vigência, produção diária de alvenaria/reboco por parede, rateio entre profissionais, medição `MP-001...`, aprovação admin com snapshot imutável), duas correções de performance no RDO mobile (fotos em lote, uma foto por vez) e a auditoria geral de segurança/UX iniciada em 17/07/2026 (corrigidos: leitura anônima em 11 tabelas, funções privilegiadas expostas a `anon`, headers de segurança ausentes, tela branca do PWA; abertos: limite de upload no backend, UI mobile, tabelas largas, confirmações nativas, tamanho do bundle). "Próxima etapa" atualizada.*
*Versão 1.12 — 17/07/2026 — adiciona o §7.1 e referencia `docs/colaboracao-codex-claude.md`, formalizando Codex como executor contínuo e Claude Code como arquiteto/revisor independente por padrão, com prevenção de edição concorrente.*
*Versão 1.11 — 14/07/2026 — §0 registra dois ajustes no Almoxarifado: lançamento de entrada em lote (vários insumos por NF, mesmo padrão de lista de Contratos/Compras) e edição de entrada pelo admin (corrige quantidade/material/fornecedor/NF sem inativar e relançar, grava editado_por/editado_em). Corrigido também o trigger `sincroniza_recebimento_pedido()`, que só reagia à inativação — agora reage a mudança de quantidade/vínculo também, requisito pra edição ser segura sem desatualizar o pedido de compra vinculado.*
*Versão 1.10 — 14/07/2026 — §0 registra o módulo Medições (Fase 7) entregue: lançamento de quantidade executada por item de contrato ativo (aceita fração), trava de saldo no banco sem exceção pra admin, cálculo de retenção (bruto/retido/líquido), aprovação exclusiva do admin, PDF com identidade RT. Cobre só o regime de empreiteiros por serviço — produção própria fica pra spec futura. Implementado via subagent-driven-development; revisão da Task 1 encontrou 3 lacunas de RLS/trigger próprias (reatribuição de item aprovado, saldo somado por linha em vez de por item, valores calculados graváveis direto) fechadas no mesmo dia, antes da interface. Ver `docs/fase7_medicoes.md`.*
*Versão 1.9 — 13/07/2026 — §0 registra o módulo Contratos (Fase 7) entregue: cadastro de empreiteiros, contrato com itens vinculados ao orçamento (serviço × unidade), numeração `CT-001...`, fluxo rascunho→ativo→encerrado exclusivo do admin em ordem única, itens imutáveis fora do rascunho sem exceção pra admin (RLS corrigida em 2 rodadas de revisão no mesmo dia — bypass de admin indevido nos itens e transição de status fora de ordem). Base para o futuro módulo de Medições. Ver `docs/fase7_contratos.md`.*
*Versão 1.8 — 13/07/2026 — §0 registra tudo entregue em 12–13/07: redesenho visual do Dashboard (card-herói, KPI-pílulas, widget RDO, grupo Suprimentos); tela Dados da Obra (admin edita/cria obras, antes só existia via SQL); módulo Definições de Projeto (Fase 7 — única tela com cliente em modo leitura); Almoxarifado ganhou impressão de estoque em PDF por categoria e campos opcionais de fornecedor+NF na entrada; botão Editar trabalhador no Efetivo. §3 registra a regra de RLS pra soft delete aprendida com o fix crítico de 13/07 (7 tabelas com inativação silenciosamente bloqueada pelo Postgres — `rdo_atividades`, `rdo_fotos`, `rdo_audios`, `rdo_efetivo`, `pedidos_compra_itens`, `trabalhadores`, `fvs_fotos`).*
*Versão 1.7 — 12/07/2026 — §0 registra a Gestão de Efetivo (Fase 7, parcial) entregue em 12/07/2026: cadastro nominal de trabalhadores, chamada diária de presença, RDO em rascunho lê a chamada automaticamente (RDO assinado nunca lê a chamada — imutabilidade preservada), banner de presença no Dashboard; ver `docs/fase7_efetivo.md` e `docs/superpowers/specs/2026-07-12-fase7-efetivo-design.md`.*
*Versão 1.6 — 12/07/2026 — PDF de requisição ajustado (10 itens por ficha, assinatura "Mestre de Obras / Encarregado" centralizada); §0 esclarece as regras de negócio do Almoxarifado testadas com o Rodrigo (entrada só vincula pedido aprovado/enviado/recebido_parcial — por isso pedido em rascunho não aparece; diferença entre saída avulsa e lançamento de requisição; unidade destino e retirado_por são obrigatórios e bloqueiam com mensagem, não falham silenciosamente).*
*Versão 1.5 — 11/07/2026 — §0 registra a Fase 6 (Almoxarifado) entregue em 11/07/2026, completando a Fase 6 junto com Compras: estoque de materiais/EPIs/escritório, entrada vinculada a pedido, saída avulsa e por requisição, blocos de requisição em PDF, ferramentas com empréstimo/devolução/atraso, banner no Dashboard e conferência tripla no pedido de compra; ver `docs/fase6_almoxarifado.md`. Lacuna registrada: saldo dos materiais de obra aguardando planilha de junho do Rodrigo.*
*Versão 1.4 — 11/07/2026 — §0 registra a Fase 6 (Compras) entregue em 10/07/2026 com refinamentos de 10–11/07 (campo Aplicação, PDF do pedido, edição em rascunho, importação de CSV de cotação via skill `leitura-cotacao-fornecedor`, correções de layout); próxima etapa atualizada (aceites das Fases 5 e 6 pendentes; Almoxarifado em spec separada).*
*Versão 1.3 — 10/07/2026 — Fases 2, 4 e 5 (parcial) registradas; §1 corrige a paleta para os hex exatos do manual de marca oficial (skill `rt-manual-marca`) e referencia a fonte de verdade; §4 adiciona tabela de skills RT/Engenhar.IA e quando acionar cada uma; §5 nota a antecipação de FVS/Galeria para as fases 5/4; §0 registra o reset de dados de teste de 10/07/2026 (FVS/Pendências/RDO/Avanços/Galeria zerados a pedido do Rodrigo, modelos de FVS/cronograma/orçamento preservados).*
*Versão 1.2 — 07/07/2026 — Fases 0 e 1 concluídas e aceitas; adiciona §0 Estado atual apontando para docs/fase0.md e docs/fase1.md; lacunas do §9 atualizadas com as respostas do Rodrigo; cliente vê valores confirmado; hospedagem Vercel definida.*
*Versão 1.1 — 07/07/2026 — inclui módulo Compras na Fase 6 (Suprimentos) com conferência tripla cotação x recebimento x NF.*
*Versão 1.0 — 07/07/2026 — elaborado com base nas definições de Rodrigo Teles Silva em conversa com o Codex. Alterações neste documento exigem aprovação do Rodrigo e atualização do número de versão.*
