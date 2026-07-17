# Produção própria — Seleção de parede por planta (PDF) · Spec de design

> Status: aprovado por Rodrigo em 17/07/2026, aguardando plano de implementação.
> Extra dentro do módulo Produção própria (`docs/fase7_producao_propria.md`), que já está
> entregue e em teste de campo. Esta spec cobre uma melhoria ao lançamento diário, não um
> módulo novo.

## 1. Objetivo

Hoje, o lançamento diário de produção própria (alvenaria/reboco) exige digitar manualmente o
nome da parede, comprimento, altura e os vãos (portas/janelas) toda vez que alguém lança
produção — mesmo sendo sempre as mesmas paredes dos mesmos 13 sobrados "Tipo".

Esta spec substitui a digitação manual por uma planta em PDF clicável: a geometria de cada
parede é cadastrada **uma vez** (comprimento/altura já resolvidos em área líquida/bruta), e o
lançamento diário passa a ser: abrir a planta, clicar na parede, informar quantos m² foram
feitos hoje. O sistema acompanha o saldo de cada parede por sobrado e nunca deixa lançar mais
do que a meta cadastrada.

## 2. Escopo

- Cobre os 4 pavimentos da planta "Sobrado Tipo": térreo, superior, platibanda, caixa d'água.
  Cadastrado uma vez, reaproveitado nos 13 sobrados (mesma planta, saldo independente por
  sobrado).
- **Fora desta entrega:** Portaria e Área Comum — não são "tipo" repetido, cada uma teria
  planta e cadastro próprios. O modelo de dados é genérico o suficiente para cobri-las depois
  (não há nada específico de "sobrado" nas tabelas), mas o cadastro delas fica para uma etapa
  futura, por decisão do Rodrigo.
- **Trava total:** uma vez que esta funcionalidade estiver no ar, o lançamento diário só aceita
  paredes que já estão cadastradas na planta clicável — não há mais fallback de digitar nome +
  medidas livremente. Enquanto uma parede não estiver cadastrada, produção nela não pode ser
  lançada.

## 3. Modelo de dados

### `producao_plantas` (planta por pavimento, uma vez por obra)

```sql
CREATE TABLE producao_plantas (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  obra_id      UUID NOT NULL REFERENCES obras(id),
  pavimento    TEXT NOT NULL,   -- 'terreo' | 'superior' | 'platibanda' | 'caixa_agua'
  pdf_path     TEXT NOT NULL,   -- Storage: bucket producao-plantas
  imagem_path  TEXT NOT NULL,   -- imagem convertida (1ª página), usada na tela
  ativo        BOOLEAN NOT NULL DEFAULT true,
  criado_por   UUID NOT NULL DEFAULT auth.uid() REFERENCES perfis_usuario(id),
  criado_em    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (obra_id, pavimento)
);
```

A conversão PDF → imagem acontece no navegador no momento do upload (primeira página,
renderizada e enviada como PNG junto com o PDF original). O PDF original fica guardado para
referência, mas a tela (cadastro e lançamento) sempre usa a imagem.

### `producao_paredes` (catálogo de paredes — geometria cadastrada uma vez)

```sql
CREATE TABLE producao_paredes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  planta_id       UUID NOT NULL REFERENCES producao_plantas(id),
  nome            TEXT NOT NULL,           -- ex.: "Parede 01"
  -- posição da faixa clicável, em % da imagem (responsivo a qualquer tamanho de tela)
  pos_x           NUMERIC NOT NULL,
  pos_y           NUMERIC NOT NULL,
  largura         NUMERIC NOT NULL,
  altura_px       NUMERIC NOT NULL,
  meta_alvenaria_m2   NUMERIC,             -- NULL = esta parede não tem alvenaria a lançar
  meta_reboco_a_m2    NUMERIC,             -- face A — NULL = sem reboco nesta face
  meta_reboco_b_m2    NUMERIC,             -- face B
  ativo           BOOLEAN NOT NULL DEFAULT true,
  criado_por      UUID NOT NULL DEFAULT auth.uid() REFERENCES perfis_usuario(id),
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Pelo menos uma das três metas precisa estar preenchida (constraint `CHECK`). Editar uma meta
depois de já existir progresso lançado é bloqueado se o novo valor for menor que o já
produzido em qualquer sobrado (mesmo princípio de não permitir saldo negativo).

### `producao_paredes_progresso` (saldo por parede × sobrado × serviço/face)

```sql
CREATE TABLE producao_paredes_progresso (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parede_id     UUID NOT NULL REFERENCES producao_paredes(id),
  unidade_id    UUID NOT NULL REFERENCES unidades(id),   -- qual dos 13 sobrados
  servico       tipo_servico_producao NOT NULL,           -- 'alvenaria' | 'reboco'
  face          TEXT,                                     -- NULL p/ alvenaria, 'a'/'b' p/ reboco
  produzido_m2  NUMERIC NOT NULL DEFAULT 0,
  UNIQUE (parede_id, unidade_id, servico, face)
);
```

Criada sob demanda (primeiro lançamento daquela combinação); `produzido_m2` é atualizado por
trigger a cada lançamento novo, editado ou cancelado — nunca escrito direto pela tela. Um
`CHECK`/trigger garante `produzido_m2 <= meta_correspondente`, replicando o padrão de trava de
saldo já usado em Medições de contrato (`supabase/migrations/20260713_fase7_medicoes_travas.sql`).

### Ajustes em `producao_lancamentos`

- Novo vínculo `parede_id UUID REFERENCES producao_paredes(id)` e `face TEXT` (substituindo o
  campo livre `parede` para lançamentos novos; o campo antigo continua existindo só para
  histórico dos lançamentos já feitos hoje, sem migração retroativa).
- Novas colunas: `cancelado_em TIMESTAMPTZ`, `cancelado_por UUID REFERENCES perfis_usuario(id)`,
  `motivo_cancelamento TEXT`.
- Cancelar só é permitido enquanto o lançamento não pertence a uma medição aprovada (mesma
  regra de imutabilidade pós-aprovação já existente no módulo). Cancelamento devolve o saldo em
  `producao_paredes_progresso` via trigger.

### RLS

Seguindo a regra aprendida na revisão de hoje (`docs/revisao-2026-07-17-rls-filhos-obra.md`):
qualquer policy de tabela-filha que precise descobrir a obra através de uma tabela-pai usa uma
função `SECURITY DEFINER` dedicada (ex.: `pode_acessar_planta(p_planta)`,
`pode_acessar_parede(p_parede)`), nunca uma subquery inline — para não repetir o bug de
INSERT bloqueado. Cadastro de plantas/paredes e lançamento diário seguem a mesma permissão:
quem tem o módulo de produção liberado (confirmado por Rodrigo em 17/07/2026).

## 4. Fluxo de uso

**Cadastro de planta e paredes (uma vez, no ritmo do Rodrigo):**
1. Upload do PDF de um pavimento → conversão automática para imagem.
2. Sobre a imagem, desenhar uma faixa colorida (clicar e arrastar um retângulo) sobre a linha
   de cada parede, nomear e informar as metas (alvenaria e/ou reboco face A/B).
3. Paredes não cadastradas simplesmente não aparecem clicáveis — não é preciso cadastrar a
   planta inteira de uma vez.

**Lançamento diário (fluxo atual + seleção visual):**
1. Escolher sobrado, data, serviço — como hoje.
2. Botão "Selecionar parede" abre a planta do pavimento correspondente.
3. Clicar na faixa colorida da parede. Se o serviço for reboco, escolher Face A ou Face B em
   seguida.
4. Tela mostra meta total, produzido até agora (naquele sobrado) e quanto falta.
5. Usuário digita quantos m² fez hoje; sistema bloqueia se ultrapassar o saldo restante.
6. Resto do fluxo (profissionais, rateio, preço por m² congelado) inalterado.

## 5. Decisões de interação (validadas com mockup)

- **Área clicável:** faixa colorida semitransparente sobre a parede (não um pino separado, nem
  a linha exata) — maior tolerância de clique, especialmente no celular em campo.
- **Reboco (2 faces):** um único clique na parede; a escolha entre Face A / Face B acontece
  depois, numa pergunta rápida — evita poluir a planta com dois marcadores por parede.

## 6. Casos especiais e erros

- **Lançamento concorrente na mesma parede/sobrado:** trava de saldo no banco (lock de linha +
  recontagem), mesmo padrão de Medições — quem salvar por último recalcula contra o saldo real.
- **Parede já concluída:** continua visível e clicável na planta; ao selecionar, mostra "0 m²
  restantes" e bloqueia novo lançamento ali, sem esconder a faixa.
- **Cancelamento de lançamento:** novo — qualquer usuário com o módulo de produção liberado
  pode cancelar um lançamento (próprio ou de outra pessoa, mesmo padrão de outros módulos como
  Contratos, onde a permissão é por módulo, não por autoria) ainda não aprovado, com motivo
  obrigatório; saldo da parede volta automaticamente. Bloqueado se o lançamento já estiver
  numa medição aprovada.
- **Meta cadastrada errada:** editável enquanto não houver progresso que ultrapasse o novo
  valor; caso contrário, bloqueado (mensagem explicando o motivo, não falha silenciosa).

## 7. Fora de escopo (nesta entrega)

- Planta/cadastro de Portaria e Área Comum (modelo já suportaria, mas cadastro fica para depois).
- Cálculo automático de medidas a partir de cliques na planta (metas são sempre digitadas por
  quem cadastra, a planta é só o mapa visual de seleção).
- Fallback de lançamento por texto livre para paredes não cadastradas (trava total, conforme
  decisão do Rodrigo).
- Edição da posição da faixa de uma parede já cadastrada — se a faixa ficar mal posicionada,
  a correção nesta primeira versão é inativar a parede e recadastrar; um editor de posição
  fica para uma iteração futura, se o uso real mostrar que é necessário.

## 8. Teste guiado

1. Cadastrar a planta do térreo (upload PDF → imagem), desenhar a faixa de 2-3 paredes com
   metas de alvenaria e reboco (2 faces).
2. Lançar produção parcial numa parede de alvenaria num sobrado; conferir saldo mostrado.
3. Lançar o restante da mesma parede no mesmo sobrado; tentar lançar além do que falta — deve
   bloquear.
4. Repetir a mesma parede em outro sobrado — saldo deve ser independente do primeiro.
5. Lançar reboco na face A e na face B da mesma parede — saldos separados.
6. Cancelar um lançamento não aprovado — saldo volta, motivo fica registrado.
7. Tentar cancelar um lançamento já dentro de uma medição aprovada — deve bloquear.
8. Testar o fluxo completo no celular, em especial a precisão do clique na faixa colorida.
