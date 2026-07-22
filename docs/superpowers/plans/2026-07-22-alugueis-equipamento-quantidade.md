# Aluguéis — Equipamento, quantidade e devolução parcial Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Responsável pela implementação:** Codex (execução contínua padrão do projeto — ver
> `docs/colaboracao-codex-claude.md`). Claude Code fez a arquitetura (spec) e este plano; a
> categoria de risco (tabela nova + 2 triggers novos que se encadeiam) exige revisão obrigatória
> do Claude Code **pós-commit**, antes de qualquer teste de campo com uma locação real.

**Goal:** Renomear "Ferramenta" para "Equipamento" na aba Aluguéis do Almoxarifado, adicionar
quantidade à locação e suportar devolução parcial (a locação fica aberta com o saldo restante até
devolver tudo), mantendo um único prazo para o lote inteiro.

**Architecture:** Coluna `nome_ferramenta` renomeada para `nome_equipamento` e nova coluna
`quantidade` em `ferramenta_locacoes`. Tabela nova `ferramenta_locacoes_devolucoes` (histórico
imutável, um registro por devolução) com um trigger que valida o saldo antes de cada inserção e
outro que fecha a locação automaticamente quando a soma devolvida bate com a quantidade total.
Saldo pendente é sempre calculado ao vivo no frontend (soma das devoluções), nunca duplicado numa
coluna própria — mesmo princípio já usado em Medições.

**Tech Stack:** Supabase (Postgres + RLS) + React 19 + TypeScript + Vite. Sem framework de testes
no projeto — verificação por SQL direto e `npm run build` + teste manual no navegador.

## Global Constraints

- Spec completa em
  `docs/superpowers/specs/2026-07-22-alugueis-equipamento-quantidade-design.md` — ler antes de
  implementar qualquer task.
- Escopo é só a aba "Aluguéis" (`ferramenta_locacoes`) — não tocar na aba "Ferramentas"
  (`ferramentas`/`ferramenta_emprestimos`, empréstimo individual).
- Um único prazo (`data_entrega_prevista`) vale para o lote inteiro, mesmo com devoluções
  parciais — não criar prazo por devolução.
- A trava de "não editar quantidade depois de ter devolução parcial" é só no frontend (decisão
  explícita da spec §3) — não adicionar constraint/trigger de banco para isso nesta entrega.
- Nenhuma das duas funções de trigger é `SECURITY DEFINER` — ambas rodam com o mesmo papel de
  quem insere a devolução, e a policy `floc_update` já permite esse UPDATE porque
  `data_entregue` ainda é nulo no momento em que o trigger de fechamento roda.

---

### Task 1: Migração — coluna quantidade, rename, tabela de devoluções, triggers e RLS

**Files:**
- Create: `supabase/migrations/20260722_alugueis_quantidade_devolucao.sql`

**Interfaces:**
- Produces: `ferramenta_locacoes.nome_equipamento` (renomeada), `ferramenta_locacoes.quantidade`;
  tabela `ferramenta_locacoes_devolucoes`; funções `validar_devolucao_locacao()` e
  `fechar_locacao_se_completa()` — usadas pela Task 2 (tipos) e Task 4 (frontend).

- [ ] **Step 1: Escrever a migração**

Criar `supabase/migrations/20260722_alugueis_quantidade_devolucao.sql`:

```sql
-- Aluguéis: renomeia ferramenta -> equipamento, adiciona quantidade e
-- suporte a devolução parcial. Ver
-- docs/superpowers/specs/2026-07-22-alugueis-equipamento-quantidade-design.md

ALTER TABLE ferramenta_locacoes RENAME COLUMN nome_ferramenta TO nome_equipamento;

ALTER TABLE ferramenta_locacoes ADD COLUMN quantidade INTEGER NOT NULL DEFAULT 1 CHECK (quantidade > 0);
ALTER TABLE ferramenta_locacoes ALTER COLUMN quantidade DROP DEFAULT;

CREATE TABLE ferramenta_locacoes_devolucoes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  locacao_id    UUID NOT NULL REFERENCES ferramenta_locacoes(id) ON DELETE CASCADE,
  quantidade    INTEGER NOT NULL CHECK (quantidade > 0),
  devolvido_por UUID NOT NULL DEFAULT auth.uid() REFERENCES perfis_usuario(id),
  devolvido_em  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ferramenta_locacoes_devolucoes_locacao
  ON ferramenta_locacoes_devolucoes(locacao_id);

-- Bloqueia devolver mais do que o saldo pendente, ou devolver algo numa
-- locação já encerrada.
CREATE OR REPLACE FUNCTION validar_devolucao_locacao() RETURNS TRIGGER AS $$
DECLARE
  v_quantidade_total INTEGER;
  v_ja_devolvido      INTEGER;
  v_data_entregue     DATE;
BEGIN
  SELECT quantidade, data_entregue INTO v_quantidade_total, v_data_entregue
  FROM ferramenta_locacoes WHERE id = NEW.locacao_id;

  IF v_data_entregue IS NOT NULL THEN
    RAISE EXCEPTION 'Esta locação já foi encerrada.';
  END IF;

  SELECT COALESCE(SUM(quantidade), 0) INTO v_ja_devolvido
  FROM ferramenta_locacoes_devolucoes WHERE locacao_id = NEW.locacao_id;

  IF v_ja_devolvido + NEW.quantidade > v_quantidade_total THEN
    RAISE EXCEPTION 'Quantidade devolvida (%) ultrapassa o saldo pendente (%).',
      NEW.quantidade, v_quantidade_total - v_ja_devolvido;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_validar_devolucao_locacao
  BEFORE INSERT ON ferramenta_locacoes_devolucoes
  FOR EACH ROW EXECUTE FUNCTION validar_devolucao_locacao();

-- Fecha a locação (mesmos campos já existentes) quando a soma devolvida
-- bate exatamente com a quantidade total.
CREATE OR REPLACE FUNCTION fechar_locacao_se_completa() RETURNS TRIGGER AS $$
DECLARE
  v_quantidade_total INTEGER;
  v_total_devolvido  INTEGER;
BEGIN
  SELECT quantidade INTO v_quantidade_total
  FROM ferramenta_locacoes WHERE id = NEW.locacao_id;

  SELECT COALESCE(SUM(quantidade), 0) INTO v_total_devolvido
  FROM ferramenta_locacoes_devolucoes WHERE locacao_id = NEW.locacao_id;

  IF v_total_devolvido = v_quantidade_total THEN
    UPDATE ferramenta_locacoes
    SET data_entregue = CURRENT_DATE, entregue_por = NEW.devolvido_por, entregue_em = now()
    WHERE id = NEW.locacao_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_fechar_locacao_se_completa
  AFTER INSERT ON ferramenta_locacoes_devolucoes
  FOR EACH ROW EXECUTE FUNCTION fechar_locacao_se_completa();

ALTER TABLE ferramenta_locacoes_devolucoes ENABLE ROW LEVEL SECURITY;

CREATE POLICY flocdev_select ON ferramenta_locacoes_devolucoes FOR SELECT TO authenticated
  USING (pode_editar_almoxarifado());

CREATE POLICY flocdev_insert ON ferramenta_locacoes_devolucoes FOR INSERT TO authenticated
  WITH CHECK (pode_editar_almoxarifado() AND devolvido_por = auth.uid());

CREATE POLICY isolamento_obra ON ferramenta_locacoes_devolucoes AS RESTRICTIVE FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM ferramenta_locacoes fl WHERE fl.id = locacao_id AND pode_acessar_obra(fl.obra_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM ferramenta_locacoes fl WHERE fl.id = locacao_id AND pode_acessar_obra(fl.obra_id)));
```

- [ ] **Step 2: Aplicar a migração**

Aplicar via `mcp__claude_ai_Supabase__apply_migration` (nome: `alugueis_quantidade_devolucao`).

- [ ] **Step 3: Verificar com teste real (transação com ROLLBACK)**

Usar uma locação de teste real (ou fixture temporária dentro da mesma transação, se não houver
nenhuma `aberta`) simulando um usuário autenticado com módulo almoxarifado:

```sql
BEGIN;
SET LOCAL request.jwt.claims = '{"sub": "<uuid de um admin real>", "role": "authenticated"}';
SET LOCAL role authenticated;

-- 1. Inserir uma locação de teste com quantidade = 10
INSERT INTO ferramenta_locacoes (obra_id, nome_equipamento, locadora, modalidade, quantidade, data_chegada, data_entrega_prevista)
VALUES ('<obra_id real>', 'Escora de teste', 'Locadora teste', 'semanal', 10, CURRENT_DATE, CURRENT_DATE + 7)
RETURNING id \gset

-- 2. Devolver 6 (parcial) — deve funcionar, locação continua aberta
INSERT INTO ferramenta_locacoes_devolucoes (locacao_id, quantidade) VALUES (:'id', 6);
SELECT data_entregue FROM ferramenta_locacoes WHERE id = :'id'; -- esperado: NULL

-- 3. Tentar devolver 5 (ultrapassa o saldo de 4) — deve falhar
INSERT INTO ferramenta_locacoes_devolucoes (locacao_id, quantidade) VALUES (:'id', 5);
-- esperado: ERRO "Quantidade devolvida (5) ultrapassa o saldo pendente (4)."

-- 4. Devolver os 4 restantes — deve fechar a locação sozinha
INSERT INTO ferramenta_locacoes_devolucoes (locacao_id, quantidade) VALUES (:'id', 4);
SELECT data_entregue, entregue_por, entregue_em FROM ferramenta_locacoes WHERE id = :'id';
-- esperado: todos preenchidos

-- 5. Tentar devolver mais alguma coisa numa locação já fechada — deve falhar
INSERT INTO ferramenta_locacoes_devolucoes (locacao_id, quantidade) VALUES (:'id', 1);
-- esperado: ERRO "Esta locação já foi encerrada."

ROLLBACK;
```

(Se o cliente SQL usado não suportar `\gset`, capturar o `id` retornado manualmente e substituir
nas chamadas seguintes dentro da mesma transação.)

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260722_alugueis_quantidade_devolucao.sql
git commit -m "feat: adiciona quantidade e devolucao parcial em alugueis de equipamento"
```

---

### Task 2: Tipos em `src/lib/supabase.ts`

**Files:**
- Modify: `src/lib/supabase.ts`

**Interfaces:**
- Produces: `FerramentaLocacao` atualizado, `FerramentaLocacaoDevolucao` — usados pelas Tasks 3 e 4.

- [ ] **Step 1: Atualizar `FerramentaLocacao` e adicionar `FerramentaLocacaoDevolucao`**

Em `src/lib/supabase.ts:592-609`, trocar:

```ts
export interface FerramentaLocacao {
  id: string
  obra_id: string
  nome_ferramenta: string
  locadora: string
  modalidade: ModalidadeLocacaoFerramenta
  data_chegada: string
  data_entrega_prevista: string
  data_entregue: string | null
  observacao: string | null
  ativo: boolean
  criado_por: string
  criado_em: string
  entregue_por: string | null
  entregue_em: string | null
  editado_por: string | null
  editado_em: string | null
}
```

por:

```ts
export interface FerramentaLocacao {
  id: string
  obra_id: string
  nome_equipamento: string
  quantidade: number
  locadora: string
  modalidade: ModalidadeLocacaoFerramenta
  data_chegada: string
  data_entrega_prevista: string
  data_entregue: string | null
  observacao: string | null
  ativo: boolean
  criado_por: string
  criado_em: string
  entregue_por: string | null
  entregue_em: string | null
  editado_por: string | null
  editado_em: string | null
}

export interface FerramentaLocacaoDevolucao {
  id: string
  locacao_id: string
  quantidade: number
  devolvido_por: string
  devolvido_em: string
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/supabase.ts
git commit -m "feat: atualiza tipos de FerramentaLocacao para equipamento e quantidade"
```

---

### Task 3: `PainelLocacao` — renomear termos, campo quantidade, travar após devolução

**Files:**
- Modify: `src/pages/Almoxarifado.tsx`

**Interfaces:**
- Consumes: `FerramentaLocacao` atualizado (Task 2).
- Produces: `PainelLocacaoProps` ganha `totalDevolvido?: number` — consumido pela Task 4, que
  passa esse valor ao renderizar `PainelLocacao` em modo de edição.

- [ ] **Step 1: Atualizar `PainelLocacaoProps` e o estado inicial**

Em `src/pages/Almoxarifado.tsx:279-296`, trocar:

```tsx
interface PainelLocacaoProps {
  locacao?: FerramentaLocacao
  onFechar: () => void
  onSucesso: () => void
}

function PainelLocacao({ locacao, onFechar, onSucesso }: PainelLocacaoProps) {
  const { obraAtiva } = useObra()
  const { perfil } = useAuth()

  const editando = !!locacao
  const [nomeFerramenta, setNomeFerramenta] = useState(locacao?.nome_ferramenta ?? '')
  const [locadora, setLocadora] = useState(locacao?.locadora ?? '')
  const [modalidade, setModalidade] = useState<ModalidadeLocacaoFerramenta>(locacao?.modalidade ?? 'diaria')
  const [dataChegada, setDataChegada] = useState(locacao?.data_chegada ?? dataHoje())
  const [dataEntregaPrevista, setDataEntregaPrevista] = useState(locacao?.data_entrega_prevista ?? '')
  const [observacao, setObservacao] = useState(locacao?.observacao ?? '')
  const [salvando, setSalvando] = useState(false)
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)
```

por:

```tsx
interface PainelLocacaoProps {
  locacao?: FerramentaLocacao
  totalDevolvido?: number
  onFechar: () => void
  onSucesso: () => void
}

function PainelLocacao({ locacao, totalDevolvido = 0, onFechar, onSucesso }: PainelLocacaoProps) {
  const { obraAtiva } = useObra()
  const { perfil } = useAuth()

  const editando = !!locacao
  const [nomeEquipamento, setNomeEquipamento] = useState(locacao?.nome_equipamento ?? '')
  const [quantidade, setQuantidade] = useState(String(locacao?.quantidade ?? 1))
  const [locadora, setLocadora] = useState(locacao?.locadora ?? '')
  const [modalidade, setModalidade] = useState<ModalidadeLocacaoFerramenta>(locacao?.modalidade ?? 'diaria')
  const [dataChegada, setDataChegada] = useState(locacao?.data_chegada ?? dataHoje())
  const [dataEntregaPrevista, setDataEntregaPrevista] = useState(locacao?.data_entrega_prevista ?? '')
  const [observacao, setObservacao] = useState(locacao?.observacao ?? '')
  const [salvando, setSalvando] = useState(false)
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)

  const quantidadeTravada = editando && totalDevolvido > 0
```

- [ ] **Step 2: Atualizar `salvar()` — validação e payload**

Em `src/pages/Almoxarifado.tsx:299-344`, trocar:

```tsx
  async function salvar() {
    if (!obraAtiva) return
    if (!nomeFerramenta.trim()) {
      setMsg({ tipo: 'erro', texto: 'Informe a ferramenta alugada.' })
      return
    }
    if (!locadora.trim()) {
      setMsg({ tipo: 'erro', texto: 'Informe a locadora.' })
      return
    }
    if (!dataChegada) {
      setMsg({ tipo: 'erro', texto: 'Informe o dia de chegada na obra.' })
      return
    }
    if (!dataEntregaPrevista) {
      setMsg({ tipo: 'erro', texto: 'Informe o dia de entrega previsto.' })
      return
    }
    if (dataEntregaPrevista < dataChegada) {
      setMsg({ tipo: 'erro', texto: 'A entrega prevista não pode ser anterior à chegada na obra.' })
      return
    }
    setSalvando(true)
    setMsg(null)
    const payload = {
      nome_ferramenta: nomeFerramenta.trim(),
      locadora: locadora.trim(),
      modalidade,
      data_chegada: dataChegada,
      data_entrega_prevista: dataEntregaPrevista,
      observacao: observacao.trim() || null,
    }
```

por:

```tsx
  async function salvar() {
    if (!obraAtiva) return
    if (!nomeEquipamento.trim()) {
      setMsg({ tipo: 'erro', texto: 'Informe o equipamento alugado.' })
      return
    }
    const qtd = Number(quantidade)
    if (!Number.isInteger(qtd) || qtd <= 0) {
      setMsg({ tipo: 'erro', texto: 'Informe uma quantidade inteira maior que zero.' })
      return
    }
    if (!locadora.trim()) {
      setMsg({ tipo: 'erro', texto: 'Informe a locadora.' })
      return
    }
    if (!dataChegada) {
      setMsg({ tipo: 'erro', texto: 'Informe o dia de chegada na obra.' })
      return
    }
    if (!dataEntregaPrevista) {
      setMsg({ tipo: 'erro', texto: 'Informe o dia de entrega previsto.' })
      return
    }
    if (dataEntregaPrevista < dataChegada) {
      setMsg({ tipo: 'erro', texto: 'A entrega prevista não pode ser anterior à chegada na obra.' })
      return
    }
    setSalvando(true)
    setMsg(null)
    const payload = {
      nome_equipamento: nomeEquipamento.trim(),
      quantidade: qtd,
      locadora: locadora.trim(),
      modalidade,
      data_chegada: dataChegada,
      data_entrega_prevista: dataEntregaPrevista,
      observacao: observacao.trim() || null,
    }
```

- [ ] **Step 3: Atualizar o formulário — rótulos e campo quantidade**

Em `src/pages/Almoxarifado.tsx:346-369`, trocar:

```tsx
  return (
    <div className={styles.painelForm}>
      <div className={styles.painelHeader}>
        <h2>{editando ? 'Editar locação de ferramenta' : 'Nova locação de ferramenta'}</h2>
        <button className={styles.btnFechar} onClick={onFechar}>✕</button>
      </div>
      <div className={styles.linha2}>
        <label className={styles.campo}>
          Ferramenta *
          <input value={nomeFerramenta} onChange={e => setNomeFerramenta(e.target.value)} placeholder="Ex.: Compactador de solo" />
        </label>
        <label className={styles.campo}>
          Locadora *
          <input value={locadora} onChange={e => setLocadora(e.target.value)} placeholder="Nome da locadora" />
        </label>
        <label className={styles.campo}>
          Modalidade *
          <select value={modalidade} onChange={e => setModalidade(e.target.value as ModalidadeLocacaoFerramenta)}>
            <option value="diaria">Diária</option>
            <option value="semanal">Semanal</option>
            <option value="mensal">Mensal</option>
          </select>
        </label>
      </div>
```

por:

```tsx
  return (
    <div className={styles.painelForm}>
      <div className={styles.painelHeader}>
        <h2>{editando ? 'Editar locação de equipamento' : 'Nova locação de equipamento'}</h2>
        <button className={styles.btnFechar} onClick={onFechar}>✕</button>
      </div>
      <div className={styles.linha2}>
        <label className={styles.campo}>
          Equipamento *
          <input value={nomeEquipamento} onChange={e => setNomeEquipamento(e.target.value)} placeholder="Ex.: Compactador de solo" />
        </label>
        <label className={styles.campo}>
          Quantidade *
          <input type="number" min="1" step="1" value={quantidade}
            onChange={e => setQuantidade(e.target.value)} disabled={quantidadeTravada} />
          {quantidadeTravada && <span className={styles.linhaDesc}>Já tem devolução registrada — não dá mais pra corrigir a quantidade.</span>}
        </label>
        <label className={styles.campo}>
          Locadora *
          <input value={locadora} onChange={e => setLocadora(e.target.value)} placeholder="Nome da locadora" />
        </label>
        <label className={styles.campo}>
          Modalidade *
          <select value={modalidade} onChange={e => setModalidade(e.target.value as ModalidadeLocacaoFerramenta)}>
            <option value="diaria">Diária</option>
            <option value="semanal">Semanal</option>
            <option value="mensal">Mensal</option>
          </select>
        </label>
      </div>
```

- [ ] **Step 4: Build**

```bash
npm run build
```

Deve compilar sem erros — `AbaLocacoes` ainda usa `locacao.nome_ferramenta` em vários lugares
nesta altura do plano (Task 4 corrige isso); se o build falhar por causa disso, é esperado até a
Task 4 estar completa. Se preferir compilar limpo a cada task, adiar este `npm run build` para o
fim da Task 4.

- [ ] **Step 5: Commit**

```bash
git add src/pages/Almoxarifado.tsx
git commit -m "feat: renomeia ferramenta para equipamento e adiciona quantidade no formulario de locacao"
```

---

### Task 4: `AbaLocacoes` — saldo devolvido, nova devolução parcial

**Files:**
- Modify: `src/pages/Almoxarifado.tsx`
- Modify: `src/pages/Almoxarifado.module.css` (só se precisar de uma classe nova para o aviso de
  saldo — ver Step 4)

**Interfaces:**
- Consumes: `FerramentaLocacaoDevolucao` (Task 2), `PainelLocacaoProps.totalDevolvido` (Task 3).

- [ ] **Step 1: Carregar as devoluções junto com as locações**

Em `src/pages/Almoxarifado.tsx:110-134`, trocar:

```tsx
function AbaLocacoes() {
  const { confirmar } = useConfirmDialog()
  const { perfil } = useAuth()
  const { obraAtiva } = useObra()

  const [locacoes, setLocacoes] = useState<FerramentaLocacao[]>([])
  const [carregando, setCarregando] = useState(true)
  const [busca, setBusca] = useState('')
  const [filtroEstado, setFiltroEstado] = useState<FiltroEstadoLocacao>('')
  const [mostrarNova, setMostrarNova] = useState(false)
  const [locacaoEditando, setLocacaoEditando] = useState<FerramentaLocacao | null>(null)
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)

  async function carregar() {
    if (!obraAtiva) return
    setCarregando(true)
    const { data, error } = await supabase.from('ferramenta_locacoes').select('*')
      .eq('obra_id', obraAtiva.id).eq('ativo', true).order('data_entrega_prevista')
    setCarregando(false)
    if (error) {
      setMsg({ tipo: 'erro', texto: `Erro ao carregar aluguéis: ${error.message}` })
      return
    }
    setLocacoes(data ?? [])
  }

  useEffect(() => { carregar() }, [obraAtiva])
```

por:

```tsx
function AbaLocacoes() {
  const { confirmar } = useConfirmDialog()
  const { perfil } = useAuth()
  const { obraAtiva } = useObra()

  const [locacoes, setLocacoes] = useState<FerramentaLocacao[]>([])
  const [devolvidoPorLocacao, setDevolvidoPorLocacao] = useState<Map<string, number>>(new Map())
  const [carregando, setCarregando] = useState(true)
  const [busca, setBusca] = useState('')
  const [filtroEstado, setFiltroEstado] = useState<FiltroEstadoLocacao>('')
  const [mostrarNova, setMostrarNova] = useState(false)
  const [locacaoEditando, setLocacaoEditando] = useState<FerramentaLocacao | null>(null)
  const [locacaoDevolvendo, setLocacaoDevolvendo] = useState<FerramentaLocacao | null>(null)
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)

  async function carregar() {
    if (!obraAtiva) return
    setCarregando(true)
    const { data, error } = await supabase.from('ferramenta_locacoes').select('*')
      .eq('obra_id', obraAtiva.id).eq('ativo', true).order('data_entrega_prevista')
    if (error) {
      setCarregando(false)
      setMsg({ tipo: 'erro', texto: `Erro ao carregar aluguéis: ${error.message}` })
      return
    }
    const abertas = (data ?? []).filter(l => !l.data_entregue)
    const mapa = new Map<string, number>()
    if (abertas.length > 0) {
      const { data: devolucoes } = await supabase.from('ferramenta_locacoes_devolucoes')
        .select('locacao_id, quantidade').in('locacao_id', abertas.map(l => l.id))
      for (const d of devolucoes ?? []) {
        mapa.set(d.locacao_id, (mapa.get(d.locacao_id) ?? 0) + d.quantidade)
      }
    }
    setDevolvidoPorLocacao(mapa)
    setLocacoes(data ?? [])
    setCarregando(false)
  }

  useEffect(() => { carregar() }, [obraAtiva])
```

- [ ] **Step 2: Trocar `registrarEntrega` (fechamento total direto) por abertura do painel de devolução**

Em `src/pages/Almoxarifado.tsx:163-181`, remover a função `registrarEntrega` inteira:

```tsx
  async function registrarEntrega(locacao: FerramentaLocacao) {
    if (!perfil) return
    if (!await confirmar({
      titulo: 'Registrar entrega',
      mensagem: `Confirma que "${locacao.nome_ferramenta}" foi entregue para a locadora?`,
      confirmarTexto: 'Registrar entrega',
    })) return
    setMsg(null)
    const { data, error } = await supabase.from('ferramenta_locacoes')
      .update({ data_entregue: dataHoje(), entregue_por: perfil.id, entregue_em: new Date().toISOString() })
      .eq('id', locacao.id).is('data_entregue', null).select()
    if (error || !data || data.length === 0) {
      setMsg({ tipo: 'erro', texto: error?.message ?? 'Esta locação já foi entregue por outra pessoa.' })
      await carregar()
      return
    }
    await carregar()
    setMsg({ tipo: 'ok', texto: 'Entrega registrada.' })
  }
```

Ela é substituída pelo componente `PainelDevolucao` (Step 5) — o botão da lista (Step 4) passa a
abrir esse painel em vez de chamar uma função direta. `confirmar` (de `useConfirmDialog`) deixa de
ser usado nesta função, mas continua sendo importado/usado no topo do arquivo por outras abas —
não remover o import.

- [ ] **Step 3: Renderizar `PainelDevolucao` e passar `totalDevolvido` para `PainelLocacao`**

Em `src/pages/Almoxarifado.tsx:200-210`, trocar:

```tsx
      {locacaoEditando && (
        <PainelLocacao
          locacao={locacaoEditando}
          onFechar={() => setLocacaoEditando(null)}
          onSucesso={async () => {
            setLocacaoEditando(null)
            await carregar()
            setMsg({ tipo: 'ok', texto: 'Locação corrigida.' })
          }}
        />
      )}
```

por:

```tsx
      {locacaoEditando && (
        <PainelLocacao
          locacao={locacaoEditando}
          totalDevolvido={devolvidoPorLocacao.get(locacaoEditando.id) ?? 0}
          onFechar={() => setLocacaoEditando(null)}
          onSucesso={async () => {
            setLocacaoEditando(null)
            await carregar()
            setMsg({ tipo: 'ok', texto: 'Locação corrigida.' })
          }}
        />
      )}

      {locacaoDevolvendo && (
        <PainelDevolucao
          locacao={locacaoDevolvendo}
          saldoPendente={locacaoDevolvendo.quantidade - (devolvidoPorLocacao.get(locacaoDevolvendo.id) ?? 0)}
          onFechar={() => setLocacaoDevolvendo(null)}
          onSucesso={async () => {
            setLocacaoDevolvendo(null)
            await carregar()
            setMsg({ tipo: 'ok', texto: 'Devolução registrada.' })
          }}
        />
      )}
```

- [ ] **Step 4: Atualizar a busca, a linha da lista e o botão "Registrar entrega"**

Em `src/pages/Almoxarifado.tsx:143-144`, trocar:

```tsx
        (!termo || l.locacao.nome_ferramenta.toLowerCase().includes(termo) || l.locacao.locadora.toLowerCase().includes(termo)) &&
```

por:

```tsx
        (!termo || l.locacao.nome_equipamento.toLowerCase().includes(termo) || l.locacao.locadora.toLowerCase().includes(termo)) &&
```

Em `src/pages/Almoxarifado.tsx:221-222`, trocar:

```tsx
        <input className={styles.busca} value={busca} onChange={e => setBusca(e.target.value)}
          placeholder="Buscar por ferramenta ou locadora…" />
```

por:

```tsx
        <input className={styles.busca} value={busca} onChange={e => setBusca(e.target.value)}
          placeholder="Buscar por equipamento ou locadora…" />
```

Em `src/pages/Almoxarifado.tsx:235-237`, trocar:

```tsx
        <p className={styles.vazio}>
          {locacoes.length === 0 ? 'Nenhuma locação de ferramenta cadastrada.' : 'Nenhuma locação com esses filtros.'}
        </p>
```

por:

```tsx
        <p className={styles.vazio}>
          {locacoes.length === 0 ? 'Nenhuma locação de equipamento cadastrada.' : 'Nenhuma locação com esses filtros.'}
        </p>
```

Em `src/pages/Almoxarifado.tsx:243-270`, trocar:

```tsx
          {linhas.map(({ locacao, estado, dias }) => (
            <div key={locacao.id} className={styles.linha}>
              <div className={styles.linhaInfo}>
                <div className={styles.linhaTopo}>
                  <span className={styles.linhaNome}>{locacao.nome_ferramenta}</span>
                  <span className={`${styles.chip} ${styles[`chip_${estado}`]}`}>{ESTADO_LOCACAO_LABEL[estado]}</span>
                </div>
                <div className={styles.linhaDesc}>
                  {locacao.locadora} · {MODALIDADE_LOCACAO_LABEL[locacao.modalidade]} · chegada {fmtData(locacao.data_chegada)} · entrega {fmtData(locacao.data_entrega_prevista)}
                </div>
                {estado === 'vencida' && <div className={styles.linhaDesc}>Vencida há {dias} dia{dias === 1 ? '' : 's'}.</div>}
                {estado === 'vence_amanha' && <div className={styles.linhaDesc}>Alerta: vence amanhã.</div>}
                {estado === 'vence_hoje' && <div className={styles.linhaDesc}>Alerta: vence hoje.</div>}
                {locacao.data_entregue && <div className={styles.linhaDesc}>Entregue em {fmtData(locacao.data_entregue)}.</div>}
                {locacao.observacao && <div className={styles.linhaDesc}>Obs.: {locacao.observacao}</div>}
              </div>
              <div className={styles.linhaMeta}>
                {!locacao.data_entregue && (
                  <>
                    <button className={styles.btnSecundario} onClick={() => setLocacaoEditando(locacao)}>
                      Editar
                    </button>
                    <button className={styles.btnSecundario} onClick={() => registrarEntrega(locacao)}>
                      Registrar entrega
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
```

por:

```tsx
          {linhas.map(({ locacao, estado, dias }) => (
            <div key={locacao.id} className={styles.linha}>
              <div className={styles.linhaInfo}>
                <div className={styles.linhaTopo}>
                  <span className={styles.linhaNome}>{locacao.nome_equipamento}</span>
                  <span className={`${styles.chip} ${styles[`chip_${estado}`]}`}>{ESTADO_LOCACAO_LABEL[estado]}</span>
                </div>
                <div className={styles.linhaDesc}>
                  {locacao.locadora} · {MODALIDADE_LOCACAO_LABEL[locacao.modalidade]} · chegada {fmtData(locacao.data_chegada)} · entrega {fmtData(locacao.data_entrega_prevista)}
                </div>
                {!locacao.data_entregue && (
                  <div className={styles.linhaDesc}>
                    {devolvidoPorLocacao.get(locacao.id) ?? 0} de {locacao.quantidade} devolvido
                  </div>
                )}
                {estado === 'vencida' && <div className={styles.linhaDesc}>Vencida há {dias} dia{dias === 1 ? '' : 's'}.</div>}
                {estado === 'vence_amanha' && <div className={styles.linhaDesc}>Alerta: vence amanhã.</div>}
                {estado === 'vence_hoje' && <div className={styles.linhaDesc}>Alerta: vence hoje.</div>}
                {locacao.data_entregue && <div className={styles.linhaDesc}>Entregue em {fmtData(locacao.data_entregue)}.</div>}
                {locacao.observacao && <div className={styles.linhaDesc}>Obs.: {locacao.observacao}</div>}
              </div>
              <div className={styles.linhaMeta}>
                {!locacao.data_entregue && (
                  <>
                    <button className={styles.btnSecundario} onClick={() => setLocacaoEditando(locacao)}>
                      Editar
                    </button>
                    <button className={styles.btnSecundario} onClick={() => setLocacaoDevolvendo(locacao)}>
                      Registrar entrega
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
```

- [ ] **Step 5: Criar o componente `PainelDevolucao`**

Logo depois do fim de `PainelLocacao` (depois do `}` que fecha a função, atualmente em
`src/pages/Almoxarifado.tsx:390`, antes do comentário `// ---------- Requisições: blocos de PDF
pré-numerados ----------`), adicionar:

```tsx
interface PainelDevolucaoProps {
  locacao: FerramentaLocacao
  saldoPendente: number
  onFechar: () => void
  onSucesso: () => void
}

function PainelDevolucao({ locacao, saldoPendente, onFechar, onSucesso }: PainelDevolucaoProps) {
  const [quantidade, setQuantidade] = useState(String(saldoPendente))
  const [salvando, setSalvando] = useState(false)
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)

  const qtd = Number(quantidade)
  const restante = saldoPendente - (Number.isFinite(qtd) ? qtd : 0)

  async function salvar() {
    if (!Number.isInteger(qtd) || qtd <= 0) {
      setMsg({ tipo: 'erro', texto: 'Informe uma quantidade inteira maior que zero.' })
      return
    }
    if (qtd > saldoPendente) {
      setMsg({ tipo: 'erro', texto: `Não pode devolver mais do que o saldo pendente (${saldoPendente}).` })
      return
    }
    setSalvando(true)
    setMsg(null)
    const { error } = await supabase.from('ferramenta_locacoes_devolucoes')
      .insert({ locacao_id: locacao.id, quantidade: qtd })
    setSalvando(false)
    if (error) {
      setMsg({ tipo: 'erro', texto: error.message })
      return
    }
    onSucesso()
  }

  return (
    <div className={styles.painelForm}>
      <div className={styles.painelHeader}>
        <h2>Registrar devolução — {locacao.nome_equipamento}</h2>
        <button className={styles.btnFechar} onClick={onFechar}>✕</button>
      </div>
      <div className={styles.linha2}>
        <label className={styles.campo}>
          Quantidade devolvida agora * (saldo pendente: {saldoPendente})
          <input type="number" min="1" max={saldoPendente} step="1" value={quantidade}
            onChange={e => setQuantidade(e.target.value)} />
        </label>
      </div>
      {qtd > 0 && qtd < saldoPendente && (
        <p className={styles.linhaDesc}>Vai continuar {restante} pendente.</p>
      )}
      {msg && <p className={msg.tipo === 'ok' ? styles.msgOk : styles.msgErro}>{msg.texto}</p>}
      <button className={styles.btnPrincipal} onClick={salvar} disabled={salvando}>
        {salvando ? 'Salvando…' : 'Registrar devolução'}
      </button>
    </div>
  )
}
```

- [ ] **Step 6: Build e teste manual**

```bash
npm run build
```

Testar no navegador: cadastrar uma locação nova com quantidade (ex.: 10), registrar uma devolução
parcial (ex.: 6) e confirmar que a linha mostra "6 de 10 devolvido" e continua na lista; registrar
a devolução dos 4 restantes e confirmar que a locação passa a mostrar "Entregue em {data}" e some
dos filtros de estado aberto. Tentar editar a quantidade depois de uma devolução parcial e
confirmar que o campo aparece desabilitado com o aviso.

- [ ] **Step 7: Commit**

```bash
git add src/pages/Almoxarifado.tsx
git commit -m "feat: adiciona devolucao parcial de equipamento alugado com saldo ao vivo"
```
