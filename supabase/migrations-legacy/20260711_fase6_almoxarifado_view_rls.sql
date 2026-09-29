-- Revisão Task 3: estoque_saldos rodava com privilégio do dono (postgres,
-- bypassa RLS) e GRANT default — anon conseguia ler todos os saldos.
-- security_invoker faz a view respeitar as policies de materiais e
-- estoque_movimentos do usuário que consulta (CLAUDE.md §2: RLS sempre).
ALTER VIEW estoque_saldos SET (security_invoker = true);
