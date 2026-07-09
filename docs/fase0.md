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
- **Botão "🔑 Nova senha" (adicionado 09/07/2026):** admin envia link de redefinição direto da tela Usuários, sem depender do usuário clicar "Esqueci minha senha". Chama `supabase.auth.resetPasswordForEmail` (mesmo fluxo do login). Aparece apenas para usuários ativos não-admin.
- Papéis: admin (tudo), equipe (módulos configuráveis por checkbox), cliente (somente leitura; **vê valores** — confirmado pelo Rodrigo).
- **Armadilha:** usuário criado via SQL direto falha o 1º login (GoTrue não reconhece a senha). Solução: `UPDATE auth.users SET updated_at = now(), encrypted_password = crypt('senha', gen_salt('bf')) WHERE email = ...`

## Estrutura do frontend

```
src/
  lib/supabase.ts        — client + tipos (PerfilUsuario, Obra, Unidade, Etapa, Servico, Rdo*, ...)
  lib/auth.ts            — login/logout/resetSenha
  contexts/AuthContext   — sessão + perfil + temModulo(key) [retorna true para admin independente do key]
  contexts/ObraContext   — obras ativas + obra ativa (localStorage), seletor no topo
  components/Layout      — sidebar responsiva, seções agrupadas (RDO, Qualidade), menu filtrado por permissão
  pages/                 — Login, NovaSenha, Dashboard, Usuarios, Orcamento, EmConstrucao + fases 2/4/7
```

**Dashboard (reestruturado em 09/07/2026):**
- Cards com `multiKey` (ativo se usuário tem qualquer chave do array) e sub-itens com `moduloKey` individual.
- **RDO** (expansível): Relatório Diário · Galeria de Fotos (sempre visível) · Efetivo.
- **Qualidade** (expansível): FVS / Checklists · Pendências.
- Sidebar: cabeçalhos de seção não-clicáveis ("RDO", "Qualidade") com itens indentados logo abaixo.

Enum `modulo_app` (Fase 7 extras pré-criado): `medicoes`, `contratos`, `fvs`, `galeria`, `efetivo`, `alertas` — migração `20260707_fase7_modulos_extras_enum.sql`.

## Observações operacionais

- Node v24 em `C:\Program Files\nodejs` fora do PATH do PowerShell — prefixar `$env:Path = "C:\Program Files\nodejs;" + $env:Path`.
- Supabase JS limita 1000 linhas por select — paginar com `.range()`.
- Projeto usa `"type": "module"` — scripts CommonJS devem ser `.cjs`.
