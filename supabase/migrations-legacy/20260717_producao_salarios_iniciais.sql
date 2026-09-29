-- Valores iniciais aprovados para a equipe de produção própria.
-- A vigência começa em 01/07/2026 para cobrir integralmente o mês corrente.

UPDATE producao_salarios s
SET salario_mensal = CASE
  WHEN upper(t.funcao) = 'PEDREIRO' THEN 4154.00
  ELSE 2405.60
END
FROM trabalhadores t
WHERE s.trabalhador_id = t.id
  AND s.ativo
  AND s.vigente_ate IS NULL
  AND (
    upper(t.funcao) = 'PEDREIRO'
    OR upper(t.funcao) IN ('AJUDANTE', 'AJUDANTE DE OBRAS', 'AJUDANTE SERVENTE', 'SERVENTE', 'SERVENTE DE OBRAS')
  );

INSERT INTO producao_salarios (
  obra_id,
  trabalhador_id,
  funcao,
  salario_mensal,
  vigente_desde,
  criado_por
)
SELECT
  t.obra_id,
  t.id,
  t.funcao,
  CASE
    WHEN upper(t.funcao) = 'PEDREIRO' THEN 4154.00
    ELSE 2405.60
  END,
  DATE '2026-07-01',
  (SELECT id FROM perfis_usuario WHERE papel = 'admin' AND ativo LIMIT 1)
FROM trabalhadores t
WHERE t.ativo
  AND (
    upper(t.funcao) = 'PEDREIRO'
    OR upper(t.funcao) IN ('AJUDANTE', 'AJUDANTE DE OBRAS', 'AJUDANTE SERVENTE', 'SERVENTE', 'SERVENTE DE OBRAS')
  )
  AND NOT EXISTS (
    SELECT 1
    FROM producao_salarios s
    WHERE s.trabalhador_id = t.id
      AND s.ativo
      AND s.vigente_ate IS NULL
  );
