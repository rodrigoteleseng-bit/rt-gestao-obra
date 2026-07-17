# Fase 7 — Produção própria

> Implementada em 16/07/2026. Seleção de parede por planta PDF implementada em 17/07/2026; aguardando revisão obrigatória do Claude Code antes de teste com dados reais por Rodrigo.

## Entrega original

- Cadastro de salário/hora por profissional ativo do Efetivo.
- Configuração por obra: percentuais de rateio por serviço, fatores de produção, encargos padrão e valor por metro pago ao profissional.
- Lançamento diário de produção própria com múltiplos profissionais e cálculo automático de custo total, custo/m², produção equivalente e valor devido.
- Relatório por profissional e relatório consolidado por serviço.
- Dashboard com KPIs de produção própria.
- Lançamentos aprovados ficam travados; cancelamento apenas por admin via lançamento reverso.
- Cliente não acessa o módulo.

## Entrega complementar — planta PDF clicável

- Nova aba **Plantas** em Produção própria.
- Upload de planta em PDF por obra, pavimento e unidade opcional.
- Conversão do PDF para imagem no navegador para uso como base visual.
- Cadastro de paredes por clique/desenho sobre a planta, com código, serviço, pavimento, unidade opcional e metas de alvenaria/reboco.
- Lançamento diário selecionando a parede diretamente na planta, com:
  - saldo independente por sobrado/unidade;
  - alvenaria controlada por parede;
  - reboco controlado por face A/B;
  - bloqueio de lançamento acima do saldo;
  - cancelamento lógico com motivo, recalculando o saldo.
- Fluxo legado por comprimento × altura preservado no histórico, mas o novo fluxo operacional passa a ser por parede cadastrada.

## Banco

Migração base já existente:

- `supabase/migrations/20260716_fase7_producao_propria.sql`

Migrações criadas nesta entrega:

- `supabase/migrations/20260718_producao_plantas_paredes.sql`
- `supabase/migrations/20260718_producao_progresso_lancamento.sql`

Principais objetos adicionados/alterados:

- Tabelas `producao_plantas`, `producao_paredes` e `producao_paredes_progresso`.
- Bucket `producao-plantas` para armazenar PDFs e imagens convertidas.
- Políticas RLS por obra e por módulo.
- RPCs `producao_registrar_producao_parede`, `producao_cancelar_lancamento` e `producao_editar_meta_parede`.
- Triggers de inicialização, preparo e recálculo ajustados para suportar lançamentos por parede e preservar lançamentos legados.

## Arquivos principais

- `src/pages/Producao.tsx`
- `src/pages/Producao.module.css`
- `src/components/PlantaClicavel.tsx`
- `src/components/PlantaClicavel.module.css`
- `src/lib/pdfParaImagem.ts`
- `src/lib/supabase.ts`

## Teste guiado após revisão do Claude Code

Não executar com dados reais antes da revisão obrigatória.

Roteiro funcional recomendado:

1. Entrar como admin em Produção própria → Plantas.
2. Cadastrar uma planta PDF de um pavimento.
3. Conferir se o PDF é convertido em imagem e exibido corretamente no celular e no desktop.
4. Desenhar uma parede sobre a planta e salvar com meta de alvenaria e reboco.
5. Entrar em Lançamentos, selecionar a mesma parede pela planta e lançar alvenaria para um sobrado.
6. Confirmar que o saldo diminui apenas para aquele sobrado/unidade.
7. Lançar reboco na face A e depois na face B, confirmando saldos independentes por face.
8. Tentar lançar quantidade acima do saldo e confirmar bloqueio pelo banco.
9. Cancelar um lançamento ainda não aprovado e confirmar que o saldo retorna.
10. Aprovar um lançamento e confirmar que cancelamento/edição indevida fica bloqueada.
11. Repetir o fluxo em tela de celular, validando clique/toque e legibilidade.

## Pontos de atenção

- A alteração envolve RLS, triggers e RPC de escrita composta; revisão do Claude Code é obrigatória antes do teste real.
- A aplicação das migrações no Supabase deve preservar o isolamento por obra e as permissões por módulo.
- A Task 2 altera triggers de `producao_lancamentos`, tabela que já pode ter dados reais; antes de aplicar em produção, validar em transação com `ROLLBACK`.
- O push para `main` aciona deploy automático na Vercel; não fazer push antes de a estratégia de migração estar confirmada.

## Fora do MVP

- Edição visual avançada da parede após desenho.
- Múltiplas páginas de PDF no mesmo cadastro de planta.
- Importação automática de paredes por leitura vetorial/CAD.
- Relatório PDF específico da nova visão de plantas.