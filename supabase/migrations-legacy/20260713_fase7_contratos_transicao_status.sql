-- Restringe a transição de status do contrato à ordem única
-- rascunho → ativo → encerrado — sem retroceder, mesmo pra admin.
-- Fecha um buraco: o trigger original só bloqueava não-admin, mas
-- não impedia um admin reverter o status via chamada direta à API
-- (ex.: encerrado → ativo), o que reabriria a edição de itens de um
-- contrato que devia estar congelado (ver
-- 20260713_fase7_contratos_itens_imutavel.sql).

CREATE OR REPLACE FUNCTION restringir_status_contrato() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF meu_papel() <> 'admin' THEN
      RAISE EXCEPTION 'Somente o admin pode alterar o status do contrato.';
    END IF;
    IF NOT (
      (OLD.status = 'rascunho' AND NEW.status = 'ativo') OR
      (OLD.status = 'ativo' AND NEW.status = 'encerrado')
    ) THEN
      RAISE EXCEPTION 'Transição de status inválida: só rascunho→ativo ou ativo→encerrado.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
