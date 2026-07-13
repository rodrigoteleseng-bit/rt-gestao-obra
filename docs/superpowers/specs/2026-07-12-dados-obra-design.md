# Dados da Obra — tela de administração (design)

> Motivado por uma lacuna descoberta ao testar o redesenho do Dashboard (12/07/2026): o card-herói só mostra Prazo/Semana/Restam quando `obra.data_inicio` e `obra.data_fim_prevista` existem, e a obra piloto "Tharsos Imperial" nunca teve esses campos preenchidos — porque **nenhuma tela do app edita dados da obra**. Eles só existem via SQL direto desde a migração da Fase 0.

## 1. Objetivo

Uma tela `/dados-obra` onde o admin vê todas as obras cadastradas, edita os dados de qualquer uma, e cria obras novas.

## 2. Decisões (perguntas respondidas com o Rodrigo em 12/07/2026)

- **Quem edita:** só `admin`. A tela só reforça na UI o que o RLS já impõe no banco (`obras_insert`/`obras_update` já exigem `meu_papel() = 'admin'` desde a Fase 0) — nenhuma policy nova.
- **Campos:** todos os 8 campos existentes do tipo `Obra` (nome, descrição, endereço, cidade, estado, data_inicio, data_fim_prevista, status). Nenhum campo novo é adicionado ao banco.
- **Escopo:** editar obras existentes **e** criar obras novas (não só a piloto) — prepara o app para quando a RT tiver uma segunda obra.
- **Obra ativa — correção de premissa (12/07/2026):** o desenho original desta seção previa um botão "Selecionar como obra ativa" na lista, presumindo que `selecionarObra` (em `ObraContext.tsx`) não tinha nenhum gatilho de UI. Isso estava errado: `Layout.tsx:142-155` já tem um `<select>` no cabeçalho que chama `selecionarObra` e aparece automaticamente quando `obras.length > 1` — só fica oculto hoje porque existe 1 obra só. Confirmado com o Rodrigo: **este design não duplica esse controle**. Trocar a obra ativa continua sendo feito exclusivamente pelo seletor do cabeçalho, que passa a aparecer sozinho assim que uma segunda obra for criada por esta tela.
- **Onde fica no app:** um card próprio no Dashboard, visível só para `perfil?.papel === 'admin'` — fora dos grupos por módulo (`CARDS_MODULOS`), já que isso não é um módulo operacional (RDO, Compras etc.), é configuração administrativa, mesmo padrão de visibilidade já usado hoje para o link "Usuários" no menu lateral (`Layout.tsx:104`, `perfil?.papel === 'admin' &&`).

## 3. Estrutura da tela

Um único arquivo `src/pages/DadosObra.tsx` (seguindo o padrão de página simples já usado em `Fornecedores.tsx`: lista + formulário inline no mesmo componente, sem sub-rota de formulário separada — 8 campos não justificam uma tela própria como `CompraForm`/`PendenciaForm`):

1. **Lista de obras** — todas cadastradas (`ativo = true`, qualquer `status`), ordenadas por nome. Cada linha mostra: nome, cidade/estado, badge de status, e um selo "Ativa" na que é a `obraAtiva` do momento (só leitura — trocar a ativa é feito pelo seletor do cabeçalho, não por esta tela). Botão "Editar" em cada linha.
2. **Botão "+ Nova obra"** — limpa o formulário para modo criação.
3. **Formulário** (mesmo componente para criar e editar — clicar em "Editar" numa linha da lista carrega os dados nele, em modo edição):
   - Nome * (obrigatório)
   - Descrição (textarea opcional)
   - Endereço, Cidade, Estado (2 letras)
   - Data de início, Previsão de término (inputs `date`)
   - Status (select: `ativa` / `pausada` / `concluida` / `arquivada`)
   - Botão Salvar (grava `criado_por`/`criado_em` só na criação; update não toca nesses campos)

## 4. Fluxo de dados

- **Leitura:** a tela busca `obras` direto via Supabase (`select('*').eq('ativo', true).order('nome')`) — não usa o array `obras` do `ObraContext` porque o contexto hoje só traz `status in ('ativa','pausada')` (linha `ObraContext.tsx:29`); a tela de admin precisa ver/reativar obras `concluida`/`arquivada` também. Essa query da tela é local ao componente, não uma mudança no contexto.
- **Escrita:** `insert`/`update` direto na tabela `obras`, sem endpoint novo.
- **Após criar/editar:** a lista recarrega; se a obra editada é a `obraAtiva`, o resto do app (Dashboard, header) reflete os novos dados na próxima renderização porque consome `obraAtiva` do mesmo `ObraContext` — esta tela não precisa forçar nada, só recarregar sua própria lista local.
- **Dashboard:** um novo card "Dados da Obra" (ícone de traço, mesmo estilo dos ícones do redesenho de 12/07/2026) adicionado fora do array `CARDS_MODULOS`, renderizado condicionalmente só quando `perfil?.papel === 'admin'`, reaproveitando as classes CSS `.card`/`.cardAtivo` já existentes — sem novo CSS de card.

## 5. Rastreabilidade e regras duras (§6 do CLAUDE.md)

- Toda obra criada grava `criado_por` (usuário logado) e `criado_em` (timestamp do servidor).
- Nenhuma exclusão física — "desativar" uma obra é mudar `status` para `arquivada`, nunca `DELETE` nem tocar em `ativo`.
- RLS já existente é suficiente; nenhuma migração de banco é necessária neste design.

## 6. Fora de escopo

- Campo `ativo` (soft-delete da obra) não é exposto na tela — não há hoje um fluxo de "excluir obra" definido, só o `status = arquivada`.
- Nenhuma mudança em `ObraContext.tsx` nem em `Layout.tsx` — o seletor de obra ativa no cabeçalho já existe e continua sendo o único lugar que troca a obra ativa.
- Nenhuma tela de gestão de `unidades` (sobrados/portaria/área comum) — isso já existe desde a Fase 0 em outro lugar e não faz parte deste design.
