-- Estudos de viabilidade. O enum modulo_app é criado em migration anterior,
-- pois o Postgres não permite utilizar um enum na mesma transação que o adiciona.
CREATE TYPE status_estudo_viabilidade AS ENUM ('rascunho','aguardando_aprovacao','aprovado');

CREATE TABLE estudos_viabilidade (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), obra_id UUID NOT NULL REFERENCES obras(id) ON DELETE CASCADE,
  etapa_id UUID REFERENCES etapas(id), servico_id UUID REFERENCES servicos(id), titulo TEXT NOT NULL,
  area_m2 NUMERIC(14,4) NOT NULL CHECK(area_m2 > 0), observacao_tecnica TEXT,
  fonte_custos TEXT, data_referencia_custos DATE, parametros JSONB NOT NULL DEFAULT '{}'::jsonb,
  solucoes JSONB NOT NULL DEFAULT '[]'::jsonb, resultados JSONB NOT NULL DEFAULT '{}'::jsonb,
  status status_estudo_viabilidade NOT NULL DEFAULT 'rascunho', enviado_por UUID REFERENCES perfis_usuario(id), enviado_em TIMESTAMPTZ,
  aprovado_por UUID REFERENCES perfis_usuario(id), aprovado_em TIMESTAMPTZ, decisao TEXT,
  devolvido_por UUID REFERENCES perfis_usuario(id), devolvido_em TIMESTAMPTZ, motivo_devolucao TEXT,
  ativo BOOLEAN NOT NULL DEFAULT true, criado_por UUID NOT NULL DEFAULT auth.uid() REFERENCES perfis_usuario(id), criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_por UUID REFERENCES perfis_usuario(id), atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT estudos_viabilidade_titulo_chk CHECK(btrim(titulo) <> '')
);
CREATE INDEX idx_estudos_viabilidade_obra_status ON estudos_viabilidade(obra_id,status,criado_em DESC) WHERE ativo;

CREATE OR REPLACE FUNCTION pode_editar_estudos_viabilidade() RETURNS boolean LANGUAGE sql STABLE SET search_path=public AS $$
  SELECT meu_papel()='admin' OR (meu_papel()='equipe' AND 'estudos_viabilidade'=ANY(meus_modulos()))
$$;

CREATE OR REPLACE FUNCTION validar_vinculo_estudo_viabilidade(p_obra UUID,p_etapa UUID,p_servico UUID) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_obra UUID; v_etapa UUID;
BEGIN
  IF p_etapa IS NOT NULL THEN SELECT u.obra_id INTO v_obra FROM etapas e JOIN unidades u ON u.id=e.unidade_id WHERE e.id=p_etapa AND e.ativo AND u.ativo;
    IF v_obra IS NULL OR v_obra<>p_obra THEN RAISE EXCEPTION 'A etapa vinculada não pertence à obra do estudo.'; END IF; END IF;
  IF p_servico IS NOT NULL THEN SELECT u.obra_id,s.etapa_id INTO v_obra,v_etapa FROM servicos s JOIN etapas e ON e.id=s.etapa_id JOIN unidades u ON u.id=e.unidade_id WHERE s.id=p_servico AND s.ativo AND e.ativo AND u.ativo;
    IF v_obra IS NULL OR v_obra<>p_obra THEN RAISE EXCEPTION 'O serviço vinculado não pertence à obra do estudo.'; END IF;
    IF p_etapa IS NOT NULL AND p_etapa<>v_etapa THEN RAISE EXCEPTION 'O serviço não pertence à etapa informada.'; END IF; RETURN v_etapa; END IF;
  RETURN p_etapa;
END $$;

CREATE OR REPLACE FUNCTION validar_parametros_estudo_viabilidade(p JSONB) RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path=public AS $$
DECLARE k TEXT; ks TEXT[]:=ARRAY['bloco9','bloco115','bloco19','areia','cimentoSaco','juntaCm','perdaBloco','perdaArgamassa','cimentoAssentamento','areiaAssentamento','cimentoPaulista','areiaPaulista','cimentoChapisco','areiaChapisco','volumeChapisco','custoHoraPreparo','produtividadePrincipal','produtividadeChapisco','usinaPrincipal','usinaChapisco','perdaUsina','fretePrincipal','freteChapisco','minimoPrincipal','minimoChapisco','recebimentoUsina'];
BEGIN
  IF jsonb_typeof(p)<>'object' OR p->>'modalidade' NOT IN ('local','usina') THEN RAISE EXCEPTION 'Parâmetros do estudo inválidos.'; END IF;
  FOREACH k IN ARRAY ks LOOP IF jsonb_typeof(p->k)<>'number' OR (p->>k)::numeric<0 THEN RAISE EXCEPTION 'Parâmetro % deve ser numérico e não negativo.',k; END IF; END LOOP;
  IF (p->>'juntaCm')::numeric>5 OR (p->>'perdaBloco')::numeric>100 OR (p->>'perdaArgamassa')::numeric>100 OR (p->>'perdaUsina')::numeric>100 THEN RAISE EXCEPTION 'Junta ou perda fora da faixa permitida.'; END IF;
END $$;

CREATE OR REPLACE FUNCTION validar_solucoes_estudo_viabilidade(p JSONB) RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path=public AS $$
DECLARE s JSONB; k TEXT; ks TEXT[]:=ARRAY['panos','paulistaCm','maoAssentamento','maoChapisco','maoPaulista'];
BEGIN
  IF jsonb_typeof(p)<>'array' OR jsonb_array_length(p)=0 THEN RAISE EXCEPTION 'Informe ao menos uma solução.'; END IF;
  FOR s IN SELECT value FROM jsonb_array_elements(p) LOOP
    IF jsonb_typeof(s)<>'object' OR NULLIF(btrim(s->>'id'),'') IS NULL OR NULLIF(btrim(s->>'nome'),'') IS NULL OR s->>'bloco' NOT IN ('9','11.5','19') THEN RAISE EXCEPTION 'Solução inválida.'; END IF;
    FOREACH k IN ARRAY ks LOOP IF jsonb_typeof(s->k)<>'number' OR (s->>k)::numeric<0 THEN RAISE EXCEPTION 'Campo % da solução inválido.',k; END IF; END LOOP;
    IF (s->>'panos')::numeric<>trunc((s->>'panos')::numeric) OR (s->>'panos')::numeric NOT BETWEEN 1 AND 3 OR (s->>'paulistaCm')::numeric>10 THEN RAISE EXCEPTION 'Panos ou espessura fora da faixa permitida.'; END IF;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION calcular_resultados_estudo_viabilidade(p JSONB, ss JSONB, area NUMERIC) RETURNS JSONB LANGUAGE plpgsql STABLE SET search_path=public AS $$
DECLARE s JSONB; rs JSONB:='[]'::jsonb; esp NUMERIC; preco NUMERIC; base NUMERIC; blocos NUMERIC; custo_bloco NUMERIC; assent_l NUMERIC; paulista_l NUMERIC; perda NUMERIC; assent NUMERIC; paulista NUMERIC; cimento NUMERIC; areia NUMERIC; mao NUMERIC; arg NUMERIC; total NUMERIC; pend TEXT; perda_u NUMERIC; principal NUMERIC; chapisco NUMERIC;
BEGIN
  PERFORM validar_parametros_estudo_viabilidade(p); PERFORM validar_solucoes_estudo_viabilidade(ss);
  FOR s IN SELECT value FROM jsonb_array_elements(ss) LOOP
    esp:=CASE s->>'bloco' WHEN '9' THEN .09 WHEN '11.5' THEN .115 ELSE .19 END;
    preco:=CASE s->>'bloco' WHEN '9' THEN (p->>'bloco9')::numeric WHEN '11.5' THEN (p->>'bloco115')::numeric ELSE (p->>'bloco19')::numeric END;
    base:=1/((.29+(p->>'juntaCm')::numeric/100)*(.19+(p->>'juntaCm')::numeric/100)); blocos:=base*(s->>'panos')::numeric*(1+(p->>'perdaBloco')::numeric/100); custo_bloco:=blocos/1000*preco;
    assent_l:=greatest(0,esp-base*esp*.19*.29)*(s->>'panos')::numeric; paulista_l:=2*(s->>'paulistaCm')::numeric/100; perda:=1+(p->>'perdaArgamassa')::numeric/100; assent:=assent_l*perda; paulista:=paulista_l*perda;
    cimento:=(assent*(p->>'cimentoAssentamento')::numeric+paulista*(p->>'cimentoPaulista')::numeric+2*(p->>'cimentoChapisco')::numeric*perda)*(p->>'cimentoSaco')::numeric/50;
    areia:=(assent*(p->>'areiaAssentamento')::numeric+paulista*(p->>'areiaPaulista')::numeric+2*(p->>'areiaChapisco')::numeric*perda)*(p->>'areia')::numeric; mao:=(s->>'maoAssentamento')::numeric*(s->>'panos')::numeric+(s->>'maoChapisco')::numeric+(s->>'maoPaulista')::numeric; arg:=NULL; total:=NULL; pend:=NULL;
    IF preco<=0 OR mao<=0 THEN pend:='Informe o preço do bloco e a mão de obra da solução.';
    ELSIF p->>'modalidade'='local' THEN
      IF (p->>'areia')::numeric<=0 OR (p->>'cimentoSaco')::numeric<=0 OR (p->>'custoHoraPreparo')::numeric<=0 OR (p->>'produtividadePrincipal')::numeric<=0 OR (p->>'produtividadeChapisco')::numeric<=0 OR (p->>'volumeChapisco')::numeric<=0 THEN pend:='Informe preços de areia e cimento, custo-hora, produtividades e volume de chapisco.';
      ELSE arg:=cimento+areia+(assent+paulista)/(p->>'produtividadePrincipal')::numeric*(p->>'custoHoraPreparo')::numeric+(p->>'volumeChapisco')::numeric*perda/(p->>'produtividadeChapisco')::numeric*(p->>'custoHoraPreparo')::numeric; END IF;
    ELSE
      IF (p->>'usinaPrincipal')::numeric<=0 OR (p->>'usinaChapisco')::numeric<=0 OR (p->>'volumeChapisco')::numeric<=0 THEN pend:='Informe cotação da usina e volume de chapisco.';
      ELSE perda_u:=1+(p->>'perdaUsina')::numeric/100; principal:=(assent_l+paulista_l)*perda_u; chapisco:=(p->>'volumeChapisco')::numeric*perda_u; arg:=greatest(principal*area,(p->>'minimoPrincipal')::numeric)*(p->>'usinaPrincipal')::numeric/area+(p->>'fretePrincipal')::numeric/area+principal*(p->>'recebimentoUsina')::numeric+greatest(chapisco*area,(p->>'minimoChapisco')::numeric)*(p->>'usinaChapisco')::numeric/area+(p->>'freteChapisco')::numeric/area+chapisco*(p->>'recebimentoUsina')::numeric; END IF;
    END IF;
    IF arg IS NOT NULL THEN total:=custo_bloco+arg+mao; END IF;
    rs:=rs||jsonb_build_array(jsonb_build_object('id',s->>'id','nome',s->>'nome','blocosM2',blocos,'espessuraFinalCm',esp*(s->>'panos')::numeric*100+2*(s->>'paulistaCm')::numeric,'custoBloco',custo_bloco,'custoArgamassa',arg,'custoAplicacao',mao,'totalM2',total,'totalArea',CASE WHEN total IS NULL THEN NULL ELSE total*area END,'motivoPendente',pend));
  END LOOP;
  RETURN jsonb_build_object('modalidade',p->>'modalidade','calculado_em',now(),'solucoes',rs);
END $$;

CREATE OR REPLACE FUNCTION validar_estudo_viabilidade() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE pendente BOOLEAN;
BEGIN
  IF TG_OP='UPDATE' AND OLD.status='aguardando_aprovacao' AND NEW.status<>OLD.status THEN
    NEW.obra_id:=OLD.obra_id; NEW.etapa_id:=OLD.etapa_id; NEW.servico_id:=OLD.servico_id; NEW.titulo:=OLD.titulo; NEW.area_m2:=OLD.area_m2; NEW.observacao_tecnica:=OLD.observacao_tecnica; NEW.fonte_custos:=OLD.fonte_custos; NEW.data_referencia_custos:=OLD.data_referencia_custos; NEW.parametros:=OLD.parametros; NEW.solucoes:=OLD.solucoes; NEW.resultados:=OLD.resultados; NEW.ativo:=OLD.ativo;
  END IF;
  NEW.titulo:=NULLIF(btrim(COALESCE(NEW.titulo,'')),''); NEW.observacao_tecnica:=NULLIF(btrim(COALESCE(NEW.observacao_tecnica,'')),''); NEW.fonte_custos:=NULLIF(btrim(COALESCE(NEW.fonte_custos,'')),''); NEW.decisao:=NULLIF(btrim(COALESCE(NEW.decisao,'')),''); NEW.motivo_devolucao:=NULLIF(btrim(COALESCE(NEW.motivo_devolucao,'')),'');
  IF NEW.titulo IS NULL OR NEW.area_m2<=0 THEN RAISE EXCEPTION 'Informe título e área maior que zero.'; END IF;
  IF NOT (TG_OP='UPDATE' AND OLD.status='aguardando_aprovacao' AND NEW.status<>OLD.status) THEN
    NEW.etapa_id:=validar_vinculo_estudo_viabilidade(NEW.obra_id,NEW.etapa_id,NEW.servico_id); NEW.resultados:=calcular_resultados_estudo_viabilidade(NEW.parametros,NEW.solucoes,NEW.area_m2); SELECT EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.resultados->'solucoes') s WHERE s->>'motivoPendente' IS NOT NULL) INTO pendente;
  END IF;
  NEW.atualizado_por:=auth.uid(); NEW.atualizado_em:=now();
  IF TG_OP='INSERT' THEN IF NEW.status<>'rascunho' THEN RAISE EXCEPTION 'Novo estudo deve iniciar como rascunho.'; END IF; NEW.criado_por:=auth.uid(); NEW.criado_em:=now(); NEW.enviado_por:=NULL; NEW.enviado_em:=NULL; NEW.aprovado_por:=NULL; NEW.aprovado_em:=NULL; NEW.devolvido_por:=NULL; NEW.devolvido_em:=NULL; NEW.decisao:=NULL; NEW.motivo_devolucao:=NULL; RETURN NEW; END IF;
  IF NEW.obra_id<>OLD.obra_id THEN RAISE EXCEPTION 'Não é permitido mover estudo entre obras.'; END IF; NEW.criado_por:=OLD.criado_por; NEW.criado_em:=OLD.criado_em; IF OLD.status='aprovado' THEN RAISE EXCEPTION 'Estudo aprovado é imutável.'; END IF;
  IF NEW.status=OLD.status THEN IF OLD.status<>'rascunho' THEN RAISE EXCEPTION 'Estudo aguardando aprovação não pode ser alterado.'; END IF; NEW.enviado_por:=OLD.enviado_por; NEW.enviado_em:=OLD.enviado_em; NEW.aprovado_por:=OLD.aprovado_por; NEW.aprovado_em:=OLD.aprovado_em; NEW.devolvido_por:=OLD.devolvido_por; NEW.devolvido_em:=OLD.devolvido_em; NEW.decisao:=OLD.decisao; NEW.motivo_devolucao:=OLD.motivo_devolucao; RETURN NEW; END IF;
  IF OLD.status='rascunho' AND NEW.status='aguardando_aprovacao' THEN IF NEW.fonte_custos IS NULL OR NEW.data_referencia_custos IS NULL OR pendente THEN RAISE EXCEPTION 'Para enviar, informe fonte e data dos custos e complete os parâmetros.'; END IF; NEW.enviado_por:=auth.uid(); NEW.enviado_em:=now(); NEW.aprovado_por:=NULL; NEW.aprovado_em:=NULL; NEW.devolvido_por:=NULL; NEW.devolvido_em:=NULL; NEW.decisao:=NULL; NEW.motivo_devolucao:=NULL; RETURN NEW; END IF;
  IF OLD.status='aguardando_aprovacao' AND NEW.status='aprovado' THEN IF meu_papel()<>'admin' OR NEW.decisao IS NULL THEN RAISE EXCEPTION 'Somente o admin pode aprovar, com decisão técnica registrada.'; END IF; NEW.enviado_por:=OLD.enviado_por; NEW.enviado_em:=OLD.enviado_em; NEW.aprovado_por:=auth.uid(); NEW.aprovado_em:=now(); NEW.devolvido_por:=NULL; NEW.devolvido_em:=NULL; NEW.motivo_devolucao:=NULL; RETURN NEW; END IF;
  IF OLD.status='aguardando_aprovacao' AND NEW.status='rascunho' THEN IF meu_papel()<>'admin' OR NEW.motivo_devolucao IS NULL THEN RAISE EXCEPTION 'Somente o admin pode devolver, com motivo registrado.'; END IF; NEW.enviado_por:=OLD.enviado_por; NEW.enviado_em:=OLD.enviado_em; NEW.aprovado_por:=NULL; NEW.aprovado_em:=NULL; NEW.devolvido_por:=auth.uid(); NEW.devolvido_em:=now(); NEW.decisao:=NULL; RETURN NEW; END IF;
  RAISE EXCEPTION 'Transição de status inválida: % -> %.',OLD.status,NEW.status;
END $$;
CREATE TRIGGER estudos_viabilidade_validar BEFORE INSERT OR UPDATE ON estudos_viabilidade FOR EACH ROW EXECUTE FUNCTION validar_estudo_viabilidade();
ALTER TABLE estudos_viabilidade ENABLE ROW LEVEL SECURITY;
CREATE POLICY estudos_viabilidade_obra ON estudos_viabilidade AS RESTRICTIVE FOR ALL TO authenticated USING(pode_acessar_obra(obra_id)) WITH CHECK(pode_acessar_obra(obra_id));
CREATE POLICY estudos_viabilidade_select ON estudos_viabilidade FOR SELECT TO authenticated USING(meu_papel() IN ('admin','equipe') AND (ativo OR pode_editar_estudos_viabilidade()));
CREATE POLICY estudos_viabilidade_insert ON estudos_viabilidade FOR INSERT TO authenticated WITH CHECK(pode_editar_estudos_viabilidade());
CREATE POLICY estudos_viabilidade_update ON estudos_viabilidade FOR UPDATE TO authenticated USING(pode_editar_estudos_viabilidade()) WITH CHECK(pode_editar_estudos_viabilidade());
REVOKE ALL ON FUNCTION validar_vinculo_estudo_viabilidade(UUID,UUID,UUID) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION validar_estudo_viabilidade() FROM PUBLIC,anon,authenticated;
