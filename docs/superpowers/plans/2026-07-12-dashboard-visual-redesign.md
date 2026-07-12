# Dashboard — Repaginação Visual Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repaginar `src/pages/Dashboard.tsx` para o visual aprovado no protótipo de 12/07/2026 — card-herói com prazo/semana/dias restantes, 4 KPI-pílulas clicáveis, um widget único "RDO de hoje", grupo novo "Suprimentos" (Compras+Almoxarifado) na grade de módulos, e uma nota discreta de módulos em preparação.

**Architecture:** Mudança contida em dois arquivos (`Dashboard.tsx` + `Dashboard.module.css`), sem migração de banco. Duas contagens novas (pedidos aguardando aprovação, pendências abertas) são somadas às duas queries que já existem no componente (ferramentas em atraso, chamada do dia). O widget de RDO reaproveita o padrão de `Galeria.tsx` para gerar URL assinada de foto (`supabase.storage.from('rdo').createSignedUrl(...)`).

**Tech Stack:** React + TypeScript + Vite, Supabase JS client, CSS Modules. Sem framework de teste automatizado neste projeto (não há vitest/jest configurado) — a verificação de cada tarefa é manual, rodando o servidor de desenvolvimento e conferindo no navegador, seguindo o padrão de "teste guiado" já usado nas fases anteriores (`docs/faseN.md`).

## Global Constraints

- Paleta e tipografia exclusivamente via os tokens já existentes em `src/styles/tokens.css` (`--navy`, `--navy-light`, `--terracota`, `--azul-gelo`, `--nude`, `--font-titulo`, `--font-corpo`) — nenhuma cor nova é introduzida.
- Nenhuma tabela, coluna ou migração de banco nova. Todas as queries usam tabelas/colunas já existentes em `src/lib/supabase.ts`.
- Toda visibilidade de KPI/widget/card respeita as permissões já existentes (`temModulo`, `perfil?.papel`) — nenhum dado aparece para quem não tem o módulo habilitado.
- Ícones de módulo: SVG inline com `stroke="currentColor" stroke-width="1.8"`, sem depender de nenhuma lib de ícones externa (projeto não tem uma instalada).
- Cliente (papel `cliente`) deve continuar vendo o Dashboard normalmente (RDO, avanço) e continuar sem ver os módulos que já são ocultos para ele hoje (ferramentas em atraso, chamada de efetivo) — não alterar essas regras de visibilidade.

---

## Arquivos afetados

- Modificar: `src/pages/Dashboard.tsx` — lógica de dados (hero, KPIs, widget RDO) e JSX.
- Modificar: `src/pages/Dashboard.module.css` — todas as classes novas do redesenho; classes obsoletas (`.boas_vindas`, `.bannerAlerta`, `.bannerInfo`, `.obraCard` e afins, `.cardIcon` emoji-sized) são removidas ao final da Tarefa 5.
- Nenhum outro arquivo é tocado. `App.tsx` e as rotas continuam iguais.

---

### Task 1: Card-herói com prazo/semana/dias restantes

**Files:**
- Modify: `src/pages/Dashboard.tsx:1-160` (imports, helpers, JSX de topo)
- Modify: `src/pages/Dashboard.module.css` (adiciona bloco `.hero`)

**Interfaces:**
- Consumes: `obra: Obra | null` de `useObra()` (já existe), campos `obra.data_inicio`, `obra.data_fim_prevista` (`string | null`, formato `YYYY-MM-DD`), `diasEntre(isoInicio, isoFim): number` e `dataHoje(): string` de `../lib/almoxarifado`.
- Produces: função `calcularSemana(dataInicio: string, dataFimPrevista: string): { atual: number; total: number }` usada só dentro deste arquivo (não exportada).

- [ ] **Step 1: Adicionar o helper de cálculo de semana no topo do arquivo**

Em `src/pages/Dashboard.tsx`, logo abaixo da linha `import styles from './Dashboard.module.css'` (linha 7), adicionar:

```tsx
function calcularSemana(dataInicio: string, dataFimPrevista: string): { atual: number; total: number } {
  const hoje = dataHoje()
  const diasDesdeInicio = diasEntre(dataInicio, hoje)
  const diasTotais = diasEntre(dataInicio, dataFimPrevista)
  const atual = Math.max(1, Math.floor(diasDesdeInicio / 7) + 1)
  const total = Math.max(atual, Math.ceil(diasTotais / 7))
  return { atual, total }
}

function formatarDataExtenso(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString('pt-BR', {
    weekday: 'long', day: '2-digit', month: 'long',
  })
}
```

- [ ] **Step 2: Substituir o bloco de boas-vindas + obraCard pelo card-herói**

Localizar em `Dashboard.tsx` o bloco (linhas ~155-221 na versão atual):

```tsx
      <div className={styles.boas_vindas}>
        <h1>Olá, {perfil?.nome?.split(' ')[0]} 👋</h1>
        <p>Bem-vindo ao painel de gestão de obra da RT Engenharia.</p>
      </div>
```

... até o fechamento do `{obra && ( ... )}` do `obraCard` (não remover ainda os banners de alerta — isso é a Tarefa 3). Substituir apenas o trecho acima e o bloco `{obra && (<div className={styles.obraCard}>...</div>)}` por:

```tsx
      {obra && (
        <div className={styles.hero}>
          <div className={styles.heroData}>{formatarDataExtenso(dataHoje())}</div>
          <h1>Olá, {perfil?.nome?.split(' ')[0]}</h1>
          <div className={styles.heroObra}>{obra.nome} — {obra.cidade}{obra.cidade && obra.estado ? ' — ' : ''}{obra.estado}</div>
          {obra.data_inicio && obra.data_fim_prevista && (
            <div className={styles.heroMetricas}>
              <div className={styles.heroMet}>
                <div className={styles.heroLab}>Prazo</div>
                <div className={styles.heroVal}>{new Date(obra.data_fim_prevista + 'T00:00:00').toLocaleDateString('pt-BR')}</div>
              </div>
              <div className={styles.heroMet}>
                <div className={styles.heroLab}>Semana</div>
                <div className={styles.heroVal}>
                  {calcularSemana(obra.data_inicio, obra.data_fim_prevista).atual}/{calcularSemana(obra.data_inicio, obra.data_fim_prevista).total}
                </div>
              </div>
              <div className={styles.heroMet}>
                <div className={styles.heroLab}>Restam</div>
                <div className={styles.heroVal}>{Math.max(0, diasEntre(dataHoje(), obra.data_fim_prevista))}d</div>
              </div>
            </div>
          )}
        </div>
      )}
```

Manter os banners de ferramenta/chamada e a seção `<h2 className={styles.secaoTitulo}>Módulos</h2>` e a grade abaixo intocados por enquanto — eles são tratados nas Tarefas 3 e 5.

- [ ] **Step 3: Adicionar o CSS do card-herói**

Em `src/pages/Dashboard.module.css`, remover as regras `.boas_vindas`, `.boas_vindas h1`, `.boas_vindas p`, `.obraCard`, `.obraHeader`, `.obraLabel`, `.obraNome`, `.obraEndereco`, `.obraBadge`, `.obraStats`, `.stat`, `.statNum`, `.statLabel` (linhas 6-144 do arquivo atual) e substituir por:

```css
.hero {
  background: linear-gradient(135deg, var(--navy) 0%, var(--navy-dark) 100%);
  color: var(--branco);
  border-radius: var(--radius-lg);
  padding: 24px 24px 20px;
  margin-bottom: 20px;
  box-shadow: var(--sombra-md);
}

.heroData {
  font-size: 12px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--azul-gelo);
  font-weight: 500;
}

.hero h1 {
  font-family: var(--font-titulo);
  font-weight: 700;
  font-size: 24px;
  margin: 6px 0 2px;
}

.heroObra {
  font-size: 13.5px;
  color: rgba(255, 255, 255, 0.75);
}

.heroMetricas {
  display: flex;
  gap: 0;
  margin-top: 18px;
  border-top: 1px solid rgba(255, 255, 255, 0.18);
  padding-top: 14px;
}

.heroMet {
  flex: 1;
  min-width: 0;
}

.heroMet + .heroMet {
  border-left: 1px solid rgba(255, 255, 255, 0.18);
  padding-left: 14px;
}

.heroLab {
  font-size: 10.5px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--azul-gelo);
  font-weight: 500;
}

.heroVal {
  font-family: var(--font-titulo);
  font-weight: 600;
  font-size: 17px;
  margin-top: 3px;
  font-variant-numeric: tabular-nums;
}
```

- [ ] **Step 4: Verificar visualmente**

Rodar `npm run dev`, abrir a rota `/` logado com um usuário de teste, confirmar que aparece o card navy com data por extenso, "Olá, {nome}", nome da obra e as 3 métricas (Prazo / Semana / Restam) alinhadas horizontalmente com divisórias verticais.

- [ ] **Step 5: Commit**

```bash
git add src/pages/Dashboard.tsx src/pages/Dashboard.module.css
git commit -m "Dashboard: card-herói com prazo, semana e dias restantes"
```

---

### Task 2: Contagens novas — pedidos aguardando aprovação e pendências abertas

**Files:**
- Modify: `src/pages/Dashboard.tsx` (novos `useState`/`useEffect`)

**Interfaces:**
- Consumes: `supabase` de `../lib/supabase`, `temModulo` de `useAuth()`, `obra` de `useObra()` (já disponíveis no componente).
- Produces: estados `pedidosAguardando: number` e `pendenciasAbertas: number`, consumidos na Tarefa 3.

- [ ] **Step 1: Adicionar os dois novos estados**

Logo abaixo de `const [chamadaHoje, setChamadaHoje] = useState<ChamadaHoje | null>(null)` (linha 76 do arquivo atual), adicionar:

```tsx
  const [pedidosAguardando, setPedidosAguardando] = useState(0)
  const [pendenciasAbertas, setPendenciasAbertas] = useState(0)
```

- [ ] **Step 2: Adicionar o `useEffect` de pedidos aguardando aprovação**

Logo após o `useEffect` que calcula `ferramentasAtraso` (fecha na linha 123 do arquivo atual, `}, [obra, vePainelAlmoxarifado])`), adicionar:

```tsx
  const veCompras = perfil?.papel !== 'cliente' && temModulo('compras')

  useEffect(() => {
    if (!obra || !veCompras) {
      setPedidosAguardando(0)
      return
    }
    supabase.from('pedidos_compra')
      .select('id', { count: 'exact', head: true })
      .eq('obra_id', obra.id)
      .eq('status', 'em_cotacao')
      .eq('ativo', true)
      .then(({ count }) => setPedidosAguardando(count ?? 0))
  }, [obra, veCompras])
```

- [ ] **Step 3: Adicionar o `useEffect` de pendências abertas**

Logo após o bloco do Step 2, adicionar:

```tsx
  const vePendencias = perfil?.papel !== 'cliente' && temModulo('pendencias')

  useEffect(() => {
    if (!obra || !vePendencias) {
      setPendenciasAbertas(0)
      return
    }
    supabase.from('pendencias')
      .select('id', { count: 'exact', head: true })
      .eq('obra_id', obra.id)
      .in('status', ['aberta', 'em_correcao'])
      .eq('ativo', true)
      .then(({ count }) => setPendenciasAbertas(count ?? 0))
  }, [obra, vePendencias])
```

- [ ] **Step 4: Verificar no navegador**

Com o dev server rodando, abrir o React DevTools (ou um `console.log` temporário) e confirmar que `pedidosAguardando` e `pendenciasAbertas` batem com a contagem real de registros no Supabase (comparar com a tela `/compras` filtrando "Em cotação" e `/pendencias` filtrando abertas). Remover qualquer `console.log` de depuração antes do commit.

- [ ] **Step 5: Commit**

```bash
git add src/pages/Dashboard.tsx
git commit -m "Dashboard: contagens de pedidos aguardando aprovação e pendências abertas"
```

---

### Task 3: KPI-pílulas clicáveis (substituem os banners de texto)

**Files:**
- Modify: `src/pages/Dashboard.tsx` (remove banners antigos, adiciona grade de KPIs)
- Modify: `src/pages/Dashboard.module.css` (remove `.bannerAlerta`/`.bannerInfo`/`.bannerIcon`/`.bannerTexto*`, adiciona `.kpis`/`.kpi*`)

**Interfaces:**
- Consumes: `ferramentasAtraso: FerramentaAtraso[]`, `chamadaHoje: ChamadaHoje | null`, `pedidosAguardando: number`, `pendenciasAbertas: number` (Tarefas anteriores), `veCompras`, `vePendencias`, `veEfetivo` (booleans já existentes/adicionados).
- Produces: nenhuma interface nova para tarefas seguintes — é a camada de apresentação final desses dados.

- [ ] **Step 1: Remover os dois banners JSX atuais**

Remover completamente este bloco de `Dashboard.tsx` (banners de ferramenta atrasada e chamada de hoje, logo depois do card-herói):

```tsx
      {ferramentasAtraso.length > 0 && (
        <button className={styles.bannerAlerta} onClick={() => navigate('/almoxarifado')}>
          ...
        </button>
      )}

      {chamadaHoje && !chamadaHoje.feita && (
        <button className={styles.bannerInfo} onClick={() => navigate('/efetivo')}>
          ...
        </button>
      )}

      {chamadaHoje?.feita && (
        <button className={styles.bannerInfo} onClick={() => navigate('/efetivo')}>
          ...
        </button>
      )}
```

- [ ] **Step 2: Adicionar a grade de KPI-pílulas no lugar**

No mesmo ponto (logo após o `</div>` de fechamento do `.hero`), adicionar:

```tsx
      <div className={styles.kpis}>
        {veEfetivo && chamadaHoje && (
          <button className={`${styles.kpi} ${styles.kpiEfetivo}`} onClick={() => navigate('/efetivo')}>
            <div className={styles.kpiNum}>{chamadaHoje.presentes}<span className={styles.kpiNumSub}>/{chamadaHoje.total}</span></div>
            <div className={styles.kpiLab}>Efetivo hoje</div>
            <div className={styles.kpiDet}>{chamadaHoje.feita ? 'chamada feita' : 'chamada não feita'}</div>
          </button>
        )}
        {veCompras && (
          <button className={`${styles.kpi} ${styles.kpiPedidos}`} onClick={() => navigate('/compras')}>
            <div className={styles.kpiNum}>{pedidosAguardando}</div>
            <div className={styles.kpiLab}>Pedidos</div>
            <div className={styles.kpiDet}>aguardando aprovação</div>
          </button>
        )}
        {vePendencias && (
          <button className={`${styles.kpi} ${styles.kpiPend}`} onClick={() => navigate('/pendencias')}>
            <div className={styles.kpiNum}>{pendenciasAbertas}</div>
            <div className={styles.kpiLab}>Pendências</div>
            <div className={styles.kpiDet}>abertas na obra</div>
          </button>
        )}
        {ferramentasAtraso.length > 0 && (
          <button className={`${styles.kpi} ${styles.kpiAlerta}`} onClick={() => navigate('/almoxarifado')}>
            <div className={styles.kpiNum}>{ferramentasAtraso.length}</div>
            <div className={styles.kpiLab}>Ferramenta{ferramentasAtraso.length > 1 ? 's' : ''}</div>
            <div className={styles.kpiDet}>não devolvida{ferramentasAtraso.length > 1 ? 's' : ''} — {ferramentasAtraso[0].nomeFerramenta}{ferramentasAtraso.length > 1 ? ` e mais ${ferramentasAtraso.length - 1}` : ''}</div>
          </button>
        )}
      </div>
```

- [ ] **Step 3: Remover o CSS dos banners antigos**

Em `Dashboard.module.css`, remover as regras `.bannerAlerta`, `.bannerAlerta:hover`, `.bannerIcon`, `.bannerTexto`, `.bannerInfo`, `.bannerInfo:hover`, `.bannerTextoInfo`.

- [ ] **Step 4: Adicionar o CSS das KPI-pílulas**

```css
.kpis {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
  margin-bottom: 24px;
}

@media (min-width: 640px) {
  .kpis {
    grid-template-columns: repeat(4, 1fr);
  }
}

.kpi {
  border: 1.5px solid transparent;
  border-radius: var(--radius-md);
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  box-shadow: var(--sombra-sm);
  cursor: pointer;
  text-align: left;
  font-family: inherit;
  transition: transform 0.12s;
}

.kpi:hover {
  transform: translateY(-2px);
}

.kpiNum {
  font-family: var(--font-titulo);
  font-weight: 700;
  font-size: 22px;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}

.kpiNumSub {
  font-size: 14px;
  font-weight: 600;
}

.kpiLab {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.kpiDet {
  font-size: 11.5px;
  opacity: 0.75;
}

.kpiEfetivo { background: var(--azul-gelo); color: var(--navy); }
.kpiPedidos { background: var(--navy); color: var(--branco); }
.kpiPend { background: var(--branco); color: var(--navy); border-color: var(--cinza-200); }
.kpiAlerta { background: var(--terracota); color: var(--branco); }
```

- [ ] **Step 5: Verificar no navegador**

Confirmar que: (a) as pílulas aparecem só para quem tem o módulo correspondente habilitado (testar com um usuário sem `compras`, por exemplo — a pílula "Pedidos" não deve aparecer); (b) clicar em cada pílula navega para a rota certa; (c) a pílula "Ferramenta" só aparece quando existe empréstimo em atraso.

- [ ] **Step 6: Commit**

```bash
git add src/pages/Dashboard.tsx src/pages/Dashboard.module.css
git commit -m "Dashboard: banners viram KPI-pílulas clicáveis"
```

---

### Task 4: Widget "RDO de hoje"

**Files:**
- Modify: `src/pages/Dashboard.tsx` (novo estado + query + JSX)
- Modify: `src/pages/Dashboard.module.css` (novo bloco `.widget*`)

**Interfaces:**
- Consumes: `Rdo`, `RdoFoto` de `../lib/supabase`; padrão `supabase.storage.from('rdo').createSignedUrl(path, 3600)` usado em `src/pages/Galeria.tsx:99`.
- Produces: estado `rdoHoje: RdoHojeResumo | null`, usado só neste arquivo.

- [ ] **Step 1: Adicionar o tipo e o import necessário**

No topo de `Dashboard.tsx`, ajustar o import de `../lib/supabase` (linha 5 atual) para incluir os tipos usados:

```tsx
import { supabase, type Unidade, type Rdo } from '../lib/supabase'
```

Logo abaixo da interface `ChamadaHoje` (linha ~20 atual), adicionar:

```tsx
interface RdoHojeResumo {
  status: Rdo['status']
  climaManha: Rdo['clima_manha']
  climaTarde: Rdo['clima_tarde']
  fotos: { url: string; legenda: string | null }[]
}
```

- [ ] **Step 2: Adicionar o estado e o `useEffect` de busca**

Logo abaixo do `const [pendenciasAbertas, setPendenciasAbertas] = useState(0)` (adicionado na Tarefa 2), adicionar:

```tsx
  const [rdoHoje, setRdoHoje] = useState<RdoHojeResumo | null>(null)
  const veRdo = temModulo('rdo')

  useEffect(() => {
    if (!obra || !veRdo) {
      setRdoHoje(null)
      return
    }
    supabase.from('rdos').select('id, status, clima_manha, clima_tarde')
      .eq('obra_id', obra.id).eq('data', dataHoje()).eq('ativo', true).maybeSingle()
      .then(async ({ data: rdo }) => {
        if (!rdo) {
          setRdoHoje(null)
          return
        }
        const { data: fotos } = await supabase.from('rdo_fotos')
          .select('path, legenda, capturada_em')
          .eq('rdo_id', rdo.id).eq('ativo', true)
          .order('capturada_em', { ascending: false })
          .limit(2)
        const fotosComUrl = await Promise.all(
          (fotos ?? []).map(async f => {
            const { data } = await supabase.storage.from('rdo').createSignedUrl(f.path, 3600)
            return { url: data?.signedUrl ?? '', legenda: f.legenda }
          })
        )
        setRdoHoje({
          status: rdo.status,
          climaManha: rdo.clima_manha,
          climaTarde: rdo.clima_tarde,
          fotos: fotosComUrl.filter(f => f.url),
        })
      })
  }, [obra, veRdo])
```

- [ ] **Step 3: Adicionar a seção JSX do widget**

Logo após o `</div>` de fechamento de `.kpis` (Tarefa 3) e antes de `<h2 className={styles.secaoTitulo}>Módulos</h2>`, adicionar:

```tsx
      {veRdo && (
        <>
          <h2 className={styles.secaoTitulo}>RDO de hoje</h2>
          {rdoHoje ? (
            <div className={styles.widget}>
              <div className={styles.widgetHead}>
                <b>Relatório Diário</b>
                <span className={`${styles.widgetBadge} ${rdoHoje.status === 'assinado' ? styles.badgeOk : styles.badgeRascunho}`}>
                  {rdoHoje.status === 'assinado' ? 'Assinado' : 'Rascunho'}
                </span>
              </div>
              {(rdoHoje.climaManha || rdoHoje.climaTarde) && (
                <div className={styles.widgetClima}>
                  {rdoHoje.climaManha && <span>Manhã: <b>{rdoHoje.climaManha}</b></span>}
                  {rdoHoje.climaTarde && <span>Tarde: <b>{rdoHoje.climaTarde}</b></span>}
                </div>
              )}
              {rdoHoje.fotos.length > 0 && (
                <div className={styles.widgetFotos}>
                  {rdoHoje.fotos.map((f, i) => (
                    <img key={i} src={f.url} alt={f.legenda ?? 'Foto do RDO'} className={styles.widgetFoto} />
                  ))}
                </div>
              )}
              <button className={styles.widgetVer} onClick={() => navigate('/rdo')}>Abrir RDO →</button>
            </div>
          ) : (
            <div className={styles.widget}>
              <p className={styles.widgetVazio}>Nenhum RDO lançado hoje ainda.</p>
              <button className={styles.widgetVer} onClick={() => navigate('/rdo')}>Lançar RDO →</button>
            </div>
          )}
        </>
      )}
```

- [ ] **Step 4: Adicionar o CSS do widget**

```css
.widget {
  background: var(--branco);
  border-radius: var(--radius-lg);
  padding: 18px;
  box-shadow: var(--sombra-sm);
  max-width: 560px;
  margin-bottom: 32px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.widgetHead {
  display: flex;
  align-items: center;
  gap: 10px;
}

.widgetHead b {
  font-family: var(--font-titulo);
  font-weight: 600;
  font-size: 14.5px;
}

.widgetBadge {
  margin-left: auto;
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  padding: 3px 9px;
  border-radius: 999px;
}

.badgeRascunho { background: #fdf3e3; color: #a06b10; }
.badgeOk { background: #e6f4ec; color: var(--sucesso); }

.widgetClima {
  display: flex;
  gap: 14px;
  font-size: 12.5px;
  color: var(--cinza-800);
}

.widgetFotos {
  display: flex;
  gap: 8px;
}

.widgetFoto {
  flex: 1;
  height: 90px;
  border-radius: var(--radius-sm);
  object-fit: cover;
}

.widgetVer {
  align-self: flex-start;
  font-size: 13px;
  font-weight: 600;
  color: var(--navy-light);
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
  font-family: inherit;
}

.widgetVer:hover {
  text-decoration: underline;
}

.widgetVazio {
  font-size: 13px;
  color: var(--cinza-600);
}
```

- [ ] **Step 5: Verificar no navegador**

Com um RDO de hoje já lançado em ambiente de teste (rascunho, com pelo menos 1 foto), confirmar que o widget mostra o clima e a foto corretamente (a imagem deve carregar — se aparecer quebrada, checar se o bucket `rdo` e o `path` salvo batem com o usado em `Galeria.tsx`). Testar também o caso sem RDO lançado (mensagem "Nenhum RDO lançado hoje ainda").

- [ ] **Step 6: Commit**

```bash
git add src/pages/Dashboard.tsx src/pages/Dashboard.module.css
git commit -m "Dashboard: widget RDO de hoje com clima e fotos"
```

---

### Task 5: Grupo Suprimentos, chips verticais e nota de módulos em preparação

**Files:**
- Modify: `src/pages/Dashboard.tsx` (array `CARDS_MODULOS`, `subLista`/`subBtn` JSX, nova nota de rodapé)
- Modify: `src/pages/Dashboard.module.css` (novo estilo `.subLista`/`.subBtn`, novo `.futuro`)

**Interfaces:**
- Consumes: array `CARDS_MODULOS: CardModulo[]` já existente (linha 40-67 do arquivo original).
- Produces: nenhuma — última tarefa do redesenho.

- [ ] **Step 1: Substituir o array `CARDS_MODULOS`**

Substituir o array inteiro (linhas 40-67 do arquivo original) por:

```tsx
const CARDS_MODULOS: CardModulo[] = [
  {
    key: 'avanco', label: 'Avanço Físico', icon: '📊', desc: 'Cronograma e progresso da obra',
    subs: [
      { label: 'Cronograma', icon: '📅', path: '/cronograma', sempre: true },
      { label: 'Lançar avanço', icon: '✏️', path: '/avanco' },
    ],
  },
  {
    key: 'rdo', label: 'RDO', icon: '📋', desc: 'Relatório diário, galeria e efetivo',
    subs: [
      { label: 'Relatório Diário', icon: '📋', path: '/rdo' },
      { label: 'Galeria de Fotos', icon: '🖼️', path: '/galeria', sempre: true },
      { label: 'Efetivo', icon: '👷', path: '/efetivo', moduloKey: 'efetivo' },
    ],
  },
  {
    key: 'suprimentos', label: 'Suprimentos', icon: '📦', desc: 'Compras e almoxarifado',
    multiKey: ['compras', 'almoxarifado'],
    subs: [
      { label: 'Compras', icon: '🛒', path: '/compras', moduloKey: 'compras' },
      { label: 'Almoxarifado', icon: '📦', path: '/almoxarifado', moduloKey: 'almoxarifado' },
    ],
  },
  {
    key: 'qualidade', label: 'Qualidade', icon: '🏷️', desc: 'FVS, checklists e pendências de obra',
    multiKey: ['fvs', 'pendencias'],
    subs: [
      { label: 'FVS / Checklists', icon: '✅', path: '/fvs', moduloKey: 'fvs' },
      { label: 'Pendências', icon: '⚠️', path: '/pendencias', moduloKey: 'pendencias' },
    ],
  },
]
```

(O card `financeiro` do array original é removido — a Fase 3 ainda não foi construída e passa a aparecer só na nota de rodapé do Step 3 abaixo.)

- [ ] **Step 2: Trocar o estilo de `.subLista`/`.subBtn` para lista vertical maior**

Em `Dashboard.module.css`, substituir as regras `.subLista` e `.subBtn`/`.subBtn:hover` (linhas 221-249 do arquivo original) por:

```css
.subLista {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 10px;
  border-top: 1px solid var(--cinza-100);
  padding-top: 10px;
}

.subBtn {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 11px 14px;
  border: 1px solid var(--cinza-200);
  border-radius: var(--radius-sm);
  background: var(--nude);
  font-size: 14px;
  font-weight: 500;
  color: var(--navy);
  cursor: pointer;
  text-align: left;
}

.subBtn::after {
  content: '›';
  color: var(--cinza-600);
  font-size: 16px;
}

.subBtn:hover {
  background: var(--azul-gelo);
}
```

O JSX que renderiza `.subLista`/`.subBtn` (dentro do `.map(m => ...)` da grade de módulos) não muda — só o CSS.

- [ ] **Step 3: Adicionar a nota de módulos em preparação**

Logo antes da linha `<p className={styles.versao}>...</p>` (fim do arquivo original), adicionar:

```tsx
      <div className={styles.futuro}>
        <b>Em preparação:</b> Financeiro (Fase 3), Medições, Definições de Projeto, Projetos, Planejamento (lookahead/PPC) e Tarefas.
      </div>
```

- [ ] **Step 4: Adicionar o CSS da nota**

```css
.futuro {
  margin-top: 8px;
  margin-bottom: 16px;
  font-size: 12.5px;
  color: var(--cinza-600);
  background: rgba(26, 50, 72, 0.04);
  border: 1px dashed var(--cinza-200);
  border-radius: var(--radius-md);
  padding: 10px 14px;
}

.futuro b {
  color: var(--terracota-dark);
}
```

- [ ] **Step 5: Verificar no navegador**

Confirmar que: (a) o card "Suprimentos" aparece ativo para um usuário com `compras` OU `almoxarifado` habilitado (mesma regra `multiKey` que já existe no código, reaproveitada); (b) expandir o card mostra "Compras" e "Almoxarifado" como linhas verticais com seta `›`; (c) não existe mais nenhum card "Financeiro" na grade; (d) a nota tracejada aparece no rodapé, acima da linha de versão.

- [ ] **Step 6: Commit**

```bash
git add src/pages/Dashboard.tsx src/pages/Dashboard.module.css
git commit -m "Dashboard: grupo Suprimentos, chips verticais e nota de módulos em preparação"
```

---

## Verificação final (todas as tarefas concluídas)

- [ ] Rodar `npm run build` e confirmar que o TypeScript compila sem erro (`tsc -b`).
- [ ] Testar o Dashboard logado como `admin`, como `equipe` com módulos parciais, e como `cliente` — confirmar que cada papel só vê os KPIs/widgets/cards permitidos, igual ao comportamento anterior ao redesenho (nenhuma regra de permissão deve ter mudado, só o visual).
- [ ] Testar em viewport mobile (375px) e desktop (1280px) no navegador — confirmar que os KPIs quebram em 2 colunas no mobile e 4 no desktop, e que não há scroll horizontal.
- [ ] Comparar lado a lado com o protótipo aprovado (Artifact `dashboard-rt.html`, v3) para conferir fidelidade visual.
