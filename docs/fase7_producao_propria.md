# Fase 7 — Produção própria

> Implementada em 16/07/2026; aguardando teste de campo e aceite de Rodrigo.

## Entrega

- Cadastro de salário por trabalhador, com vigência histórica e divisor fixo 30.
- Produção diária de alvenaria e reboco por parede/face.
- Comprimento × altura, com múltiplas portas, janelas e outros vãos.
- Preço por m² congelado em cada lançamento.
- Rateio igual entre N profissionais, com soma financeira exata.
- Dia salarial integral com motivo e bloqueio de conflito com produção na mesma data.
- Medição `MP-001...` por profissional e período.
- Resumo de produção, parcela salarial e total.
- Aprovação exclusiva do admin, snapshots imutáveis, status paga e cancelamento auditável.
- Produção própria integrada como segundo regime dentro de `/medicoes`.
- Cliente sem acesso; equipe depende do módulo `medicoes`; regras protegidas por RLS.

## Banco

Migração `supabase/migrations/20260716_fase7_producao_propria.sql`, aplicada no projeto de
produção em 16/07/2026. Validação após aplicação: 9 tabelas `producao_%`, 21 policies e 15
funções. Nenhum salário ou lançamento fictício foi inserido.

## Teste guiado

1. Em Efetivo, confirmar que pedreiro e ajudante estão cadastrados nominalmente.
2. Em Produção própria → Salários, cadastrar R$ 4.405,60 para o pedreiro e R$ 2.405,60 para o
   ajudante, escolhendo a data real de início da vigência.
3. Lançar uma parede com dois profissionais e uma abertura; conferir área e rateio.
4. Registrar um dia salarial de cada profissional e confirmar o divisor 30.
5. Tentar registrar produção no mesmo dia salarial; o banco deve bloquear.
6. Em Medições → Produção própria, criar período, conferir totais e aprovar como admin.
7. Confirmar que a produção aprovada não aparece em outra medição.
8. Marcar como paga e verificar que os valores permanecem inalterados.
9. Repetir os fluxos principais no celular.

## Fora do MVP

- Meio dia; rateio desigual; encargos e descontos; integração bancária/financeira; serviços
  além de alvenaria e reboco; vínculo automático com orçamento/avanço físico.
