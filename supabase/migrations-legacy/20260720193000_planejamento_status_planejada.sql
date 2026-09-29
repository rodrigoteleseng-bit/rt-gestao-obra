-- Novo estágio intermediário no ciclo da semana de planejamento: aberta -> planejada -> fechada.
-- "Planejada" trava novos compromissos sem ainda calcular PPC (isso continua só no fechamento final).
-- Precisa ficar isolado num migration próprio: Postgres não permite usar um valor de enum
-- recém-criado na mesma transação em que ele foi adicionado.
ALTER TYPE status_semana_planejamento ADD VALUE IF NOT EXISTS 'planejada' BEFORE 'fechada';
