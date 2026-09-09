# Contratos — Anexo do documento assinado · Spec de design

> Status: aprovado por Rodrigo em 09/09/2026, aguardando plano de implementação.
> Retoma um pedido antigo (13/07/2026, ver `docs/superpowers/specs/2026-07-13-fase7-medicoes-design.md`
> §9) que na época era sobre anexar comprovante à **medição** e foi adiado pra um módulo próprio de
> anexos que nunca foi construído. Este pedido é diferente: anexar o **contrato assinado em si**
> (e seus aditivos) ao registro do contrato, não à medição.

## 1. Objetivo

Permitir anexar um ou mais documentos (o contrato assinado, aditivos assinados depois) a um
contrato de empreiteiro, a qualquer momento do ciclo de vida do contrato (rascunho, ativo ou
encerrado), com histórico de quem anexou e quando.

## 2. Modelo de dados

### `contratos_anexos` (tabela nova)

```sql
CREATE TABLE contratos_anexos (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contrato_id     UUID NOT NULL REFERENCES contratos(id),
  arquivo_url     TEXT NOT NULL,   -- caminho no bucket 'contratos-assinados'
  nome_original   TEXT NOT NULL,   -- nome do arquivo enviado, pra exibição (ex.: "contrato-jfc-assinado.pdf")
  descricao       TEXT,            -- opcional: "Contrato original", "Aditivo 1"...
  ativo           BOOLEAN NOT NULL DEFAULT true,
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
  criado_por      UUID NOT NULL DEFAULT auth.uid() REFERENCES perfis_usuario(id),
  removido_por    UUID REFERENCES perfis_usuario(id),
  removido_em     TIMESTAMPTZ
);

CREATE INDEX idx_contratos_anexos_contrato ON contratos_anexos(contrato_id);
```

Lista simples, sem conceito de "versão atual" — cada anexo é um registro independente e
permanente (contrato original e cada aditivo convivem na mesma lista, mais recente primeiro).
Nenhum status do contrato bloqueia inserir ou remover anexo — diferente da trava de itens
(`contratos_itens` só editável em rascunho), o anexo é sempre editável porque a via assinada
física costuma chegar só depois do contrato já estar ativo no sistema.

Remoção é sempre soft delete (`ativo = false` + `removido_por`/`removido_em`) — nunca apaga a
linha nem o arquivo do Storage, seguindo a regra geral do projeto (CLAUDE.md §6).

**Regra de RLS pra soft delete** (lição do projeto, CLAUDE.md §3): a policy de SELECT precisa
`USING (ativo = true OR pode_editar_contratos())`, nunca só `ativo = true` — senão a inativação
falha silenciosamente mesmo pra admin.

## 3. Storage

Bucket novo, privado: `contratos-assinados`.

Caminho do arquivo: `{obra_id}/{contrato_id}/{uuid}-{nome do arquivo}` — mesmo padrão já usado e
validado em produção nos buckets `rdo`/`fvs`/`pendencias` (isolamento por obra no primeiro
segmento do caminho, checado com `pode_acessar_obra()`).

Aceita PDF e imagem (JPG/PNG) — mesmo padrão de formato já usado no anexo de cotação de
fornecedor em Compras.

RLS do bucket, mesmo desenho já usado em `cotacoes-nf` (leitura mais aberta, escrita mais
restrita): **leitura** liberada pra qualquer admin/equipe com acesso à obra
(`pode_acessar_obra()`); **escrita** (upload/remoção) exige `pode_editar_contratos()`. Cliente
não acessa (módulo Contratos já é 100% oculto pro papel `cliente`).

Abertura do arquivo: signed URL gerada sob demanda (`createSignedUrl`, validade 1h), mesmo
padrão já usado em `CompraForm.tsx` para os anexos de cotação/NF — nenhuma URL fica gravada de
forma permanente ou pública.

## 4. Permissões

Segue exatamente o mesmo desenho já usado em `contratos_itens` (`ci_select` vs `ci_insert`):

- **Visualizar** a lista e abrir os arquivos: qualquer admin ou equipe (independente de ter o
  módulo `contratos`) — mesma policy de SELECT já usada nos itens do contrato hoje
  (`ativo = true AND meu_papel() IN ('admin','equipe')`, mais `pode_editar_contratos()` pra
  também ver os inativos/removidos).
- **Anexar e remover**: exige `pode_editar_contratos()` (admin, ou equipe com o módulo
  `contratos`) — mesma regra de quem já edita o resto do contrato.

Cliente não vê nada do módulo Contratos, incluindo esta lista — sem exceção nova.

## 5. Interface

Na tela do Contrato (`ContratoForm.tsx`, componente `DetalheContrato`), um bloco novo
**"Documentos assinados"**, posicionado depois do resumo do contrato (empreiteiro / condição de
pagamento / retenção / objeto / valor total) e antes do bloco "Itens". Funciona em qualquer
status do contrato (rascunho, ativo, encerrado) — sem gating por `contrato.status`.

- **Lista de anexos** (mais recente primeiro): nome do arquivo, descrição (se houver), quem
  anexou e quando, link "📎 abrir" (URL assinada) e, para quem pode editar, botão "Remover" com
  diálogo de confirmação (reaproveita `useConfirmDialog`, já usado em outras remoções do app).
- **Botão "+ Anexar documento"**: abre um formulário inline — campo de arquivo (PDF ou foto) +
  campo de descrição (texto livre, opcional) + botão "Enviar". Fecha automaticamente após o
  envio bem-sucedido.
- Sem paginação, sem preview embutido — lista simples que só cresce com o tempo.

## 6. Fora de escopo (deferido)

- Acesso do cliente ao documento assinado — decisão explícita de manter fora nesta spec; pode
  virar pedido futuro separado, como já aconteceu com Definições de Projeto e Projetos.
- Anexo de comprovante assinado da **medição** (pedido original de 13/07/2026) — continua
  separado e não é resolvido por esta spec, que cobre só o contrato em si.
- Qualquer preview/visualização embutida do PDF/imagem no navegador — abre em nova aba via URL
  assinada, sem viewer próprio.

## 7. Critérios de aceite

- [ ] Funciona no celular e desktop.
- [ ] Admin ou equipe com módulo `contratos` anexa um documento (PDF ou foto) a um contrato em
      qualquer status, com descrição opcional.
- [ ] Anexo aparece na lista imediatamente, com nome, descrição, quem anexou e quando.
- [ ] Link "abrir" funciona e expira (URL assinada, 1h).
- [ ] Remover um anexo pede confirmação, marca `ativo = false` (soft delete) e some da lista —
      sem apagar o arquivo do Storage nem a linha do banco.
- [ ] Equipe sem o módulo `contratos` e o papel `cliente` não veem o bloco de anexos.
- [ ] Isolamento por obra testado: usuário de uma obra não acessa/anexa em contrato de outra
      obra que não tem permissão.
