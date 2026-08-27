/**
 * LOGGING
 * ---------------------------------------------------------------------------
 * A single choke point for diagnostics. Two rules:
 *
 *  1. Nothing is transmitted anywhere. FLOCKRAFT observes people; shipping logs
 *     off-device by default would be indefensible. Wiring a remote sink is a
 *     deliberate, opt-in change made here and nowhere else.
 *  2. Debug output is compiled out of production builds, so a hot loop can call
 *     `logDebug` without paying for string construction on a phone.
 */
type Scope = 'camera' | 'pipeline' | 'store' | 'route' | 'sync' | 'model';

const isDev = process.env.NODE_ENV !== 'production';

export function logDebug(scope: Scope, message: string, detail?: unknown): void {
  if (!isDev) return;
  console.debug(`[flockraft:${scope}] ${message}`, detail ?? '');
}

export function logWarn(scope: Scope, message: string, detail?: unknown): void {
  console.warn(`[flockraft:${scope}] ${message}`, detail ?? '');
}

export function logError(scope: Scope, error: unknown, context?: Record<string, unknown>): void {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  console.error(`[flockraft:${scope}] ${message}`, context ?? '');
}
