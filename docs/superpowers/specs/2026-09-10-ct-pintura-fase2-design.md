# Controle Tecnológico — Fase 2: pintura direta no tablet/celular · Spec de design

> Status: aprovado por Rodrigo em 10/09/2026, aguardando plano de implementação.
> Refina `docs/superpowers/specs/2026-09-09-controle-tecnologico-concreto-design.md` §2, §6, §7 —
> essa spec original já definiu pincel+borracha e o modelo de camada por caminhão (explorado com o
> companheiro visual na época); esta spec fecha os detalhes de interação que faltavam (zoom,
> espessura, desfazer, visibilidade das camadas anteriores) e a abordagem técnica de implementação.

## 1. Objetivo

Hoje (Fase 1, entregue) a única forma de registrar o mapa de uma concretagem é anexar uma foto ou
PDF já marcado à mão fora do app. A Fase 2 acrescenta a segunda opção que o schema já reserva desde
a Fase 1: escolher uma planta do catálogo e pintar direto na tela (tablet ou celular) qual área
cada caminhão cobriu, com pincel na cor do caminhão e borracha — sem trazer nenhuma ferramenta
externa. As duas opções continuam mutuamente exclusivas por concretagem (`planta_id` XOR
`anexo_url`, já travado por CHECK no banco).

## 2. Modelo de dados — nenhuma migração nesta fase

Todas as colunas já existem desde a migração `20260909_ct_schema.sql` (Fase 1) e a RLS de
`ct_plantas` já está correta (`ct_plantas_select`/`_insert`/`_update`, todas usando
`pode_editar_controle_tecnologico()` — confirmado por consulta direta ao banco em 10/09/2026):

- `ct_plantas`: `id, obra_id, nome, reutilizavel, pdf_path, imagem_path, ativo, criado_por, criado_em`
- `ct_concretagens.planta_id` (nullable, `REFERENCES ct_plantas(id)`) e
  `.pavimento_identificacao` (nullable, só preenchido quando a planta é reutilizável)
- `ct_caminhoes.pintura_url` (nullable, TEXT) — a camada PNG isolada daquele caminhão

Esta fase não cria nenhuma coluna nova nem política de RLS nova — mas precisa de **uma migração
pequena de trigger** (ver §8) pra fechar um gap encontrado nesta revisão: a policy
`ct_caminhoes_update` de hoje (`USING (pode_editar_controle_tecnologico())`, sem checar o status da
concretagem) permite alterar `pintura_url` mesmo com a concretagem já finalizada — de propósito
para os campos de laudo (que precisam continuar editáveis após finalizar, por decisão já tomada),
mas não para a pintura, que a spec original exige travar junto com o resto ao finalizar. Sem essa
trigger, a trava seria só de interface, contrariando a regra do projeto (CLAUDE.md §2) de que toda
permissão vem do banco, nunca só da tela.

## 3. Storage — convenção de path

A spec original previa `{obra_id}/{concretagem_id}/...`. Na prática, a Fase 1 já implementou (e
está em produção) um path plano `{obra_id}/{uuid}-{nomeArquivoStorage(nome)}` pra tudo nesse
bucket (anexo de concretagem, laudo). Esta fase segue a convenção que já está em produção, não a
aspiração original da spec:

- Planta (PDF original): `{obra_id}/{uuid}-{nome}.pdf`
- Planta (imagem convertida): `{obra_id}/{uuid}-{nome}.png`
- Pintura de um caminhão: `{obra_id}/{uuid}-pintura.png`

Mesmo bucket privado `controle-tecnologico`, mesmo limite (25MB, PDF+imagem) já configurado.

## 4. Cadastro de Plantas (`/controle-tecnologico/plantas`)

Tela nova, mesma régua de permissão do resto do módulo (admin ou equipe com `controle_tecnologico`;
cliente sem acesso). Lista as plantas ativas da obra + botão "+ Nova planta": nome, upload de PDF
(convertido em imagem no upload, reaproveitando **exatamente** `prepararImagemAnexo`/
`converterPdfParaImagem` de `src/lib/pdfParaImagem.ts` — a mesma função já usada pelo mapa da Fase 1
e pela Produção própria, sem nenhuma duplicação), checkbox "reutilizável". Sem edição de nome nem
de arquivo depois de criada nesta fase (só inativar) — reabrir upload editando o arquivo de uma
planta já usada em concretagens abriria uma inconsistência sem valor prático aqui.

## 5. Nova concretagem — escolha planta vs. anexo

A tela de criar concretagem (`ControleTecnologicoForm.tsx`, hoje só oferece anexo) ganha uma
escolha binária antes do formulário: "Usar planta do catálogo" ou "Anexar foto/PDF já marcado".
Escolhendo planta: seletor das plantas ativas da obra; se a selecionada é `reutilizavel = true`,
aparece o campo obrigatório "Pavimento" (texto livre, grava em `pavimento_identificacao`). O botão
de criar grava `planta_id` (e `pavimento_identificacao` se aplicável) em vez de fazer upload de
`anexo_url` — o CHECK `ct_concretagem_planta_xor_anexo` já impede os dois juntos.

## 6. Ferramenta de pintura — componente novo

Componente novo `src/components/FerramentaPintura.tsx`, distinto de `PlantaClicavel.tsx` (que
desenha **retângulos discretos** por clique-arraste, técnica de posicionamento em % via
`getBoundingClientRect()` — usada pela Produção própria pra selecionar paredes). A pintura aqui é
**traço livre**, então precisa de um `<canvas>` de verdade, não `<div>`s posicionados.

**Estrutura:** um container com `overflow: hidden` e `touch-action: none`, contendo uma camada
interna transformável (`transform: translate(panX, panY) scale(zoom)`) com: a imagem da planta, uma
`<img>` para cada camada já travada (caminhões já lançados, position absolute, só leitura), e um
`<canvas>` no topo pro caminhão sendo pintado agora — dimensionado (`canvas.width`/`height`) para o
tamanho natural em pixels da imagem da planta, não o tamanho exibido na tela, pra manter a mesma
resolução entre a planta e todas as camadas.

**Coordenadas do pincel sob zoom:** a conversão de toque/clique pra pixel do canvas usa
`canvas.getBoundingClientRect()` no momento do evento — esse retângulo já reflete o tamanho/posição
*renderizados* depois do `transform` CSS aplicado, então a mesma técnica já usada em
`PlantaClicavel.tsx:41-47` (`(clientX - rect.left) / rect.width`) funciona sem nenhuma matriz de
transformação manual, só multiplicando o resultado por `canvas.width`/`canvas.height` em vez de por
100. Nenhuma biblioteca de gestos é necessária.

**Gestos (confirmado com o Rodrigo):**
- 1 ponteiro ativo → desenha (pincel ou borracha, conforme a ferramenta selecionada).
- 2 ponteiros ativos simultâneos (pinça) → zoom + pan; desenho é suspenso enquanto há 2 ponteiros.
  Rastreado com um `Map<pointerId, {x,y}>` nos eventos `onPointerDown`/`onPointerMove`/`onPointerUp`
  — mesmo padrão de pointer events já usado em `PlantaClicavel.tsx`, só estendido pra 2 ponteiros.
  Zoom limitado a um intervalo razoável (ex.: 1×–6×) pra não perder a imagem de vista.
- Desktop (mouse, só 1 ponteiro nunca dá pinça): botões "+"/"−" de zoom e um botão "mover" que,
  enquanto ativo, transforma arrastar-com-o-mouse em pan em vez de traço.

**Pincel e borracha:**
- Pincel: `ctx.globalCompositeOperation = 'source-over'`, `strokeStyle` = cor do caminhão (já
  gravada em `ct_caminhoes.cor`), `lineCap`/`lineJoin = 'round'`.
- Borracha: `ctx.globalCompositeOperation = 'destination-out'` — apaga até a transparência real do
  PNG, não pinta de branco por cima.
- Espessura ajustável (confirmado): 3 predefinições (fino/médio/grosso), calculadas como uma fração
  do `canvas.width` (ex.: 0,3% / 0,8% / 1,5%) — assim a espessura fica proporcional
  independentemente da resolução da planta original, em vez de um valor fixo em pixels que ficaria
  grosso demais numa planta pequena ou fino demais numa grande.
- Sem desfazer (confirmado) — só a borracha corrige.

**Camadas anteriores travadas:** ao abrir a ferramenta pro caminhão N, todos os caminhões já
lançados com `pintura_url` preenchido nessa concretagem aparecem como `<img>` de só leitura, na
ordem em que foram lançados, carregadas via `createSignedUrl` (mesmo padrão já usado pro laudo em
`ControleTecnologicoForm.tsx`, não `.download()` direto). Confirmado com o Rodrigo: precisa ver o
que já foi pintado antes pra não sobrepor.

**Salvar:** ação explícita (não salva a cada traço, confirmado) — botão "Salvar pintura" faz
`canvas.toBlob('image/png')` e sobe pro Storage, gravando `pintura_url` em `ct_caminhoes`. Como as
camadas travadas são `<img>` **separadas**, nunca desenhadas dentro do canvas ativo, o PNG resultante
contém só os traços deste caminhão — continua sendo a "camada isolada" que a spec original exigia
(corrigir um caminhão nunca risca afetar a pintura de outro).

## 7. Lançar caminhão — integração

Sem mudança no formulário de lançar caminhão em si (fornecedor, NF, lacre, horários, slump — tudo
como já está). Mudança só no que acontece **depois de salvar**: se `concretagem.planta_id` não é
nulo, a Ferramenta de Pintura abre automaticamente pro caminhão recém-criado, em vez de voltar
direto pra lista. Se a concretagem usa anexo (não planta), nada muda — comportamento atual mantido.

## 8. Corrigir pintura de um caminhão já lançado

Novo botão "🖌️ Corrigir pintura" na lista de caminhões, ao lado de "Anexar laudo" — visível só
quando `concretagem.status === 'aberta'`. Abre a Ferramenta de Pintura pré-carregando o PNG
existente no canvas (`ctx.drawImage` da imagem atual antes de habilitar novos traços) — os traços
novos se somam ao que já existia; salvar sobrescreve `pintura_url` no mesmo caminho.

**Trava no banco (não só na interface):** nova migração com um trigger `BEFORE UPDATE ON
ct_caminhoes`, mesmo padrão de `ct_restringir_laudo` (`supabase/migrations/20260909_ct_triggers.sql`)
e `ct_travar_caminhao_finalizada` (INSERT) — mas para `pintura_url` em UPDATE:

```sql
CREATE OR REPLACE FUNCTION ct_restringir_pintura() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_status status_concretagem;
BEGIN
  IF NEW.pintura_url IS DISTINCT FROM OLD.pintura_url THEN
    SELECT status INTO v_status FROM ct_concretagens WHERE id = NEW.concretagem_id;
    IF v_status = 'finalizada' THEN
      RAISE EXCEPTION 'Não é possível alterar a pintura de uma concretagem já finalizada.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_ct_restringir_pintura
  BEFORE UPDATE ON ct_caminhoes
  FOR EACH ROW EXECUTE FUNCTION ct_restringir_pintura();
```

Só reage quando `pintura_url` de fato muda — não interfere em nada dos campos de laudo, que
continuam governados só por `ct_restringir_laudo` (admin-only, editável mesmo finalizada, sem
mudança nesta fase).

## 9. Geração do PDF — achatamento planta + camadas

Nova função `achatarPlantaEPinturas` em `src/lib/ctPinturaFlatten.ts`:

```ts
export async function achatarPlantaEPinturas(
  planta: { imagem_path: string },
  caminhoes: CtCaminhao[],
): Promise<ImagemAnexo> {
  // baixa planta.imagem_path, desenha num canvas do tamanho natural da imagem,
  // depois desenha por cima a pintura_url de cada caminhão (na ordem de criado_em),
  // devolve { dataUrl, width, height } — mesmo formato de prepararImagemAnexo.
}
```

Em `gerarPdfConcretagem` (`src/lib/controleTecnologicoPdf.ts`), a única mudança é a origem da
`imagem` antes de chamar `desenharPaginaMapa` — que **não muda nada**, já que só espera
`{dataUrl, width, height}` e não sabe (nem precisa saber) se veio de um anexo ou de uma pintura:

```ts
const imagem = d.concretagem.anexo_url
  ? await prepararImagemAnexo(anexoBlob, d.concretagem.anexo_url)
  : await achatarPlantaEPinturas(d.planta!, d.caminhoes)
```

`DadosPdfConcretagem` ganha um campo novo opcional `planta?: { imagem_path: string }`, preenchido
por quem chama `gerarPdfConcretagem` (`ControleTecnologicoForm.tsx`'s `imprimir()`) buscando a
planta pelo `concretagem.planta_id` junto com o resto dos dados que já busca ali. `desenharCabecalho`,
`desenharPaginaTabela` e `desenharRodapeTodasPaginas` — nada disso muda.

## 10. Permissões — já definidas, reafirmadas

Sem mudança em relação à spec original: lançar caminhão, pintar/corrigir pintura, finalizar
concretagem e cadastrar planta são admin ou equipe com o módulo `controle_tecnologico`. Cliente não
acessa nada deste submódulo. Aprovar/reprovar laudo continua exclusivo do admin (trigger já
existente, não afetado por esta fase).

## 11. Fora de escopo

- Mapa interativo pós-pronto (tocar numa área pintada pra ver dados do caminhão) — já descartado na
  spec original.
- Compartilhar catálogo de plantas com a Produção própria — catálogos deliberadamente separados.
- Editar nome/arquivo de uma planta já cadastrada (só inativar).
- Suporte a HEIC/formatos exóticos na planta em si — a planta é sempre um PDF (a maioria dos casos
  reais) ou uma foto já normalizada pelo mesmo `normalizarImagemParaPng` que a Fase 1 usa pro anexo,
  então já herda essa cobertura sem trabalho extra.
- Desfazer (confirmado com o Rodrigo) — só a borracha.
- Qualquer acesso do cliente a este submódulo.
