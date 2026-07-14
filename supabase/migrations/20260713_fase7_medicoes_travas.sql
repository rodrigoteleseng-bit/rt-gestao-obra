-- ============================================================
-- FASE 7 — MEDIÇÕES: fecha 3 lacunas encontradas na revisão da
-- Task 1 (2026-07-13) — todas presentes desde a primeira versão
-- da migração, corrigidas ainda no mesmo dia antes de construir
-- a interface por cima (mesmo padrão já usado em Contratos).
-- ============================================================

-- 1) mi_update permitia reatribuir medicao_id de um item que
--    pertencia a uma medição já aprovada (USING só validava o
--    destino, nunca a origem) — corrigido exigindo que a medição
--    ATUAL do item (linha antiga) também esteja em rascunho.
DROP POLICY mi_update ON medicoes_itens;
CREATE POLICY mi_update ON medicoes_itens FOR UPDATE
  USING (
    pode_editar_medicoes()
    AND EXISTS (SELECT 1 FROM medicoes m WHERE m.id = medicao_id AND m.status = 'rascunho')
  )
  WITH CHECK (
    pode_editar_medicoes()
    AND EXISTS (SELECT 1 FROM medicoes m WHERE m.id = medicao_id AND m.status = 'rascunho')
  );

-- 2) validar_saldo_medicao somava por linha, então duas linhas do
--    mesmo contrato_item_id na mesma medição furavam a trava
--    (cada uma passava isolada). Corrigido agrupando por item antes
--    de comparar, e travado também por índice único (nunca deveria
--    existir 2 linhas ativas do mesmo item na mesma medição).
CREATE UNIQUE INDEX idx_medicoes_itens_unico_por_medicao
  ON medicoes_itens(medicao_id, contrato_item_id) WHERE ativo = true;

CREATE OR REPLACE FUNCTION validar_saldo_medicao() RETURNS TRIGGER AS $$
DECLARE
  v_item RECORD;
  v_ja_aprovado NUMERIC(14,4);
BEGIN
  IF NEW.status = 'aprovada' AND OLD.status = 'rascunho' THEN
    FOR v_item IN
      SELECT mi.contrato_item_id, SUM(mi.quantidade_periodo) AS quantidade_periodo,
             ci.quantidade AS quantidade_contratada
      FROM medicoes_itens mi
      JOIN contratos_itens ci ON ci.id = mi.contrato_item_id
      WHERE mi.medicao_id = NEW.id AND mi.ativo = true
      GROUP BY mi.contrato_item_id, ci.quantidade
    LOOP
      SELECT COALESCE(SUM(mi2.quantidade_periodo), 0) INTO v_ja_aprovado
      FROM medicoes_itens mi2
      JOIN medicoes m2 ON m2.id = mi2.medicao_id
      WHERE mi2.contrato_item_id = v_item.contrato_item_id
        AND mi2.ativo = true
        AND m2.status = 'aprovada'
        AND m2.id <> NEW.id;

      IF v_ja_aprovado + v_item.quantidade_periodo > v_item.quantidade_contratada THEN
        RAISE EXCEPTION 'Quantidade medida (%) ultrapassa o saldo contratado do item (contratado: %, já aprovado: %).',
          v_item.quantidade_periodo, v_item.quantidade_contratada, v_ja_aprovado;
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 3) valor_bruto/valor_retido/valor_liquido eram graváveis
--    diretamente por qualquer sessão com pode_editar_medicoes()
--    (nenhum trigger impedia sobrescrever o valor calculado).
--    Corrigido: qualquer alteração direta (fora da chamada interna
--    de recalcular_valor_medicao) é revertida para o valor anterior,
--    sem erro — o cliente nunca escreve esses campos, então isso é
--    transparente ao app. Detecção via pg_trigger_depth(): uma
--    chamada direta do cliente (UPDATE medicoes ...) executa este
--    trigger em profundidade 1; a chamada interna feita de dentro de
--    recalcular_valor_medicao (que já está rodando como trigger)
--    executa este trigger em profundidade 2 — só essa é permitida.
CREATE OR REPLACE FUNCTION proteger_valores_medicao() RETURNS TRIGGER AS $$
BEGIN
  IF pg_trigger_depth() <= 1 THEN
    NEW.valor_bruto := OLD.valor_bruto;
    NEW.valor_retido := OLD.valor_retido;
    NEW.valor_liquido := OLD.valor_liquido;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_proteger_valores_medicao
  BEFORE UPDATE ON medicoes
  FOR EACH ROW EXECUTE FUNCTION proteger_valores_medicao();
