# Fase 7 — Produção própria

> Implementada em 16/07/2026. Seleção de parede por planta PDF implementada em 17/07/2026; revisão obrigatória do Claude Code concluída em 17/07/2026 (`docs/revisao-2026-07-17-producao-selecao-parede.md`), achados tratados e migrações aplicadas em produção pelo próprio Claude Code (transferência excepcional, Codex indisponível até 23/07/2026 — ver `docs/sequencia-trabalho-codex-claude.md` §10). Aguardando teste com dados reais por Rodrigo.

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
- Cadastro de paredes por clique/desenho sobre a planta (uma vez por pavimento, reaproveitada nos 13 sobrados), com nome e metas de alvenaria e/ou reboco (face A/B). Serviço, sobrado e saldo produzido ficam em `producao_paredes_progresso`, não na parede — a mesma parede cadastrada uma vez é compartilhada por todos os sobrados "Tipo", cada um com saldo independente.
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

- Revisão do Claude Code concluída em 17/07/2026 (`docs/revisao-2026-07-17-producao-selecao-parede.md`): 1 achado crítico (migrações não aplicadas em produção, embora o frontend já estivesse em `main`) e 1 achado médio (destaque visual de parede concluída não aparecia — `saldoPorParede` não chegava ao `PlantaClicavel` em Lançamentos), ambos tratados no mesmo dia.
- As duas migrações (`20260718_producao_plantas_paredes.sql` e `20260718_producao_progresso_lancamento.sql`) foram aplicadas em produção pelo Claude Code em 17/07/2026 — a segunda foi validada antes em transação com `ROLLBACK` (a tabela `producao_lancamentos` estava vazia em produção, sem lançamentos reais ainda, então o risco era baixo).
- Isolamento por obra e permissões por módulo confirmados na revisão (RLS via função `SECURITY DEFINER` dedicada por tabela-pai, nunca subquery inline).
- Arquivos órfãos no Storage ao recadastrar uma planta (achado baixo, não bloqueante) ficam para uma iteração futura se o uso real mostrar que o recadastro é frequente.

## Ajustes de uso real — 21/07/2026

- **Status visual das paredes:** a planta passou a diferenciar parede sem lançamento, parcialmente lançada e 100% lançada, para o usuário enxergar rapidamente o que falta produzir.
- **Botão 100%/total:** no lançamento por parede, foi criado atalho para lançar o saldo total da parede sem precisar digitar a área manualmente.
- **Lançamentos recentes filtrados:** a lista inferior passou a mostrar apenas lançamentos da unidade selecionada e do serviço selecionado, evitando misturar, por exemplo, alvenaria do Sobrado 01 com lançamentos de outros sobrados/serviços.
- **Edição de lançamento:** lançamentos já feitos podem ter valor e data corrigidos quando houver erro de digitação, preservando rastreabilidade conforme regras do módulo.

## Fora do MVP

- Edição visual avançada da parede após desenho.
- Múltiplas páginas de PDF no mesmo cadastro de planta.
- Importação automática de paredes por leitura vetorial/CAD.
- Relatório PDF específico da nova visão de plantas.
