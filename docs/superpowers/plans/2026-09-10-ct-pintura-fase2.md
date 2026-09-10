# Controle Tecnológico — Fase 2: pintura direta no tablet/celular Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Além de anexar foto/PDF já marcado (Fase 1), o Controle Tecnológico passa a permitir
escolher uma planta do catálogo e pintar direto no app (tablet/celular) qual área cada caminhão de
concreto cobriu — pincel na cor do caminhão, borracha, zoom por pinça — e o PDF final passa a
compor a planta + todas as camadas na hora de gerar, no lugar do anexo.

**Architecture:** Nenhuma coluna nova (o schema já reserva `ct_plantas`, `ct_concretagens.planta_id`/
`.pavimento_identificacao`, `ct_caminhoes.pintura_url` desde a Fase 1) — só uma migração pequena de
trigger pra travar a pintura no banco quando a concretagem finaliza. Um componente novo de canvas
(`FerramentaPintura`) reaproveita a técnica de coordenadas já usada em `PlantaClicavel.tsx`
(`getBoundingClientRect()`), estendida pra desenho livre e gestos de 2 ponteiros (pinça). O PDF
reaproveita 100% do código de página/cabeçalho/rodapé da Fase 1 sem tocar nele — só muda de onde a
imagem da página 1 vem.

**Tech Stack:** Supabase (Postgres + RLS + Storage) + React 19 + TypeScript + Vite + jsPDF +
pdfjs-dist (já dependências). Sem framework de testes — verificação por SQL direto e teste manual
no navegador (esta sessão não tem navegador disponível — cada task marca isso explicitamente).

## Global Constraints

- Spec completa: `docs/superpowers/specs/2026-09-10-ct-pintura-fase2-design.md` — ler antes de
  implementar qualquer task. Refina `docs/superpowers/specs/2026-09-09-controle-tecnologico-concreto-design.md`.
- **Nenhuma coluna nova.** Todo o schema já existe (verificado por consulta direta ao banco em
  10/09/2026). Só a migração de trigger da Task 1.
- Planta é sempre um PDF na entrada (não foto) — `ct_plantas.pdf_path`/`imagem_path` são as duas
  metades obrigatórias de todo cadastro; usa `converterPdfParaImagem` diretamente (não
  `prepararImagemAnexo`, que decide entre PDF/imagem — aqui só existe o caminho PDF).
- Convenção de path no bucket `controle-tecnologico`: plano, `{obra_id}/{uuid}-{nome}`, igual ao
  que a Fase 1 já usa — não a `{obra_id}/{concretagem_id}/...` que a spec original de 09/09 previa
  e nunca foi implementada assim.
- **Trava de pintura é no banco, não só na tela** (Task 1) — mesmo padrão de `ct_restringir_laudo`.
- Pincel: espessura ajustável (fino/médio/grosso), sem desfazer (só borracha) — confirmado com o
  Rodrigo, não implementar nenhum dos dois de outro jeito.
- Zoom: pinça de 2 dedos no celular, botões +/− no desktop — confirmado com o Rodrigo.
- Camadas de caminhões já pintados aparecem travadas (só leitura) atrás da camada do caminhão
  atual — confirmado com o Rodrigo, não pular esse requisito.
- Salvar é uma ação explícita (não salva a cada traço) — confirmado com o Rodrigo.
- Cliente não acessa nada deste submódulo — mesma regra do resto do Controle Tecnológico.
- Toda função `SECURITY DEFINER` precisa de `SET search_path = public` desde a criação.
- Sem navegador disponível nesta sessão — todo passo de "teste manual no navegador" fica para o
  Rodrigo confirmar depois; cada task diz isso explicitamente e não finge ter testado.

---

### Task 1: Migração — trava de pintura no banco

**Files:**
- Create: `supabase/migrations/20260910_ct_restringir_pintura.sql`

**Interfaces:**
- Produces: trigger `trg_ct_restringir_pintura` em `ct_caminhoes` — bloqueia `UPDATE` de
  `pintura_url` quando a concretagem já está `finalizada`. Nenhuma outra task depende do nome
  desta função/trigger diretamente (é só uma trava de banco).

- [ ] **Step 1: Escrever a migração**

Criar `supabase/migrations/20260910_ct_restringir_pintura.sql`:

```sql
-- Trava a alteração de pintura_url quando a concretagem já está finalizada --
-- a policy ct_caminhoes_update de hoje não distingue esse caso (ela deixa os
-- campos de laudo editáveis de propósito mesmo com a concretagem finalizada,
-- então não dá pra travar via policy geral sem quebrar isso). Mesmo padrão de
-- ct_restringir_laudo (supabase/migrations/20260909_ct_triggers.sql).
-- Ver docs/superpowers/specs/2026-09-10-ct-pintura-fase2-design.md §8.

CREATE OR REPLACE FUNCTION ct_restringir_pintura() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_status status_concretagem;
BEGIN
  IF NEW.pintura_url IS DISTINCT FROM OLD.pintura_url THEN
    SELECT status INTO v_status FROM ct_concretagens WHERE id = NEW.concretagem_id;
    IF v_status = 'finalizada' THEN
      RAISE EXCEPTION 'Não é possível alterar a pintura de uma concretagem já finalizada.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_ct_restringir_pintura
  BEFORE UPDATE ON ct_caminhoes
  FOR EACH ROW EXECUTE FUNCTION ct_restringir_pintura();
```

- [ ] **Step 2: Aplicar a migração**

Aplicar via `mcp__claude_ai_Supabase__apply_migration` (projeto `yxshldsfmbmbzdkcymca`, nome
`ct_restringir_pintura`).

- [ ] **Step 3: Verificar com teste real (sem deixar resíduo)**

```sql
SELECT prosecdef, proconfig FROM pg_proc WHERE proname = 'ct_restringir_pintura';
-- Esperado: prosecdef = true, proconfig contém 'search_path=public'
```

Teste funcional (usa a obra piloto e a concretagem real `CTC-001` já existente, id
`ee1cc825-5cfd-45e9-8f4d-ecdaa06953c6`, que já está `finalizada` — não precisa criar dado novo):

```sql
-- Pega qualquer caminhão real dessa concretagem
SELECT id FROM ct_caminhoes WHERE concretagem_id = 'ee1cc825-5cfd-45e9-8f4d-ecdaa06953c6' LIMIT 1;
-- Anota o id retornado como <caminhao_id>

UPDATE ct_caminhoes SET pintura_url = 'teste/nao-deveria-salvar.png' WHERE id = '<caminhao_id>';
-- Esperado: erro "Não é possível alterar a pintura de uma concretagem já finalizada."

-- Confirma que nada mudou:
SELECT pintura_url FROM ct_caminhoes WHERE id = '<caminhao_id>';
-- Esperado: null (não foi alterado, a transação do UPDATE falhou)

-- Confirma que atualizar OUTRO campo (não pintura_url) continua funcionando
-- mesmo finalizada — não pode ter travado tudo por engano:
UPDATE ct_caminhoes SET laudo_url = laudo_url WHERE id = '<caminhao_id>';
-- Esperado: sucesso (0 ou 1 linha afetada, sem erro)
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260910_ct_restringir_pintura.sql
git commit -m "feat: trava pintura de caminhao finalizado no banco (Controle Tecnologico)"
```

---

### Task 2: Tipo `CtPlanta` + tela de Cadastro de Plantas

**Files:**
- Modify: `src/lib/supabase.ts` (tipo `CtPlanta`)
- Create: `src/pages/ControleTecnologicoPlantas.tsx`
- Create: `src/pages/ControleTecnologicoPlantas.module.css`
- Modify: `src/App.tsx` (rota)
- Modify: `src/pages/ControleTecnologico.tsx` (botão "Plantas")
- Modify: `src/pages/ControleTecnologico.module.css` (CSS do botão novo)

**Interfaces:**
- Consumes: `converterPdfParaImagem` de `src/lib/pdfParaImagem.ts` (já existe, aceita `Blob`).
- Produces: tipo `CtPlanta` em `src/lib/supabase.ts`, rota `/controle-tecnologico/plantas`. Usado
  pelas Tasks 3, 5 e 6 (todas importam `type CtPlanta`).

- [ ] **Step 1: Adicionar o tipo `CtPlanta` em `src/lib/supabase.ts`**

Em `src/lib/supabase.ts:265-266`, hoje:

```ts
export type StatusConcretagem = 'aberta' | 'finalizada'
export type StatusLaudoConcreto = 'pendente' | 'aprovado' | 'reprovado'
```

Trocar por (adiciona a interface `CtPlanta` logo depois):

```ts
export type StatusConcretagem = 'aberta' | 'finalizada'
export type StatusLaudoConcreto = 'pendente' | 'aprovado' | 'reprovado'

export interface CtPlanta {
  id: string
  obra_id: string
  nome: string
  reutilizavel: boolean
  pdf_path: string
  imagem_path: string
  ativo: boolean
  criado_por: string
  criado_em: string
}
```

- [ ] **Step 2: Criar `src/pages/ControleTecnologicoPlantas.tsx`**

Segue exatamente o padrão de `src/pages/Empreiteiros.tsx` (lista + formulário inline de criação,
sem tela de detalhe — só inativar):

```tsx
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { useObra } from '../contexts/ObraContext'
import { supabase, type CtPlanta } from '../lib/supabase'
import styles from './ControleTecnologicoPlantas.module.css'

function nomeArquivoStorage(nome: string): string {
  const partes = nome.split('.')
  const extensao = partes.length > 1 ? `.${partes.pop()}` : ''
  const base = (partes.join('.') || 'arquivo')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 80) || 'arquivo'
  const extLimpa = extensao
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9.]/g, '')
    .slice(0, 16)
  return `${base}${extLimpa}`.toLowerCase()
}

export default function ControleTecnologicoPlantas() {
  const { perfil, temModulo } = useAuth()
  const { obraAtiva } = useObra()
  const navigate = useNavigate()
  const podeEditar = perfil?.papel === 'admin' || temModulo('controle_tecnologico')

  const [plantas, setPlantas] = useState<CtPlanta[]>([])
  const [carregando, setCarregando] = useState(true)
  const [nome, setNome] = useState('')
  const [reutilizavel, setReutilizavel] = useState(false)
  const [arquivo, setArquivo] = useState<File | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)

  useEffect(() => { carregar() }, [obraAtiva])

  function carregar() {
    if (!obraAtiva) return
    setCarregando(true)
    supabase.from('ct_plantas').select('*').eq('obra_id', obraAtiva.id).eq('ativo', true).order('nome')
      .then(({ data }) => { setPlantas(data ?? []); setCarregando(false) })
  }

  async function criar() {
    if (!obraAtiva) return
    if (!nome.trim()) { setMsg({ tipo: 'erro', texto: 'Informe o nome da planta.' }); return }
    if (!arquivo) { setMsg({ tipo: 'erro', texto: 'Selecione o PDF da planta.' }); return }
    setSalvando(true)
    setMsg(null)
    const { converterPdfParaImagem } = await import('../lib/pdfParaImagem')
    let imagemBlob: Blob
    try {
      imagemBlob = await converterPdfParaImagem(arquivo)
    } catch (e) {
      setSalvando(false)
      setMsg({ tipo: 'erro', texto: e instanceof Error ? e.message : 'Falha ao converter o PDF.' })
      return
    }
    const base = `${obraAtiva.id}/${crypto.randomUUID()}-${nomeArquivoStorage(arquivo.name)}`
    const pdfPath = `${base}.pdf`
    const imagemPath = `${base}.png`
    const [upPdf, upImg] = await Promise.all([
      supabase.storage.from('controle-tecnologico').upload(pdfPath, arquivo),
      supabase.storage.from('controle-tecnologico').upload(imagemPath, imagemBlob),
    ])
    if (upPdf.error || upImg.error) {
      setSalvando(false)
      setMsg({ tipo: 'erro', texto: `Falha no envio: ${upPdf.error?.message ?? upImg.error?.message}` })
      return
    }
    const { error } = await supabase.from('ct_plantas').insert({
      obra_id: obraAtiva.id, nome: nome.trim(), reutilizavel, pdf_path: pdfPath, imagem_path: imagemPath,
    })
    setSalvando(false)
    if (error) {
      setMsg({ tipo: 'erro', texto: `Erro ao cadastrar: ${error.message}` })
      return
    }
    setNome(''); setReutilizavel(false); setArquivo(null)
    setMsg({ tipo: 'ok', texto: 'Planta cadastrada.' })
    carregar()
  }

  async function inativar(planta: CtPlanta) {
    const { error } = await supabase.from('ct_plantas').update({ ativo: false }).eq('id', planta.id)
    if (error) { setMsg({ tipo: 'erro', texto: `Erro ao inativar: ${error.message}` }); return }
    carregar()
  }

  if (perfil?.papel === 'cliente') {
    return <div className={styles.page}><p className={styles.vazio}>Módulo de uso interno da equipe.</p></div>
  }

  return (
    <div className={styles.page}>
      <button className={styles.voltar} onClick={() => navigate('/controle-tecnologico')}>← Controle Tecnológico</button>
      <h1>Plantas</h1>
      <p className={styles.sub}>Catálogo de plantas pra pintar direto no app.</p>

      {podeEditar && (
        <div className={styles.bloco}>
          <div className={styles.campos}>
            <label className={styles.campo}>
              Nome *
              <input value={nome} onChange={e => setNome(e.target.value)} placeholder="Ex.: Laje Térreo" />
            </label>
            <label className={styles.campo}>
              PDF da planta *
              <input type="file" accept="application/pdf" onChange={e => setArquivo(e.target.files?.[0] ?? null)} />
            </label>
            <label className={styles.checkReutilizavel}>
              <input type="checkbox" checked={reutilizavel} onChange={e => setReutilizavel(e.target.checked)} />
              Reutilizável (pede identificação do pavimento a cada uso)
            </label>
          </div>
          {msg && <p className={msg.tipo === 'ok' ? styles.msgOk : styles.msgErro}>{msg.texto}</p>}
          <button className={styles.btnPrincipal} onClick={criar} disabled={salvando} style={{ marginTop: 12 }}>
            {salvando ? 'Enviando…' : '+ Cadastrar planta'}
          </button>
        </div>
      )}

      {carregando && <p className={styles.vazio}>Carregando…</p>}
      {!carregando && plantas.length === 0 && <p className={styles.vazio}>Nenhuma planta cadastrada.</p>}
      {plantas.map(p => (
        <div key={p.id} className={styles.card}>
          <div className={styles.cardTopo}>
            <div className={styles.cardNome}>{p.nome}</div>
            {podeEditar && <button className={styles.btnInativar} onClick={() => inativar(p)}>Inativar</button>}
          </div>
          {p.reutilizavel && <div className={styles.cardMeta}>♻️ Reutilizável</div>}
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 3: Criar `src/pages/ControleTecnologicoPlantas.module.css`**

Mesma base de `src/pages/Empreiteiros.module.css`, com as classes extras `.checkReutilizavel`,
`.cardTopo`, `.btnInativar`:

```css
.page { max-width: 720px; margin: 0 auto; padding-bottom: 40px; }
.page h1 { font-size: 20px; margin-bottom: 4px; }
.sub { color: var(--cinza-600); font-size: 13px; margin-bottom: 16px; }
.voltar { background: none; border: none; color: var(--navy); font-size: 13px; font-weight: 600; cursor: pointer; padding: 0 0 10px; }

.bloco { background: var(--branco); border: 1.5px solid var(--cinza-200); border-radius: var(--radius-md); padding: 16px; margin-bottom: 16px; box-shadow: var(--sombra-sm); }
.campos { display: flex; flex-direction: column; gap: 12px; }
.campo { display: flex; flex-direction: column; gap: 4px; font-size: 12px; font-weight: 600; color: var(--cinza-600); }
.campo input { padding: 10px 12px; border: 1.5px solid var(--cinza-200); border-radius: var(--radius-sm); font-size: 14px; font-family: inherit; }
.campo input:focus { border-color: var(--navy); outline: none; }

.checkReutilizavel { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; color: var(--cinza-800); }

.btnPrincipal { background: var(--terracota); color: var(--branco); border: none; border-radius: var(--radius-sm); padding: 12px 18px; font-size: 14px; font-weight: 700; cursor: pointer; }
.btnPrincipal:disabled { opacity: 0.6; cursor: default; }

.card { background: var(--branco); border: 1.5px solid var(--cinza-200); border-radius: var(--radius-md); padding: 12px 16px; margin-bottom: 8px; }
.cardTopo { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.cardNome { font-weight: 700; color: var(--navy); font-size: 14px; }
.cardMeta { display: flex; gap: 14px; flex-wrap: wrap; font-size: 12px; color: var(--cinza-600); margin-top: 4px; }

.btnInativar { background: none; border: 1.5px solid var(--cinza-200); color: var(--cinza-700); border-radius: var(--radius-sm); padding: 5px 10px; font-size: 12px; font-weight: 600; cursor: pointer; }

.vazio { color: var(--cinza-600); font-size: 14px; padding: 12px 0; }
.msgOk { color: #1e6b2e; font-weight: 600; font-size: 13px; padding: 6px 0; }
.msgErro { color: #a33030; font-weight: 600; font-size: 13px; padding: 6px 0; }
```

- [ ] **Step 4: Rota em `src/App.tsx`**

Em `src/App.tsx:32-33`, hoje:

```ts
const ControleTecnologico = lazy(() => import('./pages/ControleTecnologico'))
const ControleTecnologicoForm = lazy(() => import('./pages/ControleTecnologicoForm'))
```

Trocar por:

```ts
const ControleTecnologico = lazy(() => import('./pages/ControleTecnologico'))
const ControleTecnologicoForm = lazy(() => import('./pages/ControleTecnologicoForm'))
const ControleTecnologicoPlantas = lazy(() => import('./pages/ControleTecnologicoPlantas'))
```

Em `src/App.tsx:90-91`, hoje:

```tsx
        <Route path="controle-tecnologico" element={<ControleTecnologico />} />
        <Route path="controle-tecnologico/:id" element={<ControleTecnologicoForm />} />
```

Trocar por (a rota de plantas vem **antes** da rota `:id`, senão `/controle-tecnologico/plantas`
seria capturada como se `"plantas"` fosse um `id` de concretagem):

```tsx
        <Route path="controle-tecnologico" element={<ControleTecnologico />} />
        <Route path="controle-tecnologico/plantas" element={<ControleTecnologicoPlantas />} />
        <Route path="controle-tecnologico/:id" element={<ControleTecnologicoForm />} />
```

- [ ] **Step 5: Botão "Plantas" em `src/pages/ControleTecnologico.tsx`**

Em `src/pages/ControleTecnologico.tsx:58-61`, hoje:

```tsx
        {podeEditar && (
          <button className={styles.btnNova} onClick={() => navigate('/controle-tecnologico/nova')}>+ Nova concretagem</button>
        )}
      </div>
```

Trocar por:

```tsx
        {podeEditar && (
          <div className={styles.acoesHeader}>
            <button className={styles.btnSecundario} onClick={() => navigate('/controle-tecnologico/plantas')}>🗂️ Plantas</button>
            <button className={styles.btnNova} onClick={() => navigate('/controle-tecnologico/nova')}>+ Nova concretagem</button>
          </div>
        )}
      </div>
```

- [ ] **Step 6: CSS novo em `src/pages/ControleTecnologico.module.css`**

Depois da regra `.btnNova { ... }` (linha 15), adicionar:

```css
.acoesHeader { display: flex; gap: 8px; flex-wrap: wrap; }

.btnSecundario {
  background: var(--branco);
  color: var(--navy);
  border: 1.5px solid var(--navy);
  border-radius: var(--radius-sm);
  padding: 10px 14px;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
}
```

- [ ] **Step 7: Build**

```bash
npm run build
```

Esperado: 0 erros de TypeScript.

- [ ] **Step 8: Commit**

```bash
git add src/lib/supabase.ts src/pages/ControleTecnologicoPlantas.tsx src/pages/ControleTecnologicoPlantas.module.css src/App.tsx src/pages/ControleTecnologico.tsx src/pages/ControleTecnologico.module.css
git commit -m "feat: cadastro de Plantas no Controle Tecnologico"
```

---

### Task 3: Nova concretagem — escolha planta vs. anexo

**Files:**
- Modify: `src/pages/ControleTecnologicoForm.tsx`

**Interfaces:**
- Consumes: tipo `CtPlanta` (Task 2).
- Produces: nada consumido por outras tasks diretamente (a Task 5 lê `concretagem.planta_id` do
  banco, não deste código).

- [ ] **Step 1: Importar `CtPlanta` e adicionar estados novos**

Em `src/pages/ControleTecnologicoForm.tsx:5`, hoje:

```ts
import { supabase, type CtCaminhao, type CtConcretagem, type Unidade } from '../lib/supabase'
```

Trocar por:

```ts
import { supabase, type CtCaminhao, type CtConcretagem, type CtPlanta, type Unidade } from '../lib/supabase'
```

Em `src/pages/ControleTecnologicoForm.tsx:45-50`, hoje:

```ts
  const [unidades, setUnidades] = useState<Unidade[]>([])
  const [unidadeId, setUnidadeId] = useState('')
  const [data, setData] = useState(() => new Date().toISOString().slice(0, 10))
  const [arquivo, setArquivo] = useState<File | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)
```

Trocar por:

```ts
  const [unidades, setUnidades] = useState<Unidade[]>([])
  const [unidadeId, setUnidadeId] = useState('')
  const [data, setData] = useState(() => new Date().toISOString().slice(0, 10))
  const [tipoMapa, setTipoMapa] = useState<'anexo' | 'planta'>('anexo')
  const [arquivo, setArquivo] = useState<File | null>(null)
  const [plantasCatalogo, setPlantasCatalogo] = useState<CtPlanta[]>([])
  const [plantaId, setPlantaId] = useState('')
  const [pavimento, setPavimento] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)
```

- [ ] **Step 2: Carregar o catálogo de plantas quando `nova`**

Em `src/pages/ControleTecnologicoForm.tsx:80-84`, hoje:

```ts
  useEffect(() => {
    if (!obraAtiva) return
    supabase.from('unidades').select('*').eq('obra_id', obraAtiva.id).order('ordem')
      .then(({ data }) => setUnidades(data ?? []))
  }, [obraAtiva])
```

Trocar por (adiciona um segundo `useEffect` logo depois):

```ts
  useEffect(() => {
    if (!obraAtiva) return
    supabase.from('unidades').select('*').eq('obra_id', obraAtiva.id).order('ordem')
      .then(({ data }) => setUnidades(data ?? []))
  }, [obraAtiva])

  useEffect(() => {
    if (!obraAtiva || !nova) return
    supabase.from('ct_plantas').select('*').eq('obra_id', obraAtiva.id).eq('ativo', true).order('nome')
      .then(({ data }) => setPlantasCatalogo(data ?? []))
  }, [obraAtiva, nova])
```

- [ ] **Step 3: Reescrever `criar()` pra ramificar entre anexo e planta**

Em `src/pages/ControleTecnologicoForm.tsx:229-254`, hoje:

```ts
  async function criar() {
    if (!obraAtiva) return
    if (!unidadeId) { setMsg({ tipo: 'erro', texto: 'Selecione a Unidade.' }); return }
    if (!arquivo) { setMsg({ tipo: 'erro', texto: 'Anexe a foto ou o PDF do mapa de concretagem.' }); return }
    setSalvando(true)
    setMsg(null)
    const path = `${obraAtiva.id}/${crypto.randomUUID()}-${nomeArquivoStorage(arquivo.name)}`
    const { error: eUp } = await supabase.storage.from('controle-tecnologico').upload(path, arquivo)
    if (eUp) {
      setSalvando(false)
      setMsg({ tipo: 'erro', texto: `Falha no envio do arquivo: ${eUp.message}` })
      return
    }
    const { data: nova_, error } = await supabase.from('ct_concretagens').insert({
      obra_id: obraAtiva.id,
      unidade_id: unidadeId,
      anexo_url: path,
      data,
    }).select().single()
    setSalvando(false)
    if (error || !nova_) {
      setMsg({ tipo: 'erro', texto: `Erro ao criar concretagem: ${error?.message}` })
      return
    }
    navigate(`/controle-tecnologico/${nova_.id}`, { replace: true })
  }
```

Trocar por:

```ts
  async function criar() {
    if (!obraAtiva) return
    if (!unidadeId) { setMsg({ tipo: 'erro', texto: 'Selecione a Unidade.' }); return }

    const plantaSelecionada = plantasCatalogo.find(p => p.id === plantaId)

    if (tipoMapa === 'anexo') {
      if (!arquivo) { setMsg({ tipo: 'erro', texto: 'Anexe a foto ou o PDF do mapa de concretagem.' }); return }
      setSalvando(true)
      setMsg(null)
      const path = `${obraAtiva.id}/${crypto.randomUUID()}-${nomeArquivoStorage(arquivo.name)}`
      const { error: eUp } = await supabase.storage.from('controle-tecnologico').upload(path, arquivo)
      if (eUp) {
        setSalvando(false)
        setMsg({ tipo: 'erro', texto: `Falha no envio do arquivo: ${eUp.message}` })
        return
      }
      const { data: nova_, error } = await supabase.from('ct_concretagens').insert({
        obra_id: obraAtiva.id, unidade_id: unidadeId, anexo_url: path, data,
      }).select().single()
      setSalvando(false)
      if (error || !nova_) {
        setMsg({ tipo: 'erro', texto: `Erro ao criar concretagem: ${error?.message}` })
        return
      }
      navigate(`/controle-tecnologico/${nova_.id}`, { replace: true })
      return
    }

    if (!plantaId) { setMsg({ tipo: 'erro', texto: 'Selecione a planta do catálogo.' }); return }
    if (plantaSelecionada?.reutilizavel && !pavimento.trim()) {
      setMsg({ tipo: 'erro', texto: 'Informe o pavimento.' })
      return
    }
    setSalvando(true)
    setMsg(null)
    const { data: nova_, error } = await supabase.from('ct_concretagens').insert({
      obra_id: obraAtiva.id,
      unidade_id: unidadeId,
      planta_id: plantaId,
      pavimento_identificacao: plantaSelecionada?.reutilizavel ? pavimento.trim() : null,
      data,
    }).select().single()
    setSalvando(false)
    if (error || !nova_) {
      setMsg({ tipo: 'erro', texto: `Erro ao criar concretagem: ${error?.message}` })
      return
    }
    navigate(`/controle-tecnologico/${nova_.id}`, { replace: true })
  }
```

- [ ] **Step 4: JSX da tela "nova" — escolha planta vs. anexo**

Em `src/pages/ControleTecnologicoForm.tsx:280-283`, hoje:

```tsx
          <label className={styles.campo}>
            Mapa de concretagem — foto ou PDF já marcado *
            <input type="file" accept="application/pdf,image/*" onChange={e => setArquivo(e.target.files?.[0] ?? null)} />
          </label>
```

Trocar por:

```tsx
          <div className={styles.escolhaMapa}>
            <label className={styles.opcaoMapa}>
              <input type="radio" name="tipoMapa" checked={tipoMapa === 'anexo'} onChange={() => setTipoMapa('anexo')} />
              Anexar foto/PDF já marcado
            </label>
            <label className={styles.opcaoMapa}>
              <input type="radio" name="tipoMapa" checked={tipoMapa === 'planta'} onChange={() => setTipoMapa('planta')} />
              Usar planta do catálogo (pintar no app)
            </label>
          </div>
          {tipoMapa === 'anexo' ? (
            <label className={styles.campo}>
              Mapa de concretagem — foto ou PDF já marcado *
              <input type="file" accept="application/pdf,image/*" onChange={e => setArquivo(e.target.files?.[0] ?? null)} />
            </label>
          ) : (
            <>
              <label className={styles.campo}>
                Planta *
                <select value={plantaId} onChange={e => setPlantaId(e.target.value)}>
                  <option value="">Selecione…</option>
                  {plantasCatalogo.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
                </select>
              </label>
              {plantasCatalogo.find(p => p.id === plantaId)?.reutilizavel && (
                <label className={styles.campo}>
                  Pavimento *
                  <input value={pavimento} onChange={e => setPavimento(e.target.value)} placeholder="Ex.: Térreo" />
                </label>
              )}
              {plantasCatalogo.length === 0 && (
                <p className={styles.vazio}>Nenhuma planta cadastrada — <a href="/controle-tecnologico/plantas">cadastre uma primeiro</a>.</p>
              )}
            </>
          )}
```

- [ ] **Step 5: CSS novo em `src/pages/ControleTecnologicoForm.module.css`**

Depois da regra `.parCampos > label { flex: 1; }` (linha 55), adicionar:

```css
.escolhaMapa { display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 12px; }
.opcaoMapa { display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 600; color: var(--cinza-800); cursor: pointer; }
```

- [ ] **Step 6: Build**

```bash
npm run build
```

Esperado: 0 erros.

- [ ] **Step 7: Commit**

```bash
git add src/pages/ControleTecnologicoForm.tsx src/pages/ControleTecnologicoForm.module.css
git commit -m "feat: escolha entre planta do catalogo e anexo ao criar concretagem"
```

---

### Task 4: `FerramentaPintura` — componente de pintura com zoom

**Files:**
- Create: `src/components/FerramentaPintura.tsx`
- Create: `src/components/FerramentaPintura.module.css`

**Interfaces:**
- Consumes: nada de outras tasks — componente autocontido, só recebe props.
- Produces: `export default function FerramentaPintura(props: PropsFerramentaPintura): JSX.Element`,
  `export interface CamadaTravada { id: string; url: string }` — ambos de
  `src/components/FerramentaPintura.tsx`, consumidos pela Task 5.

- [ ] **Step 1: Criar `src/components/FerramentaPintura.tsx`**

```tsx
import { useEffect, useRef, useState } from 'react'
import styles from './FerramentaPintura.module.css'

export type Espessura = 'fino' | 'medio' | 'grosso'
export type FerramentaAtiva = 'pincel' | 'borracha'

export interface CamadaTravada {
  id: string
  url: string
}

interface Props {
  imagemPlantaUrl: string
  camadasTravadas: CamadaTravada[]
  corAtual: string
  pinturaExistenteUrl: string | null
  onSalvar: (blob: Blob) => void
  onCancelar: () => void
  salvando: boolean
}

interface EstadoPinch {
  distancia: number
  zoom: number
  contentX: number
  contentY: number
}

const ZOOM_MIN = 1
const ZOOM_MAX = 6

function larguraPincel(espessura: Espessura, canvasWidth: number): number {
  const fracao = espessura === 'fino' ? 0.003 : espessura === 'medio' ? 0.008 : 0.015
  return canvasWidth * fracao
}

export default function FerramentaPintura({
  imagemPlantaUrl, camadasTravadas, corAtual, pinturaExistenteUrl, onSalvar, onCancelar, salvando,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const [dimensoes, setDimensoes] = useState<{ largura: number; altura: number } | null>(null)
  const [pronto, setPronto] = useState(false)
  const [ferramenta, setFerramenta] = useState<FerramentaAtiva>('pincel')
  const [espessura, setEspessura] = useState<Espessura>('medio')
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })

  const pointersAtivos = useRef(new Map<number, { x: number; y: number }>())
  const desenhando = useRef(false)
  const ultimoPonto = useRef<{ x: number; y: number } | null>(null)
  const pinchInicioRef = useRef<EstadoPinch | null>(null)
  const zoomRef = useRef(zoom)
  const panRef = useRef(pan)
  zoomRef.current = zoom
  panRef.current = pan

  // Mede a imagem da planta separado do <img> visível — evita depender de
  // onLoad num elemento que só existe depois que as dimensões já são conhecidas.
  useEffect(() => {
    let cancelado = false
    const img = new Image()
    img.onload = () => { if (!cancelado) setDimensoes({ largura: img.naturalWidth, altura: img.naturalHeight }) }
    img.src = imagemPlantaUrl
    return () => { cancelado = true }
  }, [imagemPlantaUrl])

  // Uma vez que o canvas existe com o tamanho certo, pré-carrega a pintura
  // existente (modo "corrigir") antes de liberar novos traços.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !dimensoes) return
    canvas.width = dimensoes.largura
    canvas.height = dimensoes.altura
    if (!pinturaExistenteUrl) { setPronto(true); return }
    let cancelado = false
    const img = new Image()
    img.onload = () => {
      if (cancelado) return
      const ctx = canvas.getContext('2d')
      ctx?.drawImage(img, 0, 0, canvas.width, canvas.height)
      setPronto(true)
    }
    img.src = pinturaExistenteUrl
    return () => { cancelado = true }
  }, [dimensoes, pinturaExistenteUrl])

  function paraCoordenadaCanvas(clientX: number, clientY: number): { x: number; y: number } {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    return {
      x: ((clientX - rect.left) / rect.width) * canvas.width,
      y: ((clientY - rect.top) / rect.height) * canvas.height,
    }
  }

  function desenharLinha(de: { x: number; y: number }, para: { x: number; y: number }) {
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')!
    ctx.globalCompositeOperation = ferramenta === 'borracha' ? 'destination-out' : 'source-over'
    ctx.strokeStyle = corAtual
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.lineWidth = larguraPincel(espessura, canvas.width)
    ctx.beginPath()
    ctx.moveTo(de.x, de.y)
    ctx.lineTo(para.x, para.y)
    ctx.stroke()
  }

  function aoPressionar(e: React.PointerEvent) {
    canvasRef.current?.setPointerCapture(e.pointerId)
    pointersAtivos.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

    if (pointersAtivos.current.size === 2) {
      desenhando.current = false
      ultimoPonto.current = null
      const pontos = [...pointersAtivos.current.values()]
      const rect = containerRef.current!.getBoundingClientRect()
      const midX = (pontos[0].x + pontos[1].x) / 2 - rect.left
      const midY = (pontos[0].y + pontos[1].y) / 2 - rect.top
      pinchInicioRef.current = {
        distancia: Math.hypot(pontos[1].x - pontos[0].x, pontos[1].y - pontos[0].y),
        zoom: zoomRef.current,
        contentX: (midX - panRef.current.x) / zoomRef.current,
        contentY: (midY - panRef.current.y) / zoomRef.current,
      }
    } else if (pointersAtivos.current.size === 1) {
      desenhando.current = true
      const p = paraCoordenadaCanvas(e.clientX, e.clientY)
      ultimoPonto.current = p
      desenharLinha(p, p) // deixa um ponto mesmo sem arrastar
    }
  }

  function aoMover(e: React.PointerEvent) {
    if (!pointersAtivos.current.has(e.pointerId)) return
    pointersAtivos.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

    if (pointersAtivos.current.size === 2 && pinchInicioRef.current) {
      const pontos = [...pointersAtivos.current.values()]
      const distAtual = Math.hypot(pontos[1].x - pontos[0].x, pontos[1].y - pontos[0].y)
      const rect = containerRef.current!.getBoundingClientRect()
      const midX = (pontos[0].x + pontos[1].x) / 2 - rect.left
      const midY = (pontos[0].y + pontos[1].y) / 2 - rect.top
      const { distancia, zoom: zoomInicial, contentX, contentY } = pinchInicioRef.current
      const novoZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoomInicial * (distAtual / distancia)))
      setZoom(novoZoom)
      setPan({ x: midX - contentX * novoZoom, y: midY - contentY * novoZoom })
      return
    }
    if (pointersAtivos.current.size === 1 && desenhando.current && ultimoPonto.current) {
      const p = paraCoordenadaCanvas(e.clientX, e.clientY)
      desenharLinha(ultimoPonto.current, p)
      ultimoPonto.current = p
    }
  }

  function aoSoltar(e: React.PointerEvent) {
    pointersAtivos.current.delete(e.pointerId)
    desenhando.current = false
    ultimoPonto.current = null
    pinchInicioRef.current = null
  }

  function aplicarZoomBotao(delta: number) {
    const novoZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom + delta))
    const rect = containerRef.current!.getBoundingClientRect()
    const midX = rect.width / 2
    const midY = rect.height / 2
    const contentX = (midX - pan.x) / zoom
    const contentY = (midY - pan.y) / zoom
    setZoom(novoZoom)
    setPan({ x: midX - contentX * novoZoom, y: midY - contentY * novoZoom })
  }

  function salvar() {
    canvasRef.current!.toBlob(blob => { if (blob) onSalvar(blob) }, 'image/png')
  }

  return (
    <div className={styles.overlay}>
      <div className={styles.barraFerramentas}>
        <button className={ferramenta === 'pincel' ? styles.btnAtivo : styles.btn} onClick={() => setFerramenta('pincel')}>🖌️ Pincel</button>
        <button className={ferramenta === 'borracha' ? styles.btnAtivo : styles.btn} onClick={() => setFerramenta('borracha')}>🧼 Borracha</button>
        <select className={styles.selectEspessura} value={espessura} onChange={e => setEspessura(e.target.value as Espessura)}>
          <option value="fino">Fino</option>
          <option value="medio">Médio</option>
          <option value="grosso">Grosso</option>
        </select>
        <button className={styles.btn} onClick={() => aplicarZoomBotao(-0.5)} aria-label="Diminuir zoom">−</button>
        <button className={styles.btn} onClick={() => aplicarZoomBotao(0.5)} aria-label="Aumentar zoom">+</button>
      </div>

      <div
        ref={containerRef}
        className={styles.viewport}
        onPointerDown={aoPressionar}
        onPointerMove={aoMover}
        onPointerUp={aoSoltar}
        onPointerCancel={aoSoltar}
      >
        {!dimensoes && <p className={styles.carregando}>Carregando planta…</p>}
        {dimensoes && (
          <div
            className={styles.conteudo}
            style={{
              width: dimensoes.largura, height: dimensoes.altura,
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            }}
          >
            <img src={imagemPlantaUrl} alt="Planta" className={styles.imagemPlanta} draggable={false} />
            {camadasTravadas.map(c => (
              <img key={c.id} src={c.url} alt="" className={styles.camadaTravada} draggable={false} />
            ))}
            <canvas ref={canvasRef} className={styles.canvasAtivo} />
          </div>
        )}
      </div>

      <div className={styles.barraAcoes}>
        <button className={styles.btnCancelar} onClick={onCancelar} disabled={salvando}>Cancelar</button>
        <button className={styles.btnSalvar} onClick={salvar} disabled={salvando || !pronto}>
          {salvando ? 'Salvando…' : 'Salvar pintura'}
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Criar `src/components/FerramentaPintura.module.css`**

```css
.overlay {
  position: fixed;
  inset: 0;
  background: var(--branco);
  z-index: 200;
  display: flex;
  flex-direction: column;
}

.barraFerramentas {
  display: flex;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1.5px solid var(--cinza-200);
  flex-wrap: wrap;
  align-items: center;
}

.btn, .btnAtivo {
  border-radius: var(--radius-sm);
  padding: 8px 12px;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
}
.btn { background: var(--branco); color: var(--navy); border: 1.5px solid var(--navy); }
.btnAtivo { background: var(--navy); color: #fff; border: 1.5px solid var(--navy); }

.selectEspessura {
  padding: 8px 10px;
  border: 1.5px solid var(--cinza-200);
  border-radius: var(--radius-sm);
  font-size: 13px;
}

.viewport {
  flex: 1;
  position: relative;
  overflow: hidden;
  touch-action: none;
  background: var(--cinza-100, #f5f3f0);
}

.carregando { padding: 20px; color: var(--cinza-600); font-size: 14px; }

.conteudo {
  position: absolute;
  top: 0;
  left: 0;
  transform-origin: 0 0;
}

.imagemPlanta, .camadaTravada, .canvasAtivo {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}
.imagemPlanta, .camadaTravada { pointer-events: none; user-select: none; }

.barraAcoes {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 12px;
  border-top: 1.5px solid var(--cinza-200);
}

.btnCancelar {
  background: var(--branco);
  color: var(--cinza-700);
  border: 1.5px solid var(--cinza-200);
  border-radius: var(--radius-sm);
  padding: 12px 18px;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
}
.btnCancelar:disabled { opacity: 0.6; cursor: default; }

.btnSalvar {
  background: var(--navy);
  color: #fff;
  border: none;
  border-radius: var(--radius-sm);
  padding: 12px 18px;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
}
.btnSalvar:disabled { opacity: 0.6; cursor: default; }
```

(Se `--cinza-100` não existir nas variáveis globais do app, usar só `#f5f3f0` fixo — conferir em
`src/index.css` ou equivalente antes de aplicar; não é crítico, é só o fundo fora da planta.)

- [ ] **Step 3: Build**

```bash
npm run build
```

Esperado: 0 erros de TypeScript. Este componente ainda não é usado em nenhum lugar (isso é
esperado — a Task 5 conecta ele), então não há teste manual possível ainda nesta task.

- [ ] **Step 4: Commit**

```bash
git add src/components/FerramentaPintura.tsx src/components/FerramentaPintura.module.css
git commit -m "feat: componente FerramentaPintura (canvas, pincel/borracha, zoom por pinca)"
```

---

### Task 5: Integração — lançar caminhão abre a pintura + corrigir pintura

**Files:**
- Modify: `src/pages/ControleTecnologicoForm.tsx`

**Interfaces:**
- Consumes: `FerramentaPintura`, `CamadaTravada` (Task 4); tipo `CtPlanta` (Task 2, já importado
  na Task 3).
- Produces: nada consumido por outras tasks (a Task 6 só precisa que `planta`/`imagemPlantaUrl`
  existam como conceito no banco, não deste código específico).

- [ ] **Step 1: Importar `FerramentaPintura` e adicionar estados novos**

Em `src/pages/ControleTecnologicoForm.tsx`, depois do import de `styles` (linha 7), adicionar:

```ts
import FerramentaPintura, { type CamadaTravada } from '../components/FerramentaPintura'
```

Em `src/pages/ControleTecnologicoForm.tsx:75-78` (logo depois dos estados de laudo), adicionar:

```ts
  const [planta, setPlanta] = useState<CtPlanta | null>(null)
  const [imagemPlantaUrl, setImagemPlantaUrl] = useState<string | null>(null)
  const [caminhaoParaPintar, setCaminhaoParaPintar] = useState<CtCaminhao | null>(null)
  const [camadasTravadas, setCamadasTravadas] = useState<CamadaTravada[]>([])
  const [pinturaExistenteUrl, setPinturaExistenteUrl] = useState<string | null>(null)
  const [salvandoPintura, setSalvandoPintura] = useState(false)
```

- [ ] **Step 2: Carregar a planta (e sua URL assinada) quando a concretagem usa uma**

Em `src/pages/ControleTecnologicoForm.tsx`, logo depois do `useEffect` que carrega `caminhoes`
(o bloco que termina em `}, [caminhoes])`, adicionar:

```ts
  useEffect(() => {
    if (!concretagem?.planta_id) { setPlanta(null); return }
    supabase.from('ct_plantas').select('*').eq('id', concretagem.planta_id).single()
      .then(({ data }) => setPlanta(data ?? null))
  }, [concretagem?.planta_id])

  useEffect(() => {
    if (!planta) { setImagemPlantaUrl(null); return }
    supabase.storage.from('controle-tecnologico').createSignedUrl(planta.imagem_path, 3600)
      .then(({ data }) => setImagemPlantaUrl(data?.signedUrl ?? null))
  }, [planta])
```

- [ ] **Step 3: Função `abrirPintura` — monta as camadas travadas e abre a ferramenta**

Logo antes da função `lancarCaminhao` (linha 123), adicionar:

```ts
  async function abrirPintura(caminhao: CtCaminhao) {
    const outrosComPintura = caminhoes.filter(c => c.id !== caminhao.id && c.pintura_url)
    const camadas = await Promise.all(outrosComPintura.map(async c => {
      const { data } = await supabase.storage.from('controle-tecnologico').createSignedUrl(c.pintura_url!, 3600)
      return { id: c.id, url: data?.signedUrl ?? '' }
    }))
    setCamadasTravadas(camadas.filter(c => c.url))

    if (caminhao.pintura_url) {
      const { data } = await supabase.storage.from('controle-tecnologico').createSignedUrl(caminhao.pintura_url, 3600)
      setPinturaExistenteUrl(data?.signedUrl ?? null)
    } else {
      setPinturaExistenteUrl(null)
    }
    setCaminhaoParaPintar(caminhao)
  }

  async function salvarPintura(blob: Blob) {
    if (!caminhaoParaPintar || !obraAtiva) return
    setSalvandoPintura(true)
    const path = `${obraAtiva.id}/${crypto.randomUUID()}-pintura.png`
    const { error: eUp } = await supabase.storage.from('controle-tecnologico').upload(path, blob)
    if (eUp) {
      setSalvandoPintura(false)
      setMsgCaminhao({ tipo: 'erro', texto: `Falha ao salvar a pintura: ${eUp.message}` })
      return
    }
    const { error } = await supabase.from('ct_caminhoes').update({ pintura_url: path }).eq('id', caminhaoParaPintar.id)
    setSalvandoPintura(false)
    if (error) {
      setMsgCaminhao({ tipo: 'erro', texto: `Falha ao registrar a pintura: ${error.message}` })
      return
    }
    setCaminhaoParaPintar(null)
    if (concretagem) carregarCaminhoes(concretagem.id)
  }
```

- [ ] **Step 4: `lancarCaminhao` abre a pintura automaticamente quando a concretagem usa planta**

Em `src/pages/ControleTecnologicoForm.tsx:123-158`, hoje:

```ts
  async function lancarCaminhao() {
    if (!concretagem) return
    if (!fFornecedor.trim() || !fNf.trim() || !fAmostra.trim() || !fLacre.trim() || !fVolume) {
      setMsgCaminhao({ tipo: 'erro', texto: 'Preencha fornecedor, NF, amostra, lacre e volume.' })
      return
    }
    setSalvandoCaminhao(true)
    setMsgCaminhao(null)
    const { error } = await supabase.from('ct_caminhoes').insert({
      concretagem_id: concretagem.id,
      fornecedor: fFornecedor.trim(),
      nf: fNf.trim(),
      numero_amostra: fAmostra.trim(),
      numero_lacre: fLacre.trim(),
      volume_m3: Number(fVolume),
      slump_solicitado_cm: fSlumpSolicitado ? Number(fSlumpSolicitado) : null,
      slump_tolerancia_cm: fSlumpTolerancia ? Number(fSlumpTolerancia) : null,
      slump_medido_cm: fSlumpMedido ? Number(fSlumpMedido) : null,
      hora_saida_usina: horaOuNulo(fHoraSaida, concretagem.data),
      hora_chegada_obra: horaOuNulo(fHoraChegada, concretagem.data),
      hora_inicio_descarga: horaOuNulo(fHoraInicioDescarga, concretagem.data),
      hora_fim_descarga: horaOuNulo(fHoraFimDescarga, concretagem.data),
      cor: fCor,
    })
    setSalvandoCaminhao(false)
    if (error) {
      setMsgCaminhao({ tipo: 'erro', texto: `Erro ao lançar caminhão: ${error.message}` })
      return
    }
    setFFornecedor(''); setFNf(''); setFAmostra(''); setFLacre(''); setFVolume('')
    setFSlumpSolicitado(''); setFSlumpTolerancia(''); setFSlumpMedido('')
    setFHoraSaida(''); setFHoraChegada(''); setFHoraInicioDescarga(''); setFHoraFimDescarga('')
    setFCor('#C49A7A')
    setMostrarFormCaminhao(false)
    carregarCaminhoes(concretagem.id)
  }
```

Trocar por:

```ts
  async function lancarCaminhao() {
    if (!concretagem) return
    if (!fFornecedor.trim() || !fNf.trim() || !fAmostra.trim() || !fLacre.trim() || !fVolume) {
      setMsgCaminhao({ tipo: 'erro', texto: 'Preencha fornecedor, NF, amostra, lacre e volume.' })
      return
    }
    setSalvandoCaminhao(true)
    setMsgCaminhao(null)
    const { data: novoCaminhao, error } = await supabase.from('ct_caminhoes').insert({
      concretagem_id: concretagem.id,
      fornecedor: fFornecedor.trim(),
      nf: fNf.trim(),
      numero_amostra: fAmostra.trim(),
      numero_lacre: fLacre.trim(),
      volume_m3: Number(fVolume),
      slump_solicitado_cm: fSlumpSolicitado ? Number(fSlumpSolicitado) : null,
      slump_tolerancia_cm: fSlumpTolerancia ? Number(fSlumpTolerancia) : null,
      slump_medido_cm: fSlumpMedido ? Number(fSlumpMedido) : null,
      hora_saida_usina: horaOuNulo(fHoraSaida, concretagem.data),
      hora_chegada_obra: horaOuNulo(fHoraChegada, concretagem.data),
      hora_inicio_descarga: horaOuNulo(fHoraInicioDescarga, concretagem.data),
      hora_fim_descarga: horaOuNulo(fHoraFimDescarga, concretagem.data),
      cor: fCor,
    }).select().single()
    setSalvandoCaminhao(false)
    if (error || !novoCaminhao) {
      setMsgCaminhao({ tipo: 'erro', texto: `Erro ao lançar caminhão: ${error?.message}` })
      return
    }
    setFFornecedor(''); setFNf(''); setFAmostra(''); setFLacre(''); setFVolume('')
    setFSlumpSolicitado(''); setFSlumpTolerancia(''); setFSlumpMedido('')
    setFHoraSaida(''); setFHoraChegada(''); setFHoraInicioDescarga(''); setFHoraFimDescarga('')
    setFCor('#C49A7A')
    setMostrarFormCaminhao(false)
    await carregarCaminhoes(concretagem.id)
    if (concretagem.planta_id) await abrirPintura(novoCaminhao)
  }
```

(`carregarCaminhoes` já é `async function` — `await` nela aqui garante que `caminhoes` no estado
já reflete o caminhão recém-criado antes de `abrirPintura` calcular as camadas travadas dos
"outros".)

- [ ] **Step 5: Botão "Corrigir pintura" na lista de caminhões**

Em `src/pages/ControleTecnologicoForm.tsx:380-385`, hoje (o bloco de aprovar/reprovar laudo, sem
nada depois dele dentro de `.caminhaoInfo`):

```tsx
              {perfil?.papel === 'admin' && c.status_laudo === 'pendente' && c.laudo_url && (
                <div className={styles.laudoForm}>
                  <button className={styles.btnPrincipal} onClick={() => validarLaudo(c, true)}>Aprovar</button>
                  <button className={styles.btnPerigo} onClick={() => validarLaudo(c, false)}>Reprovar</button>
                </div>
              )}
            </div>
          </div>
        ))}
```

Trocar por (adiciona o botão de pintura logo antes do fechamento de `.caminhaoInfo`):

```tsx
              {perfil?.papel === 'admin' && c.status_laudo === 'pendente' && c.laudo_url && (
                <div className={styles.laudoForm}>
                  <button className={styles.btnPrincipal} onClick={() => validarLaudo(c, true)}>Aprovar</button>
                  <button className={styles.btnPerigo} onClick={() => validarLaudo(c, false)}>Reprovar</button>
                </div>
              )}
              {concretagem.status === 'aberta' && concretagem.planta_id && podeEditar && (
                <button className={styles.btnSecundario} onClick={() => abrirPintura(c)} style={{ marginTop: 6 }}>
                  🖌️ {c.pintura_url ? 'Corrigir pintura' : 'Pintar área'}
                </button>
              )}
            </div>
          </div>
        ))}
```

- [ ] **Step 6: Renderizar `FerramentaPintura` quando `caminhaoParaPintar` está setado**

Em `src/pages/ControleTecnologicoForm.tsx:399-409` (o final do `return` principal), hoje:

```tsx
      {concretagem.status === 'finalizada' && (
        <div className={styles.bloco}>
          <button className={styles.btnSecundario} onClick={imprimir} disabled={gerandoPdf}>
            {gerandoPdf ? 'Gerando PDF…' : '🖨️ Imprimir PDF'}
          </button>
          {msgCaminhao && <p className={msgCaminhao.tipo === 'ok' ? styles.msgOk : styles.msgErro}>{msgCaminhao.texto}</p>}
        </div>
      )}
    </div>
  )
}
```

Trocar por (adiciona o overlay da ferramenta de pintura logo antes do `</div>` de fechamento da
página):

```tsx
      {concretagem.status === 'finalizada' && (
        <div className={styles.bloco}>
          <button className={styles.btnSecundario} onClick={imprimir} disabled={gerandoPdf}>
            {gerandoPdf ? 'Gerando PDF…' : '🖨️ Imprimir PDF'}
          </button>
          {msgCaminhao && <p className={msgCaminhao.tipo === 'ok' ? styles.msgOk : styles.msgErro}>{msgCaminhao.texto}</p>}
        </div>
      )}

      {caminhaoParaPintar && imagemPlantaUrl && (
        <FerramentaPintura
          imagemPlantaUrl={imagemPlantaUrl}
          camadasTravadas={camadasTravadas}
          corAtual={caminhaoParaPintar.cor}
          pinturaExistenteUrl={pinturaExistenteUrl}
          onSalvar={salvarPintura}
          onCancelar={() => setCaminhaoParaPintar(null)}
          salvando={salvandoPintura}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 7: Build**

```bash
npm run build
```

Esperado: 0 erros de TypeScript.

- [ ] **Step 8: Commit**

```bash
git add src/pages/ControleTecnologicoForm.tsx
git commit -m "feat: lancar caminhao abre a pintura automaticamente e permite corrigir depois"
```

---

### Task 6: PDF — achatamento planta + camadas

**Files:**
- Create: `src/lib/ctPinturaFlatten.ts`
- Modify: `src/lib/controleTecnologicoPdf.ts`
- Modify: `src/pages/ControleTecnologicoForm.tsx` (`imprimir()`)

**Interfaces:**
- Consumes: `ImagemAnexo` (já existe em `src/lib/pdfParaImagem.ts`); estado `planta` (Task 5, já
  carregado quando `concretagem.planta_id` existe).
- Produces: `achatarPlantaEPinturas(planta: { imagem_path: string }, caminhoes: CtCaminhao[]): Promise<ImagemAnexo>`
  de `src/lib/ctPinturaFlatten.ts`, consumida só por `gerarPdfConcretagem` nesta mesma task.

- [ ] **Step 1: Criar `src/lib/ctPinturaFlatten.ts`**

```ts
// Achata a planta + a pintura de cada caminhão num canvas só, pra virar a
// página 1 do PDF do Controle Tecnológico quando a concretagem usa planta do
// catálogo em vez de anexo (ver docs/superpowers/specs/2026-09-10-ct-pintura-fase2-design.md §9).
import { supabase, type CtCaminhao } from './supabase'
import type { ImagemAnexo } from './pdfParaImagem'

async function carregarImagem(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Não foi possível carregar uma das camadas da pintura.'))
    img.src = url
  })
}

export async function achatarPlantaEPinturas(
  planta: { imagem_path: string },
  caminhoes: CtCaminhao[],
): Promise<ImagemAnexo> {
  const { data: plantaBlob, error } = await supabase.storage.from('controle-tecnologico').download(planta.imagem_path)
  if (error || !plantaBlob) {
    throw new Error(`Não foi possível baixar a planta: ${error?.message ?? 'arquivo não encontrado'}`)
  }
  const plantaUrl = URL.createObjectURL(plantaBlob)
  try {
    const imgPlanta = await carregarImagem(plantaUrl)
    const canvas = document.createElement('canvas')
    canvas.width = imgPlanta.naturalWidth
    canvas.height = imgPlanta.naturalHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Não foi possível preparar o achatamento da planta.')
    ctx.drawImage(imgPlanta, 0, 0)

    for (const c of caminhoes) {
      if (!c.pintura_url) continue
      const { data: camadaBlob, error: eCamada } = await supabase.storage.from('controle-tecnologico').download(c.pintura_url)
      if (eCamada || !camadaBlob) {
        throw new Error(`Não foi possível baixar a pintura de um dos caminhões: ${eCamada?.message ?? 'arquivo não encontrado'}`)
      }
      const camadaUrl = URL.createObjectURL(camadaBlob)
      try {
        const imgCamada = await carregarImagem(camadaUrl)
        ctx.drawImage(imgCamada, 0, 0, canvas.width, canvas.height)
      } finally {
        URL.revokeObjectURL(camadaUrl)
      }
    }

    return { dataUrl: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height }
  } finally {
    URL.revokeObjectURL(plantaUrl)
  }
}
```

- [ ] **Step 2: `DadosPdfConcretagem` ganha `planta`, `gerarPdfConcretagem` ramifica**

Em `src/lib/controleTecnologicoPdf.ts:18-24`, hoje:

```ts
export interface DadosPdfConcretagem {
  concretagem: CtConcretagem
  caminhoes: CtCaminhao[]
  identidade: IdentidadeMarca
  obraNome: string
  unidadeNome: string
}
```

Trocar por:

```ts
export interface DadosPdfConcretagem {
  concretagem: CtConcretagem
  caminhoes: CtCaminhao[]
  identidade: IdentidadeMarca
  obraNome: string
  unidadeNome: string
  planta: { imagem_path: string } | null
}
```

Em `src/lib/controleTecnologicoPdf.ts:186-208` (o corpo atual de `gerarPdfConcretagem`), hoje:

```ts
export async function gerarPdfConcretagem(d: DadosPdfConcretagem): Promise<void> {
  if (!d.concretagem.anexo_url) {
    throw new Error('Esta concretagem não tem mapa anexado — não é possível gerar o PDF.')
  }
  const { data: blob, error } = await supabase.storage
    .from('controle-tecnologico')
    .download(d.concretagem.anexo_url)
  if (error || !blob) {
    throw new Error(`Não foi possível baixar o mapa anexado: ${error?.message ?? 'arquivo não encontrado'}`)
  }
  const imagem = await prepararImagemAnexo(blob, d.concretagem.anexo_url)

  const orientacaoMapa = imagem.width >= imagem.height ? 'landscape' : 'portrait'
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: orientacaoMapa })
  desenharPaginaMapa(pdf, d, imagem)

  pdf.addPage('a4', 'landscape')
  desenharPaginaTabela(pdf, d)

  desenharRodapeTodasPaginas(pdf, d.identidade.rodapeTexto)

  pdf.save(`Controle Tecnologico - ${d.unidadeNome} - ${fmtData(d.concretagem.data)}.pdf`)
}
```

Trocar por:

```ts
export async function gerarPdfConcretagem(d: DadosPdfConcretagem): Promise<void> {
  let imagem: ImagemAnexo
  if (d.concretagem.anexo_url) {
    const { data: blob, error } = await supabase.storage
      .from('controle-tecnologico')
      .download(d.concretagem.anexo_url)
    if (error || !blob) {
      throw new Error(`Não foi possível baixar o mapa anexado: ${error?.message ?? 'arquivo não encontrado'}`)
    }
    imagem = await prepararImagemAnexo(blob, d.concretagem.anexo_url)
  } else if (d.planta) {
    const { achatarPlantaEPinturas } = await import('./ctPinturaFlatten')
    imagem = await achatarPlantaEPinturas(d.planta, d.caminhoes)
  } else {
    throw new Error('Esta concretagem não tem mapa nem planta — não é possível gerar o PDF.')
  }

  const orientacaoMapa = imagem.width >= imagem.height ? 'landscape' : 'portrait'
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: orientacaoMapa })
  desenharPaginaMapa(pdf, d, imagem)

  pdf.addPage('a4', 'landscape')
  desenharPaginaTabela(pdf, d)

  desenharRodapeTodasPaginas(pdf, d.identidade.rodapeTexto)

  pdf.save(`Controle Tecnologico - ${d.unidadeNome} - ${fmtData(d.concretagem.data)}.pdf`)
}
```

(`ImagemAnexo` já está importado no topo do arquivo via `import { prepararImagemAnexo, type ImagemAnexo } from './pdfParaImagem'` — nenhum import novo necessário além do dinâmico de `ctPinturaFlatten`.)

- [ ] **Step 3: `imprimir()` passa `planta`**

Em `src/pages/ControleTecnologicoForm.tsx:217-221`, hoje:

```ts
      await gerarPdfConcretagem({
        concretagem, caminhoes, identidade,
        obraNome: obraRow?.nome ?? '—',
        unidadeNome: nomeUnidadeAtual,
      })
```

Trocar por:

```ts
      await gerarPdfConcretagem({
        concretagem, caminhoes, identidade,
        obraNome: obraRow?.nome ?? '—',
        unidadeNome: nomeUnidadeAtual,
        planta: planta ? { imagem_path: planta.imagem_path } : null,
      })
```

- [ ] **Step 4: Build**

```bash
npm run build
```

Esperado: 0 erros de TypeScript.

- [ ] **Step 5: Teste manual (o mais completo desta sessão inteira, sem navegador — pede ao Rodrigo)**

Sem navegador nesta sessão, então este passo fica registrado como pendência explícita, não como
"testado":

- Cadastrar 1 planta (PDF pequeno de teste) em `/controle-tecnologico/plantas`.
- Criar 1 concretagem nova escolhendo essa planta.
- Lançar 2 caminhões — confirmar que a Ferramenta de Pintura abre sozinha depois de cada um, que a
  pintura do primeiro aparece travada (cinza/translúcida ou na cor original, mas sem poder editar)
  enquanto pinta o segundo, que pinça de dois dedos dá zoom sem desenhar, e que "Salvar pintura"
  fecha a ferramenta e volta pra lista.
- Testar "🖌️ Corrigir pintura" num caminhão já pintado — confirmar que a pintura anterior aparece
  no canvas pra continuar editando.
- Finalizar a concretagem e gerar o PDF — confirmar que a página 1 mostra a planta com as duas
  pinturas por cima, nas cores certas, e que a página 2 (tabela) não mudou nada.
- Confirmar que depois de finalizada, "Corrigir pintura" some da tela E que uma tentativa direta de
  `UPDATE ct_caminhoes SET pintura_url = ...` por SQL nessa concretagem falha (trava do banco da
  Task 1).

- [ ] **Step 6: Commit**

```bash
git add src/lib/ctPinturaFlatten.ts src/lib/controleTecnologicoPdf.ts src/pages/ControleTecnologicoForm.tsx
git commit -m "feat: achata planta e pinturas dos caminhoes na pagina 1 do PDF"
```
