# Almoxarifado — Aluguéis: renomear para "Equipamento" e suportar quantidade + devolução parcial · Spec de design

> Status: aprovado por Rodrigo em 22/07/2026, aguardando plano de implementação.
> Escopo: só a aba "Aluguéis" do Almoxarifado (`ferramenta_locacoes` e telas associadas em
> `Almoxarifado.tsx`). Não toca no módulo separado de empréstimo individual de ferramentas
> (`ferramentas`/`ferramenta_emprestimos`, aba "Ferramentas").

## 1. Objetivo

A aba Aluguéis (entregue em 21/07/2026, revisada no mesmo dia, ainda sem teste de campo) hoje
trata cada locação como um item único: "1 compactador de solo", "1 andaime". Na prática, Rodrigo
aluga em lote — várias unidades do mesmo equipamento na mesma locação (ex.: 40 escoras metálicas)
— e devolve em partes conforme a obra avança, não tudo de uma vez. Esta spec:

1. Renomeia a terminologia de "Ferramenta" para "Equipamento" em toda a aba (pedido explícito de
   Rodrigo em 22/07/2026 — reflete melhor o que de fato é alugado: andaimes, escoras,
   compactadores, betoneiras, não só "ferramentas").
2. Adiciona quantidade à locação (decisão de 22/07/2026).
3. Suporta devolução parcial, com a locação continuando aberta com o saldo restante até devolver
   tudo (decisão explícita de 22/07/2026 — Rodrigo escolheu essa opção em vez de manter "entrega
   tudo junto").
4. Mantém um único prazo (`data_entrega_prevista`) para o lote inteiro, mesmo com devoluções
   parciais — decisão de 22/07/2026, para não complicar o desenho com prazos por parcela.

## 2. Levantamento do estado real

- **Tabela `ferramenta_locacoes`** (`20260721_ferramenta_locacoes.sql` +
  `20260721_ferramenta_locacoes_revisao.sql`): sem coluna de quantidade. Campos relevantes:
  `nome_ferramenta`, `locadora`, `modalidade`, `data_chegada`, `data_entrega_prevista`,
  `data_entregue`, `entregue_por`, `entregue_em`, `editado_por`, `editado_em`, `ativo`.
- **RLS atual:** `floc_select` — `(ativo = true OR pode_editar_almoxarifado()) AND
  pode_editar_almoxarifado()`; `floc_insert` — `pode_editar_almoxarifado() AND criado_por =
  auth.uid()`; `floc_update` — `pode_editar_almoxarifado() AND data_entregue IS NULL` (só
  enquanto a locação está aberta).
- **Frontend:** `Almoxarifado.tsx` — `AbaLocacoes()` (lista + alertas de vencimento) e
  `PainelLocacao()` (formulário de criar/editar), mais a função `registrarEntrega()` que hoje faz
  um único `UPDATE` fechando a locação inteira (`data_entregue = hoje`).
- **`nome_ferramenta` e `FerramentaLocacao` estão isolados em só 2 arquivos** (`supabase.ts` e
  `Almoxarifado.tsx`) — confirmado por busca em todo `src/`. Nenhum PDF, Dashboard ou outro módulo
  referencia essa tabela. Blast radius pequeno.
- **Tabela ainda não aceita em campo** — criada e revisada em 21/07/2026, sem nenhum aluguel real
  lançado ainda (confirma que renomear a coluna agora, em vez de manter `nome_ferramenta` como
  legado, não tem custo de migração de dado real).
- **Padrão de saldo calculado ao vivo já existe no app:** Medições calcula "já aprovado" e "saldo
  antes" no frontend a partir da soma de itens relacionados (`MedicaoForm.tsx`), sem duplicar o
  saldo numa coluna própria — mesmo princípio aplicado aqui para não ter dois números que podem
  dessincronizar.

## 3. Modelo de dados

### `ferramenta_locacoes` (colunas)

```sql
ALTER TABLE ferramenta_locacoes RENAME COLUMN nome_ferramenta TO nome_equipamento;
ALTER TABLE ferramenta_locacoes ADD COLUMN quantidade INTEGER NOT NULL DEFAULT 1 CHECK (quantidade > 0);
ALTER TABLE ferramenta_locacoes ALTER COLUMN quantidade DROP DEFAULT;
```

(`DEFAULT 1` só existe para popular a coluna em linhas já existentes sem quebrar o `NOT NULL`; é
removido em seguida porque toda locação nova deve informar a quantidade explicitamente — não é um
valor implícito.)

### `ferramenta_locacoes_devolucoes` (tabela nova — histórico imutável)

```sql
CREATE TABLE ferramenta_locacoes_devolucoes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  locacao_id    UUID NOT NULL REFERENCES ferramenta_locacoes(id) ON DELETE CASCADE,
  quantidade    INTEGER NOT NULL CHECK (quantidade > 0),
  devolvido_por UUID NOT NULL DEFAULT auth.uid() REFERENCES perfis_usuario(id),
  devolvido_em  TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Sem `ativo`, sem `UPDATE`/`DELETE` policy — é um registro de evento histórico, cada devolução
parcial (ou a devolução final) é uma linha nova, nunca corrigida ou apagada. Mesma filosofia de
"nada se apaga" (CLAUDE.md §6), aplicada aqui como log de eventos em vez de soft delete, porque
não existe "estado" para inativar — cada linha já é, por natureza, um fato consumado.

### Trigger de validação e fechamento automático

```sql
CREATE OR REPLACE FUNCTION validar_devolucao_locacao() RETURNS TRIGGER AS $$
DECLARE
  v_quantidade_total  INTEGER;
  v_ja_devolvido       INTEGER;
  v_data_entregue      DATE;
BEGIN
  SELECT quantidade, data_entregue INTO v_quantidade_total, v_data_entregue
  FROM ferramenta_locacoes WHERE id = NEW.locacao_id;

  IF v_data_entregue IS NOT NULL THEN
    RAISE EXCEPTION 'Esta locação já foi encerrada.';
  END IF;

  SELECT COALESCE(SUM(quantidade), 0) INTO v_ja_devolvido
  FROM ferramenta_locacoes_devolucoes WHERE locacao_id = NEW.locacao_id;

  IF v_ja_devolvido + NEW.quantidade > v_quantidade_total THEN
    RAISE EXCEPTION 'Quantidade devolvida (%) ultrapassa o saldo pendente (%).',
      NEW.quantidade, v_quantidade_total - v_ja_devolvido;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_validar_devolucao_locacao
  BEFORE INSERT ON ferramenta_locacoes_devolucoes
  FOR EACH ROW EXECUTE FUNCTION validar_devolucao_locacao();

CREATE OR REPLACE FUNCTION fechar_locacao_se_completa() RETURNS TRIGGER AS $$
DECLARE
  v_quantidade_total INTEGER;
  v_total_devolvido  INTEGER;
BEGIN
  SELECT quantidade INTO v_quantidade_total
  FROM ferramenta_locacoes WHERE id = NEW.locacao_id;

  SELECT COALESCE(SUM(quantidade), 0) INTO v_total_devolvido
  FROM ferramenta_locacoes_devolucoes WHERE locacao_id = NEW.locacao_id;

  IF v_total_devolvido = v_quantidade_total THEN
    UPDATE ferramenta_locacoes
    SET data_entregue = CURRENT_DATE, entregue_por = NEW.devolvido_por, entregue_em = now()
    WHERE id = NEW.locacao_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_fechar_locacao_se_completa
  AFTER INSERT ON ferramenta_locacoes_devolucoes
  FOR EACH ROW EXECUTE FUNCTION fechar_locacao_se_completa();
```

O `UPDATE` que fecha a locação roda como o mesmo usuário que inseriu a devolução (nenhuma das
duas funções é `SECURITY DEFINER`) — passa normalmente pela policy `floc_update` existente
(`pode_editar_almoxarifado() AND data_entregue IS NULL`), porque nesse momento `data_entregue`
ainda é nulo na linha sendo fechada.

### RLS de `ferramenta_locacoes_devolucoes`

```sql
ALTER TABLE ferramenta_locacoes_devolucoes ENABLE ROW LEVEL SECURITY;

CREATE POLICY flocdev_select ON ferramenta_locacoes_devolucoes FOR SELECT TO authenticated
  USING (pode_editar_almoxarifado());

CREATE POLICY flocdev_insert ON ferramenta_locacoes_devolucoes FOR INSERT TO authenticated
  WITH CHECK (pode_editar_almoxarifado() AND devolvido_por = auth.uid());

CREATE POLICY isolamento_obra ON ferramenta_locacoes_devolucoes AS RESTRICTIVE FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM ferramenta_locacoes fl WHERE fl.id = locacao_id AND pode_acessar_obra(fl.obra_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM ferramenta_locacoes fl WHERE fl.id = locacao_id AND pode_acessar_obra(fl.obra_id)));
```

Isolamento por obra feito via join à locação pai, porque esta tabela não tem `obra_id` próprio —
mesmo princípio de `medicoes_itens`, que também isola indiretamente pelo pai.

### Trava de `quantidade` uma vez que exista devolução

A edição de `quantidade` (dentro do "Editar" já existente, que já só funciona enquanto
`data_entregue IS NULL`) precisa ficar bloqueada assim que a primeira devolução parcial existir —
senão corrige um número que o saldo já usou para validar entregas passadas. Sem trigger novo para
isso: o frontend (§4) simplesmente não permite editar a quantidade quando `totalDevolvido > 0`,
verificado ao carregar a locação para edição. Não é necessário reforçar isso no banco porque o
único caminho de escrita é o próprio formulário — mas caso um teste de campo revele a
necessidade, adicionar um `CHECK` ou trigger de banco fica como ajuste futuro, não bloqueia esta
entrega.

## 4. Frontend

**Renomeação de termos** (`Almoxarifado.tsx`, aba Aluguéis): "Ferramenta" → "Equipamento" em
todos os rótulos, títulos ("Nova locação de equipamento" / "Editar locação de equipamento"),
placeholder ("Ex.: Compactador de solo" continua válido), mensagens de erro e busca ("Buscar por
equipamento ou locadora…"). O nome da aba em si ("Aluguéis") não muda — já era genérico o
suficiente.

**Campo `quantidade`** no `PainelLocacao`: campo numérico obrigatório (`min=1`, `step=1`), ao lado
de "Equipamento *". Validação: precisa ser um inteiro maior que zero.

**Lista (`AbaLocacoes`):** cada linha mostra "{quantidade_devolvida} de {quantidade} devolvido"
(ex.: "0 de 40" numa locação nova, "25 de 40" após uma devolução parcial, some a contagem quando
`data_entregue` já preenchido — nesse caso mostra só "Entregue em {data}" como hoje). Para
calcular isso, a tela carrega `ferramenta_locacoes_devolucoes` junto com as locações abertas e
soma por `locacao_id` no cliente (mesmo padrão de `jaAprovadoPorItem` em `MedicaoForm.tsx`).

**"Registrar entrega" vira um mini-formulário** (não mais um `confirmar()` de uma pergunta só):
pede a quantidade devolvida agora, pré-preenchida com o saldo pendente inteiro (editável para
baixo), com um aviso textual quando o valor digitado for menor que o saldo ("Vai continuar
{saldo} pendente."). Ao confirmar, faz um único `INSERT` em `ferramenta_locacoes_devolucoes` —
sem tocar diretamente em `ferramenta_locacoes` (quem fecha, se for o caso, é o trigger).

**Alertas de vencimento:** continuam usando `data_entrega_prevista` do lote inteiro,
independente de quantas devoluções parciais já aconteceram — só param de contar quando
`data_entregue` (fechamento total) é preenchido pelo trigger.

## 5. Erros e casos de borda

- **Devolver mais do que o saldo pendente:** bloqueado pelo trigger
  (`validar_devolucao_locacao`), com mensagem clara sobre o saldo disponível; o formulário também
  limita o campo no cliente (`max = saldo pendente`) como primeira barreira, mas o banco é quem
  garante de verdade.
- **Duas pessoas registrando devolução da mesma locação ao mesmo tempo:** o trigger recalcula o
  saldo a cada `INSERT`, então a segunda inserção vê o saldo já reduzido pela primeira e é
  validada corretamente (ou rejeitada, se ultrapassar) — não há condição de corrida, porque a
  soma é recomputada dentro do próprio trigger da transação corrente.
- **Locação já entregue (fechada) recebendo uma tentativa de devolução:** bloqueado
  explicitamente no trigger (`data_entregue IS NOT NULL` → exceção), mesmo que por algum motivo o
  frontend permita a chamada.
- **Editar quantidade depois de já ter devolução parcial registrada:** bloqueado no frontend (ver
  §3) — o campo aparece desabilitado com uma explicação, em vez de permitir e gerar
  inconsistência.

## 6. Fora de escopo

- Prazo diferente por devolução parcial (decisão de 22/07/2026 — um prazo só para o lote).
- Qualquer mudança no módulo separado de empréstimo individual de ferramentas
  (`ferramentas`/`ferramenta_emprestimos`).
- Custo/valor da locação (não existe hoje nessa tabela e não foi pedido agora).
- Reverter ou corrigir uma devolução já registrada (fora do MVP — cada linha em
  `ferramenta_locacoes_devolucoes` é permanente; uma correção futura, se necessária, é ajuste
  separado, não faz parte desta entrega).
