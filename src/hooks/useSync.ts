'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { INITIAL_SYNC_STATUS, SyncEngine, type SyncStatus } from '@/lib/sync/engine';
import { getLocalRepository, setSyncEnabled } from '@/lib/store';
import { onAuthChange, sendMagicLink, signOut as authSignOut } from '@/lib/auth';
import { isSupabaseConfigured } from '@/lib/supabase';
import { useOnlineStatus } from './useOnlineStatus';

/**
 * SYNC + SESSION
 * ---------------------------------------------------------------------------
 * Binds the auth session to the sync engine and exposes both to the interface.
 *
 * The engine is a module-level singleton rather than per-component state: two
 * engines would drain the same outbox concurrently and upload everything twice.
 */
let engine: SyncEngine | null = null;

function getEngine(): SyncEngine {
  engine ??= new SyncEngine(getLocalRepository());
  return engine;
}

export interface UseSyncResult {
  user: User | null;
  status: SyncStatus;
  configured: boolean;
  /** Address the last magic link was sent to, for the confirmation copy. */
  pendingEmail: string | null;
  authError: string | null;
  sending: boolean;
  signIn: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
  syncNow: () => void;
}

/** Idle re-sync cadence. Bursts are driven by events, not by this. */
const PERIODIC_SYNC_MS = 120_000;

export function useSync(): UseSyncResult {
  const configured = isSupabaseConfigured();
  const online = useOnlineStatus();

  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<SyncStatus>(INITIAL_SYNC_STATUS);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const syncing = useRef(false);

  // ---- session -----------------------------------------------------------
  useEffect(() => {
    if (!configured) return;
    // `onAuthStateChange` fires immediately with the restored session, so this
    // covers both the initial read and every later transition.
    return onAuthChange((session) => {
      const nextUser = session?.user ?? null;
      setUser(nextUser);
      // Outbox recording follows the session exactly: signed out, mutations
      // leave no trace to upload.
      setSyncEnabled(Boolean(nextUser));
      getEngine().setUser(nextUser?.id ?? null);
      if (nextUser) setPendingEmail(null);
    });
  }, [configured]);

  // ---- engine status -----------------------------------------------------
  useEffect(() => {
    if (!configured) return;
    return getEngine().subscribe(setStatus);
  }, [configured]);

  const syncNow = useCallback(() => {
    if (!configured || syncing.current) return;
    syncing.current = true;
    void getEngine()
      .run()
      .finally(() => {
        syncing.current = false;
      });
  }, [configured]);

  // ---- when to sync ------------------------------------------------------
  // Three triggers: signing in, coming back online, and a slow heartbeat.
  // Anything more aggressive would spend a phone's battery and data plan
  // re-checking a server that has nothing new.
  useEffect(() => {
    if (!configured || !user || !online) return;

    syncNow();
    const interval = setInterval(syncNow, PERIODIC_SYNC_MS);

    // A tab returning to the foreground is the moment a stale view is most
    // visible, so it is worth one extra reconciliation.
    const onVisible = () => {
      if (document.visibilityState === 'visible') syncNow();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [configured, user, online, syncNow]);

  const signIn = useCallback(async (email: string) => {
    setSending(true);
    setAuthError(null);
    try {
      const { error } = await sendMagicLink(email);
      if (error) {
        setAuthError(error);
        setPendingEmail(null);
      } else {
        setPendingEmail(email.trim());
      }
    } finally {
      setSending(false);
    }
  }, []);

  const signOut = useCallback(async () => {
    await authSignOut();
    setUser(null);
    setPendingEmail(null);
    setSyncEnabled(false);
    getEngine().setUser(null);
    setStatus(INITIAL_SYNC_STATUS);
  }, []);

  return {
    user,
    status,
    configured,
    pendingEmail,
    authError,
    sending,
    signIn,
    signOut,
    syncNow,
  };
}
