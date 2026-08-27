'use client';

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import { Crosshair, Info, MapPinOff } from 'lucide-react';
import { TopBar } from '@/components/layout/TopBar';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/Button';
import { Panel } from '@/components/ui/Panel';
import { EntityLabel } from '@/components/ui/EntityLabel';
import { TacticalMap, type MapLayers, type MapMarker } from './TacticalMap';
import { getRepository } from '@/lib/store';
import { useRepositoryQuery } from '@/hooks/useRepositoryQuery';
import { useSettings } from '@/hooks/useSettings';
import { useGeolocation } from '@/hooks/useGeolocation';
import { boundsOf, centerOf, zoomForBounds, type LatLon } from '@/lib/geo';
import { formatCoord, formatRelative } from '@/lib/format';
import { cn } from '@/lib/cn';

/**
 * MAP — where observations were made.
 *
 * The honesty constraint that shapes this entire screen: FLOCKRAFT knows where
 * the *camera* was, not where the *subject* was. A single uncalibrated camera
 * cannot recover a subject's world position, and pretending otherwise would be
 * the most dangerous thing this product could do. So:
 *
 *   - markers are placed at the device's recorded position
 *   - the notice below states this explicitly and cannot be dismissed
 *   - camera-frame movement is never drawn as a geographic track
 *   - when no fix was recorded, nothing is plotted — no interpolation, no
 *     last-known-position fallback
 */
const DEFAULT_LAYERS: MapLayers = {
  base: true,
  observations: true,
  tracks: false,
  zones: true,
  heatmap: false,
};

export function MapScreen() {
  const { settings } = useSettings();
  const geo = useGeolocation(settings.saveLocation);
  const [layers, setLayers] = useState<MapLayers>(DEFAULT_LAYERS);
  const [view, setView] = useState<{ center: LatLon; zoom: number } | null>(null);
  const [selected, setSelected] = useState<MapMarker[] | null>(null);

  const query = useCallback(async () => {
    const repository = getRepository();
    const events = await repository.listTimeline({ limit: 500 });
    return events.filter((event) => event.location);
  }, []);

  const { data, loading } = useRepositoryQuery(query);
  const located = useMemo(() => data ?? [], [data]);

  /**
   * One marker per entity, positioned at its most recent located sighting.
   * Plotting every sighting would stack dozens of identical markers on the same
   * few metres and tell the operator nothing.
   */
  const markers = useMemo<MapMarker[]>(() => {
    const byEntity = new Map<string, MapMarker>();
    for (const event of located) {
      if (!event.location) continue;
      const existing = byEntity.get(event.entityId);
      if (existing) {
        existing.count += 1;
        continue;
      }
      byEntity.set(event.entityId, {
        id: event.entityId,
        position: { latitude: event.location.latitude, longitude: event.location.longitude },
        kind: event.kind,
        label: event.entityLabel,
        count: 1,
      });
    }
    return [...byEntity.values()];
  }, [located]);

  /**
   * The view that fits all available data. Derived rather than written into
   * state on load: once the operator pans or zooms, `view` takes over and this
   * is simply no longer consulted, so there is no window in which a late-
   * arriving marker yanks the map out from under them.
   */
  const fittedView = useMemo(() => {
    const points = markers.map((marker) => marker.position);
    if (geo.fix) points.push({ latitude: geo.fix.latitude, longitude: geo.fix.longitude });
    const bounds = boundsOf(points);
    if (!bounds) return null;
    return { center: centerOf(bounds), zoom: zoomForBounds(bounds, 640, 480) };
  }, [markers, geo.fix]);

  const activeView = view ?? fittedView;

  const recenter = useCallback(() => {
    if (geo.fix) {
      setView({ center: { latitude: geo.fix.latitude, longitude: geo.fix.longitude }, zoom: 16 });
      return;
    }
    const bounds = boundsOf(markers.map((marker) => marker.position));
    if (bounds) setView({ center: centerOf(bounds), zoom: zoomForBounds(bounds, 640, 480) });
  }, [geo.fix, markers]);

  const hasAnything = markers.length > 0 || Boolean(geo.fix);

  return (
    <>
      <TopBar
        title="MAP"
        status={
          <StatusBadge
            tone={geo.status === 'active' ? 'live' : geo.status === 'denied' ? 'fault' : 'idle'}
            size="sm"
            pulse={geo.status === 'active'}
          >
            {settings.saveLocation ? geo.status : 'location off'}
          </StatusBadge>
        }
      >
        <div className="fk-rail flex gap-1.5 overflow-x-auto border-t border-hairline/60 px-3 py-2 lg:px-5">
          {LAYER_TOGGLES.map((toggle) => {
            const active = layers[toggle.key];
            const available = toggle.key !== 'tracks';
            return (
              <button
                key={toggle.key}
                type="button"
                aria-pressed={active}
                disabled={!available}
                title={available ? undefined : toggle.unavailableReason}
                onClick={() => setLayers((current) => ({ ...current, [toggle.key]: !active }))}
                className={cn(
                  'min-h-9 shrink-0 rounded-xs border px-3 font-mono text-[10px] tracking-[0.12em] uppercase transition-colors',
                  !available && 'cursor-not-allowed opacity-35',
                  active
                    ? 'border-tactical/45 bg-tactical/12 text-tactical'
                    : 'border-hairline bg-gunmetal text-slate hover:text-bone',
                )}
              >
                {toggle.label}
              </button>
            );
          })}
        </div>
      </TopBar>

      {/* The distinction between camera-space and geographic movement is not
          dismissible — it is the load-bearing caveat of this screen. */}
      <div className="flex items-start gap-2 border-b border-hairline bg-charcoal px-3 py-2 lg:px-5">
        <Info aria-hidden className="mt-0.5 size-3.5 shrink-0 text-slate" />
        <p className="text-[11px] leading-relaxed text-ash">
          Markers show where the <span className="text-bone">camera</span> was when an observation
          was recorded — not the subject&apos;s position. Movement within the camera frame is not
          geographic movement.
        </p>
      </div>

      {!settings.saveLocation ? (
        <EmptyState
          icon={<MapPinOff aria-hidden className="size-5" />}
          title="Location capture is off"
          description="Enable location in privacy settings to record where observations were made. Existing observations will not gain a position retroactively."
          action={
            <Link href="/settings">
              <Button variant="primary">Open privacy settings</Button>
            </Link>
          }
        />
      ) : geo.status === 'denied' ? (
        <EmptyState
          tone="fault"
          icon={<MapPinOff aria-hidden className="size-5" />}
          title="Location access denied"
          description="Grant location permission in your browser settings to plot observations."
        />
      ) : !hasAnything && !loading ? (
        <EmptyState
          icon={<MapPinOff aria-hidden className="size-5" />}
          title="No located observations"
          description="Observations recorded while location capture was enabled will appear here."
        />
      ) : (
        <div className="relative">
          <TacticalMap
            className="h-[calc(100dvh-var(--nav-height)-220px)] min-h-[360px] lg:h-[calc(100dvh-200px)]"
            markers={markers}
            operator={geo.fix ? { latitude: geo.fix.latitude, longitude: geo.fix.longitude } : null}
            operatorAccuracy={geo.fix?.accuracy}
            center={activeView?.center ?? { latitude: 0, longitude: 0 }}
            zoom={activeView?.zoom ?? 12}
            layers={layers}
            onViewChange={setView}
            onSelectMarker={setSelected}
          />

          <button
            type="button"
            onClick={recenter}
            aria-label="Recenter map"
            className="fk-tap absolute top-3 right-3 inline-flex items-center justify-center rounded-sm border border-hairline bg-abyss/80 text-ash backdrop-blur-sm hover:text-bone"
          >
            <Crosshair aria-hidden className="size-4" />
          </button>

          {selected && selected.length > 0 && (
            <div className="absolute inset-x-3 bottom-3">
              <Panel tone="glass" className="p-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="fk-label">
                    {selected.length === 1
                      ? 'Observation'
                      : `${selected.length} entities at this position`}
                  </span>
                  <button
                    type="button"
                    onClick={() => setSelected(null)}
                    className="font-mono text-[10px] text-slate uppercase hover:text-bone"
                  >
                    Dismiss
                  </button>
                </div>

                <p className="tabular mt-2 font-mono text-[10px] text-ash">
                  {selected[0] &&
                    `${formatCoord(selected[0].position.latitude, 'lat')} ${formatCoord(
                      selected[0].position.longitude,
                      'lon',
                    )}`}
                </p>

                {/* Capped and scrollable: a busy position can hold many
                    entities, and the panel must not grow over the map. */}
                <ul className="mt-2 max-h-40 divide-y divide-hairline overflow-y-auto">
                  {selected.map((marker) => (
                    <li key={marker.id}>
                      <Link
                        href={`/entities/${marker.id}`}
                        className="flex items-center justify-between gap-3 py-2 transition-colors hover:bg-gunmetal/60"
                      >
                        <EntityLabel label={marker.label} kind={marker.kind} size="sm" />
                        <span className="tabular font-mono text-[10px] text-slate">
                          {marker.count} {marker.count === 1 ? 'sighting' : 'sightings'}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </Panel>
            </div>
          )}
        </div>
      )}

      {geo.fix && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-hairline px-3 py-2 lg:px-5">
          <span className="tabular font-mono text-[10px] text-ash">
            <span className="text-shadowtext">POS</span> {formatCoord(geo.fix.latitude, 'lat')}{' '}
            {formatCoord(geo.fix.longitude, 'lon')}
          </span>
          <span className="tabular font-mono text-[10px] text-ash">
            <span className="text-shadowtext">ACC</span> ±{Math.round(geo.fix.accuracy)}m
          </span>
          <span className="tabular font-mono text-[10px] text-slate">
            {formatRelative(geo.fix.timestamp)}
          </span>
        </div>
      )}
    </>
  );
}

const LAYER_TOGGLES: Array<{
  key: keyof MapLayers;
  label: string;
  unavailableReason?: string;
}> = [
  { key: 'base', label: 'Base map' },
  { key: 'observations', label: 'Observations' },
  {
    key: 'tracks',
    label: 'Tracks',
    unavailableReason:
      'Geographic tracks require a subject position, which a single camera cannot determine.',
  },
  { key: 'zones', label: 'Zones' },
  { key: 'heatmap', label: 'Heatmap' },
];
