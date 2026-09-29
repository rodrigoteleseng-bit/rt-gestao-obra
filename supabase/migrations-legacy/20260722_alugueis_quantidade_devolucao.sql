-- Alugueis: renomeia ferramenta -> equipamento, adiciona quantidade e
-- suporte a devolucao parcial. Ver
-- docs/superpowers/specs/2026-07-22-alugueis-equipamento-quantidade-design.md

ALTER TABLE ferramenta_locacoes RENAME COLUMN nome_ferramenta TO nome_equipamento;

ALTER TABLE ferramenta_locacoes ADD COLUMN quantidade INTEGER NOT NULL DEFAULT 1 CHECK (quantidade > 0);
ALTER TABLE ferramenta_locacoes ALTER COLUMN quantidade DROP DEFAULT;

CREATE TABLE ferramenta_locacoes_devolucoes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  locacao_id    UUID NOT NULL REFERENCES ferramenta_locacoes(id) ON DELETE CASCADE,
  quantidade    INTEGER NOT NULL CHECK (quantidade > 0),
  devolvido_por UUID NOT NULL DEFAULT auth.uid() REFERENCES perfis_usuario(id),
  devolvido_em  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ferramenta_locacoes_devolucoes_locacao
  ON ferramenta_locacoes_devolucoes(locacao_id);

-- Bloqueia devolver mais do que o saldo pendente, ou devolver algo numa
-- locacao ja encerrada.
CREATE OR REPLACE FUNCTION validar_devolucao_locacao() RETURNS TRIGGER AS $$
DECLARE
  v_quantidade_total INTEGER;
  v_ja_devolvido      INTEGER;
  v_data_entregue     DATE;
BEGIN
  SELECT quantidade, data_entregue INTO v_quantidade_total, v_data_entregue
  FROM ferramenta_locacoes WHERE id = NEW.locacao_id;

  IF v_data_entregue IS NOT NULL THEN
    RAISE EXCEPTION 'Esta locacao ja foi encerrada.';
  END IF;

  SELECT COALESCE(SUM(quantidade), 0) INTO v_ja_devolvido
  FROM ferramenta_locacoes_devolucoes WHERE locacao_id = NEW.locacao_id;

  IF v_ja_devolvido + NEW.quantidade > v_quantidade_total THEN
    RAISE EXCEPTION 'Quantidade devolvida (%) ultrapassa o saldo pendente (%).',
      NEW.quantidade, v_quantidade_total - v_ja_devolvido;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_validar_devolucao_locacao
  BEFORE INSERT ON ferramenta_locacoes_devolucoes
  FOR EACH ROW EXECUTE FUNCTION validar_devolucao_locacao();

-- Fecha a locacao (mesmos campos ja existentes) quando a soma devolvida
-- bate exatamente com a quantidade total.
CREATE OR REPLACE FUNCTION fechar_locacao_se_completa() RETURNS TRIGGER AS $$
DECLARE
  v_quantidade_total INTEGER;
  v_total_devolvido  INTEGER;
BEGIN
  SELECT quantidade INTO v_quantidade_total
  FROM ferramenta_locacoes WHERE id = NEW.locacao_id;

  SELECT COALESCE(SUM(quantidade), 0) INTO v_total_devolvido
  FROM ferramenta_locacoes_devolucoes WHERE locacao_id = NEW.locacao_id;

  IF v_total_devolvido = v_quantidade_total THEN
    UPDATE ferramenta_locacoes
    SET data_entregue = CURRENT_DATE, entregue_por = NEW.devolvido_por, entregue_em = now()
    WHERE id = NEW.locacao_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_fechar_locacao_se_completa
  AFTER INSERT ON ferramenta_locacoes_devolucoes
  FOR EACH ROW EXECUTE FUNCTION fechar_locacao_se_completa();

ALTER TABLE ferramenta_locacoes_devolucoes ENABLE ROW LEVEL SECURITY;

CREATE POLICY flocdev_select ON ferramenta_locacoes_devolucoes FOR SELECT TO authenticated
  USING (pode_editar_almoxarifado());

CREATE POLICY flocdev_insert ON ferramenta_locacoes_devolucoes FOR INSERT TO authenticated
  WITH CHECK (pode_editar_almoxarifado() AND devolvido_por = auth.uid());

CREATE POLICY isolamento_obra ON ferramenta_locacoes_devolucoes AS RESTRICTIVE FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM ferramenta_locacoes fl WHERE fl.id = locacao_id AND pode_acessar_obra(fl.obra_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM ferramenta_locacoes fl WHERE fl.id = locacao_id AND pode_acessar_obra(fl.obra_id)));
