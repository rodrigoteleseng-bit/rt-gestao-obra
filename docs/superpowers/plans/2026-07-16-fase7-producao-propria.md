# Fase 7 — Produção própria · Plano de implementação

> Depende da aprovação da spec `../specs/2026-07-16-fase7-producao-propria-design.md`.
> Não executar implementação antes do aceite explícito de Rodrigo.

## Task 1 — Banco, tipos e RLS

**Criar:** `supabase/migrations/20260716_fase7_producao_propria.sql`
**Alterar:** `src/lib/supabase.ts`

- Criar enums, sequência `MP`, 8 tabelas, índices e constraints da spec.
- Criar funções de cálculo, conflito diário, vigência salarial, fechamento/aprovação/cancelamento.
- Implementar snapshots imutáveis e totais derivados.
- Aplicar RLS com `pode_editar_medicoes()` e regra correta de soft delete.
- Testar em transação com `ROLLBACK`: áreas, N aberturas, rateio, centavo residual, vigência,
  conflito produção/salário, duplicidade e imutabilidade.
- Revisão de segurança antes de qualquer interface.

## Task 2 — Cadastro de salários

**Criar:** `src/pages/Producao.tsx`, `src/pages/Producao.module.css`
**Alterar:** `src/App.tsx`, `src/components/Layout.tsx`

- Tela `/producao`, aba Salários, usando trabalhadores ativos.
- Nova vigência encerra a anterior sem reescrever histórico.
- Cadastrar os valores reais somente após selecionar os profissionais correspondentes.
- Validar sobreposição e exibir valor diário (`salário ÷ 30`).

## Task 3 — Lançamento diário

**Criar:** `src/pages/ProducaoForm.tsx`
**Alterar:** `src/pages/Producao.tsx`, `src/App.tsx`, CSS do módulo

- Formulário de parede/face, serviço, unidade, participantes e preço do dia.
- Lista dinâmica de portas/janelas/outros vãos.
- Prévia de cálculo e rateio; banco continua fonte de verdade.
- Lista/filtros e edição/inativação apenas enquanto livre.
- Testar 1, 2 e 3 profissionais e múltiplas aberturas no celular.

## Task 4 — Dias salariais e classificação diária

**Alterar:** `src/pages/Producao.tsx`, CSS

- Profissional + intervalo; lista/calendário com produção, salarial, não trabalhado e pendente.
- Marcação explícita de dia salarial integral com motivo.
- Permitir qualquer data; bloquear conflito com produção.
- Não gravar “não trabalhado” no MVP: é apenas classificação visual confirmada no fechamento.

## Task 5 — Fechamento e aprovação

**Criar:** `src/pages/ProducaoMedicaoForm.tsx`
**Alterar:** `src/pages/Medicoes.tsx`, `src/App.tsx`, estilos

- Aba Produção própria em `/medicoes` e criação por profissional/período.
- Prévia diária e por serviço; alertar dias não classificados.
- Criar rascunho por RPC; aprovação admin atômica gera snapshots.
- Fluxos aprovada → paga e cancelamento com motivo.
- Confirmar que cancelamento libera itens sem apagar histórico.

## Task 6 — PDF

**Criar:** `src/lib/producaoMedicaoPdf.ts`

- Cabeçalho RT e número `MP-###`.
- Memória diária, paredes/rateios, preços históricos e dias salariais.
- Totais separados e total aprovado.
- Validar paginação com período longo e muitas paredes.

## Task 7 — Revisão de segurança e regressão

- Testar manipulação direta: áreas, valores, fração, titular, status e vínculos.
- Testar corrida de duas aprovações e duplicidade do mesmo lançamento.
- Testar update da origem e do destino para impedir “desvio” de snapshot aprovado.
- Revalidar medições contratuais existentes sem alteração de comportamento.
- `npx tsc --noEmit`, `npm run build`, `git diff --check`.

## Task 8 — Teste guiado e documentação

- Admin: cadastrar salários, produzir parede compartilhada, marcar dias salariais, fechar,
  aprovar, imprimir, pagar e cancelar um cenário de teste.
- Equipe com permissão: lançar/preparar; sem botão de aprovação.
- Equipe sem permissão e cliente: sem acesso.
- Testar desktop e celular.
- Criar `docs/fase7_producao_propria.md` e atualizar `AGENTS.md` somente após entrega real.
- Remover ou marcar dados fictícios; aceite final depende de uso com medição real.

## Ordem de commits sugerida

1. `Produção própria: banco, cálculos e RLS`
2. `Produção própria: salários e lançamentos diários`
3. `Produção própria: dias salariais e fechamento`
4. `Produção própria: aprovação, pagamento e PDF`
5. `Docs: registra entrega da Produção própria`

## Condição para iniciar

Rodrigo aprova explicitamente esta spec e o plano. Depois disso, implementar por tasks, com
revisão do banco antes da interface e validação de cada etapa antes de avançar.
