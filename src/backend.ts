import { createClient } from '@supabase/supabase-js'

const configuredMode = import.meta.env.VITE_BACKEND_MODE
// Em desenvolvimento, a simulação é padrão; builds sem modo explícito usam Supabase.
export const backendMode =
  configuredMode ?? (import.meta.env.DEV ? 'mock' : 'supabase')

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const backendConfigurationError =
  backendMode !== 'mock' && backendMode !== 'supabase'
    ? 'VITE_BACKEND_MODE deve ser "mock" ou "supabase".'
    : backendMode === 'supabase' && (!supabaseUrl || !supabaseAnonKey)
      ? 'Configure VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY para usar o backend Supabase.'
      : null

// O cliente só existe quando o modo e as variáveis do Supabase estão válidos.
export const isSupabaseMode = backendMode === 'supabase'
export const supabaseClient =
  isSupabaseMode && !backendConfigurationError && supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey)
    : null

export function requireSupabaseClient() {
  if (!supabaseClient) {
    throw new Error(
      backendConfigurationError ?? 'O cliente Supabase não está configurado.',
    )
  }
  return supabaseClient
}
