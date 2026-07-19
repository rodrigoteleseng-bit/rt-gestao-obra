# Projetos — expandir documento dentro do card — Plano de implementação

> **Para quem for executar:** use a skill `subagent-driven-development` (recomendado) ou
> `executing-plans` pra rodar este plano tarefa por tarefa. Os passos usam checkbox (`- [ ]`)
> pra acompanhar o progresso.

**Objetivo:** trocar o layout de duas colunas (lista + painel de detalhe) da tela `/projetos`
por uma lista de coluna única onde o documento selecionado expande dentro do próprio card, um
por vez, começando sempre fechada.

**Arquitetura:** substitui a estrutura de render que a rodada anterior criou
(`docs/superpowers/plans/2026-07-19-projetos-layout-pastas.md`, Task 2) — o corpo de detalhe
que hoje é uma `<section className={styles.detalhe}>` irmã da lista passa a ser renderizado
dentro de cada card, condicionalmente. O gate por pasta e a busca em título/descrição (Task 1
daquele plano) **não mudam** — só a Task 2 é substituída.

**Tech Stack:** React 19 + TypeScript + Vite, CSS Modules. Sem framework de teste automatizado
no repositório — verificação por `tsc -b` (via `npm run build`) e checagem manual no navegador.

## Global Constraints

- Todo texto de interface em português, no mesmo tom já usado no resto da tela.
- Cores só via as variáveis CSS já definidas (`--navy`, `--nude`, `--branco`, `--cinza-200`,
  `--cinza-600`, `--sombra-sm`, `--radius-sm`, `--radius-md`) — nunca hex novo solto no CSS.
- Nenhuma mudança de schema, RLS, policy de storage ou regra de permissão.
- Nenhuma mudança no gate por pasta, na busca em título/descrição, nem no fluxo de cadastro de
  documento, nova revisão, editar/inativar documento ou gerenciar pastas — a lógica de cada
  ação continua a mesma, só a moldura visual e a estrutura de expandir/fechar mudam.
- Responsivo: o breakpoint mobile já existente (`@media (max-width: 860px)`) continua
  funcionando.

---

## Arquivos afetados

- **Modificar:** `src/pages/Projetos.tsx` — remover auto-seleção do primeiro documento ao
  carregar, remover fallback de seleção automática, mover o corpo de detalhe pra dentro de
  cada card com expandir/fechar em alternância única.
- **Modificar:** `src/pages/Projetos.module.css` — `.conteudo` vira lista de coluna única,
  `.detalhe` vira divisória horizontal dentro do card, nova classe `.cardCabecalho`, mobile
  simplificado.

---

### Task 1: Alternar expansão dentro do card (lógica e JSX)

**Files:**
- Modify: `src/pages/Projetos.tsx:72` (derivação de `selecionado`)
- Modify: `src/pages/Projetos.tsx:109` (efeito de auto-seleção no `carregar()`)
- Modify: `src/pages/Projetos.tsx:350-384` (bloco `.conteudo` inteiro)

**Interfaces:**
- Consome: `documentosFiltrados`, `selecionadoId`, `setSelecionadoId`, `revisoes`,
  `podeEditar`, `editando`, `revisaoAberta`, `pastasEdicao`, `revisaoAtual`,
  `revisoesHistoricas` — todos já existentes, nenhum novo estado é criado.
- Produz: nenhuma interface nova exportada — mudança é só na função de render do componente.

- [ ] **Passo 1: Remover o fallback de seleção automática**

Em `src/pages/Projetos.tsx`, localize (linha 72):

```tsx
  const selecionado = documentosFiltrados.find(d => d.id === selecionadoId) ?? documentosFiltrados[0] ?? null
```

Troque para não escolher mais um documento por padrão quando nada está selecionado:

```tsx
  const selecionado = documentosFiltrados.find(d => d.id === selecionadoId) ?? null
```

- [ ] **Passo 2: Remover a auto-seleção do primeiro documento ao carregar**

Localize, dentro de `carregar()` (linha 109):

```tsx
    if (!selecionadoId && lista.length > 0) setSelecionadoId(lista[0].id)
```

Apague essa linha inteira. (As outras chamadas de `setSelecionadoId(documento.id)` que
acontecem logo depois de criar um documento novo, em `salvarNovo`, **continuam** — faz sentido
mostrar expandido o documento que acabou de ser criado; só a seleção automática de "primeiro
documento da obra ao abrir a tela" é removida.)

- [ ] **Passo 3: Substituir o bloco `.conteudo` inteiro**

Localize o bloco (linhas 350-384, do `<div className={styles.conteudo}>` até o `</div>` que
fecha ele, logo antes do `)}`  final da condicional):

```tsx
        <div className={styles.conteudo}>
          <div className={styles.lista}>{documentosFiltrados.map(doc => {
            const atual = (revisoes[doc.id] ?? []).find(r => r.atual)
            const selecionarCard = () => { setSelecionadoId(doc.id); setEditando(false); setRevisaoAberta(false) }
            return (
              <div
                key={doc.id}
                role="button"
                tabIndex={0}
                className={[styles.card, selecionado?.id === doc.id ? styles.cardAtivo : ''].filter(Boolean).join(' ')}
                onClick={selecionarCard}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selecionarCard() } }}
              >
                <div className={styles.cardTopo}><span className={styles.cardTitulo}>{doc.titulo}</span><span className={styles.chip}>{nomePasta(doc.pasta_id)}</span></div>
                <div className={styles.cardMeta}>
                  <span>{atual ? 'Atual: ' + atual.revisao + ' • ' + fmtDataHora(atual.criado_em) : 'Sem revisão registrada'}</span>
                  {atual && <button type="button" className={styles.btnAbrirCard} onClick={e => { e.stopPropagation(); abrirRevisao(atual) }}>Abrir</button>}
                </div>
                {doc.descricao && <div className={styles.cardDescricao}>{doc.descricao}</div>}
              </div>
            )
          })}</div>
          <section className={styles.detalhe}>
            {!selecionado ? <p>Selecione um documento.</p> : <>
              <div className={styles.detalheTopo}><div><h2>{selecionado.titulo}</h2><span className={styles.chip}>{nomePasta(selecionado.pasta_id)}</span></div>{podeEditar && <div className={styles.acoesLinha}><button className={styles.btnSecundario} onClick={() => iniciarEdicao(selecionado)}>Editar</button><button className={styles.btnPerigo} onClick={inativarDocumento}>Inativar</button></div>}</div>
              {selecionado.descricao && <p className={styles.descricao}>{selecionado.descricao}</p>}
              {editando && podeEditar && <form className={styles.box} onSubmit={salvarEdicao}><div className={styles.campos}><label className={styles.campo}>Título<input value={editTitulo} onChange={e => setEditTitulo(e.target.value)} /></label><label className={styles.campo}>Pasta<select value={editPastaId} onChange={e => setEditPastaId(e.target.value)}>{pastasEdicao.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}</select></label><label className={styles.campo}>Descrição<textarea value={editDescricao} onChange={e => setEditDescricao(e.target.value)} /></label></div><div className={styles.acoesForm}><button className={styles.btnPrimario} disabled={salvando}>Salvar edição</button><button type="button" className={styles.btnSecundario} onClick={() => setEditando(false)}>Cancelar</button></div></form>}
              <div className={styles.revisaoAtual}><h3>Revisão atual</h3>{revisaoAtual ? <div className={styles.revisaoLinha}><div><b>{revisaoAtual.revisao}</b><span>{fmtDataHora(revisaoAtual.criado_em)}</span>{revisaoAtual.observacao && <p>{revisaoAtual.observacao}</p>}</div><button className={styles.btnPrimario} onClick={() => abrirRevisao(revisaoAtual)}>Abrir</button></div> : <p>Nenhuma revisão registrada para este documento.</p>}</div>
              {podeEditar && <button className={styles.btnSecundario} onClick={() => setRevisaoAberta(v => !v)}>{revisaoAberta ? 'Fechar revisão' : 'Nova revisão'}</button>}
              {revisaoAberta && podeEditar && <form className={styles.box} onSubmit={salvarNovaRevisao}><div className={styles.campos}><label className={styles.campo}>Revisão<input value={revisaoCodigo} onChange={e => setRevisaoCodigo(e.target.value)} placeholder="R01" /></label><label className={styles.campo}>Observação<textarea value={revisaoObservacao} onChange={e => setRevisaoObservacao(e.target.value)} /></label><label className={styles.campo}>Arquivo PDF<input key={revisaoArquivoKey} type="file" accept="application/pdf" onChange={e => setRevisaoArquivo(e.target.files?.[0] ?? null)} /></label></div><div className={styles.acoesForm}><button className={styles.btnPrimario} disabled={salvando}>Salvar revisão</button><button type="button" className={styles.btnSecundario} onClick={() => { limparNovaRevisao(); setRevisaoAberta(false) }}>Cancelar</button></div></form>}
              <div className={styles.historico}><h3>Histórico de revisões</h3>{revisoesHistoricas.length === 0 ? <p>Nenhuma revisão anterior.</p> : revisoesHistoricas.map(rev => <div key={rev.id} className={styles.revisaoLinha}><div><b>{rev.revisao}</b><span>{fmtDataHora(rev.criado_em)}</span>{rev.observacao && <p>{rev.observacao}</p>}</div><button className={styles.btnSecundario} onClick={() => abrirRevisao(rev)}>Abrir</button></div>)}</div>
            </>}
          </section>
        </div>
```

Substitua pelo bloco abaixo (o corpo de detalhe — tudo que estava dentro de
`<section className={styles.detalhe}>` — passa a ser renderizado dentro do próprio card,
condicionado a `expandido`, reaproveitando exatamente as mesmas variáveis `selecionado`,
`revisaoAtual`, `revisoesHistoricas`, `pastasEdicao` que já existem hoje):

```tsx
        <div className={styles.conteudo}>{documentosFiltrados.map(doc => {
          const atual = (revisoes[doc.id] ?? []).find(r => r.atual)
          const expandido = selecionadoId === doc.id
          const alternarExpansao = () => {
            setSelecionadoId(expandido ? null : doc.id)
            setEditando(false)
            setRevisaoAberta(false)
          }
          return (
            <div key={doc.id} className={[styles.card, expandido ? styles.cardAtivo : ''].filter(Boolean).join(' ')}>
              <div
                role="button"
                tabIndex={0}
                className={styles.cardCabecalho}
                onClick={alternarExpansao}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); alternarExpansao() } }}
              >
                <div className={styles.cardTopo}><span className={styles.cardTitulo}>{doc.titulo}</span><span className={styles.chip}>{nomePasta(doc.pasta_id)}</span></div>
                <div className={styles.cardMeta}>
                  <span>{atual ? 'Atual: ' + atual.revisao + ' • ' + fmtDataHora(atual.criado_em) : 'Sem revisão registrada'}</span>
                  {atual && <button type="button" className={styles.btnAbrirCard} onClick={e => { e.stopPropagation(); abrirRevisao(atual) }}>Abrir</button>}
                </div>
                {!expandido && doc.descricao && <div className={styles.cardDescricao}>{doc.descricao}</div>}
              </div>
              {expandido && selecionado && (
                <div className={styles.detalhe}>
                  <div className={styles.detalheTopo}><div><h2>{selecionado.titulo}</h2><span className={styles.chip}>{nomePasta(selecionado.pasta_id)}</span></div>{podeEditar && <div className={styles.acoesLinha}><button className={styles.btnSecundario} onClick={() => iniciarEdicao(selecionado)}>Editar</button><button className={styles.btnPerigo} onClick={inativarDocumento}>Inativar</button></div>}</div>
                  {selecionado.descricao && <p className={styles.descricao}>{selecionado.descricao}</p>}
                  {editando && podeEditar && <form className={styles.box} onSubmit={salvarEdicao}><div className={styles.campos}><label className={styles.campo}>Título<input value={editTitulo} onChange={e => setEditTitulo(e.target.value)} /></label><label className={styles.campo}>Pasta<select value={editPastaId} onChange={e => setEditPastaId(e.target.value)}>{pastasEdicao.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}</select></label><label className={styles.campo}>Descrição<textarea value={editDescricao} onChange={e => setEditDescricao(e.target.value)} /></label></div><div className={styles.acoesForm}><button className={styles.btnPrimario} disabled={salvando}>Salvar edição</button><button type="button" className={styles.btnSecundario} onClick={() => setEditando(false)}>Cancelar</button></div></form>}
                  <div className={styles.revisaoAtual}><h3>Revisão atual</h3>{revisaoAtual ? <div className={styles.revisaoLinha}><div><b>{revisaoAtual.revisao}</b><span>{fmtDataHora(revisaoAtual.criado_em)}</span>{revisaoAtual.observacao && <p>{revisaoAtual.observacao}</p>}</div><button className={styles.btnPrimario} onClick={() => abrirRevisao(revisaoAtual)}>Abrir</button></div> : <p>Nenhuma revisão registrada para este documento.</p>}</div>
                  {podeEditar && <button className={styles.btnSecundario} onClick={() => setRevisaoAberta(v => !v)}>{revisaoAberta ? 'Fechar revisão' : 'Nova revisão'}</button>}
                  {revisaoAberta && podeEditar && <form className={styles.box} onSubmit={salvarNovaRevisao}><div className={styles.campos}><label className={styles.campo}>Revisão<input value={revisaoCodigo} onChange={e => setRevisaoCodigo(e.target.value)} placeholder="R01" /></label><label className={styles.campo}>Observação<textarea value={revisaoObservacao} onChange={e => setRevisaoObservacao(e.target.value)} /></label><label className={styles.campo}>Arquivo PDF<input key={revisaoArquivoKey} type="file" accept="application/pdf" onChange={e => setRevisaoArquivo(e.target.files?.[0] ?? null)} /></label></div><div className={styles.acoesForm}><button className={styles.btnPrimario} disabled={salvando}>Salvar revisão</button><button type="button" className={styles.btnSecundario} onClick={() => { limparNovaRevisao(); setRevisaoAberta(false) }}>Cancelar</button></div></form>}
                  <div className={styles.historico}><h3>Histórico de revisões</h3>{revisoesHistoricas.length === 0 ? <p>Nenhuma revisão anterior.</p> : revisoesHistoricas.map(rev => <div key={rev.id} className={styles.revisaoLinha}><div><b>{rev.revisao}</b><span>{fmtDataHora(rev.criado_em)}</span>{rev.observacao && <p>{rev.observacao}</p>}</div><button className={styles.btnSecundario} onClick={() => abrirRevisao(rev)}>Abrir</button></div>)}</div>
                </div>
              )}
            </div>
          )
        })}</div>
```

Note duas mudanças de comportamento pontuais além da estrutura:
1. `alternarExpansao` fecha o card se ele já estiver expandido (`setSelecionadoId(expandido ?
   null : doc.id)`), em vez de sempre selecionar — é o que implementa "clicar de novo fecha".
2. A descrição curta do card (`.cardDescricao`) só aparece no cabeçalho quando o card **não**
   está expandido (`!expandido && doc.descricao`) — evita mostrar a descrição duas vezes (uma
   vez no cabeçalho, outra dentro do corpo expandido).

- [ ] **Passo 4: Rodar o typecheck**

Rode: `npm run build`
Esperado: build completa sem erro de TypeScript.

- [ ] **Passo 5: Verificação manual no navegador (parte 1 — comportamento)**

Rode: `npm run dev`, abra **Projetos**, escolha uma pasta com pelo menos 3 documentos.
Confirme:

1. Nenhum documento aparece expandido ao escolher a pasta.
2. Clicar no cabeçalho de um documento expande ele no lugar, empurrando os cards abaixo.
3. Clicar no cabeçalho de outro documento fecha o primeiro e expande o segundo — nunca dois
   expandidos ao mesmo tempo.
4. Clicar de novo no cabeçalho do documento já expandido fecha ele.
5. Clicar no botão "Abrir" no cabeçalho abre o PDF sem expandir/fechar o card.
6. Com um documento expandido, clicar em "Editar", digitar no campo de título do formulário de
   edição, clicar em "Nova revisão" e digitar num campo dela — nada disso fecha o card
   (só clicar no cabeçalho fecha).
7. Editar, salvar uma nova revisão ou inativar um documento continuam funcionando exatamente
   como antes.

- [ ] **Passo 6: Commit**

```bash
git add src/pages/Projetos.tsx
git commit -m "feat: documento de Projetos expande dentro do proprio card"
```

---

### Task 2: Moldura CSS do card expandido (coluna única)

**Files:**
- Modify: `src/pages/Projetos.module.css:24-39` (regras `.conteudo`, `.lista`, `.card`,
  `.cardAtivo`, `.detalhe` e vizinhas)
- Modify: `src/pages/Projetos.module.css` bloco `@media (max-width: 860px)`

**Interfaces:**
- Consome: as classes `.conteudo`, `.card`, `.cardAtivo`, `.detalhe`, mais a nova
  `.cardCabecalho` referenciada no JSX da Task 1.
- Produz: nenhuma interface nova além da classe `.cardCabecalho`, que só é usada dentro deste
  mesmo arquivo/componente.

- [ ] **Passo 1: `.conteudo` vira lista de coluna única, sem a classe `.lista`**

Em `src/pages/Projetos.module.css`, localize (linhas 24-28):

```css
.filtros { display: grid; grid-template-columns: minmax(220px, 1fr) minmax(180px, 280px); gap: 8px; align-items: center; margin-bottom: 16px; }
.conteudo { display: grid; grid-template-columns: minmax(300px, .9fr) minmax(360px, 1.1fr); align-items: start; background: var(--branco); border: 1px solid var(--cinza-200); border-radius: var(--radius-md); box-shadow: var(--sombra-sm); }
.lista { min-width: 0; padding: 16px; display: flex; flex-direction: column; gap: 10px; }
.card { width: 100%; display: block; text-align: left; border: 1px solid var(--cinza-200); border-radius: var(--radius-sm); background: var(--nude); padding: 14px; cursor: pointer; }
.cardAtivo { border-color: var(--navy); background: var(--branco); box-shadow: var(--sombra-sm); }
```

Substitua por (a classe `.lista` deixa de existir — não é mais usada no JSX depois da Task 1):

```css
.filtros { display: grid; grid-template-columns: minmax(220px, 1fr) minmax(180px, 280px); gap: 8px; align-items: center; margin-bottom: 16px; }
.conteudo { display: flex; flex-direction: column; gap: 10px; padding: 16px; background: var(--branco); border: 1px solid var(--cinza-200); border-radius: var(--radius-md); box-shadow: var(--sombra-sm); }
.card { border: 1px solid var(--cinza-200); border-radius: var(--radius-sm); background: var(--nude); padding: 14px; }
.cardAtivo { border-color: var(--navy); background: var(--branco); box-shadow: var(--sombra-sm); }
.cardCabecalho { cursor: pointer; }
```

- [ ] **Passo 2: Trocar `.detalhe` de coluna lateral pra divisória interna do card**

Localize (linha 37, a numeração pode ter mudado ligeiramente após o Passo 1 — procure pelo
texto):

```css
.detalhe { min-width: 0; padding: 16px; border-left: 1px solid var(--cinza-200); position: sticky; top: 12px; align-self: start; }
```

Substitua por:

```css
.detalhe { border-top: 1px solid var(--cinza-200); margin-top: 12px; padding-top: 12px; }
```

- [ ] **Passo 3: Simplificar o breakpoint mobile**

Localize o bloco `@media (max-width: 860px)`:

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

Substitua por (remove `.conteudo` da lista de grids — ele não é mais `display: grid` — e
remove a regra de `.detalhe`, que não precisa de override nenhum no mobile agora):

```css
@media (max-width: 860px) {
  .header, .headerAcoes { flex-direction: column; width: 100%; }
  .filtros, .linha2, .pastaLinha { grid-template-columns: 1fr; }
  .cardTopo, .detalheTopo, .revisaoLinha { flex-direction: column; }
  .acoesLinha { justify-content: flex-start; width: 100%; }
  .btnPrimario, .btnSecundario, .btnPerigo { width: 100%; }
}
```

- [ ] **Passo 4: Rodar o typecheck**

Rode: `npm run build`
Esperado: build completa sem erro.

- [ ] **Passo 5: Verificação visual no navegador**

Com `npm run dev` rodando, abra **Projetos**, escolha uma pasta e confirme:

1. A lista aparece como uma coluna única, dentro de uma única moldura branca com borda e
   sombra externas.
2. Cards fechados têm fundo nude; ao expandir, o card expandido fica com fundo branco, borda
   navy e sombra.
3. O corpo expandido mostra uma linha divisória horizontal fina acima dele, separando do
   cabeçalho.
4. Reduza a largura do navegador para menos de 860px (ou modo responsivo do DevTools): a lista
   continua em coluna única, sem nenhuma borda lateral solta, e os campos empilham como já
   acontecia antes.

- [ ] **Passo 6: Commit**

```bash
git add src/pages/Projetos.module.css
git commit -m "style: reestrutura CSS de Projetos para o card expandir em coluna unica"
```

---

## Critérios de aceite (repetidos da spec, pra conferência final)

- [ ] A lista de documentos aparece numa coluna só, dentro de uma única moldura.
- [ ] Ao escolher uma pasta, nenhum documento aparece expandido.
- [ ] Clicar no cabeçalho de um card expande ele no lugar, mostrando descrição (se houver),
      Editar/Inativar, Revisão atual, Nova revisão e Histórico.
- [ ] Clicar no cabeçalho de outro card fecha o anterior e abre o novo — nunca dois
      expandidos ao mesmo tempo.
- [ ] Clicar no cabeçalho do card já expandido fecha ele.
- [ ] Clicar em botões/campos dentro do corpo expandido não fecha o card.
- [ ] O botão "Abrir" no cabeçalho continua abrindo o PDF sem expandir o card.
- [ ] Gate por pasta, busca em título/descrição e todo o resto do módulo continuam
      funcionando exatamente como antes desta mudança.
- [ ] Rodrigo testou visualmente no navegador (desktop e mobile) e deu aceite.
