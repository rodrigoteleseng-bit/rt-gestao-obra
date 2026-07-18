# Produção própria — excluir parede e redimensionar o rótulo · Spec curta

> Status: aprovado por Rodrigo em 18/07/2026.
> Dois ajustes pequenos e independentes dentro da feature de seleção de parede por
> planta PDF (`docs/superpowers/specs/2026-07-17-producao-selecao-parede-pdf-design.md`),
> na aba **Plantas** (cadastro). Mesmo padrão de spec curta já usado em
> `docs/superpowers/specs/2026-07-17-producao-rotulo-parede-design.md`.

## Problema

Testando o lançamento por parede clicável, Rodrigo encontrou duas faltas:

1. Não existe forma de remover uma parede cadastrada por engano — a lista de paredes
   só tem "Editar".
2. O nome (rótulo) da parede já pode ser arrastado e girado livremente, mas o
   tamanho do texto é fixo — em plantas com paredes próximas o rótulo às vezes não
   cabe no espaço disponível.

## Decisão 1 — Excluir parede

- Novo botão **"Excluir"** na lista de paredes da aba Plantas, ao lado do "Editar"
  já existente — mesmo padrão Editar/Inativar lado a lado já usado em Almoxarifado
  e Trabalhadores.
- É **inativação lógica** (`UPDATE producao_paredes SET ativo = false`), nunca
  `DELETE` — segue a regra do projeto (`CLAUDE.md` §6.4, "nada se apaga, tudo se
  inativa"). Nenhuma migração de RLS é necessária: a política de SELECT de
  `producao_paredes` já tem a cláusula `(ativo AND papel IN (...)) OR
  pode_editar_medicoes()`, então quem pode editar continua enxergando a parede
  inativa se precisar (mesma lição do achado crítico de RLS de 13/07/2026).
- Confirmação usa o diálogo padrão do app (`useConfirmDialog`, já usado em
  Almoxarifado/Definições):
  - Se a parede **não** tem nenhum `produzido_m2 > 0` em
    `producao_paredes_progresso` (nenhum sobrado), mensagem simples: "Excluir esta
    parede?".
  - Se **já tem** produção lançada em algum sobrado, a mensagem avisa o total já
    produzido (soma de `produzido_m2` por serviço/face) mas ainda permite
    confirmar — decisão já validada com o Rodrigo (avisar e permitir, não
    bloquear).
- Permissão: a mesma de hoje para editar parede (`pode_editar_medicoes()` —
  admin ou equipe com o módulo liberado). Não é ação exclusiva de admin, porque é
  correção de erro de cadastro, não uma decisão de governança (diferente de
  aprovação de medição).
- Efeito: a parede some da lista de cadastro (aba Plantas) e da planta de
  lançamento diário (aba Lançamentos). Lançamentos e progresso já registrados
  contra essa parede continuam intactos no histórico — nada é apagado.

## Decisão 2 — Redimensionar o rótulo

- Nova coluna `rotulo_escala NUMERIC(3,2) NOT NULL DEFAULT 1` em
  `producao_paredes`, com `CHECK (rotulo_escala >= 0.5 AND rotulo_escala <= 2.0)`.
  `1` = tamanho atual (sem mudança visual pra quem não mexer).
- Dois botões pequenos **"A−" / "A+"** na lista de paredes, próximos ao nome. Cada
  clique ajusta ±0.1 (faixa 0.5–2.0) e salva imediatamente — mesmo espírito de
  "salva ao soltar" que mover/girar já têm, só que aqui é "salva ao clicar".
- Renderização: o rótulo já usa `transform: rotate(${rotacao}deg)` com
  `transform-origin: left center`; passa a ser
  `transform: rotate(${rotacao}deg) scale(${escala})`, reaproveitando a mesma
  origem — a escala parte do mesmo ponto de ancoragem do giro, sem descolar do
  lugar onde foi arrastado.
- Fora de escopo: redimensionar arrastando uma alça diretamente na planta (optamos
  pelos botões — mais preciso no toque do celular do que uma terceira alcinha
  colada nas duas que já existem) e desfazer/histórico do tamanho anterior.

## Modelo de dados — resumo

| Tabela | Mudança |
|---|---|
| `producao_paredes` | `rotulo_escala NUMERIC(3,2) NOT NULL DEFAULT 1 CHECK (rotulo_escala >= 0.5 AND rotulo_escala <= 2.0)` |
| `producao_paredes` | nenhuma mudança de schema pra exclusão — usa a coluna `ativo` que já existe |

Nenhuma mudança de RLS, trigger ou RPC — exclusão e redimensionamento são `UPDATE`
direto nas colunas `ativo` e `rotulo_escala`, cobertos pelas policies existentes.

## Fora de escopo

- Excluir a partir da tela de lançamento diário (só na aba Plantas, mesmo
  critério já usado pra mover/girar o rótulo).
- Restaurar (reativar) uma parede excluída pela interface — se precisar, é ajuste
  direto no banco por enquanto.
- Redimensionar por gesto de pinça (pinch-to-zoom) na planta.
