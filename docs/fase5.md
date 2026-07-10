# Fase 5 — Qualidade (Pendências + FVS) · Registro de entrega

> Status: **entregue em 09–10/07/2026 — aguardando teste de campo com dados reais e aceite formal do Rodrigo.**
> Os dois sub-módulos do grupo Qualidade. Banco de dados de teste zerado em 10/07/2026 (ver seção ao final) — o teste de campo pendente agora é com dados reais da obra.

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

## FVS — entregue em 09/07/2026 (migração `20260709_fase5_fvs.sql`)

FVS = lista de itens de verificação por tipo de serviço, aplicada unidade a unidade. Decisões do Rodrigo: aprovadores = equipe com módulo `fvs` (preenche e aprova, etapa única); item NC gera pendência automática; reprovação mantém histórico de rodadas até aprovar; adoção do status **"Aprovada com restrição"** (libera mas gera pendência).

### Modelos (seed)
- **17 fichas** (294 itens) importadas de `fvs_15_prioritarias_qualidade_obras.md` via `scripts/importar-fvs.cjs`, com **renumeração conforme a sequência real da obra** (aprovada pelo Rodrigo): cobertura movida para antes dos acabamentos (FVS-010).
- **2 fichas novas** criadas por lacuna crítica: **FVS-008 Reboco/emboço** (NBR 13749/7200) e **FVS-013 Forro de gesso** (NBR 15758-2). Análise crítica que motivou: o arquivo exigia "reboco curado" como pré-requisito da pintura mas não tinha ficha para o reboco.
- Itens têm campo opcional `criterio` (tolerância objetiva, ex.: "desvio ≤ 3 mm / 2 m") para tornar as fichas menos subjetivas com o tempo. Modelos editáveis só por admin.

### Banco
- `fvs_modelos` + `fvs_modelo_itens` (globais, seções preservadas: Pré-requisitos/Execução/Armação/etc.).
- `fvs` (aplicação: modelo + unidade + tarefa opcional + local/empreiteiro), `fvs_verificacoes` (rodadas, `resultado` NULL = aberta), `fvs_respostas` (C/NC/NA + observação por item), `fvs_fotos`.
- `pendencias.fvs_id` liga a pendência gerada à FVS de origem.
- **RPC `concluir_verificacao_fvs`** (SECURITY DEFINER, transacional): valida, grava resultado, atualiza status da FVS e **cria 1 pendência por item NC** com evento `aberta`. Bloqueia aprovar com NC.
- **RPC `nova_verificacao_fvs`**: abre nova rodada numa FVS reprovada (volta a `em_andamento`).
- Status: `em_andamento` → `aprovada` | `aprovada_restricao` | `reprovada`. Aprovada = imutável (RLS bloqueia UPDATE e novas verificações). Cliente não vê. Bucket `fvs` privado.

### Frontend
- `src/pages/Fvs.tsx` (`/fvs`) — abas **Fichas** (contadores clicáveis, filtro por unidade) e **Mapa da qualidade** (grade serviço × unidade com bolinhas 🟢🟡🔴🔵⚪, clique abre a FVS).
- `src/pages/FvsForm.tsx` (`/fvs/nova` e `/fvs/:id`) — criação (modelo + unidade) e ficha com itens por seção, botões C/NC/NA, observação por item NC, conclusão com 3 resultados, histórico de rodadas, botão "Nova verificação" quando reprovada.
- **Integração RDO:** bloco "Qualidade — FVS do dia" no `RDOForm` e no PDF (`rdoPdf.ts`) — FVS cujas verificações foram concluídas na data do RDO entram automaticamente (consulta por `fvs_verificacoes.concluida_em`).

### Verificação executada (09/07/2026)
Preview com usuário temporário `equipe` + módulos fvs/pendencias/rdo (removido ao final com todos os dados de teste):
- Criar FVS-004 Alvenaria no Sobrado 05, responder 17 itens (1 NC), Aprovar bloqueado com NC, **Reprovar → 1 pendência automática** vinculada (`fvs_id` + evento "Gerada automaticamente pela FVS-004").
- Nova verificação (rodada 2) → responder tudo C → **Aprovar** → histórico com as 2 rodadas.
- Imutabilidade: UPDATE de FVS aprovada = 0 linhas; INSERT de verificação bloqueado por RLS.
- Mapa da qualidade: bolinha verde no cruzamento FVS-004 × Sobrado 05.
- Integração RDO: bloco "FVS do dia" mostrou as 2 verificações concluídas na data. Build de produção limpo.

### Legenda + foto por item NC (09/07/2026)
- **Legenda** C = Conforme / NC = Não conforme / NA = Não aplicável exibida acima dos itens na ficha.
- Ao marcar um item como **NC**, além do campo de observação aparece o botão **"📷 Anexar foto do problema"** (`capture="environment"`, câmera traseira). A foto é carimbada (GPS + data/hora + hash SHA-256, mesmo `carimbarFoto` do RDO/Pendências), sobe ao bucket `fvs` e é gravada em `fvs_fotos` com `item_id` + `verificacao_id`. Miniaturas com botão de remover.
- Aviso suave no bloco de conclusão: "N item(ns) NC ainda sem foto — recomendado anexar" (não bloqueia; câmera pode falhar em campo).
- As fotos entram automaticamente na seção "Registro fotográfico" do PDF da FVS.

### Ordem global dos itens + exclusão pelo admin (10/07/2026, migração `20260710_fvs_ordem_global_e_exclusao.sql`)
- **Bug de ordenação corrigido:** o campo `ordem` reiniciava em 1 por seção, então ao ordenar globalmente as seções se intercalavam (Pré-requisitos aparecia no meio). Agora `ordem` é **global** (prioridade da seção × 1000 + ordem interna), com **Pré-requisitos sempre primeiro** — premissa a verificar antes de qualquer serviço. UPDATE preservou os `item_id` (não quebrou as respostas das FVS já criadas). `scripts/importar-fvs.cjs` também gera ordem global (re-seed futuro sai correto).
- **Exclusão pelo admin:** RPC `excluir_fvs(p_fvs)` SECURITY DEFINER — soft delete (`ativo=false`) da FVS + inativa as pendências que ela gerou. Botão "🗑 Excluir esta FVS" no rodapé da ficha, só para admin. Para fichas salvas por engano; o registro permanece no banco.
- **Segurança:** a checagem usa `meu_papel() IS DISTINCT FROM 'admin'` (não `<> 'admin'`) — com `<>`, `meu_papel()` NULL (sem sessão) não dispararia a exceção e um anônimo poderia excluir. Verificado no preview: admin exclui (soft delete confirmado no banco); sem sessão a RPC levanta "Apenas o administrador pode excluir".

### Conferência por partes / estado "Aguardando" (10/07/2026, migração `20260710_fvs_aguardando.sql`)
- Enum `resposta_fvs` ganhou o valor `aguardando`. 4ª opção por item: **C / NC / NA / AG**. AG = item ainda não pronto para conferir (ex.: FVS-003 — confere armação num dia, forma noutro, concretagem noutro).
- Respostas salvam automaticamente a cada clique; a rodada fica `em_andamento` e pode ser retomada em outro dia. Progresso mostra "X/Y conferidos · Z aguardando".
- Enquanto `faltaConferir > 0` (itens AG ou sem resposta), a tela mostra o bloco **"Conferência em andamento"** com "💾 Salvar e continuar depois" e **não** exibe os botões de resultado. Quando todos os itens têm C/NC/NA, aparece **"Fechar e assinar"** → assinatura → conclusão.
- Corrige a confusão relatada de "a assinatura não aparece": ela só surge quando a conferência está completa; antes ficava implícito. Agora o estado parcial é explícito.
- Verificado no preview com FVS-003 (28 itens): marca Armação (8) como C e resto como AG → 8/28 conferidos, sem botões de fechar; recarrega → estado preservado; converte AG→C → 28/28 → botões aparecem → Aprovar abre o painel de assinatura com nome e canvas.

### Assinatura na conclusão (10/07/2026, migração `20260710_fvs_assinatura.sql`)
- Quem conclui uma rodada de verificação **assina digitalmente** (canvas, mesmo componente do RDO), com nome + GPS + data/hora. Fluxo em 2 passos: escolhe o resultado (Aprovar/Restrição/Reprovar) → abre o painel de assinatura → "Assinar e concluir".
- Colunas `assinatura_imagem/assinado_por_nome/assinatura_lat/lng/precisao_m` em `fvs_verificacoes`. A RPC `concluir_verificacao_fvs` ganhou parâmetros `p_assinatura/p_assinante/p_lat/p_lng/p_precisao` e **exige assinatura** (RAISE EXCEPTION se ausente) — a conclusão só acontece assinada, tornando a rodada imutável.
- Assinatura exibida no histórico de rodadas (tela) e em cada rodada do PDF (imagem + nome + data/hora + GPS).
- **Armadilha:** ao mudar o nº de parâmetros da RPC, `CREATE OR REPLACE` cria uma sobrecarga em vez de substituir → chamadas ficam ambíguas. Necessário `DROP FUNCTION concluir_verificacao_fvs(uuid, status_fvs, text)` antes (incluído na migração).
- Verificado no preview: RPC rejeita conclusão sem assinatura; fluxo completo (responder → escolher resultado → desenhar assinatura → concluir) grava imagem PNG (~10 KB) + nome; PDF válido (481 KB com a assinatura embutida). GPS null no headless (capturado no celular real).

### PDF da FVS (09/07/2026)
- `src/lib/fvsPdf.ts` — gera o documento A4 com identidade RT (mesma base do RDO): cabeçalho navy/terracota, identificação (obra/unidade/local/empreiteiro/tarefa), situação atual, objetivo, normas, critérios de aceitação, e **cada rodada de verificação** com respostas C/NC/NA por item (marcador colorido + observação do NC em vermelho), fotos ao final, rodapé com CREA. Marca d'água "EM ANDAMENTO" quando não concluída. Nome do arquivo: `FVS_<codigo>_<unidade>_<data>.pdf`.
- Botão "📄 Gerar PDF" no cabeçalho da ficha (`FvsForm`), lazy import. Gerado sob demanda a partir dos dados imutáveis.
- Verificado no preview: PDF válido (%PDF-1.3, ~11 KB, 1 página) gerado sem erro para FVS-008 reprovada. Base idêntica ao rdoPdf já validado em produção.

## Correção de paleta (10/07/2026)

`fvsPdf.ts` e o canvas de assinatura da FVS usavam navy/terracota divergentes do manual de marca oficial. Corrigido para os tokens oficiais (`#1A3248` / `#C49A7A`) — ver `fase0.md` para o detalhe completo da correção (aplicada em todo o app, não só na FVS).

## Reset de dados de teste (10/07/2026)

A pedido do Rodrigo ("a maioria dos dados que fiz foi pra testar o app"), **apagados definitivamente** (não soft delete — DELETE físico, confirmado pelo Rodrigo por ser irreversível):

| Dado | Quantidade removida |
|---|---|
| FVS (+ verificações, respostas) | 4 fichas, 5 verificações |
| Pendências (+ eventos) | 2 |
| RDOs (+ atividades, efetivo) | 1 |
| Avanços físicos | 68 |
| Fotos no Storage (buckets `fvs`, `pendencias`, `rdo`) | 14 arquivos (3 vinculados + 11 órfãos de testes anteriores) |

**Preservado:** os 17 modelos de FVS + 294 itens (`fvs_modelos`/`fvs_modelo_itens`), cronograma (2.816 tarefas), orçamento (3.475 serviços), unidades, obra e os 4 usuários reais.

**Ordem de exclusão** (FK `pendencias.fvs_id` → `fvs` exige apagar pendências antes de FVS): `pendencias` → `fvs` → `rdos` → `avancos_fisicos`, tudo em uma transação. Arquivos do Storage removidos à parte pela Storage API (ver armadilha em `fase0.md` — DELETE direto em `storage.objects` é bloqueado).

Resultado: app limpo para lançamento de dados reais a partir de 10/07/2026. Galeria, RDO, Pendências, FVS e Avanço físico começam do zero.

## Pendências transferidas

- Teste de campo e aceite formal da Fase 5 (Pendências + FVS) com **dados reais** — o reset de 10/07 zerou os testes anteriores.
