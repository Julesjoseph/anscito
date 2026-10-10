export const API_URL = 'http://localhost:3000'

export type Usuario = {
  id: string
  username: string
  nombre: string
  apellido: string
}

export type Perfil = Usuario & { roles: string[]; permisos: string[] }

export type FilaUsuario = {
  id: string
  username: string
  nombre: string
  apellido: string
  is_active: boolean
  last_login_at: string | null
  roles: string
}

export class SesionVencida extends Error {}

async function pedir<T>(ruta: string, token: string): Promise<T> {
  const res = await fetch(`${API_URL}${ruta}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (res.status === 401) throw new SesionVencida('Sesión vencida')
  if (res.status === 403) {
    throw new Error('No tiene permiso para ver esta información')
  }
  if (!res.ok) throw new Error('No se pudo cargar la información')
  return (await res.json()) as T
}

export const obtenerPerfil = (token: string) => pedir<Perfil>('/auth/me', token)

export const listarUsuarios = (token: string) =>
  pedir<FilaUsuario[]>('/usuarios', token)

export async function login(username: string, password: string) {
  const res = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => null)
    throw new Error(data?.message ?? 'No se pudo iniciar sesión')
  }
  return (await res.json()) as {
    token: string
    usuario: Usuario
    debeCambiarPassword: boolean
  }
}