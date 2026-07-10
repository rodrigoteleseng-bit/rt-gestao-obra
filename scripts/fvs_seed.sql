-- Seed dos modelos de FVS — gerado por scripts/importar-fvs.cjs em 2026-07-10
-- Fonte: fvs_15_prioritarias_qualidade_obras.md (15 fichas) + FVS-008 Reboco e FVS-013 Forro de gesso (novas)

INSERT INTO fvs_modelos (codigo, nome, objetivo, normas, criterios_aceitacao, ordem, criado_por)
VALUES ('FVS-001', 'Locação de obra / gabarito', 'Verificar se a locação da obra, eixos, alinhamentos, esquadros, níveis e referências foram executados conforme projeto arquitetônico, estrutural e levantamento topográfico.', 'Projeto arquitetônico, projeto estrutural, levantamento topográfico, memorial descritivo, projeto de implantação, ART/RRT, NBR 13133 quando houver levantamento topográfico aplicável.', 'A locação deve estar compatível com os projetos liberados. Não deve haver divergência entre eixos, recuos, níveis e posição das fundações. Qualquer incompatibilidade entre arquitetura, estrutura e topografia deve ser tratada antes do início das escavações.
Registros obrigatórios: Fotos do gabarito, fotos dos eixos principais, croqui de conferência, assinatura do responsável técnico ou encarregado autorizado.', 1, (SELECT id FROM perfis_usuario WHERE email = 'rodrigoteles.eng@gmail.com'));

INSERT INTO fvs_modelo_itens (modelo_id, secao, ordem, texto, criterio) VALUES
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-001'), 'Pré-requisitos', 1, 'Projeto arquitetônico e implantação liberados para obra', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-001'), 'Pré-requisitos', 2, 'Projeto estrutural compatibilizado com arquitetônico', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-001'), 'Pré-requisitos', 3, 'Terreno limpo e acessível', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-001'), 'Pré-requisitos', 4, 'RN, divisas e confrontações identificados', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-001'), 'Pré-requisitos', 5, 'Equipamentos de medição disponíveis e em condição de uso', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-001'), 'Execução', 6, 'Gabarito executado fora da área de escavação e concretagem', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-001'), 'Execução', 7, 'Pontaletes firmes, alinhados e travados', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-001'), 'Execução', 8, 'Tábuas do gabarito niveladas e fixadas corretamente', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-001'), 'Execução', 9, 'Eixos principais marcados e identificados', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-001'), 'Execução', 10, 'Linhas conferidas com trena, esquadro e/ou equipamento topográfico', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-001'), 'Execução', 11, 'Diagonais conferidas para garantir esquadro', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-001'), 'Execução', 12, 'Recuos laterais, frontal e fundo conferidos', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-001'), 'Execução', 13, 'Cotas de nível transferidas para referência segura', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-001'), 'Execução', 14, 'Locação das fundações compatível com projeto estrutural', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-001'), 'Execução', 15, 'Registro fotográfico realizado antes da escavação', NULL);

INSERT INTO fvs_modelos (codigo, nome, objetivo, normas, criterios_aceitacao, ordem, criado_por)
VALUES ('FVS-002', 'Fundação', 'Verificar a execução das fundações conforme projeto estrutural/geotécnico, garantindo geometria, profundidade, armação, concreto, posicionamento e condições de apoio.', 'Projeto de fundações, sondagem, memorial estrutural, NBR 6122, NBR 6118, NBR 14931:2023.', 'Fundação deve respeitar projeto, geometria, cota de apoio, armaduras, cobrimento, concreto especificado e condições adequadas de execução. Não liberar concretagem com fundo contaminado, escavação instável, armadura fora de posição ou ausência de conferência.
Registros obrigatórios: Fotos antes, durante e depois da concretagem; nota fiscal do concreto, quando usinado; registro de fck; identificação do elemento concretado.', 2, (SELECT id FROM perfis_usuario WHERE email = 'rodrigoteles.eng@gmail.com'));

INSERT INTO fvs_modelo_itens (modelo_id, secao, ordem, texto, criterio) VALUES
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-002'), 'Pré-requisitos', 1, 'Projeto de fundação liberado', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-002'), 'Pré-requisitos', 2, 'Sondagem disponível, quando aplicável', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-002'), 'Pré-requisitos', 3, 'Locação aprovada', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-002'), 'Pré-requisitos', 4, 'Materiais liberados para uso', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-002'), 'Pré-requisitos', 5, 'Condições climáticas adequadas para concretagem', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-002'), 'Execução', 6, 'Tipo de fundação executado conforme projeto', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-002'), 'Execução', 7, 'Dimensões conferidas: largura, comprimento, diâmetro e profundidade', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-002'), 'Execução', 8, 'Fundo da escavação limpo, firme e sem material solto', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-002'), 'Execução', 9, 'Cota de apoio conferida', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-002'), 'Execução', 10, 'Presença de água tratada antes da concretagem', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-002'), 'Execução', 11, 'Lastro de concreto magro executado quando previsto', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-002'), 'Execução', 12, 'Armação posicionada conforme projeto', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-002'), 'Execução', 13, 'Cobrimento da armadura garantido com espaçadores', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-002'), 'Execução', 14, 'Esperas de pilares posicionadas e travadas', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-002'), 'Execução', 15, 'Concreto com fck conforme projeto', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-002'), 'Execução', 16, 'Adensamento realizado adequadamente', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-002'), 'Execução', 17, 'Cura inicial realizada', NULL);

INSERT INTO fvs_modelos (codigo, nome, objetivo, normas, criterios_aceitacao, ordem, criado_por)
VALUES ('FVS-003', 'Forma, armação e concretagem', 'Controlar a qualidade da execução de formas, armaduras, escoramentos, embutidos, concretagem, adensamento, cura e desforma dos elementos estruturais.', 'Projeto estrutural, projeto de formas, projeto de armação, NBR 6118, NBR 14931:2023.', 'Não concretar sem conferência de formas, armaduras, embutidos, cobrimento, escoramento e limpeza. Elementos concretados devem apresentar integridade, cobrimento adequado, ausência de falhas graves e registro do concreto utilizado.', 3, (SELECT id FROM perfis_usuario WHERE email = 'rodrigoteles.eng@gmail.com'));

INSERT INTO fvs_modelo_itens (modelo_id, secao, ordem, texto, criterio) VALUES
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-003'), 'Pré-requisitos', 1, 'Projeto estrutural atualizado disponível na obra', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-003'), 'Pré-requisitos', 2, 'FVS de etapa anterior aprovada', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-003'), 'Pré-requisitos', 3, 'Materiais conferidos: aço, formas, espaçadores e concreto', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-003'), 'Pré-requisitos', 4, 'Equipe orientada sobre lançamento e adensamento', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-003'), 'Formas e escoramento', 5, 'Formas limpas, travadas e alinhadas', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-003'), 'Formas e escoramento', 6, 'Dimensões dos elementos conferidas', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-003'), 'Formas e escoramento', 7, 'Prumo de pilares conferido', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-003'), 'Formas e escoramento', 8, 'Nível de vigas e lajes conferido', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-003'), 'Formas e escoramento', 9, 'Escoramento dimensionado e estável', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-003'), 'Formas e escoramento', 10, 'Reescoramento previsto quando necessário', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-003'), 'Formas e escoramento', 11, 'Desmoldante aplicado sem contaminar armaduras', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-003'), 'Armação', 12, 'Bitolas conferidas conforme projeto', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-003'), 'Armação', 13, 'Quantidade de barras conferida', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-003'), 'Armação', 14, 'Espaçamentos conferidos', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-003'), 'Armação', 15, 'Cobrimento garantido com espaçadores', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-003'), 'Armação', 16, 'Emendas e ancoragens conforme projeto', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-003'), 'Armação', 17, 'Estribos posicionados corretamente', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-003'), 'Armação', 18, 'Armaduras negativas de laje posicionadas', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-003'), 'Armação', 19, 'Esperas e arranques conferidos', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-003'), 'Concretagem', 20, 'Liberação formal antes da concretagem', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-003'), 'Concretagem', 21, 'Concreto recebido conforme especificação', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-003'), 'Concretagem', 22, 'Slump test realizado quando aplicável', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-003'), 'Concretagem', 23, 'Corpos de prova moldados quando aplicável', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-003'), 'Concretagem', 24, 'Lançamento sem segregação', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-003'), 'Concretagem', 25, 'Adensamento com vibrador adequado', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-003'), 'Concretagem', 26, 'Acabamento executado conforme necessidade do elemento', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-003'), 'Concretagem', 27, 'Cura iniciada no prazo adequado', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-003'), 'Concretagem', 28, 'Desforma realizada somente após liberação', NULL);

INSERT INTO fvs_modelos (codigo, nome, objetivo, normas, criterios_aceitacao, ordem, criado_por)
VALUES ('FVS-004', 'Alvenaria', 'Verificar marcação, elevação, prumo, nível, esquadro, amarrações, vergas, contravergas, juntas e interfaces com estrutura e instalações.', 'Projeto arquitetônico, projeto de modulação, projeto estrutural, projeto de instalações, memorial de alvenaria, NBR 15575.', 'Alvenaria deve estar no prumo, nível, alinhamento, esquadro e vãos corretos. Não aceitar parede com barriga, desaprumo excessivo, falta de verga/contraverga, junta seca ou interferência com instalações.', 4, (SELECT id FROM perfis_usuario WHERE email = 'rodrigoteles.eng@gmail.com'));

INSERT INTO fvs_modelo_itens (modelo_id, secao, ordem, texto, criterio) VALUES
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-004'), 'Pré-requisitos', 1, 'Estrutura liberada para alvenaria', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-004'), 'Pré-requisitos', 2, 'Projeto arquitetônico atualizado disponível', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-004'), 'Pré-requisitos', 3, 'Marcação de paredes conferida', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-004'), 'Pré-requisitos', 4, 'Blocos/tijolos recebidos e sem defeitos excessivos', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-004'), 'Pré-requisitos', 5, 'Argamassa definida conforme procedimento', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-004'), 'Execução', 6, 'Primeira fiada marcada conforme projeto', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-004'), 'Execução', 7, 'Vãos de portas e janelas conferidos', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-004'), 'Execução', 8, 'Espessura das paredes compatível com projeto', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-004'), 'Execução', 9, 'Prumo verificado durante a elevação', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-004'), 'Execução', 10, 'Nível das fiadas conferido', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-004'), 'Execução', 11, 'Esquadro dos ambientes conferido', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-004'), 'Execução', 12, 'Juntas horizontais e verticais preenchidas adequadamente', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-004'), 'Execução', 13, 'Amarração entre paredes executada', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-004'), 'Execução', 14, 'Ligação com pilares conforme procedimento', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-004'), 'Execução', 15, 'Vergas e contravergas executadas nos vãos', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-004'), 'Execução', 16, 'Passagens hidráulicas/elétricas previstas sem cortes indevidos', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-004'), 'Execução', 17, 'Encunhamento executado no prazo e método correto', NULL);

INSERT INTO fvs_modelos (codigo, nome, objetivo, normas, criterios_aceitacao, ordem, criado_por)
VALUES ('FVS-005', 'Instalações hidráulicas', 'Verificar a execução das redes de água fria, água quente, pontos de consumo, prumadas, registros, conexões e teste de estanqueidade.', 'Projeto hidrossanitário, memorial, NBR 5626, NBR 15575, manual do fabricante dos tubos e conexões.', 'A rede deve estar conforme projeto, sem vazamentos, com pontos nas posições corretas, tubos protegidos e teste de estanqueidade aprovado antes do fechamento das paredes.', 5, (SELECT id FROM perfis_usuario WHERE email = 'rodrigoteles.eng@gmail.com'));

INSERT INTO fvs_modelo_itens (modelo_id, secao, ordem, texto, criterio) VALUES
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-005'), 'Pré-requisitos', 1, 'Projeto hidráulico liberado', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-005'), 'Pré-requisitos', 2, 'Materiais compatíveis com especificação', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-005'), 'Pré-requisitos', 3, 'Paredes marcadas e liberadas para rasgos', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-005'), 'Pré-requisitos', 4, 'Pontos conferidos com arquitetura e bancadas', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-005'), 'Execução', 5, 'Diâmetros dos tubos conforme projeto', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-005'), 'Execução', 6, 'Pontos hidráulicos posicionados na altura correta', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-005'), 'Execução', 7, 'Registros posicionados em local acessível', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-005'), 'Execução', 8, 'Tubulações fixadas corretamente', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-005'), 'Execução', 9, 'Conexões executadas conforme fabricante', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-005'), 'Execução', 10, 'Rede de água quente isolada quando previsto', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-005'), 'Execução', 11, 'Passagens por estrutura autorizadas em projeto', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-005'), 'Execução', 12, 'Tubulações protegidas antes do fechamento', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-005'), 'Execução', 13, 'Teste de estanqueidade realizado antes do reboco', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-005'), 'Execução', 14, 'Pontos tamponados após teste', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-005'), 'Execução', 15, 'Registro fotográfico antes do fechamento', NULL);

INSERT INTO fvs_modelos (codigo, nome, objetivo, normas, criterios_aceitacao, ordem, criado_por)
VALUES ('FVS-006', 'Instalações sanitárias e pluviais', 'Verificar execução de esgoto sanitário, ventilação, ralos, caixas sifonadas, caixas de inspeção, rede pluvial e caimentos.', 'Projeto hidrossanitário, projeto pluvial, NBR 8160, NBR 10844, NBR 15575.', 'Não pode haver contracaimento, vazamento, obstrução, ausência de ventilação prevista ou caixa sem acesso. Todas as tubulações embutidas devem ser fotografadas antes do fechamento.', 6, (SELECT id FROM perfis_usuario WHERE email = 'rodrigoteles.eng@gmail.com'));

INSERT INTO fvs_modelo_itens (modelo_id, secao, ordem, texto, criterio) VALUES
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-006'), 'Pré-requisitos', 1, 'Projeto sanitário/pluvial liberado', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-006'), 'Pré-requisitos', 2, 'Materiais e conexões compatíveis', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-006'), 'Pré-requisitos', 3, 'Locais de ralos, vasos, caixas e prumadas conferidos', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-006'), 'Execução', 4, 'Diâmetros das tubulações conforme projeto', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-006'), 'Execução', 5, 'Caimentos executados no sentido correto', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-006'), 'Execução', 6, 'Ralos e caixas sifonadas posicionados corretamente', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-006'), 'Execução', 7, 'Ponto de vaso sanitário locado conforme projeto', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-006'), 'Execução', 8, 'Tubulação de ventilação executada quando prevista', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-006'), 'Execução', 9, 'Caixas de inspeção executadas com acesso adequado', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-006'), 'Execução', 10, 'Tubulação pluvial direcionada corretamente', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-006'), 'Execução', 11, 'Juntas e conexões executadas corretamente', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-006'), 'Execução', 12, 'Tubulações protegidas contra quebra ou obstrução', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-006'), 'Execução', 13, 'Teste de estanqueidade realizado', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-006'), 'Execução', 14, 'Registro fotográfico antes do fechamento', NULL);

INSERT INTO fvs_modelos (codigo, nome, objetivo, normas, criterios_aceitacao, ordem, criado_por)
VALUES ('FVS-007', 'Instalações elétricas', 'Verificar eletrodutos, caixas, quadros, enfiação, identificação, aterramento, dispositivos de proteção e testes elétricos.', 'Projeto elétrico, diagrama unifilar, memorial, NBR 5410, NBR 5419 quando houver SPDA, normas da concessionária local.', 'Instalação deve estar conforme projeto, sem emendas indevidas, com circuitos identificados, proteções instaladas, aterramento conectado e testes aprovados antes da entrega.', 7, (SELECT id FROM perfis_usuario WHERE email = 'rodrigoteles.eng@gmail.com'));

INSERT INTO fvs_modelo_itens (modelo_id, secao, ordem, texto, criterio) VALUES
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-007'), 'Pré-requisitos', 1, 'Projeto elétrico liberado', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-007'), 'Pré-requisitos', 2, 'Cargas, circuitos e quadro conferidos', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-007'), 'Pré-requisitos', 3, 'Materiais compatíveis com projeto', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-007'), 'Pré-requisitos', 4, 'Padrão de entrada aprovado pela concessionária, quando aplicável', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-007'), 'Execução', 5, 'Pontos elétricos locados conforme projeto', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-007'), 'Execução', 6, 'Eletrodutos sem esmagamento ou obstrução', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-007'), 'Execução', 7, 'Caixas instaladas no prumo e altura correta', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-007'), 'Execução', 8, 'Separação entre circuitos respeitada', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-007'), 'Execução', 9, 'Cabos com seção conforme projeto', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-007'), 'Execução', 10, 'Cores dos condutores respeitadas', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-007'), 'Execução', 11, 'Quadro instalado em local acessível', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-007'), 'Execução', 12, 'Disjuntores compatíveis com circuitos', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-007'), 'Execução', 13, 'DR e DPS instalados quando previstos', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-007'), 'Execução', 14, 'Aterramento executado e conectado', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-007'), 'Execução', 15, 'Circuitos identificados no quadro', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-007'), 'Execução', 16, 'Teste de continuidade realizado', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-007'), 'Execução', 17, 'Teste de funcionamento realizado', NULL);

INSERT INTO fvs_modelos (codigo, nome, objetivo, normas, criterios_aceitacao, ordem, criado_por)
VALUES ('FVS-008', 'Reboco / emboço', 'Verificar chapisco, taliscamento, prumo, planeza, espessura, aderência e cura dos revestimentos argamassados internos e externos.', 'Projeto arquitetônico, memorial, NBR 13749 (especificação), NBR 7200 (execução), NBR 15575.', 'Planeza: desvio máximo 3 mm em régua de 2 m (NBR 13749). Sem som cavo, fissuras, descolamento ou desaprumo perceptível. Requadros de vãos em esquadro. Não revestir sobre instalações não testadas.', 8, (SELECT id FROM perfis_usuario WHERE email = 'rodrigoteles.eng@gmail.com'));

INSERT INTO fvs_modelo_itens (modelo_id, secao, ordem, texto, criterio) VALUES
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-008'), 'Pré-requisitos', 1, 'Alvenaria concluída e encunhada', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-008'), 'Pré-requisitos', 2, 'Instalações embutidas testadas e liberadas (estanqueidade aprovada)', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-008'), 'Pré-requisitos', 3, 'Rasgos e passagens fechados com argamassa', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-008'), 'Pré-requisitos', 4, 'Contramarcos e tacos instalados quando previstos', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-008'), 'Pré-requisitos', 5, 'Superfície limpa, sem poeira, óleo ou desmoldante', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-008'), 'Execução', 6, 'Chapisco aplicado com cobertura uniforme e boa aderência', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-008'), 'Execução', 7, 'Cura do chapisco respeitada antes do emboço', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-008'), 'Execução', 8, 'Taliscas e mestras executadas conforme prumo e espessura definida', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-008'), 'Execução', 9, 'Espessura do revestimento dentro dos limites (interno 5–20 mm; externo conforme projeto)', 'NBR 13749'),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-008'), 'Execução', 10, 'Prumo e planeza conferidos com régua de 2 m', 'Desvio ≤ 3 mm / 2 m'),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-008'), 'Execução', 11, 'Cantos e arestas alinhados e protegidos', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-008'), 'Execução', 12, 'Requadros de vãos executados em esquadro', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-008'), 'Execução', 13, 'Argamassa com traço e preparo conforme procedimento', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-008'), 'Execução', 14, 'Acabamento conforme previsto (desempenado, camurçado ou sarrafeado)', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-008'), 'Execução', 15, 'Juntas de trabalho executadas quando previstas (externo)', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-008'), 'Execução', 16, 'Cura úmida realizada em áreas externas quando necessário', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-008'), 'Execução', 17, 'Sem fissuras, descolamento ou som cavo após cura', NULL);

INSERT INTO fvs_modelos (codigo, nome, objetivo, normas, criterios_aceitacao, ordem, criado_por)
VALUES ('FVS-009', 'Impermeabilização', 'Verificar preparo da base, aplicação do sistema impermeabilizante, tratamento de ralos, cantos, rodapés, arremates e teste de estanqueidade.', 'Projeto de impermeabilização, memorial, NBR 9575, NBR 9574, NBR 15575, manual do fabricante.', 'Não liberar revestimento sobre impermeabilização sem teste de estanqueidade aprovado. Não aceitar falhas, bolhas, furos, descontinuidade em cantos, ralos ou passagens.', 9, (SELECT id FROM perfis_usuario WHERE email = 'rodrigoteles.eng@gmail.com'));

INSERT INTO fvs_modelo_itens (modelo_id, secao, ordem, texto, criterio) VALUES
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-009'), 'Pré-requisitos', 1, 'Projeto ou procedimento de impermeabilização definido', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-009'), 'Pré-requisitos', 2, 'Base regularizada, limpa e seca/úmida conforme sistema', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-009'), 'Pré-requisitos', 3, 'Caimentos executados antes da aplicação', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-009'), 'Pré-requisitos', 4, 'Ralos e passagens instalados', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-009'), 'Pré-requisitos', 5, 'Produto dentro da validade', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-009'), 'Execução', 6, 'Substrato sem poeira, óleo, nata ou partes soltas', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-009'), 'Execução', 7, 'Cantos arredondados ou tratados conforme sistema', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-009'), 'Execução', 8, 'Ralos, tubos e passagens reforçados', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-009'), 'Execução', 9, 'Rodapé impermeabilizado na altura prevista', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-009'), 'Execução', 10, 'Número de demãos conforme fabricante', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-009'), 'Execução', 11, 'Intervalo entre demãos respeitado', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-009'), 'Execução', 12, 'Espessura/consumo do produto controlado', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-009'), 'Execução', 13, 'Proteção contra chuva, sol excessivo ou tráfego', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-009'), 'Execução', 14, 'Teste de estanqueidade realizado', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-009'), 'Execução', 15, 'Proteção mecânica executada quando prevista', NULL);

INSERT INTO fvs_modelos (codigo, nome, objetivo, normas, criterios_aceitacao, ordem, criado_por)
VALUES ('FVS-010', 'Cobertura', 'Verificar estrutura, inclinação, telhas, fixações, cumeeiras, rufos, calhas, condutores, arremates e estanqueidade da cobertura.', 'Projeto de cobertura, projeto estrutural, memorial, NBR 15575, normas específicas do sistema de telha e manual do fabricante.', 'Cobertura deve estar estável, estanque, com caimentos corretos e sem pontos de retorno de água, infiltração, telhas quebradas, fixação deficiente ou arremates incompletos.', 10, (SELECT id FROM perfis_usuario WHERE email = 'rodrigoteles.eng@gmail.com'));

INSERT INTO fvs_modelo_itens (modelo_id, secao, ordem, texto, criterio) VALUES
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-010'), 'Pré-requisitos', 1, 'Projeto de cobertura disponível', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-010'), 'Pré-requisitos', 2, 'Estrutura liberada para receber telhamento', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-010'), 'Pré-requisitos', 3, 'Telhas e acessórios conferidos', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-010'), 'Pré-requisitos', 4, 'Calhas, rufos e condutores definidos', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-010'), 'Pré-requisitos', 5, 'Segurança para trabalho em altura implantada', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-010'), 'Execução', 6, 'Estrutura alinhada, travada e nivelada', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-010'), 'Execução', 7, 'Inclinação compatível com tipo de telha', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-010'), 'Execução', 8, 'Espaçamento de terças/ripas conforme telha', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-010'), 'Execução', 9, 'Telhas instaladas no sentido correto', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-010'), 'Execução', 10, 'Sobreposição das telhas conforme fabricante', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-010'), 'Execução', 11, 'Fixações adequadas e sem excesso de aperto', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-010'), 'Execução', 12, 'Cumeeiras e espigões bem arrematados', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-010'), 'Execução', 13, 'Rufos e contra-rufos instalados', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-010'), 'Execução', 14, 'Calhas com caimento adequado', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-010'), 'Execução', 15, 'Condutores pluviais conectados', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-010'), 'Execução', 16, 'Pontos vulneráveis vedados', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-010'), 'Execução', 17, 'Teste com água ou vistoria após chuva realizado', NULL);

INSERT INTO fvs_modelos (codigo, nome, objetivo, normas, criterios_aceitacao, ordem, criado_por)
VALUES ('FVS-011', 'Contrapiso', 'Verificar limpeza da base, níveis, caimentos, espessura, juntas, traço, cura e acabamento do contrapiso.', 'Projeto arquitetônico, paginação de pisos, projeto de impermeabilização, memorial, NBR 15575, normas de revestimentos aplicáveis.', 'Contrapiso deve apresentar nível, caimento, aderência, resistência superficial e acabamento compatíveis com o revestimento que será aplicado.', 11, (SELECT id FROM perfis_usuario WHERE email = 'rodrigoteles.eng@gmail.com'));

INSERT INTO fvs_modelo_itens (modelo_id, secao, ordem, texto, criterio) VALUES
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-011'), 'Pré-requisitos', 1, 'Instalações embutidas testadas e liberadas', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-011'), 'Pré-requisitos', 2, 'Impermeabilização liberada, quando aplicável', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-011'), 'Pré-requisitos', 3, 'Base limpa e sem material solto', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-011'), 'Pré-requisitos', 4, 'Níveis finais definidos', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-011'), 'Pré-requisitos', 5, 'Caimentos de áreas molhadas definidos', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-011'), 'Execução', 6, 'Base limpa e umedecida quando necessário', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-011'), 'Execução', 7, 'Taliscas/mestras executadas conforme nível', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-011'), 'Execução', 8, 'Espessura compatível com projeto', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-011'), 'Execução', 9, 'Caimento para ralos executado corretamente', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-011'), 'Execução', 10, 'Argamassa com traço adequado', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-011'), 'Execução', 11, 'Adensamento e sarrafeamento realizados', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-011'), 'Execução', 12, 'Superfície acabada sem pó excessivo ou desagregação', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-011'), 'Execução', 13, 'Juntas executadas quando previstas', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-011'), 'Execução', 14, 'Cura realizada', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-011'), 'Execução', 15, 'Área protegida contra tráfego prematuro', NULL);

INSERT INTO fvs_modelos (codigo, nome, objetivo, normas, criterios_aceitacao, ordem, criado_por)
VALUES ('FVS-012', 'Revestimento cerâmico / porcelanato', 'Verificar base, paginação, argamassa colante, assentamento, juntas, nivelamento, caimentos, recortes, rejuntamento e limpeza.', 'Projeto arquitetônico, paginação, memorial, NBR 13753, NBR 13754, NBR 13755 quando fachada, NBR 15575, manual do fabricante.', 'Não aceitar peças ocas, desalinhadas, desniveladas, com recortes ruins, caimento invertido, junta irregular ou diferença visual acentuada de tonalidade.', 12, (SELECT id FROM perfis_usuario WHERE email = 'rodrigoteles.eng@gmail.com'));

INSERT INTO fvs_modelo_itens (modelo_id, secao, ordem, texto, criterio) VALUES
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-012'), 'Pré-requisitos', 1, 'Contrapiso ou emboço liberado', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-012'), 'Pré-requisitos', 2, 'Paginação definida', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-012'), 'Pré-requisitos', 3, 'Peças conferidas quanto a lote, tonalidade e calibre', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-012'), 'Pré-requisitos', 4, 'Argamassa colante correta para o tipo de peça', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-012'), 'Pré-requisitos', 5, 'Áreas molhadas com impermeabilização aprovada', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-012'), 'Execução', 6, 'Base limpa, regular e sem pó', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-012'), 'Execução', 7, 'Paginação iniciada conforme projeto', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-012'), 'Execução', 8, 'Argamassa preparada conforme fabricante', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-012'), 'Execução', 9, 'Tempo em aberto respeitado', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-012'), 'Execução', 10, 'Dupla colagem utilizada quando necessário', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-012'), 'Execução', 11, 'Juntas de assentamento uniformes', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-012'), 'Execução', 12, 'Peças niveladas e alinhadas', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-012'), 'Execução', 13, 'Caimento para ralos respeitado', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-012'), 'Execução', 14, 'Recortes bem executados', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-012'), 'Execução', 15, 'Juntas de movimentação respeitadas quando previstas', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-012'), 'Execução', 16, 'Rejuntamento executado após prazo correto', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-012'), 'Execução', 17, 'Limpeza final sem manchas ou excesso de rejunte', NULL);

INSERT INTO fvs_modelos (codigo, nome, objetivo, normas, criterios_aceitacao, ordem, criado_por)
VALUES ('FVS-013', 'Forro de gesso', 'Verificar estrutura de fixação, nivelamento, juntas, recortes, alçapões e acabamento de forros de gesso (placas, drywall ou moldado).', 'Projeto arquitetônico, projeto de forro, NBR 15758-2 (sistemas em chapas de gesso — forros), manual do fabricante, NBR 15575.', 'Forro nivelado com desnível máximo de 3 mm em régua de 2 m. Emendas invisíveis após preparo. Recortes firmes e nas posições corretas. Acessos (alçapões) preservados. Sem manchas de umidade.', 13, (SELECT id FROM perfis_usuario WHERE email = 'rodrigoteles.eng@gmail.com'));

INSERT INTO fvs_modelo_itens (modelo_id, secao, ordem, texto, criterio) VALUES
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-013'), 'Pré-requisitos', 1, 'Cobertura/laje estanque, sem infiltração sobre o forro', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-013'), 'Pré-requisitos', 2, 'Instalações elétricas e hidráulicas sobre o forro concluídas e testadas', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-013'), 'Pré-requisitos', 3, 'Pontos de luminárias, difusores e dutos definidos', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-013'), 'Pré-requisitos', 4, 'Ambientes fechados (esquadrias instaladas ou vãos protegidos)', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-013'), 'Pré-requisitos', 5, 'Placas e perfis conferidos, sem umidade ou avaria', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-013'), 'Execução', 6, 'Nível do forro marcado conforme projeto (pé-direito)', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-013'), 'Execução', 7, 'Estrutura/tirantes fixados com espaçamento conforme fabricante', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-013'), 'Execução', 8, 'Fixações na laje/estrutura firmes (nunca em instalações)', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-013'), 'Execução', 9, 'Placas alinhadas e niveladas, sem degraus entre placas', 'Desnível ≤ 3 mm / 2 m'),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-013'), 'Execução', 10, 'Recortes para luminárias e difusores nas posições corretas', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-013'), 'Execução', 11, 'Alçapões de acesso previstos e executados', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-013'), 'Execução', 12, 'Juntas tratadas com fita e massa nas demãos adequadas', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-013'), 'Execução', 13, 'Tabicas, molduras e negativos executados conforme projeto', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-013'), 'Execução', 14, 'Lixamento final sem marcas de emenda aparentes', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-013'), 'Execução', 15, 'Superfície pronta para pintura, sem manchas de umidade', NULL);

INSERT INTO fvs_modelos (codigo, nome, objetivo, normas, criterios_aceitacao, ordem, criado_por)
VALUES ('FVS-014', 'Esquadrias', 'Verificar contramarcos, vãos, prumo, nível, fixação, vedação, funcionamento, ferragens, vidros e estanqueidade das esquadrias.', 'Projeto arquitetônico, quadro de esquadrias, memorial, NBR 10821, NBR 15575, manual do fabricante.', 'Esquadria deve estar alinhada, vedada, funcionando bem, sem infiltração aparente, sem empeno, com ferragens ajustadas e acabamento preservado.', 14, (SELECT id FROM perfis_usuario WHERE email = 'rodrigoteles.eng@gmail.com'));

INSERT INTO fvs_modelo_itens (modelo_id, secao, ordem, texto, criterio) VALUES
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-014'), 'Pré-requisitos', 1, 'Vãos conferidos e regularizados', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-014'), 'Pré-requisitos', 2, 'Contramarcos instalados ou procedimento definido', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-014'), 'Pré-requisitos', 3, 'Peças conferidas quanto a dimensão, modelo e acabamento', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-014'), 'Pré-requisitos', 4, 'Revestimentos adjacentes compatibilizados', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-014'), 'Execução', 5, 'Vão compatível com projeto', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-014'), 'Execução', 6, 'Contramarco no prumo, nível e esquadro', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-014'), 'Execução', 7, 'Esquadria fixada corretamente', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-014'), 'Execução', 8, 'Folgas laterais regulares', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-014'), 'Execução', 9, 'Vedação com silicone/PU executada corretamente', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-014'), 'Execução', 10, 'Peitoril com caimento para fora', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-014'), 'Execução', 11, 'Pingadeira ou detalhe de escoamento executado', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-014'), 'Execução', 12, 'Folhas abrem e fecham sem esforço', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-014'), 'Execução', 13, 'Fechaduras, trincos e roldanas funcionando', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-014'), 'Execução', 14, 'Vidros sem trincas, riscos ou folgas', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-014'), 'Execução', 15, 'Limpeza e proteção após instalação', NULL);

INSERT INTO fvs_modelos (codigo, nome, objetivo, normas, criterios_aceitacao, ordem, criado_por)
VALUES ('FVS-015', 'Pintura', 'Verificar preparo da superfície, correções, aplicação de fundo, massa, lixamento, demãos, acabamento e limpeza.', 'Memorial de acabamento, especificação de tintas, manual do fabricante, NBR 13245, NBR 15575.', 'Pintura deve apresentar cor uniforme, cobertura adequada, ausência de manchas, bolhas, descascamento, escorridos, marcas excessivas de rolo ou falhas de recorte.', 15, (SELECT id FROM perfis_usuario WHERE email = 'rodrigoteles.eng@gmail.com'));

INSERT INTO fvs_modelo_itens (modelo_id, secao, ordem, texto, criterio) VALUES
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-015'), 'Pré-requisitos', 1, 'Reboco/emboço curado e seco', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-015'), 'Pré-requisitos', 2, 'Superfície limpa e sem pó', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-015'), 'Pré-requisitos', 3, 'Infiltrações e fissuras tratadas', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-015'), 'Pré-requisitos', 4, 'Ambientes protegidos contra respingos', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-015'), 'Pré-requisitos', 5, 'Tinta especificada conforme ambiente interno/externo', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-015'), 'Execução', 6, 'Superfície lixada e corrigida', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-015'), 'Execução', 7, 'Fundo preparador ou selador aplicado quando necessário', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-015'), 'Execução', 8, 'Massa corrida/acrílica aplicada conforme ambiente', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-015'), 'Execução', 9, 'Lixamento entre etapas realizado', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-015'), 'Execução', 10, 'Poeira removida antes da pintura', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-015'), 'Execução', 11, 'Número de demãos conforme fabricante/memorial', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-015'), 'Execução', 12, 'Intervalo entre demãos respeitado', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-015'), 'Execução', 13, 'Recortes em cantos e esquadrias bem executados', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-015'), 'Execução', 14, 'Acabamento uniforme, sem manchas ou escorridos', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-015'), 'Execução', 15, 'Limpeza final realizada', NULL);

INSERT INTO fvs_modelos (codigo, nome, objetivo, normas, criterios_aceitacao, ordem, criado_por)
VALUES ('FVS-016', 'Louças e metais', 'Verificar instalação de vasos, cubas, lavatórios, torneiras, registros, chuveiros, acessórios, sifões, flexíveis, vedação e funcionamento.', 'Projeto hidrossanitário, projeto arquitetônico, memorial de acabamentos, manuais dos fabricantes, NBR 5626, NBR 8160, NBR 15575.', 'Não aceitar peça solta, trincada, riscada, desalinhada, com vazamento, mau funcionamento, retorno de odor ou acabamento danificado.', 16, (SELECT id FROM perfis_usuario WHERE email = 'rodrigoteles.eng@gmail.com'));

INSERT INTO fvs_modelo_itens (modelo_id, secao, ordem, texto, criterio) VALUES
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-016'), 'Pré-requisitos', 1, 'Revestimentos concluídos e liberados', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-016'), 'Pré-requisitos', 2, 'Pontos hidráulicos e esgoto testados', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-016'), 'Pré-requisitos', 3, 'Peças conferidas quanto a modelo e integridade', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-016'), 'Pré-requisitos', 4, 'Bancadas instaladas e liberadas, quando aplicável', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-016'), 'Execução', 5, 'Vaso sanitário nivelado e bem fixado', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-016'), 'Execução', 6, 'Vedação do vaso executada corretamente', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-016'), 'Execução', 7, 'Cuba/lavatório instalado sem folgas ou trincas', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-016'), 'Execução', 8, 'Torneiras e misturadores fixados e alinhados', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-016'), 'Execução', 9, 'Sifões e flexíveis instalados sem vazamento', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-016'), 'Execução', 10, 'Registros com acabamento alinhado', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-016'), 'Execução', 11, 'Chuveiro instalado e testado', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-016'), 'Execução', 12, 'Acessórios fixados em altura correta', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-016'), 'Execução', 13, 'Teste de funcionamento realizado', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-016'), 'Execução', 14, 'Teste de vazamento realizado', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-016'), 'Execução', 15, 'Peças limpas e sem riscos aparentes', NULL);

INSERT INTO fvs_modelos (codigo, nome, objetivo, normas, criterios_aceitacao, ordem, criado_por)
VALUES ('FVS-017', 'Checklist de entrega final da obra', 'Realizar vistoria final da unidade/obra antes da entrega ao cliente, registrando conformidades, pendências e liberações por ambiente e sistema.', 'NBR 15575, NBR 5674, manual de uso, operação e manutenção, projetos as built quando aplicável, memorial de acabamento, contrato e escopo.', 'A obra só deve ser entregue sem pendências impeditivas. Pendências pequenas podem ser registradas em lista de correções com prazo, responsável e aceite do cliente.', 17, (SELECT id FROM perfis_usuario WHERE email = 'rodrigoteles.eng@gmail.com'));

INSERT INTO fvs_modelo_itens (modelo_id, secao, ordem, texto, criterio) VALUES
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-017'), 'Pré-requisitos', 1, 'Serviços principais concluídos', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-017'), 'Pré-requisitos', 2, 'Limpeza fina executada', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-017'), 'Pré-requisitos', 3, 'Testes elétricos e hidráulicos realizados', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-017'), 'Pré-requisitos', 4, 'Pendências anteriores tratadas', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-017'), 'Pré-requisitos', 5, 'Manual/documentos de entrega preparados', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-017'), 'Por sistema', 6, 'Pisos sem peças ocas, trincadas ou manchadas', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-017'), 'Por sistema', 7, 'Revestimentos de parede íntegros e rejuntados', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-017'), 'Por sistema', 8, 'Pintura uniforme e sem retoques pendentes', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-017'), 'Por sistema', 9, 'Portas abrindo, fechando e trancando corretamente', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-017'), 'Por sistema', 10, 'Janelas funcionando e vedadas', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-017'), 'Por sistema', 11, 'Vidros sem trincas ou riscos relevantes', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-017'), 'Por sistema', 12, 'Tomadas e interruptores funcionando', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-017'), 'Por sistema', 13, 'Quadro elétrico identificado', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-017'), 'Por sistema', 14, 'Luminárias/pontos de luz funcionando, quando aplicável', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-017'), 'Por sistema', 15, 'Torneiras, registros e chuveiros funcionando', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-017'), 'Por sistema', 16, 'Vasos, sifões e ralos sem vazamento', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-017'), 'Por sistema', 17, 'Ralos escoando corretamente', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-017'), 'Por sistema', 18, 'Áreas molhadas sem sinais de infiltração', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-017'), 'Por sistema', 19, 'Bancadas e soleiras íntegras', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-017'), 'Por sistema', 20, 'Esquadrias e portas limpas e sem danos', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-017'), 'Por sistema', 21, 'Cobertura sem sinais de vazamento', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-017'), 'Por sistema', 22, 'Fachada sem falhas visuais relevantes', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-017'), 'Por sistema', 23, 'Área externa limpa e finalizada', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-017'), 'Por sistema', 24, 'Entulhos e materiais removidos', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-017'), 'Por sistema', 25, 'Registro fotográfico final realizado', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-017'), 'Documental', 26, 'Manual de uso e manutenção entregue, quando aplicável', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-017'), 'Documental', 27, 'Termos de garantia organizados', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-017'), 'Documental', 28, 'Notas fiscais relevantes arquivadas', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-017'), 'Documental', 29, 'Projetos finais/as built arquivados, quando aplicável', NULL),
  ((SELECT id FROM fvs_modelos WHERE codigo = 'FVS-017'), 'Documental', 30, 'Termo de entrega assinado', NULL);

