-- Achado na revisão da Task 1 do plano de Deduções (2026-09-10): a
-- migração 20260910_medicoes_deducoes_nf.sql replicou as 3 policies
-- PERMISSIVE de medicoes_itens (select/insert/update) mas esqueceu a
-- policy RESTRICTIVE "isolamento_obra" que medicoes_itens ganhou em
-- 20260717_isolamento_usuario_obra.sql. Sem ela, qualquer usuário com
-- pode_editar_medicoes() (admin, ou equipe com o módulo medicoes)
-- conseguia ler/escrever deduções de QUALQUER obra via chamada direta
-- a supabase.from('medicoes_deducoes') — a checagem de obra só existia
-- dentro da RPC salvar_deducoes_medicao, que é opcional pro cliente
-- usar. Confirmado ao vivo contra produção antes desta correção.

CREATE POLICY isolamento_obra ON medicoes_deducoes AS RESTRICTIVE FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM medicoes m JOIN contratos c ON c.id = m.contrato_id
    WHERE m.id = medicoes_deducoes.medicao_id AND pode_acessar_obra(c.obra_id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM medicoes m JOIN contratos c ON c.id = m.contrato_id
    WHERE m.id = medicoes_deducoes.medicao_id AND pode_acessar_obra(c.obra_id)
  ));
