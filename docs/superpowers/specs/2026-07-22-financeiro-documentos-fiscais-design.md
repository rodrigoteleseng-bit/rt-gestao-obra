# Financeiro — Documentos fiscais e anexos · Spec de design (PROPOSTA)

> Status: **proposta técnica do Claude Code, ainda NÃO aprovada por Rodrigo.** Não implementar.
> Este documento nasce da análise crítica de
> `docs/superpowers/specs/2026-07-22-financeiro-notas-fiscais-insumo.md` (ideia inicial de
> Rodrigo, não uma spec) — ver a análise completa entregue em conversa antes deste arquivo para o
> raciocínio por trás de cada decisão abaixo. Depende de respostas às perguntas do §8 antes de
> virar spec aprovada. Depois de aprovada, ainda falta o plano de implementação (não escrito
> aqui) antes de qualquer entrega ao Codex.
>
> Escopo: só a **primeira entrega** (anexos genéricos, sem parsing). XML de NF-e, OCR/PDF e
> integração com Drive ficam para specs futuras, com sua própria aprovação — ver §7.

## 1. Objetivo desta primeira entrega

Permitir anexar documentos fiscais e comprovantes (PDF, imagem, XML) a lançamentos do livro
financeiro (Fase 3a, já entregue) — tanto lançamentos novos quanto já existentes, incluindo os
que vierem da futura importação de histórico — sem nenhuma leitura automática de dado ainda. O
valor imediato é rastreabilidade (o lançamento mostra o documento de origem) e preparação de
terreno para a leitura automática de XML numa entrega seguinte, não a automação em si.

## 2. Por que a primeira entrega não inclui parsing

A ideia original (`2026-07-22-financeiro-notas-fiscais-insumo.md`) já recomendava não começar
por IA/OCR, e essa spec vai um passo além: nem XML entra na primeira entrega. Motivo prático —
o valor de rastreabilidade (achar o documento que originou um lançamento, nunca perder o arquivo,
nunca ter dois lugares diferentes guardando o mesmo anexo) já é entregue só com upload+vínculo,
com uma fração do risco de RLS/Storage/trigger que a leitura automática exigiria. Parsing de XML
some risco de duplicidade de nota, mas só depois que o modelo de anexo estiver estável em uso
real — não dá pra validar detecção de duplicidade num fluxo que ninguém usou ainda.

## 3. Estado real levantado (base de toda decisão abaixo)

- **Compras já tem um mecanismo de anexo fiscal, restrito a pedidos:** `recebimentos_nf`
  (`pedido_id`, `anexo_nf_url` apontando para o bucket privado `cotacoes-nf`, `observacao`) é
  gravado por `registrarNf()` em `CompraForm.tsx` sempre que uma NF é conferida. **Este mecanismo
  já existe e já funciona** — a nova entrega não deve duplicá-lo, deve reconciliar com ele (§6).
- **`lancamentos_financeiros` (Fase 3a) já tem a FK tipada por origem** —
  `medicao_item_id`/`pedido_item_id`, um lançamento **por item**, não por nota. Um pedido de
  compra com 3 itens gera 3 `lancamentos_financeiros` diferentes quando a NF é conferida
  (`financeiro_ingerir_compra_item()`, uma execução por item) — **uma única NF real vai
  precisar se vincular a vários lançamentos**, não um só. Isso não é hipótese, é consequência
  direta do schema já commitado.
- **`fornecedores.cnpj` já existe** (`TEXT`, nullable, sem índice único) — usado hoje só como
  campo informativo, nunca validado ou usado para achar fornecedor existente.
- **Storage RLS é centralizada, não por bucket isolado:** existe uma única policy
  `isolamento_obra_storage` (RESTRICTIVE, `storage.objects`) com uma lista fechada de buckets
  (`rdo`, `fvs`, `pendencias`, `cotacoes-nf`, `projetos`) e um `CASE` por bucket que resolve o
  `obra_id` a partir do primeiro segmento do path (direto para a maioria, via join a
  `pedidos_compra` para `cotacoes-nf`). **Um bucket novo precisa entrar nesta mesma policy — não
  numa policy isolada** — esse arquivo (`20260718_projetos.sql`, que reescreveu essa policy pela
  última vez) já teve dois incidentes de produção em 2026 (regex de UUID rejeitando o
  `obra_id` da obra piloto em 17–18/07, corrigido só depois que um upload real falhou em
  silêncio) — qualquer edição futura nele precisa de teste explícito com o `obra_id` real da
  obra piloto antes do deploy, não só em teoria.
- **`projetos_documentos`/`projetos_revisoes`** (Fase 7, 18/07/2026) é o precedente mais próximo
  de "repositório de documento versionado com histórico" já existente e testado no projeto —
  entidade própria (não campos soltos numa tabela de negócio), bucket privado dedicado,
  isolamento por obra via join à entidade pai. A arquitetura desta spec (§5) segue o mesmo
  molde, adaptado para N:N em vez de 1:N (uma nota pode cobrir vários lançamentos; um documento
  em Projetos pertence a um único documento pai).
- **Nenhuma tabela do projeto hoje tem `UNIQUE` sobre um identificador fiscal** (chave de acesso,
  número de nota) — duplicidade de nota real não tem nenhuma defesa no banco hoje, só na atenção
  de quem digita.

## 4. Riscos identificados (o que a ideia original não cobria)

1. **Duplicação de fonte de verdade com `recebimentos_nf`** — se o novo módulo criar seu próprio
   jeito de anexar NF sem se integrar ao que já existe em Compras, a mesma nota pode acabar
   anexada duas vezes em dois lugares diferentes do app, cada um com sua cópia do arquivo.
2. **Storage RLS não é "criar bucket, criar policy nova"** — é editar uma policy central já
   historicamente frágil (dois incidentes reais em 2026). Maior risco técnico desta entrega.
3. **1 NF real ≠ 1 lançamento** — o vínculo tem que ser N:N desde o primeiro dia (a ideia
   original já propôs isso em §12, mas vale reforçar que não é opcional, é consequência do
   schema já existente).
4. **Duplicidade de nota fiscal não tem nenhuma trava hoje** — sem `UNIQUE` por
   `(obra_id, chave_acesso)`, nada impede a mesma NF-e de ser cadastrada duas vezes, mesmo sem
   nenhum parsing automático (o campo pode ser digitado duas vezes por engano).
5. **Histórico importado (Fase 3a §10) não tem XML nem chave de acesso** — quando o Rodrigo
   quiser, no futuro, anexar as NFs reais do Drive aos lançamentos já importados da planilha, o
   vínculo é sempre manual (documento → lançamento já existente), nunca automático. A tela
   precisa suportar "anexar a um lançamento que já existe" como fluxo de primeira classe, não só
   "documento cria lançamento novo".
6. **NF-e (produto) e NFS-e (serviço) têm estruturas de XML diferentes, e NFS-e não tem layout
   nacional único** (cada prefeitura define o próprio XSD) — relevante só quando XML entrar em
   escopo (não nesta entrega), mas já vale registrar que vai precisar de dois parsers
   independentes, não um genérico, e que a cobertura de NFS-e será sempre menos confiável.
7. **Lançamento pago é imutável (`lf_update` trava fora de `a_pagar`, Fase 3a §6)** — um
   documento pode chegar depois do lançamento já estar pago; o anexo ainda deve poder acontecer
   (documento não é um campo de `lancamentos_financeiros`, é uma entidade própria vinculada), mas
   sem alterar nenhum dado do lançamento já pago. Precisa ser um comportamento explícito, não uma
   trava descoberta de surpresa em produção.

## 5. Arquitetura proposta

### `financeiro_documentos` (entidade própria, não campos soltos em `lancamentos_financeiros`)

```sql
CREATE TYPE tipo_documento_financeiro AS ENUM ('nf_pdf', 'nf_xml', 'imagem', 'boleto', 'comprovante', 'outro');
CREATE TYPE status_documento_financeiro AS ENUM ('pendente', 'lido', 'erro', 'confirmado');

CREATE TABLE financeiro_documentos (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  obra_id         UUID NOT NULL REFERENCES obras(id) ON DELETE CASCADE,
  tipo            tipo_documento_financeiro NOT NULL,
  path            TEXT NOT NULL,                    -- caminho no bucket privado novo
  numero_documento TEXT,
  chave_acesso    TEXT,                              -- só preenchido manualmente nesta entrega
  cnpj_fornecedor TEXT,
  data_emissao    DATE,
  status          status_documento_financeiro NOT NULL DEFAULT 'pendente',
  observacao      TEXT,
  ativo           BOOLEAN NOT NULL DEFAULT true,
  criado_por      UUID NOT NULL DEFAULT auth.uid() REFERENCES perfis_usuario(id),
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_financeiro_documentos_chave_unica
  ON financeiro_documentos(obra_id, chave_acesso)
  WHERE chave_acesso IS NOT NULL;
```

Sem `dados_extraidos_json`/parsing nesta entrega — essas colunas só fazem sentido junto do
parser (spec futura). `status` nasce simplificado: `pendente` (upload feito, nada revisado),
`confirmado` (usuário já preencheu os campos acima manualmente e considera correto). `lido`/`erro`
só passam a existir quando houver leitura automática — a coluna já nasce com esses valores no
enum para não precisar de `ALTER TYPE` depois (mesma lição já registrada em AGENTS.md sobre não
adicionar valor de enum em cima de código que já o referencia).

### `financeiro_documentos_lancamentos` (N:N)

```sql
CREATE TABLE financeiro_documentos_lancamentos (
  documento_id   UUID NOT NULL REFERENCES financeiro_documentos(id) ON DELETE CASCADE,
  lancamento_id  UUID NOT NULL REFERENCES lancamentos_financeiros(id) ON DELETE CASCADE,
  criado_por     UUID NOT NULL DEFAULT auth.uid() REFERENCES perfis_usuario(id),
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (documento_id, lancamento_id)
);
```

Um documento pode vincular vários lançamentos (NF de pedido com N itens); um lançamento pode ter
vários documentos (NF + comprovante de pagamento, por exemplo).

### RLS

Mesmo padrão de `pode_editar_financeiro()` já existente (Fase 3a) — nenhuma função nova de
permissão, cliente nunca vê (mesmo padrão do resto do Financeiro, ver §8 pergunta 4 para
confirmar isso permanece assim).

```sql
ALTER TABLE financeiro_documentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE financeiro_documentos_lancamentos ENABLE ROW LEVEL SECURITY;

CREATE POLICY fdoc_select ON financeiro_documentos FOR SELECT TO authenticated
  USING (pode_editar_financeiro());
CREATE POLICY fdoc_insert ON financeiro_documentos FOR INSERT TO authenticated
  WITH CHECK (pode_editar_financeiro() AND criado_por = auth.uid());
CREATE POLICY fdoc_update ON financeiro_documentos FOR UPDATE TO authenticated
  USING (pode_editar_financeiro()) WITH CHECK (pode_editar_financeiro());

CREATE POLICY isolamento_obra ON financeiro_documentos AS RESTRICTIVE FOR ALL TO authenticated
  USING (pode_acessar_obra(obra_id)) WITH CHECK (pode_acessar_obra(obra_id));

CREATE POLICY fdoclanc_select ON financeiro_documentos_lancamentos FOR SELECT TO authenticated
  USING (pode_editar_financeiro());
CREATE POLICY fdoclanc_insert ON financeiro_documentos_lancamentos FOR INSERT TO authenticated
  WITH CHECK (pode_editar_financeiro());

CREATE POLICY isolamento_obra ON financeiro_documentos_lancamentos AS RESTRICTIVE FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM financeiro_documentos d WHERE d.id = documento_id AND pode_acessar_obra(d.obra_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM financeiro_documentos d WHERE d.id = documento_id AND pode_acessar_obra(d.obra_id)));
```

Sem `UPDATE`/`DELETE` em `financeiro_documentos_lancamentos` — o vínculo, uma vez feito, não
muda (desfazer um vínculo errado é remover a linha via suporte/admin direto no banco por ora, não
uma ação de tela nesta entrega — mesma lógica de "não inventar fluxo que não foi pedido").

### Storage

Bucket novo `financeiro-documentos`, privado, com `file_size_limit`/`allowed_mime_types` no
mesmo padrão já usado (`application/pdf`, `image/*`, e adicionar `text/xml`/`application/xml`
para preparar a próxima entrega mesmo sem parser ainda — aceitar o arquivo já, ler depois).

**Precisa editar a migração existente que define `isolamento_obra_storage`** (não criar uma
policy paralela) — adicionar `financeiro-documentos` à lista de buckets cobertos e um novo `WHEN`
no `CASE`, resolvendo `obra_id` via `financeiro_documentos.obra_id` a partir do primeiro segmento
do path (mesmo padrão usado para `rdo`/`fvs`/`pendencias`/`projetos`, já que aqui o `obra_id`
está direto na tabela, sem precisar de join indireto como `cotacoes-nf`).

## 6. Integração com o que já existe

- **`lancamentos_financeiros`:** nenhuma mudança de schema. O vínculo é só pela tabela N:N nova —
  preserva o `origem_unica` da Fase 3a sem tocar nele.
- **Compras / `recebimentos_nf`:** **não duplicar.** Nesta entrega, o fluxo de conferência de NF
  em Compras continua exatamente como está (grava em `recebimentos_nf`/`cotacoes-nf`) — o
  `financeiro_documentos` novo é para o resto dos casos (lançamento avulso, histórico, comprovante
  de pagamento). Reconciliar os dois é trabalho de uma spec futura (ex.: `recebimentos_nf` passar
  a referenciar `financeiro_documentos` em vez de guardar o path direto) — misturar os dois
  agora aumentaria o escopo e o risco desta entrega sem necessidade.
- **Pedidos de compra:** um pedido com N itens continua gerando N `lancamentos_financeiros`
  (comportamento já commitado da Fase 3a, sem mudança); quando/se o anexo de NF migrar para cá,
  o mesmo documento se vincula aos N lançamentos via a tabela N:N.
- **Fila "a classificar":** documento pode se vincular a um lançamento que está na fila
  (`etapa_id`/`servico_id` `NULL`) — o anexo não resolve a classificação sozinho, só dá contexto
  visual pra quem for classificar depois (mostrar a NF ao lado do campo de aplicação).
  Confirmado: a fila já existe e não precisa de nenhuma mudança para aceitar isso.
- **Importação futura de histórico:** o vínculo "documento → lançamento já existente" (não só
  "documento cria lançamento novo") é obrigatório nesta entrega, especificamente por causa do
  histórico (ver §4, risco 5).

## 7. Fases futuras (fora desta entrega, cada uma com spec própria)

- **XML de NF-e** — parser estruturado, alta confiabilidade, ativa a detecção de duplicidade por
  `chave_acesso` de verdade (preenchimento automático em vez de manual).
- **XML de NFS-e** — parser separado, por prefeitura, cobertura parcial esperada.
- **PDF/imagem com OCR/IA** — sempre como sugestão revisável, nunca grava lançamento sem
  confirmação humana (irrenunciável, CLAUDE.md §6.3).
- **Integração com Drive** — só depois que o fluxo de upload manual estiver validado em uso real.

## 8. Perguntas que precisam de decisão do Rodrigo antes de aprovar esta spec

1. CNPJ de fornecedor deve virar campo com índice único (hoje é livre, sem trava) — quer essa
   trava já nesta entrega ou fica para quando o parsing de XML existir?
2. Confirma que uma NF pode mesmo cobrir vários lançamentos (itens diferentes do mesmo pedido) na
   prática, ou geralmente cada NF já corresponde a um único item/lançamento na sua rotina?
3. As NFs no Drive têm alguma organização por pasta/nome que ajudaria um importador em lote
   futuro, ou estão soltas?
4. Confirma que documentos fiscais nunca ficam visíveis para o papel `cliente`, nem numa futura
   visão agregada (Fase 3b)?
5. NFS-e de empreiteiro (que já passa por Contrato → Medição, não por Compras) — anexar essa nota
   deve vincular ao lançamento que a Medição já gera automaticamente, ou não vale a pena anexar
   já que o valor chega por outro caminho?
6. Reconciliar o histórico importado da planilha com as NFs reais do Drive: isso deve ser tratado
   como um projeto/mutirão separado depois que este módulo estiver pronto, ou você já quer prever
   esse fluxo dentro desta primeira entrega?

## 9. Fora de escopo desta entrega (explícito)

- Parsing de XML (NF-e ou NFS-e).
- OCR/IA de PDF ou imagem.
- Integração com Google Drive.
- Qualquer edição automática de `lancamentos_financeiros` disparada por leitura de documento.
- Reconciliação automática de fornecedor por CNPJ (cadastro/match continua manual).
- Editar ou desfazer um vínculo documento↔lançamento pela tela (ver §5).
- Migrar `recebimentos_nf`/Compras para o novo modelo (fica para spec futura de reconciliação).

## 10. Categorias de risco — revisão obrigatória

Por `docs/colaboracao-codex-claude.md`, esta entrega toca em pelo menos três categorias que
exigem revisão do Claude Code **antes** da implementação (desenho ainda aberto — revisão prévia)
e novamente depois do commit, antes de qualquer teste de campo:

- **RLS nova** (duas tabelas + Storage).
- **Storage policy alterada** — `isolamento_obra_storage`, arquivo já com dois incidentes reais
  de produção em 2026; maior risco técnico desta entrega, tratar com o cuidado extra que o
  histórico do próprio arquivo já exige.
- **Se qualquer trigger de vínculo automático for adicionado** (não está no desenho acima, que é
  só INSERT manual pela tela) — se isso mudar durante o plano, também vira categoria de risco.

Nenhuma automação desta entrega grava `lancamentos_financeiros` sozinha — item de design, não de
risco a mitigar (não deveria existir de forma nenhuma nesta fase).
