# Projetos — painel único + pasta obrigatória — Plano de implementação

> **Para quem for executar:** use a skill `subagent-driven-development` (recomendado) ou
> `executing-plans` pra rodar este plano tarefa por tarefa. Os passos usam checkbox (`- [ ]`)
> pra acompanhar o progresso.

**Objetivo:** ajustar a tela `/projetos` pra (1) exigir escolher uma pasta antes de mostrar
qualquer documento — com a busca por título/descrição funcionando como atalho sem pasta
escolhida — e (2) unificar visualmente a lista de documentos e o painel de detalhe numa única
superfície, em vez de duas caixas brancas soltas lado a lado.

**Arquitetura:** mudança isolada em dois arquivos já existentes — `src/pages/Projetos.tsx`
(lógica de filtro/gate) e `src/pages/Projetos.module.css` (moldura visual). Nenhuma tabela,
policy ou rota nova.

**Tech Stack:** React 19 + TypeScript + Vite, Supabase JS client, CSS Modules. Sem framework de
teste automatizado no repositório (`package.json` não tem `vitest`/`jest`) — verificação é por
`tsc -b` (typecheck) e checagem manual no navegador via `npm run dev`, seguindo o padrão já
usado neste projeto (ver `docs/fase7_projetos.md` e demais `docs/faseN.md`: todo módulo é
validado rodando no navegador, não por suíte de testes).

## Global Constraints

- Todo texto de interface em português, no mesmo tom já usado no resto da tela (ex.: "Nenhum
  documento cadastrado.").
- Cores só via as variáveis CSS já definidas no projeto (`--navy`, `--nude`, `--branco`,
  `--cinza-200`, `--cinza-600`, `--sombra-sm`, `--radius-sm`, `--radius-md`) — nunca hex novo
  solto no CSS (paleta oficial: navy `#1A3248`, terracota `#C49A7A`, nude `#F0EBE3`).
  Fonte de verdade: skill `rt-manual-marca`.
- Nenhuma mudança de schema, RLS, policy de storage ou regra de permissão
  (`podeEditar`/`cliente`/`semPermissao` continuam exatamente como estão).
- Nenhuma mudança no fluxo de cadastro de documento, nova revisão, editar/inativar documento ou
  gerenciar pastas — só a entrada da tela (gate por pasta) e a moldura visual do detalhe.
- Responsivo: o breakpoint mobile já existente (`@media (max-width: 860px)`) continua
  funcionando — qualquer CSS novo precisa de um ajuste equivalente nesse breakpoint se mudar o
  comportamento em telas largas.

---

## Arquivos afetados

- **Modificar:** `src/pages/Projetos.tsx` — filtro de busca (título + descrição), gate por
  pasta, rótulo do seletor, correção do documento selecionado ao trocar de pasta.
- **Modificar:** `src/pages/Projetos.module.css` — moldura única para `.conteudo`
  (lista + detalhe), estilo dos cards dentro dela, ajuste do breakpoint mobile.

Nenhum arquivo novo é criado.

---

### Task 1: Gate por pasta + busca em título e descrição

**Files:**
- Modify: `src/pages/Projetos.tsx:61-77` (memos de filtro/seleção)
- Modify: `src/pages/Projetos.tsx:343` (rótulo do seletor de pasta)
- Modify: `src/pages/Projetos.tsx:346-347` (condição de renderização da lista/detalhe)

**Interfaces:**
- Consome: estados já existentes `busca: string`, `filtroPasta: string`, `documentos:
  ProjetoDocumento[]`, `pastasAtivas: ProjetoPasta[]` (nenhum estado novo é criado).
- Produz: `documentosFiltrados` (já existe, só a lógica de busca muda) e uma nova constante
  local `mostrarConteudo: boolean`, usada só dentro do JSX de renderização — não é exportada
  nem consumida por nenhuma outra task.

- [ ] **Passo 1: Ajustar `documentosFiltrados` pra buscar em título e descrição**

Abra `src/pages/Projetos.tsx` e localize o bloco (por volta da linha 61):

```tsx
  const documentosFiltrados = useMemo(() => {
    const termo = busca.trim().toLowerCase()
    return documentos.filter(doc => {
      const batePasta = !filtroPasta || doc.pasta_id === filtroPasta
      const bateBusca = !termo || doc.titulo.toLowerCase().includes(termo)
      return batePasta && bateBusca
    })
  }, [documentos, filtroPasta, busca])
```

Troque a linha de `bateBusca` para checar também a descrição:

```tsx
  const documentosFiltrados = useMemo(() => {
    const termo = busca.trim().toLowerCase()
    return documentos.filter(doc => {
      const batePasta = !filtroPasta || doc.pasta_id === filtroPasta
      const bateBusca = !termo
        || doc.titulo.toLowerCase().includes(termo)
        || (doc.descricao ?? '').toLowerCase().includes(termo)
      return batePasta && bateBusca
    })
  }, [documentos, filtroPasta, busca])
```

- [ ] **Passo 2: Corrigir `selecionado` pra respeitar o filtro atual**

Ainda no mesmo arquivo, localize (por volta da linha 70):

```tsx
  const selecionado = documentos.find(d => d.id === selecionadoId) ?? documentosFiltrados[0] ?? null
```

Esse trecho tem um problema que o gate da Task 1 vai expor: se o documento selecionado não
pertencer à pasta escolhida agora, `documentos.find` ainda o encontra (ele existe na obra) e o
painel de detalhe mostra um documento que não está na lista visível à esquerda. Troque para
procurar dentro da lista já filtrada:

```tsx
  const selecionado = documentosFiltrados.find(d => d.id === selecionadoId) ?? documentosFiltrados[0] ?? null
```

- [ ] **Passo 3: Adicionar a constante `mostrarConteudo`**

Logo abaixo da declaração de `revisoesHistoricas` (por volta da linha 77), adicione:

```tsx
  const mostrarConteudo = !!filtroPasta || busca.trim().length > 0
```

- [ ] **Passo 4: Trocar o rótulo do seletor de pasta**

Localize o filtro de pasta (por volta da linha 343):

```tsx
        <select value={filtroPasta} onChange={e => setFiltroPasta(e.target.value)}><option value="">Todas as pastas</option>{pastasAtivas.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}</select>
```

Troque só o texto da primeira opção (o `value=""` continua igual — é ele que representa "nada
escolhido ainda"):

```tsx
        <select value={filtroPasta} onChange={e => setFiltroPasta(e.target.value)}><option value="">Selecione uma pasta</option>{pastasAtivas.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}</select>
```

- [ ] **Passo 5: Adicionar o estado de gate antes da lista/detalhe**

Localize o bloco condicional que decide o que renderizar (por volta da linha 346):

```tsx
      {carregando ? <div className={styles.vazio}>Carregando projetos...</div> : documentos.length === 0 ? <div className={styles.vazio}>Nenhum documento cadastrado.</div> : documentosFiltrados.length === 0 ? <div className={styles.vazio}>Nenhum documento encontrado para os filtros.</div> : (
        <div className={styles.conteudo}>
```

Adicione a checagem de `mostrarConteudo` entre a checagem de "nenhum documento cadastrado" e a
de "nenhum documento encontrado para os filtros":

```tsx
      {carregando ? <div className={styles.vazio}>Carregando projetos...</div> : documentos.length === 0 ? <div className={styles.vazio}>Nenhum documento cadastrado.</div> : !mostrarConteudo ? <div className={styles.vazio}>Selecione uma pasta para ver os documentos.</div> : documentosFiltrados.length === 0 ? <div className={styles.vazio}>Nenhum documento encontrado para os filtros.</div> : (
        <div className={styles.conteudo}>
```

Não mexa em mais nada dentro do bloco `<div className={styles.conteudo}>...</div>` — ele
continua exatamente como está, só passa a renderizar apenas quando `mostrarConteudo` é
verdadeiro.

- [ ] **Passo 6: Rodar o typecheck**

Rode: `npm run build`
Esperado: build completa sem erro de TypeScript. Se `tsc -b` reclamar de algo, é sinal de erro
de digitação num dos passos acima — revise antes de seguir.

- [ ] **Passo 7: Verificação manual no navegador**

Rode: `npm run dev` e abra a URL impressa no terminal (ex.: `http://localhost:5173`), faça
login e entre em **Projetos** no menu lateral. Confirme, nessa ordem:

1. Ao abrir a tela, nenhum documento aparece — só a mensagem "Selecione uma pasta para ver os
   documentos.".
2. Escolher uma pasta no seletor mostra só os documentos daquela pasta, e o painel de detalhe
   mostra um documento que pertence a ela (não um de outra pasta).
3. Trocar para outra pasta atualiza a lista e o detalhe corretamente (sem mostrar o documento
   da pasta anterior).
4. Voltar o seletor para "Selecione uma pasta" faz a lista sumir de novo, voltando à mensagem
   do passo 1.
5. Com o seletor em "Selecione uma pasta", digitar no campo de busca um termo que bate com o
   **título** de um documento de qualquer pasta mostra esse documento.
6. Digitar um termo que só aparece na **descrição** de um documento (não no título) também
   mostra esse documento — essa é a parte nova desta task.
7. Com uma pasta escolhida e um termo de busca preenchido ao mesmo tempo, só aparecem
   documentos que batem com os dois filtros juntos.

- [ ] **Passo 8: Commit**

```bash
git add src/pages/Projetos.tsx
git commit -m "feat: exige pasta escolhida em Projetos e busca também na descrição"
```

---

### Task 2: Moldura única para lista + detalhe

**Files:**
- Modify: `src/pages/Projetos.module.css:25-38` (regras `.conteudo`, `.lista`, `.card`,
  `.cardAtivo`, `.detalhe`)
- Modify: `src/pages/Projetos.module.css:53-60` (bloco `@media (max-width: 860px)`)

**Interfaces:**
- Consome: as classes `.conteudo`, `.lista`, `.detalhe`, `.card`, `.cardAtivo` já aplicadas no
  JSX de `Projetos.tsx` (nenhuma classe nova precisa ser referenciada no `.tsx` — só o CSS
  muda).
- Produz: nenhuma interface nova — é o passo final visual, não depende de nada da Task 1 além
  do arquivo `.tsx` continuar usando as mesmas classes de hoje.

- [ ] **Passo 1: Unificar a moldura de `.conteudo` e ajustar `.lista`/`.detalhe`**

Em `src/pages/Projetos.module.css`, localize (linhas 25-27):

```css
.conteudo { display: grid; grid-template-columns: minmax(300px, .9fr) minmax(360px, 1.1fr); gap: 16px; align-items: start; }
.lista, .detalhe { min-width: 0; }
.card { width: 100%; display: block; text-align: left; border: 1px solid var(--cinza-200); border-radius: var(--radius-md); background: var(--branco); padding: 14px; margin-bottom: 10px; cursor: pointer; box-shadow: var(--sombra-sm); }
.cardAtivo { border-color: var(--navy); }
```

Substitua por (note que `.detalhe` não entra aqui — ela é tratada inteira no Passo 2, pra não
deixar duas regras `.detalhe` espalhadas no arquivo):

```css
.conteudo { display: grid; grid-template-columns: minmax(300px, .9fr) minmax(360px, 1.1fr); align-items: start; background: var(--branco); border: 1px solid var(--cinza-200); border-radius: var(--radius-md); box-shadow: var(--sombra-sm); }
.lista { min-width: 0; padding: 16px; display: flex; flex-direction: column; gap: 10px; }
.card { width: 100%; display: block; text-align: left; border: 1px solid var(--cinza-200); border-radius: var(--radius-sm); background: var(--nude); padding: 14px; cursor: pointer; }
.cardAtivo { border-color: var(--navy); background: var(--branco); box-shadow: var(--sombra-sm); }
```

Note que `gap: 16px` saiu de `.conteudo` (as duas colunas agora encostam, com a divisória do
próximo passo no lugar do espaço em branco) e `margin-bottom: 10px` saiu de `.card` (o
espaçamento entre cards agora vem do `gap: 10px` do `.lista`).

- [ ] **Passo 2: Substituir a caixa própria de `.detalhe` por uma divisória**

Logo abaixo, localize a regra `.detalhe` original (linha 37):

```css
.detalhe { background: var(--branco); border: 1px solid var(--cinza-200); border-radius: var(--radius-md); padding: 16px; box-shadow: var(--sombra-sm); position: sticky; top: 12px; }
```

Substitua essa linha inteira por uma versão sem caixa própria (fundo/borda/sombra somem — ela
passa a herdar o branco de `.conteudo` — e ganha uma linha vertical fina como divisória):

```css
.detalhe { min-width: 0; padding: 16px; border-left: 1px solid var(--cinza-200); position: sticky; top: 12px; align-self: start; }
```

- [ ] **Passo 3: Ajustar o breakpoint mobile**

Localize o bloco `@media (max-width: 860px)` (linha 53-60):

```css
@media (max-width: 860px) {
  .header, .headerAcoes { flex-direction: column; width: 100%; }
  .filtros, .conteudo, .linha2, .pastaLinha { grid-template-columns: 1fr; }
  .detalhe { position: static; }
  .cardTopo, .detalheTopo, .revisaoLinha { flex-direction: column; }
  .acoesLinha { justify-content: flex-start; width: 100%; }
  .btnPrimario, .btnSecundario, .btnPerigo { width: 100%; }
}
```

Troque a linha `.detalhe { position: static; }` para também remover a divisória vertical (que
não faz sentido quando as colunas empilham) e colocar uma divisória horizontal no lugar:

```css
@media (max-width: 860px) {
  .header, .headerAcoes { flex-direction: column; width: 100%; }
  .filtros, .conteudo, .linha2, .pastaLinha { grid-template-columns: 1fr; }
  .detalhe { position: static; border-left: 0; border-top: 1px solid var(--cinza-200); }
  .cardTopo, .detalheTopo, .revisaoLinha { flex-direction: column; }
  .acoesLinha { justify-content: flex-start; width: 100%; }
  .btnPrimario, .btnSecundario, .btnPerigo { width: 100%; }
}
```

- [ ] **Passo 4: Rodar o typecheck**

Rode: `npm run build`
Esperado: build completa sem erro (mudança é só CSS, mas confirma que nada quebrou no
`Projetos.tsx` da Task 1).

- [ ] **Passo 5: Verificação visual no navegador**

Rode: `npm run dev` (se já não estiver rodando), abra **Projetos**, escolha uma pasta com mais
de um documento e confirme:

1. A lista (esquerda) e o detalhe (direita) aparecem como uma única superfície branca com
   borda e sombra externas — não mais duas caixas brancas separadas.
2. Existe uma linha fina vertical entre a lista e o detalhe.
3. Cards não selecionados na lista têm um tom levemente diferente (nude) do card selecionado
   (branco, borda navy).
4. Reduza a largura da janela do navegador para menos de 860px (ou abra o DevTools em modo
   responsivo/mobile): a lista e o detalhe empilham verticalmente, com uma linha horizontal
   fina separando os dois, sem nenhuma borda vertical solta.

- [ ] **Passo 6: Commit**

```bash
git add src/pages/Projetos.module.css
git commit -m "style: unifica lista e detalhe de Projetos numa moldura só"
```

---

## Critérios de aceite (repetidos da spec, pra conferência final)

- [ ] Entrar em `/projetos` sem nenhuma pasta escolhida não mostra nenhum documento — só a
      mensagem de gate.
- [ ] Escolher uma pasta no dropdown mostra os documentos só daquela pasta, no layout de
      superfície única.
- [ ] Digitar um termo de busca sem pasta escolhida mostra resultados de todas as pastas,
      buscando em título e descrição.
- [ ] Pasta escolhida + busca preenchida juntas continuam combinando os dois filtros.
- [ ] "Todas as pastas" não existe mais como opção no dropdown.
- [ ] Lista e detalhe não parecem mais duas caixas brancas separadas — moldura única, com ou
      sem documento selecionado.
- [ ] Nenhuma mudança de comportamento em cadastro/edição/revisão/gerenciar pastas.
- [ ] Rodrigo testou visualmente no navegador (desktop e mobile) e deu aceite.
