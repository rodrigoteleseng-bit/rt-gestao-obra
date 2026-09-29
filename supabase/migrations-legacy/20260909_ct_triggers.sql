-- Rastreabilidade de volta: de qual caminhão essa pendência veio (mesmo
-- padrão já usado em pendencias.fvs_id, ver 20260709_fase5_fvs.sql:97).
ALTER TABLE pendencias ADD COLUMN ct_caminhao_id UUID REFERENCES ct_caminhoes(id);
CREATE INDEX idx_pendencias_ct_caminhao ON pendencias(ct_caminhao_id);

-- Anexar/trocar o laudo e mudar status_laudo é exclusivo do admin, travado
-- no banco — mesmo padrão de "aprovação exclusiva do admin" já usado em
-- Medições/FVS, não só na interface.
CREATE OR REPLACE FUNCTION ct_restringir_laudo() RETURNS TRIGGER AS $$
BEGIN
  IF (NEW.status_laudo IS DISTINCT FROM OLD.status_laudo
      OR NEW.laudo_url IS DISTINCT FROM OLD.laudo_url)
     AND meu_papel() <> 'admin' THEN
    RAISE EXCEPTION 'Somente o admin pode anexar ou validar o laudo.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_ct_restringir_laudo
  BEFORE UPDATE ON ct_caminhoes
  FOR EACH ROW EXECUTE FUNCTION ct_restringir_laudo();

-- Laudo reprovado gera Pendência automática vinculada à Unidade da
-- concretagem — mesmo padrão já usado quando um item de FVS reprova
-- (ver 20260709_fase5_fvs.sql:238-248).
CREATE OR REPLACE FUNCTION ct_gerar_pendencia_reprovado() RETURNS TRIGGER AS $$
DECLARE
  v_obra_id    UUID;
  v_unidade_id UUID;
  v_pend_id    UUID;
BEGIN
  IF NEW.status_laudo = 'reprovado' AND OLD.status_laudo IS DISTINCT FROM 'reprovado' THEN
    SELECT obra_id, unidade_id INTO v_obra_id, v_unidade_id
    FROM ct_concretagens WHERE id = NEW.concretagem_id;

    INSERT INTO pendencias (obra_id, unidade_id, descricao, ct_caminhao_id, criado_por)
    VALUES (
      v_obra_id, v_unidade_id,
      'Concreto reprovado — amostra ' || NEW.numero_amostra || ', NF ' || NEW.nf
        || ', fornecedor ' || NEW.fornecedor,
      NEW.id, auth.uid()
    ) RETURNING id INTO v_pend_id;

    INSERT INTO pendencia_eventos (pendencia_id, status, comentario, criado_por)
    VALUES (v_pend_id, 'aberta',
      'Gerada automaticamente pelo Controle Tecnológico (laudo reprovado)', auth.uid());

    NEW.pendencia_id := v_pend_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_ct_gerar_pendencia
  BEFORE UPDATE ON ct_caminhoes
  FOR EACH ROW EXECUTE FUNCTION ct_gerar_pendencia_reprovado();
