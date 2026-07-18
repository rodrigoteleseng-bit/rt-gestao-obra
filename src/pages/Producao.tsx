import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { useObra } from "../contexts/ObraContext";
import {
  supabase,
  type ProducaoDiaSalarial,
  type ProducaoLancamento,
  type ProducaoSalario,
  type ProducaoPlanta,
  type ProducaoParede,
  type Pavimento,
  type TipoServicoProducao,
  type FaceParede,
  type ProducaoParedeProgresso,
  type Trabalhador,
  type Unidade,
} from "../lib/supabase";
import { hojeISO } from "../lib/cronograma";
import { formatarMoeda } from "../lib/formato";
import { converterPdfParaImagem } from "../lib/pdfParaImagem";
import PlantaClicavel, { type ZonaDesenhada, type RotuloAjustado } from "../components/PlantaClicavel";
import { useConfirmDialog } from "../components/ConfirmDialogContext";
import styles from "./Producao.module.css";

type Aba = "lancamentos" | "plantas" | "dias" | "salarios";
type Msg = { tipo: "ok" | "erro"; texto: string } | null;
const fmt = (d: string) =>
  `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;

const numero = (valor: string | number): number => {
  if (typeof valor === "number") return valor;
  const texto = valor.trim();
  if (!texto) return 0;
  return globalThis.Number(
    texto.includes(",") ? texto.replace(/\./g, "").replace(",", ".") : texto,
  );
};

export default function Producao() {
  const { perfil, temModulo } = useAuth(),
    { obraAtiva } = useObra();
  const [aba, setAba] = useState<Aba>("lancamentos");
  const [trabalhadores, setTrabalhadores] = useState<Trabalhador[]>([]),
    [unidades, setUnidades] = useState<Unidade[]>([]);
  useEffect(() => {
    if (!obraAtiva) return;
    Promise.all([
      supabase
        .from("trabalhadores")
        .select("*")
        .eq("obra_id", obraAtiva.id)
        .eq("ativo", true)
        .order("nome"),
      supabase
        .from("unidades")
        .select("*")
        .eq("obra_id", obraAtiva.id)
        .order("ordem"),
    ]).then(([t, u]) => {
      setTrabalhadores(t.data ?? []);
      setUnidades(u.data ?? []);
    });
  }, [obraAtiva]);
  if (
    perfil?.papel === "cliente" ||
    (perfil?.papel !== "admin" && !temModulo("medicoes"))
  )
    return (
      <div className={styles.page}>
        <p className={styles.vazio}>Módulo de uso interno da equipe.</p>
      </div>
    );
  const rotulo: Record<Aba, string> = {
    lancamentos: "Lançamentos diários",
    plantas: "Plantas",
    dias: "Dias salariais",
    salarios: "Salários",
  };
  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1>Produção própria</h1>
          <p className={styles.sub}>
            Produção diária, dias salariais e valores vigentes.
          </p>
        </div>
      </div>
      <div className={styles.abas}>
        {(Object.keys(rotulo) as Aba[]).map((a) => (
          <button
            key={a}
            className={`${styles.aba} ${aba === a ? styles.abaAtiva : ""}`}
            onClick={() => setAba(a)}
          >
            {rotulo[a]}
          </button>
        ))}
      </div>
      {aba === "lancamentos" && (
        <Lancamentos trabalhadores={trabalhadores} unidades={unidades} />
      )}{" "}
      {aba === "plantas" && <Plantas />}{" "}
      {aba === "dias" && <Dias trabalhadores={trabalhadores} />}{" "}
      {aba === "salarios" && <Salarios trabalhadores={trabalhadores} />}
    </div>
  );
}

function Salarios({ trabalhadores }: { trabalhadores: Trabalhador[] }) {
  const { obraAtiva } = useObra();
  const [lista, setLista] = useState<ProducaoSalario[]>([]),
    [trab, setTrab] = useState(""),
    [valor, setValor] = useState(""),
    [inicio, setInicio] = useState(hojeISO()),
    [msg, setMsg] = useState<Msg>(null);
  async function carregar() {
    if (!obraAtiva) return;
    const { data } = await supabase
      .from("producao_salarios")
      .select("*")
      .eq("obra_id", obraAtiva.id)
      .eq("ativo", true)
      .order("vigente_desde", { ascending: false });
    setLista(data ?? []);
  }
  useEffect(() => {
    carregar();
  }, [obraAtiva]);
  async function salvar() {
    const t = trabalhadores.find((x) => x.id === trab);
    if (!obraAtiva || !t || numero(valor) <= 0)
      return setMsg({
        tipo: "erro",
        texto: "Informe profissional, salário e vigência.",
      });
    const { error } = await supabase.rpc("producao_cadastrar_salario", {
      p_obra: obraAtiva.id,
      p_trabalhador: t.id,
      p_funcao: t.funcao,
      p_salario: numero(valor),
      p_vigente_desde: inicio,
    });
    if (error) return setMsg({ tipo: "erro", texto: error.message });
    setMsg({ tipo: "ok", texto: "Nova vigência salarial cadastrada." });
    setValor("");
    await carregar();
  }
  return (
    <>
      <section className={styles.bloco}>
        <h2>Nova vigência salarial</h2>
        <div className={styles.campos}>
          <Campo label="Profissional">
            <select
              className={styles.select}
              value={trab}
              onChange={(e) => {
                const trabalhadorId = e.target.value;
                setTrab(trabalhadorId);
                const salarioAtual = lista.find(
                  (item) =>
                    item.trabalhador_id === trabalhadorId &&
                    !item.vigente_ate,
                );
                setValor(
                  salarioAtual
                    ? String(salarioAtual.salario_mensal).replace(".", ",")
                    : "",
                );
              }}
            >
              <option value="">Selecione…</option>
              {trabalhadores.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nome} — {t.funcao}
                </option>
              ))}
            </select>
          </Campo>
          <Campo label="Salário mensal">
            <input
              className={styles.input}
              inputMode="decimal"
              value={valor}
              onChange={(e) => setValor(e.target.value)}
            />
          </Campo>
          <Campo label="Vigente desde">
            <input
              className={styles.input}
              type="date"
              value={inicio}
              onChange={(e) => setInicio(e.target.value)}
            />
          </Campo>
        </div>
        <div className={styles.resumo}>
          Valor diário:{" "}
          <strong>R$ {formatarMoeda((numero(valor) || 0) / 30)}</strong> ·
          divisor fixo 30
        </div>
        <button className={styles.btn} onClick={salvar}>
          Salvar vigência
        </button>
      </section>
      <Mensagem msg={msg} />
      <section className={styles.bloco}>
        <h2>Histórico</h2>
        <div className={styles.lista}>
          {lista.map((s) => (
            <div className={styles.linha} key={s.id}>
              <div>
                <strong>
                  {trabalhadores.find((t) => t.id === s.trabalhador_id)?.nome ??
                    "Profissional"}
                </strong>
                <div className={styles.meta}>
                  {s.funcao} · {fmt(s.vigente_desde)}
                  {s.vigente_ate ? ` a ${fmt(s.vigente_ate)}` : " · vigente"}
                </div>
              </div>
              <div>
                <strong>R$ {formatarMoeda(s.salario_mensal)}</strong>
                <div className={styles.meta}>
                  R$ {formatarMoeda(s.salario_mensal / 30)}/dia
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

function Lancamentos({
  trabalhadores,
  unidades,
}: {
  trabalhadores: Trabalhador[];
  unidades: Unidade[];
}) {
  const { obraAtiva } = useObra();
  const [lista, setLista] = useState<ProducaoLancamento[]>([]),
    [msg, setMsg] = useState<Msg>(null),
    [salvando, setSalvando] = useState(false);
  const [form, setForm] = useState({
      data: hojeISO(), unidade: "", servico: "alvenaria" as TipoServicoProducao,
      pavimento: "terreo" as Pavimento, preco: "", obs: "", area: "",
    }),
    [selecionados, setSelecionados] = useState<string[]>([""]),
    [plantas, setPlantas] = useState<ProducaoPlanta[]>([]),
    [paredes, setParedes] = useState<ProducaoParede[]>([]),
    [progresso, setProgresso] = useState<ProducaoParedeProgresso[]>([]),
    [urlImagem, setUrlImagem] = useState<string | null>(null),
    [paredeSelecionada, setParedeSelecionada] = useState<ProducaoParede | null>(null),
    [faceEscolha, setFaceEscolha] = useState<FaceParede | null>(null),
    [cancelandoId, setCancelandoId] = useState<string | null>(null),
    [motivoCancelamento, setMotivoCancelamento] = useState("");

  async function carregar() {
    if (!obraAtiva) return;
    const [l, pl, pa] = await Promise.all([
      supabase.from("producao_lancamentos").select("*").eq("obra_id", obraAtiva.id)
        .eq("ativo", true).order("data_producao", { ascending: false }),
      supabase.from("producao_plantas").select("*").eq("obra_id", obraAtiva.id).eq("ativo", true),
      supabase.from("producao_paredes").select("*").eq("ativo", true),
    ]);
    setLista(l.data ?? []);
    setPlantas(pl.data ?? []);
    setParedes(pa.data ?? []);
  }
  useEffect(() => { carregar(); }, [obraAtiva]);

  useEffect(() => {
    if (!form.unidade) { setProgresso([]); return; }
    supabase.from("producao_paredes_progresso").select("*").eq("unidade_id", form.unidade)
      .then(({ data }) => setProgresso(data ?? []));
  }, [form.unidade]);

  const plantaAtual = plantas.find((p) => p.pavimento === form.pavimento) ?? null;
  const paredesDaPlanta = paredes.filter((p) => p.planta_id === plantaAtual?.id);

  useEffect(() => {
    let cancelado = false;
    async function carregarUrl() {
      if (!plantaAtual) { setUrlImagem(null); return; }
      const { data } = await supabase.storage.from("producao-plantas").createSignedUrl(plantaAtual.imagem_path, 3600);
      if (!cancelado) setUrlImagem(data?.signedUrl ?? null);
    }
    carregarUrl();
    return () => { cancelado = true; };
  }, [plantaAtual]);

  function saldoDaParede(parede: ProducaoParede) {
    const buscar = (servico: TipoServicoProducao, face: FaceParede | null) =>
      progresso.find((p) => p.parede_id === parede.id && p.servico === servico && p.face === face)?.produzido_m2 ?? 0;
    return {
      alvenaria: parede.meta_alvenaria_m2 != null ? parede.meta_alvenaria_m2 - buscar("alvenaria", null) : null,
      rebocoA: parede.meta_reboco_a_m2 != null ? parede.meta_reboco_a_m2 - buscar("reboco", "a") : null,
      rebocoB: parede.meta_reboco_b_m2 != null ? parede.meta_reboco_b_m2 - buscar("reboco", "b") : null,
    };
  }

  function aoSelecionarParede(parede: ProducaoParede) {
    setParedeSelecionada(parede);
    setFaceEscolha(null);
  }

  const saldoPorParede = new Map(paredesDaPlanta.map((p) => [p.id, saldoDaParede(p)]));

  const saldoRestante = paredeSelecionada
    ? form.servico === "alvenaria"
      ? saldoDaParede(paredeSelecionada).alvenaria
      : faceEscolha === "a" ? saldoDaParede(paredeSelecionada).rebocoA
      : faceEscolha === "b" ? saldoDaParede(paredeSelecionada).rebocoB
      : null
    : null;

  const participantes = selecionados.filter(Boolean);
  const areaNum = numero(form.area) || 0;
  const total = areaNum * (numero(form.preco) || 0);

  async function salvar() {
    if (!obraAtiva || !form.unidade || !paredeSelecionada || (form.servico === "reboco" && !faceEscolha)
      || areaNum <= 0 || numero(form.preco) <= 0 || !participantes.length) {
      setMsg({ tipo: "erro", texto: "Selecione unidade, parede, área, preço e profissionais." });
      return;
    }
    if (saldoRestante != null && areaNum > saldoRestante) {
      setMsg({ tipo: "erro", texto: `Área maior que o saldo restante (${saldoRestante.toFixed(2)} m²).` });
      return;
    }
    setSalvando(true);
    const { error } = await supabase.rpc("producao_registrar_producao_parede", {
      p_obra: obraAtiva.id, p_unidade: form.unidade, p_data: form.data,
      p_parede: paredeSelecionada.id, p_face: form.servico === "reboco" ? faceEscolha : null,
      p_area_m2: areaNum, p_preco: numero(form.preco), p_observacao: form.obs || null,
      p_trabalhadores: participantes,
    });
    setSalvando(false);
    if (error) { setMsg({ tipo: "erro", texto: error.message }); return; }
    setMsg({ tipo: "ok", texto: "Produção salva e rateada." });
    setForm((f) => ({ ...f, area: "", obs: "" }));
    setParedeSelecionada(null); setFaceEscolha(null);
    const unidadeAtual = form.unidade;
    await carregar();
    supabase.from("producao_paredes_progresso").select("*").eq("unidade_id", unidadeAtual)
      .then(({ data }) => setProgresso(data ?? []));
  }

  async function confirmarCancelamento() {
    if (!cancelandoId || !motivoCancelamento.trim()) return;
    const { error } = await supabase.rpc("producao_cancelar_lancamento", {
      p_lancamento: cancelandoId, p_motivo: motivoCancelamento.trim(),
    });
    if (error) { setMsg({ tipo: "erro", texto: error.message }); return; }
    setCancelandoId(null); setMotivoCancelamento("");
    await carregar();
  }

  return (
    <>
      <section className={styles.bloco}>
        <h2>Nova produção</h2>
        <div className={styles.campos}>
          <Campo label="Data">
            <input className={styles.input} type="date" value={form.data}
              onChange={(e) => setForm({ ...form, data: e.target.value })} />
          </Campo>
          <Campo label="Unidade">
            <select className={styles.select} value={form.unidade}
              onChange={(e) => { setForm({ ...form, unidade: e.target.value }); setParedeSelecionada(null); }}>
              <option value="">Selecione…</option>
              {unidades.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
            </select>
          </Campo>
          <Campo label="Serviço">
            <select className={styles.select} value={form.servico}
              onChange={(e) => { setForm({ ...form, servico: e.target.value as TipoServicoProducao }); setParedeSelecionada(null); setFaceEscolha(null); }}>
              <option value="alvenaria">Alvenaria</option>
              <option value="reboco">Reboco</option>
            </select>
          </Campo>
          <Campo label="Pavimento">
            <select className={styles.select} value={form.pavimento}
              onChange={(e) => { setForm({ ...form, pavimento: e.target.value as Pavimento }); setParedeSelecionada(null); setFaceEscolha(null); }}>
              {PAVIMENTOS.map((p) => <option key={p.valor} value={p.valor}>{p.rotulo}</option>)}
            </select>
          </Campo>
        </div>
        {!form.unidade ? (
          <p className={styles.sub}>Selecione a unidade para escolher a parede.</p>
        ) : !urlImagem ? (
          <p className={styles.sub}>Nenhuma planta deste pavimento cadastrada ainda — cadastre na aba "Plantas".</p>
        ) : (
          <PlantaClicavel imagemUrl={urlImagem} paredes={paredesDaPlanta} modo="selecionar" onSelecionar={aoSelecionarParede} saldoPorParede={saldoPorParede} />
        )}
        {paredeSelecionada && form.servico === "reboco" && !faceEscolha && (
          <div className={styles.modalFundo} onClick={() => setParedeSelecionada(null)}>
            <div className={styles.modalCaixa} onClick={(e) => e.stopPropagation()}>
              <h3>{paredeSelecionada.nome} — qual face?</h3>
              <div className={styles.acoes}>
                <button className={styles.btn} onClick={() => setFaceEscolha("a")}>Face A</button>
                <button className={styles.btn} onClick={() => setFaceEscolha("b")}>Face B</button>
              </div>
            </div>
          </div>
        )}
        {paredeSelecionada && (form.servico === "alvenaria" || faceEscolha) && (
          <div className={styles.resumo}>
            <span>Parede: <strong>{paredeSelecionada.nome}{faceEscolha ? ` — Face ${faceEscolha.toUpperCase()}` : ""}</strong></span>
            <span>Saldo restante: <strong>{saldoRestante?.toFixed(2) ?? "—"} m²</strong></span>
          </div>
        )}
        <div className={styles.campos}>
          <Campo label="Área produzida hoje (m²)">
            <input className={styles.input} inputMode="decimal" value={form.area}
              onChange={(e) => setForm({ ...form, area: e.target.value })} />
          </Campo>
          <Campo label="Preço do dia (R$/m²)">
            <input className={styles.input} inputMode="decimal" value={form.preco}
              onChange={(e) => setForm({ ...form, preco: e.target.value })} />
          </Campo>
          <Campo label="Observação">
            <input className={styles.input} value={form.obs}
              onChange={(e) => setForm({ ...form, obs: e.target.value })} />
          </Campo>
        </div>
        <h2>Profissionais</h2>
        <div className={styles.lista}>
          {selecionados.map((selecionado, i) => (
            <div className={styles.linha} key={i}>
              <select className={styles.select} value={selecionado}
                onChange={(e) => setSelecionados((atual) => atual.map((id, j) => (j === i ? e.target.value : id)))}>
                <option value="">Selecione o profissional…</option>
                {trabalhadores.map((t) => (
                  <option key={t.id} value={t.id} disabled={selecionados.some((id, j) => j !== i && id === t.id)}>
                    {t.nome} — {t.funcao}
                  </option>
                ))}
              </select>
              {selecionados.length > 1 && (
                <button className={styles.btnSec} onClick={() => setSelecionados((atual) => atual.filter((_, j) => j !== i))}>
                  Remover
                </button>
              )}
            </div>
          ))}
          <button className={styles.btnSec} onClick={() => setSelecionados((atual) => [...atual, ""])}
            disabled={participantes.length >= trabalhadores.length}>
            + Acrescentar profissional
          </button>
        </div>
        <div className={styles.resumo}>
          <span>Área: <strong>{areaNum.toFixed(2)} m²</strong></span>
          <span>Total: <strong>R$ {formatarMoeda(total)}</strong></span>
          <span>Por profissional: <strong>R$ {formatarMoeda(participantes.length ? total / participantes.length : 0)}</strong></span>
        </div>
        <div className={styles.acoes}>
          <button className={styles.btn} disabled={salvando} onClick={salvar}>
            {salvando ? "Salvando…" : "Salvar lançamento"}
          </button>
        </div>
      </section>
      <Mensagem msg={msg} />
      <section className={styles.bloco}>
        <h2>Lançamentos recentes</h2>
        <div className={styles.lista}>
          {lista.map((l) => (
            <div className={styles.linha} key={l.id}>
              <div>
                <strong>{l.parede_nome}{l.face ? ` — Face ${l.face.toUpperCase()}` : ""}</strong>
                <div className={styles.meta}>
                  {fmt(l.data_producao)} · {l.servico} · {unidades.find((u) => u.id === l.unidade_id)?.nome}
                  {l.cancelado_em && " · CANCELADO"}
                </div>
              </div>
              <div>
                <strong>{l.area_liquida.toFixed(2)} m²</strong>
                <div className={styles.meta}>R$ {formatarMoeda(l.valor_total)}</div>
              </div>
              {!l.cancelado_em && (
                <button className={styles.btnSec} onClick={() => setCancelandoId(l.id)}>Cancelar</button>
              )}
            </div>
          ))}
        </div>
      </section>
      {cancelandoId && (
        <div className={styles.modalFundo} onClick={() => setCancelandoId(null)}>
          <div className={styles.modalCaixa} onClick={(e) => e.stopPropagation()}>
            <h3>Cancelar lançamento</h3>
            <Campo label="Motivo">
              <input className={styles.input} value={motivoCancelamento} onChange={(e) => setMotivoCancelamento(e.target.value)} />
            </Campo>
            <div className={styles.acoes}>
              <button className={styles.btn} disabled={!motivoCancelamento.trim()} onClick={confirmarCancelamento}>Confirmar</button>
              <button className={styles.btnSec} onClick={() => setCancelandoId(null)}>Voltar</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
function Dias({ trabalhadores }: { trabalhadores: Trabalhador[] }) {
  const { obraAtiva } = useObra();
  const [trab, setTrab] = useState(""),
    [data, setData] = useState(hojeISO()),
    [motivo, setMotivo] = useState(""),
    [salarios, setSalarios] = useState<ProducaoSalario[]>([]),
    [dias, setDias] = useState<ProducaoDiaSalarial[]>([]),
    [msg, setMsg] = useState<Msg>(null);
  useEffect(() => {
    if (!obraAtiva) return;
    Promise.all([
      supabase
        .from("producao_salarios")
        .select("*")
        .eq("obra_id", obraAtiva.id)
        .eq("ativo", true),
      supabase
        .from("producao_dias_salariais")
        .select("*")
        .eq("obra_id", obraAtiva.id)
        .eq("ativo", true)
        .order("data", { ascending: false }),
    ]).then(([s, d]) => {
      setSalarios(s.data ?? []);
      setDias(d.data ?? []);
    });
  }, [obraAtiva]);
  const salario = useMemo(
    () =>
      salarios.find(
        (s) =>
          s.trabalhador_id === trab &&
          s.vigente_desde <= data &&
          (!s.vigente_ate || s.vigente_ate >= data),
      ),
    [salarios, trab, data],
  );
  async function salvar() {
    if (!obraAtiva || !trab || !salario || !motivo.trim())
      return setMsg({
        tipo: "erro",
        texto: "Selecione profissional com salário vigente e informe o motivo.",
      });
    const { data: novo, error } = await supabase
      .from("producao_dias_salariais")
      .insert({
        obra_id: obraAtiva.id,
        trabalhador_id: trab,
        data,
        salario_id: salario.id,
        motivo: motivo.trim(),
      })
      .select()
      .single();
    if (error) return setMsg({ tipo: "erro", texto: error.message });
    setDias((p) => [novo, ...p]);
    setMotivo("");
    setMsg({ tipo: "ok", texto: "Dia salarial registrado." });
  }
  return (
    <>
      <section className={styles.bloco}>
        <h2>Registrar dia sem produção</h2>
        <div className={styles.campos}>
          <Campo label="Profissional">
            <select
              className={styles.select}
              value={trab}
              onChange={(e) => setTrab(e.target.value)}
            >
              <option value="">Selecione…</option>
              {trabalhadores.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nome} — {t.funcao}
                </option>
              ))}
            </select>
          </Campo>
          <Campo label="Data">
            <input
              className={styles.input}
              type="date"
              value={data}
              onChange={(e) => setData(e.target.value)}
            />
          </Campo>
          <Campo label="Motivo/atividade">
            <input
              className={styles.input}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
            />
          </Campo>
        </div>
        <div className={styles.resumo}>
          {salario ? (
            <>
              Salário:{" "}
              <strong>R$ {formatarMoeda(salario.salario_mensal)}</strong> · dia:{" "}
              <strong>R$ {formatarMoeda(salario.salario_mensal / 30)}</strong>
            </>
          ) : (
            "Nenhum salário vigente para a seleção."
          )}
        </div>
        <button className={styles.btn} onClick={salvar}>
          Registrar dia salarial
        </button>
      </section>
      <Mensagem msg={msg} />
      <section className={styles.bloco}>
        <h2>Dias registrados</h2>
        <div className={styles.lista}>
          {dias.map((d) => (
            <div className={styles.linha} key={d.id}>
              <div>
                <strong>
                  {trabalhadores.find((t) => t.id === d.trabalhador_id)?.nome}
                </strong>
                <div className={styles.meta}>
                  {fmt(d.data)} · {d.motivo}
                </div>
              </div>
              <strong>R$ {formatarMoeda(d.valor_dia)}</strong>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

const PAVIMENTOS: { valor: Pavimento; rotulo: string }[] = [
  { valor: "terreo", rotulo: "Térreo" },
  { valor: "superior", rotulo: "Superior" },
  { valor: "platibanda", rotulo: "Platibanda" },
  { valor: "caixa_agua", rotulo: "Caixa d'água" },
];

function Plantas() {
  const { obraAtiva } = useObra();
  const { confirmar } = useConfirmDialog();
  const [plantas, setPlantas] = useState<ProducaoPlanta[]>([]),
    [paredes, setParedes] = useState<ProducaoParede[]>([]),
    [pavimentoSel, setPavimentoSel] = useState<Pavimento>("terreo"),
    [enviandoPdf, setEnviandoPdf] = useState(false),
    [msg, setMsg] = useState<Msg>(null),
    [zonaPendente, setZonaPendente] = useState<ZonaDesenhada | null>(null),
    [formParede, setFormParede] = useState({
      nome: "", metaAlvenaria: "", metaRebocoA: "", metaRebocoB: "",
    }),
    [editandoParede, setEditandoParede] = useState<ProducaoParede | null>(null),
    [formEdicao, setFormEdicao] = useState({ nome: "", metaAlvenaria: "", metaRebocoA: "", metaRebocoB: "" }),
    [urlImagem, setUrlImagem] = useState<string | null>(null);

  const plantaAtual = plantas.find((p) => p.pavimento === pavimentoSel) ?? null;
  const paredesDaPlanta = paredes.filter((p) => p.planta_id === plantaAtual?.id);

  async function carregar() {
    if (!obraAtiva) return;
    const [pl, pa] = await Promise.all([
      supabase.from("producao_plantas").select("*").eq("obra_id", obraAtiva.id).eq("ativo", true),
      supabase.from("producao_paredes").select("*").eq("ativo", true),
    ]);
    setPlantas(pl.data ?? []);
    setParedes(pa.data ?? []);
  }
  useEffect(() => { carregar(); }, [obraAtiva]);

  useEffect(() => {
    let cancelado = false;
    async function carregarUrl() {
      if (!plantaAtual) { setUrlImagem(null); return; }
      const { data } = await supabase.storage.from("producao-plantas").createSignedUrl(plantaAtual.imagem_path, 3600);
      if (!cancelado) setUrlImagem(data?.signedUrl ?? null);
    }
    carregarUrl();
    return () => { cancelado = true; };
  }, [plantaAtual]);

  async function enviarPdf(arquivo: File) {
    if (!obraAtiva) return;
    setEnviandoPdf(true);
    setMsg(null);
    try {
      const imagemBlob = await converterPdfParaImagem(arquivo);
      const pasta = `${obraAtiva.id}/${pavimentoSel}`;
      const pdfPath = `${pasta}/planta-${crypto.randomUUID()}.pdf`;
      const imagemPath = `${pasta}/planta-${crypto.randomUUID()}.png`;
      const [upPdf, upImg] = await Promise.all([
        supabase.storage.from("producao-plantas").upload(pdfPath, arquivo),
        supabase.storage.from("producao-plantas").upload(imagemPath, imagemBlob),
      ]);
      if (upPdf.error || upImg.error) {
        throw new Error(upPdf.error?.message ?? upImg.error?.message);
      }
      const { error } = await supabase.from("producao_plantas").upsert(
        { obra_id: obraAtiva.id, pavimento: pavimentoSel, pdf_path: pdfPath, imagem_path: imagemPath },
        { onConflict: "obra_id,pavimento" },
      );
      if (error) throw new Error(error.message);
      setMsg({ tipo: "ok", texto: "Planta enviada." });
      await carregar();
    } catch (erro) {
      setMsg({ tipo: "erro", texto: `Falha ao enviar a planta: ${(erro as Error).message}` });
    }
    setEnviandoPdf(false);
  }

  async function salvarParede() {
    if (!plantaAtual || !zonaPendente || !formParede.nome.trim()) return;
    const metaAlv = numero(formParede.metaAlvenaria) || null,
      metaA = numero(formParede.metaRebocoA) || null,
      metaB = numero(formParede.metaRebocoB) || null;
    if (!metaAlv && !metaA && !metaB) {
      setMsg({ tipo: "erro", texto: "Informe ao menos uma meta (alvenaria ou reboco)." });
      return;
    }
    const { error } = await supabase.from("producao_paredes").insert({
      planta_id: plantaAtual.id,
      nome: formParede.nome.trim(),
      pos_x: zonaPendente.pos_x, pos_y: zonaPendente.pos_y,
      largura: zonaPendente.largura, altura_px: zonaPendente.altura_px,
      meta_alvenaria_m2: metaAlv, meta_reboco_a_m2: metaA, meta_reboco_b_m2: metaB,
    });
    if (error) { setMsg({ tipo: "erro", texto: error.message }); return; }
    setZonaPendente(null);
    setFormParede({ nome: "", metaAlvenaria: "", metaRebocoA: "", metaRebocoB: "" });
    await carregar();
  }

  function abrirEdicao(parede: ProducaoParede) {
    setEditandoParede(parede);
    setFormEdicao({
      nome: parede.nome,
      metaAlvenaria: parede.meta_alvenaria_m2?.toString().replace(".", ",") ?? "",
      metaRebocoA: parede.meta_reboco_a_m2?.toString().replace(".", ",") ?? "",
      metaRebocoB: parede.meta_reboco_b_m2?.toString().replace(".", ",") ?? "",
    });
  }

  async function moverRotulo(paredeId: string, dados: RotuloAjustado) {
    const { error } = await supabase.from("producao_paredes").update({
      rotulo_pos_x: dados.pos_x, rotulo_pos_y: dados.pos_y, rotulo_rotacao: dados.rotacao,
    }).eq("id", paredeId);
    if (error) { setMsg({ tipo: "erro", texto: error.message }); return; }
    setParedes((atual) => atual.map((p) => (p.id === paredeId
      ? { ...p, rotulo_pos_x: dados.pos_x, rotulo_pos_y: dados.pos_y, rotulo_rotacao: dados.rotacao }
      : p)));
  }

  async function salvarEdicaoParede() {
    if (!editandoParede) return;
    const nome = formEdicao.nome.trim();
    if (!nome) { setMsg({ tipo: "erro", texto: "Informe o nome da parede." }); return; }
    if (nome !== editandoParede.nome) {
      const { error: erroNome } = await supabase.from("producao_paredes").update({ nome }).eq("id", editandoParede.id);
      if (erroNome) { setMsg({ tipo: "erro", texto: erroNome.message }); return; }
    }
    const { error } = await supabase.rpc("producao_editar_meta_parede", {
      p_parede: editandoParede.id,
      p_meta_alvenaria: numero(formEdicao.metaAlvenaria) || null,
      p_meta_reboco_a: numero(formEdicao.metaRebocoA) || null,
      p_meta_reboco_b: numero(formEdicao.metaRebocoB) || null,
    });
    if (error) { setMsg({ tipo: "erro", texto: error.message }); return; }
    setEditandoParede(null);
    await carregar();
  }

  async function excluirParede(parede: ProducaoParede) {
    const { data } = await supabase
      .from("producao_paredes_progresso")
      .select("produzido_m2")
      .eq("parede_id", parede.id);
    const total = (data ?? []).reduce((soma, linha) => soma + Number(linha.produzido_m2), 0);
    const mensagem = total > 0
      ? `Esta parede ja tem ${total.toFixed(2)} m2 de producao lancada (somando todos os sobrados). O historico continua preservado, mas a parede some da lista e da planta de lancamento.`
      : "A parede some da lista e da planta de lancamento. Nenhuma producao foi lancada nela ainda.";
    if (!await confirmar({ titulo: "Excluir parede", mensagem, confirmarTexto: "Excluir parede", perigoso: true })) return;
    const { error } = await supabase.from("producao_paredes").update({ ativo: false }).eq("id", parede.id);
    if (error) { setMsg({ tipo: "erro", texto: error.message }); return; }
    await carregar();
  }

  async function ajustarEscalaRotulo(parede: ProducaoParede, delta: number) {
    const atual = parede.rotulo_escala ?? 1;
    const nova = Math.min(2, Math.max(0.5, Math.round((atual + delta) * 10) / 10));
    if (nova === atual) return;
    const { error } = await supabase.from("producao_paredes").update({ rotulo_escala: nova }).eq("id", parede.id);
    if (error) { setMsg({ tipo: "erro", texto: error.message }); return; }
    setParedes((lista) => lista.map((item) => (item.id === parede.id ? { ...item, rotulo_escala: nova } : item)));
  }

  return (
    <>
      <section className={styles.bloco}>
        <h2>Planta do pavimento</h2>
        <div className={styles.campos}>
          <Campo label="Pavimento">
            <select className={styles.select} value={pavimentoSel} onChange={(e) => setPavimentoSel(e.target.value as Pavimento)}>
              {PAVIMENTOS.map((p) => <option key={p.valor} value={p.valor}>{p.rotulo}</option>)}
            </select>
          </Campo>
        </div>
        {!plantaAtual && (
          <div className={styles.acoes}>
            <input type="file" accept="application/pdf" disabled={enviandoPdf}
              onChange={(e) => e.target.files?.[0] && enviarPdf(e.target.files[0])} />
          </div>
        )}
        <Mensagem msg={msg} />
        {urlImagem && (
          <>
            <p className={styles.sub}>Clique e arraste sobre uma parede para cadastrar a faixa clicável.</p>
            <PlantaClicavel
              imagemUrl={urlImagem}
              paredes={paredesDaPlanta}
              modo="desenhar"
              onDesenhar={setZonaPendente}
              onMoverRotulo={moverRotulo}
              onAjustarEscalaRotulo={ajustarEscalaRotulo}
            />
            <p className={styles.sub}>Arraste o nome de uma parede pra reposicionar; arraste a bolinha ao lado dele pra girar.</p>
            <div className={styles.lista}>
              {paredesDaPlanta.map((p) => (
                <div className={styles.linha} key={p.id}>
                  <strong>{p.nome}</strong>
                  <div className={styles.meta}>
                    {p.meta_alvenaria_m2 != null && `Alvenaria: ${p.meta_alvenaria_m2.toFixed(2)} m²`}
                    {p.meta_reboco_a_m2 != null && ` · Reboco A: ${p.meta_reboco_a_m2.toFixed(2)} m²`}
                    {p.meta_reboco_b_m2 != null && ` · Reboco B: ${p.meta_reboco_b_m2.toFixed(2)} m²`}
                  </div>
                  <button className={styles.btnSec} onClick={() => abrirEdicao(p)}>Editar</button>
                  <button className={styles.btnExcluir} onClick={() => excluirParede(p)}>Excluir</button>
                </div>
              ))}
            </div>
          </>
        )}
      </section>
      {editandoParede && (
        <div className={styles.modalFundo} onClick={() => setEditandoParede(null)}>
          <div className={styles.modalCaixa} onClick={(e) => e.stopPropagation()}>
            <h3>Editar parede</h3>
            <Campo label="Nome">
              <input className={styles.input} value={formEdicao.nome}
                onChange={(e) => setFormEdicao({ ...formEdicao, nome: e.target.value })} />
            </Campo>
            <Campo label="Meta de alvenaria (m²)">
              <input className={styles.input} inputMode="decimal" value={formEdicao.metaAlvenaria}
                onChange={(e) => setFormEdicao({ ...formEdicao, metaAlvenaria: e.target.value })} />
            </Campo>
            <Campo label="Meta de reboco — face A (m²)">
              <input className={styles.input} inputMode="decimal" value={formEdicao.metaRebocoA}
                onChange={(e) => setFormEdicao({ ...formEdicao, metaRebocoA: e.target.value })} />
            </Campo>
            <Campo label="Meta de reboco — face B (m²)">
              <input className={styles.input} inputMode="decimal" value={formEdicao.metaRebocoB}
                onChange={(e) => setFormEdicao({ ...formEdicao, metaRebocoB: e.target.value })} />
            </Campo>
            <div className={styles.acoes}>
              <button className={styles.btn} onClick={salvarEdicaoParede}>Salvar</button>
              <button className={styles.btnSec} onClick={() => setEditandoParede(null)}>Cancelar</button>
            </div>
          </div>
        </div>
      )}
      {zonaPendente && (
        <div className={styles.modalFundo} onClick={() => setZonaPendente(null)}>
          <div className={styles.modalCaixa} onClick={(e) => e.stopPropagation()}>
            <h3>Nova parede</h3>
            <Campo label="Nome">
              <input className={styles.input} value={formParede.nome}
                onChange={(e) => setFormParede({ ...formParede, nome: e.target.value })} />
            </Campo>
            <Campo label="Meta de alvenaria (m²)">
              <input className={styles.input} inputMode="decimal" value={formParede.metaAlvenaria}
                onChange={(e) => setFormParede({ ...formParede, metaAlvenaria: e.target.value })} />
            </Campo>
            <Campo label="Meta de reboco — face A (m²)">
              <input className={styles.input} inputMode="decimal" value={formParede.metaRebocoA}
                onChange={(e) => setFormParede({ ...formParede, metaRebocoA: e.target.value })} />
            </Campo>
            <Campo label="Meta de reboco — face B (m²)">
              <input className={styles.input} inputMode="decimal" value={formParede.metaRebocoB}
                onChange={(e) => setFormParede({ ...formParede, metaRebocoB: e.target.value })} />
            </Campo>
            <div className={styles.acoes}>
              <button className={styles.btn} onClick={salvarParede}>Salvar parede</button>
              <button className={styles.btnSec} onClick={() => setZonaPendente(null)}>Cancelar</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
function Campo({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className={styles.campo}>
      {label}
      {children}
    </label>
  );
}
function Mensagem({ msg }: { msg: Msg }) {
  return msg ? (
    <p className={msg.tipo === "ok" ? styles.msgOk : styles.msgErro}>
      {msg.texto}
    </p>
  ) : null;
}
