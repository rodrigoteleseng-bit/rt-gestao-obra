# Fase 7 — Extras: Gestão de Efetivo

> Primeiro extra da Fase 7 (CLAUDE.md §5) a ser construído, por decisão do Rodrigo em 12/07/2026. Substitui o lançamento manual de efetivo por função/quantidade no RDO por um cadastro nominal de trabalhadores com chamada diária de presença. Entregue em 12/07/2026, aguardando teste de campo com trabalhadores reais e aceite do Rodrigo — ver CLAUDE.md §0 e §7.

## O que foi entregue

- **Tela `/efetivo` com 2 abas:**
  - **Trabalhadores** — cadastro (nome, função em texto livre com autocomplete via `<datalist>` das funções já usadas na obra, empresa/empreiteiro em texto livre, data de admissão opcional), listagem com busca por nome/função, filtro por função, inativação (soft delete — "demissão" não apaga histórico). Guard de papel `cliente` (não vê a tela), edição restrita a quem tem `pode_editar_efetivo()`.
  - **Chamada** — seletor de data (padrão hoje, sem permitir data futura), lista de trabalhadores ativos com toggle presente/ausente por trabalhador, contador "X de Y presentes", botão salvar. Abrir uma data sem chamada registrada cria o padrão com todos marcados presentes (editável antes de salvar); abrir uma data já registrada carrega o estado salvo. Guarda contra corrida: trocar de data rapidamente não deixa uma resposta de consulta antiga sobrescrever a data atual em tela (fix da Task 3, via `useRef` capturando a data vigente no momento em que cada carregamento termina).
- **RDO — bloco "Efetivo do dia":** quando o RDO está em **rascunho** e existe uma chamada de presença salva para a mesma data/obra, o bloco passa a mostrar automaticamente o resumo agrupado da chamada (função + quantidade + empresa, ex. "2× Pedreiro — Empresa X"), com botão "Editar chamada" levando para `/efetivo`, e oculta os controles de lançamento manual. Sem chamada para a data, mostra aviso "Chamada do dia ainda não feita." com botão "Fazer chamada", e o comportamento manual antigo (digitar função/quantidade direto no RDO) continua disponível — nada mudou nesse caminho. **RDO já assinado nunca lê a chamada:** a busca de chamada/presença só roda quando `status === 'rascunho'`; um RDO assinado permanece congelado com o que foi gravado em `rdo_efetivo` no momento da assinatura, mesmo que a chamada daquele dia seja criada ou editada depois (preserva a imutabilidade da assinatura digital, regra dura do CLAUDE.md §6).
- **Dashboard:** banner "Chamada de hoje ainda não foi feita (N trabalhador(es) cadastrado(s))." ou "P de N presentes hoje.", clicável para `/efetivo`, no mesmo padrão visual (variante informativa azul-gelo) do banner de ferramentas em atraso do Almoxarifado. Some quando não há nenhum trabalhador ativo cadastrado (nada para chamar ainda). Oculto para o papel `cliente` e para quem não tem o módulo `efetivo`.
- **Permissões:** novo valor `efetivo` no enum `modulo_app`, checkbox na tela de Usuários (padrão dos demais módulos). RLS: leitura de `trabalhadores`/`efetivo_chamadas`/`efetivo_presencas` liberada a `admin` e `equipe` (cliente não vê o módulo); escrita restrita a `pode_editar_efetivo()` (`admin` OU `equipe` com o módulo `efetivo` habilitado). O bloco de leitura do RDO usa apenas o módulo `rdo` — quem já vê RDO vê o resumo de presença, sem precisar do módulo `efetivo` separado.

## Decisões

- **Granularidade nominal, não agregada:** presença é por trabalhador identificado por nome, com histórico dia a dia — decisão do Rodrigo em 12/07/2026, para saber quem esteve na obra, não só quantos.
- **Chamada é por obra inteira, não por unidade:** um trabalhador não é alocado a um sobrado específico na chamada; presença por unidade fica fora de escopo.
- **Empresa é texto livre, sem vínculo com o cadastro de fornecedores do Compras:** são conceitos distintos (fornecedor vende material; aqui é mão de obra).
- **Sem migração retroativa:** RDOs assinados antes desta fase continuam mostrando exatamente o que foi lançado manualmente em `rdo_efetivo` (por função/quantidade, sem nome). Não há como inventar retroativamente quem esteve presente em dias passados — CLAUDE.md §6.3.
- **Motivo de falta fora de escopo:** a chamada registra só presente/ausente, sem observação. Pode entrar depois se fizer falta no uso real.
- **Sem vínculo com custo/pagamento:** este módulo é só presença, não valores de diária, folha de pagamento ou cálculo de mão de obra.

## Onde estão as regras de negócio

- Banco: `supabase/migrations/20260712_fase7_efetivo.sql` — tabelas `trabalhadores`, `efetivo_chamadas` (UNIQUE por obra+data), `efetivo_presencas` (UNIQUE por chamada+trabalhador), função `pode_editar_efetivo()`, RLS (leitura admin/equipe, escrita restrita, `criado_por = auth.uid()` obrigatório nos inserts).
- Frontend: `src/pages/Efetivo.tsx` (+ `.module.css`) — abas Trabalhadores e Chamada; `src/lib/efetivo.ts` — helper puro `agruparPresencasComoEfetivo()` que transforma presenças nominais no mesmo shape `RdoEfetivo[]` já consumido por `RDOForm.tsx` e `rdoPdf.ts`; `src/pages/RDOForm.tsx` — leitura condicional da chamada (só em rascunho); `src/pages/Dashboard.tsx` — banner de chamada do dia.
- Desenho completo e decisões tomadas com o Rodrigo: `docs/superpowers/specs/2026-07-12-fase7-efetivo-design.md`.

## Roteiro de teste guiado (Rodrigo)

1. Abrir `/efetivo` (celular e desktop) → aba **Trabalhadores**: cadastrar 2 ou 3 trabalhadores reais da obra (nome, função, empresa). Confirmar que aparecem na lista e que a busca/filtro por função funcionam.
2. Ir à aba **Chamada** (data já vem em hoje): confirmar que os trabalhadores cadastrados aparecem todos marcados como presentes por padrão; marcar 1 deles como **ausente** e salvar. Confirmar a mensagem de confirmação ("Chamada de [data] salva: X de Y presentes").
3. Abrir o **Dashboard**: confirmar que aparece o banner "X de Y presentes hoje" (não o de "chamada ainda não feita").
4. Abrir ou criar o **RDO de hoje**: confirmar que o bloco "Efetivo do dia" já mostra o resumo da chamada (função + quantidade + empresa) automaticamente, sem precisar digitar de novo, com o botão "Editar chamada".
5. Abrir um **RDO de um dia anterior a esta fase** (antes de 12/07/2026): confirmar que ele continua mostrando exatamente o que já estava salvo manualmente — nada muda retroativamente.
6. **Assinar um RDO** de um dia com chamada feita, depois voltar em `/efetivo` e **editar a chamada daquele mesmo dia** (trocar quem estava presente). Reabrir o RDO já assinado e confirmar que o efetivo mostrado **não mudou** — continua o que foi assinado, mesmo com a chamada alterada depois.

## Lacunas

- **Nenhuma migração retroativa dos lançamentos antigos de `rdo_efetivo`** (por função/quantidade, sem nome) para o formato nominal — decisão da spec, não é um débito a corrigir.
- **Motivo de falta** na chamada — fora de escopo desta fase.
- **Presença por unidade** (sobrado específico) — fora de escopo desta fase.
- **Cadastro de trabalhadores ainda vazio na obra piloto** até o Rodrigo fazer o roteiro de teste guiado (passo 1 acima) — nenhum dado de teste foi deixado no banco.

## Débitos conhecidos (não são bugs a corrigir agora)

- **Guarda de corrida cobre troca de data na Chamada, mas não troca simultânea de obra ativa** — cenário raro hoje, com apenas 1 obra ativa no app; se uma segunda obra entrar, revisar.
- **Banners do Dashboard (efetivo e ferramentas em atraso) não têm `AbortController` contra corrida ao trocar de obra rapidamente** — padrão já herdado do banner de Almoxarifado, não introduzido nesta fase.
- **Botão "Fazer chamada"/"Editar chamada" no RDO não esconde-se se o usuário não tiver o módulo `efetivo`** — a rota `/efetivo` já tem seu próprio gate de permissão, então não é falha de segurança, apenas um clique que pode levar a uma tela sem acesso. Ajuste de baixo custo se incomodar no uso real.
- **Banner "chamada feita" no Dashboard aparece mesmo com 100% de presença** — comportamento intencional (mostra sempre a contagem), pode ser suprimido com um ajuste de uma linha se o Rodrigo preferir só ver o banner quando houver ausência.

## Verificações realizadas (tasks 1–5)

- Typecheck limpo (`npx tsc --noEmit -p tsconfig.json`) ao final de cada task e novamente nesta.
- RLS: as 3 tabelas (`trabalhadores`, `efetivo_chamadas`, `efetivo_presencas`) confirmadas com `rowsecurity = true`; policies exigem `criado_por = auth.uid()` nos inserts; leitura restrita a `admin`/`equipe`, papel `cliente` não vê o módulo (Task 1).
- Fluxos de chamada, upsert (`onConflict: 'chamada_id,trabalhador_id'`), agrupamento para o RDO (`agruparPresencasComoEfetivo`) e o banner do Dashboard foram verificados via SQL em transações com `ROLLBACK` (dados fictícios inseridos e desfeitos, sem tocar em dados reais do Rodrigo) — Tasks 3, 4 e 5.
- Imutabilidade de RDO assinado (regra dura CLAUDE.md §6) verificada por leitura de código: para `rdo.status === 'assinado'`, a busca de chamada/presença nunca é disparada, `efetivo` permanece o que veio de `rdo_efetivo` na consulta original (Task 4, fix pós-revisão).
- Rastreabilidade: todo registro de `trabalhadores`, `efetivo_chamadas` e `efetivo_presencas` grava `criado_por` e `criado_em`; inativação de trabalhador é soft delete (`ativo = false`), sem apagar histórico de presença já registrada.
- Mobile e desktop não foram re-testados nesta task de documentação — cobertos durante as tasks 2, 3 e 5 (estilos derivados dos padrões já responsivos de Almoxarifado/Pendências).

## Fora de escopo (registrado na spec, não entregue nesta fase)

- Motivo de falta / observação por ausência.
- Presença por unidade (sobrado específico).
- Vínculo com o cadastro de fornecedores do módulo Compras.
- Cálculo de diária, folha de pagamento ou custo de mão de obra.
- Migração retroativa dos lançamentos antigos de `rdo_efetivo` para o formato nominal.
