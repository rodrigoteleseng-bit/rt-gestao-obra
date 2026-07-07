import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { supabase, type PerfilUsuario, type ModuloApp } from '../lib/supabase'
import styles from './Usuarios.module.css'

const MODULOS_LABELS: Record<ModuloApp, string> = {
  rdo: 'RDO',
  avanco: 'Avanço Físico',
  pendencias: 'Pendências',
  almoxarifado: 'Almoxarifado',
  financeiro: 'Financeiro',
  compras: 'Compras',
}

const TODOS_MODULOS = Object.keys(MODULOS_LABELS) as ModuloApp[]

export default function Usuarios() {
  const { perfil: meuPerfil } = useAuth()
  const navigate = useNavigate()
  const [usuarios, setUsuarios] = useState<PerfilUsuario[]>([])
  const [editando, setEditando] = useState<string | null>(null)
  const [modulosEdit, setModulosEdit] = useState<ModuloApp[]>([])
  const [loading, setLoading] = useState(false)

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
      <h1>Usuários</h1>
      <p className={styles.sub}>Gerencie os membros da equipe e seus módulos de acesso.</p>

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
              </div>
              {u.papel !== 'admin' && u.id !== meuPerfil?.id && (
                <button
                  className={styles.btnEditar}
                  onClick={() => editando === u.id ? setEditando(null) : iniciarEdicao(u)}
                >
                  {editando === u.id ? 'Cancelar' : 'Editar'}
                </button>
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
