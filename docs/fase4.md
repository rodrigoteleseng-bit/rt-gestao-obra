# Fase 4 — RDO · Registro de entrega

> Status: **concluída e aceita** (aceite do Rodrigo em 09/07/2026 — teste de campo positivo: fotos com carimbo GPS, áudio, assinatura e PDF funcionando no celular).
> Fase 3 (Financeiro) foi pulada por decisão do Rodrigo — será retomada agora.

## Decisões aprovadas (08/07/2026)

1. **Efetivo:** função × quantidade + empresa opcional (formato herdado pela Fase 7).
2. **Clima:** manhã e tarde — condição (claro/nublado/chuvoso) + trabalhável sim/não.
3. **Serviços do dia:** avanços físicos com `data_referencia` = dia do RDO entram **automáticos** (consulta, sem duplicar dado) + itens manuais com vínculo obrigatório à unidade e tarefa opcional.
4. **Fechamento:** rascunho → assinado = **imutável** (nem admin altera; RLS bloqueia UPDATE após assinatura — verificado por tentativa real via API: 0 linhas afetadas).
5. **Fotos (segurança jurídica):** carimbo visível queimado na imagem na captura (obra · data/hora · GPS lat/long ±precisão, ou "sem GPS" explícito) + mesmos metadados estruturados no banco + **hash SHA-256** do arquivo. Redimensionadas a máx. 1600 px, JPEG 85%.
6. **Áudio:** além do ditado por voz (Web Speech API, texto), gravação de áudio anexada (MediaRecorder → Storage) com duração, data/hora e hash — a voz original é preservada.

## Banco (migração `20260708_fase4_rdo.sql`)

- `rdos` — um por obra/dia (UNIQUE), numeração sequencial (UNIQUE), clima, acidente, observações, assinatura (imagem PNG data-URL, nome, data/hora, GPS), status `rascunho|assinado`.
- `rdo_atividades` (unidade obrigatória + tarefa opcional), `rdo_efetivo`, `rdo_fotos` (GPS, capturada_em, hash), `rdo_audios` (duração, gravado_em, hash).
- Função `pode_editar_rdo()` (admin ou equipe com módulo `rdo`) e `rdo_em_rascunho()` — sub-tabelas só editáveis com o pai em rascunho.
- Bucket Storage **`rdo` privado** (`obra/data/uuid`); leitura autenticada via URL assinada (1 h), upload só para quem edita RDO.

## Frontend

- `src/lib/rdo.ts` — geolocalização (nunca inventa: nulls se negada), SHA-256 (`crypto.subtle`), `carimbarFoto` (canvas: redimensiona + tarja com obra/data/hora/GPS).
- `src/lib/rdoPdf.ts` — PDF A4 client-side (jsPDF, **carregado sob demanda** via dynamic import — chunk separado de ~396 KB): cabeçalho navy/terracota, todos os blocos, fotos 2 por linha com legenda técnica, assinatura reproduzida, rodapé com CREA e paginação, marca d'água RASCUNHO quando não assinado.
- `src/pages/RDO.tsx` — lista + "RDO de hoje" (cria com numero = max+1; UNIQUE no banco previne corrida).
- `src/pages/RDOForm.tsx` (`/rdo/:id`) — mobile-first: clima em botões, efetivo com datalist de funções, atividades (avanços automáticos + manuais), acidentes, fotos (`capture="environment"`), ditado, gravação de áudio, assinatura em canvas (pointer events), salvar rascunho / assinar e fechar. Cliente e RDO assinado = somente leitura.

## Verificação executada (08/07/2026)

Preview com usuário temporário `equipe` + módulos rdo/avanco (removido ao final, junto com o RDO de teste):

- Criar RDO nº 001, preencher clima/horário/efetivo/atividade vinculada/observações, salvar rascunho — tudo via RLS real.
- **Integração automática comprovada:** avanços reais lançados pela equipe no dia apareceram sozinhos em "Serviços executados".
- Assinatura desenhada no canvas → fechamento com data/hora (GPS ausente no ambiente de teste → registrado "sem GPS", como manda a regra).
- **Imutabilidade:** PATCH direto na API REST com token do usuário após assinatura → 0 linhas alteradas.
- PDF gerado sem erros. Build de produção limpo.
- Fotos/áudio/ditado dependem de câmera/microfone/GPS reais — **validar no teste guiado pelo celular** (roteiro abaixo).

## Teste guiado (Rodrigo, no celular)

1. Abrir RDO → "+ RDO de hoje" → preencher clima, início e efetivo.
2. Tirar 2–3 fotos pela câmera com localização ativa → conferir carimbo (data/hora/GPS) na miniatura.
3. Ditar uma observação (🎤) e gravar um áudio anexo (🎙️) → reproduzir.
4. Assinar na tela → conferir que nada mais é editável.
5. Gerar o PDF → conferir identidade visual, fotos carimbadas e assinatura → enviar no WhatsApp.
6. Pedir a alguém sem o módulo RDO para tentar editar (deve só visualizar); entrar como cliente (idem).

## Adições pós-entrega (09/07/2026)

- **Banner de RDOs não assinados** (`src/pages/RDO.tsx`): ao abrir a lista, exibe aviso amarelo com os dias pendentes ("1 RDO sem assinar (08/07) — toque no dia para completar e assinar"). Visível só para quem pode editar RDO.
- **Galeria integrada (Fase 7 antecipada):** fotos anexadas ao RDO aparecem automaticamente em `/galeria`, organizadas por data do RDO. Ver `docs/fase7_extras.md`.
- **Dashboard — RDO como grupo:** o card RDO é agora expansível e agrupa Relatório Diário, Galeria de Fotos e Efetivo como sub-itens. Galeria tem `sempre: true` (visível inclusive para cliente).

## Pendências transferidas

- Efetivo automático (Fase 7) e ferramentas do almoxarifado (Fase 6) alimentando o RDO.
- "Congelar" os avanços no momento da assinatura em vez de consulta dinâmica por data [sugestão feita, sem resposta — Rodrigo vai testar o comportamento atual].
- E-mail automático do PDF ao cliente [sugestão].
- Aceites formais das Fases 2 e 4.
