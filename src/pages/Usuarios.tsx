import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { supabase, type PerfilUsuario, type ModuloApp } from '../lib/supabase'
import { resetSenha } from '../lib/auth'
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
}

const TODOS_MODULOS = Object.keys(MODULOS_LABELS) as ModuloApp[]

export default function Usuarios() {
  const { perfil: meuPerfil } = useAuth()
  const navigate = useNavigate()
  const [usuarios, setUsuarios] = useState<PerfilUsuario[]>([])
  const [editando, setEditando] = useState<string | null>(null)
  const [modulosEdit, setModulosEdit] = useState<ModuloApp[]>([])
  const [loading, setLoading] = useState(false)

  const [convidando, setConvidando] = useState(false)
  const [convNome, setConvNome] = useState('')
  const [convEmail, setConvEmail] = useState('')
  const [convPapel, setConvPapel] = useState<'equipe' | 'cliente'>('equipe')
  const [convModulos, setConvModulos] = useState<ModuloApp[]>([])
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
    const { data } = await supabase.from('perfis_usuario').select('*').order('nome')
    setUsuarios(data ?? [])
  }

  function iniciarEdicao(u: PerfilUsuario) {
    setEditando(u.id)
    setModulosEdit([...u.modulos_permitidos])
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
    setLoading(false)
    if (error || data?.error) {
      setConvErro(data?.error ?? 'Falha ao enviar o convite. Tente novamente.')
      return
    }
    setConvOk(`Convite enviado para ${convEmail}.`)
    setConvNome('')
    setConvEmail('')
    setConvModulos([])
    carregarUsuarios()
  }

  async function gerenciarAcesso(u: PerfilUsuario, acao: 'desativar' | 'reativar' | 'excluir_pendente') {
    const confirmacoes: Record<string, string> = {
      desativar: `Desativar o acesso de ${u.nome}? O histórico de lançamentos será preservado e o acesso pode ser reativado depois.`,
      reativar: `Reativar o acesso de ${u.nome}?`,
      excluir_pendente: `Excluir definitivamente o convite de ${u.nome}? Só é possível se a pessoa nunca acessou o sistema.`,
    }
    if (!window.confirm(confirmacoes[acao])) return

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
    if (!window.confirm(`Enviar link de redefinição de senha para ${u.email}? A pessoa recebe um e-mail e define a nova senha sozinha.`)) return
    setLoading(true)
    try {
      await resetSenha(u.email)
      window.alert(`Link de nova senha enviado para ${u.email}.`)
    } catch {
      window.alert('Falha ao enviar o link. Verifique o e-mail e tente novamente.')
    }
    setLoading(false)
  }

  async function salvarModulos(userId: string) {
    setLoading(true)
    await supabase
      .from('perfis_usuario')
      .update({ modulos_permitidos: modulosEdit })
      .eq('id', userId)
    setEditando(null)
    setLoading(false)
    carregarUsuarios()
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

            {u.papel === 'equipe' && editando === u.id ? (
              <div className={styles.editModulos}>
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
                <button
                  className={styles.btnSalvar}
                  onClick={() => salvarModulos(u.id)}
                  disabled={loading}
                >
                  {loading ? 'Salvando…' : 'Salvar permissões'}
                </button>
              </div>
            ) : u.papel === 'equipe' ? (
              <div className={styles.modulos}>
                {u.modulos_permitidos.length === 0
                  ? <span className={styles.semModulo}>Nenhum módulo atribuído</span>
                  : u.modulos_permitidos.map(m => (
                    <span key={m} className={styles.moduloTag}>{MODULOS_LABELS[m]}</span>
                  ))
                }
              </div>
            ) : u.papel === 'admin' ? (
              <div className={styles.modulos}>
                <span className={styles.moduloTagAdmin}>Acesso total</span>
              </div>
            ) : (
              <div className={styles.modulos}>
                <span className={styles.moduloTag}>Somente leitura</span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
