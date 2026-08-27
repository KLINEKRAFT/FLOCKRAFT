import type { ObservationRepository, PurgeResult } from '@/lib/store';
import { isPurgeEmpty } from '@/lib/store';
import type { FlockraftSettings } from '@/lib/settings';

/**
 * RETENTION
 * ---------------------------------------------------------------------------
 * Applies the operator's retention windows.
 *
 * A store that only ever grows turns a decision made casually on a Tuesday
 * into a permanent one. Retention is how a choice about what to keep stays a
 * choice rather than becoming an accident of never having deleted anything.
 *
 * Two properties matter more than the sweep itself:
 *
 *   Opt-in. Both windows default to "never". Nothing here deletes a record
 *   until the operator has picked a window, because a default that quietly
 *   destroyed observations they had been collecting would be indefensible
 *   however sensible the number.
 *
 *   Idempotent and cheap when idle. The sweep runs on load and is throttled,
 *   so opening the app forty times in an afternoon does not scan storage forty
 *   times, and a sweep with nothing to remove costs one pass and no writes.
 */

const LAST_SWEEP_KEY = 'flockraft.retention.lastSweep';

/** Minimum gap between sweeps. Retention is measured in days; hourly is ample. */
export const SWEEP_INTERVAL_MS = 60 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

export function cutoffsFor(settings: FlockraftSettings, now: number) {
  return {
    observationsBefore: settings.retentionDays > 0 ? now - settings.retentionDays * DAY_MS : 0,
    faceEmbeddingsBefore:
      settings.faceRetentionDays > 0 ? now - settings.faceRetentionDays * DAY_MS : 0,
  };
}

export function retentionEnabled(settings: FlockraftSettings): boolean {
  return settings.retentionDays > 0 || settings.faceRetentionDays > 0;
}

/**
 * Runs a sweep if one is due. Returns what was removed, or null when the sweep
 * was skipped — either because no window is set or because one ran recently.
 */
export async function sweepIfDue(
  repository: ObservationRepository,
  settings: FlockraftSettings,
  now: number,
  options: { force?: boolean } = {},
): Promise<PurgeResult | null> {
  if (!retentionEnabled(settings)) return null;
  if (!options.force && !isDue(now)) return null;

  // Stamped before the sweep, not after: a sweep that throws must not retry on
  // every subsequent load, hammering storage while never succeeding.
  markSwept(now);

  const result = await repository.purgeExpired(cutoffsFor(settings, now));
  return isPurgeEmpty(result) ? null : result;
}

function isDue(now: number): boolean {
  try {
    const raw = window.localStorage.getItem(LAST_SWEEP_KEY);
    const last = raw ? Number.parseInt(raw, 10) : 0;
    if (!Number.isFinite(last)) return true;
    return now - last >= SWEEP_INTERVAL_MS;
  } catch {
    // Storage unavailable: sweep, rather than never sweeping at all.
    return true;
  }
}

function markSwept(now: number): void {
  try {
    window.localStorage.setItem(LAST_SWEEP_KEY, String(now));
  } catch {
    // The sweep still runs; it simply is not throttled on this device.
  }
}

/** Human summary of a sweep, for the privacy screen. */
export function describePurge(result: PurgeResult): string {
  const parts: string[] = [];
  if (result.sightings.length) parts.push(`${result.sightings.length} sightings`);
  if (result.entities.length) parts.push(`${result.entities.length} entities`);
  if (result.media.length) parts.push(`${result.media.length} images`);
  if (result.faceEmbeddings.length) parts.push(`${result.faceEmbeddings.length} face signatures`);
  if (result.sessions.length) parts.push(`${result.sessions.length} sessions`);
  return parts.length ? `Removed ${parts.join(', ')}` : 'Nothing was old enough to remove';
}
