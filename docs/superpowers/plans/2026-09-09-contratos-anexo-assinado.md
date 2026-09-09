# Contratos — Anexo do documento assinado Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir anexar um ou mais documentos (contrato assinado, aditivos) a um contrato de
empreiteiro, a qualquer momento do ciclo de vida do contrato, com histórico de quem anexou e
quando, e remoção sempre reversível (soft delete).

**Architecture:** Tabela nova `contratos_anexos` (lista simples, sem conceito de versão) +
bucket privado `contratos-assinados` no Supabase Storage, path `{obra_id}/{contrato_id}/{uuid}-
{nome}` — mesmo padrão já usado e testado em produção nos buckets `rdo`/`fvs`/`pendencias`/
`projetos` (isolamento por obra no primeiro segmento do caminho). Frontend inteiro dentro de
`DetalheContrato` em `ContratoForm.tsx`, reaproveitando o padrão de upload/URL assinada já usado
em `CompraForm.tsx` (anexo de cotação) e o padrão de confirmação de remoção já usado no próprio
`ContratoForm.tsx` (`encerrarContrato`).

**Tech Stack:** Supabase (Postgres + RLS + Storage) + React 19 + TypeScript + Vite. Sem
framework de testes no projeto — verificação por SQL direto e `npm run build` + teste manual no
navegador.

## Global Constraints

- Toda mudança de schema precisa de migração versionada em `supabase/migrations` (nunca
  alteração manual em produção).
- Remoção de anexo é sempre soft delete (`ativo = false` + `removido_por`/`removido_em`) —
  nunca apaga a linha nem o arquivo do Storage (CLAUDE.md §6).
- Regra de RLS pra soft delete (CLAUDE.md §3): a policy de SELECT da tabela precisa
  `USING ((ativo = true AND ...) OR pode_editar_contratos())`, nunca só `ativo = true` — senão a
  inativação falha silenciosamente mesmo pra admin.
- Anexar/remover: `pode_editar_contratos()` (admin, ou equipe com módulo `contratos`).
  Visualizar: qualquer admin/equipe (independente do módulo) — mesmo desenho já usado em
  `contratos_itens` (`ci_select` vs `ci_insert`, ver `supabase/migrations/20260713_fase7_contratos.sql:161-177`).
  Cliente não acessa nada do módulo Contratos — sem exceção nova.
- Formato aceito: PDF e imagem (JPG/PNG), até 25MB — mesmo limite já usado no bucket
  `producao-plantas` pra essa mesma combinação de formatos
  (`supabase/migrations/20260718_producao_plantas_paredes.sql:47`).
- **Achado durante o planejamento, fora do escopo desta spec**: nem `contratos` nem
  `contratos_itens` checam `pode_acessar_obra()` nas próprias policies de tabela hoje — a
  isolação real por obra do módulo Contratos depende só do papel (admin/equipe), não da obra
  específica. Esta migração **mantém esse mesmo desenho na tabela** (consistência com o
  restante da família Contratos) mas aplica isolamento por obra de verdade no **Storage**
  (arquivo em si), estendendo a policy `isolamento_obra_storage` já existente — mesmo padrão
  usado em `rdo`/`fvs`/`pendencias`/`projetos`. Vale reportar esse achado ao Rodrigo como
  possível trabalho futuro separado (não faz parte desta implementação).

---

### Task 1: Migração — tabela `contratos_anexos`, bucket e RLS

**Files:**
- Create: `supabase/migrations/20260909_contratos_anexos.sql`

**Interfaces:**
- Produces: tabela `contratos_anexos` (colunas: `id`, `contrato_id`, `arquivo_url`,
  `nome_original`, `descricao`, `ativo`, `criado_em`, `criado_por`, `removido_por`,
  `removido_em`); bucket `contratos-assinados`. Usados pela Task 2 (frontend).

- [ ] **Step 1: Escrever a migração**

Criar `supabase/migrations/20260909_contratos_anexos.sql`:

```sql
-- Contratos: anexo do documento assinado (contrato original + aditivos depois).
-- Ver docs/superpowers/specs/2026-09-09-contratos-anexo-assinado-design.md
-- Lista simples, sem conceito de versão — cada anexo é um registro permanente e
-- independente. Funciona em qualquer status do contrato (sem gating por contrato.status).

CREATE TABLE contratos_anexos (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contrato_id     UUID NOT NULL REFERENCES contratos(id),
  arquivo_url     TEXT NOT NULL,   -- caminho no bucket 'contratos-assinados'
  nome_original   TEXT NOT NULL,   -- nome do arquivo enviado, pra exibição
  descricao       TEXT,            -- opcional: "Contrato original", "Aditivo 1"...
  ativo           BOOLEAN NOT NULL DEFAULT true,
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
  criado_por      UUID NOT NULL DEFAULT auth.uid() REFERENCES perfis_usuario(id),
  removido_por    UUID REFERENCES perfis_usuario(id),
  removido_em     TIMESTAMPTZ
);

CREATE INDEX idx_contratos_anexos_contrato ON contratos_anexos(contrato_id);

ALTER TABLE contratos_anexos ENABLE ROW LEVEL SECURITY;

-- Mesmo desenho já usado em contratos_itens (ci_select/ci_insert): visualizar é liberado
-- pra qualquer admin/equipe; anexar/remover exige pode_editar_contratos(). Regra de soft
-- delete (CLAUDE.md §3): SELECT precisa do "OR pode_editar_contratos()" pra também
-- enxergar os anexos removidos, senão a inativação falha silenciosamente.
CREATE POLICY ca_select ON contratos_anexos FOR SELECT
  USING ((ativo = true AND meu_papel() = ANY (ARRAY['admin', 'equipe']::papel_usuario[])) OR pode_editar_contratos());
CREATE POLICY ca_insert ON contratos_anexos FOR INSERT
  WITH CHECK (pode_editar_contratos());
CREATE POLICY ca_update ON contratos_anexos FOR UPDATE
  USING (pode_editar_contratos())
  WITH CHECK (pode_editar_contratos());

-- Bucket privado. PDF ou foto, até 25MB — mesmo limite já usado em 'producao-plantas'
-- pra essa combinação de formatos.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('contratos-assinados', 'contratos-assinados', false, 26214400, ARRAY['application/pdf', 'image/*'])
ON CONFLICT (id) DO NOTHING;

-- Leitura liberada pra qualquer admin/equipe (mesma régua da tabela); escrita exige
-- pode_editar_contratos() — mesmo desenho já usado no bucket 'cotacoes-nf'.
CREATE POLICY ca_storage_select ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'contratos-assinados' AND meu_papel() IN ('admin', 'equipe'));
CREATE POLICY ca_storage_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'contratos-assinados' AND pode_editar_contratos());

-- Isolamento por obra no arquivo em si: caminho começa com o obra_id (mesmo padrão já
-- usado em rdo/fvs/pendencias/projetos) — estende a policy restritiva existente em vez
-- de criar uma nova, evitando duas RESTRICTIVE policies conflitando na mesma tabela.
DROP POLICY isolamento_obra_storage ON storage.objects;

CREATE POLICY isolamento_obra_storage ON storage.objects AS RESTRICTIVE FOR ALL TO authenticated
USING (
  bucket_id NOT IN ('rdo','fvs','pendencias','cotacoes-nf','projetos','contratos-assinados')
  OR CASE
    WHEN bucket_id IN ('rdo','fvs','pendencias','projetos','contratos-assinados') THEN
      split_part(name,'/',1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      AND pode_acessar_obra(split_part(name,'/',1)::UUID)
    WHEN bucket_id = 'cotacoes-nf' THEN
      split_part(name,'/',1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      AND EXISTS (
        SELECT 1 FROM pedidos_compra p
        WHERE p.id=split_part(name,'/',1)::UUID AND pode_acessar_obra(p.obra_id)
      )
    ELSE false
  END
)
WITH CHECK (
  bucket_id NOT IN ('rdo','fvs','pendencias','cotacoes-nf','projetos','contratos-assinados')
  OR CASE
    WHEN bucket_id IN ('rdo','fvs','pendencias','projetos','contratos-assinados') THEN
      split_part(name,'/',1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      AND pode_acessar_obra(split_part(name,'/',1)::UUID)
    WHEN bucket_id = 'cotacoes-nf' THEN
      split_part(name,'/',1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      AND EXISTS (
        SELECT 1 FROM pedidos_compra p
        WHERE p.id=split_part(name,'/',1)::UUID AND pode_acessar_obra(p.obra_id)
      )
    ELSE false
  END
);
```

- [ ] **Step 2: Aplicar a migração**

Aplicar via `mcp__claude_ai_Supabase__apply_migration` (project_id `yxshldsfmbmbzdkcymca`, nome
`contratos_anexos`).

- [ ] **Step 3: Verificar**

```sql
SELECT column_name, is_nullable FROM information_schema.columns WHERE table_name = 'contratos_anexos';
-- Esperado: id, contrato_id, arquivo_url, nome_original (NOT NULL as 4); descricao,
-- removido_por, removido_em (nullable); ativo NOT NULL default true; criado_em/criado_por NOT NULL

SELECT id, public, file_size_limit, allowed_mime_types FROM storage.buckets WHERE id = 'contratos-assinados';
-- Esperado: public=false, file_size_limit=26214400, allowed_mime_types={application/pdf,image/*}

SELECT policyname FROM pg_policies WHERE tablename = 'contratos_anexos';
-- Esperado: ca_select, ca_insert, ca_update

SELECT policyname FROM pg_policies WHERE tablename = 'objects' AND schemaname = 'storage'
  AND policyname IN ('ca_storage_select', 'ca_storage_insert', 'isolamento_obra_storage');
-- Esperado: as 3

-- Confirma que a policy restritiva ainda cobre os buckets antigos (regressão) e o novo:
SELECT pg_get_expr(polqual, polrelid) FROM pg_policy WHERE polname = 'isolamento_obra_storage';
-- Esperado: string contendo 'contratos-assinados' junto com 'rdo','fvs','pendencias','projetos'
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260909_contratos_anexos.sql
git commit -m "feat: adiciona tabela e bucket para anexo de contrato assinado"
```

---

### Task 2: Frontend — bloco "Documentos assinados" no Contrato

**Files:**
- Modify: `src/lib/supabase.ts` (novo tipo `ContratoAnexo`)
- Modify: `src/pages/ContratoForm.tsx`
- Modify: `src/pages/ContratoForm.module.css`

**Interfaces:**
- Consumes: tabela/bucket da Task 1; `useConfirmDialog()` (`confirmar()`, já usado em
  `encerrarContrato`, `ContratoForm.tsx:323,431`); função `pode_editar_contratos()` via RLS
  (nenhuma chamada direta no frontend — a UI só usa a prop `podeEditar` já existente).

- [ ] **Step 1: Adicionar o tipo `ContratoAnexo` em `src/lib/supabase.ts`**

Logo depois da interface `ContratoItem` (que termina em `src/lib/supabase.ts:708`), adicionar:

```ts
export interface ContratoAnexo {
  id: string
  contrato_id: string
  arquivo_url: string
  nome_original: string
  descricao: string | null
  ativo: boolean
  criado_em: string
  criado_por: string
  removido_por: string | null
  removido_em: string | null
}
```

- [ ] **Step 2: Importar o tipo novo em `ContratoForm.tsx`**

Em `ContratoForm.tsx:5-8`, trocar:

```ts
import {
  supabase, type Servico, type Unidade, type Empreiteiro,
  type Contrato, type ContratoItem, type Medicao,
} from '../lib/supabase'
```

por:

```ts
import {
  supabase, type Servico, type Unidade, type Empreiteiro,
  type Contrato, type ContratoItem, type Medicao, type ContratoAnexo,
} from '../lib/supabase'
```

- [ ] **Step 3: Copiar o helper `nomeArquivoStorage` pro topo do arquivo**

`CompraForm.tsx:22-38` já tem essa função (sanitiza o nome do arquivo antes de subir pro
Storage — remove acento, troca espaço/caractere especial por hífen, limita tamanho). **Não
retranscreva o código manualmente** (a regex de acentos usa um range Unicode de marcas
diacríticas que é fácil de corromper ao copiar/colar) — abra `src/pages/CompraForm.tsx`, copie
as linhas 22-38 exatamente como estão, e cole em `ContratoForm.tsx` logo depois da função
`fmtData` (`ContratoForm.tsx:15-17`). Confirme com um `git diff` que a função colada é
byte-idêntica à original antes de seguir pro próximo step.

- [ ] **Step 4: Adicionar estado e carregamento dos anexos em `DetalheContrato`**

Em `ContratoForm.tsx`, logo depois do bloco de `medicoes` (que termina em `ContratoForm.tsx:345`
com o fechamento do `useEffect`), adicionar:

```ts
  const [anexos, setAnexos] = useState<ContratoAnexo[]>([])
  const [carregandoAnexos, setCarregandoAnexos] = useState(true)
  const [urlsAnexos, setUrlsAnexos] = useState<Map<string, string>>(new Map())
  const [nomesAutores, setNomesAutores] = useState<Map<string, string>>(new Map())
  const [mostrarFormAnexo, setMostrarFormAnexo] = useState(false)
  const [arquivoAnexo, setArquivoAnexo] = useState<File | null>(null)
  const [descricaoAnexo, setDescricaoAnexo] = useState('')
  const [enviandoAnexo, setEnviandoAnexo] = useState(false)
  const [msgAnexo, setMsgAnexo] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)

  async function carregarAnexos() {
    const { data } = await supabase.from('contratos_anexos').select('*')
      .eq('contrato_id', contrato.id).eq('ativo', true)
      .order('criado_em', { ascending: false })
    setAnexos(data ?? [])
    setCarregandoAnexos(false)
  }

  useEffect(() => { carregarAnexos() }, [contrato.id])

  useEffect(() => {
    let cancelado = false
    async function carregarUrls() {
      const novasUrls = new Map<string, string>()
      await Promise.all(anexos.map(async a => {
        const { data } = await supabase.storage.from('contratos-assinados').createSignedUrl(a.arquivo_url, 3600)
        if (data) novasUrls.set(a.arquivo_url, data.signedUrl)
      }))
      if (!cancelado) setUrlsAnexos(novasUrls)
    }
    carregarUrls()
    return () => { cancelado = true }
  }, [anexos])

  useEffect(() => {
    const ids = [...new Set(anexos.map(a => a.criado_por))]
    if (ids.length === 0) return
    supabase.from('perfis_usuario').select('id, nome').in('id', ids)
      .then(({ data }) => setNomesAutores(new Map((data ?? []).map(p => [p.id, p.nome]))))
  }, [anexos])
```

- [ ] **Step 5: Adicionar `enviarAnexo` e `removerAnexo`**

Logo depois da função `encerrarContrato` (`ContratoForm.tsx:430-444` na numeração atual, antes
do `return (`), adicionar:

```ts
  async function enviarAnexo() {
    if (!arquivoAnexo) {
      setMsgAnexo({ tipo: 'erro', texto: 'Escolha um arquivo.' })
      return
    }
    setEnviandoAnexo(true)
    setMsgAnexo(null)
    const path = `${contrato.obra_id}/${contrato.id}/${crypto.randomUUID()}-${nomeArquivoStorage(arquivoAnexo.name)}`
    const { error: eUp } = await supabase.storage.from('contratos-assinados').upload(path, arquivoAnexo)
    if (eUp) {
      setEnviandoAnexo(false)
      setMsgAnexo({ tipo: 'erro', texto: `Falha no envio do arquivo: ${eUp.message}` })
      return
    }
    const { error } = await supabase.from('contratos_anexos').insert({
      contrato_id: contrato.id,
      arquivo_url: path,
      nome_original: arquivoAnexo.name,
      descricao: descricaoAnexo.trim() || null,
    })
    setEnviandoAnexo(false)
    if (error) {
      setMsgAnexo({ tipo: 'erro', texto: `Falha ao registrar o anexo: ${error.message}` })
      return
    }
    setArquivoAnexo(null)
    setDescricaoAnexo('')
    setMostrarFormAnexo(false)
    carregarAnexos()
  }

  async function removerAnexo(anexo: ContratoAnexo) {
    if (!await confirmar({
      titulo: 'Remover anexo',
      mensagem: `Remover "${anexo.nome_original}"? O arquivo continua salvo, só sai da lista.`,
      confirmarTexto: 'Remover anexo',
      perigoso: true,
    })) return
    const { error } = await supabase.from('contratos_anexos').update({
      ativo: false, removido_por: perfilId, removido_em: new Date().toISOString(),
    }).eq('id', anexo.id)
    if (error) {
      setMsgAnexo({ tipo: 'erro', texto: `Erro ao remover: ${error.message}` })
      return
    }
    carregarAnexos()
  }
```

- [ ] **Step 6: Inserir o bloco JSX "Documentos assinados"**

Em `ContratoForm.tsx`, entre o fechamento do bloco de ativar/encerrar contrato e o `{msg && ...}`
(ou seja, logo antes de `ContratoForm.tsx:479`: `{msg && <p className={msg.tipo === 'ok' ...`),
adicionar:

```tsx
      <div className={styles.bloco}>
        <div className={styles.header} style={{ marginBottom: 10 }}>
          <h2 style={{ margin: 0 }}>Documentos assinados</h2>
          {podeEditar && (
            <button className={styles.btnSecundario} onClick={() => setMostrarFormAnexo(v => !v)}>
              {mostrarFormAnexo ? 'Cancelar' : '+ Anexar documento'}
            </button>
          )}
        </div>

        {mostrarFormAnexo && (
          <div className={styles.itemLinha}>
            <label className={styles.campo}>
              Arquivo (PDF ou foto) *
              <input type="file" accept="application/pdf,image/*" onChange={e => setArquivoAnexo(e.target.files?.[0] ?? null)} />
            </label>
            <label className={styles.campo}>
              Descrição (opcional)
              <input value={descricaoAnexo} onChange={e => setDescricaoAnexo(e.target.value)}
                placeholder="Ex.: Contrato original, Aditivo 1..." />
            </label>
            {msgAnexo && <p className={msgAnexo.tipo === 'ok' ? styles.msgOk : styles.msgErro}>{msgAnexo.texto}</p>}
            <button className={styles.btnPrincipal} onClick={enviarAnexo} disabled={enviandoAnexo}>
              {enviandoAnexo ? 'Enviando…' : 'Enviar'}
            </button>
          </div>
        )}

        {carregandoAnexos && <p className={styles.vazio}>Carregando…</p>}
        {!carregandoAnexos && anexos.length === 0 && !mostrarFormAnexo && (
          <p className={styles.vazio}>Nenhum documento anexado.</p>
        )}
        {anexos.map(a => (
          <div key={a.id} className={styles.anexoItem}>
            <div className={styles.anexoInfo}>
              <span className={styles.anexoNome}>{a.nome_original}</span>
              {a.descricao && <span className={styles.anexoDescricao}> — {a.descricao}</span>}
              <div className={styles.anexoMeta}>{nomesAutores.get(a.criado_por) ?? '—'} · {fmtData(a.criado_em)}</div>
            </div>
            <div className={styles.anexoAcoes}>
              {urlsAnexos.get(a.arquivo_url) && (
                <a className={styles.anexoLink} href={urlsAnexos.get(a.arquivo_url)} target="_blank" rel="noreferrer">📎 abrir</a>
              )}
              {podeEditar && (
                <button className={styles.btnRemoverAnexo} onClick={() => removerAnexo(a)}>Remover</button>
              )}
            </div>
          </div>
        ))}
      </div>

```

- [ ] **Step 7: Adicionar as classes CSS novas em `ContratoForm.module.css`**

Adicionar no fim do arquivo:

```css
.anexoItem {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 10px;
  padding: 8px 0;
  border-bottom: 1px solid var(--cinza-200);
}
.anexoItem:last-child { border-bottom: none; }

.anexoInfo { font-size: 13px; color: var(--cinza-800); }
.anexoNome { font-weight: 600; color: var(--navy); }
.anexoDescricao { color: var(--cinza-600); }
.anexoMeta { font-size: 11px; color: var(--cinza-600); margin-top: 2px; }

.anexoAcoes { display: flex; align-items: center; gap: 12px; flex: none; }

.anexoLink {
  font-size: 12px;
  font-weight: 600;
  color: var(--navy);
  text-decoration: none;
  white-space: nowrap;
}
.anexoLink:hover { text-decoration: underline; }

.btnRemoverAnexo {
  background: none;
  border: none;
  color: #a33030;
  font-size: 12px;
  cursor: pointer;
  text-decoration: underline;
  padding: 0;
  white-space: nowrap;
}

@media (max-width: 640px) {
  .anexoItem { flex-direction: column; align-items: flex-start; }
  .anexoAcoes { width: 100%; justify-content: flex-end; }
}
```

(`.anexoLink` é a mesma definição já usada em `CompraForm.module.css:202-210`, copiada aqui
porque cada tela tem seu próprio CSS Module — sem risco de colisão entre arquivos. O bloco
`@media` novo é independente do que já existe em `ContratoForm.module.css:199` — CSS permite
múltiplos blocos com a mesma condição, não precisa mexer no existente.)

- [ ] **Step 8: Build e teste manual**

```bash
npm run build
```

Testar no navegador como admin, no CT-001 (JFC, Tharsos Imperial):
1. Abrir o contrato, confirmar que o bloco "Documentos assinados" aparece entre os botões de
   ativar/encerrar e o bloco "Itens".
2. Clicar "+ Anexar documento", escolher um PDF pequeno de teste, preencher a descrição
   "Teste de anexo — apagar depois", enviar — confirmar que aparece na lista com seu nome e a
   data de hoje.
3. Clicar "📎 abrir" — confirmar que o PDF abre numa nova aba.
4. Clicar "Remover", confirmar no diálogo — confirmar que some da lista.
5. Verificar no banco que a linha continua existindo com `ativo = false`:
   ```sql
   SELECT nome_original, ativo, removido_por, removido_em FROM contratos_anexos
   WHERE contrato_id = 'cc2823c3-954a-44d9-8a9a-1f9cb18ce529' ORDER BY criado_em DESC LIMIT 1;
   ```
6. Testar como equipe sem o módulo `contratos` (se houver conta de teste disponível): consegue
   ver a lista e abrir os arquivos, mas não vê o botão "+ Anexar documento" nem "Remover".
7. Abrir a mesma tela com a largura da janela estreita (DevTools em modo mobile, ~375px) —
   confirmar que cada linha de anexo empilha (nome/descrição em cima, ações embaixo) em vez de
   espremer horizontalmente.

- [ ] **Step 9: Commit**

```bash
git add src/lib/supabase.ts src/pages/ContratoForm.tsx src/pages/ContratoForm.module.css
git commit -m "feat: anexo de documento assinado na tela de contrato"
```

---

## Revisão obrigatória

Ao final das 2 tasks, revisar antes de qualquer teste de campo com um contrato real: a Task 1
estende uma policy RESTRICTIVE compartilhada por 5 buckets (`isolamento_obra_storage`) — um erro
ali pode bloquear ou vazar acesso em buckets que não têm nada a ver com este trabalho (RDO, FVS,
Pendências, Projetos). Conferir com os testes de verificação do Step 3 antes de considerar a
Task 1 concluída, e opcionalmente testar upload/abertura de um RDO ou FVS real depois da
migração pra confirmar que nada regrediu nos buckets antigos.
