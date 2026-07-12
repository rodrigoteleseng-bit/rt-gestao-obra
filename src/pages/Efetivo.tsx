import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useObra } from '../contexts/ObraContext'
import { supabase, type EfetivoPresenca, type Trabalhador } from '../lib/supabase'
import { dataHoje } from '../lib/almoxarifado'
import styles from './Efetivo.module.css'

type Aba = 'trabalhadores' | 'chamada'

const fmtData = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`

export default function Efetivo() {
  const { perfil } = useAuth()
  const [aba, setAba] = useState<Aba>('trabalhadores')

  if (perfil?.papel === 'cliente') {
    return (
      <div className={styles.page}>
        <p className={styles.vazio}>Módulo de uso interno da equipe.</p>
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1>Gestão de Efetivo</h1>
          <p className={styles.sub}>Trabalhadores da obra e chamada diária de presença.</p>
        </div>
      </div>

      <div className={styles.abas}>
        <button className={`${styles.aba} ${aba === 'trabalhadores' ? styles.abaAtiva : ''}`} onClick={() => setAba('trabalhadores')}>
          Trabalhadores
        </button>
        <button className={`${styles.aba} ${aba === 'chamada' ? styles.abaAtiva : ''}`} onClick={() => setAba('chamada')}>
          Chamada
        </button>
      </div>

      {aba === 'trabalhadores' && <AbaTrabalhadores />}
      {aba === 'chamada' && <AbaChamada irParaTrabalhadores={() => setAba('trabalhadores')} />}
    </div>
  )
}

function AbaTrabalhadores() {
  const { perfil, temModulo } = useAuth()
  const { obraAtiva } = useObra()
  const podeEditar = perfil?.papel === 'admin' || temModulo('efetivo')

  const [trabalhadores, setTrabalhadores] = useState<Trabalhador[]>([])
  const [carregando, setCarregando] = useState(true)
  const [busca, setBusca] = useState('')
  const [filtroFuncao, setFiltroFuncao] = useState('')
  const [mostrarNovo, setMostrarNovo] = useState(false)
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)

  async function carregar() {
    if (!obraAtiva) return
    setCarregando(true)
    const { data } = await supabase.from('trabalhadores').select('*')
      .eq('obra_id', obraAtiva.id).eq('ativo', true).order('nome')
    setTrabalhadores(data ?? [])
    setCarregando(false)
  }

  useEffect(() => { carregar() }, [obraAtiva])

  const funcoes = useMemo(
    () => [...new Set(trabalhadores.map(t => t.funcao))].sort((a, b) => a.localeCompare(b, 'pt-BR')),
    [trabalhadores]
  )

  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase()
    return trabalhadores.filter(t =>
      (!termo || t.nome.toLowerCase().includes(termo) || t.funcao.toLowerCase().includes(termo)) &&
      (!filtroFuncao || t.funcao === filtroFuncao)
    )
  }, [trabalhadores, busca, filtroFuncao])

  function trabalhadorCriado(t: Trabalhador) {
    setTrabalhadores(prev => [...prev, t].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')))
  }

  async function inativar(t: Trabalhador) {
    if (!window.confirm(`Inativar ${t.nome}? O histórico é mantido, mas ele deixa de aparecer na chamada.`)) return
    setMsg(null)
    const { error } = await supabase.from('trabalhadores').update({ ativo: false }).eq('id', t.id)
    if (error) {
      setMsg({ tipo: 'erro', texto: `Erro ao inativar: ${error.message}` })
      return
    }
    await carregar()
    setMsg({ tipo: 'ok', texto: `${t.nome} inativado.` })
  }

  return (
    <div>
      {podeEditar && (
        <div className={styles.topoAcoes}>
          <button className={styles.btnPrincipal} onClick={() => setMostrarNovo(true)}>+ Novo trabalhador</button>
        </div>
      )}

      {mostrarNovo && (
        <PainelNovoTrabalhador
          funcoes={funcoes}
          onFechar={() => setMostrarNovo(false)}
          onSucesso={(t) => {
            trabalhadorCriado(t)
            setMostrarNovo(false)
            setMsg({ tipo: 'ok', texto: 'Trabalhador cadastrado.' })
          }}
        />
      )}

      <div className={styles.filtros}>
        <input className={styles.busca} value={busca} onChange={e => setBusca(e.target.value)}
          placeholder="Buscar por nome ou função…" />
        <select className={styles.selectFiltro} value={filtroFuncao} onChange={e => setFiltroFuncao(e.target.value)}>
          <option value="">Todas as funções</option>
          {funcoes.map(f => <option key={f} value={f}>{f}</option>)}
        </select>
      </div>

      {msg && <p className={msg.tipo === 'ok' ? styles.msgOk : styles.msgErro}>{msg.texto}</p>}

      {carregando && <p className={styles.vazio}>Carregando…</p>}
      {!carregando && filtrados.length === 0 && (
        <p className={styles.vazio}>
          {trabalhadores.length === 0 ? 'Nenhum trabalhador cadastrado.' : 'Nenhum trabalhador com esses filtros.'}
        </p>
      )}

      {!carregando && filtrados.length > 0 && (
        <div className={styles.lista}>
          {filtrados.map(t => (
            <div key={t.id} className={styles.linha}>
              <div className={styles.linhaInfo}>
                <div className={styles.linhaTopo}>
                  <span className={styles.linhaNome}>{t.nome}</span>
                  <span className={styles.chip}>{t.funcao}</span>
                </div>
                <div className={styles.linhaDesc}>
                  {t.empresa && <span>{t.empresa}</span>}
                  {t.data_admissao && <span>{t.empresa ? ' · ' : ''}Admissão: {fmtData(t.data_admissao)}</span>}
                </div>
              </div>
              {podeEditar && (
                <button className={styles.btnInativar} onClick={() => inativar(t)}>Inativar</button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

interface PainelNovoTrabalhadorProps {
  funcoes: string[]
  onFechar: () => void
  onSucesso: (t: Trabalhador) => void
}

function PainelNovoTrabalhador({ funcoes, onFechar, onSucesso }: PainelNovoTrabalhadorProps) {
  const { obraAtiva } = useObra()
  const [nome, setNome] = useState('')
  const [funcao, setFuncao] = useState('')
  const [empresa, setEmpresa] = useState('')
  const [dataAdmissao, setDataAdmissao] = useState('')
  const [salvando, setSalvando] = useState(false)
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)

  async function salvar() {
    if (!obraAtiva) return
    if (!nome.trim()) {
      setMsg({ tipo: 'erro', texto: 'Informe o nome do trabalhador.' })
      return
    }
    if (!funcao.trim()) {
      setMsg({ tipo: 'erro', texto: 'Informe a função.' })
      return
    }
    setSalvando(true)
    setMsg(null)
    const { data, error } = await supabase.from('trabalhadores').insert({
      obra_id: obraAtiva.id,
      nome: nome.trim(),
      funcao: funcao.trim(),
      empresa: empresa.trim() || null,
      data_admissao: dataAdmissao || null,
    }).select().single()
    setSalvando(false)
    if (error || !data) {
      setMsg({ tipo: 'erro', texto: `Falha ao cadastrar: ${error?.message}` })
      return
    }
    onSucesso(data)
  }

  return (
    <div className={styles.painelForm}>
      <div className={styles.painelHeader}>
        <h2>Novo trabalhador</h2>
        <button className={styles.btnFechar} onClick={onFechar}>✕</button>
      </div>
      <div className={styles.linha2}>
        <label className={styles.campo}>
          Nome *
          <input value={nome} onChange={e => setNome(e.target.value)} placeholder="Ex.: João da Silva" />
        </label>
        <label className={styles.campo}>
          Função *
          <input value={funcao} onChange={e => setFuncao(e.target.value)} placeholder="Ex.: Pedreiro" list="funcoes-trabalhador" />
          <datalist id="funcoes-trabalhador">
            {funcoes.map(f => <option key={f} value={f} />)}
          </datalist>
        </label>
        <label className={styles.campo}>
          Empresa
          <input value={empresa} onChange={e => setEmpresa(e.target.value)} placeholder="Opcional" />
        </label>
        <label className={styles.campo}>
          Data de admissão
          <input type="date" value={dataAdmissao} onChange={e => setDataAdmissao(e.target.value)} />
        </label>
      </div>
      {msg && <p className={msg.tipo === 'ok' ? styles.msgOk : styles.msgErro}>{msg.texto}</p>}
      <button className={styles.btnPrincipal} onClick={salvar} disabled={salvando}>
        {salvando ? 'Salvando…' : 'Cadastrar trabalhador'}
      </button>
    </div>
  )
}

interface AbaChamadaProps {
  irParaTrabalhadores: () => void
}

function AbaChamada({ irParaTrabalhadores }: AbaChamadaProps) {
  const { obraAtiva } = useObra()

  const [dataChamada, setDataChamada] = useState(dataHoje())
  const [trabalhadores, setTrabalhadores] = useState<Trabalhador[]>([])
  const [presencas, setPresencas] = useState<Map<string, boolean>>(new Map())
  const [chamadaId, setChamadaId] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(true)
  const [salvando, setSalvando] = useState(false)
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)

  async function carregar() {
    if (!obraAtiva) return
    setCarregando(true)
    setMsg(null)

    const { data: trabsData } = await supabase.from('trabalhadores').select('*')
      .eq('obra_id', obraAtiva.id).eq('ativo', true).order('nome')
    const trabs = trabsData ?? []
    setTrabalhadores(trabs)

    const { data: chamada } = await supabase.from('efetivo_chamadas').select('*')
      .eq('obra_id', obraAtiva.id).eq('data', dataChamada).maybeSingle()

    const map = new Map<string, boolean>()
    trabs.forEach(t => map.set(t.id, true))

    if (chamada) {
      setChamadaId(chamada.id)
      const { data: presencasData } = await supabase.from('efetivo_presencas').select('*')
        .eq('chamada_id', chamada.id)
      ;(presencasData as EfetivoPresenca[] | null)?.forEach(p => map.set(p.trabalhador_id, p.presente))
    } else {
      setChamadaId(null)
    }

    setPresencas(map)
    setCarregando(false)
  }

  useEffect(() => { carregar() }, [obraAtiva, dataChamada])

  function alternarPresenca(trabalhadorId: string) {
    setPresencas(prev => {
      const next = new Map(prev)
      next.set(trabalhadorId, !next.get(trabalhadorId))
      return next
    })
  }

  const presentesCount = useMemo(
    () => [...presencas.values()].filter(Boolean).length,
    [presencas]
  )

  async function salvar() {
    if (!obraAtiva || trabalhadores.length === 0) return
    setSalvando(true)
    setMsg(null)

    try {
      let cId = chamadaId
      if (!cId) {
        const { data, error } = await supabase.from('efetivo_chamadas')
          .insert({ obra_id: obraAtiva.id, data: dataChamada })
          .select().single()
        if (error || !data) throw new Error(error?.message ?? 'Falha ao criar a chamada.')
        cId = data.id
        setChamadaId(cId)

        const registros = trabalhadores.map(t => ({
          chamada_id: cId, trabalhador_id: t.id, presente: presencas.get(t.id) ?? true,
        }))
        const { error: errPres } = await supabase.from('efetivo_presencas').insert(registros)
        if (errPres) throw new Error(errPres.message)
      } else {
        const registros = trabalhadores.map(t => ({
          chamada_id: cId, trabalhador_id: t.id, presente: presencas.get(t.id) ?? true,
        }))
        const { error: errPres } = await supabase.from('efetivo_presencas')
          .upsert(registros, { onConflict: 'chamada_id,trabalhador_id' })
        if (errPres) throw new Error(errPres.message)
      }

      setMsg({
        tipo: 'ok',
        texto: `Chamada de ${fmtData(dataChamada)} salva: ${presentesCount} de ${trabalhadores.length} presentes.`,
      })
    } catch (e) {
      setMsg({ tipo: 'erro', texto: `Erro ao salvar: ${(e as Error).message}` })
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div>
      <div className={styles.chamadaTopo}>
        <label className={styles.campoData}>
          Data
          <input type="date" value={dataChamada} max={dataHoje()}
            onChange={e => setDataChamada(e.target.value)} />
        </label>
        {!carregando && trabalhadores.length > 0 && (
          <span className={styles.contador}>{presentesCount} de {trabalhadores.length} presentes</span>
        )}
      </div>

      {msg && <p className={msg.tipo === 'ok' ? styles.msgOk : styles.msgErro}>{msg.texto}</p>}

      {carregando && <p className={styles.vazio}>Carregando…</p>}

      {!carregando && trabalhadores.length === 0 && (
        <div className={styles.vazio}>
          <p>Nenhum trabalhador cadastrado. Vá para a aba Trabalhadores.</p>
          <button className={styles.btnPrincipal} onClick={irParaTrabalhadores}>Ir para Trabalhadores</button>
        </div>
      )}

      {!carregando && trabalhadores.length > 0 && (
        <>
          <div className={styles.lista}>
            {trabalhadores.map(t => {
              const presente = presencas.get(t.id) ?? true
              return (
                <div key={t.id} className={styles.linha}>
                  <div className={styles.linhaInfo}>
                    <div className={styles.linhaTopo}>
                      <span className={styles.linhaNome}>{t.nome}</span>
                      <span className={styles.chip}>{t.funcao}</span>
                    </div>
                  </div>
                  <button
                    className={presente ? styles.btnPresente : styles.btnAusente}
                    onClick={() => alternarPresenca(t.id)}
                  >
                    {presente ? 'Presente' : 'Ausente'}
                  </button>
                </div>
              )
            })}
          </div>
          <button className={styles.btnPrincipal} onClick={salvar} disabled={salvando}>
            {salvando ? 'Salvando…' : 'Salvar chamada'}
          </button>
        </>
      )}
    </div>
  )
}
