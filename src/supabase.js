import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// Safety check to prevent app from crashing if env vars are missing during setup
export const supabase = (typeof supabaseUrl === 'string' && typeof supabaseAnonKey === 'string') 
  ? createClient(supabaseUrl, supabaseAnonKey) 
  : { from: () => ({ select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: null, error: true }) }) }), upsert: () => Promise.resolve({ error: true }) }) };
