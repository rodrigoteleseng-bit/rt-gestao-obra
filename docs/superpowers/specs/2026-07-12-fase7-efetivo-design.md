# Fase 7 — Gestão de Efetivo (design)

> Primeiro extra da Fase 7 a ser construído (CLAUDE.md §5), por decisão do Rodrigo em 12/07/2026. Substitui o lançamento manual de efetivo por função/quantidade no RDO por um cadastro nominal de trabalhadores com chamada diária de presença.

## 1. Objetivo

Cadastrar os trabalhadores da obra (nome, função, empresa/empreiteiro) e registrar presença diária nominal via uma tela de chamada própria, separada do RDO. O RDO passa a exibir automaticamente o resumo do efetivo do dia lendo a chamada, em vez de o usuário digitar quantidade por função a cada relatório.

## 2. Decisões (perguntas respondidas com o Rodrigo em 12/07/2026)

- **Granularidade:** por nome, com histórico de presença individual dia a dia — não apenas quantidade agregada por função.
- **Quem cadastra trabalhador:** admin ou equipe com o módulo `efetivo` habilitado (mesmo padrão de Pendências/Compras/Almoxarifado).
- **Como marcar presença:** tela própria de "chamada" (lista de trabalhadores ativos com toggle presente/ausente para uma data), separada do RDO — não é preenchida dentro do formulário do RDO.
- **Escopo da chamada:** por dia da obra inteira, não por dia + unidade. Um trabalhador não precisa ser alocado a um sobrado específico nessa chamada.
- **Empresa do trabalhador:** campo de texto livre (ex.: "Próprio", "Empreiteiro João") — sem vínculo com o cadastro de fornecedores do módulo Compras (são conceitos distintos: fornecedor vende material, aqui é mão de obra).
- **Dados antigos do RDO (`rdo_efetivo`, por função/quantidade, sem nome):** mantidos como estão — RDOs já salvos continuam exibindo o que já foi lançado manualmente. Nenhuma migração retroativa de nomes (não há como inventar quem estava presente em dias passados). A partir da entrada em vigor deste módulo, RDOs novos passam a ler a chamada nominal.
- **Motivo de falta:** fora de escopo por agora — a chamada registra só presente/ausente, sem observação. Pode entrar depois se fizer falta no uso real.
- **Vínculo com custo/pagamento:** fora de escopo — este módulo é só presença, não valores de diária.

## 3. Modelo de dados

```sql
trabalhadores
  id, obra_id,
  nome TEXT NOT NULL,
  funcao TEXT NOT NULL,          -- texto livre, autocomplete das funções já usadas na obra
  empresa TEXT,                  -- texto livre, ex. "Próprio", "Empreiteiro João"
  data_admissao DATE,
  ativo BOOLEAN NOT NULL DEFAULT true,  -- inativar = "demissão" (soft delete)
  criado_por, criado_em

efetivo_chamadas
  id, obra_id,
  data DATE NOT NULL,
  criado_por, criado_em
  UNIQUE (obra_id, data)         -- uma chamada por dia da obra

efetivo_presencas
  id, chamada_id UUID REFERENCES efetivo_chamadas ON DELETE CASCADE,
  trabalhador_id UUID REFERENCES trabalhadores,
  presente BOOLEAN NOT NULL,
  criado_por, criado_em
  UNIQUE (chamada_id, trabalhador_id)
```

- Ao abrir a chamada de uma data sem registro em `efetivo_chamadas`, a tela cria a chamada e uma linha em `efetivo_presencas` por trabalhador ativo (todas `presente = true` por padrão, editável antes de salvar — evita repetir toggle pra maioria que sempre vem).
- Trabalhador inativado depois de uma chamada já feita não altera o histórico (a presença já registrada permanece).

## 4. Telas

1. **`/efetivo` — Trabalhadores** (lista): nome, função, empresa, status (ativo/inativo), busca. Botão "+ Novo trabalhador". Editar/inativar (admin ou quem tem o módulo).
2. **`/efetivo` — Chamada** (aba ou seção da mesma página): seletor de data (padrão hoje), lista de trabalhadores ativos com toggle presente/ausente, contagem "X de Y presentes", botão salvar. Se a chamada da data já existe, abre com o estado salvo para edição.
3. **RDOForm — bloco "Efetivo do dia":** passa a ler `efetivo_presencas` pela data do RDO (join com `trabalhadores`, filtro `presente = true`), agrupado por função para exibição e para o PDF (ex.: "3 pedreiros, 2 serventes — Empreiteiro João"; múltiplas empresas na mesma função aparecem em linhas separadas). RDOs já concluídos antes deste módulo continuam mostrando o que está em `rdo_efetivo` (não migrado). Se não houver chamada para a data do RDO, exibe aviso "Chamada do dia não feita" com link para `/efetivo`.
4. **Dashboard:** card "Efetivo" mostra o total de presentes na chamada de hoje (ou aviso se a chamada do dia não foi feita), com link para `/efetivo`.
5. **Usuários:** novo valor `efetivo` no enum `modulo_app`, checkbox na tela de permissões.

## 5. RLS

Padrão do projeto (`meu_papel()`, `meus_modulos()`):

```sql
pode_editar_efetivo() = admin OR (equipe AND 'efetivo' = ANY(meus_modulos()))
```

- **Leitura** (`trabalhadores`, `efetivo_chamadas`, `efetivo_presencas`): admin e equipe. **Cliente não vê** o módulo.
- **Escrita:** `pode_editar_efetivo()`.
- RDOForm continua exigindo apenas o módulo `rdo` para leitura do resumo de presença (não precisa do módulo `efetivo` para ver o bloco do RDO) — leitura de `efetivo_presencas` liberada a qualquer perfil que já lê RDO (admin/equipe).

## 6. Fora de escopo

- Motivo de falta/observação por ausência.
- Presença por unidade (sobrado específico).
- Vínculo com fornecedores do módulo Compras.
- Cálculo de diária, folha de pagamento ou custo de mão de obra.
- Migração retroativa dos lançamentos antigos de `rdo_efetivo` para o formato nominal.

## 7. Definição de pronto

Checklist padrão CLAUDE.md §8: celular + desktop, permissões dos 3 papéis testadas (cliente não vê; equipe só com o módulo habilitado), rastreabilidade (autor + data em todos os registros), migração versionada, Rodrigo testou com trabalhadores reais da obra piloto e deu aceite.
