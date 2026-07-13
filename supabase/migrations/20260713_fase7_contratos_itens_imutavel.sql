-- Itens de contrato são imutáveis quando o contrato não está mais em
-- rascunho — nem admin edita item de contrato ativo/encerrado (só a
-- mudança de status em si tem exceção pra admin, via
-- restringir_status_contrato). Corrige policy original que replicava
-- por engano o bypass de admin usado em Compras; a regra de Contratos
-- é diferente (spec docs/superpowers/specs/2026-07-13-fase7-contratos-design.md
-- §4: "contrato ativo é imutável").

DROP POLICY ci_insert ON contratos_itens;
CREATE POLICY ci_insert ON contratos_itens FOR INSERT
  WITH CHECK (
    pode_editar_contratos()
    AND EXISTS (SELECT 1 FROM contratos c WHERE c.id = contrato_id AND c.status = 'rascunho')
  );

DROP POLICY ci_update ON contratos_itens;
CREATE POLICY ci_update ON contratos_itens FOR UPDATE
  USING (pode_editar_contratos())
  WITH CHECK (
    pode_editar_contratos()
    AND EXISTS (SELECT 1 FROM contratos c WHERE c.id = contrato_id AND c.status = 'rascunho')
  );
