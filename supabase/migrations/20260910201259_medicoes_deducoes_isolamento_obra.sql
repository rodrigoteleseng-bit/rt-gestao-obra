CREATE POLICY isolamento_obra ON medicoes_deducoes AS RESTRICTIVE FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM medicoes m JOIN contratos c ON c.id = m.contrato_id
    WHERE m.id = medicoes_deducoes.medicao_id AND pode_acessar_obra(c.obra_id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM medicoes m JOIN contratos c ON c.id = m.contrato_id
    WHERE m.id = medicoes_deducoes.medicao_id AND pode_acessar_obra(c.obra_id)
  ));;
