# Revisão — Produção própria: excluir parede e redimensionar rótulo

Responsável pela implementação: Codex.
Responsável pela revisão: Claude Code, somente leitura.
Escopo implementado: `docs/superpowers/plans/2026-07-18-producao-excluir-redimensionar-parede.md` (5 tasks).
Commit-base: `0d1dd41` (plano aprovado).
Commits revisados: `9e4cb72`, `7501a68`, `8283640`, `80904c9`, `e1184c5`, `089c1a2`, `ceb167e`, `abebc14`.

Fora de escopo desta revisão (não avaliado): `7e0675c` ("registra período de dias
salariais") — mesmo arquivo (`Producao.tsx`), mas mexe só no componente `Dias`
(registro de dia sem produção), sem relação com a feature revisada e sem tocar em
`excluirParede`/`ajustarEscalaRotulo`/`PlantaClicavel`.

Verificações realizadas: código das 8 commits, RLS/policies existentes (sem mudança
nova), e — usando o MCP Supabase em modo leitura — o estado real do banco de produção
(`yxshldsfmbmbzdkcymca`): coluna `rotulo_escala`, constraint, histórico de migrações
aplicadas e os dados reais das 41 paredes cadastradas.

---

## Achado 1 — Médio

**Módulo e cenário:** Produção própria → aba Plantas, redimensionar o rótulo (`A−`/`A+`)
depois de já ter arrastado ou girado esse mesmo rótulo na mesma sessão.

**Arquivo e linha:** `src/components/PlantaClicavel.tsx:49-51` (`rotuloAtual`) e `60-78`
(`aoMover`, que grava em `rotulosLocais`).

**Evidência observada:**

```ts
function rotuloAtual(parede: ProducaoParede): RotuloAjustado {
  return rotulosLocais[parede.id] ?? rotuloPadrao(parede)
}
```

`rotulosLocais[parede.id]` é criado na primeira vez que o usuário arrasta ou gira o
rótulo daquela parede (dentro de `aoMover`) e **nunca é limpo depois** — fica lá pelo
resto da sessão (até recarregar a página). Como o objeto guardado é o `RotuloAjustado`
inteiro (`pos_x`, `pos_y`, `rotacao` **e** `escala`), ele congela a `escala` no valor
que existia no momento do primeiro arrasto/giro.

Depois disso, clicar em `A−`/`A+` chama `ajustarEscalaRotulo`
(`src/pages/Producao.tsx:846-853`), que grava certo no banco e atualiza o array
`paredes` do componente pai — mas a renderização do rótulo continua lendo
`rotulosLocais[parede.id]` (que existe e "ganha" do `??`), então a tela não reflete o
novo tamanho. Só volta a refletir depois de um F5 (quando `rotulosLocais` reseta pra
`{}` e a leitura volta a vir de `parede.rotulo_escala`, que está correto no banco).

**Impacto funcional:** nenhum risco de dado — o valor salvo no banco está sempre
correto (confirmei: `producao_paredes.rotulo_escala` no banco de produção bate com o
que os cliques deveriam ter produzido). O problema é só de feedback visual: se o
fluxo normal for "arrastar a etiqueta pro lugar, depois ajustar o tamanho" (a ordem
mais natural e a que o próprio plano sugeria testar em conjunto), o `A+`/`A−` parece
não fazer nada até recarregar a página — pode ser confundido com o botão não
funcionando.

**Correção recomendada:** em `rotuloAtual`, sempre priorizar a escala vinda da prop
(fonte da verdade), só reaproveitando `rotulosLocais` para posição/rotação em
andamento:

```ts
function rotuloAtual(parede: ProducaoParede): RotuloAjustado {
  const local = rotulosLocais[parede.id]
  return local ? { ...local, escala: parede.rotulo_escala } : rotuloPadrao(parede)
}
```

**Teste de validação:** numa parede qualquer, arrastar o rótulo pra outro lugar
(soltar), depois clicar `A+` duas vezes — o texto deve crescer na hora, sem precisar
recarregar a página.

---

## Achado 2 — Médio

**Módulo e cenário:** Produção própria → migração da coluna `rotulo_escala`.

**Arquivo e linha:** `supabase/migrations/20260718_producao_paredes_rotulo_escala.sql`.

**Evidência observada:** consultei diretamente o projeto de produção via MCP Supabase:

```sql
-- list_migrations no projeto yxshldsfmbmbzdkcymca:
-- última versão registrada é 20260717215137 (producao_paredes_rotulo_posicao).
-- Nenhuma versão 20260718_producao_paredes_rotulo_escala consta em
-- supabase_migrations.schema_migrations.

SELECT column_name, column_default FROM information_schema.columns
WHERE table_name='producao_paredes' AND column_name='rotulo_escala';
-- resultado: existe, default 1 — a coluna FOI criada no banco real.
```

Ou seja: o `ALTER TABLE` foi aplicado de fato (a funcionalidade funciona, confirmado
pelos dados reais das 41 paredes), mas não pelo caminho que registra a migração no
histórico do Supabase — o arquivo existe no repositório, mas o banco não "sabe" que
essa migração rodou.

**Impacto:** nenhum funcional agora. O risco é de auditoria/rastreabilidade
(`CLAUDE.md` §3/§6: migrações versionadas, nunca alteração manual direta) e de
inconsistência futura — se algum dia rodar `supabase db push` ou uma reconciliação de
histórico a partir de uma cópia limpa do repositório, essa migração específica ficará
"pendente" aos olhos da ferramenta, mesmo já estando aplicada, o que pode confundir
diagnósticos futuros (achado semelhante em espírito ao Achado 1 da revisão de
17/07/2026, mas sem a regressão funcional daquele caso).

**Correção recomendada:** registrar a migração no histórico real, por exemplo:

```sql
INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES ('20260718120000', 'producao_paredes_rotulo_escala', ARRAY[
  $$ALTER TABLE producao_paredes ADD COLUMN IF NOT EXISTS rotulo_escala NUMERIC(3,2) NOT NULL DEFAULT 1 CHECK (rotulo_escala >= 0.5 AND rotulo_escala <= 2.0)$$
]);
```

(ajustar o formato exato conforme a versão da CLI/MCP usada nas migrações anteriores).
Sugiro também, daqui pra frente, sempre aplicar migrações via `apply_migration` do MCP
(que já registra o histórico automaticamente) em vez de `execute_sql`/DDL direto.

**Teste de validação:** repetir a consulta a `supabase_migrations.schema_migrations`
depois do ajuste e confirmar que a versão aparece.

---

## Achado 3 — Baixo (sugestão)

**Módulo e cenário:** Produção própria → aba Plantas, texto de instrução acima da
planta clicável.

**Arquivo e linha:** `src/pages/Producao.tsx:885` (texto fixo, não alterado por
nenhuma das 8 commits revisadas).

**Evidência observada:** o texto continua "Arraste o nome de uma parede pra
reposicionar; arraste a bolinha ao lado dele pra girar." — não menciona os novos
botões `A−`/`A+`, que além disso só aparecem ao passar o mouse ou focar o rótulo
(`.rotulo:hover .controlesEscala, .rotulo:focus-within .controlesEscala` em
`PlantaClicavel.module.css`), sem nenhuma dica visual permanente de que existem.

**Impacto:** nenhum funcional — os dados reais mostram que você já encontrou e usou o
recurso (paredes com escala 0.5 no banco). É só uma lacuna de descoberta para quem for
usar a tela sem ter acompanhado esta conversa.

**Correção recomendada (não bloqueante):** completar a frase, algo como "...; passe o
mouse ou toque no nome pra ver os botões de aumentar/diminuir o tamanho."

---

## O que foi verificado e não apresentou problema

- **Inativação lógica:** `excluirParede` faz `UPDATE ... SET ativo = false` — nunca
  `DELETE` — código idêntico ao planejado (`src/pages/Producao.tsx:836-845`).
- **RLS:** nenhuma policy nova ou alterada; a `prod_paredes_select` já existente cobre
  a inativação (`ativo AND papel...) OR pode_editar_medicoes()`), e a
  `prod_paredes_update` não exige `ativo = true` no `WITH CHECK` — sem risco de repetir
  o bug de RLS de 13/07/2026.
- **Aviso de produção lançada:** confirmado no banco — a única parede inativada
  (`PAREDE SP04B`) reflete o fluxo esperado; a query de soma de `produzido_m2` está
  correta.
- **Filtro nas duas telas:** tanto `Lancamentos` quanto `Plantas` carregam
  `producao_paredes` com `.eq("ativo", true)` (`Producao.tsx:281-282` e `723-724`) —
  parede excluída some das duas, como pedido.
- **Constraint da escala:** `CHECK (rotulo_escala >= 0.5 AND rotulo_escala <= 2.0)`
  confirmada no banco real, e os dados de produção respeitam a faixa (mín. 0.5,
  máx. 1.0 observado).
- **Guarda de eventos:** os botões `A−`/`A+`/alça de girar usam `stopPropagation` no
  `onPointerDown`, then `onClick` — clicar neles não aciona o `onPointerDown` do
  rótulo pai (que iniciaria um arrasto sem querer). Boa implementação, mais cuidadosa
  que o esboço do meu próprio plano.
- **`moverRotulo` não sobrescreve a escala:** grava só `rotulo_pos_x/y/rotacao`
  (`Producao.tsx:803-806`) — arrastar/girar nunca reseta o tamanho ajustado.

## Diferenciação defeito comprovado × sugestão

Achados 1 e 2 são defeitos comprovados (verificados no código e no banco real,
respectivamente). Achado 3 é sugestão de baixo impacto, não bloqueante.
