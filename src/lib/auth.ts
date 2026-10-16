import { supabase } from './supabase'

/** Only follow in-app paths after sign-in. */
export function safeNextPath(value: unknown): string {
  if (typeof value !== 'string') return '/'
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/login')) return '/'
  return value
}

/**
 * Turn the login field into a Supabase Auth email.
 * `admin` and `les` resolve through pp_director_email. A typed email is used as-is.
 * Returns null when a username has no alias yet.
 */
export async function resolveLoginEmail(usernameOrEmail: string): Promise<string | null> {
  const clean = usernameOrEmail.trim().toLowerCase()
  if (!clean) return null
  if (clean.includes('@')) return clean

  const { data, error } = await supabase.rpc('pp_director_email', { p_username: clean })
  if (error || typeof data !== 'string' || !data.includes('@')) return null
  return data
}
