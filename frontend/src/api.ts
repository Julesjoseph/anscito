export const API_URL = 'http://localhost:3000'

export type Usuario = {
  id: string
  username: string
  nombre: string
  apellido: string
}

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