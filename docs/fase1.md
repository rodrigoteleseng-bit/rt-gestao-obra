# Fase 1 — Orçamento · Registro de entrega

> Status: **concluída e aceita** (07/07/2026) — navegação testada no desktop e celular pelo Rodrigo.
> Pendência transferida para iteração futura: exportação Excel/PDF do orçamento.

## Dados importados

Fonte: planilha `ORÇAMENTO RESIDENCIAL V.03 - Orçamento Analítico.xlsx` (aba única, formato hierárquico de orçamento analítico).

| Métrica | Valor |
|---|---|
| Etapas | 159 |
| Serviços | 3.475 |
| Total da obra | **R$ 10.413.111,11** |
| Por sobrado (×13) | 242 serviços · R$ 562.086,83 |
| Área Comum | 164 serviços · R$ 726.842,26 |
| Canteiro de Obras | 71 serviços · R$ 2.264.137,38 |
| Portaria | 94 serviços · R$ 115.002,68 |

## Regras de parsing (script `scripts/importar-orcamento.cjs`)

- Seções da planilha mapeiam para unidades: código `1.3` → 13 sobrados (item replicado por sobrado), `1.2.1` → Portaria, `1.2.2/1.2.3/1.4/1.5` → Área Comum, `1.1/1.6/1.7/2` → Canteiro.
- Quantidades da seção CASAS vêm no formato `"18,60 x 13,00 = 241.8"` → quantidade por sobrado = fator antes do `x 13` (regex `/([\d,]+)\s*x\s*13/`).
- Primeira etapa acima da seção-unidade vira ETAPA; a mais interna vira `grupo` do serviço.
- SQL gerado 100% ASCII usando escapes `E'\uXXXX'` (evita corrupção de encoding no PowerShell 5.1).
- Saída: `scripts/orcamento_import.sql` (dados versionados no repositório para rastreabilidade).

## Banco (migração `20260707_fase1_orcamento.sql`)

- `etapas` ganhou colunas `codigo` e `grupo`.
- `servicos` recriada: `id, etapa_id (FK etapas), codigo, nome, grupo, und, quant NUMERIC(14,4), valor_unit NUMERIC(14,4), total NUMERIC(14,2), ativo, criado_em, criado_por`.
- RLS: SELECT para autenticados; escrita só admin (`meu_papel() = 'admin'`).
- `total` de item por sobrado = `quant × valor_unit` (ou total da planilha ÷ 13 quando não há fator por sobrado).

## Como a importação foi executada (técnica reutilizável)

SQL grande (764 KB) não passa pelo contexto do Claude nem pelo MCP com eficiência. Solução:
1. Edge function temporária `exec-import-sql` — recebe `{sql}` via POST, executa com `npm:postgres` + env `SUPABASE_DB_URL`, protegida por segredo em header + JWT.
2. Script Node local envia os arquivos SQL em lotes de 200 linhas direto do disco.
3. Function **neutralizada após o uso** (v2 responde 410) — reativar exige novo deploy.

## Tela `/orcamento` (`src/pages/Orcamento.tsx`)

- Árvore expansível Unidade → Etapa → Serviço, com totais em cada nível e total da obra no topo.
- Busca por nome/código/grupo — filtra e expande automaticamente os resultados.
- Somente leitura (alteração do orçamento base = nova importação pelo admin).
- Carrega os 3.475 serviços paginando `.range()` de 1000 em 1000.
- Visível para todos os papéis (cliente vê valores — decisão confirmada na Fase 0).

## Reimportação (se a planilha mudar)

1. Ajustar caminho do Excel em `scripts/importar-orcamento.cjs` e rodar `node scripts/importar-orcamento.cjs`.
2. Apagar dados atuais (`DELETE FROM servicos; DELETE FROM etapas WHERE placeholder = false;`) — atenção quando houver lançamentos vinculados (fases 2+): aí será preciso estratégia de versionamento de orçamento, não delete.
3. Executar o SQL gerado (técnica da edge function acima, ou em partes via MCP).
