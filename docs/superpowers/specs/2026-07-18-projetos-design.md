# Modulo Projetos - Spec de design

> Status: decisoes principais aprovadas por Rodrigo em 18/07/2026, aguardando plano de implementacao.
> Sequencia aprovada em 18/07/2026: Tarefas -> Projetos -> Planejamento lookahead/PPC -> Financeiro por ultimo.
> Responsavel pela implementacao futura: Codex. Revisor recomendado: Claude Code, especialmente por envolver tabela nova, RLS, storage e a segunda excecao de visibilidade do cliente no app.

## 1. Objetivo

Criar um repositorio de documentos da obra com versionamento simples: projetos executivos,
memoriais/especificacoes tecnicas e documentos administrativos/contratuais, hoje dispersos em
WhatsApp, e-mail ou pastas soltas.

Cada documento pode receber varias revisoes ao longo da obra (ex.: planta arquitetonica R00,
depois R01); a revisao mais recente fica marcada como "Atual" e as anteriores continuam
acessiveis para quem tiver permissao.

Exemplos praticos:

- planta baixa do pavimento terreo, atualizada apos uma revisao de projeto;
- memorial descritivo de acabamentos;
- ART, alvara, licencas e contratos assinados digitalizados.

## 2. Escopo do MVP

Incluido:

- lista de documentos por obra, com filtro por categoria e busca por titulo;
- cadastro de documento (titulo + categoria + primeira revisao);
- upload de nova revisao para um documento existente, com a anterior marcada como superada;
- detalhe do documento com historico de revisoes, mais recente primeiro;
- abrir/baixar qualquer revisao (atual ou historica);
- categorias: projeto executivo, memorial/especificacao, administrativo/contratual;
- cliente ve a lista e baixa documentos, em modo leitura;
- admin e equipe com o modulo `projetos` criam documento, sobem revisao, editam
  titulo/categoria/descricao e inativam documento;
- soft delete do documento (todas as revisoes ficam preservadas no banco e no storage).

Fora do MVP:

- data de validade/vencimento e qualquer alerta associado (fica para quando o modulo de
  Alertas existir);
- numeracao automatica de documento (tipo CT-001);
- fluxo de aprovacao ou assinatura do documento;
- formatos alem de PDF (sem imagem avulsa, sem DWG);
- vinculo com unidade/etapa/servico — documento pertence so a obra;
- edicao ou remocao de uma revisao especifica isolada (so o documento inteiro e inativado).

## 3. Regras de negocio

### 3.1 Documento e revisao

- todo documento pertence obrigatoriamente a uma obra;
- todo documento tem pelo menos uma revisao no momento da criacao — nao existe documento
  "vazio";
- o codigo da revisao (ex.: "R00", "Rev. A") e texto livre digitado por quem sobe o arquivo,
  refletindo o que estiver no carimbo do proprio desenho — o app nao tenta gerar nem validar
  sequencia;
- ao subir uma nova revisao, ela vira automaticamente a revisao atual do documento (`atual =
  true`); a revisao anterior passa para `atual = false` na mesma transacao;
- so PDF e aceito no upload;
- revisoes nao sao editadas nem apagadas isoladamente no MVP — se o arquivo errado foi
  enviado, sobe-se uma nova revisao corrigindo.

### 3.2 Categoria

Categorias fixas:

- `projeto_executivo`;
- `memorial`;
- `administrativo`.

Sem subcategoria no MVP (ex.: nao distingue arquitetura de estrutura dentro de
`projeto_executivo`).

### 3.3 Soft delete

- inativar um documento (`ativo = false`) preserva todas as suas revisoes no banco e os
  arquivos no storage — nada e apagado;
- politica de SELECT segue a regra do projeto: usuario que pode editar `projetos` continua
  vendo documento inativo; cliente e equipe sem o modulo deixam de ver assim que `ativo =
  false`.

## 4. Modelo de dados proposto

### 4.1 Enum

```sql
CREATE TYPE categoria_documento_projeto AS ENUM (
  'projeto_executivo',
  'memorial',
  'administrativo'
);
```

### 4.2 `projetos_documentos`

```sql
CREATE TABLE projetos_documentos (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  obra_id     UUID NOT NULL REFERENCES obras(id) ON DELETE CASCADE,
  titulo      TEXT NOT NULL,
  categoria   categoria_documento_projeto NOT NULL,
  descricao   TEXT,
  ativo       BOOLEAN NOT NULL DEFAULT true,
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT now(),
  criado_por  UUID NOT NULL DEFAULT auth.uid() REFERENCES perfis_usuario(id)
);
```

### 4.3 `projetos_revisoes`

```sql
CREATE TABLE projetos_revisoes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  documento_id  UUID NOT NULL REFERENCES projetos_documentos(id) ON DELETE CASCADE,
  revisao       TEXT NOT NULL,
  path          TEXT NOT NULL,          -- caminho no bucket 'projetos'
  observacao    TEXT,
  atual         BOOLEAN NOT NULL DEFAULT true,
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
  criado_por    UUID NOT NULL DEFAULT auth.uid() REFERENCES perfis_usuario(id)
);
```

Trigger `AFTER INSERT ON projetos_revisoes` marca todas as outras revisoes do mesmo
`documento_id` como `atual = false`, garantindo uma unica revisao atual por documento na
mesma transacao do upload — sem depender de duas escritas separadas do cliente.

## 5. Permissoes e RLS

Modulo sugerido no enum `modulo_app`: `projetos`.

Regras:

- leitura (`SELECT`) liberada para todos os papeis, inclusive cliente — segunda excecao
  deliberada do app a regra geral de "cliente nao ve", apos Definicoes de Projeto;
- escrita (criar documento, subir revisao, editar, inativar) restrita a admin e equipe com o
  modulo `projetos`;
- isolamento por obra via `pode_acessar_obra(obra_id)` com policy `AS RESTRICTIVE`, desde a
  migracao inicial (nao como retrofit) — ver achado critico da revisao previa de Tarefas
  (`docs/superpowers/plans/2026-07-18-tarefas.md`) como referencia do padrao esperado;
- soft delete segue a regra aprendida no projeto: policy de SELECT nao pode bloquear a
  visibilidade de um documento inativo para quem pode editar `projetos`.

### 5.1 Storage

- bucket privado `projetos` no Supabase Storage, so PDF (`allowed_mime_types =
  ARRAY['application/pdf']`), limite de tamanho a definir na implementacao (referencia: bucket
  de cotacoes usa 25MB para PDF+imagem; proponho ~20MB so para PDF);
- caminho do objeto usa `obra_id` como primeira pasta, mesmo padrao dos demais buckets do
  app, para reaproveitar a policy `isolamento_obra_storage` ja existente;
- policy de leitura do bucket precisa incluir o papel `cliente` — diferente da maioria dos
  buckets privados do app hoje, que excluem cliente. Precisa de policy propria (nao reaproveitar
  a policy generica que exclui cliente).

## 6. Telas e fluxo

### 6.1 Menu

Entrada no menu principal e lateral:

- modulo: **Projetos**;
- visivel para admin, equipe com o modulo `projetos`, e cliente (cliente sempre ve, por ser
  leitura, sem depender de modulo marcado — mesmo padrao de Definicoes de Projeto).

### 6.2 Lista de documentos

Elementos:

- filtro por categoria;
- busca por titulo;
- botao `Novo documento` (oculto para cliente);
- cards ou tabela responsiva com titulo, categoria, revisao atual, data da revisao atual.

### 6.3 Novo documento

Campos:

- titulo obrigatorio;
- categoria obrigatoria;
- descricao opcional;
- arquivo da primeira revisao (PDF obrigatorio) + codigo da revisao (texto livre, obrigatorio).

### 6.4 Detalhe do documento

Mostra:

- dados principais (titulo, categoria, descricao);
- revisao atual em destaque, com botao de abrir/baixar;
- historico de revisoes anteriores, mais recente primeiro, cada uma com botao de
  abrir/baixar;
- botao `Nova revisao` (arquivo PDF + codigo da revisao + observacao opcional), oculto para
  cliente e para quem nao tem o modulo;
- botao `Editar` (titulo/categoria/descricao) e `Inativar`, ambos ocultos para cliente e para
  quem nao tem o modulo.

## 7. Integracoes futuras

Integracoes planejadas, mas nao obrigatorias no MVP:

- Alertas: documento administrativo vencendo (depende do campo de validade, hoje fora do
  MVP);
- Tarefas: criar tarefa de follow-up a partir de um documento (ex.: "revisar planta X");
- RDO: referenciar um documento de projeto no relato diario.

## 8. Estados de tela

Prever:

- carregando;
- lista vazia;
- filtro sem resultado;
- erro ao subir arquivo (tamanho, formato invalido);
- erro ao salvar;
- confirmacao antes de inativar documento;
- feedback claro apos criar documento, subir revisao, editar ou inativar.

## 9. Criterios de aceite

- [ ] Funciona no desktop e celular.
- [ ] Admin cria documento, sobe revisao, edita, inativa.
- [ ] Equipe com modulo `projetos` cria documento, sobe revisao, edita, inativa.
- [ ] Equipe sem o modulo nao acessa a rota/acoes de escrita.
- [ ] Cliente ve a lista e baixa qualquer revisao, sem ver acoes de escrita.
- [ ] So PDF e aceito no upload; outros formatos sao rejeitados com mensagem clara.
- [ ] Nova revisao vira "Atual" automaticamente; a anterior fica marcada como superada, sem
      desaparecer.
- [ ] Documento sempre pertence a uma obra; isolamento entre obras preservado (RESTRICTIVE
      desde a migracao inicial).
- [ ] Inativar documento preserva todas as revisoes no banco e no storage.
- [ ] Migracao versionada em `supabase/migrations`.
- [ ] Rodrigo testou com documentos reais e deu aceite.

## 10. Decisoes aprovadas para o MVP

- categorias fixas: projeto executivo, memorial, administrativo;
- documento vinculado so a obra, sem unidade/etapa/servico;
- nova revisao substitui a atual automaticamente, historico continua acessivel;
- so PDF aceito;
- titulo livre + categoria, sem numeracao sequencial de documento;
- codigo de revisao digitado pelo usuario, sem geracao automatica;
- sem data de validade/vencimento no MVP;
- cliente ve em modo leitura (segunda excecao do app a regra geral de "cliente nao ve"),
  escrita restrita a admin e equipe com o modulo `projetos`, incluindo a acao de inativar.

Essa versao entrega o repositorio de documentos versionado e prepara terreno para o futuro
modulo de Alertas (data de validade) sem acoplar as duas coisas agora.
