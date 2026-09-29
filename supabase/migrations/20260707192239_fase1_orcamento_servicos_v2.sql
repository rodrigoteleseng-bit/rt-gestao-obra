
ALTER TABLE etapas
  ADD COLUMN IF NOT EXISTS codigo TEXT,
  ADD COLUMN IF NOT EXISTS grupo TEXT;

CREATE TABLE IF NOT EXISTS servicos (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  etapa_id    UUID NOT NULL REFERENCES etapas(id) ON DELETE CASCADE,
  codigo      TEXT,
  nome        TEXT NOT NULL,
  grupo       TEXT,
  und         TEXT,
  quant       NUMERIC(14,4),
  valor_unit  NUMERIC(14,4),
  total       NUMERIC(14,2),
  ativo       BOOLEAN NOT NULL DEFAULT true,
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT now(),
  criado_por  UUID REFERENCES perfis_usuario(id)
);

ALTER TABLE servicos ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='servicos' AND policyname='servicos_select') THEN
    CREATE POLICY "servicos_select" ON servicos FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='servicos' AND policyname='servicos_insert') THEN
    CREATE POLICY "servicos_insert" ON servicos FOR INSERT TO authenticated WITH CHECK (meu_papel() = 'admin');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='servicos' AND policyname='servicos_update') THEN
    CREATE POLICY "servicos_update" ON servicos FOR UPDATE TO authenticated USING (meu_papel() = 'admin');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='servicos' AND policyname='servicos_delete') THEN
    CREATE POLICY "servicos_delete" ON servicos FOR DELETE TO authenticated USING (meu_papel() = 'admin');
  END IF;
END $$;
;
