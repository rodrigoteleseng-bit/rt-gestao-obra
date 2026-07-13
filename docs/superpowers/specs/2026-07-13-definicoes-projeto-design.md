# Definições de Projeto (design)

> Primeiro módulo novo da Fase 7 construído após a análise do FlowPlanner (12/07/2026) — decisões pendentes do cliente/proprietário (cor, modelo, acabamento etc.) com prazo, responsável e status. Aprovado pelo Rodrigo em 13/07/2026 como próxima frente, enquanto ele segue testando Compras/Almoxarifado/Efetivo em campo.

## 1. Objetivo

Registrar decisões que o cliente/proprietário precisa tomar ao longo da obra (ex.: cor da telha, modelo do piso, bancada da cozinha), com prazo e responsável, visível também pro cliente em modo leitura — hoje isso não existe em lugar nenhum do app.

## 2. Decisões (perguntas respondidas com o Rodrigo em 13/07/2026)

- **Visibilidade:** cliente vê a lista (só leitura) — são decisões dele. Quem cria/edita/resolve é admin ou equipe com o módulo `definicoes` habilitado.
- **Vínculo com Unidade:** opcional (mesmo padrão de Pendências) — pode ser uma decisão de um sobrado específico ou uma decisão geral da obra.
- **Local/Ambiente:** campo de texto livre opcional (ex.: "Banheiro suíte"), mesmo padrão já usado no FVS (`local_ambiente`).
- **Disciplina/categoria:** fora de escopo por agora (YAGNI).
- **Status:** 2 estados — `pendente` / `resolvida`. "Vencida" é calculado (`pendente` + `prazo` no passado), não é um status armazenado — mesmo cálculo já usado em `Pendencias.tsx` (`vencida()`).
- **Responsável:** quem precisa decidir (geralmente o nome do cliente/proprietário), não quem da equipe está cobrando.
- **Resolução:** ao marcar como resolvida, registra o que foi decidido (campo de texto `decisao`) — vira histórico.
- **Dashboard:** card próprio, fora dos grupos existentes (não se encaixa em Qualidade/RDO/Suprimentos).
- **Visibilidade do card pro cliente (correção de premissa durante o brainstorming):** `temModulo()` trata `cliente` igual a `equipe` (só libera se o módulo estiver em `modulos_permitidos`), e a tela de Usuários não oferece checkboxes de módulo pra usuários `cliente` — então usar `temModulo('definicoes')` puro esconderia o card do cliente para sempre. Decisão: o card usa uma regra especial de visibilidade — **admin sempre vê, cliente sempre vê, equipe só vê com o módulo habilitado** — mesmo princípio já usado nos sub-itens marcados `sempre: true` em RDO/Cronograma no Dashboard atual.

## 3. Modelo de dados

```sql
CREATE TYPE status_definicao AS ENUM ('pendente', 'resolvida');

CREATE TABLE definicoes_projeto (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  obra_id        UUID NOT NULL REFERENCES obras(id) ON DELETE CASCADE,
  unidade_id     UUID REFERENCES unidades(id),        -- opcional
  titulo         TEXT NOT NULL,                        -- ex: "Cor da telha cerâmica"
  local_ambiente TEXT,                                 -- ex: "Cobertura", "Banheiro suíte"
  descricao      TEXT,                                 -- contexto da decisão
  responsavel    TEXT,                                 -- quem decide (ex: nome do cliente)
  prazo          DATE,
  status         status_definicao NOT NULL DEFAULT 'pendente',
  decisao        TEXT,                                 -- o que foi decidido (preenchido ao resolver)
  resolvida_em   TIMESTAMPTZ,
  resolvida_por  UUID REFERENCES perfis_usuario(id),
  ativo          BOOLEAN NOT NULL DEFAULT true,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now(),
  criado_por     UUID NOT NULL DEFAULT auth.uid() REFERENCES perfis_usuario(id)
);

CREATE INDEX idx_definicoes_unidade ON definicoes_projeto(unidade_id);
```

`ALTER TYPE modulo_app ADD VALUE IF NOT EXISTS 'definicoes';` (mesmo padrão já usado em `20260707_fase7_modulos_extras_enum.sql` pra `medicoes`/`contratos`/`fvs`/etc.) — novo checkbox "Definições de Projeto" na tela de Usuários (`MODULOS_LABELS` em `src/pages/Usuarios.tsx`).

## 4. Permissões e RLS

- **Leitura:** todo mundo (`admin`, `equipe`, `cliente`) — diferente de Pendências, que hoje é só `admin`/`equipe`.
- **Escrita (criar/editar/resolver):** `admin`, ou `equipe` com o módulo `definicoes` habilitado.

```sql
CREATE OR REPLACE FUNCTION pode_editar_definicoes()
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT meu_papel() = 'admin'
    OR (meu_papel() = 'equipe' AND 'definicoes' = ANY(meus_modulos()))
$$;

ALTER TABLE definicoes_projeto ENABLE ROW LEVEL SECURITY;

CREATE POLICY def_select ON definicoes_projeto FOR SELECT
  USING (ativo = true);
CREATE POLICY def_insert ON definicoes_projeto FOR INSERT
  WITH CHECK (pode_editar_definicoes());
CREATE POLICY def_update ON definicoes_projeto FOR UPDATE
  USING (pode_editar_definicoes())
  WITH CHECK (pode_editar_definicoes());
```

## 5. Telas

Uma tela só, `/definicoes` (`src/pages/Definicoes.tsx`), seguindo de perto a estrutura já usada em `src/pages/Pendencias.tsx`:

1. **Lista:** cards com título, unidade/ambiente (quando preenchidos), responsável, prazo, badge de status (Pendente / Resolvida / Vencida — calculado). Filtros por unidade, status e responsável (mesmo padrão de Pendências).
2. **Cliente:** mesma lista, sem botões de criar/editar/resolver — só visualização (`podeEditar = perfil?.papel === 'admin' || temModulo('definicoes')`, mesmo padrão de outras telas do app).
3. **Criar/editar:** formulário com título* (obrigatório), unidade (select opcional), local/ambiente (texto), descrição, responsável, prazo.
4. **Resolver:** ação separada — abre um campo de texto pra descrever a decisão tomada; grava `decisao`, `resolvida_em = now()`, `resolvida_por = auth.uid()`, `status = 'resolvida'`.

## 6. Dashboard

Novo card "Definições de Projeto" em `src/pages/Dashboard.tsx`, fora do array `CARDS_MODULOS` (mesmo padrão já usado pro card "Dados da Obra", que também é um caso especial fora do array), com a regra de visibilidade:

```tsx
perfil?.papel === 'admin' || perfil?.papel === 'cliente' || temModulo('definicoes')
```

## 7. Fora de escopo

- Campo de disciplina/categoria.
- Anexo de foto/referência na decisão (fica pra quando sentir falta).
- Notificação automática de prazo vencendo (isso é o módulo "Alertas" da Fase 7, ainda não construído).
- Qualquer alteração no mecanismo `temModulo()`/`Usuarios.tsx` além de adicionar o novo valor do enum — a regra de visibilidade do cliente é tratada só na condição do card, não numa mudança estrutural de permissões.
