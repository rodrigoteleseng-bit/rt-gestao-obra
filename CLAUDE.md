# CLAUDE.md — App de Gestão de Obra | RT Engenharia

> Documento de regras do projeto. Este arquivo governa todo o desenvolvimento do aplicativo.
> Nenhuma implementação contraria o que está aqui sem aprovação explícita do Rodrigo.
>
> Legenda de dados: [extraído] = definido pelo Rodrigo · [estimado] = proposta técnica do Claude, base citada · [lacuna] = pendente de definição · [sugestão] = opcional, aguarda aprovação

---

## 1. Contexto do negócio

- **Empresa:** RT Engenharia — Rodrigo Teles Silva, engenheiro civil, CREA 1018712895 D/GO, Goiânia/GO. [extraído]
- **Atuação:** administração de obras, empreitada global, projetos e reformas, com controle de qualidade, cronograma físico-financeiro e compras. [extraído]
- **Obra piloto do app:** incorporação com **13 sobrados + portaria + área comum** (referência: Tharsos Imperial – Sobrado Tipo, Aparecida de Goiânia). [extraído]
- **Orçamento base:** existe levantamento de quantitativos em planilha Excel multi-abas já elaborado. A Fase 1 é de **importação e estruturação**, não de criação do zero. [extraído]
- **Identidade visual:** paleta navy + terracota, tipografia Sora/Inter, tagline "Inteligência Aplicada". Aplicar em todo o app e nos PDFs exportados (RDO, relatórios). [extraído]

## 2. Usuários e permissões

| Papel | Quem é | Permissão |
|---|---|---|
| `admin` | Rodrigo | Total: configura obra, orçamento, usuários, edita e exclui tudo |
| `equipe` | 2 a 5 colaboradores de campo/escritório | Lança RDO, avanço, financeiro, almoxarifado, pendências. Não altera orçamento base nem cronograma aprovado |
| `cliente` | Clientes/investidores | **Somente leitura** de dashboards, Curva S, avanço, RDO e galeria. Nunca vê custos unitários internos, salvo liberação explícita do admin por obra |

[extraído] — os três papéis foram definidos pelo Rodrigo. A restrição de custos ao cliente é [sugestão] pendente de confirmação na Fase 0.

**Regra dura:** toda permissão é implementada com Row Level Security no banco (Supabase RLS), nunca só na interface.

## 3. Stack e arquitetura [extraído — aprovado pelo Rodrigo em 07/07/2026]

- **Backend/banco:** Supabase (Postgres + Auth + Storage + RLS).
- **Frontend:** aplicativo web responsivo **PWA** (instalável no celular, funciona em desktop). React + Vite. [estimado — padrão de mercado para PWA; alternativas serão apresentadas na Fase 0 se relevante]
- **Fotos:** Supabase Storage, organizadas por obra/unidade/data.
- **Georreferenciamento:** API de geolocalização do navegador, gravada em cada RDO (lat/long + precisão + timestamp).
- **Hospedagem do frontend:** [lacuna] — definir na Fase 0 (opções: Vercel, Netlify, Cloudflare Pages — todas com plano gratuito inicial).
- **Migrações de banco:** versionadas no repositório (`/supabase/migrations`), nunca alteração manual direta em produção.

## 4. Modelo de dados mestre

Hierarquia que **todos os módulos respeitam**. Nenhum módulo cria hierarquia paralela.

```
OBRA
 └── UNIDADE (Sobrado 01…13, Portaria, Área Comum, Canteiro)
      └── ETAPA (fases macro da EAP: fundação, estrutura, alvenaria, cobertura, instalações, acabamento…)
           └── SERVIÇO (item orçável: quantitativo + unidade + valor unitário)
```

- A EAP do app deriva da EAP/escopo já usados na metodologia RT Engenharia (skills `eap-obra`, `estrutura-orcamento-obra`). [extraído]
- A estrutura exata de etapas e serviços da obra piloto vem da **planilha de orçamento do Rodrigo** — importada na Fase 1. [extraído]
- Todo lançamento (nota, avanço, RDO, pendência, movimentação de almoxarifado) referencia obrigatoriamente um nó dessa hierarquia — no mínimo até ETAPA; idealmente até SERVIÇO.

## 5. Módulos e fases de desenvolvimento [extraído — plano aprovado]

Ordem aprovada. Cada fase só inicia após a anterior ser validada pelo Rodrigo em uso real.

| Fase | Módulo | Entrega principal |
|---|---|---|
| 0 | Fundação | Modelo de dados, cadastro da obra piloto (13 sobrados + portaria + área comum), login, papéis, RLS |
| 1 | Orçamento | Importação da planilha existente, estrutura com quantitativos e valores unitários |
| 2 | Cronograma + Avanço físico | Previsto por tarefa, preenchimento semanal do executado, dashboard real x planejado |
| 3 | Financeiro | Lançamento de notas/gastos/materiais vinculados ao orçamento, previsto x realizado, **Curva S**, projeção de custo final |
| 4 | RDO | Relatório diário com geolocalização, fotos, clima, efetivo, exportação PDF com identidade RT |
| 5 | Pendências | Por unidade (seleciona Sobrado 1 → serviços pendentes + observações), status e responsável |
| 6 | Suprimentos (Compras + Almoxarifado) | **Compras:** pedido vinculado ao orçamento → cotações com anexos → aprovação → conferência com NF. **Almoxarifado:** entrada/saída de materiais, empréstimo de ferramentas com devolução diária e alerta de não devolvido |
| 7 | Extras (**todos aprovados**) | Medições de empreiteiros · Controle de contratos · FVS/checklist de qualidade · Galeria de fotos por unidade · Gestão de efetivo · Alertas (ferramenta não devolvida, etapa estourando orçamento, tarefa atrasada) |

### Amarrações entre módulos (regras de integração)
1. **Financeiro ↔ Orçamento:** todo gasto lançado aponta para uma etapa/serviço do orçamento. Gasto sem vínculo não é aceito pelo sistema — vai para fila "a classificar".
2. **Avanço físico ↔ Cronograma:** o % executado semanal alimenta o dashboard real x planejado e a Curva S física.
3. **Medição ↔ Avanço ↔ Financeiro (Fase 7):** avanço aprovado → medição liberada → lançamento financeiro. Ciclo fechado, sem etapa pulada.
4. **RDO ↔ Efetivo ↔ Almoxarifado:** efetivo do dia e retiradas de ferramenta alimentam o RDO automaticamente quando existirem.
5. **Pendência ↔ FVS (Fase 7):** serviço só muda para "concluído" com checklist de verificação aprovado, quando o FVS estiver ativo para aquela etapa.
6. **Compras ↔ Almoxarifado ↔ Financeiro (conferência tripla):** cotação aprovada x quantidade recebida no almoxarifado x NF lançada. Divergência em valor ou quantidade em qualquer ponta gera alerta automático. NF sem pedido de compra vinculado vai para fila "a classificar".

### Regras do módulo Suprimentos — Compras [extraído em 07/07/2026]
- **Fluxo:** pedido de compra (vinculado a etapa/serviço do orçamento) → recebimento de cotações com **anexo obrigatório** do orçamento do fornecedor (PDF/foto) → comparação lado a lado → aprovação → acompanhamento de entrega → conferência com NF.
- **Aprovação:** exclusiva do papel `admin` (Rodrigo). Equipe cria pedidos e cadastra cotações, mas não aprova.
- **Número de cotações:** livre — aprovação permitida com 1 cotação. O sistema apenas registra quantas cotações o pedido teve (rastreabilidade, sem bloqueio).
- **Rastreabilidade:** toda aprovação grava aprovador, data/hora, cotação vencedora, cotações preteridas e anexos. Nada se sobrescreve.
- **Status do pedido:** rascunho → em cotação → aprovado → pedido enviado → recebido parcial/total → conferido com NF → encerrado.

## 6. Regras de rastreabilidade (prioridade máxima do projeto)

1. Todo registro grava **autor, data/hora e vínculo à hierarquia** (obra → unidade → etapa → serviço). Sem exceção.
2. **Nenhum dado calculado sem fonte:** dashboards, Curva S e projeções exibem de onde vem cada número (soma de quais lançamentos, qual período).
3. **Nunca inventar valor:** campo sem dado fica vazio e sinalizado como pendente — jamais preenchido com estimativa silenciosa. Estimativas, quando existirem, são marcadas como tal e citam base.
4. **Nada se apaga, tudo se inativa:** exclusões são lógicas (soft delete) com registro de quem e quando. Histórico de alterações em lançamentos financeiros e medições.
5. **Exportação:** qualquer tabela do app exporta para Excel/PDF preservando os vínculos e a autoria.

## 7. Fluxo de trabalho por fase (obrigatório para o Claude Code)

Para **cada fase**, o Claude segue exatamente esta sequência:

1. **Confirmar o objetivo** da fase com as próprias palavras.
2. **Perguntas estratégicas** — listar o que falta definir e o que melhora a assertividade. Não implementar com lacuna estrutural aberta.
3. **Plano em etapas** — desenho do módulo (telas, tabelas, regras) para o Rodrigo **validar antes de executar**.
4. **Implementação** — só após aprovação explícita.
5. **Teste guiado** — roteiro simples para o Rodrigo testar na obra/escritório.
6. **Ajustes e aceite** — fase só fecha com aceite do Rodrigo. Aí abre a próxima.

Na entrega de qualquer análise ou documento: marcar dados como [extraído], [estimado] ou [lacuna]; citar base de cada estimativa; sinalizar opcionais como [sugestão].

## 8. Definição de pronto (por módulo)

Um módulo só é considerado entregue quando:

- [ ] Funciona no celular e no desktop (testado nos dois);
- [ ] Permissões dos 3 papéis testadas (equipe não edita o que não deve; cliente só visualiza);
- [ ] Rastreabilidade verificada: autor + data + vínculo em todos os registros;
- [ ] Migração de banco versionada no repositório;
- [ ] Dados de teste removidos ou claramente marcados;
- [ ] Rodrigo testou com dados reais da obra piloto e deu aceite.

## 9. Lacunas a resolver na Fase 0 [lacuna]

Perguntas que o Claude Code deve fazer ao Rodrigo logo no início:

1. Planilha de orçamento: enviar o arquivo Excel da obra piloto para mapear a estrutura de importação (abas, colunas, níveis da EAP).
2. Cliente vê valores? Confirmar se cliente/investidor enxerga custos ou só percentuais físicos e Curva S adimensional.
3. Quem são os usuários da equipe (nomes/e-mails) e quem lança o quê no dia a dia.
4. Formato atual do RDO da RT Engenharia (existe modelo? campos obrigatórios? — cruzar com a skill `rt-documentos-obra`).
5. Hospedagem do frontend (Vercel/Netlify/Cloudflare) e domínio próprio (ex.: app.rtengenharia.com.br) — sim ou não.
6. Cronograma da obra piloto: existe em planilha/MS Project, ou será construído no app na Fase 2?
7. Unidades de medição dos empreiteiros (por % de etapa, por serviço, por unidade/sobrado) para a Fase 7.
8. Cadastro de fornecedores: quais dados guardar (CNPJ, contato, condições de pagamento, histórico de preços?) e se existe base atual de fornecedores/cotações para importar.

---

*Versão 1.1 — 07/07/2026 — inclui módulo Compras na Fase 6 (Suprimentos) com conferência tripla cotação x recebimento x NF.*
*Versão 1.0 — 07/07/2026 — elaborado com base nas definições de Rodrigo Teles Silva em conversa com o Claude. Alterações neste documento exigem aprovação do Rodrigo e atualização do número de versão.*
