-- Hardening do Controle Tecnológico (achados da revisão da Task 1):
-- 1) pode_editar_controle_tecnologico() ficou sem SET search_path = public ao
--    ser criada em 20260909_ct_schema.sql — reintroduzia a classe de
--    vulnerabilidade já corrigida em 20260719143226_hardening_pode_editar_e_triggers.sql
--    (chama meu_papel()/meus_modulos(), ambas SECURITY DEFINER, por referência
--    não qualificada — search-path hijackable sem o SET).
-- 2) Bucket 'controle-tecnologico' nunca foi incluído na policy restritiva
--    isolamento_obra_storage, então não tinha isolamento por obra (só regra de
--    papel/módulo) — qualquer admin/equipe podia ler/gravar arquivo de
--    qualquer obra. Estende a policy existente com o mesmo padrão já usado em
--    rdo/fvs/pendencias/projetos/contratos-assinados (path começa com
--    {obra_id}/...). Texto-base copiado de 20260909_contratos_anexos.sql, a
--    migração mais recente que tocou essa policy.

ALTER FUNCTION pode_editar_controle_tecnologico() SET search_path = public;

DROP POLICY isolamento_obra_storage ON storage.objects;

CREATE POLICY isolamento_obra_storage ON storage.objects AS RESTRICTIVE FOR ALL TO authenticated
USING (
  bucket_id NOT IN ('rdo','fvs','pendencias','cotacoes-nf','projetos','contratos-assinados','controle-tecnologico')
  OR CASE
    WHEN bucket_id IN ('rdo','fvs','pendencias','projetos','contratos-assinados','controle-tecnologico') THEN
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
  bucket_id NOT IN ('rdo','fvs','pendencias','cotacoes-nf','projetos','contratos-assinados','controle-tecnologico')
  OR CASE
    WHEN bucket_id IN ('rdo','fvs','pendencias','projetos','contratos-assinados','controle-tecnologico') THEN
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
