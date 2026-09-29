-- A decisão aprovada passa a registrar a alternativa escolhida para execução.
-- A escolha fica congelada junto do estudo e deve apontar para uma solução completa do snapshot.
ALTER TABLE estudos_viabilidade
  ADD COLUMN IF NOT EXISTS solucao_escolhida_id UUID,
  ADD COLUMN IF NOT EXISTS solucao_escolhida_nome TEXT,
  ADD COLUMN IF NOT EXISTS aprovado_por_nome TEXT;

CREATE OR REPLACE FUNCTION validar_estudo_viabilidade() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  pendente BOOLEAN;
  nome_escolha TEXT;
BEGIN
  IF TG_OP='UPDATE' AND OLD.status='aguardando_aprovacao' AND NEW.status<>OLD.status THEN
    NEW.obra_id:=OLD.obra_id; NEW.etapa_id:=OLD.etapa_id; NEW.servico_id:=OLD.servico_id; NEW.titulo:=OLD.titulo; NEW.area_m2:=OLD.area_m2; NEW.observacao_tecnica:=OLD.observacao_tecnica; NEW.fonte_custos:=OLD.fonte_custos; NEW.data_referencia_custos:=OLD.data_referencia_custos; NEW.parametros:=OLD.parametros; NEW.solucoes:=OLD.solucoes; NEW.resultados:=OLD.resultados; NEW.ativo:=OLD.ativo;
  END IF;

  NEW.titulo:=NULLIF(btrim(COALESCE(NEW.titulo,'')),'');
  NEW.observacao_tecnica:=NULLIF(btrim(COALESCE(NEW.observacao_tecnica,'')), '');
  NEW.fonte_custos:=NULLIF(btrim(COALESCE(NEW.fonte_custos,'')), '');
  NEW.decisao:=NULLIF(btrim(COALESCE(NEW.decisao,'')), '');
  NEW.motivo_devolucao:=NULLIF(btrim(COALESCE(NEW.motivo_devolucao,'')), '');
  NEW.solucao_escolhida_nome:=NULLIF(btrim(COALESCE(NEW.solucao_escolhida_nome,'')), '');
  NEW.aprovado_por_nome:=NULLIF(btrim(COALESCE(NEW.aprovado_por_nome,'')), '');

  IF NEW.titulo IS NULL OR NEW.area_m2<=0 THEN RAISE EXCEPTION 'Informe título e área maior que zero.'; END IF;
  IF NOT (TG_OP='UPDATE' AND OLD.status='aguardando_aprovacao' AND NEW.status<>OLD.status) THEN
    NEW.etapa_id:=validar_vinculo_estudo_viabilidade(NEW.obra_id,NEW.etapa_id,NEW.servico_id);
    NEW.resultados:=calcular_resultados_estudo_viabilidade(NEW.parametros,NEW.solucoes,NEW.area_m2);
    SELECT EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.resultados->'solucoes') s WHERE s->>'motivoPendente' IS NOT NULL) INTO pendente;
  END IF;

  NEW.atualizado_por:=auth.uid(); NEW.atualizado_em:=now();

  IF TG_OP='INSERT' THEN
    IF NEW.status<>'rascunho' THEN RAISE EXCEPTION 'Novo estudo deve iniciar como rascunho.'; END IF;
    NEW.criado_por:=auth.uid(); NEW.criado_em:=now(); NEW.enviado_por:=NULL; NEW.enviado_em:=NULL; NEW.aprovado_por:=NULL; NEW.aprovado_em:=NULL; NEW.devolvido_por:=NULL; NEW.devolvido_em:=NULL;
    NEW.decisao:=NULL; NEW.motivo_devolucao:=NULL; NEW.solucao_escolhida_id:=NULL; NEW.solucao_escolhida_nome:=NULL; NEW.aprovado_por_nome:=NULL;
    RETURN NEW;
  END IF;

  IF NEW.obra_id<>OLD.obra_id THEN RAISE EXCEPTION 'Não é permitido mover estudo entre obras.'; END IF;
  NEW.criado_por:=OLD.criado_por; NEW.criado_em:=OLD.criado_em;
  IF OLD.status='aprovado' THEN RAISE EXCEPTION 'Estudo aprovado é imutável.'; END IF;

  IF NEW.status=OLD.status THEN
    IF OLD.status<>'rascunho' THEN RAISE EXCEPTION 'Estudo aguardando aprovação não pode ser alterado.'; END IF;
    NEW.enviado_por:=OLD.enviado_por; NEW.enviado_em:=OLD.enviado_em; NEW.aprovado_por:=OLD.aprovado_por; NEW.aprovado_em:=OLD.aprovado_em; NEW.devolvido_por:=OLD.devolvido_por; NEW.devolvido_em:=OLD.devolvido_em;
    NEW.decisao:=OLD.decisao; NEW.motivo_devolucao:=OLD.motivo_devolucao; NEW.solucao_escolhida_id:=OLD.solucao_escolhida_id; NEW.solucao_escolhida_nome:=OLD.solucao_escolhida_nome; NEW.aprovado_por_nome:=OLD.aprovado_por_nome;
    RETURN NEW;
  END IF;

  IF OLD.status='rascunho' AND NEW.status='aguardando_aprovacao' THEN
    IF NEW.fonte_custos IS NULL OR NEW.data_referencia_custos IS NULL OR pendente THEN RAISE EXCEPTION 'Para enviar, informe fonte e data dos custos e complete os parâmetros.'; END IF;
    NEW.enviado_por:=auth.uid(); NEW.enviado_em:=now(); NEW.aprovado_por:=NULL; NEW.aprovado_em:=NULL; NEW.devolvido_por:=NULL; NEW.devolvido_em:=NULL;
    NEW.decisao:=NULL; NEW.motivo_devolucao:=NULL; NEW.solucao_escolhida_id:=NULL; NEW.solucao_escolhida_nome:=NULL; NEW.aprovado_por_nome:=NULL;
    RETURN NEW;
  END IF;

  IF OLD.status='aguardando_aprovacao' AND NEW.status='aprovado' THEN
    IF meu_papel()<>'admin' OR NEW.decisao IS NULL OR NEW.solucao_escolhida_id IS NULL THEN
      RAISE EXCEPTION 'Somente o admin pode aprovar, escolhendo uma solução e registrando a justificativa técnica.';
    END IF;
    SELECT NULLIF(btrim(s->>'nome'), '') INTO nome_escolha
      FROM jsonb_array_elements(NEW.solucoes) s
      WHERE s->>'id'=NEW.solucao_escolhida_id::text;
    IF nome_escolha IS NULL THEN RAISE EXCEPTION 'A solução escolhida não pertence a este estudo.'; END IF;
    IF NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(NEW.resultados->'solucoes') r
      WHERE r->>'id'=NEW.solucao_escolhida_id::text AND r->>'totalM2' IS NOT NULL
    ) THEN RAISE EXCEPTION 'A solução escolhida precisa ter os custos completos.'; END IF;
    NEW.solucao_escolhida_nome:=nome_escolha;
    NEW.enviado_por:=OLD.enviado_por; NEW.enviado_em:=OLD.enviado_em; NEW.aprovado_por:=auth.uid(); NEW.aprovado_em:=now(); NEW.devolvido_por:=NULL; NEW.devolvido_em:=NULL; NEW.motivo_devolucao:=NULL;
    SELECT NULLIF(btrim(nome), '') INTO NEW.aprovado_por_nome FROM perfis_usuario WHERE id=auth.uid();
    RETURN NEW;
  END IF;

  IF OLD.status='aguardando_aprovacao' AND NEW.status='rascunho' THEN
    IF meu_papel()<>'admin' OR NEW.motivo_devolucao IS NULL THEN RAISE EXCEPTION 'Somente o admin pode devolver, com motivo registrado.'; END IF;
    NEW.enviado_por:=OLD.enviado_por; NEW.enviado_em:=OLD.enviado_em; NEW.aprovado_por:=NULL; NEW.aprovado_em:=NULL; NEW.devolvido_por:=auth.uid(); NEW.devolvido_em:=now();
    NEW.decisao:=NULL; NEW.solucao_escolhida_id:=NULL; NEW.solucao_escolhida_nome:=NULL; NEW.aprovado_por_nome:=NULL;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Transição de status inválida: % -> %.',OLD.status,NEW.status;
END $$;

REVOKE ALL ON FUNCTION validar_estudo_viabilidade() FROM PUBLIC,anon,authenticated;
