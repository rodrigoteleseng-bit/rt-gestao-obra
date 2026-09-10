-- Deduções em Medições (regime empreiteiros): algo fornecido pelo RT que
-- não estava no contrato, descontado da medição — descrição, quantidade,
-- valor unitário, valor total. Mesma trava de rascunho de medicoes_itens
-- (sem exceção pra admin). Também adiciona obras.cep, usado no quadro
-- "Dados para Emissão de Nota Fiscal" do PDF junto com cnpj/cno_obra/
-- endereco_escritorio/email (já existentes).
-- Ver docs/superpowers/specs/2026-09-10-medicoes-deducoes-nf-design.md.

ALTER TABLE obras ADD COLUMN cep TEXT;

CREATE TABLE medicoes_deducoes (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  medicao_id     UUID NOT NULL REFERENCES medicoes(id) ON DELETE CASCADE,
  descricao      TEXT NOT NULL,
  quantidade     NUMERIC(14,4) NOT NULL CHECK (quantidade > 0),
  valor_unitario NUMERIC(14,2) NOT NULL CHECK (valor_unitario >= 0),
  valor_total    NUMERIC(14,2) NOT NULL DEFAULT 0,
  ativo          BOOLEAN NOT NULL DEFAULT true,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now(),
  criado_por     UUID NOT NULL DEFAULT auth.uid() REFERENCES perfis_usuario(id)
);

CREATE INDEX idx_medicoes_deducoes_medicao ON medicoes_deducoes(medicao_id);

-- Calcula valor_total da dedução — sem lookup externo, o valor unitário
-- é digitado direto (diferente de medicoes_itens, que busca no contrato).
CREATE OR REPLACE FUNCTION calcular_valor_deducao() RETURNS TRIGGER AS $$
BEGIN
  NEW.valor_total := NEW.quantidade * NEW.valor_unitario;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER trg_calcular_valor_deducao
  BEFORE INSERT OR UPDATE ON medicoes_deducoes
  FOR EACH ROW EXECUTE FUNCTION calcular_valor_deducao();

-- recalcular_valor_medicao() passa a subtrair deduções ativas do líquido.
-- Substitui a função existente (a trigger em medicoes_itens continua
-- apontando pra ela); nova trigger espelho em medicoes_deducoes chama a
-- mesma função.
CREATE OR REPLACE FUNCTION recalcular_valor_medicao() RETURNS TRIGGER AS $$
DECLARE
  v_medicao_id  UUID := COALESCE(NEW.medicao_id, OLD.medicao_id);
  v_contrato_id UUID;
  v_retencao    NUMERIC(5,2);
  v_bruto       NUMERIC(14,2);
  v_retido      NUMERIC(14,2);
  v_deducoes    NUMERIC(14,2);
BEGIN
  SELECT contrato_id INTO v_contrato_id FROM medicoes WHERE id = v_medicao_id;
  SELECT COALESCE(retencao_pct, 0) INTO v_retencao FROM contratos WHERE id = v_contrato_id;

  SELECT COALESCE(SUM(valor_total_item), 0) INTO v_bruto
  FROM medicoes_itens WHERE medicao_id = v_medicao_id AND ativo = true;

  SELECT COALESCE(SUM(valor_total), 0) INTO v_deducoes
  FROM medicoes_deducoes WHERE medicao_id = v_medicao_id AND ativo = true;

  v_retido := ROUND(v_bruto * v_retencao / 100, 2);

  UPDATE medicoes SET
    valor_bruto = v_bruto, valor_retido = v_retido, valor_liquido = v_bruto - v_retido - v_deducoes
  WHERE id = v_medicao_id;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER trg_recalcular_valor_medicao_deducoes
  AFTER INSERT OR UPDATE ON medicoes_deducoes
  FOR EACH ROW EXECUTE FUNCTION recalcular_valor_medicao();

-- RLS — mesma trava de medicoes_itens: editável só em rascunho, sem
-- exceção pra admin fora disso. Regra de soft delete do projeto: SELECT
-- com ativo=true sempre tem "OR pode_editar_medicoes()".
ALTER TABLE medicoes_deducoes ENABLE ROW LEVEL SECURITY;

CREATE POLICY med_deducoes_select ON medicoes_deducoes FOR SELECT
  USING ((ativo = true AND meu_papel() = ANY (ARRAY['admin', 'equipe']::papel_usuario[])) OR pode_editar_medicoes());

CREATE POLICY med_deducoes_insert ON medicoes_deducoes FOR INSERT
  WITH CHECK (
    pode_editar_medicoes()
    AND EXISTS (SELECT 1 FROM medicoes m WHERE m.id = medicao_id AND m.status = 'rascunho')
  );

CREATE POLICY med_deducoes_update ON medicoes_deducoes FOR UPDATE
  USING (
    pode_editar_medicoes()
    AND EXISTS (SELECT 1 FROM medicoes m WHERE m.id = medicao_id AND m.status = 'rascunho')
  )
  WITH CHECK (
    pode_editar_medicoes()
    AND EXISTS (SELECT 1 FROM medicoes m WHERE m.id = medicao_id AND m.status = 'rascunho')
  );

-- RPC de escrita em lote (padrão salvar_itens_contrato): insere (sem id),
-- atualiza (com id) ou soft-deleta (removido=true) numa única chamada.
-- Diferente de itens de medição/contrato, deduções podem ficar vazias —
-- não há exigência de lista mínima.
CREATE OR REPLACE FUNCTION salvar_deducoes_medicao(p_medicao UUID, p_deducoes JSONB)
RETURNS VOID LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE v_contrato UUID; v_obra UUID; v_status status_medicao; v_item JSONB; v_id UUID;
BEGIN
  SELECT m.contrato_id,c.obra_id,m.status INTO v_contrato,v_obra,v_status
  FROM medicoes m JOIN contratos c ON c.id=m.contrato_id WHERE m.id=p_medicao AND m.ativo=true FOR UPDATE OF m;
  IF NOT FOUND OR v_status<>'rascunho' THEN RAISE EXCEPTION 'Medicao inexistente ou fora do rascunho.'; END IF;
  IF NOT pode_editar_medicoes() OR NOT pode_acessar_obra(v_obra) THEN RAISE EXCEPTION 'Sem permissao para editar esta medicao.'; END IF;
  IF jsonb_typeof(p_deducoes) <> 'array' THEN RAISE EXCEPTION 'Lista de deducoes invalida.'; END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_deducoes) LOOP
    v_id := NULLIF(v_item->>'id','')::UUID;
    IF v_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM medicoes_deducoes WHERE id=v_id AND medicao_id=p_medicao) THEN
      RAISE EXCEPTION 'Deducao nao pertence a medicao.';
    END IF;
    IF COALESCE((v_item->>'removido')::BOOLEAN,false) THEN
      IF v_id IS NOT NULL THEN UPDATE medicoes_deducoes SET ativo=false WHERE id=v_id; END IF;
      CONTINUE;
    END IF;
    IF NULLIF(v_item->>'descricao','') IS NULL
      OR COALESCE((v_item->>'quantidade')::NUMERIC,0)<=0
      OR COALESCE((v_item->>'valor_unitario')::NUMERIC,0)<0
    THEN RAISE EXCEPTION 'Deducao invalida.'; END IF;

    IF v_id IS NULL THEN
      INSERT INTO medicoes_deducoes (medicao_id,descricao,quantidade,valor_unitario)
      VALUES (p_medicao,v_item->>'descricao',(v_item->>'quantidade')::NUMERIC,(v_item->>'valor_unitario')::NUMERIC);
    ELSE
      UPDATE medicoes_deducoes SET descricao=v_item->>'descricao',
        quantidade=(v_item->>'quantidade')::NUMERIC, valor_unitario=(v_item->>'valor_unitario')::NUMERIC, ativo=true
      WHERE id=v_id;
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION salvar_deducoes_medicao(UUID,JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION salvar_deducoes_medicao(UUID,JSONB) TO authenticated;
