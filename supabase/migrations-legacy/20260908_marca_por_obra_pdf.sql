-- Identidade visual por obra nos PDFs: obra sem logo continua usando a marca RT
-- padrão em todo lugar (colunas NULL = sem mudança de comportamento).
-- Ver docs/superpowers/specs/2026-09-04-marca-por-obra-pdf-design.md.

ALTER TABLE obras ADD COLUMN logo_url TEXT;
ALTER TABLE obras ADD COLUMN rodape_pdf TEXT;

INSERT INTO storage.buckets (id, name, public) VALUES ('obras-logos', 'obras-logos', false)
ON CONFLICT (id) DO NOTHING;
UPDATE storage.buckets
SET file_size_limit = 2097152, allowed_mime_types = ARRAY['image/png']
WHERE id = 'obras-logos';

-- SELECT: qualquer usuário que acesse a obra (não só admin) — quem gera o PDF é
-- o navegador de quem estiver logado, não só o admin que fez o upload.
CREATE POLICY obraslogos_storage_select ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'obras-logos' AND pode_acessar_obra(split_part(name,'/',1)::UUID));

-- INSERT/UPDATE: só admin (mesma régua de /dados-obra hoje). UPDATE cobre o caso
-- de reenviar uma logo corrigida por cima da existente (upsert).
CREATE POLICY obraslogos_storage_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'obras-logos' AND meu_papel() = 'admin' AND pode_acessar_obra(split_part(name,'/',1)::UUID));
CREATE POLICY obraslogos_storage_update ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'obras-logos' AND meu_papel() = 'admin')
  WITH CHECK (bucket_id = 'obras-logos' AND meu_papel() = 'admin' AND pode_acessar_obra(split_part(name,'/',1)::UUID));
