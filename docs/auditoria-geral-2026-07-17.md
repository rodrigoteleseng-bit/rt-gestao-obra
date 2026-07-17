# Auditoria geral — RT Gestão de Obra

Data: 17/07/2026  
Status: auditoria técnica concluída; validação visual autenticada continua no uso de campo

## Escopo

- segurança frontend e backend;
- autenticação, papéis e permissões por módulo;
- RLS, RPCs, triggers e funções privilegiadas;
- Supabase Storage;
- PWA, cache e cabeçalhos HTTP;
- UI/UX responsiva em celular e desktop;
- estados de carregamento, vazio, sucesso e erro;
- desempenho e memória.

## Achados corrigidos

### [Crítico] Leitura de dados sem autenticação

**Evidência:** chamadas REST com a chave `anon`, sem sessão, retornavam registros de 11 tabelas: obras, unidades, etapas, quatro tabelas do cronograma e quatro tabelas do RDO.

**Causa:** policies `SELECT` sem `TO authenticated`; no PostgreSQL elas se aplicavam a `PUBLIC`, que inclui `anon`.

**Correção:** migração `20260717_fix_leitura_anonima.sql` recriou as policies para o papel `authenticated`, preservando as regras funcionais existentes.

**Validação:** antes, 11 tabelas expostas; depois, `EXPOSED_COUNT=0` em todas as tabelas versionadas.

### [Alto] Funções privilegiadas executáveis por usuário anônimo

**Evidência:** as 22 funções `SECURITY DEFINER` concediam `EXECUTE` a `anon` por herança de `PUBLIC`; 16 não fixavam `search_path`.

**Correção:** migração `20260717_hardening_funcoes_privilegiadas.sql` revogou `PUBLIC/anon`, fixou `search_path=public`, liberou a `authenticated` somente helpers de RLS e RPCs usadas pela interface e manteve funções de trigger internas sem exposição.

**Validação:** chamada anônima à RPC `meu_papel` passou a retornar HTTP 401.

### [Alto] Cabeçalhos de segurança ausentes no frontend

**Evidência:** apenas HSTS estava presente na resposta pública.

**Correção:** CSP compatível com Supabase e mídias, `nosniff`, `DENY` para iframe, política de referência, política de câmera/microfone/geolocalização e isolamento de opener.

**Validação:** cabeçalhos confirmados na URL pública após o deploy.

### [Alto] Tela branca após deploy do PWA

**Causa:** HTML antigo mantido pelo service worker apontava para bundle removido pela Vercel.

**Correção:** recuperação automática do bundle afetado e remoção do fallback de navegação em cache.

### [Alto] Uploads sem limite explícito no backend

**Evidência:** tipo e extensão eram restringidos principalmente pelos inputs da interface, o que pode ser contornado por chamada direta ao Storage.

**Correção:** os quatro buckets continuam privados e agora aplicam limites e MIME types no Supabase: RDO com 20 MB e imagem/áudio; FVS e Pendências com 10 MB e imagem; Cotações/NF com 25 MB e PDF/imagem.

**Validação:** configurações confirmadas diretamente em produção após a migração `20260717_storage_limites_upload.sql`.

### [Médio] Campos excedendo painéis no celular

**Evidência:** grupos de formulário de Compras e Almoxarifado não aplicavam de forma uniforme `width: 100%`, `min-width: 0` e limite de largura.

**Correção:** painéis, campos e textos longos foram limitados ao corpo disponível, inclusive nas faixas móveis.

### [Médio] Falhas de gravação ocultadas pela interface

**Evidência:** respostas/observações/fotos de FVS, legenda de foto do RDO, eventos de Pendências e edição de permissões podiam atualizar a tela ou encerrar o fluxo sem verificar `error` do Supabase.

**Correção:** os fluxos agora conferem o retorno, revertem estado otimista quando necessário e exibem a falha sem informar sucesso indevido.

### [Médio] Pacote inicial excessivo no celular

**Evidência:** todas as páginas eram importadas diretamente em `App.tsx`; o pacote principal tinha 1,16 MB, sendo 344,5 KB comprimido.

**Correção:** carregamento dividido por rota com `React.lazy` e `Suspense`.

**Validação:** o pacote principal caiu para 467,85 KB, sendo 136,22 KB comprimido — redução aproximada de 60% no download inicial comprimido. O build passou sem alerta de chunk acima de 500 KB.

### [Médio] Tabelas largas no celular

**Evidência:** Compras, Contratos e Medições forçavam tabelas com largura mínima entre 600 e 640 px, exigindo rolagem horizontal para consultar informações operacionais.

**Correção:** abaixo de 640 px, as linhas passam a ser cartões verticais com o rótulo de cada campo. No desktop, a apresentação tabular foi preservada.

### [Médio] Confirmações nativas inconsistentes

**Evidência:** dez ações usavam `window.confirm`, `confirm` ou `window.prompt`, com aparência e comportamento diferentes no navegador e no PWA.

**Correção:** foi criado um diálogo RT reutilizável, responsivo e acessível, com variante de perigo, campo obrigatório para motivo, bloqueio de rolagem, fechamento por `Esc` e devolução de foco ao controle de origem. Não restaram usos de `confirm/prompt` no frontend.

### [Médio] Gravações parciais em FVS e Pendências

**Evidência:** a criação de uma FVS e sua primeira verificação, assim como a criação/alteração de uma pendência e seu evento de histórico, eram feitas em chamadas separadas. Uma falha na segunda chamada podia deixar o registro principal incompleto.

**Correção:** a migração `20260717_atomicidade_qualidade.sql` criou três RPCs transacionais para executar cada operação composta dentro de uma única transação do PostgreSQL. As funções usam `SECURITY INVOKER`, preservam as policies RLS, validam os vínculos obra/unidade/tarefa e aplicam as transições permitidas de status.

**Validação:** as três funções foram confirmadas em produção com `search_path=public`, sem privilégio para `anon` e com execução somente para `authenticated`. O frontend passou a usar exclusivamente as novas RPCs nesses fluxos.

## Permissões validadas em produção

| Perfil real | Compras | Almoxarifado | RDO | FVS | Medições |
|---|---:|---:|---:|---:|---:|
| Admin | sim | sim | sim | sim | sim |
| Equipe — almoxarife | não | sim | não | não | não |
| Equipe — campo | sim | sim | sim | sim | não |
| Equipe — qualidade | não | não | não | sim | não |

Todos os resultados coincidiram com `modulos_permitidos`. As consultas de leitura de Obra/RDO ficaram disponíveis aos usuários autenticados, conforme o modelo atual do app.

## Achados abertos

### [Alto antes da segunda obra] Não existe vínculo usuário × obra

Hoje todo usuário autenticado consegue ler a única obra e os RDOs. O modelo não possui tabela de participação por obra; portanto, ao cadastrar uma segunda obra para outro cliente/equipe, será necessário criar esse vínculo e incorporá-lo às policies RLS antes de liberar os novos acessos.

### [Médio] Papel cliente sem conta ativa para teste real

Não há perfil `cliente` ativo no banco. As policies e restrições foram revisadas estaticamente, mas o aceite exige uma conta real de cliente para confirmar menus, telas de leitura e bloqueios de escrita ponta a ponta.

### [Médio] Outras gravações compostas ainda não são transações únicas

FVS e Pendências já foram convertidas para transações únicas. Compras, Contratos e Medições ainda criam o registro principal e seus itens em chamadas separadas. As falhas são mostradas, mas a atomicidade total desses três módulos exige RPCs transacionais no banco para impedir registros parciais.

## Próximos passos recomendados

1. testar no celular os cartões de Compras, Contratos e Medições e os painéis corrigidos de Almoxarifado;
2. criar uma conta cliente de teste e executar o roteiro dos três papéis;
3. converter Compras, Contratos e Medições, por prioridade, em RPCs transacionais;
4. implantar vínculo usuário × obra antes da entrada de uma segunda obra com acessos distintos.
