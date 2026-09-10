-- Numeração sequencial por obra do Controle Tecnológico (CTC-001, CTC-002...),
-- atribuída no momento da criação da concretagem — nunca recalculada, nunca
-- reaproveitada. Mesmo padrão de contratos_seq/proximo_numero_contrato()
-- (ver supabase/migrations/20260713_fase7_contratos.sql:26-81). Aparece só
-- no cabeçalho do PDF (ver docs/superpowers/specs/2026-09-10-ct-pdf-mapa-numeracao-design.md).
-- Havia 1 linha real em ct_concretagens no momento desta migração (lançada em
-- produção no mesmo dia) — recebe backfill para CTC-001 abaixo, aprovado por
-- Rodrigo em 10/09/2026 (não é dado de teste).

CREATE TABLE ct_concretagens_seq (
  obra_id       UUID PRIMARY KEY REFERENCES obras(id) ON DELETE CASCADE,
  ultimo_numero INTEGER NOT NULL DEFAULT 0
);

INSERT INTO ct_concretagens_seq (obra_id, ultimo_numero)
SELECT id, 0 FROM obras
ON CONFLICT (obra_id) DO NOTHING;

ALTER TABLE ct_concretagens ADD COLUMN numero TEXT;

CREATE OR REPLACE FUNCTION proximo_numero_ctc() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_numero INTEGER;
BEGIN
  INSERT INTO ct_concretagens_seq (obra_id, ultimo_numero)
  VALUES (NEW.obra_id, 0)
  ON CONFLICT (obra_id) DO NOTHING;

  UPDATE ct_concretagens_seq
    SET ultimo_numero = ultimo_numero + 1
    WHERE obra_id = NEW.obra_id
    RETURNING ultimo_numero INTO v_numero;

  NEW.numero := 'CTC-' || lpad(v_numero::text, 3, '0');
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_numero_ctc
  BEFORE INSERT ON ct_concretagens
  FOR EACH ROW EXECUTE FUNCTION proximo_numero_ctc();

-- Backfill: 1 concretagem real pré-existente (lançada em produção antes desta
-- migração) recebe CTC-001, e o contador da obra é inicializado a partir do
-- maior número já atribuído, pra a próxima concretagem daquela obra continuar
-- em CTC-002. Aprovado por Rodrigo em 10/09/2026 (a concretagem é real, não teste).
WITH numeradas AS (
  SELECT id, obra_id,
         row_number() OVER (PARTITION BY obra_id ORDER BY criado_em) AS rn
  FROM ct_concretagens
  WHERE numero IS NULL
)
UPDATE ct_concretagens c
SET numero = 'CTC-' || lpad(n.rn::text, 3, '0')
FROM numeradas n
WHERE c.id = n.id;

UPDATE ct_concretagens_seq s
SET ultimo_numero = greatest(s.ultimo_numero, sub.max_numero)
FROM (
  SELECT obra_id, max(substring(numero from 5)::int) AS max_numero
  FROM ct_concretagens
  WHERE numero IS NOT NULL
  GROUP BY obra_id
) sub
WHERE s.obra_id = sub.obra_id;

ALTER TABLE ct_concretagens ALTER COLUMN numero SET NOT NULL;
ALTER TABLE ct_concretagens ADD CONSTRAINT ct_concretagens_numero_unico UNIQUE (obra_id, numero);

ALTER TABLE ct_concretagens_seq ENABLE ROW LEVEL SECURITY;
CREATE POLICY ctcseq_select ON ct_concretagens_seq FOR SELECT
  USING (meu_papel() IN ('admin', 'equipe'));
