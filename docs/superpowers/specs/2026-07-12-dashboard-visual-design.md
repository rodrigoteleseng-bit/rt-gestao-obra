# Dashboard — repaginação visual (design)

> Protótipo HTML aprovado pelo Rodrigo em 12/07/2026, após análise comparativa com o app concorrente FlowPlanner (ver `project_flowplanner_decisoes` na memória). Escopo: só o Dashboard (`src/pages/Dashboard.tsx`) — nenhum outro módulo é alterado por este design. Nenhuma tabela nova; consome dados que já existem hoje.

## 1. Objetivo

Repaginar visualmente a tela inicial do app para: (a) resumir "onde a obra está" num golpe de vista (prazo, semana, dias restantes); (b) transformar os banners de alerta atuais em indicadores numéricos clicáveis; (c) trocar os cards de módulo com emoji por um visual mais próximo do manual de marca RT, mantendo a organização por grupos já aprovada em 09/07/2026 (RDO agrupa Galeria+Efetivo, Qualidade agrupa FVS+Pendências) e criando um grupo novo, **Suprimentos**, que passa a agrupar Compras + Almoxarifado.

## 2. Decisões (perguntas respondidas com o Rodrigo em 12/07/2026)

- **Formato de aprovação:** mockup HTML estático com dados fictícios (não uma rota paralela no app real) — mais rápido de iterar, zero risco à base atual.
- **Escopo do polimento:** Dashboard completo (herói + KPIs + widget do dia + grade de módulos), não só o topo.
- **Agrupamento de módulos:** mantido como está hoje (RDO, Qualidade), e um grupo novo, **Suprimentos**, reúne Compras + Almoxarifado (hoje são dois cards soltos em `CARDS_MODULOS`).
- **Widget "hoje na obra":** na primeira versão do protótipo havia 3 widgets vivos (RDO, Qualidade, Suprimentos) junto com as KPI-pílulas — o Rodrigo apontou redundância. Decisão: **só um widget, o RDO do dia**; Qualidade e Suprimentos ficam representados apenas pelas KPI-pílulas e pelos cards de módulo, sem duplicar contagem em dois lugares.
- **Card "Financeiro" (Fase 3, ainda não construído):** não fica junto da grade de módulos ativos (confundia com os módulos já entregues). Vira uma linha discreta no rodapé, junto com os demais módulos "em preparação" (Medições, Definições de Projeto, Projetos, Planejamento lookahead/PPC, Tarefas).
- **Logo do topo:** ícone de casa em traço (SVG), não texto "RT" — é placeholder; se houver um símbolo oficial no manual de marca, ele substitui este ícone na implementação.

## 3. Estrutura da tela (de cima para baixo)

1. **Topbar:** ícone da obra + nome da construtora/obra ativa + avatar do usuário (mantém o que já existe hoje, só reestilizado).
2. **Card-herói (navy, gradiente):** data por extenso, saudação ("Olá, {nome}"), obra ativa, e uma faixa com 3 métricas — **Prazo** (data de previsão de término), **Semana** (nº da semana da obra / total), **Restam** (dias corridos até o prazo). Todas derivam de campos que já existem na obra (`previsao_termino`, `data_inicio`); nenhuma tabela nova.
3. **4 KPI-pílulas clicáveis**, cada uma navega para o módulo correspondente:
   - **Efetivo hoje** (azul-gelo) — presentes/total da chamada do dia (dado já calculado no Dashboard atual, `chamadaHoje`).
   - **Pedidos** (navy) — pedidos de compra aguardando aprovação (nova contagem — hoje o Dashboard não expõe isso).
   - **Pendências** (branca) — pendências abertas na obra (nova contagem).
   - **Ferramenta** (terracota) — só aparece quando há ferramenta em atraso (reaproveita `ferramentasAtraso`, já existente).
4. **Seção "RDO de hoje"** — um único widget: status do RDO do dia (rascunho/assinado), resumo do clima, efetivo lido da chamada, últimas fotos anexadas, link "Abrir RDO".
5. **Seção "Módulos"** — grade de cards de grupo (Avanço Físico, RDO, Suprimentos, Qualidade), cada um com sub-itens em lista vertical (não mais chips lado a lado — maiores, mais fáceis de tocar no celular).
6. **Nota "Em preparação"** — linha discreta tracejada citando os módulos ainda não construídos (Financeiro, Medições, Definições de Projeto, Projetos, Planejamento lookahead/PPC, Tarefas), para não misturar com o que já está ativo.

## 4. Fora de escopo deste design

- Qualquer tabela nova (Definições de Projeto, Projetos, Lookahead/PPC, Tarefas) — cada um desses módulos estruturais aprovados terá seu próprio design/spec quando entrar em desenvolvimento.
- A contagem "Pedidos aguardando aprovação" e "Pendências abertas" precisa de novas queries no `Dashboard.tsx` (leves — `count` sobre tabelas existentes `compras_pedidos` e `pendencias`), mas nenhuma migração de banco.
- Sidebar/navegação lateral não faz parte deste protótipo (só a tela inicial foi desenhada).

## 5. Paleta e tipografia (sem novidade — reafirma o manual de marca)

Tokens já existentes em `src/styles/tokens.css`: `--navy #1A3248`, `--navy-light #3A7CA5` (acento), `--terracota #C49A7A`, `--azul-gelo #B8D4E8`, `--nude #F0EBE3` (fundo). Tipografia `Sora` (títulos) / `Inter` (corpo). Ícones de módulo passam de emoji para SVG de traço (`stroke-width: 1.8`), consistentes com o estilo do card-herói.

## 6. Protótipo de referência

HTML estático com os ajustes acima, publicado como Artifact e aprovado pelo Rodrigo em 12/07/2026 (v3). Serve de referência visual para a implementação em `Dashboard.tsx` / `Dashboard.module.css` — não é o código final, é o guia de layout, espaçamento e hierarquia.
