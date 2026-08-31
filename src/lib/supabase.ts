import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    'Missing Supabase env vars. Copy .env.example to .env and fill in your project URL and anon key.'
  )
}

// Not using the generic Database type here: without the Supabase CLI's
// generated types, the hand-written minimal schema causes overly strict
// (and often incorrect) inference on insert/update calls. Row shapes are
// still fully typed at the call site via src/lib/database.types.ts.
export const supabase = createClient(supabaseUrl, supabaseAnonKey)
