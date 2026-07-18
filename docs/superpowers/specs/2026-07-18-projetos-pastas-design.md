# Modulo Projetos — Pastas — Spec de design

> Status: decisoes principais aprovadas por Rodrigo em 18/07/2026, aguardando plano de implementacao.
> Evolucao do modulo Projetos ja entregue e aceito no mesmo dia (`docs/fase7_projetos.md`,
> `docs/superpowers/specs/2026-07-18-projetos-design.md`) — pedido do Rodrigo apos o primeiro
> teste de campo, antes de cadastrar documentos reais em volume.
> Responsavel pela implementacao futura: Codex. Revisor recomendado: Claude Code, por envolver
> ALTER TABLE em tabela ja em uso, tabela nova e RLS.

## 1. Objetivo

Substituir as 3 categorias fixas do modulo Projetos (`projeto_executivo`, `memorial`,
`administrativo`) por pastas livres, criadas pela propria obra — ex.: "Aprovacao",
"Arquitetura", "Estrutura", "Hidrossanitario". As categorias fixas nao acompanham a realidade
de uma obra, que organiza documentos por disciplina/assunto de forma propria.

## 2. Escopo desta evolucao

Incluido:

- tabela de pastas por obra, com nome, soft delete e autoria;
- criar pasta nova diretamente do formulario de novo documento, sem tela separada;
- renomear e inativar pasta;
- filtro da lista de documentos por pasta, no lugar do filtro por categoria;
- nome de pasta unico por obra (sem diferenciar maiusculas/minusculas), entre pastas ativas;
- migracao automatica: as 3 categorias existentes viram 3 pastas equivalentes, e os
  documentos ja cadastrados sao movidos para elas — nada se perde.

Fora de escopo:

- subpastas (hierarquia de mais de um nivel) — so um nivel de pasta, confirmado com Rodrigo;
- contagem de documentos por pasta na tela;
- reordenar pastas manualmente (ficam em ordem alfabetica);
- tela dedicada de gerenciamento de pastas (o gerenciamento fica embutido na tela de Projetos).

## 3. Regras de negocio

### 3.1 Pasta

- toda pasta pertence obrigatoriamente a uma obra;
- nome obrigatorio, sem duplicidade (case-insensitive) entre pastas ativas da mesma obra;
- pasta pode ser renomeada a qualquer momento por quem tem permissao de escrita no modulo;
- inativar uma pasta (soft delete) nao afeta os documentos que ja estao nela — eles continuam
  visiveis e vinculados a pasta inativa para quem pode editar o modulo, mesma regra de soft
  delete ja usada no restante do app;
- inativar uma pasta nao bloqueia a criacao de novos documentos nela via API direta, mas a UI
  nao oferece mais essa pasta como opcao no formulario de novo documento nem no filtro
  (mesmo padrao usado hoje para `projetos_documentos.ativo`).

### 3.2 Documento

- todo documento pertence obrigatoriamente a uma pasta (`pasta_id` passa a ser obrigatorio,
  substituindo `categoria`);
- ao cadastrar um documento, o usuario escolhe uma pasta existente da obra ou cria uma nova
  ali mesmo, sem sair do formulario;
- trocar a pasta de um documento ja cadastrado continua possivel via edicao (mesmo campo que
  hoje edita categoria).

### 3.3 Migracao dos dados existentes

- para cada obra que ja tiver documentos cadastrados, criar 3 pastas: "Projeto Executivo",
  "Memorial", "Administrativo";
- mover cada documento existente para a pasta correspondente a sua categoria atual
  (`projeto_executivo` → "Projeto Executivo", `memorial` → "Memorial", `administrativo` →
  "Administrativo");
- so depois de todo documento ter uma pasta valida, tornar `pasta_id` obrigatorio e remover a
  coluna `categoria` e o enum `categoria_documento_projeto`.

## 4. Modelo de dados proposto

### 4.1 `projetos_pastas`

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
```

### 4.2 `projetos_documentos` (alteracao)

```sql
ALTER TABLE projetos_documentos ADD COLUMN pasta_id UUID REFERENCES projetos_pastas(id);
-- migracao dos dados existentes (ver 3.3) roda aqui, antes do proximo passo
ALTER TABLE projetos_documentos ALTER COLUMN pasta_id SET NOT NULL;
ALTER TABLE projetos_documentos DROP COLUMN categoria;
DROP TYPE categoria_documento_projeto;
```

Indice `idx_projetos_documentos_categoria` (que usava a coluna removida) e substituido por um
indice equivalente em `pasta_id`.

## 5. Permissoes e RLS

- `projetos_pastas` segue exatamente o mesmo padrao ja usado em `projetos_documentos`:
  isolamento por obra com policy `AS RESTRICTIVE` desde a migracao que cria a tabela; leitura
  liberada a todos os papeis autenticados (inclusive cliente, para poder filtrar/navegar por
  pasta); escrita (criar, renomear, inativar) restrita a `pode_editar_projetos()`;
- nao e preciso criar uma funcao de permissao nova — reaproveita `pode_editar_projetos()` ja
  existente;
- a policy de storage e a de `projetos_revisoes` nao mudam — elas dependem de
  `projetos_documentos`, nao da categoria/pasta.

## 6. Telas e fluxo

### 6.1 Lista de documentos

- filtro por pasta no lugar do filtro por categoria (dropdown com as pastas ativas da obra,
  em ordem alfabetica, mais opcao "Todas");
- card do documento mostra o nome da pasta no lugar do rotulo de categoria.

### 6.2 Novo documento / editar documento

- campo "Pasta": select com as pastas ativas da obra, mais uma opcao "+ Nova pasta" que revela
  um campo de texto para nomear a pasta ali mesmo; ao salvar o documento, a pasta nova (se
  houver) e criada primeiro, depois o documento e vinculado a ela;
- se o nome digitado para a pasta nova já existir (case-insensitive) entre as pastas ativas da
  obra, reaproveitar a pasta existente em vez de tentar criar duplicada (o indice unico do
  banco garante isso; a tela trata o erro e usa a pasta existente ou avisa o usuario).

### 6.3 Gerenciar pastas

- dentro da tela de Projetos (nao uma rota separada): lista simples das pastas da obra com
  botao "Renomear" (abre campo de texto inline) e "Inativar" (com confirmacao via dialogo do
  app, avisando que os documentos da pasta continuam preservados);
- acessivel so para quem tem permissao de escrita no modulo.

## 7. Estados de tela

Prever:

- lista de pastas vazia (obra nova, sem nenhum documento ainda) — formulario de novo documento
  precisa permitir criar a primeira pasta direto;
- erro ao criar pasta com nome duplicado;
- erro ao renomear pasta para um nome ja usado por outra pasta ativa da mesma obra;
- confirmacao antes de inativar pasta.

## 8. Criterios de aceite

- [ ] Documentos existentes (categorias antigas) aparecem nas 3 pastas equivalentes apos a
      migracao, sem perda de dados.
- [ ] Admin e equipe com modulo `projetos` criam pasta nova direto do formulario de documento.
- [ ] Nome de pasta duplicado (case-insensitive) e bloqueado com mensagem clara.
- [ ] Renomear e inativar pasta funcionam, com confirmacao para inativar.
- [ ] Documentos de uma pasta inativada continuam visiveis e preservados para quem pode
      editar o modulo.
- [ ] Cliente ve o filtro por pasta e os nomes de pasta, sem acoes de escrita.
- [ ] Isolamento entre obras preservado nas pastas (RESTRICTIVE desde a migracao inicial).
- [ ] Migracao versionada em `supabase/migrations`.
- [ ] Rodrigo testou com pastas reais e deu aceite.

## 9. Decisoes aprovadas

- pastas livres substituem as 3 categorias fixas;
- so um nivel de pasta, sem subpastas;
- lista de pastas por obra (nao texto livre a cada documento), com nome unico por obra;
- criar pasta nova direto do formulario de documento, sem tela separada;
- documentos existentes migram automaticamente para pastas equivalentes as categorias atuais;
- renomear e inativar pasta fazem parte do MVP desta evolucao.
