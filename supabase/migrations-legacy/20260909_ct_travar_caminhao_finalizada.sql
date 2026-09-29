-- Nao lancar novo caminhao numa concretagem ja finalizada, trava no banco
-- (nao so na interface) -- fecha o requisito da spec de que "Finalizar"
-- trava a lista de caminhoes, achado na revisao da Task 4.
-- Update fica sem essa checagem de proposito: o acompanhamento do laudo
-- de um caminhao ja lancado continua editavel mesmo apos a concretagem
-- finalizada (spec 2026-09-09-controle-tecnologico-concreto-design.md §2).
DROP POLICY ct_caminhoes_insert ON ct_caminhoes;
CREATE POLICY ct_caminhoes_insert ON ct_caminhoes FOR INSERT
  WITH CHECK (
    pode_editar_controle_tecnologico()
    AND EXISTS (
      SELECT 1 FROM ct_concretagens cc
      WHERE cc.id = concretagem_id AND cc.status = 'aberta'
    )
  );
