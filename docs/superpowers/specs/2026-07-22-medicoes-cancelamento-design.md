# Medições (empreiteiros) — Cancelar medição aprovada · Spec de design

> Status: aprovado por Rodrigo em 22/07/2026, aguardando plano de implementação.
> Escopo: só o regime empreiteiros de Medições (`/contratos/:id/medicoes`, `/medicoes`). Produção
> própria já tem seu próprio cancelamento (`producao_cancelar_medicao`, 16/07/2026) e não é
> tocada por esta spec.

## 1. Objetivo

Hoje uma medição aprovada é permanente por design — `restringir_status_medicao()` bloqueia
qualquer alteração, inclusive para admin, sem exceção (comentário na própria migração:
"Medição aprovada é permanente: nenhuma alteração... nem para admin"). Isso é correto para
proteger contra edição indevida, mas não cobre o caso real que motivou esta spec: uma medição
aprovada que descreve um pagamento **estimado/incorreto** e precisa deixar de existir para fins
de saldo e de Financeiro, preservando o registro para auditoria.

Caso concreto (22/07/2026): a medição JFC INSTALAÇÕES (`medicoes.id
875f3d53-51b6-4763-9bde-7b4186e0af9d`, contrato `cc2823c3-954a-44d9-8a9a-1f9cb18ce529`, aprovada
em 14/07/2026, R$ 96.448,75 líquidos) foi lançada como aproximação de vários pagamentos reais
enquanto a planilha de histórico não existia. Com a planilha real importada, Rodrigo confirmou
que essa medição não corresponde a nenhum pagamento real da JFC e pediu para descartá-la. A
correção imediata (22/07/2026) inativou manualmente os 17 `lancamentos_financeiros` gerados por
ela (confirmado: 17 linhas `ativo=false`, soma R$ 96.448,75, 0 linhas `ativo=true` restantes) —
mas a própria `medicoes` continua com `status='aprovada'`, sem nenhum sinal visível de que foi
descartada. Esta spec formaliza esse descarte como uma feature de primeira classe, e propõe (§6)
aplicá-la retroativamente a essa mesma medição para fechar o ciclo com auditoria completa.

## 2. Levantamento do estado real

- **Enum atual:** `status_medicao AS ENUM ('rascunho', 'aprovada')` — sem valor de cancelamento.
- **Trigger `restringir_status_medicao()`** (`supabase/migrations/20260713_fase7_medicoes.sql:66-76`):
  bloqueia qualquer update quando `OLD.status = 'aprovada'`, sem exceção alguma.
- **Trigger `validar_saldo_medicao()`** (mesma migração, linhas 142-170): ao aprovar, soma
  `quantidade_periodo` de todos os itens (`ativo=true`) de medições cujo `status = 'aprovada'`
  para o mesmo `contrato_item_id`, e bloqueia se ultrapassar a quantidade contratada. **Filtra por
  `status = 'aprovada'`** — logo, uma medição que deixe de ter esse status simplesmente para de
  contar na soma. Não é preciso tocar em `medicoes_itens` para "devolver o saldo".
- **Aprovação hoje é um `.update()` cru do frontend** (`MedicaoForm.tsx:188-190`), não uma RPC.
- **`lancamentos_financeiros`** (`supabase/migrations/20260721_fase3a_financeiro.sql`) tem
  `ativo BOOLEAN NOT NULL DEFAULT true` e `medicao_item_id UUID REFERENCES medicoes_itens(id)` —
  dá pra localizar e inativar exatamente os lançamentos originados de uma medição.
- **Padrão já existente e validado no app** a seguir de perto: Produção própria
  (`supabase/migrations/20260716_fase7_producao_propria.sql:300-439`) tem
  `status_medicao_producao` incluindo `'cancelada'`, um trigger de transição que permite
  especificamente `aprovada → cancelada` exigindo motivo não vazio, e uma RPC dedicada
  `producao_cancelar_medicao(p_medicao, p_motivo)` (`SECURITY DEFINER`, admin-only). Compras tem
  um padrão mais simples (só enum + `motivo_cancelamento TEXT`, sem reversão de saldo) que não
  serve de referência aqui porque Medições precisa da reversão atômica de saldo + Financeiro.

## 3. Modelo de dados

### `status_medicao` (enum — novo valor)

```sql
ALTER TYPE status_medicao ADD VALUE 'cancelada';
```

Migração própria, sem nenhuma referência ao novo valor na mesma transação (armadilha já
documentada em CLAUDE.md §0 — `ALTER TYPE ... ADD VALUE` não pode conviver com uso do valor na
mesma transação).

### `medicoes` (colunas novas)

```sql
ALTER TABLE medicoes
  ADD COLUMN motivo_cancelamento TEXT,
  ADD COLUMN cancelada_por       UUID REFERENCES perfis_usuario(id),
  ADD COLUMN cancelada_em        TIMESTAMPTZ;
```

### Trigger `restringir_status_medicao()` (alterado)

Passa a permitir especificamente a transição `aprovada → cancelada`, exigindo motivo não vazio.
Qualquer outra alteração numa medição `aprovada` ou `cancelada` continua bloqueada, sem exceção
para admin — preserva a garantia original de imutabilidade para todo o resto.

```sql
CREATE OR REPLACE FUNCTION restringir_status_medicao() RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status = 'aprovada' AND NEW.status = 'cancelada' THEN
    IF NEW.motivo_cancelamento IS NULL OR btrim(NEW.motivo_cancelamento) = '' THEN
      RAISE EXCEPTION 'Motivo do cancelamento é obrigatório.';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status = 'aprovada' THEN
    RAISE EXCEPTION 'Medição aprovada não pode ser alterada.';
  END IF;
  IF OLD.status = 'cancelada' THEN
    RAISE EXCEPTION 'Medição cancelada não pode ser alterada.';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND meu_papel() <> 'admin' THEN
    RAISE EXCEPTION 'Somente o admin pode aprovar uma medição.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

### RPC `medicoes_cancelar_medicao(p_medicao_id UUID, p_motivo TEXT)`

`SECURITY DEFINER`, `search_path = public` (hardening já é regra do projeto para toda função
privilegiada — CLAUDE.md §0), só admin. Atômica: muda o status e reverte o Financeiro na mesma
transação, ou nenhum dos dois.

```sql
CREATE OR REPLACE FUNCTION medicoes_cancelar_medicao(p_medicao_id UUID, p_motivo TEXT)
RETURNS medicoes
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_medicao medicoes;
BEGIN
  IF meu_papel() <> 'admin' THEN
    RAISE EXCEPTION 'Somente o admin pode cancelar uma medição.';
  END IF;
  IF p_motivo IS NULL OR btrim(p_motivo) = '' THEN
    RAISE EXCEPTION 'Motivo do cancelamento é obrigatório.';
  END IF;

  UPDATE medicoes
  SET status = 'cancelada',
      motivo_cancelamento = p_motivo,
      cancelada_por = auth.uid(),
      cancelada_em = now()
  WHERE id = p_medicao_id AND status = 'aprovada'
  RETURNING * INTO v_medicao;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Medição não encontrada ou não está aprovada.';
  END IF;

  UPDATE lancamentos_financeiros
  SET ativo = false
  WHERE ativo = true
    AND medicao_item_id IN (
      SELECT id FROM medicoes_itens WHERE medicao_id = p_medicao_id
    );

  RETURN v_medicao;
END;
$$;
```

Sem policy de UPDATE nova em `medicoes` para esse caso — a RPC (`SECURITY DEFINER`) já faz a
própria checagem de admin e ignora RLS ao escrever; a policy `med_update` existente continua
valendo para os demais updates administrativos normais (nenhum dos quais alcança `cancelada`,
porque o trigger bloqueia qualquer caminho que não seja essa RPC ou uma chamada equivalente com
motivo preenchido).

### RLS de leitura

`med_select` já usa `(ativo = true AND meu_papel() IN ('admin','equipe')) OR pode_editar_medicoes()`
— sem mudança necessária; medições canceladas continuam com `ativo = true`, então continuam
visíveis a todos que já viam medições aprovadas.

## 4. Frontend

**`MedicaoForm.tsx`:** botão "Cancelar medição", visível só quando `ehAdmin && medicao?.status
=== 'aprovada'`. Abre um diálogo de confirmação com campo de texto obrigatório para o motivo
(mesmo padrão visual do `confirmar()` já usado em `aprovar()`, adaptado para pedir texto).
Chama `supabase.rpc('medicoes_cancelar_medicao', { p_medicao_id: medicao.id, p_motivo: motivo
})`. Em caso de erro (motivo vazio, race condition, permissão), mostra a mensagem de erro da RPC
diretamente — sem inventar texto genérico.

Medição cancelada permanece na lista e na tela de detalhe (nunca some), com:
- Selo "Cancelada" (mesma linguagem visual usada em Produção própria/Compras para status
  cancelado — cor neutra/vermelho discreto, não removida da lista).
- Motivo, quem cancelou e quando, exibidos abaixo do cabeçalho da medição.
- Botões de edição/aprovação ocultos (equivalente ao que já acontece com `aprovada`).

Nenhuma outra tela precisa de ajuste: qualquer soma/relatório que hoje filtra
`status = 'aprovada'` já exclui `cancelada` automaticamente, por ser um valor novo e distinto.

## 5. Erros e casos de borda

- **Motivo vazio:** bloqueado em dois lugares — no frontend (não deixa submeter) e na RPC/trigger
  (defesa em profundidade, mesmo padrão do resto do projeto).
- **Corrida (duas abas cancelando a mesma medição, ou cancelando uma que já virou outra coisa):**
  a RPC usa `WHERE ... AND status = 'aprovada'` no UPDATE; se `NOT FOUND`, devolve erro claro em
  vez de silenciosamente não fazer nada.
- **Não-admin chamando a RPC diretamente (bypass de UI):** bloqueado pela checagem explícita de
  `meu_papel()` dentro da própria função, antes de qualquer escrita.
- **Medição em rascunho:** fora de escopo desta feature (decisão de 22/07/2026) — continua
  usando o fluxo de exclusão/inativação já existente para rascunhos, sem o botão novo.

## 6. Retroativo: aplicar à medição JFC que motivou a spec

Depois que a feature estiver no ar, executar `medicoes_cancelar_medicao('875f3d53-51b6-4763-9bde-7b4186e0af9d',
'Medição aproximada, substituída pelos lançamentos reais importados da planilha de histórico em
22/07/2026 — não corresponde a nenhum pagamento real da JFC.')` uma única vez, via SQL direto ou
pela própria tela. Como os 17 lançamentos dessa medição já estão `ativo=false`, o
`UPDATE lancamentos_financeiros` da RPC não altera nada adicional (idempotente) — o efeito
prático é só o `status='cancelada'` + motivo ficarem visíveis na própria medição, fechando a
auditoria que hoje está incompleta (medição ainda mostra `aprovada`, sem nenhum registro de que
foi descartada).

## 7. Fora de escopo

- Cancelamento de medição em rascunho (usa o fluxo de exclusão já existente).
- Qualquer mudança em Produção própria (já tem seu próprio cancelamento).
- Reversão automática do lado do Compras/NF (não se aplica — este é o regime de contrato por
  empreiteiro).
- Notificação/alerta automático quando uma medição é cancelada (módulo de Alertas ainda não
  existe, fora do escopo aprovado atual).
