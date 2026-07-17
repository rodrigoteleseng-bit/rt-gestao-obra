# Auditoria geral — RT Gestão de Obra

Data: 17/07/2026  
Status: em andamento

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

## Achados abertos

### [Alto] Uploads sem limite explícito no bucket

Os inputs restringem extensão/tipo apenas na interface, mas isso pode ser contornado. Os buckets precisam de limite de tamanho e MIME types no backend, compatíveis com fotos, áudios, PDFs e CSVs utilizados.

### [Médio] Campos podem exceder o painel no celular

Em Compras e Almoxarifado, conjuntos de `input/select/textarea` não aplicam de forma uniforme `width: 100%` e `min-width: 0`. Um `select` com opção longa pode aumentar o grid/painel além do corpo disponível.

### [Médio] Tabelas largas dependem de rolagem horizontal

Compra, Contrato e Medição usam tabelas com `min-width` entre 600 e 640 px. O wrapper tem rolagem, mas a experiência móvel deve ser revista para cards ou indicação visual de conteúdo lateral.

### [Médio] Confirmações nativas inconsistentes

FVS, Almoxarifado, Efetivo, Usuários, Contratos e Medições utilizam `window.confirm/window.prompt`. Elas não seguem a identidade visual, oferecem pouco contexto e variam entre navegadores/PWA.

### [Médio] Pacote principal grande

O bundle principal tem aproximadamente 1,16 MB antes de gzip e 344 KB comprimido. Todas as páginas são importadas diretamente em `App.tsx`; divisão por rota pode reduzir memória e tempo de abertura no celular.

## Próximas verificações

1. limites e MIME types dos buckets;
2. simulação das permissões `cliente`, `equipe` e `admin`;
3. integridade das RPCs por obra e transição de status;
4. tratamento de erro nas 87 operações de escrita do frontend;
5. revisão responsiva módulo a módulo;
6. plano de correções UI/UX priorizado.
