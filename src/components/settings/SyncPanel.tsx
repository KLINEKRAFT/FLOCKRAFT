'use client';

import { useState } from 'react';
import { CloudOff, LogOut, Mail, RefreshCw } from 'lucide-react';
import { Panel, Divider, SectionLabel } from '@/components/ui/Panel';
import { Button } from '@/components/ui/Button';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { useSync } from '@/hooks/useSync';
import { isPlausibleEmail } from '@/lib/auth';
import { formatRelative } from '@/lib/format';
import { useNow } from '@/hooks/useNow';

/**
 * SYNC & ACCOUNT
 * ---------------------------------------------------------------------------
 * Sync is presented as what it actually is: an addition, not a requirement.
 * FLOCKRAFT works signed out, and the copy here says so rather than implying
 * the app is half-configured without an account.
 *
 * The pending count is surfaced deliberately. "How far behind is this device"
 * is the one thing an operator needs to know before walking out of signal, and
 * hiding it behind a spinner would be a worse answer than a number.
 */
export function SyncPanel() {
  const { user, status, configured, pendingEmail, authError, sending, signIn, signOut, syncNow } =
    useSync();
  const [email, setEmail] = useState('');
  const now = useNow(15_000);

  if (!configured) {
    return (
      <>
        <SectionLabel className="mt-6">Sync</SectionLabel>
        <Panel className="p-3">
          <div className="flex items-start gap-3">
            <CloudOff aria-hidden className="mt-0.5 size-4 shrink-0 text-slate" />
            <div>
              <p className="font-mono text-[11px] tracking-[0.1em] text-bone uppercase">
                Not configured
              </p>
              <p className="mt-1.5 text-[12px] leading-relaxed text-ash">
                This deployment has no sync backend, so observations stay on this device only.
                Everything else works normally.
              </p>
            </div>
          </div>
        </Panel>
      </>
    );
  }

  return (
    <>
      <SectionLabel
        className="mt-6"
        action={
          user ? (
            <StatusBadge
              tone={
                status.phase === 'error'
                  ? 'fault'
                  : status.phase === 'idle'
                    ? 'nominal'
                    : 'live'
              }
              size="sm"
              pulse={status.phase === 'pushing' || status.phase === 'pulling'}
            >
              {status.phase === 'idle' ? 'Synced' : status.phase}
            </StatusBadge>
          ) : (
            <StatusBadge tone="idle" size="sm">
              Local only
            </StatusBadge>
          )
        }
      >
        Sync
      </SectionLabel>

      {!user ? (
        <Panel className="p-3">
          <p className="text-[12px] leading-relaxed text-ash">
            FLOCKRAFT works fully signed out. Sign in only if you want observations backed up and
            available on another device. We send a one-time link — there is no password.
          </p>

          {pendingEmail ? (
            <div className="mt-3 rounded-sm border border-tactical/35 bg-tactical-wash p-3">
              <p className="font-mono text-[11px] tracking-[0.1em] text-tactical uppercase">
                Link sent
              </p>
              <p className="mt-1.5 text-[12px] leading-relaxed text-ash">
                Open the link in <span className="text-bone">{pendingEmail}</span> on this device to
                finish signing in. It expires shortly.
              </p>
              <Button
                className="mt-3"
                size="sm"
                variant="secondary"
                onClick={() => void signIn(pendingEmail)}
                disabled={sending}
              >
                Resend
              </Button>
            </div>
          ) : (
            <form
              className="mt-3 flex flex-col gap-2 sm:flex-row"
              onSubmit={(event) => {
                event.preventDefault();
                void signIn(email);
              }}
            >
              <label htmlFor="sync-email" className="sr-only">
                Email address
              </label>
              <input
                id="sync-email"
                type="email"
                inputMode="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                className="h-11 flex-1 rounded-sm border border-hairline bg-abyss px-3 text-[13px] text-bone placeholder:text-shadowtext focus:border-tactical/40"
              />
              <Button
                type="submit"
                variant="primary"
                disabled={sending || !isPlausibleEmail(email)}
                icon={<Mail aria-hidden className="size-3.5" />}
              >
                {sending ? 'Sending' : 'Send link'}
              </Button>
            </form>
          )}

          {authError && (
            <p role="alert" className="mt-2 text-[12px] text-alert">
              {authError}
            </p>
          )}
        </Panel>
      ) : (
        <Panel className="px-3">
          <div className="flex items-start justify-between gap-3 py-3">
            <div className="min-w-0">
              <p className="fk-label">Signed in as</p>
              <p className="mt-1 truncate font-mono text-[12px] text-bone">{user.email}</p>
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void signOut()}
              icon={<LogOut aria-hidden className="size-3" />}
            >
              Sign out
            </Button>
          </div>

          <Divider />

          <div className="flex items-center justify-between gap-3 py-3">
            <div>
              <p className="fk-label">Pending upload</p>
              <p className="tabular mt-1 font-mono text-[12px] text-bone">
                {status.pending === 0 ? 'Nothing queued' : `${status.pending} records`}
              </p>
            </div>
            <Button
              size="sm"
              variant="secondary"
              onClick={syncNow}
              disabled={status.phase === 'pushing' || status.phase === 'pulling'}
              icon={<RefreshCw aria-hidden className="size-3" />}
            >
              Sync now
            </Button>
          </div>

          <Divider />

          <div className="flex items-center justify-between gap-3 py-3">
            <p className="fk-label">Last sync</p>
            <p className="tabular font-mono text-[11px] text-ash">
              {status.lastSyncedAt ? formatRelative(status.lastSyncedAt, now) : 'never'}
            </p>
          </div>

          {status.stuck > 0 && (
            <>
              <Divider />
              <p className="py-3 text-[12px] leading-relaxed text-caution">
                {status.stuck} {status.stuck === 1 ? 'record has' : 'records have'} failed to upload
                repeatedly. They remain safe on this device; the last error was{' '}
                <span className="text-bone">{status.error ?? 'unspecified'}</span>.
              </p>
            </>
          )}

          {status.error && status.stuck === 0 && (
            <>
              <Divider />
              <p role="alert" className="py-3 text-[12px] leading-relaxed text-alert">
                {status.error}
              </p>
            </>
          )}
        </Panel>
      )}

      <p className="mt-2 px-1 text-[11px] leading-relaxed text-slate">
        Sync uploads observations, entities, notes and thumbnails to your account. Camera frames are
        never uploaded — only the representative images already stored on this device.
      </p>
    </>
  );
}
