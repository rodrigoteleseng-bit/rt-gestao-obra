# Fase 7 — Contratos

> Detalhes técnicos do módulo de Contratos. Entregue em 13/07/2026, aguardando teste de campo com um contrato real e aceite do Rodrigo — ver CLAUDE.md §0.
> Base para o futuro módulo de Medições de empreiteiros (ainda não desenhado — spec separada).

## O que foi entregue

- Cadastro de **Empreiteiros** (`/empreiteiros`, reaproveitável entre contratos): nome, CPF/CNPJ, contato, especialidade, chave PIX.
- Contrato (`/contratos`, `/contratos/novo`, `/contratos/:id`): cabeçalho (empreiteiro, objeto, condição de pagamento, retenção %) + itens (serviço do orçamento × unidade, quantidade e valor unitário negociados) — mostra o valor orçado ao lado do negociado no detalhe.
- Numeração sequencial por obra: `CT-001`, `CT-002`... — toda obra começa do zero (sem contratos formais em papel a incorporar, diferente de Compras).
- Fluxo de status: rascunho → ativo → encerrado, transição exclusiva do admin, em ordem única (sem retroceder, nem para admin).
- Itens editáveis (adicionar/remover/alterar) só enquanto o contrato está em rascunho — trava tanto na tela quanto no banco (RLS), sem exceção nem para admin.
- `valor_total` do contrato nunca é digitado — soma automática dos itens ativos, mantida por trigger no banco.
- Módulo `contratos` (checkbox em Usuários): admin sempre tem acesso; equipe só com o módulo habilitado cria/edita rascunho. Ativar/Encerrar é exclusivo do admin. Cliente não vê `/contratos` nem `/empreiteiros`.

## Onde estão as regras de negócio

RLS e triggers em `supabase/migrations/20260713_fase7_contratos.sql`, com dois ajustes de segurança aplicados no mesmo dia após revisão:
- `20260713_fase7_contratos_itens_imutavel.sql` — a policy original replicava por engano o bypass de admin usado em Compras; corrigido para itens serem imutáveis pra qualquer papel fora do rascunho.
- `20260713_fase7_contratos_transicao_status.sql` — o trigger de status bloqueava só não-admin; corrigido para também impedir admin de reverter status fora de ordem (ex.: encerrado → ativo) via chamada direta à API.

Ver `docs/superpowers/specs/2026-07-13-fase7-contratos-design.md` para o desenho completo e `docs/superpowers/plans/2026-07-13-fase7-contratos.md` para o plano de implementação.

## Fora de escopo (spec explicitamente deferiu)

- Módulo de Medições (lançamento de execução por item de contrato, saldo, ciclo de pagamento) — próxima spec.
- Vigência (datas de início/fim) e alerta de contrato vencendo.
- Anexo do contrato assinado (PDF/foto).
- Pagamento via PIX direto pelo app — campo cadastrado no Empreiteiro, sem funcionalidade associada.
- Edição do cabeçalho do contrato (objeto/condição/retenção) e exclusão de contrato pela tela — o spec original previa os dois, mas o plano de implementação os deixou de fora; hoje só existem via banco direto. Revisitar se o Rodrigo pedir no teste de campo.

## Pendência técnica conhecida (não bloqueia o uso)

`criar()` insere o contrato antes dos itens; se a inserção dos itens falhar, o contrato em rascunho fica órfão (sem itens) e uma nova tentativa cria um segundo contrato. Baixo risco (falha independente na inserção dos itens é rara) — limpar manualmente contratos de teste teria o mesmo procedimento de Compras (DELETE direto, decrementar `contratos_seq`).
