-- Isolamento multiobra: admin acessa todas as obras; equipe e cliente somente as vinculadas.
-- As policies RESTRICTIVE complementam (AND) as policies funcionais já existentes.

CREATE TABLE usuarios_obras (
  usuario_id    UUID NOT NULL REFERENCES perfis_usuario(id) ON DELETE CASCADE,
  obra_id       UUID NOT NULL REFERENCES obras(id) ON DELETE CASCADE,
  ativo         BOOLEAN NOT NULL DEFAULT true,
  criado_por    UUID DEFAULT auth.uid() REFERENCES perfis_usuario(id),
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_por UUID DEFAULT auth.uid() REFERENCES perfis_usuario(id),
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (usuario_id, obra_id)
);

CREATE INDEX idx_usuarios_obras_obra ON usuarios_obras(obra_id) WHERE ativo;

-- Preserva exatamente o acesso atual na implantação: todos os usuários existentes
-- começam vinculados a todas as obras existentes. Os próximos vínculos são explícitos.
INSERT INTO usuarios_obras (usuario_id, obra_id, criado_por, atualizado_por)
SELECT p.id, o.id,
       (SELECT id FROM perfis_usuario WHERE papel = 'admin' AND ativo ORDER BY criado_em LIMIT 1),
       (SELECT id FROM perfis_usuario WHERE papel = 'admin' AND ativo ORDER BY criado_em LIMIT 1)
FROM perfis_usuario p
CROSS JOIN obras o
WHERE p.ativo AND o.ativo
ON CONFLICT (usuario_id, obra_id) DO UPDATE
SET ativo = true, atualizado_em = now();

ALTER TABLE usuarios_obras ENABLE ROW LEVEL SECURITY;

CREATE POLICY usuarios_obras_select ON usuarios_obras FOR SELECT TO authenticated
  USING (meu_papel() = 'admin' OR (usuario_id = auth.uid() AND ativo));
CREATE POLICY usuarios_obras_insert ON usuarios_obras FOR INSERT TO authenticated
  WITH CHECK (meu_papel() = 'admin');
CREATE POLICY usuarios_obras_update ON usuarios_obras FOR UPDATE TO authenticated
  USING (meu_papel() = 'admin') WITH CHECK (meu_papel() = 'admin');

CREATE OR REPLACE FUNCTION pode_acessar_obra(p_obra UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM perfis_usuario p
    WHERE p.id = auth.uid()
      AND p.ativo
      AND (
        p.papel = 'admin'
        OR EXISTS (
          SELECT 1 FROM usuarios_obras uo
          JOIN obras o ON o.id = uo.obra_id AND o.ativo
          WHERE uo.usuario_id = p.id
            AND uo.obra_id = p_obra
            AND uo.ativo
        )
      )
  )
$$;

CREATE OR REPLACE FUNCTION pode_ver_perfil(p_usuario UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT meu_papel() = 'admin'
    OR p_usuario = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM usuarios_obras minha
      JOIN usuarios_obras alvo ON alvo.obra_id = minha.obra_id AND alvo.ativo
      JOIN perfis_usuario p ON p.id = alvo.usuario_id AND p.ativo
      WHERE minha.usuario_id = auth.uid()
        AND minha.ativo
        AND alvo.usuario_id = p_usuario
    )
$$;

-- Atualiza módulos e obras numa única transação. Remoção de acesso é soft delete.
CREATE OR REPLACE FUNCTION atualizar_acessos_usuario(
  p_usuario UUID,
  p_modulos modulo_app[],
  p_obras UUID[]
) RETURNS VOID
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_papel papel_usuario;
  v_obras UUID[] := COALESCE(p_obras, ARRAY[]::UUID[]);
BEGIN
  IF meu_papel() <> 'admin' THEN
    RAISE EXCEPTION 'Somente o administrador pode alterar acessos';
  END IF;

  SELECT papel INTO v_papel FROM perfis_usuario WHERE id = p_usuario FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Usuário não encontrado'; END IF;
  IF v_papel = 'admin' THEN RAISE EXCEPTION 'O acesso do administrador é global'; END IF;
  IF cardinality(v_obras) = 0 THEN RAISE EXCEPTION 'Selecione ao menos uma obra'; END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(v_obras) x
    WHERE NOT EXISTS (SELECT 1 FROM obras o WHERE o.id = x AND o.ativo)
  ) THEN
    RAISE EXCEPTION 'Uma das obras selecionadas é inválida ou está inativa';
  END IF;

  UPDATE perfis_usuario
  SET modulos_permitidos = CASE
    WHEN v_papel = 'equipe' THEN COALESCE(p_modulos, ARRAY[]::modulo_app[])
    ELSE ARRAY[]::modulo_app[] END
  WHERE id = p_usuario;

  UPDATE usuarios_obras
  SET ativo = false, atualizado_por = auth.uid(), atualizado_em = now()
  WHERE usuario_id = p_usuario AND ativo AND NOT (obra_id = ANY(v_obras));

  INSERT INTO usuarios_obras (usuario_id, obra_id, ativo, criado_por, atualizado_por)
  SELECT p_usuario, x, true, auth.uid(), auth.uid() FROM unnest(v_obras) x
  ON CONFLICT (usuario_id, obra_id) DO UPDATE
  SET ativo = true, atualizado_por = auth.uid(), atualizado_em = now();
END;
$$;

-- Novas obras ficam automaticamente disponíveis aos administradores.
CREATE OR REPLACE FUNCTION vincular_admin_nova_obra()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO usuarios_obras (usuario_id, obra_id, criado_por, atualizado_por)
  SELECT id, NEW.id, auth.uid(), auth.uid()
  FROM perfis_usuario WHERE papel = 'admin' AND ativo
  ON CONFLICT (usuario_id, obra_id) DO UPDATE
  SET ativo = true, atualizado_por = auth.uid(), atualizado_em = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_vincular_admin_nova_obra
AFTER INSERT ON obras FOR EACH ROW EXECUTE FUNCTION vincular_admin_nova_obra();

-- Perfil: admin vê todos; demais veem a si e pessoas das mesmas obras.
DROP POLICY IF EXISTS perfis_select ON perfis_usuario;
CREATE POLICY perfis_select ON perfis_usuario FOR SELECT TO authenticated
  USING (pode_ver_perfil(id));

-- Camada restritiva nas tabelas que possuem obra_id diretamente.
CREATE POLICY isolamento_obra ON obras AS RESTRICTIVE FOR ALL TO authenticated
  USING (pode_acessar_obra(id)) WITH CHECK (pode_acessar_obra(id));
CREATE POLICY isolamento_obra ON unidades AS RESTRICTIVE FOR ALL TO authenticated
  USING (pode_acessar_obra(obra_id)) WITH CHECK (pode_acessar_obra(obra_id));
CREATE POLICY isolamento_obra ON cronograma_versoes AS RESTRICTIVE FOR ALL TO authenticated
  USING (pode_acessar_obra(obra_id)) WITH CHECK (pode_acessar_obra(obra_id));
CREATE POLICY isolamento_obra ON cronograma_tarefas AS RESTRICTIVE FOR ALL TO authenticated
  USING (pode_acessar_obra(obra_id)) WITH CHECK (pode_acessar_obra(obra_id));
CREATE POLICY isolamento_obra ON rdos AS RESTRICTIVE FOR ALL TO authenticated
  USING (pode_acessar_obra(obra_id)) WITH CHECK (pode_acessar_obra(obra_id));
CREATE POLICY isolamento_obra ON fvs AS RESTRICTIVE FOR ALL TO authenticated
  USING (pode_acessar_obra(obra_id)) WITH CHECK (pode_acessar_obra(obra_id));
CREATE POLICY isolamento_obra ON pendencias AS RESTRICTIVE FOR ALL TO authenticated
  USING (pode_acessar_obra(obra_id)) WITH CHECK (pode_acessar_obra(obra_id));
CREATE POLICY isolamento_obra ON definicoes_projeto AS RESTRICTIVE FOR ALL TO authenticated
  USING (pode_acessar_obra(obra_id)) WITH CHECK (pode_acessar_obra(obra_id));
CREATE POLICY isolamento_obra ON pedidos_compra_seq AS RESTRICTIVE FOR ALL TO authenticated
  USING (pode_acessar_obra(obra_id)) WITH CHECK (pode_acessar_obra(obra_id));
CREATE POLICY isolamento_obra ON pedidos_compra AS RESTRICTIVE FOR ALL TO authenticated
  USING (pode_acessar_obra(obra_id)) WITH CHECK (pode_acessar_obra(obra_id));
CREATE POLICY isolamento_obra ON materiais AS RESTRICTIVE FOR ALL TO authenticated
  USING (pode_acessar_obra(obra_id)) WITH CHECK (pode_acessar_obra(obra_id));
CREATE POLICY isolamento_obra ON estoque_movimentos AS RESTRICTIVE FOR ALL TO authenticated
  USING (pode_acessar_obra(obra_id)) WITH CHECK (pode_acessar_obra(obra_id));
CREATE POLICY isolamento_obra ON requisicoes_seq AS RESTRICTIVE FOR ALL TO authenticated
  USING (pode_acessar_obra(obra_id)) WITH CHECK (pode_acessar_obra(obra_id));
CREATE POLICY isolamento_obra ON requisicoes_blocos AS RESTRICTIVE FOR ALL TO authenticated
  USING (pode_acessar_obra(obra_id)) WITH CHECK (pode_acessar_obra(obra_id));
CREATE POLICY isolamento_obra ON ferramentas AS RESTRICTIVE FOR ALL TO authenticated
  USING (pode_acessar_obra(obra_id)) WITH CHECK (pode_acessar_obra(obra_id));
CREATE POLICY isolamento_obra ON trabalhadores AS RESTRICTIVE FOR ALL TO authenticated
  USING (pode_acessar_obra(obra_id)) WITH CHECK (pode_acessar_obra(obra_id));
CREATE POLICY isolamento_obra ON efetivo_chamadas AS RESTRICTIVE FOR ALL TO authenticated
  USING (pode_acessar_obra(obra_id)) WITH CHECK (pode_acessar_obra(obra_id));
CREATE POLICY isolamento_obra ON contratos_seq AS RESTRICTIVE FOR ALL TO authenticated
  USING (pode_acessar_obra(obra_id)) WITH CHECK (pode_acessar_obra(obra_id));
CREATE POLICY isolamento_obra ON contratos AS RESTRICTIVE FOR ALL TO authenticated
  USING (pode_acessar_obra(obra_id)) WITH CHECK (pode_acessar_obra(obra_id));
CREATE POLICY isolamento_obra ON producao_salarios AS RESTRICTIVE FOR ALL TO authenticated
  USING (pode_acessar_obra(obra_id)) WITH CHECK (pode_acessar_obra(obra_id));
CREATE POLICY isolamento_obra ON producao_lancamentos AS RESTRICTIVE FOR ALL TO authenticated
  USING (pode_acessar_obra(obra_id)) WITH CHECK (pode_acessar_obra(obra_id));
CREATE POLICY isolamento_obra ON producao_medicoes_seq AS RESTRICTIVE FOR ALL TO authenticated
  USING (pode_acessar_obra(obra_id)) WITH CHECK (pode_acessar_obra(obra_id));
CREATE POLICY isolamento_obra ON producao_medicoes AS RESTRICTIVE FOR ALL TO authenticated
  USING (pode_acessar_obra(obra_id)) WITH CHECK (pode_acessar_obra(obra_id));
CREATE POLICY isolamento_obra ON producao_dias_salariais AS RESTRICTIVE FOR ALL TO authenticated
  USING (pode_acessar_obra(obra_id)) WITH CHECK (pode_acessar_obra(obra_id));

-- Hierarquia principal.
CREATE POLICY isolamento_obra ON etapas AS RESTRICTIVE FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM unidades u WHERE u.id = unidade_id AND pode_acessar_obra(u.obra_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM unidades u WHERE u.id = unidade_id AND pode_acessar_obra(u.obra_id)));
CREATE POLICY isolamento_obra ON servicos AS RESTRICTIVE FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM etapas e JOIN unidades u ON u.id=e.unidade_id WHERE e.id=etapa_id AND pode_acessar_obra(u.obra_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM etapas e JOIN unidades u ON u.id=e.unidade_id WHERE e.id=etapa_id AND pode_acessar_obra(u.obra_id)));

-- Cronograma e avanço.
CREATE POLICY isolamento_obra ON cronograma_previsto AS RESTRICTIVE FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM cronograma_tarefas t WHERE t.id=tarefa_id AND pode_acessar_obra(t.obra_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM cronograma_tarefas t WHERE t.id=tarefa_id AND pode_acessar_obra(t.obra_id)));
CREATE POLICY isolamento_obra ON cronograma_dependencias AS RESTRICTIVE FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM cronograma_tarefas t WHERE t.id=tarefa_id AND pode_acessar_obra(t.obra_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM cronograma_tarefas t WHERE t.id=tarefa_id AND pode_acessar_obra(t.obra_id)));
CREATE POLICY isolamento_obra ON avancos_fisicos AS RESTRICTIVE FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM cronograma_tarefas t WHERE t.id=tarefa_id AND pode_acessar_obra(t.obra_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM cronograma_tarefas t WHERE t.id=tarefa_id AND pode_acessar_obra(t.obra_id)));

-- RDO.
CREATE POLICY isolamento_obra ON rdo_atividades AS RESTRICTIVE FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM rdos r WHERE r.id=rdo_id AND pode_acessar_obra(r.obra_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM rdos r WHERE r.id=rdo_id AND pode_acessar_obra(r.obra_id)));
CREATE POLICY isolamento_obra ON rdo_efetivo AS RESTRICTIVE FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM rdos r WHERE r.id=rdo_id AND pode_acessar_obra(r.obra_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM rdos r WHERE r.id=rdo_id AND pode_acessar_obra(r.obra_id)));
CREATE POLICY isolamento_obra ON rdo_fotos AS RESTRICTIVE FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM rdos r WHERE r.id=rdo_id AND pode_acessar_obra(r.obra_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM rdos r WHERE r.id=rdo_id AND pode_acessar_obra(r.obra_id)));
CREATE POLICY isolamento_obra ON rdo_audios AS RESTRICTIVE FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM rdos r WHERE r.id=rdo_id AND pode_acessar_obra(r.obra_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM rdos r WHERE r.id=rdo_id AND pode_acessar_obra(r.obra_id)));

-- FVS.
CREATE POLICY isolamento_obra ON fvs_verificacoes AS RESTRICTIVE FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM fvs f WHERE f.id=fvs_id AND pode_acessar_obra(f.obra_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM fvs f WHERE f.id=fvs_id AND pode_acessar_obra(f.obra_id)));
CREATE POLICY isolamento_obra ON fvs_respostas AS RESTRICTIVE FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM fvs_verificacoes v JOIN fvs f ON f.id=v.fvs_id WHERE v.id=verificacao_id AND pode_acessar_obra(f.obra_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM fvs_verificacoes v JOIN fvs f ON f.id=v.fvs_id WHERE v.id=verificacao_id AND pode_acessar_obra(f.obra_id)));
CREATE POLICY isolamento_obra ON fvs_fotos AS RESTRICTIVE FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM fvs f WHERE f.id=fvs_id AND pode_acessar_obra(f.obra_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM fvs f WHERE f.id=fvs_id AND pode_acessar_obra(f.obra_id)));

-- Pendências.
CREATE POLICY isolamento_obra ON pendencia_eventos AS RESTRICTIVE FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM pendencias p WHERE p.id=pendencia_id AND pode_acessar_obra(p.obra_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM pendencias p WHERE p.id=pendencia_id AND pode_acessar_obra(p.obra_id)));
CREATE POLICY isolamento_obra ON pendencia_fotos AS RESTRICTIVE FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM pendencias p WHERE p.id=pendencia_id AND pode_acessar_obra(p.obra_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM pendencias p WHERE p.id=pendencia_id AND pode_acessar_obra(p.obra_id)));

-- Compras.
CREATE POLICY isolamento_obra ON pedidos_compra_itens AS RESTRICTIVE FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM pedidos_compra p WHERE p.id=pedido_id AND pode_acessar_obra(p.obra_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM pedidos_compra p WHERE p.id=pedido_id AND pode_acessar_obra(p.obra_id)));
CREATE POLICY isolamento_obra ON cotacoes AS RESTRICTIVE FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM pedidos_compra p WHERE p.id=pedido_id AND pode_acessar_obra(p.obra_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM pedidos_compra p WHERE p.id=pedido_id AND pode_acessar_obra(p.obra_id)));
CREATE POLICY isolamento_obra ON cotacoes_itens AS RESTRICTIVE FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM cotacoes c JOIN pedidos_compra p ON p.id=c.pedido_id WHERE c.id=cotacao_id AND pode_acessar_obra(p.obra_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM cotacoes c JOIN pedidos_compra p ON p.id=c.pedido_id WHERE c.id=cotacao_id AND pode_acessar_obra(p.obra_id)));
CREATE POLICY isolamento_obra ON recebimentos_nf AS RESTRICTIVE FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM pedidos_compra p WHERE p.id=pedido_id AND pode_acessar_obra(p.obra_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM pedidos_compra p WHERE p.id=pedido_id AND pode_acessar_obra(p.obra_id)));

-- Almoxarifado e efetivo.
CREATE POLICY isolamento_obra ON ferramenta_emprestimos AS RESTRICTIVE FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM ferramentas f WHERE f.id=ferramenta_id AND pode_acessar_obra(f.obra_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM ferramentas f WHERE f.id=ferramenta_id AND pode_acessar_obra(f.obra_id)));
CREATE POLICY isolamento_obra ON efetivo_presencas AS RESTRICTIVE FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM efetivo_chamadas c WHERE c.id=chamada_id AND pode_acessar_obra(c.obra_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM efetivo_chamadas c WHERE c.id=chamada_id AND pode_acessar_obra(c.obra_id)));

-- Contratos e medições de empreiteiros.
CREATE POLICY isolamento_obra ON contratos_itens AS RESTRICTIVE FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM contratos c WHERE c.id=contrato_id AND pode_acessar_obra(c.obra_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM contratos c WHERE c.id=contrato_id AND pode_acessar_obra(c.obra_id)));
CREATE POLICY isolamento_obra ON medicoes_seq AS RESTRICTIVE FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM contratos c WHERE c.id=contrato_id AND pode_acessar_obra(c.obra_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM contratos c WHERE c.id=contrato_id AND pode_acessar_obra(c.obra_id)));
CREATE POLICY isolamento_obra ON medicoes AS RESTRICTIVE FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM contratos c WHERE c.id=contrato_id AND pode_acessar_obra(c.obra_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM contratos c WHERE c.id=contrato_id AND pode_acessar_obra(c.obra_id)));
CREATE POLICY isolamento_obra ON medicoes_itens AS RESTRICTIVE FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM medicoes m JOIN contratos c ON c.id=m.contrato_id WHERE m.id=medicao_id AND pode_acessar_obra(c.obra_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM medicoes m JOIN contratos c ON c.id=m.contrato_id WHERE m.id=medicao_id AND pode_acessar_obra(c.obra_id)));

-- Produção própria.
CREATE POLICY isolamento_obra ON producao_aberturas AS RESTRICTIVE FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM producao_lancamentos l WHERE l.id=lancamento_id AND pode_acessar_obra(l.obra_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM producao_lancamentos l WHERE l.id=lancamento_id AND pode_acessar_obra(l.obra_id)));
CREATE POLICY isolamento_obra ON producao_participantes AS RESTRICTIVE FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM producao_lancamentos l WHERE l.id=lancamento_id AND pode_acessar_obra(l.obra_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM producao_lancamentos l WHERE l.id=lancamento_id AND pode_acessar_obra(l.obra_id)));
CREATE POLICY isolamento_obra ON producao_medicao_lancamentos AS RESTRICTIVE FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM producao_medicoes m WHERE m.id=medicao_id AND pode_acessar_obra(m.obra_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM producao_medicoes m WHERE m.id=medicao_id AND pode_acessar_obra(m.obra_id)));
CREATE POLICY isolamento_obra ON producao_medicao_dias AS RESTRICTIVE FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM producao_medicoes m WHERE m.id=medicao_id AND pode_acessar_obra(m.obra_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM producao_medicoes m WHERE m.id=medicao_id AND pode_acessar_obra(m.obra_id)));

-- Storage: a primeira pasta é obra_id em RDO/FVS/Pendências; em Cotações é pedido_id.
CREATE POLICY isolamento_obra_storage ON storage.objects AS RESTRICTIVE FOR ALL TO authenticated
USING (
  bucket_id NOT IN ('rdo','fvs','pendencias','cotacoes-nf')
  OR CASE
    WHEN bucket_id IN ('rdo','fvs','pendencias') THEN
      split_part(name,'/',1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      AND pode_acessar_obra(split_part(name,'/',1)::UUID)
    WHEN bucket_id = 'cotacoes-nf' THEN
      split_part(name,'/',1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      AND EXISTS (
        SELECT 1 FROM pedidos_compra p
        WHERE p.id=split_part(name,'/',1)::UUID AND pode_acessar_obra(p.obra_id)
      )
    ELSE false
  END
)
WITH CHECK (
  bucket_id NOT IN ('rdo','fvs','pendencias','cotacoes-nf')
  OR CASE
    WHEN bucket_id IN ('rdo','fvs','pendencias') THEN
      split_part(name,'/',1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      AND pode_acessar_obra(split_part(name,'/',1)::UUID)
    WHEN bucket_id = 'cotacoes-nf' THEN
      split_part(name,'/',1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      AND EXISTS (
        SELECT 1 FROM pedidos_compra p
        WHERE p.id=split_part(name,'/',1)::UUID AND pode_acessar_obra(p.obra_id)
      )
    ELSE false
  END
);

-- Helpers expostos não revelam o estado de registros de outra obra.
CREATE OR REPLACE FUNCTION rdo_em_rascunho(p_rdo UUID)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS (SELECT 1 FROM rdos WHERE id=p_rdo AND status='rascunho' AND ativo AND pode_acessar_obra(obra_id))
$$;
CREATE OR REPLACE FUNCTION fvs_nao_aprovada(p_fvs UUID)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS (SELECT 1 FROM fvs WHERE id=p_fvs AND status<>'aprovada' AND ativo AND pode_acessar_obra(obra_id))
$$;
CREATE OR REPLACE FUNCTION fvs_verificacao_aberta(p_verif UUID)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS (
    SELECT 1 FROM fvs_verificacoes v JOIN fvs f ON f.id=v.fvs_id
    WHERE v.id=p_verif AND v.concluida_em IS NULL AND f.ativo AND pode_acessar_obra(f.obra_id)
  )
$$;

-- RPC privilegiada do almoxarifado: valida a obra antes de qualquer escrita.
CREATE OR REPLACE FUNCTION gerar_bloco_requisicoes(p_obra UUID, p_qtd integer)
RETURNS TABLE(numero_inicial integer, numero_final integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_ini integer; v_fim integer;
BEGIN
  IF NOT pode_editar_almoxarifado() OR NOT pode_acessar_obra(p_obra) THEN
    RAISE EXCEPTION 'Sem permissão para gerar requisições nesta obra';
  END IF;
  IF p_qtd < 1 OR p_qtd > 500 THEN RAISE EXCEPTION 'Quantidade deve ser entre 1 e 500'; END IF;
  UPDATE requisicoes_seq SET ultimo_numero=ultimo_numero+p_qtd WHERE obra_id=p_obra
  RETURNING ultimo_numero-p_qtd+1, ultimo_numero INTO v_ini,v_fim;
  IF NOT FOUND THEN
    INSERT INTO requisicoes_seq(obra_id,ultimo_numero) VALUES(p_obra,p_qtd);
    v_ini:=1; v_fim:=p_qtd;
  END IF;
  INSERT INTO requisicoes_blocos(obra_id,numero_inicial,numero_final,criado_por)
  VALUES(p_obra,v_ini,v_fim,auth.uid());
  RETURN QUERY SELECT v_ini,v_fim;
END;
$$;

-- Defesa adicional para RPCs SECURITY DEFINER que escrevem tabelas-raiz.
CREATE OR REPLACE FUNCTION validar_acesso_obra_linha()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path=public AS $$
DECLARE v_json JSONB := COALESCE(to_jsonb(NEW),to_jsonb(OLD)); v_obra UUID;
BEGIN
  v_obra := (v_json ->> TG_ARGV[0])::UUID;
  IF NOT pode_acessar_obra(v_obra) THEN RAISE EXCEPTION 'Sem acesso à obra informada'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_isolamento_cron_tarefa BEFORE INSERT OR UPDATE OR DELETE ON cronograma_tarefas
  FOR EACH ROW EXECUTE FUNCTION validar_acesso_obra_linha('obra_id');
CREATE TRIGGER trg_isolamento_fvs BEFORE INSERT OR UPDATE OR DELETE ON fvs
  FOR EACH ROW EXECUTE FUNCTION validar_acesso_obra_linha('obra_id');
CREATE TRIGGER trg_isolamento_requisicao_bloco BEFORE INSERT OR UPDATE OR DELETE ON requisicoes_blocos
  FOR EACH ROW EXECUTE FUNCTION validar_acesso_obra_linha('obra_id');
CREATE TRIGGER trg_isolamento_prod_salario BEFORE INSERT OR UPDATE OR DELETE ON producao_salarios
  FOR EACH ROW EXECUTE FUNCTION validar_acesso_obra_linha('obra_id');
CREATE TRIGGER trg_isolamento_prod_lancamento BEFORE INSERT OR UPDATE OR DELETE ON producao_lancamentos
  FOR EACH ROW EXECUTE FUNCTION validar_acesso_obra_linha('obra_id');
CREATE TRIGGER trg_isolamento_prod_medicao BEFORE INSERT OR UPDATE OR DELETE ON producao_medicoes
  FOR EACH ROW EXECUTE FUNCTION validar_acesso_obra_linha('obra_id');

REVOKE ALL ON FUNCTION pode_acessar_obra(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION pode_ver_perfil(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION atualizar_acessos_usuario(UUID, modulo_app[], UUID[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION vincular_admin_nova_obra() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION validar_acesso_obra_linha() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION pode_acessar_obra(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION pode_ver_perfil(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION atualizar_acessos_usuario(UUID, modulo_app[], UUID[]) TO authenticated;
