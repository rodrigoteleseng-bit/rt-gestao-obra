import { supabase, type PerfilUsuario } from './supabase'

export async function login(email: string, senha: string) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password: senha })
  if (error) throw error
  return data
}

export async function logout() {
  const { error } = await supabase.auth.signOut()
  if (error) throw error
}

export async function resetSenha(email: string) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/nova-senha`,
  })
  if (error) throw error
}

export async function getPerfil(): Promise<PerfilUsuario | null> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data, error } = await supabase
    .from('perfis_usuario')
    .select('*')
    .eq('id', user.id)
    .single()

  if (error) return null
  return data as PerfilUsuario
}
