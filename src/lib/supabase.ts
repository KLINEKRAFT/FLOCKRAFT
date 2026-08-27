import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/supabase';

/**
 * SUPABASE CLIENT
 * ---------------------------------------------------------------------------
 * Only the anon/publishable key is ever referenced here. The service-role key
 * must never appear in a `NEXT_PUBLIC_*` variable, must never be imported into
 * a client component, and is not read by this module at all — anything needing
 * it belongs in a route handler or server action.
 *
 * That the anon key ships to the browser is fine and by design: every table
 * carries row-level security scoped to `auth.uid()`, and every policy is
 * granted only to the `authenticated` role. Without a valid session token the
 * key opens nothing.
 *
 * Returns `null` when the environment is not configured, so the application
 * degrades to local-only operation rather than crashing at import time.
 */
export type FlockraftSupabaseClient = SupabaseClient<Database>;

let client: FlockraftSupabaseClient | null = null;

export function getSupabaseClient(): FlockraftSupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;

  client ??= createClient<Database>(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      // The magic link lands back on /auth/callback carrying a code that is
      // exchanged for a session; detecting it in the URL is what completes
      // sign-in. PKCE keeps the exchange safe on a public client.
      detectSessionInUrl: true,
      flowType: 'pkce',
    },
  });
  return client;
}

export function isSupabaseConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

/** Storage bucket holding observation media. Private; RLS-scoped by user id. */
export const MEDIA_BUCKET = 'observations';

/**
 * Object path for a media record: `<user_id>/<media_id>.<ext>`.
 *
 * The leading user-id segment is not cosmetic — the storage policies assert
 * that `(storage.foldername(name))[1]` equals the caller's uid, so this layout
 * is what actually enforces isolation between users' media.
 */
export function mediaObjectPath(userId: string, mediaId: string, mimeType: string): string {
  const extension = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
  return `${userId}/${mediaId}.${extension}`;
}
