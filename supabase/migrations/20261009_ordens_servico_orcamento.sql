-- Solicitações para cotar serviço usam a mesma série OS das ordens diretas,
-- mas não têm fornecedor/valor e não geram lançamento financeiro.

CREATE TYPE tipo_ordem_servico AS ENUM ('orcamento', 'ordem_compra');

ALTER TABLE ordens_servico
  ADD COLUMN tipo tipo_ordem_servico NOT NULL DEFAULT 'ordem_compra';

ALTER TABLE ordens_servico
  ALTER COLUMN fornecedor_id DROP NOT NULL,
  ALTER COLUMN valor DROP NOT NULL;

ALTER TABLE ordens_servico DROP CONSTRAINT IF EXISTS ordens_servico_valor_check;
ALTER TABLE ordens_servico
  ADD CONSTRAINT ordens_servico_tipo_dados_check CHECK (
    (tipo = 'orcamento' AND fornecedor_id IS NULL AND valor IS NULL AND data_vencimento IS NULL)
    OR
    (tipo = 'ordem_compra' AND fornecedor_id IS NOT NULL AND valor IS NOT NULL AND valor > 0)
  );

CREATE OR REPLACE FUNCTION financeiro_ingerir_ordem_servico()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_fornecedor TEXT;
BEGIN
  IF NEW.tipo = 'orcamento' THEN
    RETURN NEW;
  END IF;

  SELECT nome INTO v_fornecedor FROM fornecedores WHERE id = NEW.fornecedor_id;
  INSERT INTO lancamentos_financeiros (
    obra_id, unidade_id, etapa_id, servico_id, descricao, favorecido, valor,
    ordem_servico_id, status, data_vencimento, criado_por
  ) VALUES (
    NEW.obra_id, NEW.unidade_id, NEW.etapa_id, NEW.servico_id,
    'OS-' || lpad(NEW.numero::text, 3, '0') || ' — ' || NEW.descricao,
    v_fornecedor, NEW.valor, NEW.id, 'a_pagar', NEW.data_vencimento, NEW.criado_por
  );
  RETURN NEW;
END;
$$;

ALTER FUNCTION financeiro_ingerir_ordem_servico() SET search_path = public;
