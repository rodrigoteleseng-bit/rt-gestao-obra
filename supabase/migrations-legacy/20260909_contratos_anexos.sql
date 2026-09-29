-- Contratos: anexo do documento assinado (contrato original + aditivos depois).
-- Ver docs/superpowers/specs/2026-09-09-contratos-anexo-assinado-design.md
-- Lista simples, sem conceito de versão — cada anexo é um registro permanente e
-- independente. Funciona em qualquer status do contrato (sem gating por contrato.status).

CREATE TABLE contratos_anexos (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contrato_id     UUID NOT NULL REFERENCES contratos(id),
  arquivo_url     TEXT NOT NULL,   -- caminho no bucket 'contratos-assinados'
  nome_original   TEXT NOT NULL,   -- nome do arquivo enviado, pra exibição
  descricao       TEXT,            -- opcional: "Contrato original", "Aditivo 1"...
  ativo           BOOLEAN NOT NULL DEFAULT true,
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
  criado_por      UUID NOT NULL DEFAULT auth.uid() REFERENCES perfis_usuario(id),
  removido_por    UUID REFERENCES perfis_usuario(id),
  removido_em     TIMESTAMPTZ
);

CREATE INDEX idx_contratos_anexos_contrato ON contratos_anexos(contrato_id);

ALTER TABLE contratos_anexos ENABLE ROW LEVEL SECURITY;

-- Mesmo desenho já usado em contratos_itens (ci_select/ci_insert): visualizar é liberado
-- pra qualquer admin/equipe; anexar/remover exige pode_editar_contratos(). Regra de soft
-- delete (CLAUDE.md §3): SELECT precisa do "OR pode_editar_contratos()" pra também
-- enxergar os anexos removidos, senão a inativação falha silenciosamente.
CREATE POLICY ca_select ON contratos_anexos FOR SELECT
  USING ((ativo = true AND meu_papel() = ANY (ARRAY['admin', 'equipe']::papel_usuario[])) OR pode_editar_contratos());
CREATE POLICY ca_insert ON contratos_anexos FOR INSERT
  WITH CHECK (pode_editar_contratos());
CREATE POLICY ca_update ON contratos_anexos FOR UPDATE
  USING (pode_editar_contratos())
  WITH CHECK (pode_editar_contratos());

-- Bucket privado. PDF ou foto, até 25MB — mesmo limite já usado em 'producao-plantas'
-- pra essa combinação de formatos.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('contratos-assinados', 'contratos-assinados', false, 26214400, ARRAY['application/pdf', 'image/*'])
ON CONFLICT (id) DO NOTHING;

-- Leitura liberada pra qualquer admin/equipe (mesma régua da tabela); escrita exige
-- pode_editar_contratos() — mesmo desenho já usado no bucket 'cotacoes-nf'.
CREATE POLICY ca_storage_select ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'contratos-assinados' AND meu_papel() IN ('admin', 'equipe'));
CREATE POLICY ca_storage_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'contratos-assinados' AND pode_editar_contratos());

-- Isolamento por obra no arquivo em si: caminho começa com o obra_id (mesmo padrão já
-- usado em rdo/fvs/pendencias/projetos) — estende a policy restritiva existente em vez
-- de criar uma nova, evitando duas RESTRICTIVE policies conflitando na mesma tabela.
DROP POLICY isolamento_obra_storage ON storage.objects;

CREATE POLICY isolamento_obra_storage ON storage.objects AS RESTRICTIVE FOR ALL TO authenticated
USING (
  bucket_id NOT IN ('rdo','fvs','pendencias','cotacoes-nf','projetos','contratos-assinados')
  OR CASE
    WHEN bucket_id IN ('rdo','fvs','pendencias','projetos','contratos-assinados') THEN
      split_part(name,'/',1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      AND pode_acessar_obra(split_part(name,'/',1)::UUID)
    WHEN bucket_id = 'cotacoes-nf' THEN
      split_part(name,'/',1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      AND EXISTS (
        SELECT 1 FROM pedidos_compra p
        WHERE p.id=split_part(name,'/',1)::UUID AND pode_acessar_obra(p.obra_id)
      )
    ELSE false
  END
)
WITH CHECK (
  bucket_id NOT IN ('rdo','fvs','pendencias','cotacoes-nf','projetos','contratos-assinados')
  OR CASE
    WHEN bucket_id IN ('rdo','fvs','pendencias','projetos','contratos-assinados') THEN
      split_part(name,'/',1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      AND pode_acessar_obra(split_part(name,'/',1)::UUID)
    WHEN bucket_id = 'cotacoes-nf' THEN
      split_part(name,'/',1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      AND EXISTS (
        SELECT 1 FROM pedidos_compra p
        WHERE p.id=split_part(name,'/',1)::UUID AND pode_acessar_obra(p.obra_id)
      )
    ELSE false
  END
);
