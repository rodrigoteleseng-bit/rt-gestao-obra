-- ============================================================
-- FVS — ordem global dos itens + exclusão pelo admin | RT Engenharia
-- ============================================================
-- 1) O campo 'ordem' dos itens reiniciava em 1 por seção, fazendo as
--    seções se intercalarem ao ordenar. Vira ordem GLOBAL: prioridade
--    da seção × 1000 + ordem interna. Pré-requisitos SEMPRE primeiro
--    (premissa a verificar antes de qualquer serviço).
-- 2) RPC para o admin excluir (soft delete) uma FVS salva errada.
-- Decisões do Rodrigo em 10/07/2026.

UPDATE fvs_modelo_itens SET ordem =
  (CASE secao
    WHEN 'Pré-requisitos'        THEN 1
    WHEN 'Execução'              THEN 2
    WHEN 'Formas e escoramento'  THEN 3
    WHEN 'Armação'               THEN 4
    WHEN 'Concretagem'           THEN 5
    WHEN 'Por sistema'           THEN 6
    WHEN 'Documental'            THEN 7
    ELSE 9
  END) * 1000 + ordem
WHERE ordem < 1000;

-- Exclusão lógica de FVS pelo admin (contorna a imutabilidade de FVS
-- aprovada de forma controlada; o registro permanece no banco com
-- ativo=false — nada é apagado fisicamente, regra de rastreabilidade).
CREATE OR REPLACE FUNCTION excluir_fvs(p_fvs UUID)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- IS DISTINCT FROM trata NULL (sem sessão / não-admin) como bloqueado;
  -- `<> 'admin'` deixaria passar quando meu_papel() é NULL.
  IF meu_papel() IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'Apenas o administrador pode excluir uma FVS';
  END IF;
  UPDATE fvs SET ativo = false WHERE id = p_fvs;
  -- inativa também as pendências que esta FVS gerou (não deixa órfãs)
  UPDATE pendencias SET ativo = false WHERE fvs_id = p_fvs AND ativo = true;
END;
$$;
