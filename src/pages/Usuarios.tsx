import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { supabase, type PerfilUsuario, type ModuloApp, type Obra, type UsuarioObra } from '../lib/supabase'
import { resetSenha } from '../lib/auth'
import { useConfirmDialog } from '../components/ConfirmDialogContext'
import styles from './Usuarios.module.css'

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

const TODOS_MODULOS = Object.keys(MODULOS_LABELS) as ModuloApp[]

export default function Usuarios() {
  const { perfil: meuPerfil } = useAuth()
  const { confirmar } = useConfirmDialog()
  const navigate = useNavigate()
  const [usuarios, setUsuarios] = useState<PerfilUsuario[]>([])
  const [obras, setObras] = useState<Obra[]>([])
  const [obrasPorUsuario, setObrasPorUsuario] = useState<Record<string, string[]>>({})
  const [editando, setEditando] = useState<string | null>(null)
  const [modulosEdit, setModulosEdit] = useState<ModuloApp[]>([])
  const [obrasEdit, setObrasEdit] = useState<string[]>([])
  const [loading, setLoading] = useState(false)

  const [convidando, setConvidando] = useState(false)
  const [convNome, setConvNome] = useState('')
  const [convEmail, setConvEmail] = useState('')
  const [convPapel, setConvPapel] = useState<'equipe' | 'cliente'>('equipe')
  const [convModulos, setConvModulos] = useState<ModuloApp[]>([])
  const [convObras, setConvObras] = useState<string[]>([])
  const [convErro, setConvErro] = useState('')
  const [convOk, setConvOk] = useState('')

  useEffect(() => {
    if (meuPerfil?.papel !== 'admin') {
      navigate('/dashboard')
      return
    }
    carregarUsuarios()
  }, [meuPerfil])

  async function carregarUsuarios() {
    const [resUsuarios, resObras, resVinculos] = await Promise.all([
      supabase.from('perfis_usuario').select('*').order('nome'),
      supabase.from('obras').select('*').order('nome'),
      supabase.from('usuarios_obras').select('*').eq('ativo', true),
    ])
    setUsuarios(resUsuarios.data ?? [])
    setObras((resObras.data ?? []) as Obra[])
    const mapa: Record<string, string[]> = {}
    for (const vinculo of (resVinculos.data ?? []) as UsuarioObra[]) {
      mapa[vinculo.usuario_id] = [...(mapa[vinculo.usuario_id] ?? []), vinculo.obra_id]
    }
    setObrasPorUsuario(mapa)
  }

  function iniciarEdicao(u: PerfilUsuario) {
    setEditando(u.id)
    setModulosEdit([...u.modulos_permitidos])
    setObrasEdit([...(obrasPorUsuario[u.id] ?? [])])
  }

  function toggleModulo(m: ModuloApp) {
    setModulosEdit(prev =>
      prev.includes(m) ? prev.filter(x => x !== m) : [...prev, m]
    )
  }

  function toggleConvModulo(m: ModuloApp) {
    setConvModulos(prev =>
      prev.includes(m) ? prev.filter(x => x !== m) : [...prev, m]
    )
  }

  async function enviarConvite(e: React.FormEvent) {
    e.preventDefault()
    setConvErro('')
    setConvOk('')
    if (convObras.length === 0) {
      setConvErro('Selecione ao menos uma obra para este usuário.')
      return
    }
    setLoading(true)
    const { data, error } = await supabase.functions.invoke('convidar-usuario', {
      body: {
        nome: convNome,
        email: convEmail,
        papel: convPapel,
        modulos: convPapel === 'equipe' ? convModulos : [],
        redirect_to: `${window.location.origin}/nova-senha`,
      },
    })
    if (error || data?.error) {
      setLoading(false)
      setConvErro(data?.error ?? 'Falha ao enviar o convite. Tente novamente.')
      return
    }

    const emailNormalizado = convEmail.trim().toLowerCase()
    const idRetornado = data?.user_id ?? data?.user?.id ?? data?.id
    const { data: perfilCriado } = idRetornado
      ? await supabase.from('perfis_usuario').select('id').eq('id', idRetornado).maybeSingle()
      : await supabase.from('perfis_usuario').select('id').eq('email', emailNormalizado).maybeSingle()
    if (!perfilCriado?.id) {
      setLoading(false)
      setConvErro('O convite foi enviado, mas o perfil ainda não apareceu para vincular as obras. Atualize a tela e edite o usuário antes que ele acesse.')
      await carregarUsuarios()
      return
    }
    const { error: erroAcessos } = await supabase.rpc('atualizar_acessos_usuario', {
      p_usuario: perfilCriado.id,
      p_modulos: convPapel === 'equipe' ? convModulos : [],
      p_obras: convObras,
    })
    if (erroAcessos) {
      setLoading(false)
      setConvErro(`O convite foi enviado, mas os acessos não foram vinculados: ${erroAcessos.message}`)
      await carregarUsuarios()
      return
    }
    setConvOk(`Convite enviado para ${convEmail}.`)
    setConvNome('')
    setConvEmail('')
    setConvModulos([])
    setConvObras([])
    await carregarUsuarios()
    setLoading(false)
  }

  async function gerenciarAcesso(u: PerfilUsuario, acao: 'desativar' | 'reativar' | 'excluir_pendente') {
    const confirmacoes: Record<string, string> = {
      desativar: `Desativar o acesso de ${u.nome}? O histórico de lançamentos será preservado e o acesso pode ser reativado depois.`,
      reativar: `Reativar o acesso de ${u.nome}?`,
      excluir_pendente: `Excluir definitivamente o convite de ${u.nome}? Só é possível se a pessoa nunca acessou o sistema.`,
    }
    if (!await confirmar({
      titulo: acao === 'reativar' ? 'Reativar acesso' : acao === 'desativar' ? 'Desativar acesso' : 'Excluir convite',
      mensagem: confirmacoes[acao],
      confirmarTexto: acao === 'reativar' ? 'Reativar' : acao === 'desativar' ? 'Desativar' : 'Excluir convite',
      perigoso: acao !== 'reativar',
    })) return

    setLoading(true)
    const { data, error } = await supabase.functions.invoke('gerenciar-usuario', {
      body: { acao, user_id: u.id },
    })
    setLoading(false)
    if (error || data?.error) {
      window.alert(data?.error ?? 'Falha na operação. Tente novamente.')
      return
    }
    carregarUsuarios()
  }

  async function enviarLinkSenha(u: PerfilUsuario) {
    if (!await confirmar({
      titulo: 'Enviar link de nova senha',
      mensagem: `Enviar o link para ${u.email}? A pessoa receberá um e-mail e definirá a nova senha sozinha.`,
      confirmarTexto: 'Enviar link',
    })) return
    setLoading(true)
    try {
      await resetSenha(u.email)
      window.alert(`Link de nova senha enviado para ${u.email}.`)
    } catch {
      window.alert('Falha ao enviar o link. Verifique o e-mail e tente novamente.')
    }
    setLoading(false)
  }

  async function salvarAcessos(u: PerfilUsuario) {
    if (obrasEdit.length === 0) {
      window.alert('Selecione ao menos uma obra para este usuário.')
      return
    }
    setLoading(true)
    const { error } = await supabase.rpc('atualizar_acessos_usuario', {
      p_usuario: u.id,
      p_modulos: u.papel === 'equipe' ? modulosEdit : [],
      p_obras: obrasEdit,
    })
    setLoading(false)
    if (error) {
      window.alert(`Falha ao salvar as permissões: ${error.message}`)
      return
    }
    setEditando(null)
    carregarUsuarios()
  }

  function toggleObra(id: string, modo: 'convite' | 'edicao') {
    const alterar = (prev: string[]) => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    if (modo === 'convite') setConvObras(alterar)
    else setObrasEdit(alterar)
  }

  const papelLabel: Record<string, string> = {
    admin: 'Admin',
    equipe: 'Equipe',
    cliente: 'Cliente',
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1>Usuários</h1>
          <p className={styles.sub}>Gerencie os membros da equipe e seus módulos de acesso.</p>
        </div>
        <button
          className={styles.btnConvidar}
          onClick={() => { setConvidando(!convidando); setConvErro(''); setConvOk('') }}
        >
          {convidando ? 'Fechar' : '+ Convidar usuário'}
        </button>
      </div>

      {convidando && (
        <form onSubmit={enviarConvite} className={styles.formConvite}>
          <div className={styles.campoConv}>
            <label htmlFor="conv-nome">Nome completo</label>
            <input
              id="conv-nome"
              type="text"
              value={convNome}
              onChange={e => setConvNome(e.target.value)}
              required
              placeholder="Nome do colaborador"
            />
          </div>
          <div className={styles.campoConv}>
            <label htmlFor="conv-email">E-mail</label>
            <input
              id="conv-email"
              type="email"
              value={convEmail}
              onChange={e => setConvEmail(e.target.value)}
              required
              placeholder="email@exemplo.com"
            />
          </div>
          <div className={styles.campoConv}>
            <label htmlFor="conv-papel">Papel</label>
            <select
              id="conv-papel"
              value={convPapel}
              onChange={e => setConvPapel(e.target.value as 'equipe' | 'cliente')}
            >
              <option value="equipe">Equipe</option>
              <option value="cliente">Cliente (somente leitura)</option>
            </select>
          </div>

          {convPapel === 'equipe' && (
            <div className={styles.campoConv}>
              <label>Módulos permitidos</label>
              <div className={styles.checkGrid}>
                {TODOS_MODULOS.map(m => (
                  <label key={m} className={styles.checkItem}>
                    <input
                      type="checkbox"
                      checked={convModulos.includes(m)}
                      onChange={() => toggleConvModulo(m)}
                    />
                    {MODULOS_LABELS[m]}
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className={styles.campoConv}>
            <label>Obras permitidas</label>
            <div className={styles.obrasGrid}>
              {obras.map(obra => (
                <label key={obra.id} className={styles.checkItem}>
                  <input
                    type="checkbox"
                    checked={convObras.includes(obra.id)}
                    onChange={() => toggleObra(obra.id, 'convite')}
                  />
                  <span>{obra.nome}</span>
                </label>
              ))}
            </div>
            {obras.length === 0 && <span className={styles.semModulo}>Nenhuma obra disponível.</span>}
          </div>

          {convErro && <p className={styles.msgErro}>{convErro}</p>}
          {convOk && <p className={styles.msgOk}>{convOk}</p>}

          <button type="submit" className={styles.btnSalvar} disabled={loading}>
            {loading ? 'Enviando…' : 'Enviar convite'}
          </button>
          <p className={styles.dicaConvite}>
            O convidado recebe um e-mail com link para definir a própria senha.
          </p>
        </form>
      )}

      <div className={styles.lista}>
        {usuarios.map(u => (
          <div key={u.id} className={styles.card}>
            <div className={styles.cardTop}>
              <div className={styles.avatar}>{u.nome.charAt(0).toUpperCase()}</div>
              <div className={styles.info}>
                <div className={styles.nome}>{u.nome}</div>
                <div className={styles.email}>{u.email}</div>
                <span className={`${styles.badge} ${styles[`badge_${u.papel}`]}`}>
                  {papelLabel[u.papel]}
                </span>
                {!u.ativo && <span className={styles.badgeInativo}>Inativo</span>}
              </div>
              {u.papel !== 'admin' && u.id !== meuPerfil?.id && (
                <div className={styles.acoes}>
                  {u.ativo ? (
                    <>
                      <button
                        className={styles.btnEditar}
                        onClick={() => editando === u.id ? setEditando(null) : iniciarEdicao(u)}
                      >
                        {editando === u.id ? 'Cancelar' : 'Editar'}
                      </button>
                      <button
                        className={styles.btnEditar}
                        onClick={() => enviarLinkSenha(u)}
                        disabled={loading}
                        title="Envia e-mail para a pessoa definir uma nova senha"
                      >
                        🔑 Nova senha
                      </button>
                      <button
                        className={styles.btnDesativar}
                        onClick={() => gerenciarAcesso(u, 'desativar')}
                        disabled={loading}
                      >
                        Desativar
                      </button>
                      <button
                        className={styles.btnExcluir}
                        onClick={() => gerenciarAcesso(u, 'excluir_pendente')}
                        disabled={loading}
                        title="Só para convites nunca acessados"
                      >
                        Excluir convite
                      </button>
                    </>
                  ) : (
                    <button
                      className={styles.btnReativar}
                      onClick={() => gerenciarAcesso(u, 'reativar')}
                      disabled={loading}
                    >
                      Reativar
                    </button>
                  )}
                </div>
              )}
            </div>

            {u.papel !== 'admin' && editando === u.id ? (
              <div className={styles.editModulos}>
                {u.papel === 'equipe' && (
                  <>
                    <p className={styles.editLabel}>Módulos permitidos:</p>
                    <div className={styles.checkGrid}>
                      {TODOS_MODULOS.map(m => (
                        <label key={m} className={styles.checkItem}>
                          <input
                            type="checkbox"
                            checked={modulosEdit.includes(m)}
                            onChange={() => toggleModulo(m)}
                          />
                          {MODULOS_LABELS[m]}
                        </label>
                      ))}
                    </div>
                  </>
                )}
                <p className={styles.editLabel}>Obras permitidas:</p>
                <div className={styles.obrasGrid}>
                  {obras.map(obra => (
                    <label key={obra.id} className={styles.checkItem}>
                      <input
                        type="checkbox"
                        checked={obrasEdit.includes(obra.id)}
                        onChange={() => toggleObra(obra.id, 'edicao')}
                      />
                      <span>{obra.nome}</span>
                    </label>
                  ))}
                </div>
                <button
                  className={styles.btnSalvar}
                  onClick={() => salvarAcessos(u)}
                  disabled={loading}
                >
                  {loading ? 'Salvando…' : 'Salvar acessos'}
                </button>
              </div>
            ) : u.papel !== 'admin' ? (
              <div className={styles.acessosResumo}>
                {u.papel === 'equipe' && (
                  <div className={styles.modulos}>
                    {u.modulos_permitidos.length === 0
                      ? <span className={styles.semModulo}>Nenhum módulo atribuído</span>
                      : u.modulos_permitidos.map(m => (
                        <span key={m} className={styles.moduloTag}>{MODULOS_LABELS[m]}</span>
                      ))
                    }
                  </div>
                )}
                {u.papel === 'cliente' && <span className={styles.moduloTag}>Somente leitura</span>}
                <div className={styles.obrasResumo}>
                  <span className={styles.resumoLabel}>Obras:</span>
                  {(obrasPorUsuario[u.id] ?? []).length === 0
                    ? <span className={styles.semModulo}>Nenhuma obra atribuída</span>
                    : (obrasPorUsuario[u.id] ?? []).map(id => (
                      <span key={id} className={styles.obraTag}>{obras.find(o => o.id === id)?.nome ?? 'Obra indisponível'}</span>
                    ))}
                </div>
              </div>
            ) : u.papel === 'admin' ? (
              <div className={styles.modulos}>
                <span className={styles.moduloTagAdmin}>Acesso total</span>
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  )
}
