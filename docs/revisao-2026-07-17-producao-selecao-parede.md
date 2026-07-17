# Revisão — Produção própria: seleção de parede por planta PDF

Responsável pela implementação: Codex.
Responsável pela revisão: Claude Code, somente leitura.
Escopo implementado: `docs/superpowers/plans/2026-07-17-producao-selecao-parede-pdf.md` (7 tasks).
Commit-base: `ee7cff2` (plano aprovado).
Commits revisados: `21a1930`, `50184df`, `65c24e8`, `b0c16ef`, `fe40943`, `9b9a71b`, `4a3a6ad`.

Documentos lidos: `AGENTS.md`, `docs/colaboracao-codex-claude.md`,
`docs/sequencia-trabalho-codex-claude.md`, spec e plano da feature,
`docs/fase7_producao_propria.md`.

Verificações realizadas: regras de negócio, modelo de dados, RLS e isolamento por obra,
triggers alteradas de `producao_lancamentos`, RPCs de escrita composta, cancelamento
lógico e recálculo de saldo, compatibilidade com lançamentos legados, permissões por
módulo, Storage (bucket `producao-plantas`), e — usando o MCP Supabase em modo leitura —
o estado real do banco de produção (`yxshldsfmbmbzdkcymca`) comparado com as migrações do
repositório, já que o pedido original citava explicitamente "riscos antes de aplicar
migração em produção".

---

## Achado 1 — Crítico

**Módulo e cenário:** Produção própria → abas "Lançamentos" e "Plantas". As migrações da
Task 1 e Task 2 do plano não foram aplicadas no banco de produção, mas o código do
frontend que depende delas já está commitado em `main` — que, por regra do projeto
(`CLAUDE.md`/`AGENTS.md` §3), aciona deploy automático na Vercel a cada push.

**Arquivo e linha:**
- `supabase/migrations/20260718_producao_plantas_paredes.sql` (não aplicado)
- `supabase/migrations/20260718_producao_progresso_lancamento.sql` (não aplicado)
- `src/pages/Producao.tsx` (código já commitado/pushado que assume essas tabelas/RPCs)

**Evidência observada:** consultei diretamente o projeto de produção via MCP Supabase
(somente leitura, nenhuma alteração feita):

```sql
-- list_migrations no projeto yxshldsfmbmbzdkcymca:
-- última versão aplicada é 20260717164000 (importacao_estoque_julho).
-- Nenhuma versão 20260718_* consta.

SELECT table_name FROM information_schema.tables WHERE table_schema='public'
  AND table_name IN ('producao_paredes','producao_plantas','producao_paredes_progresso');
-- resultado: vazio (nenhuma das 3 tabelas existe em produção)

SELECT proname FROM pg_proc WHERE proname IN
  ('producao_registrar_producao_parede','producao_cancelar_lancamento',
   'producao_editar_meta_parede','pode_acessar_planta','pode_acessar_parede');
-- resultado: vazio (nenhuma das 5 funções existe em produção)
```

Em contraste, `producao_lancamentos` e `usuarios_obras` **existem** — confirmando que a
migração base de Produção própria (16/07) e a de isolamento por obra (17/07) já estão
aplicadas; o gap é específico das duas migrações de hoje (18/07 no nome do arquivo).

**Impacto funcional/segurança:** qualquer usuário com o módulo de produção liberado que
abrir "Produção própria" agora recebe erro ao carregar a aba Plantas (tabela inexistente)
e não consegue lançar produção nenhuma — nem pelo fluxo novo (RPC inexistente) nem pelo
antigo (o formulário de comprimento/altura foi removido da tela). É uma regressão total
da funcionalidade que já estava entregue desde 16/07, até as duas migrações serem
aplicadas. Não é uma falha de segurança (não há exposição de dado), é indisponibilidade.

**Correção recomendada:** aplicar as duas migrações no projeto de produção, na ordem
`20260718_producao_plantas_paredes.sql` depois `20260718_producao_progresso_lancamento.sql`
(a segunda depende da primeira). O próprio `docs/fase7_producao_propria.md` já registra a
recomendação de validar `20260718_producao_progresso_lancamento.sql` em transação com
`ROLLBACK` antes, por alterar `producao_lancamentos` (tabela que pode ter dados reais) —
mantenho essa recomendação. Sugiro também travar o processo daqui pra frente: migração de
schema só entra em `main` (que já dispara o deploy do frontend) depois de aplicada em
produção, ou registrar explicitamente no commit que o deploy do frontend está
temporariamente incompatível com o banco até a aplicação manual.

**Teste de validação:** repetir as três consultas acima após aplicar; depois abrir
Produção própria → Plantas em produção e confirmar que a tela carrega sem erro.

---

## Achado 2 — Médio

**Módulo e cenário:** Produção própria → Lançamentos, seleção de parede na planta.
O destaque visual de "parede já concluída" (cor diferente, sem esconder a faixa),
decidido na spec §5/§6, não está aceso na tela de lançamento diário.

**Arquivo e linha:** `src/pages/Producao.tsx`, chamada de `PlantaClicavel` dentro do
componente `Lancamentos` (linha ~331 no arquivo atual: `<PlantaClicavel imagemUrl={urlImagem}
paredes={paredesDaPlanta} modo="selecionar" onSelecionar={aoSelecionarParede} />`) — o
prop `saldoPorParede` nunca é passado. O componente já suporta o recurso
(`src/components/PlantaClicavel.tsx:14` declara o prop, linhas 44-48 calculam
`concluida` e aplicam `styles.faixaConcluida`), só falta a chamada alimentá-lo.

**Evidência observada:** `grep -n "saldoPorParede" src/pages/Producao.tsx` não retorna
nenhuma ocorrência de uso do prop — só existe na assinatura do componente importado.
Raiz do gap: o próprio plano aprovado já tinha esse exemplo de chamada sem o prop
(`docs/superpowers/plans/2026-07-17-producao-selecao-parede-pdf.md:1176`) — não é um
desvio do Codex em relação ao plano, é uma lacuna que passou pela minha própria revisão
do plano antes da aprovação do Rodrigo.

**Impacto funcional/visual:** o usuário só descobre que uma parede está com saldo
zerado depois de clicar nela — aí sim vê "Saldo restante: 0 m²" e o backend bloqueia a
gravação corretamente (a trava financeira funciona). Não há risco de dado incorreto,
só uma perda da conveniência visual aprovada (evitar cliques em paredes já prontas).

**Correção recomendada:** em `Lancamentos`, montar o mapa antes do `return`:
```ts
const saldoPorParede = new Map(paredesDaPlanta.map((p) => [p.id, saldoDaParede(p)]));
```
e passar `saldoPorParede={saldoPorParede}` na chamada de `PlantaClicavel` em modo
"selecionar".

**Teste de validação:** cadastrar uma parede com meta pequena, lançar até zerar o saldo
de um serviço/face, reabrir a planta em Lançamentos e confirmar que a faixa aparece na
cor de "concluída" antes mesmo de clicar nela.

---

## Achado 3 — Baixo

**Módulo e cenário:** Produção própria → Plantas, reenvio de uma planta já cadastrada
para o mesmo pavimento.

**Arquivo e linha:** `src/pages/Producao.tsx`, função `enviarPdf`; bucket
`producao-plantas` em `supabase/migrations/20260718_producao_plantas_paredes.sql`
(sem policy de DELETE).

**Evidência observada:** cada envio gera novos nomes de arquivo via
`crypto.randomUUID()` e faz `upsert` em `producao_plantas` apontando para os novos
caminhos; os arquivos antigos no Storage não são removidos, e não há policy de DELETE
para o bucket que permitiria limpá-los depois pelo próprio app.

**Impacto:** nenhum risco de segurança ou de dado — o registro sempre aponta para o
arquivo correto. É só acúmulo de armazenamento se uma planta for recadastrada várias
vezes ao longo do tempo (13 sobrados reaproveitam a mesma planta, então o recadastro
deve ser raro).

**Correção recomendada (sugestão, não bloqueante):** avaliar mais adiante, se o uso real
mostrar que o recadastro de planta é frequente.

---

## Achado 4 — Baixo

**Módulo e cenário:** Documentação — `docs/fase7_producao_propria.md`, seção "Entrega
complementar — planta PDF clicável".

**Evidência observada:** o texto descreve o cadastro de parede como tendo "código,
serviço, pavimento, unidade opcional e metas de alvenaria/reboco". O schema real de
`producao_paredes` não tem colunas `codigo`, `servico` nem `unidade_id` — esses conceitos
vivem em `producao_paredes_progresso` (chave composta parede × sobrado × serviço/face) ou
não existem (a parede não tem "código", só `nome`).

**Impacto:** nenhum funcional. Risco é de confundir quem usar esse documento como fonte
no futuro em vez de reler o código — o próprio `CLAUDE.md` §0 recomenda ler `docs/faseN.md`
em vez de redescobrir o código a cada fase nova.

**Correção recomendada (sugestão):** ajustar a frase para refletir exatamente as colunas
reais (nome, posição/tamanho da faixa, metas por serviço/face) e mencionar que
serviço/sobrado ficam em `producao_paredes_progresso`, não na parede.

---

## O que foi verificado e não apresentou problema

- **RLS das tabelas novas:** `pode_acessar_planta`/`pode_acessar_parede` são funções
  `SECURITY DEFINER` dedicadas (não subquery inline contra tabela-pai com RLS própria) —
  segue exatamente a lição registrada em `docs/revisao-2026-07-17-rls-filhos-obra.md`.
- **Isolamento por obra:** políticas RESTRICTIVE `isolamento_obra` presentes em
  `producao_plantas`, `producao_paredes`, `producao_paredes_progresso` e nas duas
  policies de Storage do bucket `producao-plantas`, todas usando `pode_acessar_obra`.
- **Permissão por módulo:** todas as policies de leitura/escrita reutilizam
  `pode_editar_medicoes()` (admin, ou equipe com o módulo `medicoes`), mesmo padrão já
  usado nas demais tabelas `producao_%` desde 16/07 — cliente nunca enxerga o módulo.
- **Funções privilegiadas:** todas as novas `SECURITY DEFINER` (`producao_registrar_producao_parede`,
  `producao_cancelar_lancamento`, `producao_editar_meta_parede`, `pode_acessar_planta`,
  `pode_acessar_parede`) têm `SET search_path = public` e `REVOKE ALL ... FROM PUBLIC, anon`
  — consistente com a auditoria de segurança de 17/07.
- **Trava de saldo:** `producao_registrar_producao_parede` usa `SELECT ... FOR UPDATE` na
  linha de `producao_paredes_progresso` antes de checar `produzido_m2 + área > meta`,
  prevenindo lançamento concorrente na mesma parede/sobrado/serviço/face além do saldo.
- **Cancelamento:** `producao_cancelar_lancamento` bloqueia se já cancelado, se já estiver
  em uma medição aprovada, e exige motivo; devolve o saldo em `producao_paredes_progresso`
  de forma segura contra concorrência (UPDATE incremental sob lock de linha do Postgres).
- **Edição de meta:** `producao_editar_meta_parede` bloqueia reduzir a meta abaixo do
  `MAX(produzido_m2)` já lançado em qualquer um dos 13 sobrados — correto, porque a meta é
  compartilhada por todos os sobrados que reaproveitam a mesma parede "Tipo".
- **Compatibilidade com lançamentos legados:** constraint `parede_ou_legado` impede linha
  ambígua (nem os dois preenchidos, nem os dois vazios); os triggers `producao_inicializar_lancamento`,
  `producao_preparar_lancamento` e a função `producao_recalcular` têm branch dedicado para
  `parede_id IS NOT NULL` sem quebrar o caminho antigo por comprimento×altura.
- **Storage:** bucket `producao-plantas` é privado (`public:false`); a tela usa
  `createSignedUrl`, nunca URL pública direta.

## Diferenciação defeito comprovado × sugestão

Achados 1 e 2 são defeitos comprovados (verificados no banco real e no código,
respectivamente). Achados 3 e 4 são sugestões de baixo impacto, não bloqueantes.
