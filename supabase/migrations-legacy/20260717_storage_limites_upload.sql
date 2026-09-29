-- Restrições de upload por bucket.
-- Mantém todos privados e limita abuso de armazenamento/tipos inesperados.

UPDATE storage.buckets
SET file_size_limit = 20971520,
    allowed_mime_types = ARRAY['image/*', 'audio/*']
WHERE id = 'rdo';

UPDATE storage.buckets
SET file_size_limit = 10485760,
    allowed_mime_types = ARRAY['image/*']
WHERE id IN ('fvs', 'pendencias');

UPDATE storage.buckets
SET file_size_limit = 26214400,
    allowed_mime_types = ARRAY['application/pdf', 'image/*']
WHERE id = 'cotacoes-nf';

