# Fase 7 — Planejamento lookahead e PPC

> Entregue a partir de 19/07/2026 e evoluído com ajustes visuais e operacionais em produção. Módulo novo ligado ao Cronograma existente, com restrições, planejamento semanal, PPC e visão trimestral.

## O que foi entregue

- **Rota `/planejamento`:** módulo próprio no menu.
- **Restrições:** cadastro e acompanhamento de restrições vinculadas à obra e ao cronograma.
- **Planejamento semanal:** seleção de compromissos por semana, com vínculo ao Cronograma existente.
- **Travamento por restrição aberta:** compromisso semanal respeita restrições abertas conforme regra de banco.
- **Fechamento da semana:** fluxo para fechar planejamento semanal e calcular PPC.
- **PPC:** percentual de pacotes concluídos dentro da semana planejada, com histórico preservado.
- **Visão mensal/trimestral:** agregações para acompanhamento gerencial.
- **Gantt do planejamento:** impressão/PDF em formato de ficha semanal, focado no planejado da semana.
- **Calendário mensal:** impressão em A4 com as informações planejadas nas semanas lançadas.

## Ajustes pós-uso real

- O Gantt passou a mostrar apenas o que foi planejado, sem série de executado, porque a execução/PPC já ficou clara na tela principal.
- A seleção da semana foi reorganizada com ano, mês e semana de segunda a sexta, mantendo botão de criação manual para exceções fora do cronograma.
- O layout do Gantt foi ajustado para reduzir sobreposição visual de cards/boxes no desktop.
- A impressão do calendário foi corrigida para caber cabeçalho e calendário na mesma folha A4.
- A visualização operacional ganhou melhorias de leitura para uso semanal em campo/escritório.

## Regras importantes

- O módulo usa o Cronograma existente como fonte de tarefas; não cria hierarquia paralela.
- O fechamento de semana/PPC é dado de rastreabilidade e deve permanecer histórico.
- Alterações em RLS, RPC ou gatilhos desse módulo continuam em categoria de risco e exigem revisão do Claude Code antes de teste de campo.

## Arquivos principais

- Banco: `supabase/migrations/20260719_planejamento.sql` e correções posteriores.
- Frontend: `src/pages/Planejamento.tsx`, `src/pages/Planejamento.module.css`.
- PDF/Gantt/calendário: helpers ligados à tela de Planejamento.
- Tipos/rotas/menu: `src/lib/supabase.ts`, `src/App.tsx`, `src/components/Layout.tsx`.

## Pendências

- Continuar refinando o Gantt conforme uso real do Rodrigo.
- Avaliar alertas futuros para restrições vencidas e compromissos próximos do prazo.
