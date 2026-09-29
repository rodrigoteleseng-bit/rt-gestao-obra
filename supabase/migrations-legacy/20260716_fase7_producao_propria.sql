-- ============================================================
-- FASE 7 — PRODUÇÃO PRÓPRIA | RT Engenharia
-- Spec: docs/superpowers/specs/2026-07-16-fase7-producao-propria-design.md
-- ============================================================

CREATE TYPE tipo_servico_producao AS ENUM ('alvenaria', 'reboco');
CREATE TYPE tipo_abertura_producao AS ENUM ('porta', 'janela', 'outro');
CREATE TYPE status_medicao_producao AS ENUM ('rascunho', 'aprovada', 'paga', 'cancelada');

CREATE TABLE producao_salarios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  obra_id UUID NOT NULL REFERENCES obras(id) ON DELETE CASCADE,
  trabalhador_id UUID NOT NULL REFERENCES trabalhadores(id),
  funcao TEXT NOT NULL,
  salario_mensal NUMERIC(14,2) NOT NULL CHECK (salario_mensal > 0),
  vigente_desde DATE NOT NULL,
  vigente_ate DATE CHECK (vigente_ate IS NULL OR vigente_ate >= vigente_desde),
  ativo BOOLEAN NOT NULL DEFAULT true,
  criado_por UUID NOT NULL DEFAULT auth.uid() REFERENCES perfis_usuario(id),
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_prod_salarios_trabalhador ON producao_salarios(trabalhador_id, vigente_desde);

CREATE OR REPLACE FUNCTION producao_validar_vigencia_salario() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF NEW.ativo AND EXISTS (
   SELECT 1 FROM producao_salarios s WHERE s.trabalhador_id=NEW.trabalhador_id AND s.ativo
   AND s.id<>NEW.id AND daterange(s.vigente_desde,COALESCE(s.vigente_ate,'infinity'::date),'[]')
     && daterange(NEW.vigente_desde,COALESCE(NEW.vigente_ate,'infinity'::date),'[]')
 ) THEN RAISE EXCEPTION 'Já existe salário vigente neste período para o profissional.'; END IF;
 IF NOT EXISTS (SELECT 1 FROM trabalhadores t WHERE t.id=NEW.trabalhador_id AND t.obra_id=NEW.obra_id) THEN
   RAISE EXCEPTION 'Profissional não pertence à obra.'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER trg_prod_vigencia_salario BEFORE INSERT OR UPDATE ON producao_salarios
FOR EACH ROW EXECUTE FUNCTION producao_validar_vigencia_salario();

CREATE TABLE producao_lancamentos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  obra_id UUID NOT NULL REFERENCES obras(id) ON DELETE CASCADE,
  unidade_id UUID NOT NULL REFERENCES unidades(id),
  data_producao DATE NOT NULL,
  servico tipo_servico_producao NOT NULL,
  parede_nome TEXT NOT NULL CHECK (btrim(parede_nome) <> ''),
  comprimento NUMERIC(14,4) NOT NULL CHECK (comprimento > 0),
  altura NUMERIC(14,4) NOT NULL CHECK (altura > 0),
  area_bruta NUMERIC(14,4) NOT NULL DEFAULT 0,
  area_aberturas NUMERIC(14,4) NOT NULL DEFAULT 0,
  area_liquida NUMERIC(14,4) NOT NULL DEFAULT 0,
  preco_m2 NUMERIC(14,2) NOT NULL CHECK (preco_m2 > 0),
  valor_total NUMERIC(14,2) NOT NULL DEFAULT 0,
  observacao TEXT,
  ativo BOOLEAN NOT NULL DEFAULT true,
  criado_por UUID NOT NULL DEFAULT auth.uid() REFERENCES perfis_usuario(id),
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  editado_por UUID REFERENCES perfis_usuario(id),
  editado_em TIMESTAMPTZ
);
CREATE INDEX idx_prod_lancamentos_obra_data ON producao_lancamentos(obra_id, data_producao) WHERE ativo;

CREATE TABLE producao_aberturas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lancamento_id UUID NOT NULL REFERENCES producao_lancamentos(id) ON DELETE CASCADE,
  tipo tipo_abertura_producao NOT NULL,
  identificacao TEXT,
  comprimento NUMERIC(14,4) NOT NULL CHECK (comprimento > 0),
  altura NUMERIC(14,4) NOT NULL CHECK (altura > 0),
  area NUMERIC(14,4) NOT NULL DEFAULT 0,
  ativo BOOLEAN NOT NULL DEFAULT true,
  criado_por UUID NOT NULL DEFAULT auth.uid() REFERENCES perfis_usuario(id),
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_prod_aberturas_lancamento ON producao_aberturas(lancamento_id) WHERE ativo;

CREATE TABLE producao_participantes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lancamento_id UUID NOT NULL REFERENCES producao_lancamentos(id) ON DELETE CASCADE,
  trabalhador_id UUID NOT NULL REFERENCES trabalhadores(id),
  fracao NUMERIC(18,10) NOT NULL DEFAULT 0,
  area_atribuida NUMERIC(14,4) NOT NULL DEFAULT 0,
  valor_atribuido NUMERIC(14,2) NOT NULL DEFAULT 0,
  ativo BOOLEAN NOT NULL DEFAULT true,
  criado_por UUID NOT NULL DEFAULT auth.uid() REFERENCES perfis_usuario(id),
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_prod_participante_unico ON producao_participantes(lancamento_id, trabalhador_id) WHERE ativo;
CREATE INDEX idx_prod_participante_trab ON producao_participantes(trabalhador_id) WHERE ativo;

CREATE TABLE producao_medicoes_seq (
  obra_id UUID PRIMARY KEY REFERENCES obras(id) ON DELETE CASCADE,
  ultimo_numero INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE producao_medicoes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  obra_id UUID NOT NULL REFERENCES obras(id) ON DELETE CASCADE,
  trabalhador_id UUID NOT NULL REFERENCES trabalhadores(id),
  numero INTEGER NOT NULL,
  data_inicio DATE NOT NULL,
  data_fim DATE NOT NULL CHECK (data_fim >= data_inicio),
  status status_medicao_producao NOT NULL DEFAULT 'rascunho',
  valor_producao NUMERIC(14,2) NOT NULL DEFAULT 0,
  valor_salarial NUMERIC(14,2) NOT NULL DEFAULT 0,
  valor_total NUMERIC(14,2) NOT NULL DEFAULT 0,
  aprovada_por UUID REFERENCES perfis_usuario(id),
  aprovada_em TIMESTAMPTZ,
  paga_por UUID REFERENCES perfis_usuario(id),
  paga_em TIMESTAMPTZ,
  cancelada_por UUID REFERENCES perfis_usuario(id),
  cancelada_em TIMESTAMPTZ,
  motivo_cancelamento TEXT,
  ativo BOOLEAN NOT NULL DEFAULT true,
  criado_por UUID NOT NULL DEFAULT auth.uid() REFERENCES perfis_usuario(id),
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (obra_id, numero)
);
CREATE INDEX idx_prod_medicoes_obra ON producao_medicoes(obra_id, criado_em DESC);

CREATE TABLE producao_dias_salariais (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  obra_id UUID NOT NULL REFERENCES obras(id) ON DELETE CASCADE,
  trabalhador_id UUID NOT NULL REFERENCES trabalhadores(id),
  data DATE NOT NULL,
  salario_id UUID NOT NULL REFERENCES producao_salarios(id),
  salario_mensal_snapshot NUMERIC(14,2) NOT NULL,
  divisor_snapshot NUMERIC(6,2) NOT NULL DEFAULT 30 CHECK (divisor_snapshot = 30),
  valor_dia NUMERIC(18,6) NOT NULL,
  motivo TEXT NOT NULL CHECK (btrim(motivo) <> ''),
  medicao_id UUID REFERENCES producao_medicoes(id),
  ativo BOOLEAN NOT NULL DEFAULT true,
  criado_por UUID NOT NULL DEFAULT auth.uid() REFERENCES perfis_usuario(id),
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_prod_dia_salarial_unico ON producao_dias_salariais(obra_id, trabalhador_id, data) WHERE ativo;

CREATE TABLE producao_medicao_lancamentos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  medicao_id UUID NOT NULL REFERENCES producao_medicoes(id),
  participante_id UUID NOT NULL REFERENCES producao_participantes(id),
  lancamento_id UUID NOT NULL REFERENCES producao_lancamentos(id),
  data_producao DATE NOT NULL,
  servico tipo_servico_producao NOT NULL,
  parede_nome TEXT NOT NULL,
  area_total NUMERIC(14,4) NOT NULL,
  fracao NUMERIC(18,10) NOT NULL,
  area_atribuida NUMERIC(14,4) NOT NULL,
  preco_m2 NUMERIC(14,2) NOT NULL,
  valor_atribuido NUMERIC(14,2) NOT NULL,
  ativo BOOLEAN NOT NULL DEFAULT true,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (medicao_id, participante_id)
);
CREATE UNIQUE INDEX idx_prod_participante_em_medicao_ativa ON producao_medicao_lancamentos(participante_id) WHERE ativo;

CREATE TABLE producao_medicao_dias (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  medicao_id UUID NOT NULL REFERENCES producao_medicoes(id),
  dia_salarial_id UUID NOT NULL REFERENCES producao_dias_salariais(id),
  data DATE NOT NULL,
  salario_mensal NUMERIC(14,2) NOT NULL,
  divisor NUMERIC(6,2) NOT NULL,
  valor_dia NUMERIC(18,6) NOT NULL,
  motivo TEXT NOT NULL,
  ativo BOOLEAN NOT NULL DEFAULT true,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (medicao_id, dia_salarial_id)
);
CREATE UNIQUE INDEX idx_prod_dia_em_medicao_ativa ON producao_medicao_dias(dia_salarial_id) WHERE ativo;

-- ---------- Cálculos e integridade ----------
CREATE OR REPLACE FUNCTION producao_numero_medicao() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO producao_medicoes_seq(obra_id, ultimo_numero) VALUES (NEW.obra_id, 0)
  ON CONFLICT (obra_id) DO NOTHING;
  UPDATE producao_medicoes_seq SET ultimo_numero = ultimo_numero + 1
  WHERE obra_id = NEW.obra_id RETURNING ultimo_numero INTO NEW.numero;
  RETURN NEW;
END; $$;
CREATE TRIGGER trg_prod_numero_medicao BEFORE INSERT ON producao_medicoes
FOR EACH ROW EXECUTE FUNCTION producao_numero_medicao();

CREATE OR REPLACE FUNCTION producao_preparar_abertura() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.area := ROUND(NEW.comprimento * NEW.altura, 4); RETURN NEW; END; $$;
CREATE TRIGGER trg_prod_preparar_abertura BEFORE INSERT OR UPDATE ON producao_aberturas
FOR EACH ROW EXECUTE FUNCTION producao_preparar_abertura();

CREATE OR REPLACE FUNCTION producao_recalcular(p_lancamento UUID) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_bruta NUMERIC(14,4); v_aberturas NUMERIC(14,4); v_liquida NUMERIC(14,4);
        v_valor NUMERIC(14,2); v_n INTEGER; v_i INTEGER := 0; v_distribuido NUMERIC(14,2) := 0;
        v_part RECORD; v_parte NUMERIC(14,2);
BEGIN
  SELECT ROUND(comprimento*altura,4), preco_m2 INTO v_bruta, v_valor
  FROM producao_lancamentos WHERE id=p_lancamento FOR UPDATE;
  SELECT COALESCE(SUM(area),0) INTO v_aberturas FROM producao_aberturas
  WHERE lancamento_id=p_lancamento AND ativo;
  v_liquida := ROUND(v_bruta-v_aberturas,4);
  IF v_liquida <= 0 THEN RAISE EXCEPTION 'A área das aberturas deve ser menor que a área bruta.'; END IF;
  SELECT ROUND(v_liquida*preco_m2,2) INTO v_valor FROM producao_lancamentos WHERE id=p_lancamento;
  UPDATE producao_lancamentos SET area_bruta=v_bruta, area_aberturas=v_aberturas,
    area_liquida=v_liquida, valor_total=v_valor WHERE id=p_lancamento;
  SELECT COUNT(*) INTO v_n FROM producao_participantes WHERE lancamento_id=p_lancamento AND ativo;
  IF v_n=0 THEN RETURN; END IF;
  FOR v_part IN SELECT id FROM producao_participantes WHERE lancamento_id=p_lancamento AND ativo ORDER BY trabalhador_id LOOP
    v_i := v_i+1;
    v_parte := CASE WHEN v_i=v_n THEN v_valor-v_distribuido ELSE ROUND(v_valor/v_n,2) END;
    UPDATE producao_participantes SET fracao=1.0/v_n,
      area_atribuida=ROUND(v_liquida/v_n,4), valor_atribuido=v_parte WHERE id=v_part.id;
    v_distribuido := v_distribuido+v_parte;
  END LOOP;
END; $$;

CREATE OR REPLACE FUNCTION producao_recalcular_trigger() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN PERFORM producao_recalcular(COALESCE(NEW.lancamento_id,OLD.lancamento_id)); RETURN NULL; END; $$;
CREATE TRIGGER trg_prod_recalc_abertura AFTER INSERT OR UPDATE ON producao_aberturas
FOR EACH ROW EXECUTE FUNCTION producao_recalcular_trigger();
CREATE TRIGGER trg_prod_recalc_participante AFTER INSERT OR UPDATE OF ativo, trabalhador_id, lancamento_id ON producao_participantes
FOR EACH ROW EXECUTE FUNCTION producao_recalcular_trigger();

CREATE OR REPLACE FUNCTION producao_preparar_lancamento() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM producao_medicao_lancamentos ml JOIN producao_participantes p ON p.id=ml.participante_id
             WHERE p.lancamento_id=OLD.id) THEN RAISE EXCEPTION 'Produção já incluída em medição não pode ser alterada.'; END IF;
  NEW.area_bruta:=ROUND(NEW.comprimento*NEW.altura,4);
  NEW.area_liquida:=ROUND(NEW.area_bruta-OLD.area_aberturas,4);
  IF NEW.area_liquida<=0 THEN RAISE EXCEPTION 'A área líquida deve ser positiva.'; END IF;
  NEW.valor_total:=ROUND(NEW.area_liquida*NEW.preco_m2,2);
  IF TG_OP='UPDATE' THEN NEW.editado_por:=auth.uid(); NEW.editado_em:=now(); END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER trg_prod_preparar_lancamento BEFORE UPDATE ON producao_lancamentos
FOR EACH ROW EXECUTE FUNCTION producao_preparar_lancamento();

CREATE OR REPLACE FUNCTION producao_inicializar_lancamento() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
IF NOT EXISTS (SELECT 1 FROM unidades u WHERE u.id=NEW.unidade_id AND u.obra_id=NEW.obra_id) THEN
  RAISE EXCEPTION 'Unidade não pertence à obra.'; END IF;
NEW.area_bruta:=ROUND(NEW.comprimento*NEW.altura,4); NEW.area_liquida:=NEW.area_bruta;
NEW.valor_total:=ROUND(NEW.area_liquida*NEW.preco_m2,2); RETURN NEW; END; $$;
CREATE TRIGGER trg_prod_inicializar_lancamento BEFORE INSERT ON producao_lancamentos
FOR EACH ROW EXECUTE FUNCTION producao_inicializar_lancamento();

CREATE OR REPLACE FUNCTION producao_validar_mutacao_filha() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_lanc UUID:=COALESCE(OLD.lancamento_id,NEW.lancamento_id);
BEGIN
 IF EXISTS (SELECT 1 FROM producao_medicao_lancamentos ml JOIN producao_participantes p ON p.id=ml.participante_id
            WHERE p.lancamento_id=v_lanc) THEN RAISE EXCEPTION 'Produção já incluída em medição não pode ser alterada.'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER trg_prod_trava_abertura BEFORE INSERT OR UPDATE ON producao_aberturas
FOR EACH ROW EXECUTE FUNCTION producao_validar_mutacao_filha();
CREATE TRIGGER trg_prod_trava_participante BEFORE INSERT OR UPDATE ON producao_participantes
FOR EACH ROW EXECUTE FUNCTION producao_validar_mutacao_filha();

CREATE OR REPLACE FUNCTION producao_validar_conflito_dia() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_data DATE; v_obra UUID;
BEGIN
 SELECT data_producao,obra_id INTO v_data,v_obra FROM producao_lancamentos WHERE id=NEW.lancamento_id;
 IF NEW.ativo AND EXISTS (SELECT 1 FROM producao_dias_salariais d WHERE d.obra_id=v_obra
   AND d.trabalhador_id=NEW.trabalhador_id AND d.data=v_data AND d.ativo) THEN
   RAISE EXCEPTION 'O profissional já possui dia salarial nesta data.'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER trg_prod_conflito_participante BEFORE INSERT OR UPDATE ON producao_participantes
FOR EACH ROW EXECUTE FUNCTION producao_validar_conflito_dia();

CREATE OR REPLACE FUNCTION producao_preparar_dia_salarial() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_sal producao_salarios%ROWTYPE;
BEGIN
 SELECT * INTO v_sal FROM producao_salarios s WHERE s.id=NEW.salario_id AND s.ativo
   AND s.obra_id=NEW.obra_id AND s.trabalhador_id=NEW.trabalhador_id
   AND s.vigente_desde<=NEW.data AND (s.vigente_ate IS NULL OR s.vigente_ate>=NEW.data);
 IF NOT FOUND THEN RAISE EXCEPTION 'Não há salário vigente válido para esta data.'; END IF;
 IF EXISTS (SELECT 1 FROM producao_participantes p JOIN producao_lancamentos l ON l.id=p.lancamento_id
   WHERE p.trabalhador_id=NEW.trabalhador_id AND p.ativo AND l.ativo AND l.obra_id=NEW.obra_id
   AND l.data_producao=NEW.data) THEN RAISE EXCEPTION 'O profissional já possui produção nesta data.'; END IF;
 NEW.salario_mensal_snapshot:=v_sal.salario_mensal; NEW.divisor_snapshot:=30;
 NEW.valor_dia:=v_sal.salario_mensal/30.0; RETURN NEW;
END; $$;
CREATE TRIGGER trg_prod_preparar_dia BEFORE INSERT OR UPDATE ON producao_dias_salariais
FOR EACH ROW EXECUTE FUNCTION producao_preparar_dia_salarial();

CREATE OR REPLACE FUNCTION producao_aprovar_medicao(p_medicao UUID) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_m producao_medicoes%ROWTYPE; v_prod NUMERIC(14,2); v_sal NUMERIC(14,2);
BEGIN
 IF meu_papel()<>'admin' THEN RAISE EXCEPTION 'Somente o admin pode aprovar.'; END IF;
 SELECT * INTO v_m FROM producao_medicoes WHERE id=p_medicao FOR UPDATE;
 IF v_m.status<>'rascunho' THEN RAISE EXCEPTION 'A medição precisa estar em rascunho.'; END IF;
 INSERT INTO producao_medicao_lancamentos(medicao_id,participante_id,lancamento_id,data_producao,servico,
   parede_nome,area_total,fracao,area_atribuida,preco_m2,valor_atribuido)
 SELECT v_m.id,p.id,l.id,l.data_producao,l.servico,l.parede_nome,l.area_liquida,p.fracao,
   p.area_atribuida,l.preco_m2,p.valor_atribuido FROM producao_participantes p
 JOIN producao_lancamentos l ON l.id=p.lancamento_id
 WHERE p.trabalhador_id=v_m.trabalhador_id AND p.ativo AND l.ativo AND l.obra_id=v_m.obra_id
   AND l.data_producao BETWEEN v_m.data_inicio AND v_m.data_fim
   AND NOT EXISTS (SELECT 1 FROM producao_medicao_lancamentos usado
                   WHERE usado.participante_id=p.id AND usado.ativo);
 INSERT INTO producao_medicao_dias(medicao_id,dia_salarial_id,data,salario_mensal,divisor,valor_dia,motivo)
 SELECT v_m.id,d.id,d.data,d.salario_mensal_snapshot,d.divisor_snapshot,d.valor_dia,d.motivo
 FROM producao_dias_salariais d WHERE d.trabalhador_id=v_m.trabalhador_id AND d.obra_id=v_m.obra_id
   AND d.ativo AND d.medicao_id IS NULL AND d.data BETWEEN v_m.data_inicio AND v_m.data_fim;
 UPDATE producao_dias_salariais SET medicao_id=v_m.id WHERE id IN
   (SELECT dia_salarial_id FROM producao_medicao_dias WHERE medicao_id=v_m.id);
 SELECT COALESCE(SUM(valor_atribuido),0) INTO v_prod FROM producao_medicao_lancamentos WHERE medicao_id=v_m.id AND ativo;
 SELECT ROUND(COALESCE(SUM(valor_dia),0),2) INTO v_sal FROM producao_medicao_dias WHERE medicao_id=v_m.id AND ativo;
 PERFORM set_config('app.aprovando_producao','1',true);
 UPDATE producao_medicoes SET status='aprovada',valor_producao=v_prod,valor_salarial=v_sal,
   valor_total=v_prod+v_sal,aprovada_por=auth.uid(),aprovada_em=now() WHERE id=v_m.id;
END; $$;

CREATE OR REPLACE FUNCTION producao_transicionar_medicao() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF OLD.status IN ('paga','cancelada') THEN RAISE EXCEPTION 'Medição encerrada não pode ser alterada.'; END IF;
 IF NEW.status IS DISTINCT FROM OLD.status THEN
   IF meu_papel()<>'admin' THEN RAISE EXCEPTION 'Somente o admin altera o status.'; END IF;
   IF NOT ((OLD.status='aprovada' AND NEW.status IN ('paga','cancelada')) OR
           (OLD.status='rascunho' AND NEW.status='cancelada') OR
           (OLD.status='rascunho' AND NEW.status='aprovada' AND current_setting('app.aprovando_producao',true)='1')) THEN
     RAISE EXCEPTION 'Transição de status inválida.'; END IF;
   IF NEW.status='paga' THEN NEW.paga_por:=auth.uid(); NEW.paga_em:=now(); END IF;
   IF NEW.status='cancelada' THEN
     IF NULLIF(btrim(NEW.motivo_cancelamento),'') IS NULL THEN RAISE EXCEPTION 'Informe o motivo do cancelamento.'; END IF;
     NEW.cancelada_por:=auth.uid(); NEW.cancelada_em:=now();
   END IF;
 END IF;
 IF current_setting('app.aprovando_producao',true) IS DISTINCT FROM '1' THEN
   NEW.valor_producao:=OLD.valor_producao; NEW.valor_salarial:=OLD.valor_salarial; NEW.valor_total:=OLD.valor_total;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER trg_prod_transicionar_medicao BEFORE UPDATE ON producao_medicoes
FOR EACH ROW EXECUTE FUNCTION producao_transicionar_medicao();

CREATE OR REPLACE FUNCTION producao_cancelar_medicao(p_medicao UUID,p_motivo TEXT) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_status status_medicao_producao;
BEGIN
 IF meu_papel()<>'admin' THEN RAISE EXCEPTION 'Somente o admin pode cancelar.'; END IF;
 SELECT status INTO v_status FROM producao_medicoes WHERE id=p_medicao FOR UPDATE;
 IF v_status NOT IN ('rascunho','aprovada') THEN RAISE EXCEPTION 'Medição não pode ser cancelada.'; END IF;
 UPDATE producao_dias_salariais SET medicao_id=NULL WHERE medicao_id=p_medicao;
 UPDATE producao_medicao_lancamentos SET ativo=false WHERE medicao_id=p_medicao AND ativo;
 UPDATE producao_medicao_dias SET ativo=false WHERE medicao_id=p_medicao AND ativo;
 UPDATE producao_medicoes SET status='cancelada',motivo_cancelamento=p_motivo WHERE id=p_medicao;
END; $$;

CREATE OR REPLACE FUNCTION producao_cadastrar_salario(p_obra UUID,p_trabalhador UUID,p_funcao TEXT,
  p_salario NUMERIC,p_vigente_desde DATE) RETURNS producao_salarios
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_novo producao_salarios;
BEGIN
 IF NOT pode_editar_medicoes() THEN RAISE EXCEPTION 'Sem permissão.'; END IF;
 UPDATE producao_salarios SET vigente_ate=p_vigente_desde-1
 WHERE obra_id=p_obra AND trabalhador_id=p_trabalhador AND ativo AND vigente_ate IS NULL
   AND vigente_desde<p_vigente_desde;
 INSERT INTO producao_salarios(obra_id,trabalhador_id,funcao,salario_mensal,vigente_desde)
 VALUES(p_obra,p_trabalhador,p_funcao,p_salario,p_vigente_desde) RETURNING * INTO v_novo;
 RETURN v_novo;
END; $$;

CREATE OR REPLACE FUNCTION producao_criar_lancamento(p_obra UUID,p_unidade UUID,p_data DATE,
  p_servico tipo_servico_producao,p_parede TEXT,p_comprimento NUMERIC,p_altura NUMERIC,
  p_preco NUMERIC,p_observacao TEXT,p_trabalhadores UUID[],p_aberturas JSONB DEFAULT '[]')
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_id UUID; v_ab JSONB; v_trab UUID;
BEGIN
 IF NOT pode_editar_medicoes() THEN RAISE EXCEPTION 'Sem permissão.'; END IF;
 IF COALESCE(array_length(p_trabalhadores,1),0)=0 THEN RAISE EXCEPTION 'Selecione ao menos um profissional.'; END IF;
 INSERT INTO producao_lancamentos(obra_id,unidade_id,data_producao,servico,parede_nome,
   comprimento,altura,preco_m2,observacao)
 VALUES(p_obra,p_unidade,p_data,p_servico,p_parede,p_comprimento,p_altura,p_preco,p_observacao)
 RETURNING id INTO v_id;
 FOR v_ab IN SELECT * FROM jsonb_array_elements(COALESCE(p_aberturas,'[]')) LOOP
   INSERT INTO producao_aberturas(lancamento_id,tipo,identificacao,comprimento,altura)
   VALUES(v_id,(v_ab->>'tipo')::tipo_abertura_producao,NULLIF(v_ab->>'identificacao',''),
     (v_ab->>'comprimento')::numeric,(v_ab->>'altura')::numeric);
 END LOOP;
 FOREACH v_trab IN ARRAY p_trabalhadores LOOP
   IF NOT EXISTS(SELECT 1 FROM trabalhadores WHERE id=v_trab AND obra_id=p_obra AND ativo) THEN
     RAISE EXCEPTION 'Profissional inválido para a obra.'; END IF;
   INSERT INTO producao_participantes(lancamento_id,trabalhador_id) VALUES(v_id,v_trab);
 END LOOP;
 PERFORM producao_recalcular(v_id);
 RETURN v_id;
END; $$;

-- ---------- RLS ----------
ALTER TABLE producao_salarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE producao_lancamentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE producao_aberturas ENABLE ROW LEVEL SECURITY;
ALTER TABLE producao_participantes ENABLE ROW LEVEL SECURITY;
ALTER TABLE producao_medicoes_seq ENABLE ROW LEVEL SECURITY;
ALTER TABLE producao_medicoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE producao_dias_salariais ENABLE ROW LEVEL SECURITY;
ALTER TABLE producao_medicao_lancamentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE producao_medicao_dias ENABLE ROW LEVEL SECURITY;

CREATE POLICY prod_sal_select ON producao_salarios FOR SELECT USING ((ativo AND meu_papel() IN ('admin','equipe')) OR pode_editar_medicoes());
CREATE POLICY prod_sal_insert ON producao_salarios FOR INSERT WITH CHECK (pode_editar_medicoes() AND criado_por=auth.uid());
CREATE POLICY prod_sal_update ON producao_salarios FOR UPDATE USING (pode_editar_medicoes()) WITH CHECK (pode_editar_medicoes());
CREATE POLICY prod_lan_select ON producao_lancamentos FOR SELECT USING ((ativo AND meu_papel() IN ('admin','equipe')) OR pode_editar_medicoes());
CREATE POLICY prod_lan_insert ON producao_lancamentos FOR INSERT WITH CHECK (pode_editar_medicoes() AND criado_por=auth.uid());
CREATE POLICY prod_lan_update ON producao_lancamentos FOR UPDATE USING (pode_editar_medicoes()) WITH CHECK (pode_editar_medicoes());
CREATE POLICY prod_abe_select ON producao_aberturas FOR SELECT USING ((ativo AND meu_papel() IN ('admin','equipe')) OR pode_editar_medicoes());
CREATE POLICY prod_abe_insert ON producao_aberturas FOR INSERT WITH CHECK (pode_editar_medicoes() AND criado_por=auth.uid());
CREATE POLICY prod_abe_update ON producao_aberturas FOR UPDATE USING (pode_editar_medicoes()) WITH CHECK (pode_editar_medicoes());
CREATE POLICY prod_par_select ON producao_participantes FOR SELECT USING ((ativo AND meu_papel() IN ('admin','equipe')) OR pode_editar_medicoes());
CREATE POLICY prod_par_insert ON producao_participantes FOR INSERT WITH CHECK (pode_editar_medicoes() AND criado_por=auth.uid());
CREATE POLICY prod_par_update ON producao_participantes FOR UPDATE USING (pode_editar_medicoes()) WITH CHECK (pode_editar_medicoes());
CREATE POLICY prod_dia_select ON producao_dias_salariais FOR SELECT USING ((ativo AND meu_papel() IN ('admin','equipe')) OR pode_editar_medicoes());
CREATE POLICY prod_dia_insert ON producao_dias_salariais FOR INSERT WITH CHECK (pode_editar_medicoes() AND criado_por=auth.uid());
CREATE POLICY prod_dia_update ON producao_dias_salariais FOR UPDATE USING (pode_editar_medicoes()) WITH CHECK (pode_editar_medicoes());
CREATE POLICY prod_med_select ON producao_medicoes FOR SELECT USING ((ativo AND meu_papel() IN ('admin','equipe')) OR pode_editar_medicoes());
CREATE POLICY prod_med_insert ON producao_medicoes FOR INSERT WITH CHECK (pode_editar_medicoes() AND status='rascunho' AND criado_por=auth.uid());
CREATE POLICY prod_med_update ON producao_medicoes FOR UPDATE USING (pode_editar_medicoes()) WITH CHECK (pode_editar_medicoes());
CREATE POLICY prod_seq_select ON producao_medicoes_seq FOR SELECT USING (meu_papel() IN ('admin','equipe'));
CREATE POLICY prod_ml_select ON producao_medicao_lancamentos FOR SELECT USING (meu_papel() IN ('admin','equipe'));
CREATE POLICY prod_md_select ON producao_medicao_dias FOR SELECT USING (meu_papel() IN ('admin','equipe'));

REVOKE ALL ON FUNCTION producao_aprovar_medicao(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION producao_cancelar_medicao(UUID,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION producao_aprovar_medicao(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION producao_cancelar_medicao(UUID,TEXT) TO authenticated;
REVOKE ALL ON FUNCTION producao_cadastrar_salario(UUID,UUID,TEXT,NUMERIC,DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION producao_criar_lancamento(UUID,UUID,DATE,tipo_servico_producao,TEXT,NUMERIC,NUMERIC,NUMERIC,TEXT,UUID[],JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION producao_cadastrar_salario(UUID,UUID,TEXT,NUMERIC,DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION producao_criar_lancamento(UUID,UUID,DATE,tipo_servico_producao,TEXT,NUMERIC,NUMERIC,NUMERIC,TEXT,UUID[],JSONB) TO authenticated;
