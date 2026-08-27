/** Formatting helpers. All output is deterministic and locale-stable so that
 *  server and client renders agree (avoids hydration mismatches). */

const TIME_FMT = new Intl.DateTimeFormat('en-US', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: true,
});

const CLOCK_FMT = new Intl.DateTimeFormat('en-US', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

const DATE_FMT = new Intl.DateTimeFormat('en-US', {
  month: 'long',
  day: 'numeric',
  year: 'numeric',
});

const SHORT_DATE_FMT = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });

export const formatTime = (ms: number) => TIME_FMT.format(ms);
export const formatClock = (ms: number) => CLOCK_FMT.format(ms);
export const formatDate = (ms: number) => DATE_FMT.format(ms);
export const formatShortDate = (ms: number) => SHORT_DATE_FMT.format(ms);
export const formatDateTime = (ms: number) => `${DATE_FMT.format(ms)} · ${TIME_FMT.format(ms)}`;

/** `02:14` — minutes and seconds, the unit operators actually read. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Coarse relative time. Deliberately imprecise beyond a day — exact
 *  timestamps are always available on the record itself.
 *
 *  `now` is normally supplied by `useNow`, which reports 0 until its first
 *  tick; a non-positive value falls back to the wall clock so the very first
 *  paint is still correct. */
export function formatRelative(ms: number, now?: number): string {
  const reference = now && now > 0 ? now : Date.now();
  const delta = Math.max(0, reference - ms);
  const seconds = Math.round(delta / 1000);
  if (seconds < 10) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return formatShortDate(ms);
}

/** Confidence as an integer percentage. Never rounded up to 100 from below. */
export function formatConfidence(score: number): string {
  const pct = Math.min(99, Math.max(0, Math.round(score * 100)));
  return `${pct}%`;
}

/** Decimal degrees at ~1 m precision. */
export function formatCoord(value: number, axis: 'lat' | 'lon'): string {
  const hemisphere = axis === 'lat' ? (value >= 0 ? 'N' : 'S') : value >= 0 ? 'E' : 'W';
  return `${Math.abs(value).toFixed(5)}° ${hemisphere}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Day bucket used to group the timeline: TODAY / YESTERDAY / EARLIER. */
export function dayBucket(ms: number, now?: number): 'TODAY' | 'YESTERDAY' | 'EARLIER' {
  const reference = now && now > 0 ? now : Date.now();
  const startOfDay = (t: number) => {
    const d = new Date(t);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  };
  const today = startOfDay(reference);
  const target = startOfDay(ms);
  if (target === today) return 'TODAY';
  if (target === today - 86_400_000) return 'YESTERDAY';
  return 'EARLIER';
}
