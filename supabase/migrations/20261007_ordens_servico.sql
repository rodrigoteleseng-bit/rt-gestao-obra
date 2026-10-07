-- Ordens de servico independentes dos pedidos de compra de materiais.
-- OC continua sendo a numeracao de pedidos de compra; OS tem sequencia propria por obra.

ALTER TABLE fornecedores
  ADD COLUMN IF NOT EXISTS telefone TEXT,
  ADD COLUMN IF NOT EXISTS email TEXT;

UPDATE fornecedores SET telefone = contato
WHERE telefone IS NULL AND contato IS NOT NULL;

CREATE TYPE status_ordem_servico AS ENUM ('emitida', 'executada', 'cancelada');

CREATE TABLE ordens_servico_seq (
  obra_id UUID PRIMARY KEY REFERENCES obras(id) ON DELETE CASCADE,
  ultimo_numero INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE ordens_servico (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  obra_id UUID NOT NULL REFERENCES obras(id) ON DELETE CASCADE,
  numero INTEGER NOT NULL,
  fornecedor_id UUID NOT NULL REFERENCES fornecedores(id),
  unidade_id UUID REFERENCES unidades(id),
  etapa_id UUID REFERENCES etapas(id),
  servico_id UUID REFERENCES servicos(id),
  descricao TEXT NOT NULL,
  valor NUMERIC(14,2) NOT NULL CHECK (valor > 0),
  data_emissao DATE NOT NULL DEFAULT CURRENT_DATE,
  data_execucao DATE,
  data_vencimento DATE,
  servico_ja_executado BOOLEAN NOT NULL DEFAULT false,
  justificativa_regularizacao TEXT,
  status status_ordem_servico NOT NULL DEFAULT 'emitida',
  motivo_cancelamento TEXT,
  ativo BOOLEAN NOT NULL DEFAULT true,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  criado_por UUID NOT NULL DEFAULT auth.uid() REFERENCES perfis_usuario(id),
  UNIQUE (obra_id, numero),
  CHECK (NOT servico_ja_executado OR data_execucao IS NOT NULL),
  CHECK (NOT servico_ja_executado OR NULLIF(btrim(justificativa_regularizacao), '') IS NOT NULL)
);

CREATE TABLE ordem_servico_documentos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ordem_servico_id UUID NOT NULL REFERENCES ordens_servico(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL CHECK (tipo IN ('nota_fiscal', 'recibo', 'outro')),
  path TEXT NOT NULL,
  nome_original TEXT NOT NULL,
  ativo BOOLEAN NOT NULL DEFAULT true,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  criado_por UUID NOT NULL DEFAULT auth.uid() REFERENCES perfis_usuario(id)
);

ALTER TABLE lancamentos_financeiros
  ADD COLUMN IF NOT EXISTS ordem_servico_id UUID REFERENCES ordens_servico(id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_lf_ordem_servico ON lancamentos_financeiros(ordem_servico_id)
  WHERE ordem_servico_id IS NOT NULL AND ativo = true;

CREATE OR REPLACE FUNCTION proximo_numero_ordem_servico()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_numero INTEGER;
BEGIN
  INSERT INTO ordens_servico_seq (obra_id) VALUES (NEW.obra_id)
  ON CONFLICT (obra_id) DO NOTHING;
  UPDATE ordens_servico_seq SET ultimo_numero = ultimo_numero + 1
  WHERE obra_id = NEW.obra_id RETURNING ultimo_numero INTO v_numero;
  NEW.numero := v_numero;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_numero_ordem_servico
  BEFORE INSERT ON ordens_servico FOR EACH ROW EXECUTE FUNCTION proximo_numero_ordem_servico();

-- Uma OS emitida gera exatamente uma conta a pagar. A classificacao orcamentaria
-- permanece nula quando ainda nao existe orcamento, formando a fila a classificar.
CREATE OR REPLACE FUNCTION financeiro_ingerir_ordem_servico()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_fornecedor TEXT;
BEGIN
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

CREATE TRIGGER trg_financeiro_ingerir_ordem_servico
  AFTER INSERT ON ordens_servico FOR EACH ROW EXECUTE FUNCTION financeiro_ingerir_ordem_servico();

CREATE OR REPLACE FUNCTION cancelar_financeiro_ordem_servico()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'cancelada' AND OLD.status <> 'cancelada' THEN
    UPDATE lancamentos_financeiros SET ativo = false
    WHERE ordem_servico_id = NEW.id AND status = 'a_pagar' AND ativo = true;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_cancelar_financeiro_ordem_servico
  AFTER UPDATE OF status ON ordens_servico FOR EACH ROW EXECUTE FUNCTION cancelar_financeiro_ordem_servico();

ALTER TABLE ordens_servico_seq ENABLE ROW LEVEL SECURITY;
ALTER TABLE ordens_servico ENABLE ROW LEVEL SECURITY;
ALTER TABLE ordem_servico_documentos ENABLE ROW LEVEL SECURITY;

CREATE POLICY oss_select ON ordens_servico_seq FOR SELECT TO authenticated
  USING (pode_editar_compras() AND pode_acessar_obra(obra_id));
CREATE POLICY os_select ON ordens_servico FOR SELECT TO authenticated
  USING ((ativo = true OR pode_editar_compras() OR pode_editar_financeiro()) AND pode_acessar_obra(obra_id));
CREATE POLICY os_insert ON ordens_servico FOR INSERT TO authenticated
  WITH CHECK (pode_editar_compras() AND pode_acessar_obra(obra_id) AND criado_por = (SELECT auth.uid()));
CREATE POLICY os_update ON ordens_servico FOR UPDATE TO authenticated
  USING (pode_editar_compras() AND pode_acessar_obra(obra_id))
  WITH CHECK (pode_editar_compras() AND pode_acessar_obra(obra_id));
CREATE POLICY osd_select ON ordem_servico_documentos FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM ordens_servico os WHERE os.id = ordem_servico_id AND pode_acessar_obra(os.obra_id) AND (pode_editar_compras() OR pode_editar_financeiro())));
CREATE POLICY osd_insert ON ordem_servico_documentos FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM ordens_servico os WHERE os.id = ordem_servico_id AND pode_acessar_obra(os.obra_id) AND (pode_editar_compras() OR pode_editar_financeiro())));

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('ordens-servico', 'ordens-servico', false, 10485760, ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO NOTHING;

CREATE POLICY os_storage_select ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'ordens-servico' AND (pode_editar_compras() OR pode_editar_financeiro()));
CREATE POLICY os_storage_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'ordens-servico' AND (pode_editar_compras() OR pode_editar_financeiro()));

-- Acrescenta o bucket novo ao isolamento por obra ja existente.
DROP POLICY IF EXISTS isolamento_obra_storage ON storage.objects;
CREATE POLICY isolamento_obra_storage ON storage.objects AS RESTRICTIVE FOR ALL TO authenticated
USING (
  bucket_id NOT IN ('rdo','fvs','pendencias','cotacoes-nf','projetos','contratos-assinados','controle-tecnologico','ordens-servico')
  OR CASE
    WHEN bucket_id IN ('rdo','fvs','pendencias','projetos','contratos-assinados','controle-tecnologico','ordens-servico') THEN
      split_part(name,'/',1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      AND pode_acessar_obra(split_part(name,'/',1)::uuid)
    WHEN bucket_id = 'cotacoes-nf' THEN
      split_part(name,'/',1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      AND EXISTS (SELECT 1 FROM pedidos_compra p WHERE p.id = split_part(name,'/',1)::uuid AND pode_acessar_obra(p.obra_id))
    ELSE false
  END
)
WITH CHECK (
  bucket_id NOT IN ('rdo','fvs','pendencias','cotacoes-nf','projetos','contratos-assinados','controle-tecnologico','ordens-servico')
  OR CASE
    WHEN bucket_id IN ('rdo','fvs','pendencias','projetos','contratos-assinados','controle-tecnologico','ordens-servico') THEN
      split_part(name,'/',1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      AND pode_acessar_obra(split_part(name,'/',1)::uuid)
    WHEN bucket_id = 'cotacoes-nf' THEN
      split_part(name,'/',1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      AND EXISTS (SELECT 1 FROM pedidos_compra p WHERE p.id = split_part(name,'/',1)::uuid AND pode_acessar_obra(p.obra_id))
    ELSE false
  END
);

ALTER FUNCTION proximo_numero_ordem_servico() SET search_path = public;
ALTER FUNCTION financeiro_ingerir_ordem_servico() SET search_path = public;
ALTER FUNCTION cancelar_financeiro_ordem_servico() SET search_path = public;
