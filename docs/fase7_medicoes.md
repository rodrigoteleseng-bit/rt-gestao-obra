# Fase 7 — Medições de empreiteiros

> Detalhes técnicos do módulo de Medições. Entregue em 14/07/2026, aguardando teste de campo
> com uma medição real e aceite do Rodrigo — ver CLAUDE.md §0.
> Consome as tabelas de Contratos (`docs/fase7_contratos.md`) — cobre apenas o regime de
> empreiteiros terceirizados por serviço.

## O que foi entregue

- Medição vinculada a um contrato **ativo** (`/contratos/:id/medicoes/nova` e
  `/contratos/:id/medicoes/:medicaoId`), numerada em sequência por contrato (1ª, 2ª medição…).
- Uma linha por item do contrato, herdando serviço/unidade/valor unitário — sem busca de
  serviço nova, os itens vêm sempre do próprio contrato.
- Quantidade executada no período aceita valores fracionados (ex.: `1,2`). Saldo (quanto falta)
  e valor do período calculados automaticamente a partir da quantidade contratada e do que já
  foi aprovado antes.
- Fluxo de status **rascunho → aprovada**, aprovação exclusiva do admin, sem volta.
- **Trava de saldo no banco:** ao aprovar, bloqueia se a soma de tudo que já foi aprovado
  ultrapassar a quantidade contratada de qualquer item — sem exceção nem para admin.
- **Retenção calculada:** valor bruto medido, valor retido (bruto × retenção % do contrato) e
  valor líquido a pagar — primeira funcionalidade do app a usar esse campo do contrato.
- Itens de medição aprovada são permanentemente imutáveis.
- PDF com identidade RT (itens + resumo bruto/retido/líquido), sem assinatura digital nesta
  versão.
- Lista global em `/medicoes` (substitui o placeholder "Em construção"), com filtro por status.
- Módulo `medicoes` (checkbox em Usuários, já existia no enum desde 07/07/2026, nunca usado
  até agora): admin sempre tem acesso; equipe só com o módulo habilitado cria/edita rascunho e
  aprova (aprovação sempre exclusiva do admin). Cliente não vê o módulo.

## Onde estão as regras de negócio

RLS e triggers em `supabase/migrations/20260713_fase7_medicoes.sql`. Diferente de Contratos,
que precisou de duas migrações de correção no mesmo dia (bypass de admin em itens e transição
de status fora de ordem), aqui a base já foi desenhada sem repetir esse erro — mas a revisão
de código encontrou **3 lacunas próprias** antes de qualquer interface ser construída em cima,
fechadas ainda no mesmo dia em `supabase/migrations/20260713_fase7_medicoes_travas.sql`:

1. Um item de uma medição já aprovada podia ser "desviado" pra outra medição em rascunho
   (a policy de update só validava o destino, nunca a origem) — corrigido exigindo que a
   medição atual do item também esteja em rascunho.
2. A trava de saldo somava por linha, não por item — duas linhas separadas do mesmo item
   dentro da mesma medição furavam o limite contratado. Corrigido agrupando por item antes de
   comparar, mais um índice único que impede duas linhas ativas do mesmo item na mesma medição.
3. Os valores calculados (bruto/retido/líquido) podiam ser sobrescritos direto por qualquer
   sessão com permissão de editar — corrigido com um trigger que reverte qualquer escrita
   direta, permitindo só o recálculo interno automático.

Ver `docs/superpowers/specs/2026-07-13-fase7-medicoes-design.md` para o desenho completo e
`docs/superpowers/plans/2026-07-13-fase7-medicoes.md` para o plano de implementação (executado
via subagent-driven-development, com revisão de cada task antes de avançar).

## Fora de escopo (spec explicitamente deferiu)

- Regime de mão de obra direta (produção individual de funcionários próprios) — spec futura
  separada.
- Lançamento financeiro real (pagamento) — Financeiro (Fase 3) ainda não existe; a medição
  aprovada só registra o valor líquido a pagar.
- Anexo de comprovante/documento assinado da medição — pedido adiado pelo Rodrigo em
  13/07/2026, para tratar depois num módulo próprio de anexos/documentos.
- Vínculo automático com Avanço Físico do Cronograma — quantidade é sempre digitada
  manualmente na medição, por decisão do Rodrigo.
- Edição do cabeçalho da medição (data de referência) e exclusão de medição aprovada pela
  tela — permanente por design.

## Pendência de verificação

O teste de campo (roteiro em vários papéis — admin, equipe com/sem módulo, cliente — e
impressão do PDF) depende de navegador real e ainda não foi executado pelo Rodrigo. Ver
checklist completo no plano de implementação, Task 6.
