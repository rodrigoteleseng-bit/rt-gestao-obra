ALTER TABLE cronograma_tarefas ADD COLUMN IF NOT EXISTS und TEXT;
ALTER TABLE cronograma_tarefas ADD COLUMN IF NOT EXISTS quant_total NUMERIC(14,4);
ALTER TABLE cronograma_tarefas ADD COLUMN IF NOT EXISTS quant_definida_por UUID REFERENCES perfis_usuario(id);
ALTER TABLE cronograma_tarefas ADD COLUMN IF NOT EXISTS quant_definida_em TIMESTAMPTZ;

ALTER TABLE avancos_fisicos ADD COLUMN IF NOT EXISTS quantidade NUMERIC(14,4);

CREATE OR REPLACE FUNCTION definir_quantidade_tarefa(p_tarefa UUID, p_quant NUMERIC, p_und TEXT)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NOT (
    meu_papel() = 'admin'
    OR (meu_papel() = 'equipe' AND 'avanco' = ANY(meus_modulos()))
  ) THEN
    RAISE EXCEPTION 'Sem permissao para definir quantidade';
  END IF;
  IF p_quant IS NULL OR p_quant <= 0 THEN
    RAISE EXCEPTION 'Quantidade total deve ser maior que zero';
  END IF;
  IF p_und IS NULL OR btrim(p_und) = '' THEN
    RAISE EXCEPTION 'Unidade obrigatoria';
  END IF;
  UPDATE cronograma_tarefas
  SET und = btrim(p_und),
      quant_total = p_quant,
      quant_definida_por = auth.uid(),
      quant_definida_em = now()
  WHERE id = p_tarefa AND resumo = false AND ativo = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tarefa nao encontrada ou nao e tarefa-folha';
  END IF;
END $$;;
