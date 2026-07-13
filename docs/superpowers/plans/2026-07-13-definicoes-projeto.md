# Definições de Projeto Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Módulo novo `/definicoes` — decisões pendentes do cliente/proprietário (cor, modelo, acabamento) com prazo, responsável e status, visível também pro cliente em modo leitura. Card próprio no Dashboard.

**Architecture:** Tabela nova `definicoes_projeto` + novo valor `'definicoes'` no enum `modulo_app`, RLS com leitura liberada a todos os papéis e escrita restrita a admin/equipe-com-módulo. Página única `src/pages/Definicoes.tsx` (lista + filtros + formulário inline de criar/editar + ação de resolver), modelada em `Pendencias.tsx` pros filtros/cálculo de vencida, mas sem o split lista/formulário em dois arquivos (Definições não tem fotos nem timeline imutável, então não precisa da complexidade de `PendenciaForm.tsx`).

**Tech Stack:** PostgreSQL (Supabase) pra migração; React + TypeScript + Vite pro resto. Sem framework de teste automatizado — verificação manual via `npm run build` + navegador.

## Global Constraints

- **Leitura liberada a todos os papéis** (`admin`, `equipe`, `cliente`) — RLS de `definicoes_projeto` não restringe por `meu_papel()` no SELECT, só por `ativo = true`. Isso é diferente de Pendências (que bloqueia cliente totalmente) — não copiar aquele bloqueio.
- **Escrita (criar/editar/resolver)** restrita a `admin` ou `equipe` com o módulo `'definicoes'` habilitado (`pode_editar_definicoes()`).
- **Visibilidade do card no Dashboard:** `perfil?.papel === 'admin' || perfil?.papel === 'cliente' || temModulo('definicoes')` — cliente sempre vê o card (mesmo sem ter `modulos_permitidos` configurado, já que a tela de Usuários não oferece checkboxes de módulo pra usuários `cliente`). Não confundir com a regra de edição da página em si.
- Status só 2 valores: `pendente` / `resolvida`. "Vencida" é **calculado** (`status = 'pendente' && prazo < hoje`), não é armazenado no banco.
- Vínculo com `unidade_id` é **opcional** (nullable) — diferente de `pendencias.unidade_id`, que é `NOT NULL`.
- Sem campo de disciplina/categoria, sem anexo de foto, sem timeline de eventos — YAGNI, fora de escopo.

---

## Arquivos afetados

- Criar: `supabase/migrations/20260713_definicoes_projeto.sql`
- Criar: `src/pages/Definicoes.tsx`
- Criar: `src/pages/Definicoes.module.css`
- Modificar: `src/lib/supabase.ts` — `ModuloApp` ganha `'definicoes'`; novos tipos `StatusDefinicao`/`DefinicaoProjeto`.
- Modificar: `src/pages/Usuarios.tsx` — `MODULOS_LABELS` ganha `definicoes: 'Definições de Projeto'`.
- Modificar: `src/App.tsx` — import + rota `/definicoes`.
- Modificar: `src/pages/Dashboard.tsx` — novo card + remove "Definições de Projeto" da nota "Em preparação".

---

### Task 1: Migração de banco + tipos TypeScript

**Files:**
- Create: `supabase/migrations/20260713_definicoes_projeto.sql`
- Modify: `src/lib/supabase.ts`
- Modify: `src/pages/Usuarios.tsx`

**Interfaces:**
- Consumes: funções `meu_papel()`/`meus_modulos()` já existentes (usadas por `pode_editar_pendencias()` em `supabase/migrations/20260709_fase5_pendencias.sql:63-66`, mesmo padrão).
- Produces: tabela `definicoes_projeto`, tipo `ModuloApp` incluindo `'definicoes'`, tipos `StatusDefinicao`/`DefinicaoProjeto` — consumidos pela Task 2.

- [ ] **Step 1: Criar a migração**

```sql
-- Definições de Projeto: decisões pendentes do cliente/proprietário
-- (cor, modelo, acabamento), com prazo e responsável. Leitura liberada
-- a todos os papéis (inclusive cliente); escrita restrita a
-- admin/equipe com o módulo habilitado.

ALTER TYPE modulo_app ADD VALUE IF NOT EXISTS 'definicoes';

CREATE TYPE status_definicao AS ENUM ('pendente', 'resolvida');

CREATE TABLE definicoes_projeto (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  obra_id        UUID NOT NULL REFERENCES obras(id) ON DELETE CASCADE,
  unidade_id     UUID REFERENCES unidades(id),
  titulo         TEXT NOT NULL,
  local_ambiente TEXT,
  descricao      TEXT,
  responsavel    TEXT,
  prazo          DATE,
  status         status_definicao NOT NULL DEFAULT 'pendente',
  decisao        TEXT,
  resolvida_em   TIMESTAMPTZ,
  resolvida_por  UUID REFERENCES perfis_usuario(id),
  ativo          BOOLEAN NOT NULL DEFAULT true,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now(),
  criado_por     UUID NOT NULL DEFAULT auth.uid() REFERENCES perfis_usuario(id)
);

CREATE INDEX idx_definicoes_unidade ON definicoes_projeto(unidade_id);
CREATE INDEX idx_definicoes_obra    ON definicoes_projeto(obra_id) WHERE ativo;

ALTER TABLE definicoes_projeto ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION pode_editar_definicoes()
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT meu_papel() = 'admin'
    OR (meu_papel() = 'equipe' AND 'definicoes' = ANY(meus_modulos()))
$$;

-- Leitura: todos os papéis (admin, equipe, cliente) — são decisões do cliente.
-- Escrita: admin, ou equipe com o módulo 'definicoes'.
CREATE POLICY def_select ON definicoes_projeto FOR SELECT
  USING (ativo = true);
CREATE POLICY def_insert ON definicoes_projeto FOR INSERT
  WITH CHECK (pode_editar_definicoes());
CREATE POLICY def_update ON definicoes_projeto FOR UPDATE
  USING (pode_editar_definicoes())
  WITH CHECK (pode_editar_definicoes());
```

- [ ] **Step 2: Aplicar a migração no banco Supabase**

Usar a ferramenta MCP do Supabase (`apply_migration`, projeto `yxshldsfmbmbzdkcymca` — nome `rt-gestao-obra`) com o nome `definicoes_projeto` e o SQL acima. **Pedir confirmação explícita ao Rodrigo antes de aplicar** (altera o banco de produção — criação de tabela nova e novo valor de enum, aditiva e sem impacto em dados existentes, mas ainda uma mudança de schema ao vivo). Depois de aplicada, confirmar com uma query simples que a tabela existe e que o enum tem o novo valor:

```sql
SELECT enum_range(NULL::modulo_app);
SELECT count(*) FROM definicoes_projeto;
```

- [ ] **Step 3: Adicionar os tipos em `src/lib/supabase.ts`**

Localizar a linha `export type ModuloApp =` (linhas 9-11 do arquivo atual):

```ts
export type ModuloApp =
  | 'rdo' | 'avanco' | 'pendencias' | 'almoxarifado' | 'financeiro' | 'compras'
  | 'medicoes' | 'contratos' | 'fvs' | 'galeria' | 'efetivo' | 'alertas'
```

Substituir por:

```ts
export type ModuloApp =
  | 'rdo' | 'avanco' | 'pendencias' | 'almoxarifado' | 'financeiro' | 'compras'
  | 'medicoes' | 'contratos' | 'fvs' | 'galeria' | 'efetivo' | 'alertas' | 'definicoes'
```

Logo após a interface `Pendencia`/`PendenciaEvento`/`PendenciaFoto` (a interface `PendenciaFoto` termina por volta da linha 213 do arquivo atual, antes de `export type StatusFvs`), adicionar:

```ts
export type StatusDefinicao = 'pendente' | 'resolvida'

export interface DefinicaoProjeto {
  id: string
  obra_id: string
  unidade_id: string | null
  titulo: string
  local_ambiente: string | null
  descricao: string | null
  responsavel: string | null
  prazo: string | null
  status: StatusDefinicao
  decisao: string | null
  resolvida_em: string | null
  resolvida_por: string | null
  ativo: boolean
  criado_em: string
  criado_por: string
}
```

- [ ] **Step 4: Adicionar o label em `src/pages/Usuarios.tsx`**

Localizar `MODULOS_LABELS` (linhas 8-21 do arquivo atual):

```ts
const MODULOS_LABELS: Record<ModuloApp, string> = {
  rdo: 'RDO',
  avanco: 'Avanço Físico',
  pendencias: 'Pendências',
  almoxarifado: 'Almoxarifado',
  financeiro: 'Financeiro',
  compras: 'Compras',
  medicoes: 'Medições',
  contratos: 'Contratos',
  fvs: 'Qualidade (FVS)',
  galeria: 'Galeria',
  efetivo: 'Efetivo',
  alertas: 'Alertas',
}
```

Substituir por (acrescenta a última linha):

```ts
const MODULOS_LABELS: Record<ModuloApp, string> = {
  rdo: 'RDO',
  avanco: 'Avanço Físico',
  pendencias: 'Pendências',
  almoxarifado: 'Almoxarifado',
  financeiro: 'Financeiro',
  compras: 'Compras',
  medicoes: 'Medições',
  contratos: 'Contratos',
  fvs: 'Qualidade (FVS)',
  galeria: 'Galeria',
  efetivo: 'Efetivo',
  alertas: 'Alertas',
  definicoes: 'Definições de Projeto',
}
```

- [ ] **Step 5: Verificar**

Rodar `npm run build` — TypeScript deve compilar limpo. No navegador, na tela Usuários, editar um usuário `equipe` e confirmar que "Definições de Projeto" aparece na lista de checkboxes de módulo.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260713_definicoes_projeto.sql src/lib/supabase.ts src/pages/Usuarios.tsx
git commit -m "Definições de Projeto: migração, tipos e módulo em Usuários"
```

---

### Task 2: Página `/definicoes` (lista, filtros, criar/editar, resolver)

**Files:**
- Create: `src/pages/Definicoes.tsx`
- Create: `src/pages/Definicoes.module.css`
- Modify: `src/App.tsx` (import + rota)

**Interfaces:**
- Consumes: `DefinicaoProjeto`, `StatusDefinicao`, `Unidade` de `../lib/supabase` (Task 1); `useAuth()` (`perfil`, `temModulo`); `useObra()` (`obraAtiva`); `hojeISO` de `../lib/cronograma` (mesmo helper usado em `Pendencias.tsx:6`).
- Produces: componente `Definicoes` default-exportado, montado na rota `/definicoes`.

- [ ] **Step 1: Criar `src/pages/Definicoes.module.css`**

```css
.page {
  max-width: 860px;
  margin: 0 auto;
  padding-bottom: 40px;
}

.page h1 { font-size: 20px; margin-bottom: 4px; }

.sub {
  color: var(--cinza-600);
  font-size: 13px;
  max-width: 640px;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 16px;
}

.btnNova {
  background: var(--terracota);
  color: var(--branco);
  border: none;
  border-radius: var(--radius-sm);
  padding: 12px 18px;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  white-space: nowrap;
}

.btnSecundario {
  background: var(--branco);
  color: var(--navy);
  border: 1.5px solid var(--navy);
  border-radius: var(--radius-sm);
  padding: 10px 16px;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
}

.vazio { color: var(--cinza-600); font-size: 14px; padding: 12px 0; }

.contadores {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}

.contador {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 10px 8px;
  border-radius: var(--radius-md);
  border: 1.5px solid var(--cinza-200);
  background: var(--branco);
  cursor: pointer;
}

.contNum {
  font-family: var(--font-titulo);
  font-size: 20px;
  font-weight: 700;
}

.contLabel { font-size: 11px; font-weight: 600; }

.cont_pendente .contNum, .cont_pendente .contLabel { color: #8a6d1a; }
.cont_resolvida .contNum, .cont_resolvida .contLabel { color: #1e6b2e; }

.contAtivo { border-color: var(--navy); background: #f4f6fa; }

.filtros {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}

.selectFiltro {
  padding: 10px 12px;
  border: 1.5px solid var(--cinza-200);
  border-radius: var(--radius-sm);
  font-size: 14px;
  background: var(--branco);
  min-width: 200px;
}

.card {
  width: 100%;
  display: block;
  background: var(--branco);
  border: 1.5px solid var(--cinza-200);
  border-radius: var(--radius-md);
  padding: 13px 16px;
  margin-bottom: 8px;
  box-shadow: var(--sombra-sm);
  text-align: left;
}

.cardVencida { border-color: #d98080; background: #fffafa; }

.cardTopo {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  margin-bottom: 5px;
}

.cardTitulo {
  font-family: var(--font-titulo);
  font-weight: 700;
  color: var(--navy);
  font-size: 14px;
}

.cardMeta {
  font-size: 12px;
  color: var(--cinza-600);
  margin-bottom: 5px;
}

.cardDesc {
  font-size: 13px;
  color: var(--cinza-800);
  margin-bottom: 7px;
}

.cardRodape {
  display: flex;
  gap: 14px;
  flex-wrap: wrap;
  font-size: 12px;
  color: var(--cinza-600);
}

.prazoVencido { color: #a33030; font-weight: 700; }

.chip {
  font-size: 11px;
  font-weight: 700;
  border-radius: 999px;
  padding: 3px 10px;
  white-space: nowrap;
}

.chip_pendente { background: #fdf3d7; color: #8a6d1a; }
.chip_resolvida { background: #e3f4e3; color: #1e6b2e; }

.bloco {
  background: var(--branco);
  border: 1.5px solid var(--cinza-200);
  border-radius: var(--radius-md);
  padding: 16px;
  margin-bottom: 16px;
  box-shadow: var(--sombra-sm);
}

.campos {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.linha2 {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.campo {
  display: flex;
  flex: 1;
  min-width: 160px;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  font-weight: 600;
  color: var(--cinza-600);
}

.campo input, .campo select, .campo textarea {
  padding: 10px 12px;
  border: 1.5px solid var(--cinza-200);
  border-radius: var(--radius-sm);
  font-size: 14px;
  font-family: inherit;
  background: var(--branco);
}

.campo textarea { resize: vertical; min-height: 60px; }

.campo input:focus, .campo select:focus, .campo textarea:focus {
  border-color: var(--navy);
  outline: none;
}

.acoesForm {
  display: flex;
  gap: 10px;
  margin-top: 4px;
}

.btnResolver {
  background: #1e6b2e;
  color: var(--branco);
  border: none;
  border-radius: var(--radius-sm);
  padding: 8px 14px;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}

.blocoResolver {
  background: var(--cinza-100);
  border-radius: var(--radius-sm);
  padding: 10px;
  margin-top: 8px;
}

.msgOk { color: #1e6b2e; font-weight: 600; font-size: 13px; padding: 6px 0; }
.msgErro { color: #a33030; font-weight: 600; font-size: 13px; padding: 6px 0; }
```

- [ ] **Step 2: Criar `src/pages/Definicoes.tsx`**

```tsx
import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useObra } from '../contexts/ObraContext'
import { supabase, type DefinicaoProjeto, type Unidade, type StatusDefinicao } from '../lib/supabase'
import { hojeISO } from '../lib/cronograma'
import styles from './Definicoes.module.css'

const fmtData = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`

const STATUS_LABEL: Record<StatusDefinicao, string> = {
  pendente: 'Pendente',
  resolvida: 'Resolvida',
}

export default function Definicoes() {
  const { perfil, temModulo } = useAuth()
  const { obraAtiva } = useObra()
  const podeEditar = perfil?.papel === 'admin' || temModulo('definicoes')

  const [definicoes, setDefinicoes] = useState<DefinicaoProjeto[]>([])
  const [unidades, setUnidades] = useState<Unidade[]>([])
  const [carregando, setCarregando] = useState(true)
  const [filtroUnidade, setFiltroUnidade] = useState('')
  const [filtroStatus, setFiltroStatus] = useState<StatusDefinicao | ''>('')
  const [filtroResp, setFiltroResp] = useState('')

  const [formAberto, setFormAberto] = useState(false)
  const [editandoId, setEditandoId] = useState<string | null>(null)
  const [titulo, setTitulo] = useState('')
  const [unidadeSel, setUnidadeSel] = useState('')
  const [localAmbiente, setLocalAmbiente] = useState('')
  const [descricao, setDescricao] = useState('')
  const [responsavel, setResponsavel] = useState('')
  const [prazo, setPrazo] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)

  const [resolvendoId, setResolvendoId] = useState<string | null>(null)
  const [decisaoTexto, setDecisaoTexto] = useState('')
  const [resolvendo, setResolvendo] = useState(false)

  function carregar() {
    if (!obraAtiva) return
    setCarregando(true)
    Promise.all([
      supabase.from('definicoes_projeto').select('*').eq('obra_id', obraAtiva.id).eq('ativo', true),
      supabase.from('unidades').select('*').eq('obra_id', obraAtiva.id).order('ordem'),
    ]).then(([d, u]) => {
      setDefinicoes(d.data ?? [])
      setUnidades(u.data ?? [])
      setCarregando(false)
    })
  }

  useEffect(carregar, [obraAtiva])

  const hoje = hojeISO()
  const nomeUnidade = useMemo(() => new Map(unidades.map(u => [u.id, u.nome])), [unidades])

  function vencida(d: DefinicaoProjeto): boolean {
    return d.status === 'pendente' && d.prazo !== null && d.prazo < hoje
  }

  const responsaveis = useMemo(
    () => [...new Set(definicoes.map(d => d.responsavel).filter((r): r is string => !!r))]
      .sort((a, b) => a.localeCompare(b, 'pt-BR')),
    [definicoes]
  )

  const filtradas = useMemo(() => {
    const lista = definicoes.filter(d =>
      (!filtroUnidade || d.unidade_id === filtroUnidade) &&
      (!filtroStatus || d.status === filtroStatus) &&
      (!filtroResp || (filtroResp === '__sem__' ? !d.responsavel : d.responsavel === filtroResp))
    )
    return lista.sort((a, b) => {
      const va = vencida(a) ? 1 : 0
      const vb = vencida(b) ? 1 : 0
      if (va !== vb) return vb - va
      if (a.prazo && b.prazo && a.prazo !== b.prazo) return a.prazo.localeCompare(b.prazo)
      if (a.prazo && !b.prazo) return -1
      if (!a.prazo && b.prazo) return 1
      return b.criado_em.localeCompare(a.criado_em)
    })
  }, [definicoes, filtroUnidade, filtroStatus, filtroResp, hoje])

  const contagem = useMemo(() => ({
    pendente: definicoes.filter(d => d.status === 'pendente').length,
    resolvida: definicoes.filter(d => d.status === 'resolvida').length,
  }), [definicoes])

  function abrirNovo() {
    setEditandoId(null)
    setTitulo(''); setUnidadeSel(''); setLocalAmbiente(''); setDescricao(''); setResponsavel(''); setPrazo('')
    setMsg(null)
    setFormAberto(true)
  }

  function abrirEdicao(d: DefinicaoProjeto) {
    setEditandoId(d.id)
    setTitulo(d.titulo)
    setUnidadeSel(d.unidade_id ?? '')
    setLocalAmbiente(d.local_ambiente ?? '')
    setDescricao(d.descricao ?? '')
    setResponsavel(d.responsavel ?? '')
    setPrazo(d.prazo ?? '')
    setMsg(null)
    setFormAberto(true)
  }

  async function salvar() {
    if (!obraAtiva) return
    if (!titulo.trim()) {
      setMsg({ tipo: 'erro', texto: 'Informe o título da decisão.' })
      return
    }
    setSalvando(true)
    setMsg(null)
    const dados = {
      titulo: titulo.trim(),
      unidade_id: unidadeSel || null,
      local_ambiente: localAmbiente.trim() || null,
      descricao: descricao.trim() || null,
      responsavel: responsavel.trim() || null,
      prazo: prazo || null,
    }
    const { error } = editandoId
      ? await supabase.from('definicoes_projeto').update(dados).eq('id', editandoId)
      : await supabase.from('definicoes_projeto').insert({ ...dados, obra_id: obraAtiva.id })
    setSalvando(false)
    if (error) {
      setMsg({ tipo: 'erro', texto: `Erro ao salvar: ${error.message}` })
      return
    }
    setMsg({ tipo: 'ok', texto: editandoId ? 'Definição atualizada.' : 'Definição cadastrada.' })
    setFormAberto(false)
    carregar()
  }

  function abrirResolver(id: string) {
    setResolvendoId(id)
    setDecisaoTexto('')
  }

  async function confirmarResolucao(id: string) {
    setResolvendo(true)
    const { error } = await supabase.from('definicoes_projeto').update({
      status: 'resolvida',
      decisao: decisaoTexto.trim() || null,
      resolvida_em: new Date().toISOString(),
    }).eq('id', id)
    setResolvendo(false)
    if (error) {
      setMsg({ tipo: 'erro', texto: `Erro ao resolver: ${error.message}` })
      return
    }
    setResolvendoId(null)
    carregar()
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1>Definições de Projeto</h1>
          <p className={styles.sub}>Decisões pendentes do cliente — acabamento, cor, modelo — com prazo e responsável.</p>
        </div>
        {podeEditar && (
          <button className={styles.btnNova} onClick={abrirNovo}>+ Nova definição</button>
        )}
      </div>

      {podeEditar && formAberto && (
        <div className={styles.bloco}>
          <div className={styles.campos}>
            <label className={styles.campo}>
              Título *
              <input value={titulo} onChange={e => setTitulo(e.target.value)} placeholder="Ex.: Cor da telha cerâmica" />
            </label>
            <div className={styles.linha2}>
              <label className={styles.campo}>
                Unidade (opcional)
                <select value={unidadeSel} onChange={e => setUnidadeSel(e.target.value)}>
                  <option value="">Sem vínculo — decisão geral da obra</option>
                  {unidades.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}
                </select>
              </label>
              <label className={styles.campo}>
                Local/Ambiente
                <input value={localAmbiente} onChange={e => setLocalAmbiente(e.target.value)} placeholder="Ex.: Banheiro suíte" />
              </label>
            </div>
            <label className={styles.campo}>
              Descrição
              <textarea value={descricao} onChange={e => setDescricao(e.target.value)} placeholder="Contexto da decisão" />
            </label>
            <div className={styles.linha2}>
              <label className={styles.campo}>
                Responsável
                <input value={responsavel} onChange={e => setResponsavel(e.target.value)} placeholder="Quem precisa decidir" />
              </label>
              <label className={styles.campo}>
                Prazo
                <input type="date" value={prazo} onChange={e => setPrazo(e.target.value)} />
              </label>
            </div>
          </div>
          {msg && <p className={msg.tipo === 'ok' ? styles.msgOk : styles.msgErro}>{msg.texto}</p>}
          <div className={styles.acoesForm}>
            <button className={styles.btnNova} onClick={salvar} disabled={salvando}>
              {salvando ? 'Salvando…' : editandoId ? 'Salvar alterações' : '+ Cadastrar definição'}
            </button>
            <button className={styles.btnSecundario} onClick={() => setFormAberto(false)}>Cancelar</button>
          </div>
        </div>
      )}

      <div className={styles.contadores}>
        {(['pendente', 'resolvida'] as StatusDefinicao[]).map(s => (
          <button
            key={s}
            className={`${styles.contador} ${styles[`cont_${s}`]} ${filtroStatus === s ? styles.contAtivo : ''}`}
            onClick={() => setFiltroStatus(filtroStatus === s ? '' : s)}
          >
            <span className={styles.contNum}>{contagem[s]}</span>
            <span className={styles.contLabel}>{STATUS_LABEL[s]}s</span>
          </button>
        ))}
      </div>

      <div className={styles.filtros}>
        <select value={filtroUnidade} onChange={e => setFiltroUnidade(e.target.value)} className={styles.selectFiltro}>
          <option value="">Todas as unidades</option>
          {unidades.map(u => <option key={u.id} value={u.id}>{u.nome}</option>)}
        </select>
        <select value={filtroResp} onChange={e => setFiltroResp(e.target.value)} className={styles.selectFiltro}>
          <option value="">Todos os responsáveis</option>
          <option value="__sem__">Sem responsável</option>
          {responsaveis.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
      </div>

      {carregando && <p className={styles.vazio}>Carregando…</p>}
      {!carregando && filtradas.length === 0 && (
        <p className={styles.vazio}>
          {definicoes.length === 0 ? 'Nenhuma definição registrada.' : 'Nenhuma definição com esses filtros.'}
        </p>
      )}

      {filtradas.map(d => (
        <div key={d.id} className={`${styles.card} ${vencida(d) ? styles.cardVencida : ''}`}>
          <div className={styles.cardTopo}>
            <span className={styles.cardTitulo}>{d.titulo}</span>
            <span className={`${styles.chip} ${styles[`chip_${d.status}`]}`}>{STATUS_LABEL[d.status]}</span>
          </div>
          {(d.unidade_id || d.local_ambiente) && (
            <div className={styles.cardMeta}>
              {d.unidade_id && (nomeUnidade.get(d.unidade_id) ?? '?')}
              {d.unidade_id && d.local_ambiente ? ' — ' : ''}
              {d.local_ambiente}
            </div>
          )}
          {d.descricao && <div className={styles.cardDesc}>{d.descricao}</div>}
          {d.status === 'resolvida' && d.decisao && (
            <div className={styles.cardDesc}><strong>Decisão:</strong> {d.decisao}</div>
          )}
          <div className={styles.cardRodape}>
            {d.responsavel && <span>👤 {d.responsavel}</span>}
            {d.prazo && (
              <span className={vencida(d) ? styles.prazoVencido : ''}>
                📅 {fmtData(d.prazo)}
              </span>
            )}
          </div>
          {podeEditar && (
            <div className={styles.acoesForm} style={{ marginTop: 8 }}>
              <button className={styles.btnSecundario} onClick={() => abrirEdicao(d)}>Editar</button>
              {d.status === 'pendente' && (
                <button className={styles.btnResolver} onClick={() => abrirResolver(d.id)}>Marcar como resolvida</button>
              )}
            </div>
          )}
          {resolvendoId === d.id && (
            <div className={styles.blocoResolver}>
              <label className={styles.campo}>
                O que foi decidido?
                <textarea value={decisaoTexto} onChange={e => setDecisaoTexto(e.target.value)} placeholder="Ex.: Cliente escolheu porcelanato branco 60x60" />
              </label>
              <div className={styles.acoesForm}>
                <button className={styles.btnResolver} onClick={() => confirmarResolucao(d.id)} disabled={resolvendo}>
                  {resolvendo ? 'Salvando…' : 'Confirmar resolução'}
                </button>
                <button className={styles.btnSecundario} onClick={() => setResolvendoId(null)}>Cancelar</button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 3: Registrar a rota em `src/App.tsx`**

Adicionar o import logo após `import DadosObra from './pages/DadosObra'` (linha 18 do arquivo atual):

```tsx
import Definicoes from './pages/Definicoes'
```

Adicionar a rota logo após `<Route path="pendencias" element={<Pendencias />} />`:

```tsx
        <Route path="definicoes" element={<Definicoes />} />
```

- [ ] **Step 4: Verificar**

Rodar `npm run build` (TypeScript deve compilar limpo). No navegador:
1. Logado como **admin**, acessar `/definicoes` direto pela URL — confirmar que a tela carrega, "+ Nova definição" aparece, e é possível criar uma definição de teste (com e sem unidade vinculada), editá-la, e marcar como resolvida informando o texto da decisão.
2. Confirmar que o card de contagem (Pendentes/Resolvidas) reflete corretamente, e que os filtros (unidade, responsável) funcionam.
3. Confirmar que uma definição com prazo no passado e status `pendente` aparece com destaque de "vencida" (borda/cor), igual ao padrão de Pendências.
4. Logado como **cliente**, acessar `/definicoes` — confirmar que a lista aparece (leitura), mas sem "+ Nova definição", sem "Editar", sem "Marcar como resolvida".
5. Logado como **equipe sem o módulo `definicoes` habilitado** — confirmar que a lista aparece (leitura, já que não há bloqueio de leitura por papel) mas sem os controles de edição (mesma regra do `podeEditar`).

- [ ] **Step 5: Commit**

```bash
git add src/pages/Definicoes.tsx src/pages/Definicoes.module.css src/App.tsx
git commit -m "Definições de Projeto: página de lista, criar/editar e resolver"
```

---

### Task 3: Card no Dashboard

**Files:**
- Modify: `src/pages/Dashboard.tsx`

**Interfaces:**
- Consumes: `perfil`, `temModulo` (já disponíveis no componente `Dashboard`).
- Produces: nenhuma — última tarefa do plano.

- [ ] **Step 1: Adicionar o card**

Localizar o bloco do card "Dados da Obra" (linhas 382-394 do arquivo atual, dentro de `.grid`, logo após `{CARDS_MODULOS.map(m => { ... })}`):

```tsx
        {perfil?.papel === 'admin' && (
          <div
            className={`${styles.card} ${styles.cardAtivo} ${styles.cardClicavel}`}
            onClick={() => navigate('/dados-obra')}
            role="button"
            tabIndex={0}
            onKeyDown={e => { if (e.key === 'Enter') navigate('/dados-obra') }}
          >
            <div className={styles.cardIcon}>🏗️</div>
            <div className={styles.cardNome}>Dados da Obra</div>
            <div className={styles.cardDesc}>Cadastro, endereço, datas e status</div>
          </div>
        )}
      </div>
```

Adicionar o novo card logo depois do card "Dados da Obra", ainda dentro de `.grid`:

```tsx
        {perfil?.papel === 'admin' && (
          <div
            className={`${styles.card} ${styles.cardAtivo} ${styles.cardClicavel}`}
            onClick={() => navigate('/dados-obra')}
            role="button"
            tabIndex={0}
            onKeyDown={e => { if (e.key === 'Enter') navigate('/dados-obra') }}
          >
            <div className={styles.cardIcon}>🏗️</div>
            <div className={styles.cardNome}>Dados da Obra</div>
            <div className={styles.cardDesc}>Cadastro, endereço, datas e status</div>
          </div>
        )}
        {(perfil?.papel === 'admin' || perfil?.papel === 'cliente' || temModulo('definicoes')) && (
          <div
            className={`${styles.card} ${styles.cardAtivo} ${styles.cardClicavel}`}
            onClick={() => navigate('/definicoes')}
            role="button"
            tabIndex={0}
            onKeyDown={e => { if (e.key === 'Enter') navigate('/definicoes') }}
          >
            <div className={styles.cardIcon}>📐</div>
            <div className={styles.cardNome}>Definições de Projeto</div>
            <div className={styles.cardDesc}>Decisões pendentes do cliente</div>
          </div>
        )}
      </div>
```

- [ ] **Step 2: Remover "Definições de Projeto" da nota "Em preparação"**

Localizar:

```tsx
      <div className={styles.futuro}>
        <b>Em preparação:</b> Financeiro (Fase 3), Medições, Definições de Projeto, Projetos, Planejamento (lookahead/PPC) e Tarefas.
      </div>
```

Substituir por:

```tsx
      <div className={styles.futuro}>
        <b>Em preparação:</b> Financeiro (Fase 3), Medições, Projetos, Planejamento (lookahead/PPC) e Tarefas.
      </div>
```

- [ ] **Step 3: Verificar**

Rodar `npm run build`. No navegador: confirmar que o card "Definições de Projeto" aparece no Dashboard pra admin e pra cliente (mesmo sem o módulo habilitado explicitamente pro cliente), e que clicar nele navega pra `/definicoes`. Confirmar que a nota "Em preparação" não cita mais Definições de Projeto.

- [ ] **Step 4: Commit**

```bash
git add src/pages/Dashboard.tsx
git commit -m "Dashboard: card de Definições de Projeto (admin+cliente sempre, equipe com módulo)"
```

---

## Verificação final

- [ ] `npm run build` sem erros.
- [ ] Migração aplicada no Supabase (tabela `definicoes_projeto` existe, enum `modulo_app` tem `'definicoes'`).
- [ ] Fluxo completo testado como admin: criar, editar, resolver (com texto de decisão), filtros, contadores, vencida.
- [ ] Cliente vê a lista mas sem nenhum controle de edição.
- [ ] Equipe sem o módulo habilitado vê a lista mas sem controles de edição; com o módulo habilitado, os controles aparecem.
- [ ] Card do Dashboard aparece corretamente pros 3 papéis conforme a regra especial de visibilidade.
