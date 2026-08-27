'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { ChevronDown, Download, History, Radio } from 'lucide-react';
import { TopBar } from '@/components/layout/TopBar';
import { Panel, SectionLabel } from '@/components/ui/Panel';
import { Button, buttonClasses } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Thumbnail } from '@/components/ui/Thumbnail';
import { EntityLabel } from '@/components/ui/EntityLabel';
import { useRepositoryQuery } from '@/hooks/useRepositoryQuery';
import { useNow } from '@/hooks/useNow';
import { getRepository } from '@/lib/store';
import { buildSessionReports, collectSessionExport, type SessionReport } from '@/lib/sessionReport';
import { buildArtifact, downloadArtifact } from '@/lib/export';
import { formatDuration, formatRelative } from '@/lib/format';
import { logError } from '@/lib/logger';
import { cn } from '@/lib/cn';

/**
 * SESSIONS — what each recording run actually produced.
 *
 * Sessions were recorded from the first release and never shown anywhere, so
 * stopping a recording produced silence: the operator had watched a door for an
 * hour and the app said nothing about it. Everything here is derived from
 * records already stored; nothing new is written.
 *
 * The report answers the three questions asked at the end of a session, in the
 * order they are asked: how long was I recording, who did I see, and which of
 * them had I seen before. Returning subjects are the interesting ones — a new
 * face is a row in a list, a returning one is a pattern — so they are called
 * out rather than left for the reader to work out from timestamps.
 */
export function SessionsScreen() {
  const query = useCallback(() => buildSessionReports(getRepository(), 60), []);
  const { data: reports, loading } = useRepositoryQuery(query);
  const [openId, setOpenId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const now = useNow();

  const exportSession = useCallback(async (sessionId: string) => {
    setBusyId(sessionId);
    try {
      const bundle = await collectSessionExport(getRepository(), sessionId);
      if (!bundle || bundle.sightings.length === 0) {
        setToast('Nothing recorded in that session');
        return;
      }
      const artifact = buildArtifact(bundle, 'sightings-csv');
      downloadArtifact(artifact);
      setToast(`${artifact.filename} — ${bundle.sightings.length} sightings`);
    } catch (error) {
      logError('store', error);
      setToast('Export failed');
    } finally {
      setBusyId(null);
    }
  }, []);

  const sessions = reports ?? [];
  // A session that recorded nothing is noise in a review screen — the operator
  // pointed a camera at an empty room. They stay counted, not listed.
  const withActivity = sessions.filter((report) => report.totals.sightings > 0);
  const emptyCount = sessions.length - withActivity.length;

  return (
    <>
      <TopBar
        title="SESSIONS"
        status={
          <StatusBadge tone="idle" size="sm">
            {sessions.length ? `${sessions.length} recorded` : 'None yet'}
          </StatusBadge>
        }
      />

      <div className="px-3 pb-10 lg:px-5">
        {loading && sessions.length === 0 ? (
          <p className="px-1 py-8 font-mono text-[11px] text-slate">Reading sessions…</p>
        ) : withActivity.length === 0 ? (
          <div className="py-10">
            <EmptyState
              icon={<History aria-hidden className="size-5" />}
              title={sessions.length ? 'No sessions with observations' : 'No sessions yet'}
              description={
                sessions.length
                  ? `${sessions.length} session${sessions.length === 1 ? '' : 's'} recorded nothing. Start the camera and let a subject stay in frame past the dwell threshold.`
                  : 'Every time you run the camera, FLOCKRAFT records the session here — how long, what was seen, and who had been seen before.'
              }
              action={
                <Link href="/" className={buttonClasses({ variant: 'primary' })}>
                  Go to live
                </Link>
              }
            />
          </div>
        ) : (
          <>
            <SectionLabel className="mt-4">Recordings</SectionLabel>
            <ul className="flex flex-col gap-2">
              {withActivity.map((report) => (
                <li key={report.session.id}>
                  <SessionCard
                    report={report}
                    open={openId === report.session.id}
                    busy={busyId === report.session.id}
                    onToggle={() =>
                      setOpenId((current) =>
                        current === report.session.id ? null : report.session.id,
                      )
                    }
                    now={now}
                    onExport={() => void exportSession(report.session.id)}
                  />
                </li>
              ))}
            </ul>

            {emptyCount > 0 && (
              <p className="mt-3 px-1 text-[11px] leading-relaxed text-slate">
                {emptyCount} further session{emptyCount === 1 ? '' : 's'} recorded no observations
                and {emptyCount === 1 ? 'is' : 'are'} not listed.
              </p>
            )}
          </>
        )}
      </div>

      {toast && (
        <div
          role="status"
          className="fixed inset-x-0 bottom-[calc(var(--nav-height)+var(--safe-bottom)+12px)] z-40 mx-auto w-fit rounded-sm border border-hairline bg-charcoal px-3 py-2 font-mono text-[10px] tracking-[0.12em] text-bone uppercase lg:bottom-6"
          onAnimationEnd={() => setToast(null)}
        >
          <span className="inline-flex items-center gap-2">
            <Radio aria-hidden className="size-3 text-tactical" />
            {toast}
          </span>
        </div>
      )}
    </>
  );
}

function SessionCard({
  report,
  open,
  busy,
  now,
  onToggle,
  onExport,
}: {
  report: SessionReport;
  open: boolean;
  busy: boolean;
  /** Ticking clock from `useNow`; 0 until the first tick. */
  now: number;
  onToggle: () => void;
  onExport: () => void;
}) {
  const { session, totals } = report;
  const started = new Date(session.startedAt);
  const panelId = `session-${session.id}`;

  // Only a session with no end time *and* recent activity is plausibly still
  // running. Without the recency test this would light up every session the
  // operator ended by closing the tab, which is most of them.
  const live = report.unfinished && now > 0 && now - report.lastActivityAt < 2 * 60_000;

  return (
    <Panel tone="raised" className="overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex w-full items-start gap-3 px-3 py-3 text-left"
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="font-mono text-[12px] tracking-[0.08em] text-bone">
              {started.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
              {' · '}
              {started.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
            </span>
            <span className="tabular font-mono text-[11px] text-tactical">
              {formatDuration(report.durationMs)}
            </span>
            {live && (
              <StatusBadge tone="live" pulse size="sm">
                In progress
              </StatusBadge>
            )}
          </div>

          <p className="mt-1.5 text-[12px] leading-relaxed text-ash">
            <span className="text-bone">{totals.subjects}</span> subject
            {totals.subjects === 1 ? '' : 's'}
            {totals.returningSubjects > 0 && (
              <>
                {' · '}
                <span className="text-caution">{totals.returningSubjects} returning</span>
              </>
            )}
            {totals.newSubjects > 0 && <> · {totals.newSubjects} new</>}
            {' · '}
            {totals.sightings} sighting{totals.sightings === 1 ? '' : 's'}
          </p>

          <p className="mt-1 font-mono text-[10px] tracking-[0.1em] text-slate uppercase">
            {[
              session.facingMode === 'user' ? 'Front camera' : session.facingMode === 'environment' ? 'Rear camera' : null,
              session.deviceLabel,
              session.detectorId,
              formatRelative(session.startedAt, now),
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>

        <ChevronDown
          aria-hidden
          className={cn(
            'mt-0.5 size-4 shrink-0 text-slate transition-transform',
            open ? 'rotate-180' : '',
          )}
        />
      </button>

      {open && (
        <div id={panelId} className="border-t border-hairline">
          <ul className="divide-y divide-hairline">
            {report.subjects.map((subject) => (
              <li key={subject.entity.id}>
                <Link
                  href={`/entities/${subject.entity.id}`}
                  className="flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-gunmetal"
                >
                  <Thumbnail
                    mediaId={subject.entity.thumbnailId}
                    kind={subject.entity.kind}
                    alt={subject.entity.label}
                    size={44}
                  />
                  <div className="min-w-0 flex-1">
                    <EntityLabel
                      label={subject.entity.label}
                      kind={subject.entity.kind}
                      size="sm"
                    />
                    <p className="mt-1 font-mono text-[10px] tracking-[0.08em] text-slate">
                      {subject.sightings} sighting{subject.sightings === 1 ? '' : 's'} ·{' '}
                      {formatDuration(subject.dwellMs)} in view
                    </p>
                  </div>
                  {/* Returning is the signal worth surfacing; new is the default
                      and would only add noise if labelled on every row. */}
                  {!subject.isNew && (
                    <StatusBadge tone="caution" size="sm">
                      Returning
                    </StatusBadge>
                  )}
                </Link>
              </li>
            ))}
          </ul>

          <div className="flex flex-wrap gap-2 border-t border-hairline px-3 py-3">
            <Button
              variant="secondary"
              disabled={busy}
              onClick={onExport}
              icon={<Download aria-hidden className="size-3.5" />}
            >
              {busy ? 'Preparing…' : 'Export this session'}
            </Button>
          </div>
        </div>
      )}
    </Panel>
  );
}
