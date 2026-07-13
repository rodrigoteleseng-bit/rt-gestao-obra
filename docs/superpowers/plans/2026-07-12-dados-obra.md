# Dados da Obra Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Criar a tela `/dados-obra` (admin-only) para listar, criar e editar registros da tabela `obras` — nome, descrição, endereço, cidade, estado, datas e status — preenchendo a lacuna que impedia o card-herói do Dashboard de mostrar Prazo/Semana/Restam para a obra piloto.

**Architecture:** Uma página nova (`src/pages/DadosObra.tsx` + `.module.css`), seguindo o padrão já usado em `src/pages/Fornecedores.tsx` (lista + formulário inline no mesmo componente, sem sub-rota). Rota `/dados-obra` registrada em `App.tsx` dentro do grupo protegido existente. Um card novo, admin-only, adicionado ao Dashboard fora do array `CARDS_MODULOS` (é configuração administrativa, não um módulo operacional). Nenhuma migração de banco — RLS de `obras` já restringe INSERT/UPDATE a `admin` desde a Fase 0.

**Tech Stack:** React + TypeScript + Vite, Supabase JS client, CSS Modules. Sem framework de teste automatizado (verificação manual via `npm run build` + navegador, mesmo padrão dos planos anteriores deste projeto).

## Global Constraints

- Só `admin` acessa a tela e só `admin` vê o novo card no Dashboard — reforça na UI o que o RLS (`obras_insert`/`obras_update`, já exigem `meu_papel() = 'admin'`) já impõe no banco. Nenhuma policy nova.
- Nenhuma tabela/coluna/migração nova — só `insert`/`update`/`select` na tabela `obras` que já existe, usando exatamente os campos do tipo `Obra` em `src/lib/supabase.ts` (nome, descricao, endereco, cidade, estado, data_inicio, data_fim_prevista, status).
- `criado_por` deve ser gravado explicitamente como `perfil.id` no INSERT — a coluna `obras.criado_por` (migração `20260707_fase0_fundacao.sql:33`) não tem `DEFAULT auth.uid()` como as tabelas de fases posteriores, então fica `NULL` se não for setado manualmente. Não depender de um default que não existe.
- Nenhuma exclusão física (`DELETE`) nem alteração da coluna `ativo` — "desativar" uma obra é só mudar `status` para `arquivada`.
- **Não duplicar o seletor de obra ativa.** `Layout.tsx:142-155` já tem um `<select>` no cabeçalho que troca a obra ativa via `selecionarObra` (aparece sozinho quando `obras.length > 1`). A tela desta feature é só leitura quanto a qual obra está ativa (mostra um selo "Ativa", sem botão de ação) — nenhuma chamada a `selecionarObra` nesta tela.
- Paleta/tipografia só via tokens existentes (`--navy`, `--terracota`, `--cinza-200`, `--cinza-600`, `--radius-sm`, `--radius-md`, `--sombra-sm`, `--branco`) — sem cor nova. Seguir exatamente o estilo de `Fornecedores.module.css`.

---

## Arquivos afetados

- Criar: `src/pages/DadosObra.tsx`
- Criar: `src/pages/DadosObra.module.css`
- Modificar: `src/App.tsx` — import + rota `/dados-obra`
- Modificar: `src/pages/Dashboard.tsx` — novo card admin-only
- Modificar: `src/pages/Dashboard.module.css` — nenhuma classe nova necessária (o card reaproveita `.card`/`.cardAtivo`/`.cardIcon`/`.cardNome`/`.cardDesc` já existentes)

---

### Task 1: Página com lista de obras (somente leitura) + rota + card no Dashboard

**Files:**
- Create: `src/pages/DadosObra.tsx`
- Create: `src/pages/DadosObra.module.css`
- Modify: `src/App.tsx:8, 46` (import + rota)
- Modify: `src/pages/Dashboard.tsx` (novo card admin-only)

**Interfaces:**
- Consumes: `Obra`, `StatusObra` de `../lib/supabase`; `useAuth()` (`perfil`) de `../contexts/AuthContext`; `useObra()` (`obraAtiva`) de `../contexts/ObraContext`.
- Produces: componente `DadosObra` default-exportado, montado na rota `/dados-obra`. Nenhuma interface nova consumida por outra tarefa (Task 2 estende o mesmo arquivo).

- [ ] **Step 1: Criar `src/pages/DadosObra.module.css`**

Copiar a estrutura de `src/pages/Fornecedores.module.css` (já lido — reaproveitar exatamente as mesmas classes `.page`, `.sub`, `.bloco`, `.campos`, `.linha`, `.campo`, `.campo input`, `.btnPrincipal`, `.card`, `.cardNome`, `.cardMeta`, `.vazio`, `.msgOk`, `.msgErro`), e adicionar 4 classes novas para a lista com badge de status e selo de obra ativa:

```css
.page {
  max-width: 720px;
  margin: 0 auto;
  padding-bottom: 40px;
}

.page h1 { font-size: 20px; margin-bottom: 4px; }

.sub {
  color: var(--cinza-600);
  font-size: 13px;
  margin-bottom: 16px;
}

.topo {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}

.btnPrincipal {
  background: var(--terracota);
  color: var(--branco);
  border: none;
  border-radius: var(--radius-sm);
  padding: 10px 16px;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
}

.btnPrincipal:disabled { opacity: 0.6; cursor: default; }

.btnSecundario {
  background: none;
  border: 1.5px solid var(--cinza-200);
  color: var(--navy);
  border-radius: var(--radius-sm);
  padding: 8px 14px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.card {
  background: var(--branco);
  border: 1.5px solid var(--cinza-200);
  border-radius: var(--radius-md);
  padding: 12px 16px;
  margin-bottom: 8px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.cardInfo { flex: 1; min-width: 0; }

.cardNome {
  font-weight: 700;
  color: var(--navy);
  font-size: 14px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.cardMeta {
  display: flex;
  gap: 14px;
  flex-wrap: wrap;
  font-size: 12px;
  color: var(--cinza-600);
  margin-top: 4px;
}

.badge {
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--cinza-100);
  color: var(--cinza-600);
}

.badgeAtiva { background: #e6f4ec; color: var(--sucesso); }

.selo {
  font-size: 10.5px;
  font-weight: 700;
  color: var(--terracota-dark);
  border: 1px solid var(--terracota);
  border-radius: 999px;
  padding: 2px 8px;
}

.vazio { color: var(--cinza-600); font-size: 14px; padding: 12px 0; }

.msgOk { color: #1e6b2e; font-weight: 600; font-size: 13px; padding: 6px 0; }
.msgErro { color: #a33030; font-weight: 600; font-size: 13px; padding: 6px 0; }
```

- [ ] **Step 2: Criar `src/pages/DadosObra.tsx` com a lista (sem formulário ainda)**

```tsx
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useObra } from '../contexts/ObraContext'
import { supabase, type Obra, type StatusObra } from '../lib/supabase'
import styles from './DadosObra.module.css'

const LABEL_STATUS: Record<StatusObra, string> = {
  ativa: 'Ativa',
  pausada: 'Pausada',
  concluida: 'Concluída',
  arquivada: 'Arquivada',
}

export default function DadosObra() {
  const { perfil } = useAuth()
  const { obraAtiva } = useObra()
  const navigate = useNavigate()

  const [obras, setObras] = useState<Obra[]>([])
  const [carregando, setCarregando] = useState(true)

  useEffect(() => { carregar() }, [])

  function carregar() {
    setCarregando(true)
    supabase.from('obras').select('*').eq('ativo', true).order('nome')
      .then(({ data }) => { setObras(data ?? []); setCarregando(false) })
  }

  if (perfil?.papel !== 'admin') {
    return <div className={styles.page}><p className={styles.vazio}>Acesso restrito ao administrador.</p></div>
  }

  return (
    <div className={styles.page}>
      <button className={styles.btnSecundario} onClick={() => navigate('/dashboard')} style={{ marginBottom: 12 }}>← Início</button>
      <h1>Dados da Obra</h1>
      <p className={styles.sub}>Cadastro e edição das obras da RT Engenharia.</p>

      <div className={styles.topo}>
        <span />
        <button className={styles.btnPrincipal}>+ Nova obra</button>
      </div>

      {carregando && <p className={styles.vazio}>Carregando…</p>}
      {!carregando && obras.length === 0 && <p className={styles.vazio}>Nenhuma obra cadastrada.</p>}
      {obras.map(o => (
        <div key={o.id} className={styles.card}>
          <div className={styles.cardInfo}>
            <div className={styles.cardNome}>
              {o.nome}
              {o.id === obraAtiva?.id && <span className={styles.selo}>Ativa</span>}
              <span className={`${styles.badge} ${o.status === 'ativa' ? styles.badgeAtiva : ''}`}>{LABEL_STATUS[o.status]}</span>
            </div>
            <div className={styles.cardMeta}>
              {(o.cidade || o.estado) && <span>📍 {o.cidade}{o.cidade && o.estado ? ' — ' : ''}{o.estado}</span>}
              {o.data_fim_prevista && <span>🏁 Previsão: {new Date(o.data_fim_prevista + 'T00:00:00').toLocaleDateString('pt-BR')}</span>}
            </div>
          </div>
          <button className={styles.btnSecundario}>Editar</button>
        </div>
      ))}
    </div>
  )
}
```

Os botões "+ Nova obra" e "Editar" ainda não têm `onClick` — isso é implementado na Task 2. O objetivo desta tarefa é a lista funcionar e a rota existir.

- [ ] **Step 3: Registrar a rota em `src/App.tsx`**

Adicionar o import logo após `import Fornecedores from './pages/Fornecedores'` (linha 17 do arquivo atual):

```tsx
import DadosObra from './pages/DadosObra'
```

Adicionar a rota logo após `<Route path="usuarios" element={<Usuarios />} />` (dentro do grupo protegido):

```tsx
        <Route path="dados-obra" element={<DadosObra />} />
```

- [ ] **Step 4: Adicionar o card admin-only no Dashboard**

Em `src/pages/Dashboard.tsx`, dentro do `<div className={styles.grid}>`, logo depois do `{CARDS_MODULOS.map(m => { ... })}` (fecha o `.map` antes de `</div>` da grid — ver `Dashboard.tsx:332-382` do arquivo atual), adicionar mais um card, fora do array `CARDS_MODULOS` (é gate por papel, não por `temModulo`):

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
```

Este bloco vai logo após o fechamento do `{CARDS_MODULOS.map(...)}` e antes do `</div>` que fecha `styles.grid`.

- [ ] **Step 5: Verificar**

Rodar `npm run build` (TypeScript deve compilar limpo). No navegador, logar como admin: confirmar que o card "Dados da Obra" aparece na grade de módulos do Dashboard, que clicar nele navega para `/dados-obra`, que a lista mostra a obra "Tharsos Imperial" com o selo "Ativa" e o badge de status, e que o botão "← Início" volta pro Dashboard. Logar como `equipe` (sem ser admin) e confirmar que o card não aparece no Dashboard e que acessar `/dados-obra` direto pela URL mostra "Acesso restrito ao administrador."

- [ ] **Step 6: Commit**

```bash
git add src/pages/DadosObra.tsx src/pages/DadosObra.module.css src/App.tsx src/pages/Dashboard.tsx
git commit -m "Dados da Obra: lista de obras, rota e card no Dashboard (admin-only)"
```

---

### Task 2: Formulário de criar/editar obra

**Files:**
- Modify: `src/pages/DadosObra.tsx` (estado do formulário, `criar`/`salvarEdicao`, JSX do formulário)
- Modify: `src/pages/DadosObra.module.css` (nenhuma classe nova — reaproveita `.bloco`/`.campos`/`.linha`/`.campo` de `Fornecedores.module.css`, adicionados nesta tarefa já que a Task 1 não os usou)

**Interfaces:**
- Consumes: `perfil.id` de `useAuth()` (para `criado_por` no insert); `StatusObra` de `../lib/supabase`.
- Produces: nenhuma interface nova para tarefas seguintes — esta é a última tarefa do plano.

- [ ] **Step 1: Adicionar as classes de formulário faltantes ao CSS**

Adicionar ao final de `src/pages/DadosObra.module.css`:

```css
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

.linha {
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
}

.campo textarea { resize: vertical; min-height: 60px; }

.campo input:focus, .campo select:focus, .campo textarea:focus { border-color: var(--navy); outline: none; }

.acoesForm {
  display: flex;
  gap: 10px;
  margin-top: 4px;
}
```

- [ ] **Step 2: Adicionar o estado do formulário em `DadosObra.tsx`**

Logo abaixo de `const [carregando, setCarregando] = useState(true)`, adicionar:

```tsx
  const [formAberto, setFormAberto] = useState(false)
  const [editandoId, setEditandoId] = useState<string | null>(null)
  const [nome, setNome] = useState('')
  const [descricao, setDescricao] = useState('')
  const [endereco, setEndereco] = useState('')
  const [cidade, setCidade] = useState('')
  const [estado, setEstado] = useState('')
  const [dataInicio, setDataInicio] = useState('')
  const [dataFimPrevista, setDataFimPrevista] = useState('')
  const [status, setStatus] = useState<StatusObra>('ativa')
  const [salvando, setSalvando] = useState(false)
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)
```

- [ ] **Step 3: Adicionar as funções de abrir/limpar/salvar formulário**

Logo abaixo da função `carregar()`, adicionar:

```tsx
  function abrirNovo() {
    setEditandoId(null)
    setNome(''); setDescricao(''); setEndereco(''); setCidade(''); setEstado('')
    setDataInicio(''); setDataFimPrevista(''); setStatus('ativa')
    setMsg(null)
    setFormAberto(true)
  }

  function abrirEdicao(o: Obra) {
    setEditandoId(o.id)
    setNome(o.nome)
    setDescricao(o.descricao ?? '')
    setEndereco(o.endereco ?? '')
    setCidade(o.cidade ?? '')
    setEstado(o.estado ?? '')
    setDataInicio(o.data_inicio ?? '')
    setDataFimPrevista(o.data_fim_prevista ?? '')
    setStatus(o.status)
    setMsg(null)
    setFormAberto(true)
  }

  async function salvar() {
    if (!nome.trim()) {
      setMsg({ tipo: 'erro', texto: 'Informe o nome da obra.' })
      return
    }
    setSalvando(true)
    setMsg(null)
    const dados = {
      nome: nome.trim(),
      descricao: descricao.trim() || null,
      endereco: endereco.trim() || null,
      cidade: cidade.trim() || null,
      estado: estado.trim().toUpperCase() || null,
      data_inicio: dataInicio || null,
      data_fim_prevista: dataFimPrevista || null,
      status,
    }
    const { error } = editandoId
      ? await supabase.from('obras').update(dados).eq('id', editandoId)
      : await supabase.from('obras').insert({ ...dados, criado_por: perfil?.id })
    setSalvando(false)
    if (error) {
      setMsg({ tipo: 'erro', texto: `Erro ao salvar: ${error.message}` })
      return
    }
    setMsg({ tipo: 'ok', texto: editandoId ? 'Obra atualizada.' : 'Obra cadastrada.' })
    setFormAberto(false)
    carregar()
  }
```

- [ ] **Step 4: Ligar os botões da lista e adicionar o JSX do formulário**

Trocar `<button className={styles.btnPrincipal}>+ Nova obra</button>` por:

```tsx
        <button className={styles.btnPrincipal} onClick={abrirNovo}>+ Nova obra</button>
```

Trocar `<button className={styles.btnSecundario}>Editar</button>` (dentro do `.map`) por:

```tsx
          <button className={styles.btnSecundario} onClick={() => abrirEdicao(o)}>Editar</button>
```

Adicionar o formulário logo após o bloco `<div className={styles.topo}>...</div>` e antes do bloco de carregamento/lista:

```tsx
      {formAberto && (
        <div className={styles.bloco}>
          <div className={styles.campos}>
            <label className={styles.campo}>
              Nome *
              <input value={nome} onChange={e => setNome(e.target.value)} placeholder="Ex.: Tharsos Imperial" />
            </label>
            <label className={styles.campo}>
              Descrição
              <textarea value={descricao} onChange={e => setDescricao(e.target.value)} placeholder="Opcional" />
            </label>
            <label className={styles.campo}>
              Endereço
              <input value={endereco} onChange={e => setEndereco(e.target.value)} placeholder="Opcional" />
            </label>
            <div className={styles.linha}>
              <label className={styles.campo}>
                Cidade
                <input value={cidade} onChange={e => setCidade(e.target.value)} placeholder="Opcional" />
              </label>
              <label className={styles.campo}>
                Estado
                <input value={estado} onChange={e => setEstado(e.target.value)} maxLength={2} placeholder="GO" />
              </label>
            </div>
            <div className={styles.linha}>
              <label className={styles.campo}>
                Data de início
                <input type="date" value={dataInicio} onChange={e => setDataInicio(e.target.value)} />
              </label>
              <label className={styles.campo}>
                Previsão de término
                <input type="date" value={dataFimPrevista} onChange={e => setDataFimPrevista(e.target.value)} />
              </label>
            </div>
            <label className={styles.campo}>
              Status
              <select value={status} onChange={e => setStatus(e.target.value as StatusObra)}>
                <option value="ativa">Ativa</option>
                <option value="pausada">Pausada</option>
                <option value="concluida">Concluída</option>
                <option value="arquivada">Arquivada</option>
              </select>
            </label>
          </div>
          {msg && <p className={msg.tipo === 'ok' ? styles.msgOk : styles.msgErro}>{msg.texto}</p>}
          <div className={styles.acoesForm}>
            <button className={styles.btnPrincipal} onClick={salvar} disabled={salvando}>
              {salvando ? 'Salvando…' : editandoId ? 'Salvar alterações' : '+ Cadastrar obra'}
            </button>
            <button className={styles.btnSecundario} onClick={() => setFormAberto(false)}>Cancelar</button>
          </div>
        </div>
      )}
```

- [ ] **Step 5: Verificar**

Rodar `npm run build` (compilação limpa). No navegador, logado como admin em `/dados-obra`:
1. Clicar "+ Nova obra", preencher nome + as duas datas + estado, salvar — confirmar mensagem de sucesso, o formulário fecha, e a nova obra aparece na lista.
2. Clicar "Editar" na obra "Tharsos Imperial", preencher `Data de início` e `Previsão de término` (os campos que motivaram esta feature), salvar — confirmar mensagem de sucesso.
3. Voltar para `/dashboard` — confirmar que o card-herói agora mostra as métricas Prazo/Semana/Restam (antes ausentes por falta desses dados).
4. Confirmar que a segunda obra criada faz o seletor de obra ativa aparecer no cabeçalho (`Layout.tsx`, `obras.length > 1`) — sem que esta tela tenha feito nada além de criar o registro.

- [ ] **Step 6: Commit**

```bash
git add src/pages/DadosObra.tsx src/pages/DadosObra.module.css
git commit -m "Dados da Obra: formulário de criar/editar obra"
```

---

## Verificação final (todas as tarefas concluídas)

- [ ] `npm run build` sem erros.
- [ ] Testar como `admin`: card aparece, lista carrega, criar obra nova funciona, editar a obra piloto preenchendo `data_inicio`/`data_fim_prevista` funciona, e o Dashboard passa a mostrar as métricas do card-herói para essa obra.
- [ ] Testar como `equipe`/`cliente`: card não aparece no Dashboard; acesso direto à URL `/dados-obra` mostra a mensagem de acesso restrito.
- [ ] Confirmar que nenhuma chamada a `selecionarObra` foi adicionada nesta tela — só o seletor existente em `Layout.tsx` continua responsável por trocar a obra ativa.
