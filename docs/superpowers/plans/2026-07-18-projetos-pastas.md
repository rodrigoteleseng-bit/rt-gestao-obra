# Modulo Projetos — Pastas - Implementation Plan

> **For agentic workers:** implementar task por task, com commits pequenos. Como envolve ALTER TABLE numa tabela ja em uso (com documentos reais cadastrados), tabela nova e RLS, este plano deve passar por revisao previa do Claude Code em modo somente leitura antes da implementacao.

**Commit-base:** `6a0ca38`

**Responsavel pela implementacao futura:** Codex.

**Revisor previo:** Claude Code, somente leitura.

**Spec de referencia:** `docs/superpowers/specs/2026-07-18-projetos-pastas-design.md`

**Goal:** Substituir as 3 categorias fixas do modulo Projetos por pastas livres criadas por
obra, migrando automaticamente os documentos ja cadastrados para pastas equivalentes, com
criacao de pasta direto do formulario de novo documento e gerenciamento (renomear/inativar)
embutido na tela.

**Architecture:** Nasce a tabela `projetos_pastas` (isolada por obra, mesmo padrao RLS ja
usado no modulo), e `projetos_documentos.categoria` (enum) e substituida por
`projetos_documentos.pasta_id` (FK). A migracao de dados roda dentro da mesma migracao que
cria a tabela e altera a coluna, antes da coluna `pasta_id` virar `NOT NULL`. A UI reaproveita
a pagina existente `src/pages/Projetos.tsx`, sem rota nova.

**Tech Stack:** Supabase/Postgres + RLS; React 19 + TypeScript + Vite 6; CSS modules
existentes.

## Global Constraints

- Pasta pertence obrigatoriamente a uma obra.
- Nome de pasta obrigatorio, unico por obra entre pastas ativas, sem diferenciar
  maiusculas/minusculas (`lower(nome)`).
- Documento passa a exigir `pasta_id` (substitui `categoria`), obrigatorio.
- So um nivel de pasta — sem subpastas.
- Inativar pasta (soft delete) preserva os documentos que estao nela; eles continuam visiveis
  para quem pode editar o modulo, mesma regra de soft delete do resto do app.
- Leitura de pastas liberada a todos os papeis autenticados, inclusive cliente. Escrita
  (criar/renomear/inativar) restrita a `pode_editar_projetos()` — reaproveita a funcao ja
  existente, sem criar helper novo.
- Isolamento por obra em `projetos_pastas` via policy `AS RESTRICTIVE` desde a migracao que
  cria a tabela — nunca como retrofit.
- Migracao dos documentos existentes roda dentro da mesma transacao/migracao que cria a
  tabela e altera a coluna: nenhum documento pode ficar sem `pasta_id` antes da coluna virar
  `NOT NULL`.
- Linhas inseridas por script de migracao (nao por um usuario autenticado) nao podem depender
  de `DEFAULT auth.uid()` para `criado_por` — usar o mesmo padrao ja usado em
  `20260717_isolamento_usuario_obra.sql` (`SELECT id FROM perfis_usuario WHERE papel='admin'
  AND ativo ORDER BY criado_em LIMIT 1`).
- Sem `window.confirm`; usar dialogo existente do app (`useConfirmDialog`).
- Toda resposta de erro do Supabase deve ser tratada na tela.

## Arquivos previstos

- Criar: `supabase/migrations/20260718_projetos_pastas.sql`
- Modificar: `src/lib/supabase.ts`
- Modificar: `src/pages/Projetos.tsx`
- Modificar: `src/pages/Projetos.module.css`, se necessario
- Modificar: documentacao final do modulo, apos implementacao e aceite tecnico

---

## Task 1: Banco — tabela de pastas, RLS e migracao dos dados existentes

**Files:**

- Create: `supabase/migrations/20260718_projetos_pastas.sql`
- Modify: `src/lib/supabase.ts`

**Interfaces:**

- Produces: tabela `projetos_pastas`
- Produces: coluna `projetos_documentos.pasta_id`
- Removes: coluna `projetos_documentos.categoria`, enum `categoria_documento_projeto`

- [ ] **Step 1: Criar a tabela `projetos_pastas`**

```sql
CREATE TABLE projetos_pastas (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  obra_id     UUID NOT NULL REFERENCES obras(id) ON DELETE CASCADE,
  nome        TEXT NOT NULL,
  ativo       BOOLEAN NOT NULL DEFAULT true,
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT now(),
  criado_por  UUID NOT NULL DEFAULT auth.uid() REFERENCES perfis_usuario(id),
  CONSTRAINT projetos_pastas_nome_not_blank CHECK (btrim(nome) <> '')
);

CREATE UNIQUE INDEX idx_projetos_pastas_nome_unico
  ON projetos_pastas(obra_id, lower(nome)) WHERE ativo;
CREATE INDEX idx_projetos_pastas_obra ON projetos_pastas(obra_id) WHERE ativo;
```

- [ ] **Step 2: RLS de `projetos_pastas`**

```sql
ALTER TABLE projetos_pastas ENABLE ROW LEVEL SECURITY;

CREATE POLICY isolamento_obra ON projetos_pastas AS RESTRICTIVE FOR ALL TO authenticated
  USING (pode_acessar_obra(obra_id))
  WITH CHECK (pode_acessar_obra(obra_id));

CREATE POLICY projetos_pastas_select ON projetos_pastas FOR SELECT TO authenticated
  USING (ativo = true OR pode_editar_projetos());
CREATE POLICY projetos_pastas_insert ON projetos_pastas FOR INSERT TO authenticated
  WITH CHECK (pode_editar_projetos());
CREATE POLICY projetos_pastas_update ON projetos_pastas FOR UPDATE TO authenticated
  USING (pode_editar_projetos())
  WITH CHECK (pode_editar_projetos());
```

Reaproveita `pode_editar_projetos()` ja existente — nao criar funcao de permissao nova.

- [ ] **Step 3: Seed das pastas equivalentes as categorias existentes**

```sql
INSERT INTO projetos_pastas (obra_id, nome, criado_por)
SELECT DISTINCT d.obra_id,
  CASE d.categoria
    WHEN 'projeto_executivo' THEN 'Projeto Executivo'
    WHEN 'memorial' THEN 'Memorial'
    WHEN 'administrativo' THEN 'Administrativo'
  END,
  (SELECT id FROM perfis_usuario WHERE papel = 'admin' AND ativo ORDER BY criado_em LIMIT 1)
FROM projetos_documentos d;
```

Se `projetos_documentos` estiver vazia (obra nova sem documentos ainda), este `INSERT` afeta
zero linhas — sem erro.

- [ ] **Step 4: Adicionar `pasta_id`, migrar os documentos existentes, remover `categoria`**

```sql
ALTER TABLE projetos_documentos ADD COLUMN pasta_id UUID REFERENCES projetos_pastas(id);

UPDATE projetos_documentos d
SET pasta_id = p.id
FROM projetos_pastas p
WHERE p.obra_id = d.obra_id
  AND p.nome = CASE d.categoria
    WHEN 'projeto_executivo' THEN 'Projeto Executivo'
    WHEN 'memorial' THEN 'Memorial'
    WHEN 'administrativo' THEN 'Administrativo'
  END;

ALTER TABLE projetos_documentos ALTER COLUMN pasta_id SET NOT NULL;

DROP INDEX IF EXISTS idx_projetos_documentos_categoria;
CREATE INDEX idx_projetos_documentos_pasta ON projetos_documentos(obra_id, pasta_id) WHERE ativo;

ALTER TABLE projetos_documentos DROP COLUMN categoria;
DROP TYPE categoria_documento_projeto;
```

**Ordem importa:** `pasta_id` so pode virar `NOT NULL` depois do `UPDATE` ter preenchido todo
documento existente. As policies de `projetos_documentos` (`projetos_documentos_select` etc.)
nao referenciam `categoria`, entao nao precisam ser recriadas — conferir isso na revisao antes
de aplicar.

- [ ] **Step 5: Tipos TypeScript**

Em `src/lib/supabase.ts`:

- Remover o tipo `CategoriaDocumentoProjeto`.
- Em `ProjetoDocumento`, trocar o campo `categoria: CategoriaDocumentoProjeto` por
  `pasta_id: string`.
- Adicionar:

```typescript
export interface ProjetoPasta {
  id: string
  obra_id: string
  nome: string
  ativo: boolean
  criado_em: string
  criado_por: string
}
```

- [ ] **Step 6: Build**

```bash
npm run build
```

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260718_projetos_pastas.sql src/lib/supabase.ts
git commit -m "feat: substitui categorias fixas por pastas em projetos"
```

---

## Task 2: UI — filtro por pasta e novo documento com pasta (existente ou nova)

**Files:**

- Modify: `src/pages/Projetos.tsx`
- Modify: `src/pages/Projetos.module.css`, se necessario

**Interfaces:**

- Consumes: `ProjetoPasta`, `ProjetoDocumento` (com `pasta_id`).

- [ ] **Step 1: Carregar pastas da obra**

Junto do `carregar()` existente, buscar `projetos_pastas` ativas da obra
(`.eq('obra_id', obraAtiva.id).eq('ativo', true).order('nome')`), guardar em estado.

- [ ] **Step 2: Filtro por pasta**

Trocar o filtro de categoria por um filtro de pasta: select com as pastas ativas da obra em
ordem alfabetica, mais opcao "Todas". Atualizar `documentosFiltrados` para comparar
`doc.pasta_id` em vez de `doc.categoria`.

- [ ] **Step 3: Exibir nome da pasta no card e no detalhe**

Trocar toda referencia a `CATEGORIA_LABEL[doc.categoria]` por uma busca do nome da pasta a
partir de `pasta_id` (usar um `Map` de pastas por id, mesmo padrao ja usado em
`usuarioPorId`/`etapaPorId` em `Tarefas.tsx`).

- [ ] **Step 4: Campo de pasta no formulario de novo documento**

Substituir o select de categoria por:

- select com as pastas ativas da obra;
- opcao especial "+ Nova pasta", que ao ser escolhida revela um campo de texto para digitar o
  nome da pasta nova;
- validacao: se "+ Nova pasta" estiver selecionada, o campo de texto e obrigatorio.

- [ ] **Step 5: Criar documento com pasta nova, se for o caso**

No fluxo de salvar documento novo (`salvarNovo`), antes do `INSERT` em `projetos_documentos`:

1. Se o usuario escolheu uma pasta existente, usar o `id` dela direto.
2. Se o usuario digitou uma pasta nova: tentar `INSERT` em `projetos_pastas` com o nome
   digitado. Se o `INSERT` falhar por violacao do indice unico (nome ja existe, case
   insensitive — pode acontecer se outra pessoa criou a mesma pasta entre o carregamento da
   tela e o salvamento), buscar a pasta existente com esse nome
   (`.ilike('nome', nomeDigitado)`) e usar o `id` dela, avisando o usuario que a pasta ja
   existia e foi reaproveitada.
3. Usar o `pasta_id` resolvido (existente, nova, ou reaproveitada) no `INSERT` do documento.

Recarregar a lista de pastas (`carregar()` ja cobre isso) apos criar uma pasta nova, para que
ela apareca no filtro e nas proximas telas sem precisar de F5.

- [ ] **Step 6: Editar documento — trocar de pasta**

No formulario de edicao (`salvarEdicao`), trocar o campo de categoria pelo mesmo select de
pasta do Step 4 (sem a opcao de criar pasta nova ali — se precisar de pasta nova, criar via
novo documento ou via gerenciamento de pastas do Task 3 primeiro).

- [ ] **Step 7: Build**

```bash
npm run build
```

- [ ] **Step 8: Commit**

```bash
git add src/pages/Projetos.tsx src/pages/Projetos.module.css
git commit -m "feat: adiciona filtro e cadastro de documento por pasta"
```

---

## Task 3: UI — gerenciar pastas (renomear, inativar)

**Files:**

- Modify: `src/pages/Projetos.tsx`
- Modify: `src/pages/Projetos.module.css`, se necessario

**Interfaces:**

- Consumes: `ProjetoPasta`.

- [ ] **Step 1: Painel de gerenciar pastas**

Dentro da propria tela de Projetos (nao uma rota nova), um botao/link "Gerenciar pastas"
(visivel so para quem `podeEditar`) que abre uma lista simples das pastas ativas da obra, cada
uma com:

- nome atual;
- botao "Renomear" — abre um campo de texto inline, salva com `UPDATE projetos_pastas SET
  nome = ... WHERE id = ...`;
- botao "Inativar" — confirmacao via `useConfirmDialog` avisando que os documentos da pasta
  continuam preservados e visiveis para quem edita o modulo; `UPDATE projetos_pastas SET ativo
  = false WHERE id = ...`.

- [ ] **Step 2: Tratar erro de nome duplicado ao renomear**

Se o `UPDATE` de renomear falhar por violacao do indice unico (outra pasta ativa da obra ja
tem esse nome), exibir mensagem clara ("Ja existe uma pasta com esse nome").

- [ ] **Step 3: Recarregar apos renomear/inativar**

Chamar `carregar()` apos qualquer renomeacao ou inativacao, para refletir no filtro, no
formulario de novo documento e nos cards já exibidos.

- [ ] **Step 4: Build**

```bash
npm run build
```

- [ ] **Step 5: Commit**

```bash
git add src/pages/Projetos.tsx src/pages/Projetos.module.css
git commit -m "feat: adiciona gerenciamento de pastas em projetos"
```

---

## Task 4: Validacao final, deploy e documentacao

**Files:**

- Modify: `docs/fase7_projetos.md`
- Modify: `AGENTS.md` e `CLAUDE.md`, se a evolucao for entregue para teste real

- [ ] **Step 1: Build final**

```bash
npm run build
```

- [ ] **Step 2: Teste manual desktop**

1. Abrir `/projetos` como admin — os 2 documentos ja cadastrados devem aparecer nas pastas
   "Projeto Executivo"/"Administrativo" (conforme a categoria que tinham antes).
2. Criar documento novo escolhendo uma pasta existente.
3. Criar documento novo criando uma pasta nova ali mesmo (ex.: "Hidrossanitario").
4. Tentar criar uma pasta com nome ja usado (variando maiusculas/minusculas) e confirmar que
   reaproveita a pasta existente em vez de duplicar.
5. Filtrar a lista por pasta.
6. Renomear uma pasta e confirmar que o nome atualiza em todo lugar (filtro, cards, detalhe).
7. Inativar uma pasta com documento dentro e confirmar que o documento continua visivel e
   acessivel para admin.
8. Editar um documento e trocar de pasta.

- [ ] **Step 3: Teste manual celular**

1. Repetir o fluxo de criar documento com pasta nova no PWA/mobile.
2. Conferir que o select de pasta e o campo de nova pasta nao quebram o layout (aplicar
   `min-width: 0` se usar grid, mesma licao do bug de Tarefas/Projetos).

- [ ] **Step 4: Teste de permissao**

1. Admin: cria pasta, renomeia, inativa, cria documento em qualquer pasta.
2. Equipe com `projetos`: mesmas acoes que admin.
3. Equipe sem `projetos`: nao acessa a pagina.
4. Cliente: ve o filtro por pasta e os nomes de pasta, sem nenhum botao de escrita
   (Nova pasta, Renomear, Inativar).

- [ ] **Step 5: Teste de isolamento entre obras**

1. Confirmar que pastas de uma obra nao aparecem no filtro nem no formulario de outra obra.

- [ ] **Step 6: Revisar diff final**

```bash
git diff --check
git status --short --branch
```

- [ ] **Step 7: Commit de documentacao**

```bash
git add docs/fase7_projetos.md AGENTS.md CLAUDE.md
git commit -m "docs: registra pastas no modulo projetos"
```

- [ ] **Step 8: Publicar e verificar deploy**

```bash
git push
```

Verificar app publicado na Vercel e confirmar que `/projetos` carrega com o novo filtro por
pasta.

---

## Prompt para revisao previa do Claude Code

```text
Leia integralmente CLAUDE.md, docs/colaboracao-codex-claude.md,
docs/sequencia-trabalho-codex-claude.md,
docs/superpowers/specs/2026-07-18-projetos-pastas-design.md e
docs/superpowers/plans/2026-07-18-projetos-pastas.md.

Responsavel pela implementacao futura: Codex.
Sua atuacao nesta etapa e SOMENTE LEITURA: nao altere arquivos, nao aplique migracoes,
nao faca commit, push ou deploy.

Escopo a revisar: evolucao do modulo Projetos — substitui as 3 categorias fixas por pastas
livres por obra, com migracao automatica dos documentos ja cadastrados (2 documentos reais
existem hoje), criacao de pasta direto do formulario de novo documento, renomear/inativar
pasta.

Commit-base: 6a0ca38.

Revise o plano antes da implementacao verificando:
1. seguranca da migracao de dados (nenhum documento pode ficar sem pasta antes de pasta_id
   virar NOT NULL; comportamento se projetos_documentos estiver vazia);
2. RLS e isolamento por obra em projetos_pastas;
3. permissao admin/equipe/cliente, incluindo leitura de pastas liberada ao cliente;
4. tratamento de nome de pasta duplicado (indice unico + UI);
5. se as policies existentes de projetos_documentos precisam de ajuste apos a troca de
   categoria por pasta_id;
6. ordem das operacoes do Task 1 Step 4 (adicionar coluna, migrar dados, tornar NOT NULL,
   remover coluna antiga, remover enum);
7. riscos de regressao mobile;
8. criterios de aceite.

Classifique achados como critico, alto, medio ou baixo. Para cada achado, informe
arquivo/trecho do plano ou spec, evidencia, impacto, correcao recomendada e teste de
validacao. Diferencie defeito comprovado de sugestao.
```
