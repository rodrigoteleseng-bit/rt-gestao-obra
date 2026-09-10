# Controle Tecnológico — Lacre, horário só-hora e slump com tolerância Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajustar o lançamento de caminhão no Controle Tecnológico do concreto: número do lacre
da betoneira obrigatório, horários só com hora (a data já vem da concretagem), e slump solicitado
como nominal + tolerância simétrica (ex.: "12 ± 2").

**Architecture:** Uma migração de schema adiciona `numero_lacre` (obrigatório) e
`slump_tolerancia_cm` (opcional) em `ct_caminhoes` — nenhuma tabela nova, nenhuma mudança de tipo
nas colunas de horário existentes. Frontend (`ControleTecnologicoForm.tsx`) muda a forma como
preenche esses campos: horário vira `<input type="time">` combinado em JS com `concretagem.data`;
slump ganha um segundo campo. PDF (`controleTecnologicoPdf.ts`) ganha uma coluna e reformata duas
colunas existentes, redistribuindo as larguras da tabela-legenda.

**Tech Stack:** Supabase (Postgres + RLS) + React 19 + TypeScript + Vite + jsPDF. Sem framework de
testes — verificação por SQL direto (`apply_migration`/`execute_sql`) e `npm run build` + teste
manual no navegador.

## Global Constraints

- Spec completa: `docs/superpowers/specs/2026-09-10-ct-lacre-horario-slump-design.md` — ler antes
  de implementar qualquer task. Refina
  `docs/superpowers/specs/2026-09-09-controle-tecnologico-concreto-design.md`.
- Concretagem nunca atravessa meia-noite na prática (confirmado com o Rodrigo) — todo horário
  lançado usa sempre a data da concretagem, sem exceção nem campo pra indicar "dia seguinte".
- `numero_lacre` é obrigatório como NF/amostra já são — mesmo tratamento de validação (bloqueia
  com mensagem, não falha silenciosamente).
- Tolerância de slump é sempre simétrica (± um valor único) — nunca faixa mín/máx independente.
- Slump medido continua um valor único, sem tolerância — não muda nesta implementação.
- **Ordem obrigatória dentro da Task 1**: apagar os 3 caminhões de teste (e as 2 concretagens que
  ficam vazias) **antes** de aplicar `ALTER COLUMN numero_lacre SET NOT NULL` — a migração falha
  se sobrar qualquer linha com o campo nulo.
- Toda mudança de schema precisa de migração versionada em `supabase/migrations`, aplicada via
  `mcp__claude_ai_Supabase__apply_migration` (projeto `yxshldsfmbmbzdkcymca`) e também salva como
  arquivo local (a ferramenta MCP aplica no banco remoto, mas não cria o arquivo do repositório —
  isso precisa ser feito à parte com a mesma SQL).
- Este módulo ainda não tem aceite de campo (Fase 1 do Controle Tecnológico) — a limpeza de dados
  de teste da Task 1 não precisa de soft delete nem aviso extra, é dado sintético/de teste.

---

### Task 1: Migração — lacre obrigatório e tolerância de slump (com limpeza de dados de teste)

**Files:**
- Create: `supabase/migrations/20260910_ct_lacre_slump_tolerancia.sql`

**Interfaces:**
- Produces: colunas `ct_caminhoes.numero_lacre` (TEXT NOT NULL) e
  `ct_caminhoes.slump_tolerancia_cm` (NUMERIC(4,1), nullable). Usadas pelas Tasks 2 e 3.

- [ ] **Step 1: Apagar os 3 caminhões de teste e as 2 concretagens que ficam vazias**

Via `mcp__claude_ai_Supabase__execute_sql` (projeto `yxshldsfmbmbzdkcymca`) — **não** é migração
versionada, é limpeza pontual de dado de teste (ver spec §4):

```sql
DELETE FROM ct_caminhoes WHERE concretagem_id IN (
  '0c93e850-444a-4efc-a822-a0bbe8d674b2',  -- concretagem sintética "TESTE ALERTA 30 DIAS"
  '0a2fa183-9c62-4665-910a-35bcde0574e4'   -- concretagem real COOPERMIX (já finalizada, 2 caminhões)
);
DELETE FROM ct_concretagens WHERE id IN (
  '0c93e850-444a-4efc-a822-a0bbe8d674b2',
  '0a2fa183-9c62-4665-910a-35bcde0574e4'
);
```

- [ ] **Step 2: Verificar que não sobrou nenhuma linha**

```sql
SELECT count(*) FROM ct_caminhoes;
SELECT count(*) FROM ct_concretagens;
-- Esperado: 0 e 0
```

Se sobrar alguma linha diferente dessas (ex.: o Rodrigo lançou outro caminhão de teste depois da
sessão anterior), pare e confirme com ele antes de seguir — não apagar dado sem confirmar.

- [ ] **Step 3: Escrever a migração**

Criar `supabase/migrations/20260910_ct_lacre_slump_tolerancia.sql`:

```sql
-- Ajuste de campos do Controle Tecnológico encontrado no primeiro teste de campo real
-- (ver docs/superpowers/specs/2026-09-10-ct-lacre-horario-slump-design.md):
-- lacre da betoneira obrigatório e slump solicitado com tolerância simétrica.
-- As colunas de horário (hora_saida_usina etc.) não mudam de tipo aqui — só muda
-- como o frontend as preenche (usa a data da concretagem em vez de pedir de novo).

ALTER TABLE ct_caminhoes ADD COLUMN numero_lacre TEXT;
ALTER TABLE ct_caminhoes ADD COLUMN slump_tolerancia_cm NUMERIC(4,1);

-- Precisa que nenhuma linha tenha ficado com numero_lacre nulo (Steps 1-2 acima
-- limpam os únicos dados existentes, todos de teste, antes deste ponto).
ALTER TABLE ct_caminhoes ALTER COLUMN numero_lacre SET NOT NULL;
ALTER TABLE ct_caminhoes ADD CONSTRAINT ct_caminhoes_lacre_nao_vazio CHECK (btrim(numero_lacre) <> '');
```

- [ ] **Step 4: Aplicar a migração**

Aplicar via `mcp__claude_ai_Supabase__apply_migration` (projeto `yxshldsfmbmbzdkcymca`, nome
`ct_lacre_slump_tolerancia`), usando o mesmo SQL do Step 3.

- [ ] **Step 5: Verificar**

```sql
SELECT column_name, is_nullable, data_type, numeric_precision, numeric_scale
FROM information_schema.columns
WHERE table_name = 'ct_caminhoes' AND column_name IN ('numero_lacre', 'slump_tolerancia_cm');
-- Esperado: numero_lacre | NO | text | NULL | NULL
--           slump_tolerancia_cm | YES | numeric | 4 | 1

SELECT conname FROM pg_constraint WHERE conname = 'ct_caminhoes_lacre_nao_vazio';
-- Esperado: 1 linha
```

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260910_ct_lacre_slump_tolerancia.sql
git commit -m "feat: adiciona lacre obrigatorio e tolerancia de slump no Controle Tecnologico"
```

---

### Task 2: Frontend — lançar caminhão (lacre, horário só-hora, slump com tolerância)

**Files:**
- Modify: `src/lib/supabase.ts` (interface `CtCaminhao`)
- Modify: `src/pages/ControleTecnologicoForm.tsx`
- Modify: `src/pages/ControleTecnologicoForm.module.css`

**Interfaces:**
- Consumes: colunas `ct_caminhoes.numero_lacre`/`slump_tolerancia_cm` (Task 1).
- Produces: `CtCaminhao.numero_lacre: string` e `CtCaminhao.slump_tolerancia_cm: number | null` em
  `src/lib/supabase.ts`; função `fmtSlumpSolicitado(nominal: number | null, tolerancia: number | null): string`
  local a `ControleTecnologicoForm.tsx`. A Task 3 replica o mesmo formato (não importa deste
  arquivo — `controleTecnologicoPdf.ts` já não importa nada de páginas hoje, mantém o padrão).

- [ ] **Step 1: Atualizar a interface `CtCaminhao` em `src/lib/supabase.ts`**

Em `src/lib/supabase.ts:284-308`, a interface hoje é:

```ts
export interface CtCaminhao {
  id: string
  concretagem_id: string
  fornecedor: string
  nf: string
  numero_amostra: string
  hora_saida_usina: string | null
  hora_chegada_obra: string | null
  hora_inicio_descarga: string | null
  hora_fim_descarga: string | null
  volume_m3: number
  slump_solicitado_cm: number | null
  slump_medido_cm: number | null
  cor: string
  pintura_url: string | null
  status_laudo: StatusLaudoConcreto
  laudo_url: string | null
  laudo_anexado_em: string | null
  validado_por: string | null
  validado_em: string | null
  pendencia_id: string | null
  ativo: boolean
  criado_por: string
  criado_em: string
}
```

Trocar por (duas linhas novas: `numero_lacre` depois de `numero_amostra`, `slump_tolerancia_cm`
depois de `slump_solicitado_cm`):

```ts
export interface CtCaminhao {
  id: string
  concretagem_id: string
  fornecedor: string
  nf: string
  numero_amostra: string
  numero_lacre: string
  hora_saida_usina: string | null
  hora_chegada_obra: string | null
  hora_inicio_descarga: string | null
  hora_fim_descarga: string | null
  volume_m3: number
  slump_solicitado_cm: number | null
  slump_tolerancia_cm: number | null
  slump_medido_cm: number | null
  cor: string
  pintura_url: string | null
  status_laudo: StatusLaudoConcreto
  laudo_url: string | null
  laudo_anexado_em: string | null
  validado_por: string | null
  validado_em: string | null
  pendencia_id: string | null
  ativo: boolean
  criado_por: string
  criado_em: string
}
```

- [ ] **Step 2: Adicionar os estados novos em `ControleTecnologicoForm.tsx`**

Em `src/pages/ControleTecnologicoForm.tsx:47-52`, o bloco hoje é:

```ts
  const [fFornecedor, setFFornecedor] = useState('')
  const [fNf, setFNf] = useState('')
  const [fAmostra, setFAmostra] = useState('')
  const [fVolume, setFVolume] = useState('')
  const [fSlumpSolicitado, setFSlumpSolicitado] = useState('')
  const [fSlumpMedido, setFSlumpMedido] = useState('')
```

Trocar por:

```ts
  const [fFornecedor, setFFornecedor] = useState('')
  const [fNf, setFNf] = useState('')
  const [fAmostra, setFAmostra] = useState('')
  const [fLacre, setFLacre] = useState('')
  const [fVolume, setFVolume] = useState('')
  const [fSlumpSolicitado, setFSlumpSolicitado] = useState('')
  const [fSlumpTolerancia, setFSlumpTolerancia] = useState('')
  const [fSlumpMedido, setFSlumpMedido] = useState('')
```

- [ ] **Step 3: Trocar `horaOuNulo` para receber a data da concretagem**

Em `src/pages/ControleTecnologicoForm.tsx:106-108`, hoje:

```ts
  function horaOuNulo(valor: string): string | null {
    return valor ? new Date(valor).toISOString() : null
  }
```

Trocar por:

```ts
  function horaOuNulo(valorHora: string, dataConcretagem: string): string | null {
    return valorHora ? new Date(`${dataConcretagem}T${valorHora}`).toISOString() : null
  }
```

`valorHora` vem de um `<input type="time">` (formato `"14:30"`); combinado com
`dataConcretagem` (formato `"2026-09-10"`, já validado como `DATE NOT NULL` no banco) monta
`"2026-09-10T14:30"`, que o `Date` do JS interpreta como horário local — mesmo comportamento que
já existia antes (o `datetime-local` produzia essa mesma string, só que com a data escolhida pelo
usuário em vez da data fixa da concretagem).

- [ ] **Step 4: Atualizar validação e `insert` em `lancarCaminhao`**

Em `src/pages/ControleTecnologicoForm.tsx:110-131`, hoje:

```ts
  async function lancarCaminhao() {
    if (!concretagem) return
    if (!fFornecedor.trim() || !fNf.trim() || !fAmostra.trim() || !fVolume) {
      setMsgCaminhao({ tipo: 'erro', texto: 'Preencha fornecedor, NF, amostra e volume.' })
      return
    }
    setSalvandoCaminhao(true)
    setMsgCaminhao(null)
    const { error } = await supabase.from('ct_caminhoes').insert({
      concretagem_id: concretagem.id,
      fornecedor: fFornecedor.trim(),
      nf: fNf.trim(),
      numero_amostra: fAmostra.trim(),
      volume_m3: Number(fVolume),
      slump_solicitado_cm: fSlumpSolicitado ? Number(fSlumpSolicitado) : null,
      slump_medido_cm: fSlumpMedido ? Number(fSlumpMedido) : null,
      hora_saida_usina: horaOuNulo(fHoraSaida),
      hora_chegada_obra: horaOuNulo(fHoraChegada),
      hora_inicio_descarga: horaOuNulo(fHoraInicioDescarga),
      hora_fim_descarga: horaOuNulo(fHoraFimDescarga),
      cor: fCor,
    })
    setSalvandoCaminhao(false)
    if (error) {
      setMsgCaminhao({ tipo: 'erro', texto: `Erro ao lançar caminhão: ${error.message}` })
      return
    }
    setFFornecedor(''); setFNf(''); setFAmostra(''); setFVolume('')
    setFSlumpSolicitado(''); setFSlumpMedido('')
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

- [ ] **Step 5: Adicionar os helpers de formatação, antes do `export default function`**

Em `src/pages/ControleTecnologicoForm.tsx`, logo depois da função `nomeArquivoStorage` (linha 25,
antes de `export default function ControleTecnologicoForm()`), adicionar:

```ts
function fmtHoraCurta(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

function fmtSlumpSolicitado(nominal: number | null, tolerancia: number | null): string {
  if (nominal === null) return '—'
  return tolerancia ? `${nominal}±${tolerancia}` : `${nominal}`
}
```

- [ ] **Step 6: Campo "Número do lacre" no formulário**

Em `src/pages/ControleTecnologicoForm.tsx:296-297`, hoje:

```tsx
            <label className={styles.campo}>Nº da amostra (laboratório) *
              <input value={fAmostra} onChange={e => setFAmostra(e.target.value)} /></label>
```

Trocar por (adiciona o campo de lacre logo depois):

```tsx
            <label className={styles.campo}>Nº da amostra (laboratório) *
              <input value={fAmostra} onChange={e => setFAmostra(e.target.value)} /></label>
            <label className={styles.campo}>Número do lacre (betoneira) *
              <input value={fLacre} onChange={e => setFLacre(e.target.value)} /></label>
```

- [ ] **Step 7: Slump nominal + tolerância lado a lado, horários viram `type="time"`**

Em `src/pages/ControleTecnologicoForm.tsx:300-311`, hoje:

```tsx
            <label className={styles.campo}>Slump solicitado (cm)
              <input type="number" min="0" step="0.5" value={fSlumpSolicitado} onChange={e => setFSlumpSolicitado(e.target.value)} /></label>
            <label className={styles.campo}>Slump medido (cm)
              <input type="number" min="0" step="0.5" value={fSlumpMedido} onChange={e => setFSlumpMedido(e.target.value)} /></label>
            <label className={styles.campo}>Saída da usina
              <input type="datetime-local" value={fHoraSaida} onChange={e => setFHoraSaida(e.target.value)} /></label>
            <label className={styles.campo}>Chegada na obra
              <input type="datetime-local" value={fHoraChegada} onChange={e => setFHoraChegada(e.target.value)} /></label>
            <label className={styles.campo}>Início da descarga
              <input type="datetime-local" value={fHoraInicioDescarga} onChange={e => setFHoraInicioDescarga(e.target.value)} /></label>
            <label className={styles.campo}>Fim da descarga
              <input type="datetime-local" value={fHoraFimDescarga} onChange={e => setFHoraFimDescarga(e.target.value)} /></label>
```

Trocar por:

```tsx
            <div className={styles.parCampos}>
              <label className={styles.campo}>Slump nominal (cm)
                <input type="number" min="0" step="0.5" value={fSlumpSolicitado} onChange={e => setFSlumpSolicitado(e.target.value)} /></label>
              <label className={styles.campo}>Tolerância (± cm)
                <input type="number" min="0" step="0.5" value={fSlumpTolerancia} onChange={e => setFSlumpTolerancia(e.target.value)} /></label>
            </div>
            <label className={styles.campo}>Slump medido (cm)
              <input type="number" min="0" step="0.5" value={fSlumpMedido} onChange={e => setFSlumpMedido(e.target.value)} /></label>
            <label className={styles.campo}>Saída da usina
              <input type="time" value={fHoraSaida} onChange={e => setFHoraSaida(e.target.value)} /></label>
            <label className={styles.campo}>Chegada na obra
              <input type="time" value={fHoraChegada} onChange={e => setFHoraChegada(e.target.value)} /></label>
            <label className={styles.campo}>Início da descarga
              <input type="time" value={fHoraInicioDescarga} onChange={e => setFHoraInicioDescarga(e.target.value)} /></label>
            <label className={styles.campo}>Fim da descarga
              <input type="time" value={fHoraFimDescarga} onChange={e => setFHoraFimDescarga(e.target.value)} /></label>
```

- [ ] **Step 8: Mostrar lacre, slump e horários na lista de caminhões**

Em `src/pages/ControleTecnologicoForm.tsx:325-332`, hoje:

```tsx
            <div className={styles.caminhaoInfo}>
              <strong>{c.fornecedor}</strong> — NF {c.nf} · Amostra {c.numero_amostra} · {c.volume_m3} m³
              <div className={`${styles.caminhaoMeta} ${styles[`laudo_${c.status_laudo}`]}`}>
                Laudo: {c.status_laudo}
                {c.laudo_url && urlsLaudo.get(c.laudo_url) && (
                  <> · <a className={styles.anexoLink} href={urlsLaudo.get(c.laudo_url)} target="_blank" rel="noreferrer">📎 ver laudo</a></>
                )}
              </div>
```

Trocar por (adiciona lacre na linha principal, e duas linhas novas de detalhe entre ela e a linha
do laudo):

```tsx
            <div className={styles.caminhaoInfo}>
              <strong>{c.fornecedor}</strong> — NF {c.nf} · Amostra {c.numero_amostra} · Lacre {c.numero_lacre} · {c.volume_m3} m³
              <div className={styles.caminhaoDetalhe}>
                Slump: {fmtSlumpSolicitado(c.slump_solicitado_cm, c.slump_tolerancia_cm)} cm (solicitado) / {c.slump_medido_cm ?? '—'} cm (medido)
              </div>
              <div className={styles.caminhaoDetalhe}>
                Saída {fmtHoraCurta(c.hora_saida_usina)} · Chegada {fmtHoraCurta(c.hora_chegada_obra)} · Início desc. {fmtHoraCurta(c.hora_inicio_descarga)} · Fim desc. {fmtHoraCurta(c.hora_fim_descarga)}
              </div>
              <div className={`${styles.caminhaoMeta} ${styles[`laudo_${c.status_laudo}`]}`}>
                Laudo: {c.status_laudo}
                {c.laudo_url && urlsLaudo.get(c.laudo_url) && (
                  <> · <a className={styles.anexoLink} href={urlsLaudo.get(c.laudo_url)} target="_blank" rel="noreferrer">📎 ver laudo</a></>
                )}
              </div>
```

- [ ] **Step 9: CSS novo em `ControleTecnologicoForm.module.css`**

Em `src/pages/ControleTecnologicoForm.module.css`, depois da linha `.caminhaoMeta { ... }`
(linha 57), adicionar:

```css
.parCampos { display: flex; gap: 10px; }
.parCampos > label { flex: 1; }

.caminhaoDetalhe { font-size: 11px; color: var(--cinza-600); margin-top: 2px; }
```

- [ ] **Step 10: Build e teste manual**

```bash
npm run build
```

Testar no navegador como admin: abrir uma concretagem existente (ou criar uma nova), clicar
"+ Lançar caminhão". Confirmar:
- Tentar lançar sem preencher o lacre mostra a mensagem de erro citando "lacre".
- Os 4 campos de horário são seletores de hora (sem data).
- Lançar um caminhão com slump nominal 12, tolerância 2, medido 13, horário de saída "08:00" —
  depois de salvo, a lista mostra "Slump: 12±2 cm (solicitado) / 13 cm (medido)" e
  "Saída 08:00 · Chegada — · Início desc. — · Fim desc. —".
- Lançar um caminhão só com slump nominal (sem tolerância) mostra "Slump: 12 cm (solicitado) / — cm (medido)"
  (sem o "±").

- [ ] **Step 11: Commit**

```bash
git add src/lib/supabase.ts src/pages/ControleTecnologicoForm.tsx src/pages/ControleTecnologicoForm.module.css
git commit -m "feat: lacre obrigatorio, horario so-hora e slump com tolerancia no lancamento de caminhao"
```

---

### Task 3: PDF — coluna de lacre, horários só-hora, slump formatado

**Files:**
- Modify: `src/lib/controleTecnologicoPdf.ts`

**Interfaces:**
- Consumes: `CtCaminhao.numero_lacre` e `CtCaminhao.slump_tolerancia_cm` (Task 2, já aplicadas ao
  tipo consumido por este arquivo via `import type { CtConcretagem, CtCaminhao } from './supabase'`).

- [ ] **Step 1: Encurtar `fmtHora` para mostrar só a hora**

Em `src/lib/controleTecnologicoPdf.ts:24-28`, hoje:

```ts
function fmtHora(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}
```

Trocar por:

```ts
function fmtHora(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

function fmtSlumpSolicitado(nominal: number | null, tolerancia: number | null): string {
  if (nominal === null) return '—'
  return tolerancia ? `${nominal}±${tolerancia}` : `${nominal}`
}
```

- [ ] **Step 2: Redistribuir as colunas da tabela-legenda (cabeçalho)**

Em `src/lib/controleTecnologicoPdf.ts:66-81`, hoje:

```ts
  const colX = { cor: ML, fornecedor: ML + 12, nf: ML + 62, amostra: ML + 92, volume: ML + 132, slump: ML + 157, saida: ML + 187, chegada: ML + 212, inicio: ML + 237, fim: ML + 262 }
  pdf.setFillColor('#F0EBE3')
  pdf.rect(ML, y, LARG, 7, 'F')
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(7)
  pdf.setTextColor(NAVY)
  pdf.text('', colX.cor + 1, y + 4.7)
  pdf.text('FORNECEDOR', colX.fornecedor, y + 4.7)
  pdf.text('NF', colX.nf, y + 4.7)
  pdf.text('AMOSTRA', colX.amostra, y + 4.7)
  pdf.text('VOL. (M³)', colX.volume, y + 4.7)
  pdf.text('SLUMP SOL./MED.', colX.slump, y + 4.7)
  pdf.text('SAÍDA USINA', colX.saida, y + 4.7)
  pdf.text('CHEGADA OBRA', colX.chegada, y + 4.7)
  pdf.text('INÍCIO DESC.', colX.inicio, y + 4.7)
  pdf.text('FIM DESC.', colX.fim, y + 4.7)
  y += 7
```

Trocar por (nova coluna `lacre` entre `amostra` e `volume`; colunas de horário mais estreitas
porque agora mostram só `HH:mm`; larguras: fornecedor 40mm, nf 22mm, amostra 28mm, lacre 28mm,
volume 18mm, slump 28mm — cabe "SLUMP SOL./MED." (o cabeçalho mais longo da tabela) —, saída
16mm, chegada 16mm, início 18mm, fim com folga até a margem. Soma até o fim da última coluna de
conteúdo: 244mm, dentro do limite de 269mm disponível — ver cálculo completo na spec §5):

```ts
  const colX = { cor: ML, fornecedor: ML + 12, nf: ML + 52, amostra: ML + 74, lacre: ML + 102, volume: ML + 130, slump: ML + 148, saida: ML + 176, chegada: ML + 192, inicio: ML + 208, fim: ML + 226 }
  pdf.setFillColor('#F0EBE3')
  pdf.rect(ML, y, LARG, 7, 'F')
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(7)
  pdf.setTextColor(NAVY)
  pdf.text('', colX.cor + 1, y + 4.7)
  pdf.text('FORNECEDOR', colX.fornecedor, y + 4.7)
  pdf.text('NF', colX.nf, y + 4.7)
  pdf.text('AMOSTRA', colX.amostra, y + 4.7)
  pdf.text('LACRE', colX.lacre, y + 4.7)
  pdf.text('VOL. (M³)', colX.volume, y + 4.7)
  pdf.text('SLUMP SOL./MED.', colX.slump, y + 4.7)
  pdf.text('SAÍDA', colX.saida, y + 4.7)
  pdf.text('CHEGADA', colX.chegada, y + 4.7)
  pdf.text('IN. DESC.', colX.inicio, y + 4.7)
  pdf.text('FIM DESC.', colX.fim, y + 4.7)
  y += 7
```

- [ ] **Step 3: Imprimir o lacre e o slump formatado em cada linha**

Em `src/lib/controleTecnologicoPdf.ts:84-102`, hoje:

```ts
  for (const c of d.caminhoes) {
    pdf.setDrawColor('#E0DAD0')
    pdf.setLineWidth(0.2)
    pdf.line(ML, y, W - MR, y)
    pdf.setFillColor(c.cor)
    pdf.rect(colX.cor + 1, y + 1.5, 5, 5, 'F')
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(8)
    pdf.setTextColor('#222222')
    pdf.text(c.fornecedor, colX.fornecedor, y + 5.2)
    pdf.text(c.nf, colX.nf, y + 5.2)
    pdf.text(c.numero_amostra, colX.amostra, y + 5.2)
    pdf.text(`${c.volume_m3}`, colX.volume, y + 5.2)
    pdf.text(`${c.slump_solicitado_cm ?? '—'} / ${c.slump_medido_cm ?? '—'}`, colX.slump, y + 5.2)
    pdf.text(fmtHora(c.hora_saida_usina), colX.saida, y + 5.2)
    pdf.text(fmtHora(c.hora_chegada_obra), colX.chegada, y + 5.2)
    pdf.text(fmtHora(c.hora_inicio_descarga), colX.inicio, y + 5.2)
    pdf.text(fmtHora(c.hora_fim_descarga), colX.fim, y + 5.2)
    y += 8
  }
```

Trocar por:

```ts
  for (const c of d.caminhoes) {
    pdf.setDrawColor('#E0DAD0')
    pdf.setLineWidth(0.2)
    pdf.line(ML, y, W - MR, y)
    pdf.setFillColor(c.cor)
    pdf.rect(colX.cor + 1, y + 1.5, 5, 5, 'F')
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(8)
    pdf.setTextColor('#222222')
    pdf.text(c.fornecedor, colX.fornecedor, y + 5.2)
    pdf.text(c.nf, colX.nf, y + 5.2)
    pdf.text(c.numero_amostra, colX.amostra, y + 5.2)
    pdf.text(c.numero_lacre, colX.lacre, y + 5.2)
    pdf.text(`${c.volume_m3}`, colX.volume, y + 5.2)
    pdf.text(`${fmtSlumpSolicitado(c.slump_solicitado_cm, c.slump_tolerancia_cm)} / ${c.slump_medido_cm ?? '—'}`, colX.slump, y + 5.2)
    pdf.text(fmtHora(c.hora_saida_usina), colX.saida, y + 5.2)
    pdf.text(fmtHora(c.hora_chegada_obra), colX.chegada, y + 5.2)
    pdf.text(fmtHora(c.hora_inicio_descarga), colX.inicio, y + 5.2)
    pdf.text(fmtHora(c.hora_fim_descarga), colX.fim, y + 5.2)
    y += 8
  }
```

- [ ] **Step 4: Build e teste manual**

```bash
npm run build
```

Testar no navegador como admin: abrir uma concretagem finalizada com pelo menos 1 caminhão
(usar o caminhão lançado no teste manual da Task 2), clicar "🖨️ Imprimir PDF". Confirmar no PDF
gerado:
- Coluna LACRE aparece entre AMOSTRA e VOL. (M³), com o valor lançado.
- Colunas de horário mostram só `HH:mm` (ex.: "08:00"), sem data.
- Coluna SLUMP SOL./MED. mostra o formato `"12±2 / 13"` (ou `"12 / —"` se não tiver tolerância
  nem medido).
- Nenhuma coluna sobrepõe a seguinte visualmente (texto de uma coluna não invade o espaço da
  próxima) — se sobrepor, ajustar as larguras em `colX` do Step 2 antes de prosseguir.

- [ ] **Step 5: Commit**

```bash
git add src/lib/controleTecnologicoPdf.ts
git commit -m "feat: coluna de lacre, horario so-hora e slump com tolerancia no PDF do Controle Tecnologico"
```
