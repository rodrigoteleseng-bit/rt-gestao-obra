-- Ajuste do estoque de materiais conforme a coluna SALDO da planilha
-- Controle Estoque Material Almoxarifado JULHO - 2026.xlsx
-- SHA256: 6161fcdcb9c3327751ea27ea3e42ffc7eae8a860d85f42d261d794cd6f8f1e63
-- Fonte validada por Rodrigo em 17/07/2026: coluna F (SALDO), incluindo COD029=5 e COD034=4.
-- N?o altera estoque m?nimo, EPIs, escrit?rio, ferramentas ou materiais ausentes da planilha.

DO $$
DECLARE
  v_obra UUID;
  v_admin UUID;
  v_canteiro UUID;
  v_qtd_correspondente INTEGER;
  v_atual NUMERIC(14,4);
  v_diferenca NUMERIC(14,4);
  v_item RECORD;
  v_marcador CONSTANT TEXT := 'Invent?rio f?sico julho/2026 ? coluna SALDO ? SHA256 6161fcdcb9c3327751ea27ea3e42ffc7eae8a860d85f42d261d794cd6f8f1e63';
BEGIN
  CREATE TEMP TABLE tmp_inventario_julho (
    codigo TEXT PRIMARY KEY,
    saldo_alvo NUMERIC(14,4) NOT NULL CHECK (saldo_alvo >= 0)
  ) ON COMMIT DROP;

  INSERT INTO tmp_inventario_julho (codigo, saldo_alvo) VALUES
  ('COD001', 32.0000),
  ('COD002', 6.0000),
  ('COD003', 4.0000),
  ('COD004', 19.0000),
  ('COD005', 6.0000),
  ('COD006', 7.0000),
  ('COD007', 10.0000),
  ('COD008', 0.0000),
  ('COD009', 8.0000),
  ('COD010', 2.0000),
  ('COD011', 4.0000),
  ('COD012', 15.0000),
  ('COD013', 17.0000),
  ('COD014', 13.0000),
  ('COD015', 17.0000),
  ('COD021', 1.0000),
  ('COD022', 40.0000),
  ('COD023', 66.0000),
  ('COD024', 30.0000),
  ('COD025', 13.0000),
  ('COD026', 384.0000),
  ('COD027', 12.0000),
  ('COD028', 5.0000),
  ('COD029', 5.0000),
  ('COD030', 6.0000),
  ('COD031', 4.0000),
  ('COD033', 11.0000),
  ('COD034', 4.0000),
  ('COD035', 17.0000),
  ('COD036', 5.0000),
  ('COD037', 24.0000),
  ('COD038', 24.0000),
  ('COD039', 238.0000),
  ('COD040', 15.0000),
  ('COD042', 6.0000),
  ('COD045', 2.0000),
  ('COD046', 10.0000),
  ('COD047', 15.0000),
  ('COD048', 0.0000),
  ('COD049', 86.0000),
  ('COD050', 28.0000),
  ('COD051', 191.0000),
  ('COD052', 53.0000),
  ('COD053', 102.0000),
  ('COD054', 8.0000),
  ('COD055', 6.0000),
  ('COD056', 70.0000),
  ('COD057', 45.0000),
  ('COD058', 34.0000),
  ('COD059', 36.0000),
  ('COD060', 70.0000),
  ('COD061', 7.0000),
  ('COD062', 18.0000),
  ('COD063', 23.0000),
  ('COD064', 37.0000),
  ('COD065', 2.0000),
  ('COD066', 12.0000),
  ('COD067', 17.0000),
  ('COD068', 11.0000),
  ('COD069', 8.0000),
  ('COD070', 7.0000),
  ('COD071', 7.0000),
  ('COD072', 17.0000),
  ('COD073', 21.0000),
  ('COD074', 82.0000),
  ('COD075', 89.0000),
  ('COD076', 6.0000),
  ('COD077', 16.0000),
  ('COD078', 6.0000),
  ('COD080', 456.0000),
  ('COD081', 40.0000),
  ('COD082', 11.0000),
  ('COD083', 17.0000),
  ('COD084', 157.0000),
  ('COD085', 0.0000),
  ('COD086', 0.0000),
  ('COD087', 106.0000),
  ('COD088', 6.0000),
  ('COD089', 0.0000),
  ('COD090', 1.0000),
  ('COD091', 6.0000),
  ('COD092', 13.0000),
  ('COD093', 2.0000),
  ('COD094', 4.0000),
  ('COD095', 136.0000),
  ('COD096', 39.0000),
  ('COD097', 12.0000),
  ('COD098', 60.0000),
  ('COD099', 59.0000),
  ('COD100', 7.0000),
  ('COD101', 6.0000),
  ('COD102', 5.0000),
  ('COD103', 7.0000),
  ('COD104', 3.0000),
  ('COD105', 75.0000),
  ('COD106', 38.0000),
  ('COD107', 250.0000),
  ('COD108', 49.0000),
  ('COD109', 33.0000),
  ('COD110', 225.0000),
  ('COD111', 82.0000),
  ('COD112', 79.0000),
  ('COD113', 225.0000),
  ('COD114', 4.0000),
  ('COD115', 11.0000),
  ('COD116', 25.0000),
  ('COD117', 11.0000),
  ('COD118', 26.0000),
  ('COD119', 21.0000),
  ('COD120', 1.0000),
  ('COD121', 13.0000),
  ('COD122', 11.0000),
  ('COD123', 12.0000),
  ('COD124', 7.0000),
  ('COD125', 3.0000),
  ('COD126', 11.0000),
  ('COD127', 7.0000),
  ('COD128', 92.0000),
  ('COD129', 120.0000),
  ('COD130', 42.0000),
  ('COD131', 200.0000),
  ('COD132', 180.0000),
  ('COD133', 130.0000),
  ('COD134', 356.0000),
  ('COD135', 9.0000),
  ('COD136', 50.0000),
  ('COD137', 41.0000),
  ('COD138', 68.0000),
  ('COD139', 3.0000),
  ('COD140', 190.0000),
  ('COD141', 170.0000),
  ('COD142', 185.0000),
  ('COD143', 436.0000),
  ('COD145', 18.0000),
  ('COD146', 19.0000),
  ('COD147', 50.0000),
  ('COD149', 12.0000),
  ('COD150', 23.0000),
  ('COD151', 7.0000),
  ('COD152', 300.0000),
  ('COD153', 1900.0000),
  ('COD154', 1900.0000),
  ('COD155', 2.0000),
  ('COD157', 21.0000),
  ('COD158', 14.0000),
  ('COD159', 7.0000),
  ('COD160', 21.0000),
  ('COD161', 14.0000);

  IF (SELECT count(*) FROM tmp_inventario_julho) <> 148 THEN
    RAISE EXCEPTION 'Importa??o cancelada: esperados 148 c?digos ?nicos.';
  END IF;

  -- Identifica a obra que possui os 148 c?digos ativos da planilha.
  SELECT m.obra_id, count(*)
    INTO v_obra, v_qtd_correspondente
  FROM materiais m
  JOIN tmp_inventario_julho t ON t.codigo = m.codigo
  WHERE m.ativo AND m.categoria = 'material'
  GROUP BY m.obra_id
  ORDER BY count(*) DESC
  LIMIT 1;

  IF v_obra IS NULL OR v_qtd_correspondente <> 148 THEN
    RAISE EXCEPTION 'Importa??o cancelada: somente % dos 148 c?digos foram encontrados na mesma obra.',
      COALESCE(v_qtd_correspondente, 0);
  END IF;

  IF EXISTS (
    SELECT 1
    FROM materiais m
    JOIN tmp_inventario_julho t ON t.codigo = m.codigo
    WHERE m.obra_id = v_obra AND (NOT m.ativo OR m.categoria <> 'material')
  ) THEN
    RAISE EXCEPTION 'Importa??o cancelada: existe c?digo inativo ou fora da categoria material.';
  END IF;

  SELECT id INTO v_admin
  FROM perfis_usuario
  WHERE papel = 'admin' AND ativo
  ORDER BY criado_em
  LIMIT 1;
  IF v_admin IS NULL THEN
    RAISE EXCEPTION 'Importa??o cancelada: administrador ativo n?o encontrado.';
  END IF;

  SELECT id INTO v_canteiro
  FROM unidades
  WHERE obra_id = v_obra AND ativo
    AND (nome ILIKE 'Canteiro de Obras' OR nome ILIKE 'Canteiro%')
  ORDER BY CASE WHEN nome ILIKE 'Canteiro de Obras' THEN 0 ELSE 1 END, ordem
  LIMIT 1;
  IF v_canteiro IS NULL THEN
    RAISE EXCEPTION 'Importa??o cancelada: unidade Canteiro de Obras n?o encontrada.';
  END IF;

  -- Prote??o adicional contra execu??o duplicada fora do controle de migrations.
  IF EXISTS (
    SELECT 1 FROM estoque_movimentos
    WHERE obra_id = v_obra AND observacao = v_marcador AND ativo
  ) THEN
    RAISE NOTICE 'Invent?rio de julho/2026 j? aplicado; nenhuma altera??o realizada.';
    RETURN;
  END IF;

  FOR v_item IN
    SELECT m.id AS material_id, m.codigo, t.saldo_alvo
    FROM tmp_inventario_julho t
    JOIN materiais m ON m.obra_id = v_obra AND m.codigo = t.codigo
    WHERE m.ativo AND m.categoria = 'material'
    ORDER BY m.codigo
  LOOP
    SELECT COALESCE(SUM(CASE WHEN tipo = 'entrada' THEN quantidade ELSE -quantidade END), 0)
      INTO v_atual
    FROM estoque_movimentos
    WHERE material_id = v_item.material_id AND ativo;

    v_diferenca := v_item.saldo_alvo - v_atual;

    IF v_diferenca > 0 THEN
      INSERT INTO estoque_movimentos
        (obra_id, material_id, tipo, quantidade, observacao, criado_por)
      VALUES
        (v_obra, v_item.material_id, 'entrada', v_diferenca, v_marcador, v_admin);
    ELSIF v_diferenca < 0 THEN
      INSERT INTO estoque_movimentos
        (obra_id, material_id, tipo, quantidade, unidade_id, retirado_por,
         aplicacao, observacao, criado_por)
      VALUES
        (v_obra, v_item.material_id, 'saida', abs(v_diferenca), v_canteiro,
         'Ajuste de invent?rio', 'Invent?rio f?sico', v_marcador, v_admin);
    END IF;
  END LOOP;

  -- Qualquer diferen?a cancela e reverte a transa??o inteira.
  IF EXISTS (
    SELECT 1
    FROM tmp_inventario_julho t
    JOIN materiais m ON m.obra_id = v_obra AND m.codigo = t.codigo
    LEFT JOIN LATERAL (
      SELECT COALESCE(SUM(CASE WHEN em.tipo = 'entrada' THEN em.quantidade ELSE -em.quantidade END), 0) AS saldo
      FROM estoque_movimentos em
      WHERE em.material_id = m.id AND em.ativo
    ) s ON true
    WHERE s.saldo <> t.saldo_alvo
  ) THEN
    RAISE EXCEPTION 'Importa??o cancelada: a confer?ncia final encontrou saldo divergente.';
  END IF;
END;
$$;
