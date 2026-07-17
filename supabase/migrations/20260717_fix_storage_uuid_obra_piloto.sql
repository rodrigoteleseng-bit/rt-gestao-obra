-- A obra piloto usa UUID canônico com versão zero
-- (00000000-0000-0000-0000-000000000001). A validação anterior aceitava
-- apenas UUIDs de versão 1 a 5 e bloqueava uploads antes de pode_acessar_obra().

DROP POLICY IF EXISTS isolamento_obra_storage ON storage.objects;
CREATE POLICY isolamento_obra_storage ON storage.objects
AS RESTRICTIVE FOR ALL TO authenticated
USING (
  bucket_id NOT IN ('rdo', 'fvs', 'pendencias', 'cotacoes-nf')
  OR CASE
    WHEN bucket_id IN ('rdo', 'fvs', 'pendencias') THEN
      split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      AND pode_acessar_obra(split_part(name, '/', 1)::UUID)
    WHEN bucket_id = 'cotacoes-nf' THEN
      split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      AND EXISTS (
        SELECT 1 FROM pedidos_compra p
        WHERE p.id = split_part(name, '/', 1)::UUID
          AND pode_acessar_obra(p.obra_id)
      )
    ELSE false
  END
)
WITH CHECK (
  bucket_id NOT IN ('rdo', 'fvs', 'pendencias', 'cotacoes-nf')
  OR CASE
    WHEN bucket_id IN ('rdo', 'fvs', 'pendencias') THEN
      split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      AND pode_acessar_obra(split_part(name, '/', 1)::UUID)
    WHEN bucket_id = 'cotacoes-nf' THEN
      split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      AND EXISTS (
        SELECT 1 FROM pedidos_compra p
        WHERE p.id = split_part(name, '/', 1)::UUID
          AND pode_acessar_obra(p.obra_id)
      )
    ELSE false
  END
);
