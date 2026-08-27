'use client';

import { useCallback, useState } from 'react';
import { AlertTriangle, Eye, HardDrive, ShieldCheck } from 'lucide-react';
import { TopBar } from '@/components/layout/TopBar';
import { Panel, Divider, SectionLabel } from '@/components/ui/Panel';
import { Toggle } from '@/components/ui/Controls';
import { Button } from '@/components/ui/Button';
import { Sheet } from '@/components/ui/Sheet';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { TelemetryValue } from '@/components/ui/TelemetryValue';
import { useSettings } from '@/hooks/useSettings';
import { useRepositoryQuery } from '@/hooks/useRepositoryQuery';
import { getRepository } from '@/lib/store';
import { isSupabaseConfigured } from '@/lib/supabase';
import { SyncPanel } from './SyncPanel';
import { formatBytes } from '@/lib/format';

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
export function SettingsScreen() {
  const { settings, update, reset } = useSettings();
  const [purgeOpen, setPurgeOpen] = useState(false);
  const [busy, setBusy] = useState(false);

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
            description="Store a representative thumbnail per sighting, roughly 4–8 KB each."
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
        </Panel>

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
        </Panel>

        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="secondary" onClick={refresh} icon={<HardDrive aria-hidden className="size-3.5" />}>
            Refresh usage
          </Button>
          <Button variant="secondary" onClick={reset}>
            Reset preferences
          </Button>
          <Button
            variant="danger"
            onClick={() => setPurgeOpen(true)}
            icon={<AlertTriangle aria-hidden className="size-3.5" />}
          >
            Delete all data
          </Button>
        </div>

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
    </>
  );
}
