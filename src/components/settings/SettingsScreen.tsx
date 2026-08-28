'use client';

import { useCallback, useState } from 'react';
import { AlertTriangle, CalendarClock, Eye, HardDrive, ScanFace, ShieldCheck } from 'lucide-react';
import { TopBar } from '@/components/layout/TopBar';
import { Panel, Divider, SectionLabel } from '@/components/ui/Panel';
import { SegmentedControl, Toggle } from '@/components/ui/Controls';
import { Button } from '@/components/ui/Button';
import { Sheet } from '@/components/ui/Sheet';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { TelemetryValue } from '@/components/ui/TelemetryValue';
import { useSettings } from '@/hooks/useSettings';
import { useRepositoryQuery } from '@/hooks/useRepositoryQuery';
import { getRepository } from '@/lib/store';
import { isSupabaseConfigured } from '@/lib/supabase';
import { SyncPanel } from './SyncPanel';
import { ExportPanel } from './ExportPanel';
import { formatBytes } from '@/lib/format';
import { cn } from '@/lib/cn';
import { RETENTION_CHOICES, RETENTION_LABEL } from '@/lib/settings';
import { describePurge, sweepIfDue } from '@/lib/retention';
import {
  FACE_SENSITIVITY,
  FACE_SENSITIVITY_HINT,
  FACE_SENSITIVITY_LABEL,
  type FaceSensitivity,
} from '@/lib/vision/faceMatcher';

/**
 * PRIVACY & STORAGE
 * ---------------------------------------------------------------------------
 * This screen exists because FLOCKRAFT observes people. Three rules govern it:
 *
 *  1. Every retention decision is visible and reversible in one place.
 *  2. Defaults are conservative — clips, location, face analysis and automatic
 *     entity matching are all off until the operator turns them on.
 *  3. Deletion is easy and complete. Purging is one action away, and it is
 *     genuinely destructive rather than a soft archive.
 */
function RetentionRow({
  label,
  description,
  value,
  onChange,
}: {
  label: string;
  description: string;
  value: number;
  onChange: (days: number) => void;
}) {
  return (
    <div className="px-3 py-3">
      <p className="font-mono text-[11px] tracking-[0.1em] text-bone uppercase">{label}</p>
      <p className="mt-1.5 text-[12px] leading-relaxed text-ash">{description}</p>
      <div
        role="radiogroup"
        aria-label={label}
        className="mt-2.5 flex flex-wrap gap-1.5"
      >
        {RETENTION_CHOICES.map((days) => {
          const active = value === days;
          return (
            <button
              key={days}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(days)}
              className={cn(
                'min-h-11 rounded-sm border px-3 font-mono text-[11px] tracking-[0.1em] uppercase transition-colors',
                active
                  ? 'border-tactical/50 bg-tactical/15 text-tactical'
                  : 'border-hairline bg-gunmetal text-slate hover:text-bone',
              )}
            >
              {RETENTION_LABEL[days]}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function SettingsScreen() {
  const { settings, update, reset } = useSettings();
  const [purgeOpen, setPurgeOpen] = useState(false);
  const [facePurgeOpen, setFacePurgeOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sweepNote, setSweepNote] = useState<string | null>(null);

  const usageQuery = useCallback(() => getRepository().usage(), []);
  const { data: usage, refresh } = useRepositoryQuery(usageQuery);

  const purge = useCallback(async () => {
    setBusy(true);
    try {
      await getRepository().purgeAll();
      setPurgeOpen(false);
      refresh();
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  const purgeFaces = useCallback(async () => {
    setBusy(true);
    try {
      await getRepository().purgeFaceEmbeddings();
      setFacePurgeOpen(false);
      refresh();
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  // Runs the sweep immediately rather than waiting for the next scheduled one,
  // so choosing a window has a visible, verifiable effect right away.
  const sweepNow = useCallback(async () => {
    setBusy(true);
    try {
      const result = await sweepIfDue(getRepository(), settings, Date.now(), { force: true });
      setSweepNote(result ? describePurge(result) : 'Nothing was old enough to remove');
      refresh();
    } finally {
      setBusy(false);
    }
  }, [refresh, settings]);

  return (
    <>
      <TopBar
        title="SETTINGS"
        showSettings={false}
        status={
          <StatusBadge tone="idle" size="sm">
            {isSupabaseConfigured() ? 'Sync available' : 'Local only'}
          </StatusBadge>
        }
      />

      <div className="px-3 pb-10 lg:px-5">
        {/* ---- Where data lives ---- */}
        <Panel tone="raised" className="mt-4 p-3">
          <div className="flex items-start gap-3">
            <ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-tactical" />
            <div>
              <p className="font-mono text-[11px] tracking-[0.1em] text-bone uppercase">
                Data stays on this device
              </p>
              <p className="mt-1.5 text-[12px] leading-relaxed text-ash">
                Observations, images and notes are stored in this browser&apos;s local database.
                Detection runs on-device — camera frames are never uploaded.
                {isSupabaseConfigured()
                  ? ' A sync backend is configured; data is only transmitted once you sign in.'
                  : ' No sync backend is configured, so nothing leaves this device.'}
              </p>
            </div>
          </div>
        </Panel>

        {/* ---- Retention ---- */}
        <SectionLabel className="mt-6">Retention</SectionLabel>
        <Panel className="px-3">
          <Toggle
            label="Save observations"
            description="Record sightings, entities and attributes. With this off, FLOCKRAFT is a live viewer only and remembers nothing."
            checked={settings.saveObservations}
            onChange={(saveObservations) => update({ saveObservations })}
          />
          <Divider />
          <Toggle
            label="Save images"
            description="Store a representative thumbnail per sighting. Resolution and its storage cost are set in the detection sheet on the live screen."
            checked={settings.saveImages}
            disabled={!settings.saveObservations}
            onChange={(saveImages) => update({ saveImages })}
          />
          <Divider />
          <Toggle
            label="Save video clips"
            description="Not yet implemented. Clip capture will remain opt-in when it ships."
            checked={settings.saveClips}
            disabled
            onChange={(saveClips) => update({ saveClips })}
          />
          <Divider />
          <Toggle
            label="Save location"
            tone="sensitive"
            description="Attach the device's GPS position to each observation. This records where you were, so it stays off unless you need it."
            checked={settings.saveLocation}
            disabled={!settings.saveObservations}
            onChange={(saveLocation) => update({ saveLocation })}
          />
        </Panel>

        {/* ---- Analysis ---- */}
        <SectionLabel className="mt-6">Analysis</SectionLabel>
        <Panel className="px-3">
          <Toggle
            label="Face analysis"
            tone="sensitive"
            description="Detect face bounding boxes to improve person tracking. FLOCKRAFT does not build a biometric identity database and does not attempt to identify unknown people."
            checked={settings.faceAnalysis}
            onChange={(faceAnalysis) => update({ faceAnalysis })}
          />
          <Divider />
          <Toggle
            label="Auto entity matching"
            tone="sensitive"
            description="Propose matches against previously observed entities. Matches are only ever suggested — binding a sighting to an existing entity always requires your confirmation."
            checked={settings.autoEntityMatching}
            onChange={(autoEntityMatching) => update({ autoEntityMatching })}
          />
          <Divider />
          <Toggle
            label="Face recognition"
            tone="sensitive"
            description="Store a face signature for every person observed, so returning visitors can be recognised on a later day. A face signature is a biometric identifier. Downloads about 7 MB of models the first time. Matches are still only ever suggested — binding one always requires your confirmation."
            checked={settings.faceRecognition}
            disabled={!settings.saveObservations}
            onChange={(faceRecognition) => update({ faceRecognition })}
          />
        </Panel>

        {settings.faceRecognition && (
          <Panel className="mt-2 px-3 py-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="fk-label">Match strictness</p>
                <p className="mt-1 text-[12px] leading-relaxed text-ash">
                  {FACE_SENSITIVITY_HINT[settings.faceSensitivity]}
                </p>
              </div>
              <SegmentedControl<FaceSensitivity>
                label="Face match strictness"
                value={settings.faceSensitivity}
                onChange={(faceSensitivity) => update({ faceSensitivity })}
                options={(Object.keys(FACE_SENSITIVITY) as FaceSensitivity[]).map((level) => ({
                  value: level,
                  label: FACE_SENSITIVITY_LABEL[level],
                }))}
              />
            </div>
            <p className="mt-3 text-[11px] leading-relaxed text-slate">
              The default was calibrated against synthetic faces, which resemble each other more
              than real people do. If you see matches proposed for people who are plainly
              different, move to Strict; if returning visitors are never recognised, try Lenient.
            </p>
          </Panel>
        )}

        {settings.faceRecognition && (
          <div className="mt-2 flex items-start gap-2 px-1">
            <ScanFace aria-hidden className="mt-0.5 size-3 shrink-0 text-caution" />
            <p className="text-[11px] leading-relaxed text-caution">
              Face signatures are stored for everyone observed, including people who never
              return and were never asked. Recognition happens entirely on this device; frames
              are never uploaded. Several states — Illinois, Texas and Washington among them —
              regulate collecting biometric identifiers from members of the public, and some
              require consent beforehand.
            </p>
          </div>
        )}

        <div className="mt-2 flex items-start gap-2 px-1">
          <Eye aria-hidden className="mt-0.5 size-3 shrink-0 text-slate" />
          <p className="text-[11px] leading-relaxed text-slate">
            FLOCKRAFT is designed for user-confirmed identity, not silent recognition. Automatic
            matching is deliberately conservative and will miss real matches rather than assert
            false ones.
          </p>
        </div>

        {/* ---- Storage ---- */}
        <SectionLabel className="mt-6">Storage</SectionLabel>
        <Panel tone="raised">
          <div className="grid grid-cols-2 divide-x divide-y divide-hairline sm:grid-cols-4 sm:divide-y-0">
            <TelemetryValue
              className="px-3 py-3"
              label="Entities"
              value={usage?.entities ?? '—'}
            />
            <TelemetryValue
              className="px-3 py-3"
              label="Sightings"
              value={usage?.sightings ?? '—'}
            />
            <TelemetryValue className="px-3 py-3" label="Images" value={usage?.media ?? '—'} />
            <TelemetryValue
              className="px-3 py-3"
              label="Face signatures"
              value={usage?.faceEmbeddings ?? '—'}
            />
            <TelemetryValue
              className="px-3 py-3"
              label="Image data"
              value={usage ? formatBytes(usage.mediaBytes) : '—'}
            />
          </div>
          {usage?.quotaBytes && usage.usageBytes !== undefined && (
            <div className="border-t border-hairline px-3 py-3">
              <div className="mb-2 flex items-baseline justify-between">
                <span className="fk-label">Browser quota</span>
                <span className="tabular font-mono text-[10px] text-ash">
                  {formatBytes(usage.usageBytes)} / {formatBytes(usage.quotaBytes)}
                </span>
              </div>
              <div className="h-1 w-full overflow-hidden bg-gunmetal">
                <div
                  className="h-full bg-tactical"
                  style={{
                    width: `${Math.min(100, (usage.usageBytes / usage.quotaBytes) * 100)}%`,
                  }}
                />
              </div>
            </div>
          )}
          {usage?.persisted !== undefined && (
            <div className="border-t border-hairline px-3 py-3">
              <div className="flex items-baseline justify-between gap-3">
                <span className="fk-label">Durability</span>
                <span
                  className={`font-mono text-[10px] ${usage.persisted ? 'text-tactical' : 'text-ash'}`}
                >
                  {usage.persisted ? 'PERSISTENT' : 'BEST-EFFORT'}
                </span>
              </div>
              <p className="mt-2 text-[12px] leading-relaxed text-slate">
                {usage.persisted
                  ? 'The browser has agreed not to evict this record to reclaim space.'
                  : 'The browser may clear this record to reclaim space. Export anything you need to keep, and installing this app to the home screen makes a durable grant more likely.'}
              </p>
            </div>
          )}
        </Panel>

        <SectionLabel className="mt-6">Retention</SectionLabel>
        <Panel className="divide-y divide-hairline">
          <RetentionRow
            label="Delete observations older than"
            description="Sightings, sessions and their images. Favourited subjects and any subject you have written a note on are never removed."
            value={settings.retentionDays}
            onChange={(retentionDays) => update({ retentionDays })}
          />
          <RetentionRow
            label="Delete face signatures older than"
            description="Biometric templates only. Removing them does not remove the subject, their sightings or their images."
            value={settings.faceRetentionDays}
            onChange={(faceRetentionDays) => update({ faceRetentionDays })}
          />
        </Panel>

        <div className="mt-2 flex items-start gap-2 px-1">
          <CalendarClock aria-hidden className="mt-0.5 size-3 shrink-0 text-slate" />
          <p className="text-[11px] leading-relaxed text-slate">
            Both default to Never — nothing is deleted until you choose a window. A sweep runs
            when the app opens, at most once an hour. Deletions sync, so a window set here
            applies to your account on every signed-in device.
          </p>
        </div>

        {(settings.retentionDays > 0 || settings.faceRetentionDays > 0) && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button variant="secondary" disabled={busy} onClick={() => void sweepNow()}>
              {busy ? 'Sweeping…' : 'Run sweep now'}
            </Button>
            {sweepNote && (
              <span role="status" className="font-mono text-[11px] text-tactical">
                {sweepNote}
              </span>
            )}
          </div>
        )}

        <div className="mt-6 flex flex-wrap gap-2">
          <Button variant="secondary" onClick={refresh} icon={<HardDrive aria-hidden className="size-3.5" />}>
            Refresh usage
          </Button>
          <Button variant="secondary" onClick={reset}>
            Reset preferences
          </Button>
          {(usage?.faceEmbeddings ?? 0) > 0 && (
            <Button
              variant="danger"
              onClick={() => setFacePurgeOpen(true)}
              icon={<ScanFace aria-hidden className="size-3.5" />}
            >
              Delete face signatures
            </Button>
          )}
          <Button
            variant="danger"
            onClick={() => setPurgeOpen(true)}
            icon={<AlertTriangle aria-hidden className="size-3.5" />}
          >
            Delete all data
          </Button>
        </div>

        <ExportPanel />

        <SyncPanel />
      </div>

      <Sheet
        open={purgeOpen}
        onClose={() => setPurgeOpen(false)}
        title="Delete all data"
        footer={
          <div className="flex gap-2">
            <Button variant="secondary" fullWidth onClick={() => setPurgeOpen(false)}>
              Cancel
            </Button>
            <Button variant="danger" fullWidth disabled={busy} onClick={() => void purge()}>
              Delete everything
            </Button>
          </div>
        }
      >
        <div className="p-4">
          <p className="text-[13px] leading-relaxed text-ash">
            This permanently removes every entity, sighting, attribute, note, association, session
            and stored image from this device. It cannot be undone and there is no backup.
          </p>
          {usage && (
            <ul className="mt-4 flex flex-col gap-1 font-mono text-[11px] text-slate">
              <li>{usage.entities} entities</li>
            <li>{usage.faceEmbeddings} face signatures</li>
              <li>{usage.sightings} sightings</li>
              <li>
                {usage.media} images ({formatBytes(usage.mediaBytes)})
              </li>
              <li>{usage.notes} notes</li>
              <li>{usage.sessions} sessions</li>
            </ul>
          )}
        </div>
      </Sheet>

      <Sheet
        open={facePurgeOpen}
        onClose={() => setFacePurgeOpen(false)}
        title="Delete face signatures"
        footer={
          <div className="flex gap-2">
            <Button variant="secondary" fullWidth onClick={() => setFacePurgeOpen(false)}>
              Cancel
            </Button>
            <Button variant="danger" fullWidth disabled={busy} onClick={() => void purgeFaces()}>
              Delete signatures
            </Button>
          </div>
        }
      >
        <div className="p-4">
          <p className="text-[13px] leading-relaxed text-ash">
            This removes every stored face signature — {usage?.faceEmbeddings ?? 0} of them —
            from this device and from sync. Entities, sightings, notes and images are all kept;
            only the biometric data is destroyed.
          </p>
          <p className="mt-3 text-[13px] leading-relaxed text-ash">
            Recognition of returning subjects stops working until new signatures accumulate. If
            you also want to stop collecting them, turn off face recognition above — deleting
            alone does not.
          </p>
        </div>
      </Sheet>
    </>
  );
}
