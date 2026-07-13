# Almoxarifado — Fornecedor + NF na entrada de material (design)

> Pedido do Rodrigo em 13/07/2026: hoje a entrada de material só vincula a um pedido de compra. Ele quer também poder registrar fornecedor + número da NF direto na entrada (opcional, sem virar regra obrigatória), pra no futuro conseguir consultar em quais fornecedores já comprou cada material e ter histórico de preço (preço fica pra depois — este design só captura fornecedor e NF).

## 1. Objetivo

Dois campos novos e opcionais no formulário "+ Entrada de material" do Almoxarifado: fornecedor (dropdown do cadastro já existente) e número da NF (texto livre). Aparecem no extrato do material que já existe na tela.

## 2. Decisões (perguntas respondidas com o Rodrigo em 13/07/2026)

- **Coexistência com pedido de compra:** fornecedor + NF ficam disponíveis em **toda** entrada, vinculada ou não a um pedido de compra — são informações independentes, não uma substituição.
- **Preço:** fora de escopo por agora. Só fornecedor + NF.
- **Formato da NF:** só número em texto livre, sem anexo (foto/PDF) — mais rápido de preencher.
- **Consulta "por fornecedor":** fora de escopo deste design. Os dados ficam capturados no movimento e visíveis no extrato do material (tela que já existe); uma tela de consulta agregada por fornecedor é uma fase futura, quando houver mais dados acumulados.
- **Obrigatoriedade:** nenhum dos dois campos é obrigatório — continua possível lançar entrada sem informar fornecedor/NF, como hoje.

## 3. Modelo de dados

```sql
ALTER TABLE estoque_movimentos
  ADD COLUMN fornecedor_id UUID REFERENCES fornecedores(id),
  ADD COLUMN numero_nf     TEXT;
```

- Ambas nullable, sem `DEFAULT`, sem `CHECK` — o app decide quando faz sentido preenchê-las (convenção "entrada", não regra de banco, mesmo padrão já usado pra `pedido_item_id`/`requisicao_numero`/`unidade_id` na mesma tabela, que também são campos "só fazem sentido pra um tipo de movimento" sem constraint).
- RLS de `estoque_movimentos` já existente cobre a tabela inteira (não é por coluna) — nenhuma policy nova.

## 4. Telas

- **`PainelEntrada` (formulário "+ Entrada de material"):** dois campos novos, opcionais, junto dos já existentes (quantidade, observação, pedido/item):
  - Select "Fornecedor" — opção vazia + lista de `fornecedores` ativos (mesmo padrão de `CompraForm.tsx:895-897`).
  - Input de texto "Nº da NF".
- **Extrato do material (`AbaEstoque`, painel que já existe):** a lista de movimentos já mostra tags condicionais (`Req. NNNNN`, `Pedido de compra`, `Destino: X` etc. — `Almoxarifado.tsx:439-445`). Acrescenta `Fornecedor: {nome}` (quando `fornecedor_id` não é nulo) e `NF: {numero_nf}` (quando preenchido).

## 5. Fluxo de dados

- `AbaEstoque` passa a buscar `fornecedores` (`.eq('ativo', true).order('nome')`) no mesmo `Promise.all` que já busca materiais/saldos/unidades — nenhuma query nova isolada, só mais uma tabela no fetch existente.
- Lista de fornecedores repassada como prop pro `PainelEntrada` (pro select) e usada num `Map<string, string>` (id → nome) pra exibir no extrato.
- `PainelEntrada.salvar()` inclui `fornecedor_id: fornecedorSel || null` e `numero_nf: numeroNf.trim() || null` no mesmo `insert` em `estoque_movimentos` que já existe hoje — nenhuma chamada nova ao banco.
- `EstoqueMovimento` (`src/lib/supabase.ts`) ganha os campos `fornecedor_id: string | null` e `numero_nf: string | null`.

## 6. Fora de escopo

- Campo de preço/valor (unitário ou total) — fase futura.
- Anexo de foto/PDF da NF — só número em texto.
- Tela ou filtro de consulta "por fornecedor" / histórico de preço — os dados ficam capturados, a consulta agregada é outro design quando houver necessidade real.
- Nenhuma mudança em `saída avulsa` ou `lançamento de requisição` — os campos novos só aparecem no formulário de entrada.
