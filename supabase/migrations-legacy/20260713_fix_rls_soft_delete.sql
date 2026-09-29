-- Fix crítico: soft delete (ativo=false) bloqueado silenciosamente pelo RLS.
--
-- Causa raiz: quando a política de SELECT de uma tabela exige `ativo = true`,
-- o Postgres exige que a linha, DEPOIS de um UPDATE, ainda satisfaça essa
-- mesma política de SELECT — mesmo que a política de UPDATE (USING/WITH
-- CHECK) não mencione a coluna `ativo`. Como inativar um registro
-- (ativo: true -> false) faz a linha deixar de satisfazer `ativo = true`,
-- o Postgres barra o UPDATE com "new row violates row-level security
-- policy", mesmo para o admin. Confirmado empiricamente em 13/07/2026
-- (testes em transação com ROLLBACK, sem alterar dados).
--
-- Sintoma no app: apagar uma foto/serviço/áudio/efetivo no RDO (ou item de
-- pedido, trabalhador, foto de FVS) parecia funcionar na tela, mas o
-- registro nunca era realmente inativado no banco — voltava ao reabrir.
--
-- Fix: a política de SELECT passa a também permitir ver a linha inativa
-- quando o usuário tem permissão de editar aquele módulo (mesma função já
-- usada nas políticas de UPDATE/INSERT). Preserva o comportamento normal
-- (usuário sem o módulo não vê o registro inativo), só libera para quem
-- pode legitimamente inativá-lo.

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
  USING ((ativo = true AND meu_papel() = ANY (ARRAY['admin', 'equipe']::papel_usuario[])) OR pode_editar_fvs());
