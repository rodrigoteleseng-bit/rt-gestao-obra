-- Fase 1 — Orçamento
-- Registro das alterações aplicadas em produção em 07/07/2026 via MCP.
-- 1) etapas: colunas codigo e grupo para rastrear a EAP da planilha analítica.
-- 2) servicos: tabela de itens orçáveis (recriada — a versão antiga estava vazia
--    e tinha nomes de colunas divergentes do importador).

ALTER TABLE etapas ADD COLUMN IF NOT EXISTS codigo TEXT;
ALTER TABLE etapas ADD COLUMN IF NOT EXISTS grupo TEXT;

DROP TABLE IF EXISTS servicos;

CREATE TABLE servicos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  etapa_id UUID NOT NULL REFERENCES etapas(id) ON DELETE CASCADE,
  codigo TEXT,
  nome TEXT NOT NULL,
  grupo TEXT,
  und TEXT,
  quant NUMERIC(14,4),
  valor_unit NUMERIC(14,4),
  total NUMERIC(14,2),
  ativo BOOLEAN NOT NULL DEFAULT true,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  criado_por UUID REFERENCES perfis_usuario(id)
);

ALTER TABLE servicos ENABLE ROW LEVEL SECURITY;

-- Leitura para qualquer usuário autenticado; escrita só para admin.
CREATE POLICY servicos_select ON servicos FOR SELECT USING (true);
CREATE POLICY servicos_admin ON servicos FOR ALL
  USING (meu_papel() = 'admin'::papel_usuario)
  WITH CHECK (meu_papel() = 'admin'::papel_usuario);

-- Os dados do orçamento (159 etapas + 3.475 serviços) foram importados da
-- planilha "ORÇAMENTO RESIDENCIAL V.03 - Orçamento Analítico.xlsx" pelo
-- script scripts/importar-orcamento.cjs, que gera scripts/orcamento_import.sql.
