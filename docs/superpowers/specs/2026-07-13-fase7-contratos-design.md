# Fase 7 — Contratos · Spec de design

> Status: aprovado por Rodrigo em 13/07/2026, aguardando plano de implementação.
> Extra da Fase 7 ("Controle de contratos", dependência Fase 6/Compras — já satisfeita).
> Objetivo maior: viabilizar o módulo de **Medições** de empreiteiros (fora de escopo desta spec — ver §7).

## 1. Objetivo

Cadastrar contratos com empreiteiros terceirizados por serviço (ex.: hidráulica, armação,
carpintaria), vinculando cada contrato a itens do orçamento (serviço × unidade), com valor
negociado e status de ciclo de vida. É a base sobre a qual o futuro módulo de Medições vai
lançar execução (% ou quantidade) por item de contrato.

Contexto: a RT opera dois regimes de mão de obra simultâneos — funcionários próprios (medição
de produção individual, sem contrato formal no app) e empreiteiros por serviço (contrato →
medição por item → saldo). Esta spec cobre apenas a parte de **Contratos**; Medições vem depois,
já com esta base pronta para consumir (decisão de Rodrigo em 13/07/2026: dividir em duas specs).

## 2. Modelo de dados

### `empreiteiros` (tabela nova, separada de `fornecedores`)

Decisão: `fornecedores` fica exclusiva de Compras (materiais). Empreiteiro é conceitualmente
diferente (presta mão de obra, não vende material) e ganha cadastro próprio.

```sql
CREATE TABLE empreiteiros (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome          TEXT NOT NULL,
  documento     TEXT,              -- CPF ou CNPJ
  contato       TEXT,
  especialidade TEXT,               -- ex.: "Hidráulica", "Armação"
  pix           TEXT,               -- chave PIX / dados bancários (uso futuro)
  ativo         BOOLEAN NOT NULL DEFAULT true,
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
  criado_por    UUID NOT NULL DEFAULT auth.uid() REFERENCES perfis_usuario(id)
);
```

### `contratos_seq` (contador sequencial por obra, padrão igual a `pedidos_compra_seq`)

```sql
CREATE TABLE contratos_seq (
  obra_id      UUID PRIMARY KEY REFERENCES obras(id),
  ultimo_numero INTEGER NOT NULL DEFAULT 0
);
-- Toda obra começa do zero (CT-001) — não há contratos formais em papel a incorporar
-- (confirmado por Rodrigo em 13/07/2026, diferente do caso de Compras que começou em 065).
```

### `status_contrato` (enum novo)

```sql
CREATE TYPE status_contrato AS ENUM ('rascunho', 'ativo', 'encerrado');
```

O valor `'contratos'` no enum `modulo_app` **já existe** (adicionado preventivamente em
`20260707_fase7_modulos_extras_enum.sql`) — nenhuma migração necessária para isso.

### `contratos` (cabeçalho)

```sql
CREATE TABLE contratos (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  obra_id             UUID NOT NULL REFERENCES obras(id),
  numero              TEXT NOT NULL,          -- "CT-001", gerado por trigger
  empreiteiro_id      UUID NOT NULL REFERENCES empreiteiros(id),
  objeto              TEXT NOT NULL,
  condicao_pagamento  TEXT,
  retencao_pct        NUMERIC(5,2),           -- % retido até conclusão (opcional)
  valor_total         NUMERIC(14,2) NOT NULL DEFAULT 0,  -- somado de contratos_itens
  status              status_contrato NOT NULL DEFAULT 'rascunho',
  ativo               BOOLEAN NOT NULL DEFAULT true,      -- soft delete
  criado_em           TIMESTAMPTZ NOT NULL DEFAULT now(),
  criado_por          UUID NOT NULL DEFAULT auth.uid() REFERENCES perfis_usuario(id)
);
```

### `contratos_itens`

```sql
CREATE TABLE contratos_itens (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contrato_id     UUID NOT NULL REFERENCES contratos(id) ON DELETE CASCADE,
  servico_id      UUID NOT NULL REFERENCES servicos(id),
  unidade_id      UUID NOT NULL REFERENCES unidades(id),
  quantidade      NUMERIC(14,4) NOT NULL,
  valor_unitario  NUMERIC(14,4) NOT NULL,
  valor_total     NUMERIC(14,2) NOT NULL,     -- quantidade × valor_unitario
  ativo           BOOLEAN NOT NULL DEFAULT true,  -- soft delete
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

`contratos.valor_total` é recalculado por trigger sempre que um item de `contratos_itens` é
inserido/alterado/inativado (mesmo padrão de `recalcular_status_pedido()` em Compras).

## 3. Numeração

Trigger `proximo_numero_contrato()` (SECURITY DEFINER), disparado em `BEFORE INSERT` de
`contratos`, análogo a `proximo_numero_pedido()`: lê/incrementa `contratos_seq` por obra e
grava `numero = 'CT-' || lpad(ultimo_numero::text, 3, '0')`. Sem policy de INSERT/UPDATE direta
em `contratos_seq` — só a function escreve.

## 4. Telas

- **`/empreiteiros`** — lista + formulário de cadastro/edição (nome, documento, contato,
  especialidade, PIX). CRUD simples, sem numeração, sem status, soft delete.
- **`/contratos`** — lista com filtro por status e empreiteiro; colunas número, empreiteiro,
  objeto, valor total, status.
- **Novo contrato** — formulário de cabeçalho (empreiteiro — seleciona existente ou cadastra
  na hora, objeto, condição de pagamento, retenção %) seguido da lista de itens (autocomplete
  de serviço do orçamento, igual ao campo "Aplicação" em Compras, + seleção de unidade +
  quantidade + valor unitário negociado). Salva sempre como `rascunho`.
- **Detalhe do contrato** — itens em tabela, mostrando ao lado de cada um o valor unitário do
  orçamento original (`servicos.valor_unit`) para comparação visual com o valor negociado;
  valor total do contrato; botões de ação conforme status:
  - `rascunho`: editar itens/cabeçalho, excluir (soft delete), **Ativar** (admin only).
  - `ativo`: itens somente leitura (contrato ativo é imutável, como pedido de compra
    aprovado), **Encerrar** (admin only).
  - `encerrado`: somente leitura, sem ações.
- Menu: "Contratos" visível para admin e equipe com módulo `contratos`. Cliente não vê a
  entrada de menu nem acessa as rotas.

## 5. Permissões e RLS

- Novo módulo `contratos` (checkbox em Usuários, já existe no enum `modulo_app`).
- `pode_editar_contratos()` — função análoga a `pode_editar_compras()`: `true` para admin, ou
  para equipe com `contratos` no array de módulos do perfil.
- Criar/editar rascunho e cadastrar empreiteiro: admin ou equipe com módulo `contratos`.
- Ativar (`rascunho → ativo`) e Encerrar (`ativo → encerrado`): **exclusivo admin**.
- SELECT em `empreiteiros`, `contratos`, `contratos_itens`: admin e equipe autenticados
  (qualquer módulo — leitura ampla, como em Compras). **Cliente não tem acesso.**
- Regra de soft delete (aprendida em 13/07/2026, `docs/CLAUDE.md` §3): toda policy de SELECT
  que filtra por `ativo = true` inclui desde o início a cláusula
  `OR pode_editar_contratos()`, para não bloquear silenciosamente a inativação.

## 6. Rastreabilidade

Todo registro grava `criado_por` (default `auth.uid()`) e `criado_em`. Ativar/Encerrar contrato
grava autor e timestamp em campos próprios (`ativado_por`/`ativado_em`,
`encerrado_por`/`encerrado_em`) — nada se sobrescreve, seguindo CLAUDE.md §6.

## 7. Fora de escopo (próxima spec)

- **Medições**: lançamento de execução (% ou quantidade) por `contratos_itens`, cálculo de
  saldo, ciclo de pagamento. Consome as tabelas desta spec.
- Vigência (datas de início/fim) e alerta de contrato vencendo — não solicitado nesta rodada;
  pode ser adicionado depois sem quebrar o modelo (coluna nova em `contratos`).
- Anexo do contrato assinado (PDF/foto) — não solicitado nesta rodada.
- Pagamento via PIX direto pelo app — campo `pix` cadastrado agora para uso futuro, sem
  funcionalidade associada ainda.

## 8. Critérios de aceite

- [ ] Funciona no celular e desktop.
- [ ] Admin cria empreiteiro, cria contrato em rascunho, adiciona itens, ativa e encerra.
- [ ] Equipe com módulo `contratos` cria/edita rascunho mas não consegue ativar/encerrar
      (testado sem acesso indevido).
- [ ] Cliente não vê `/contratos` nem `/empreiteiros` no menu nem acessa a rota direto.
- [ ] Numeração sequencial CT-001, CT-002... por obra, sem colisão.
- [ ] Valor total do contrato recalcula automaticamente ao alterar itens.
- [ ] Soft delete de item/contrato não é bloqueado pelo RLS (policy de SELECT já nasce com a
      cláusula `OR pode_editar_contratos()`).
- [ ] Migração versionada em `supabase/migrations`.
- [ ] Rodrigo testou com um contrato real e deu aceite.
