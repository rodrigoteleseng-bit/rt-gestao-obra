# Fase 0 — Fundação · Registro de entrega

> Status: **concluída e aceita** (07/07/2026).
> Referência técnica para as próximas fases — o que existe, onde está e como funciona.

## Stack em produção

- **Frontend:** React 19 + Vite + TypeScript, PWA (vite-plugin-pwa, `autoUpdate` com reload automático e checagem a cada 30 min).
- **Hospedagem:** Vercel — https://rt-gestao-obra.vercel.app — deploy automático no push para `main`.
- **Repositório:** https://github.com/rodrigoteleseng-bit/rt-gestao-obra
- **Backend:** Supabase — projeto `yxshldsfmbmbzdkcymca` — https://yxshldsfmbmbzdkcymca.supabase.co
- **SPA routing:** `vercel.json` com rewrite de tudo para `/index.html`.

## Banco de dados (migração `20260707_fase0_fundacao.sql`)

Enums: `papel_usuario` (admin/equipe/cliente), `status_obra`, `tipo_unidade`, `modulo_app`.

Tabelas: `perfis_usuario`, `obras`, `unidades`, `etapas`, `servicos` (recriada na Fase 1 — ver fase1.md).

- Todas com RLS ativa, soft delete (`ativo`), autoria (`criado_em`, `criado_por`).
- Funções `meu_papel()` e `meus_modulos()` (SECURITY DEFINER) usadas nas policies.
- Trigger `on_auth_user_created` cria o perfil automaticamente a partir dos metadados do convite.
- Escrita restrita a admin; leitura para autenticados.

## Obra piloto seedada

Obra **Tharsos Imperial** com 16 unidades. IDs das unidades estão em `scripts/importar-orcamento.cjs` (Sobrados 01–13, Portaria, Área Comum, Canteiro de Obras).

## Autenticação e usuários

- Login por e-mail/senha (Supabase Auth). Rota `/nova-senha` para redefinição/convite.
- **Edge functions** (service role):
  - `convidar-usuario` — admin convida por e-mail com papel + módulos; convidado define a própria senha.
  - `gerenciar-usuario` — ações `desativar`, `reativar`, `excluir_pendente` (só convites nunca acessados).
- Tela `/usuarios` (só admin): convidar, editar módulos da equipe, desativar/reativar/excluir convite.
- Papéis: admin (tudo), equipe (módulos configuráveis por checkbox), cliente (somente leitura; **vê valores** — confirmado pelo Rodrigo).

## Estrutura do frontend

```
src/
  lib/supabase.ts        — client + tipos (PerfilUsuario, Obra, Unidade, Etapa, Servico)
  lib/auth.ts            — login/logout
  contexts/AuthContext   — sessão + perfil + temModulo()
  contexts/ObraContext   — obras ativas + obra ativa (localStorage), seletor no topo
  components/Layout      — sidebar responsiva, menu filtrado por permissão
  pages/                 — Login, NovaSenha, Dashboard, Usuarios, Orcamento, EmConstrucao
```

- Menu: módulos das fases 2–7 apontam para `EmConstrucao` (placeholder com nome e fase).
- Enum `modulo_app` já inclui os módulos da Fase 7: `medicoes`, `contratos`, `fvs`, `galeria`, `efetivo`, `alertas` (migração `20260707_fase7_modulos_extras_enum.sql`).

## Observações operacionais

- Node v24 em `C:\Program Files\nodejs` fora do PATH do PowerShell — prefixar `$env:Path = "C:\Program Files\nodejs;" + $env:Path`.
- Supabase JS limita 1000 linhas por select — paginar com `.range()`.
- Projeto usa `"type": "module"` — scripts CommonJS devem ser `.cjs`.
