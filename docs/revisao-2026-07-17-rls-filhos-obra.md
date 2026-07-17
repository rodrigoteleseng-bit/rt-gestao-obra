# Revisão independente — Claude Code

Responsável pela implementação e tratamento dos achados: Codex.
Responsável pela revisão: Claude Code, somente leitura.
Commit-base: 84f0d9b
Commit revisado: 13f507fddfea90062cab394f7df64848b0acebc2 ("fix: corrigir RLS das fotos do RDO")
Escopo implementado: migração `20260717_fix_rls_filhos_rdo.sql` — cria `pode_acessar_rdo()` (SECURITY DEFINER) e reescreve as 4 policies `isolamento_obra` de `rdo_atividades`, `rdo_efetivo`, `rdo_fotos`, `rdo_audios`.

Confirme cada achado no código antes de alterar. Para cada item, informe se foi
confirmado, parcialmente confirmado, não confirmado ou se é sugestão. Corrija os
achados confirmados dentro do escopo, execute testes proporcionais ao risco, revise
o diff, crie commit, publique e verifique o deploy. Não inclua mudanças alheias.

## Correção pontual — verificada, sem achado

Rastreei a causa até `bbc1961` ("Segurança: isola acessos por obra", 11:39): as 4
tabelas filhas do RDO ganharam uma policy `RESTRICTIVE` que checava a obra via
subquery direta — `EXISTS (SELECT 1 FROM rdos r WHERE r.id=rdo_id AND
pode_acessar_obra(r.obra_id))`. Essa subquery lê `rdos` sob a RLS do usuário
chamador, não sob privilégio elevado — é exatamente o padrão que o projeto já evita
em outros lugares (`pode_acessar_obra`, `pode_ver_perfil` já são `SECURITY DEFINER`
por esse motivo). A correção troca a subquery inline por `pode_acessar_rdo()`
`SECURITY DEFINER`, alinhando com o padrão que já funciona no resto do projeto.
`REVOKE`/`GRANT` estão corretos (só `authenticated`, negado a `anon`/`PUBLIC`).

## [Alto] O mesmo padrão vulnerável continua em ~24 outras tabelas da mesma migração bbc1961

**Módulo e cenário:** qualquer INSERT/UPDATE feito por usuário não-admin (equipe ou
cliente) em uma tabela "filha" que não tem `obra_id` direto e cuja policy
`isolamento_obra` verifica o vínculo via subquery `EXISTS (SELECT ... FROM
tabela_pai WHERE ...)` em vez de uma função `SECURITY DEFINER`.

**Evidência:** o commit `bbc1961` (`supabase/migrations/20260717_isolamento_usuario_obra.sql`)
aplicou esse exato padrão (subquery inline) em pelo menos estas tabelas, nenhuma
delas corrigida ainda:

- Qualidade: `fvs_verificacoes`, `fvs_respostas`, `fvs_fotos`
- Pendências: `pendencia_eventos`, `pendencia_fotos`
- Compras: `pedidos_compra_itens`, `cotacoes`, `cotacoes_itens`, `recebimentos_nf`
- Almoxarifado/Efetivo: `ferramenta_emprestimos`, `efetivo_presencas`
- Contratos/Medições: `contratos_itens`, `medicoes_seq`, `medicoes`, `medicoes_itens`
- Produção própria: `producao_aberturas`, `producao_participantes`,
  `producao_medicao_lancamentos`, `producao_medicao_dias`
- Orçamento/Cronograma: `etapas`, `servicos`, `cronograma_previsto`,
  `cronograma_dependencias`, `avancos_fisicos`
- Storage: o branch `cotacoes-nf` da policy de `storage.objects` usa o mesmo padrão
  contra `pedidos_compra`

O commit revisado corrigiu exatamente as 4 tabelas onde o bug já se manifestou
(RDO), usando o padrão correto — mas não generalizou a correção pras demais tabelas
que compartilham a mesma estrutura.

**Impacto:** se a causa-raiz for essa (subquery inline sofrendo a RLS de leitura da
tabela-pai em vez de bypass via `SECURITY DEFINER`), o mesmo bloqueio de escrita
pode acontecer silenciosamente em Compras, Contratos, Medições, FVS, Pendências,
Almoxarifado, Produção própria e Cronograma para usuários `equipe`/`cliente` —
vários desses módulos estão em teste de campo agora ou aguardando aceite (CLAUDE.md
§0). Isso apareceria como "erro ao salvar" sem explicação clara pro usuário de
campo.

**Grau de confiança:** não foi possível testar um INSERT real como usuário
não-admin sem gravar dado de teste em produção, então isto é **inferência por
padrão estrutural idêntico ao caso já confirmado**, não um defeito comprovado — é a
mesma distinção que o protocolo exige. Rodei o advisor de segurança do Supabase
(`get_advisors`) como checagem adicional; ele não aponta esse tipo de bug lógico (é
um linter estático, não testa RLS em runtime), então não serviu de confirmação nem
de refutação.

**Correção recomendada:** aplicar o mesmo padrão (`SECURITY DEFINER` wrapper por
tabela-pai, ou uma função genérica parametrizada) nas ~24 tabelas listadas, numa
única migração — em vez de esperar cada uma quebrar em campo pra corrigir uma por
vez.

**Teste para validar:** com uma conta `equipe` vinculada a uma obra (não admin),
tentar inserir um item em cada módulo afetado (ex.: adicionar item a um pedido de
compra em rascunho, lançar uma resposta de FVS, criar uma medição) — hoje, antes da
correção, é esperado que pelo menos algum desses falhe com erro de RLS/permissão.
