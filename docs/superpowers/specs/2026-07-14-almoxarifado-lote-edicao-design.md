# Almoxarifado — lançamento em lote + edição de entrada · Spec de design

> Status: aprovado por Rodrigo em 14/07/2026, aguardando plano de implementação.
> Dois pedidos do Rodrigo após o teste de campo do Almoxarifado: (1) lançar vários insumos da
> mesma nota fiscal de uma vez; (2) admin corrigir ou apagar uma entrada lançada errada.
> "Apagar" já existe (botão "Inativar" no extrato, exclusão lógica, admin only) — falta corrigir.

## 1. Objetivo

- **Lançamento em lote:** ao registrar uma NF com vários insumos, preencher fornecedor/NF/pedido
  de compra uma vez só e lançar N entradas de uma vez, cada uma com seu próprio material,
  quantidade e (opcional) item do pedido de compra vinculado.
- **Editar entrada:** admin corrige quantidade, material, fornecedor ou nº da NF de uma entrada
  já lançada, sem precisar inativar e relançar do zero.

## 2. Achado técnico que precisa ser corrigido primeiro

O trigger `trg_sincroniza_recebimento` (`supabase/migrations/20260711_fase6_almoxarifado.sql`)
hoje só reage a `AFTER INSERT OR UPDATE OF ativo` — ou seja, só soma `quantidade_recebida` do
pedido de compra na criação, e só reverte quando o movimento é inativado. Se a Task de edição
corrigir a `quantidade` (ou trocar o vínculo) de uma entrada já vinculada a um item de pedido, o
`quantidade_recebida` desse item ficaria **errado, travado no valor antigo** — quebrando o
cálculo de status do pedido (`recebido_parcial`/`recebido_total`) e a conferência tripla de
Compras.

**Correção:** generalizar o trigger pra sempre reverter o efeito antigo da linha e aplicar o
efeito novo, cobrindo os três casos (quantidade mudou, vínculo com pedido mudou, ativo mudou)
com a mesma lógica — em vez de tratar cada caso separadamente:

```sql
CREATE OR REPLACE FUNCTION sincroniza_recebimento_pedido()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.tipo = 'entrada' AND NEW.pedido_item_id IS NOT NULL THEN
    UPDATE pedidos_compra_itens
    SET quantidade_recebida = quantidade_recebida + NEW.quantidade
    WHERE id = NEW.pedido_item_id;

  ELSIF TG_OP = 'UPDATE' AND NEW.tipo = 'entrada' THEN
    IF OLD.ativo AND OLD.pedido_item_id IS NOT NULL THEN
      UPDATE pedidos_compra_itens
      SET quantidade_recebida = GREATEST(quantidade_recebida - OLD.quantidade, 0)
      WHERE id = OLD.pedido_item_id;
    END IF;
    IF NEW.ativo AND NEW.pedido_item_id IS NOT NULL THEN
      UPDATE pedidos_compra_itens
      SET quantidade_recebida = quantidade_recebida + NEW.quantidade
      WHERE id = NEW.pedido_item_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
```

Trigger passa a disparar em `AFTER INSERT OR UPDATE OF ativo, quantidade, pedido_item_id`
(antes só `OF ativo`). Este é o mesmo padrão "reverte o antigo, aplica o novo" — mais simples e
mais correto que tratar cada campo separadamente, e cobre de graça qualquer combinação futura.

## 3. Lançamento em lote

Generaliza `PainelEntrada` (`src/pages/Almoxarifado.tsx`) do modelo atual (1 material por
lançamento) para uma lista de insumos — mesmo padrão já usado em Contratos/Compras
(`+ Adicionar item`).

- **Campos compartilhados (topo, iguais a hoje):** Fornecedor (opcional), Nº da NF (opcional),
  Pedido de compra (opcional — ao escolher, carrega os itens desse pedido pra cada insumo poder
  vincular).
- **Cada insumo da lista:** Material* (autocomplete, igual hoje), Quantidade*, Item do pedido
  (dropdown, só aparece se um pedido foi selecionado no topo, escopado aos itens **daquele**
  pedido).
- **Observação** deixa de ser campo comum — se precisar, cada insumo pode ter a sua (campo
  opcional por linha, ao invés de um campo único pro lote inteiro).
- Nenhuma migração de banco necessária aqui — é a mesma tabela (`estoque_movimentos`), só que
  a tela insere N linhas de uma vez (`supabase.from('estoque_movimentos').insert([...])`) em
  vez de uma.
- **Sem transação atômica entre as N linhas** (Postgres/Supabase client não expõe transação
  multi-insert nesse nível): se uma falhar no meio, as anteriores já foram gravadas. Mitigação:
  mostrar claramente ao usuário quantas entradas foram salvas com sucesso antes do erro, sem
  reinserir as que já passaram (mesmo padrão de risco aceito já existente em Contratos/Medições
  para criação em duas etapas — documentado como conhecido, não um requisito novo).

## 4. Editar entrada (admin)

### Colunas novas em `estoque_movimentos`

```sql
ALTER TABLE estoque_movimentos
  ADD COLUMN editado_por UUID REFERENCES perfis_usuario(id),
  ADD COLUMN editado_em  TIMESTAMPTZ;
```

Rastreabilidade (CLAUDE.md §6): toda correção grava quem e quando, sem sobrescrever
`criado_por`/`criado_em` original.

### RLS

`mov_update` já existe e já permite `UPDATE` irrestrito por admin
(`USING (meu_papel() = 'admin') WITH CHECK (meu_papel() = 'admin')`, sem trava de coluna) — não
precisa de migração de RLS nova pra isso. A única migração de banco desta seção é a das duas
colunas novas + a correção do trigger do §2.

### Tela

No extrato do material (`Almoxarifado.tsx`, dentro do `.movLinha`), ao lado do botão
"Inativar" já existente: novo botão **"Editar"**, visível só para admin e só em movimentos
`tipo === 'entrada'` e `ativo === true`. Ao clicar, abre inline (substituindo a linha) um
formulário com Material (autocomplete, pré-preenchido), Quantidade, Fornecedor, Nº da NF —
exatamente os 4 campos que Rodrigo definiu. **Não edita** `pedido_item_id` (fica travado, como
definido). Botão "Salvar" faz o `UPDATE`, seguindo a regra de checar não só `error` mas também
se a linha foi realmente afetada (`.select()` + checar array vazio) — lição já aplicada em
Medições/Compras neste mesmo projeto, pela mesma razão (RLS pode bloquear silenciosamente sem
lançar erro dependendo do caso).

Movimentos do tipo `saida` não ganham botão de editar nesta rodada (fora de escopo — Rodrigo
pediu especificamente "entrada").

## 5. Permissões

Sem mudança de módulo/permissão — tudo dentro do módulo `almoxarifado` já existente. Lançamento
em lote: mesma permissão de hoje (`pode_editar_almoxarifado()` — admin ou equipe com o módulo).
Editar entrada: **exclusivo admin**, como definido.

## 6. Fora de escopo

- Editar/lançar em lote para **saída** de material — não pedido.
- Histórico de versões de uma edição (guardar o valor anterior explicitamente) — só
  `editado_por`/`editado_em` nesta rodada; se precisar de auditoria mais detalhada no futuro,
  revisitar.
- Transação atômica no lançamento em lote — ver §3, risco aceito e documentado.
- Editar o vínculo com pedido de compra (`pedido_item_id`) de uma entrada existente.

## 7. Critérios de aceite

- [ ] Lançar 3 insumos de uma NF só, com fornecedor/NF preenchidos uma vez — 3 linhas aparecem
      no extrato de cada material, todas com o mesmo fornecedor/NF.
- [ ] Um dos insumos do lote vinculado a um item de um pedido de compra — `quantidade_recebida`
      daquele item soma corretamente.
- [ ] Admin edita a quantidade de uma entrada vinculada a um pedido de compra — o
      `quantidade_recebida` do item do pedido reflete a correção (não duplica, não fica com o
      valor antigo).
- [ ] Admin edita quantidade/material/fornecedor/NF de uma entrada **não** vinculada a pedido —
      saldo do(s) material(is) atualiza corretamente (material antigo perde a quantidade,
      material novo ganha, se o material foi trocado).
- [ ] Equipe (não-admin) não vê o botão "Editar" no extrato.
- [ ] Editar não aparece para movimentos do tipo `saida` nem para entradas já inativadas.
- [ ] `editado_por`/`editado_em` gravados após uma edição, `criado_por`/`criado_em` originais
      preservados.
- [ ] Migração versionada em `supabase/migrations`.
- [ ] Rodrigo testou com uma NF real de vários insumos e uma correção real, e deu aceite.
