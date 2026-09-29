-- Fecha exposição de dados pela API anon.
-- As policies originais não declaravam TO authenticated e, por padrão,
-- eram aplicadas a PUBLIC (incluindo o papel anon do Supabase).

DROP POLICY IF EXISTS obras_select ON obras;
CREATE POLICY obras_select ON obras FOR SELECT TO authenticated
  USING (ativo = true);

DROP POLICY IF EXISTS unidades_select ON unidades;
CREATE POLICY unidades_select ON unidades FOR SELECT TO authenticated
  USING (ativo = true);

DROP POLICY IF EXISTS etapas_select ON etapas;
CREATE POLICY etapas_select ON etapas FOR SELECT TO authenticated
  USING (ativo = true);

DROP POLICY IF EXISTS servicos_select ON servicos;
CREATE POLICY servicos_select ON servicos FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS cron_versoes_select ON cronograma_versoes;
CREATE POLICY cron_versoes_select ON cronograma_versoes FOR SELECT TO authenticated
  USING (ativo = true);

DROP POLICY IF EXISTS cron_tarefas_select ON cronograma_tarefas;
CREATE POLICY cron_tarefas_select ON cronograma_tarefas FOR SELECT TO authenticated
  USING (ativo = true);

DROP POLICY IF EXISTS cron_previsto_select ON cronograma_previsto;
CREATE POLICY cron_previsto_select ON cronograma_previsto FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS cron_dep_select ON cronograma_dependencias;
CREATE POLICY cron_dep_select ON cronograma_dependencias FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS avancos_select ON avancos_fisicos;
CREATE POLICY avancos_select ON avancos_fisicos FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS rdos_select ON rdos;
CREATE POLICY rdos_select ON rdos FOR SELECT TO authenticated
  USING (ativo = true);

DROP POLICY IF EXISTS rdo_ativ_select ON rdo_atividades;
CREATE POLICY rdo_ativ_select ON rdo_atividades FOR SELECT TO authenticated
  USING (ativo = true OR pode_editar_rdo());

DROP POLICY IF EXISTS rdo_efet_select ON rdo_efetivo;
CREATE POLICY rdo_efet_select ON rdo_efetivo FOR SELECT TO authenticated
  USING (ativo = true OR pode_editar_rdo());

DROP POLICY IF EXISTS rdo_fotos_select ON rdo_fotos;
CREATE POLICY rdo_fotos_select ON rdo_fotos FOR SELECT TO authenticated
  USING (ativo = true OR pode_editar_rdo());

DROP POLICY IF EXISTS rdo_audios_select ON rdo_audios;
CREATE POLICY rdo_audios_select ON rdo_audios FOR SELECT TO authenticated
  USING (ativo = true OR pode_editar_rdo());

DROP POLICY IF EXISTS def_select ON definicoes_projeto;
CREATE POLICY def_select ON definicoes_projeto FOR SELECT TO authenticated
  USING (ativo = true);
