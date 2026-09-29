DROP POLICY rdo_ativ_select ON rdo_atividades;
CREATE POLICY rdo_ativ_select ON rdo_atividades FOR SELECT
  USING (ativo = true OR pode_editar_rdo());

DROP POLICY rdo_fotos_select ON rdo_fotos;
CREATE POLICY rdo_fotos_select ON rdo_fotos FOR SELECT
  USING (ativo = true OR pode_editar_rdo());

DROP POLICY rdo_audios_select ON rdo_audios;
CREATE POLICY rdo_audios_select ON rdo_audios FOR SELECT
  USING (ativo = true OR pode_editar_rdo());

DROP POLICY rdo_efet_select ON rdo_efetivo;
CREATE POLICY rdo_efet_select ON rdo_efetivo FOR SELECT
  USING (ativo = true OR pode_editar_rdo());

DROP POLICY pci_select ON pedidos_compra_itens;
CREATE POLICY pci_select ON pedidos_compra_itens FOR SELECT
  USING ((ativo = true AND meu_papel() = ANY (ARRAY['admin', 'equipe']::papel_usuario[])) OR pode_editar_compras());

DROP POLICY trab_select ON trabalhadores;
CREATE POLICY trab_select ON trabalhadores FOR SELECT
  USING ((ativo = true AND meu_papel() = ANY (ARRAY['admin', 'equipe']::papel_usuario[])) OR pode_editar_efetivo());

DROP POLICY fvsf_select ON fvs_fotos;
CREATE POLICY fvsf_select ON fvs_fotos FOR SELECT
  USING ((ativo = true AND meu_papel() = ANY (ARRAY['admin', 'equipe']::papel_usuario[])) OR pode_editar_fvs());;
