import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * SUPABASE CLIENT
 * ---------------------------------------------------------------------------
 * Only the anon/publishable key is ever referenced here. The service-role key
 * must never appear in a `NEXT_PUBLIC_*` variable, must never be imported into
 * a client component, and is not read by this module at all — anything needing
 * it belongs in a route handler or server action.
 *
 * Returns `null` when the environment is not configured, so the application
 * degrades to local-only operation rather than crashing at import time.
 */
let client: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;

  client ??= createClient(url, anonKey, {
    auth: { persistSession: true, autoRefreshToken: true },
  });
  return client;
}

export function isSupabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}
