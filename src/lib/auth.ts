import type { Session, User } from '@supabase/supabase-js';
import { getSupabaseClient, isSupabaseConfigured } from './supabase';
import { logError } from './logger';

/**
 * AUTHENTICATION
 * ---------------------------------------------------------------------------
 * Email magic link only. No password to store, reset, or leak, and nothing
 * collected beyond an address the user already controls.
 *
 * Authentication exists here for exactly one reason: row-level security needs
 * an `auth.uid()` to scope rows to. FLOCKRAFT remains fully usable signed out —
 * observation, detection, entity memory and the whole interface work with no
 * account at all. Signing in adds cross-device sync and nothing else.
 */

export type AuthStatus = 'unconfigured' | 'signed-out' | 'link-sent' | 'signed-in';

export interface AuthState {
  status: AuthStatus;
  user: User | null;
  /** Address the most recent link was sent to, for the "check your email" copy. */
  pendingEmail: string | null;
  error: string | null;
}

export const INITIAL_AUTH_STATE: AuthState = {
  status: isSupabaseConfigured() ? 'signed-out' : 'unconfigured',
  user: null,
  pendingEmail: null,
  error: null,
};

/**
 * Sends a magic link.
 *
 * `emailRedirectTo` is derived from the live origin rather than a build-time
 * constant so the same code works on localhost, Vercel previews and
 * production. Each of those origins must be listed as a redirect URL in the
 * Supabase dashboard, or the link will bounce.
 */
export async function sendMagicLink(email: string): Promise<{ error: string | null }> {
  const supabase = getSupabaseClient();
  if (!supabase) return { error: 'Sync is not configured for this deployment.' };

  const trimmed = email.trim();
  if (!isPlausibleEmail(trimmed)) return { error: 'Enter a valid email address.' };

  const { error } = await supabase.auth.signInWithOtp({
    email: trimmed,
    options: {
      emailRedirectTo: `${window.location.origin}/auth/callback`,
      // Sign-in and sign-up are the same action for a magic link; creating the
      // user on first link avoids a separate registration step.
      shouldCreateUser: true,
    },
  });

  if (error) {
    logError('sync', error);
    return { error: error.message };
  }
  return { error: null };
}

export async function signOut(): Promise<void> {
  const supabase = getSupabaseClient();
  if (!supabase) return;
  try {
    await supabase.auth.signOut();
  } catch (error) {
    // A failed sign-out still clears the local session, which is what matters.
    logError('sync', error);
  }
}

export async function getSession(): Promise<Session | null> {
  const supabase = getSupabaseClient();
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session;
}

/**
 * Subscribes to auth changes. Returns an unsubscribe function.
 *
 * The callback fires on sign-in, sign-out and token refresh, so the sync engine
 * and the UI both track the session from one source rather than polling.
 */
export function onAuthChange(callback: (session: Session | null) => void): () => void {
  const supabase = getSupabaseClient();
  if (!supabase) return () => {};

  const { data } = supabase.auth.onAuthStateChange((_event, session) => callback(session));
  return () => data.subscription.unsubscribe();
}

/**
 * Deliberately permissive: the authoritative check is whether the link
 * actually arrives. This only catches obvious typos before a round-trip.
 */
export function isPlausibleEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim());
}
