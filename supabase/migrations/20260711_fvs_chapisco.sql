-- Fase 5 (ajuste pós-entrega, 11/07/2026): chapisco entra na FVS-004 Alvenaria
-- Decisão do Rodrigo: em vez de FVS separada, a FVS-004 ganha duas seções de chapisco
-- (usa o estado "Aguardando" para conferir alvenaria num dia e chapisco em outro).
-- A FVS-008 Reboco deixa de conferir chapisco na execução (vira pré-requisito único),
-- eliminando conferência duplicada.

-- 1) FVS-004 Alvenaria: seções de chapisco (ordem 3xxx/4xxx = depois da Execução)
INSERT INTO fvs_modelo_itens (modelo_id, secao, ordem, texto)
SELECT m.id, v.secao, v.ordem, v.texto
FROM fvs_modelos m,
  (VALUES
    ('Chapisco — pré-requisitos', 3001, 'Alvenaria conferida e aprovada (itens acima)'),
    ('Chapisco — pré-requisitos', 3002, 'Encunhamento concluído'),
    ('Chapisco — pré-requisitos', 3003, 'Instalações elétricas embutidas concluídas na parede'),
    ('Chapisco — pré-requisitos', 3004, 'Instalações hidráulicas embutidas concluídas e testadas'),
    ('Chapisco — pré-requisitos', 3005, 'Impermeabilização executada onde necessário'),
    ('Chapisco — pré-requisitos', 3006, 'Tela instalada nas ligações estrutura × alvenaria'),
    ('Chapisco — execução',       4001, 'Superfície limpa e umedecida antes da aplicação'),
    ('Chapisco — execução',       4002, 'Chapisco com cobertura uniforme e boa aderência'),
    ('Chapisco — execução',       4003, 'Traço e preparo da argamassa conforme procedimento'),
    ('Chapisco — execução',       4004, 'Cura do chapisco respeitada antes do reboco')
  ) AS v(secao, ordem, texto)
WHERE m.codigo = 'FVS-004';

-- 2) FVS-008 Reboco: chapisco sai da execução e vira pré-requisito único
UPDATE fvs_modelo_itens i
SET ativo = false
FROM fvs_modelos m
WHERE m.id = i.modelo_id AND m.codigo = 'FVS-008' AND i.ordem IN (2001, 2002);

INSERT INTO fvs_modelo_itens (modelo_id, secao, ordem, texto)
SELECT m.id, 'Pré-requisitos', 1006, 'Chapisco aplicado, curado e conferido (FVS-004)'
FROM fvs_modelos m
WHERE m.codigo = 'FVS-008';

-- 3) FVS-008 em andamento: os itens antigos (2001/2002) já tinham resposta "c" em campo.
-- Copia a resposta para o novo pré-requisito, preservando autor e data originais,
-- para a conferência feita não se perder. As respostas antigas permanecem na tabela
-- (histórico imutável), apenas deixam de ser exibidas junto com os itens inativos.
INSERT INTO fvs_respostas (verificacao_id, item_id, resposta, observacao, criado_em, criado_por)
SELECT r.verificacao_id, novo.id, r.resposta, r.observacao, r.criado_em, r.criado_por
FROM fvs_respostas r
JOIN fvs_modelo_itens antigo ON antigo.id = r.item_id AND antigo.ordem = 2001
JOIN fvs_modelos m ON m.id = antigo.modelo_id AND m.codigo = 'FVS-008'
JOIN fvs_modelo_itens novo ON novo.modelo_id = m.id AND novo.ordem = 1006
WHERE NOT EXISTS (
  SELECT 1 FROM fvs_respostas r2
  WHERE r2.verificacao_id = r.verificacao_id AND r2.item_id = novo.id
);
