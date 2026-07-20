-- Fechar planejamento (aberta -> planejada): trava novos compromissos sem
-- calcular PPC ainda. Fechar semana (aberta ou planejada -> fechada) continua
-- calculando o PPC de verdade. Reabrir planejamento (planejada -> aberta) é
-- exclusivo do admin.

-- Gap encontrado ao revisar: nada impedia INSERT de compromisso numa semana
-- já fechada via chamada direta à API (só a interface escondia o formulário).
-- Fecha isso e, de quebra, já cobre a trava de "planejada" também.
CREATE OR REPLACE FUNCTION public.travar_insercao_compromisso_fora_de_aberta()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_status status_semana_planejamento;
BEGIN
  SELECT status INTO v_status FROM planejamento_semanas WHERE id = NEW.semana_id;
  IF v_status <> 'aberta' THEN
    RAISE EXCEPTION 'Semana nao esta aberta: nao e possivel comprometer nova tarefa.';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER trg_travar_insercao_fora_de_aberta
  BEFORE INSERT ON planejamento_compromissos
  FOR EACH ROW EXECUTE FUNCTION travar_insercao_compromisso_fora_de_aberta();

-- Amplia a trava existente de planejamento_semanas: além de travar qualquer
-- alteração numa semana já fechada, agora também exige admin pra reabrir
-- planejamento (planejada -> aberta) — mesmo via chamada direta à API.
CREATE OR REPLACE FUNCTION public.travar_semana_fechada()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF OLD.status = 'fechada' THEN
    RAISE EXCEPTION 'Semana fechada: nao pode mais ser alterada.';
  END IF;
  IF OLD.status = 'planejada' AND NEW.status = 'aberta' AND meu_papel() <> 'admin' THEN
    RAISE EXCEPTION 'Somente o admin pode reabrir o planejamento.';
  END IF;
  RETURN NEW;
END;
$function$;

-- calcular_fechamento_semana e fechar_semana_planejamento passam a aceitar
-- tanto 'aberta' quanto 'planejada' como estado de origem — passar pelo
-- estágio intermediário é opcional, não obrigatório.
CREATE OR REPLACE FUNCTION public.calcular_fechamento_semana(p_semana uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_obra UUID;
  v_status status_semana_planejamento;
  v_data_fim DATE;
BEGIN
  IF meu_papel() <> 'admin' THEN
    RAISE EXCEPTION 'Somente o admin pode calcular o fechamento da semana.';
  END IF;

  SELECT obra_id, status, data_fim INTO v_obra, v_status, v_data_fim
  FROM planejamento_semanas WHERE id = p_semana AND ativo;
  IF v_obra IS NULL THEN
    RAISE EXCEPTION 'Semana nao encontrada.';
  END IF;
  IF NOT pode_acessar_obra(v_obra) THEN
    RAISE EXCEPTION 'Sem acesso a obra desta semana.';
  END IF;
  IF v_status = 'fechada' THEN
    RAISE EXCEPTION 'Semana ja fechada.';
  END IF;

  UPDATE planejamento_compromissos pc
  SET percentual_fim = sub.percentual,
      cumprido = sub.percentual >= pc.meta_percentual
  FROM (
    SELECT pc2.id, COALESCE((
      SELECT af.percentual FROM avancos_fisicos af
      WHERE af.tarefa_id = pc2.tarefa_id AND af.ativo AND af.data_referencia <= v_data_fim
      ORDER BY af.data_referencia DESC LIMIT 1
    ), 0) AS percentual
    FROM planejamento_compromissos pc2
    WHERE pc2.semana_id = p_semana AND pc2.ativo
  ) sub
  WHERE pc.id = sub.id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fechar_semana_planejamento(p_semana uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_obra UUID;
  v_status status_semana_planejamento;
  v_sem_calcular INT;
  v_total INT;
  v_pendentes INT;
  v_cumpridos INT;
BEGIN
  IF meu_papel() <> 'admin' THEN
    RAISE EXCEPTION 'Somente o admin pode fechar a semana.';
  END IF;

  SELECT obra_id, status INTO v_obra, v_status
  FROM planejamento_semanas WHERE id = p_semana AND ativo;
  IF v_obra IS NULL THEN
    RAISE EXCEPTION 'Semana nao encontrada.';
  END IF;
  IF NOT pode_acessar_obra(v_obra) THEN
    RAISE EXCEPTION 'Sem acesso a obra desta semana.';
  END IF;
  IF v_status = 'fechada' THEN
    RAISE EXCEPTION 'Semana ja fechada.';
  END IF;

  SELECT count(*) FILTER (WHERE percentual_fim IS NULL), count(*)
    INTO v_sem_calcular, v_total
  FROM planejamento_compromissos WHERE semana_id = p_semana AND ativo;

  IF v_total = 0 THEN
    RAISE EXCEPTION 'Semana sem nenhum compromisso ativo.';
  END IF;
  IF v_sem_calcular > 0 THEN
    RAISE EXCEPTION 'Rode calcular o fechamento antes de fechar a semana.';
  END IF;

  SELECT count(*) INTO v_pendentes
  FROM planejamento_compromissos
  WHERE semana_id = p_semana AND ativo AND cumprido = false AND motivo_categoria IS NULL;

  IF v_pendentes > 0 THEN
    RAISE EXCEPTION '% compromisso(s) nao cumprido(s) sem motivo preenchido.', v_pendentes;
  END IF;

  SELECT count(*) FILTER (WHERE cumprido) INTO v_cumpridos
  FROM planejamento_compromissos WHERE semana_id = p_semana AND ativo;

  UPDATE planejamento_semanas
  SET status = 'fechada', ppc = round(100.0 * v_cumpridos / v_total, 2),
      fechada_por = auth.uid(), fechada_em = now()
  WHERE id = p_semana;
END;
$function$;

-- Fecha o planejamento: aberta -> planejada. Mesma permissão de quem já pode
-- comprometer tarefa (não é exclusivo do admin, ao contrário do fechamento final).
CREATE OR REPLACE FUNCTION public.fechar_planejamento_semana(p_semana uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_obra UUID;
  v_status status_semana_planejamento;
BEGIN
  IF NOT pode_editar_planejamento() THEN
    RAISE EXCEPTION 'Sem permissao para fechar o planejamento.';
  END IF;

  SELECT obra_id, status INTO v_obra, v_status
  FROM planejamento_semanas WHERE id = p_semana AND ativo;
  IF v_obra IS NULL THEN
    RAISE EXCEPTION 'Semana nao encontrada.';
  END IF;
  IF NOT pode_acessar_obra(v_obra) THEN
    RAISE EXCEPTION 'Sem acesso a obra desta semana.';
  END IF;
  IF v_status <> 'aberta' THEN
    RAISE EXCEPTION 'Semana precisa estar aberta para fechar o planejamento.';
  END IF;

  UPDATE planejamento_semanas SET status = 'planejada' WHERE id = p_semana;
END;
$function$;

-- Reabre o planejamento: planejada -> aberta. Exclusivo do admin (reforçado
-- também via trigger em travar_semana_fechada, defesa em profundidade).
CREATE OR REPLACE FUNCTION public.reabrir_planejamento_semana(p_semana uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_obra UUID;
  v_status status_semana_planejamento;
BEGIN
  IF meu_papel() <> 'admin' THEN
    RAISE EXCEPTION 'Somente o admin pode reabrir o planejamento.';
  END IF;

  SELECT obra_id, status INTO v_obra, v_status
  FROM planejamento_semanas WHERE id = p_semana AND ativo;
  IF v_obra IS NULL THEN
    RAISE EXCEPTION 'Semana nao encontrada.';
  END IF;
  IF NOT pode_acessar_obra(v_obra) THEN
    RAISE EXCEPTION 'Sem acesso a obra desta semana.';
  END IF;
  IF v_status <> 'planejada' THEN
    RAISE EXCEPTION 'So e possivel reabrir uma semana com planejamento fechado (nao fechada de vez).';
  END IF;

  UPDATE planejamento_semanas SET status = 'aberta' WHERE id = p_semana;
END;
$function$;

REVOKE ALL ON FUNCTION public.travar_insercao_compromisso_fora_de_aberta() FROM PUBLIC, anon, authenticated;

-- RPCs novas seguem o mesmo padrão das já existentes (calcular_fechamento_semana,
-- fechar_semana_planejamento): callable por authenticated, nunca por anon.
REVOKE ALL ON FUNCTION public.fechar_planejamento_semana(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reabrir_planejamento_semana(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fechar_planejamento_semana(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reabrir_planejamento_semana(uuid) TO authenticated;
