'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, Loader2, TriangleAlert } from 'lucide-react';
import { TopBar } from '@/components/layout/TopBar';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/Button';
import { getSupabaseClient, isSupabaseConfigured } from '@/lib/supabase';
import { logError } from '@/lib/logger';

type CallbackState = 'exchanging' | 'signed-in' | 'error';

/**
 * Completes the magic-link sign-in.
 *
 * Supabase's client is configured with `detectSessionInUrl`, so in the common
 * case the session is already established by the time this mounts and there is
 * nothing to exchange. The explicit `exchangeCodeForSession` call is the
 * fallback for the PKCE flow when automatic detection has not run — for
 * instance when the link is opened in a different browser tab lifecycle.
 *
 * Either way the URL is scrubbed afterwards: a magic-link code left in the
 * address bar can be re-shared, logged by an extension, or restored from
 * history.
 */
export function AuthCallback() {
  // A deployment with no Supabase configuration can never complete a link, and
  // that is knowable before the first render — so it is the initial state
  // rather than something an effect corrects afterwards.
  const configured = isSupabaseConfigured();
  const [state, setState] = useState<CallbackState>(configured ? 'exchanging' : 'error');
  const [error, setError] = useState<string | null>(
    configured ? null : 'Sync is not configured for this deployment.',
  );

  useEffect(() => {
    const supabase = getSupabaseClient();
    if (!supabase) return;

    let cancelled = false;

    const complete = async () => {
      try {
        const params = new URLSearchParams(window.location.search);
        const linkError = params.get('error_description') ?? params.get('error');
        if (linkError) throw new Error(linkError);

        const { data: existing } = await supabase.auth.getSession();
        if (!existing.session) {
          const code = params.get('code');
          if (!code) throw new Error('This sign-in link is missing its code. Request a new link.');
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
          if (exchangeError) throw exchangeError;
        }

        if (cancelled) return;
        // Strip the code from the address bar without adding a history entry.
        window.history.replaceState({}, '', '/auth/callback');
        setState('signed-in');
      } catch (cause) {
        if (cancelled) return;
        logError('sync', cause);
        setState('error');
        setError(
          cause instanceof Error
            ? cause.message
            : 'This sign-in link could not be completed. It may have expired.',
        );
      }
    };

    void complete();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <TopBar title="SIGN IN" showSettings={false} />

      {state === 'exchanging' && (
        <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
          <Loader2 aria-hidden className="size-5 animate-spin text-tactical" />
          <p className="font-mono text-[11px] tracking-[0.16em] text-bone uppercase">
            Completing sign-in
          </p>
        </div>
      )}

      {state === 'signed-in' && (
        <EmptyState
          icon={<CheckCircle2 aria-hidden className="size-5 text-tactical" />}
          title="Signed in"
          description="Observations recorded on this device will sync, and anything stored under this account will appear here."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <Link href="/">
                <Button variant="primary">Go to live</Button>
              </Link>
              <Link href="/settings">
                <Button variant="secondary">Settings</Button>
              </Link>
            </div>
          }
        />
      )}

      {state === 'error' && (
        <EmptyState
          tone="fault"
          icon={<TriangleAlert aria-hidden className="size-5" />}
          title="Sign-in failed"
          description={error ?? 'This link could not be used.'}
          action={
            <Link href="/settings">
              <Button variant="secondary">Back to settings</Button>
            </Link>
          }
        />
      )}
    </>
  );
}
