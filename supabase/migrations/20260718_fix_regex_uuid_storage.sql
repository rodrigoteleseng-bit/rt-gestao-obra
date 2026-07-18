-- ============================================================
-- FIX — regex de UUID no isolamento de Storage bloqueava a obra
-- piloto | RT Engenharia
-- ============================================================
-- Achado durante o teste de campo do modulo Projetos (18/07/2026):
-- upload de PDF falhava com "new row violates row-level security
-- policy" mesmo para admin.
--
-- Causa raiz: a policy isolamento_obra_storage (criada em
-- 20260717_isolamento_usuario_obra.sql) valida o primeiro segmento
-- do path do arquivo com um regex que exige um UUID versao 1-5 com
-- variante RFC4122 (`[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}`). O
-- obra_id da obra piloto e '00000000-0000-0000-0000-000000000001'
-- — um UUID seedado manualmente na Fase 0, sem os nibbles de
-- versao/variante — entao NUNCA bateu com esse regex.
--
-- Isso bloqueava upload novo em QUALQUER bucket que usa esse
-- padrao (rdo, fvs, pendencias, cotacoes-nf), nao so o bucket novo
-- 'projetos' que herdou o mesmo regex por copia. O bucket
-- 'producao-plantas' nunca teve esse problema porque sua policy
-- faz o cast direto pra UUID sem validar versao/variante.
--
-- Correcao: troca o regex por um validador de formato UUID
-- generico (8-4-4-4-12 em hexadecimal), sem exigir versao/variante
-- especificas. Continua bloqueando paths que nao comecem com algo
-- no formato UUID (defesa contra o cast ::UUID falhar com erro).

DROP POLICY isolamento_obra_storage ON storage.objects;

CREATE POLICY isolamento_obra_storage ON storage.objects AS RESTRICTIVE FOR ALL TO authenticated
USING (
  bucket_id NOT IN ('rdo','fvs','pendencias','cotacoes-nf','projetos')
  OR CASE
    WHEN bucket_id IN ('rdo','fvs','pendencias','projetos') THEN
      split_part(name,'/',1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      AND pode_acessar_obra(split_part(name,'/',1)::UUID)
    WHEN bucket_id = 'cotacoes-nf' THEN
      split_part(name,'/',1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      AND EXISTS (
        SELECT 1 FROM pedidos_compra p
        WHERE p.id=split_part(name,'/',1)::UUID AND pode_acessar_obra(p.obra_id)
      )
    ELSE false
  END
)
WITH CHECK (
  bucket_id NOT IN ('rdo','fvs','pendencias','cotacoes-nf','projetos')
  OR CASE
    WHEN bucket_id IN ('rdo','fvs','pendencias','projetos') THEN
      split_part(name,'/',1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      AND pode_acessar_obra(split_part(name,'/',1)::UUID)
    WHEN bucket_id = 'cotacoes-nf' THEN
      split_part(name,'/',1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      AND EXISTS (
        SELECT 1 FROM pedidos_compra p
        WHERE p.id=split_part(name,'/',1)::UUID AND pode_acessar_obra(p.obra_id)
      )
    ELSE false
  END
);
