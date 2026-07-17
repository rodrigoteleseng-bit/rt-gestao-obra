# Produção própria — reposicionar/girar o nome da parede na planta · Spec curta

> Status: aprovado por Rodrigo em 17/07/2026, implementado no mesmo dia.
> Ajuste pequeno dentro da feature de seleção de parede por planta PDF
> (`docs/superpowers/specs/2026-07-17-producao-selecao-parede-pdf-design.md`).

## Problema

Depois de cadastrar as paredes reais na planta, paredes próximas umas das outras
tiveram o nome (rótulo) sobreposto, ilegível — o rótulo sempre nascia fixo no canto
superior esquerdo da faixa clicável.

## Decisão

- O nome de cada parede pode ser **arrastado livremente** e **girado em qualquer
  ângulo** (não só 0°/90°), pra caber no espaço disponível na planta real.
- O ajuste só é feito na aba **Plantas** (cadastro), nunca na tela de lançamento
  diário — quem lança produção só vê o resultado já posicionado.
- Posição/ângulo ficam salvos por parede (`rotulo_pos_x`, `rotulo_pos_y`,
  `rotulo_rotacao` em `producao_paredes`, todos opcionais/com padrão), então uma vez
  ajustado, fica assim pra sempre até alguém arrastar de novo.
- Parede sem ajuste continua exatamente como antes (nome no canto da faixa, sem
  giro) — mudança não afeta paredes já cadastradas até serem tocadas.
- Sem regra de negócio nova: é posição visual, então a gravação usa a mesma
  permissão de UPDATE que já existia (`pode_editar_medicoes()`), sem RPC nova.

## Fora de escopo

- Ajustar o rótulo durante o lançamento diário.
- Desfazer/histórico de posições anteriores do rótulo.
