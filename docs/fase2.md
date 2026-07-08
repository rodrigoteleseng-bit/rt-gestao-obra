# Fase 2 — Cronograma + Avanço Físico · Registro de entrega

> Status: **entregue em 07/07/2026 — aguardando teste guiado e aceite do Rodrigo.**
> Referência técnica: o que existe, onde está e como funciona.

## Dados importados

Fonte: `Cronograma de Serviços - Jardins imperial.xml` (exportação XML do MS Project; obra "Conjunto Jardins Imperial" = Tharsos Imperial).

| Métrica | Valor |
|---|---|
| Período | 13/10/2025 a 24/04/2028 |
| Tarefas importadas | 2.816 (de 2.820 no XML — descartados os 4 contêineres: raiz, projeto, Grupo 1, Grupo 2) |
| Tarefas-folha (executáveis) | 1.933 |
| Dependências (predecessoras) | 2.131 |
| Por sobrado (×13) | 193 tarefas |
| Portaria / Área Comum / Canteiro | 160 / 142 / 5 |

Mapeamento de unidades aprovado pelo Rodrigo: Casa NN → Sobrado NN; Serviços Preliminares → Canteiro; Muro de Contenção, Área de Lazer e Pavimentação/Paisagismo Condomínio → Área Comum. "Grupo 1/2" (frentes de ataque) preservado em `grupo_ataque`.

## Decisões de projeto (aprovadas em 07/07/2026)

1. **Avanço lançado na tarefa-folha** (máxima rastreabilidade; UI em lote por etapa).
2. **Peso da Curva S = duração prevista** [estimado] — migra para R$ quando houver de-para cronograma ↔ orçamento (Fase 3). As colunas `etapa_id`/`servico_id` em `cronograma_tarefas` já existem para esse vínculo.
3. **Baselines versionadas**: reimportação do Project cria nova versão em `cronograma_versoes`; nada se apaga. O app usa a versão `vigente`.
4. Árvore do cronograma é a EAP do MS Project (não coincide nome a nome com a EAP do orçamento — de-para fica para a Fase 3).

## Banco (migração `20260707_fase2_cronograma.sql`)

- `cronograma_versoes` — uma linha por importação (baseline), flag `vigente`.
- `cronograma_tarefas` — árvore própria (`parent_id`), identidade estável por `uid_project` (UNIQUE com obra), `unidade_id` obrigatória, `grupo_ataque`, vínculos opcionais ao orçamento.
- `cronograma_previsto` — início/fim/duração por tarefa **por versão** de baseline.
- `cronograma_dependencias` — FS/SS/FF/SF + defasagem em minutos (LinkLag/10 do XML).
- `avancos_fisicos` — lançamentos de % acumulado com `data_referencia`, observação, autor (`DEFAULT auth.uid()`), soft delete. % atual = último lançamento ativo por data de referência.
- RLS: leitura autenticados; escrita de cronograma só admin; INSERT de avanço para admin ou equipe com módulo `avanco`; UPDATE (inativação) só admin ou o próprio autor.

## Importação (técnica reutilizável)

1. `node scripts/importar-cronograma.cjs [xml]` — parseia o XML (regex sobre blocos `<Task>`, sem dependência externa), valida o mapeamento de unidades (aborta se houver bloco sem unidade), gera `scripts/cronograma_import.sql` (ASCII puro, unicode via `E'\uXXXX'`) e imprime relatório de conferência.
2. Reativar a edge function `exec-import-sql` (novo deploy com segredo novo embutido; env `SUPABASE_DB_URL` é injetada pelo Supabase).
3. `node scripts/enviar-sql.cjs scripts/cronograma_import.sql <segredo>` — envia em lotes de ~120 KB (12 lotes).
4. Neutralizar a function de novo (deploy da versão 410 "gone").
5. Conferência no banco bateu 100% com o relatório local (2.816/1.933/2.131, 0 órfãos).

**Reimportação futura:** gerar SQL com `versao = 2` e `vigente = true`, desligar `vigente` da v1, inserir apenas `cronograma_previsto` novo para tarefas já existentes (casadas por `uid_project`) e tarefas novas. O script atual cobre a 1ª importação; a reimportação exigirá adaptação (registrado como pendência).

## Frontend

- `src/lib/cronograma.ts` — carregamento paginado (tarefas + previsto da versão vigente + avanços ativos), `percentuaisAtuais` (último lançamento por data de referência), `montarArvore` (agregação de % ponderada por duração, de baixo para cima), `statusTarefa` (concluída / atrasada / em andamento / prevista), `hojeISO` em **data local** (cuidado: `toISOString()` vira o dia às 21h em Goiânia).
- **`/cronograma`** (`src/pages/Cronograma.tsx`) — 3 abas, visível a todos os papéis:
  - **Tarefas**: árvore por unidade com datas, barra de %, chip de status; filtros de unidade, status e busca; chip do grupo de ataque.
  - **Curva S**: cards Previsto até hoje / Realizado / Desvio; gráfico SVG semanal previsto × realizado com linha de "hoje"; box "De onde vêm estes números" (rastreabilidade regra 2).
  - **Atrasadas**: folhas com fim < hoje e % < 100, ordenadas por dias de atraso, com caminho na EAP.
- **`/avanco`** (`src/pages/Avanco.tsx`) — só admin/equipe com módulo `avanco` (os demais veem aviso): seleciona unidade → grupos por caminho da EAP → inputs de % por folha (botão rápido "100", observação opcional), data de referência única, salvamento em lote (só linhas alteradas), rodapé fixo com contagem.
- Menu: "Cronograma" visível sempre; "Avanço Físico" por módulo. Rotas em `App.tsx`.

## Verificação executada (07/07/2026)

Testado no preview com usuário temporário `equipe` + módulo `avanco` (criado via SQL e **removido após o teste**, junto com os 4 lançamentos de teste):

- Login, menu filtrado por permissão, árvore com 16 unidades, Curva S (previsto 18% até hoje), lançamento em lote gravando autor/data/observação via RLS real, agregação ponderada (Canteiro 88,2% = 120h/136h), status Atrasada/Concluída corretos, aba Atrasadas com dias e caminho, Realizado refletindo na curva (0,2%).
- Build de produção limpo. Bug corrigido durante o teste: `setValores` com map do render (perda em atualizações no mesmo batch) → forma funcional.

## Pendências transferidas

- Exportação Excel/PDF (orçamento e cronograma) — pendência desde a Fase 1.
- Script de **reimportação** de baseline (v2+) — adaptar `importar-cronograma.cjs` quando o Project mudar.
- De-para cronograma ↔ orçamento + Curva S em R$ — Fase 3.
- Teste guiado do Rodrigo (celular + desktop) e aceite formal da fase.
