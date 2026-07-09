# Fase 5 — Pendências · Registro de entrega

> Status: **entregue em 09/07/2026 — aguardando teste de campo e aceite do Rodrigo.**
> Primeiro sub-módulo do grupo Qualidade. FVS é a próxima etapa (decisões já colhidas — ver fim deste doc).

## Decisões aprovadas (09/07/2026)

1. **Quem registra:** equipe (módulo `pendencias`) e admin. **Cliente não vê pendências** — módulo interno.
2. **Fluxo de status:** `aberta` → `em_correcao` → `resolvida` — exatamente o fluxo que o Rodrigo já usa.
3. **Campos:** unidade (obrigatória) + tarefa do cronograma (opcional) + descrição + responsável (nome livre — não precisa ser usuário) + prazo + fotos.
4. **Reabertura:** só admin reabre pendência resolvida (RLS: equipe não altera pendência com status `resolvida`).
5. **Fotos com carimbo jurídico:** mesmo padrão do RDO — tarja com obra/data/hora/GPS queimada na imagem + hash SHA-256 + metadados estruturados.
6. **Pendência não trava avanço físico** — o travamento virá com o FVS (integração nº 5 do CLAUDE.md).

## Banco (migração `20260709_fase5_pendencias.sql`)

- `pendencias` — obra + unidade (NOT NULL) + tarefa opcional, descrição, responsável, prazo, status, resolvida_em/por, soft delete, autoria automática.
- `pendencia_eventos` — histórico **imutável** (só INSERT; sem policy de UPDATE/DELETE): cada mudança de status grava autor, data/hora e comentário opcional.
- `pendencia_fotos` — path no bucket, GPS, capturada_em, hash SHA-256.
- Função `pode_editar_pendencias()` (admin ou equipe com módulo `pendencias`).
- RLS: SELECT restrito a `admin`/`equipe` (cliente bloqueado no banco, não só na UI); UPDATE de pendência resolvida só admin.
- Bucket Storage **`pendencias` privado** (`obra/pendencia/uuid.jpg`); leitura admin/equipe via URL assinada (1 h).

## Frontend

- `src/pages/Pendencias.tsx` (`/pendencias`) — contadores clicáveis (Abertas / Em correção / Resolvidas = filtro), filtro por unidade, cards ordenados: **vencidas primeiro** (prazo < hoje e não resolvida, borda vermelha + "vencida há X dias"), depois prazo mais próximo, depois mais recentes.
- `src/pages/PendenciaForm.tsx` (`/pendencias/nova` e `/pendencias/:id`):
  - **Nova:** unidade → tarefas da unidade carregadas do cronograma → descrição/responsável/prazo → fotos carimbadas (ficam em memória e sobem após criar). Cria a pendência + evento `aberta` + fotos.
  - **Detalhe:** cabeçalho com chip de status, meta (tarefa, responsável, prazo, autor da abertura), fotos com legenda técnica, bloco "Atualizar status" com comentário opcional, linha do tempo completa.
- Reuso de `lib/rdo.ts`: `obterPosicao`, `carimbarFoto`, `sha256Hex`, `fmtCoord` — zero duplicação da lógica de segurança jurídica.
- Rotas em `App.tsx`; card Qualidade no Dashboard e seção QUALIDADE na sidebar já existiam (reestruturação de 09/07/2026).

## Verificação executada (09/07/2026)

Preview com usuário temporário `equipe` + módulo `pendencias` (removido ao final, junto com a pendência de teste):

- Sidebar filtrada corretamente (seção QUALIDADE > Pendências; RDO oculto sem módulo).
- Criação com unidade Sobrado 03 + tarefa "Armação - Estacas - Casa 03" (134 tarefas da unidade carregadas) + responsável + prazo — gravou autor e data via RLS real.
- Transições: aberta → em correção (com comentário no histórico) → resolvida. Timeline com 3 eventos, autor e hora em cada um.
- Equipe numa pendência resolvida: bloco de ações some da UI **e** UPDATE via API direta retorna 0 linhas (RLS).
- Histórico: UPDATE e DELETE via API direta em `pendencia_eventos` → 0 linhas (imutável).
- Build de produção limpo.
- **Validar no teste de campo:** fotos com carimbo (câmera/GPS reais no celular).

## Armadilha nova documentada

Usuário de teste criado via SQL: além do re-crypt da senha, o GoTrue retorna **500 no login** se os campos de token (`confirmation_token`, `recovery_token`, `email_change*`, `phone_change*`, `reauthentication_token`) ficarem NULL — preencher todos com `''`.

## Próxima etapa — FVS (decisões já colhidas em 09/07/2026)

- FVS = lista de itens de verificação **por tipo de serviço**, aplicada **sobrado por sobrado**, condição para liberar o serviço seguinte.
- Aprovadores: estagiário, mestre e encarregado (equipe com módulo `fvs`).
- Integração com avanço: **aviso** de FVS não concluídas (não trava o lançamento por enquanto).
- A detalhar na próxima sessão: cadastro dos modelos de checklist (itens por tipo de serviço), fluxo de aprovação/reprovação, fotos por item.

## Pendências transferidas

- FVS (próxima etapa do grupo Qualidade).
- Teste de campo e aceite formal da Fase 5.
