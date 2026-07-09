# Fase 7 — Extras · Registro de entrega (parcial)

> Status: **parcialmente implementado** (09/07/2026).
> Itens desta fase são independentes entre si — cada um pode ser entregue sem o anterior.

## Extras implementados

### Galeria de Fotos — `/galeria` (09/07/2026)

**Propósito:** visualizar todas as fotos dos RDOs organizadas por data, sem precisar abrir cada RDO.

**Fonte de dados:** reutiliza `rdo_fotos` + `rdos` — zero mudança de banco. Fotos já estão no bucket `rdo` em `{obra_id}/{data}/{uuid}.jpg`.

**Comportamento:**
- Agrupa por `rdos.data` (o "dia de obra", não UTC da captura), mais recente primeiro.
- Dia mais recente abre automaticamente ao entrar na tela.
- URLs assinadas (1 h) geradas somente ao expandir o dia — lazy loading.
- Miniatura mostra ícone 📍 quando a foto tem coordenadas GPS.
- Clique na miniatura abre modal full-screen com legenda, hora de captura e coordenadas.
- Texto do subtítulo: "N fotos em D dias".

**Permissões:** todos os usuários autenticados (admin, equipe, cliente) — sem módulo específico requerido. RLS de `rdo_fotos` já permite `SELECT` para autenticados.

**Arquivos:**
- `src/pages/Galeria.tsx` — página principal
- `src/pages/Galeria.module.css` — estilos

**Integração com Dashboard:** sub-item de Galeria de Fotos no card RDO tem `sempre: true` — cliente também vê o link.

---

## Extras pendentes

| Extra | Descrição resumida | Dependência |
|---|---|---|
| Medições de empreiteiros | % concluído por serviço × sobrado, geração de medição para pagamento | Fase 2 (avanço) |
| Controle de contratos | Cadastro de contratos com empreiteiros + situação | Fase 6 (compras) |
| FVS / Qualidade | Checklist de verificação por serviço; serviço só fecha com FVS aprovado | Pendências |
| Gestão de efetivo | Cadastro de trabalhadores, frequência, custo de mão de obra | RDO |
| Alertas | Ferramenta não devolvida, etapa estourando orçamento, tarefa atrasada | Todos os módulos |

**Regra (CLAUDE.md §7):** cada extra só inicia após a fase base correspondente estar aceita pelo Rodrigo.
