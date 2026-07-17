-- Fix: producao_paredes referenciava a si mesma na própria política de isolamento
-- (pode_acessar_parede(id) faz SELECT em producao_paredes procurando a linha que
-- está sendo inserida naquele exato momento). A linha recém-inserida não fica
-- visível pra essa subconsulta durante o INSERT, então o WITH CHECK falha e o
-- Postgres bloqueia com "new row violates row-level security policy" mesmo para
-- quem tem permissão. Corrigido para checar via o pai (producao_plantas)
-- diretamente, sem se auto-referenciar — mesmo padrão já usado em
-- producao_paredes_progresso (que referencia o pai producao_paredes, não a si
-- mesma).
-- Achado reportado por Rodrigo em teste real em 17/07/2026: erro ao cadastrar
-- parede nova preenchendo só a meta de alvenaria.

DROP POLICY IF EXISTS isolamento_obra ON producao_paredes;
CREATE POLICY isolamento_obra ON producao_paredes AS RESTRICTIVE FOR ALL TO authenticated
  USING (pode_acessar_planta(planta_id)) WITH CHECK (pode_acessar_planta(planta_id));
