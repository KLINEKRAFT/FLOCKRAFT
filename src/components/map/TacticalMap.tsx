'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { EntityKind } from '@/types/domain';
import { KIND_ACCENT } from '@/lib/taxonomy';
import {
  TILE_SIZE,
  formatDistance,
  metersPerPixel,
  project,
  unproject,
  zoomScale,
  type LatLon,
} from '@/lib/geo';
import { cn } from '@/lib/cn';

/**
 * TacticalMap — canvas map renderer.
 *
 * Draw order: raster tiles (when configured) → reference graticule → cluster
 * shading → markers → operator position. Everything is painted into one canvas
 * so a few hundred markers cost one draw call's worth of DOM rather than a few
 * hundred elements.
 *
 * Interaction: pointer drag to pan, wheel and pinch to zoom, keyboard arrows
 * and +/- for accessibility. Pointer Events are used throughout so touch, mouse
 * and stylus share one code path.
 */
export interface MapMarker {
  id: string;
  position: LatLon;
  kind: EntityKind;
  label: string;
  count: number;
}

export interface MapLayers {
  base: boolean;
  observations: boolean;
  tracks: boolean;
  zones: boolean;
  heatmap: boolean;
}

interface TacticalMapProps {
  markers: MapMarker[];
  /** Device position, drawn distinctly from observation markers. */
  operator?: LatLon | null;
  /** Accuracy radius in metres for the operator fix. */
  operatorAccuracy?: number;
  center: LatLon;
  zoom: number;
  layers: MapLayers;
  onViewChange: (view: { center: LatLon; zoom: number }) => void;
  /** Receives every marker in the tapped cluster, not just the topmost. */
  onSelectMarker?: (markers: MapMarker[]) => void;
  className?: string;
}

const TILE_URL = process.env.NEXT_PUBLIC_MAP_TILE_URL ?? '';

export function TacticalMap({
  markers,
  operator,
  operatorAccuracy,
  center,
  zoom,
  layers,
  onViewChange,
  onSelectMarker,
  className,
}: TacticalMapProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  // Tile bitmaps, keyed `z/x/y`. Held in a ref so a load does not re-render.
  const tileCache = useRef(new Map<string, HTMLImageElement>());
  const [tileVersion, setTileVersion] = useState(0);

  const dragState = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const pinchState = useRef<Map<number, { x: number; y: number }>>(new Map());

  /* ---- Sizing ----------------------------------------------------------- */

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(() => {
      setSize({ width: container.clientWidth, height: container.clientHeight });
    });
    observer.observe(container);
    setSize({ width: container.clientWidth, height: container.clientHeight });
    return () => observer.disconnect();
  }, []);

  /* ---- Screen <-> world conversion -------------------------------------- */

  const toScreen = useCallback(
    (position: LatLon) => {
      const scale = zoomScale(zoom);
      const world = project(position);
      const originWorld = project(center);
      return {
        x: (world.x - originWorld.x) * scale + size.width / 2,
        y: (world.y - originWorld.y) * scale + size.height / 2,
      };
    },
    [center, zoom, size.width, size.height],
  );

  /* ---- Tile loading ------------------------------------------------------ */

  useEffect(() => {
    if (!TILE_URL || !layers.base || size.width === 0) return;

    const z = Math.round(zoom);
    const scale = zoomScale(zoom);
    const originWorld = project(center);
    const tileScreenSize = TILE_SIZE * (scale / 2 ** z);

    // World pixel coordinates of the viewport corners at integer zoom `z`.
    const left = (originWorld.x * 2 ** z) / TILE_SIZE - size.width / 2 / tileScreenSize;
    const top = (originWorld.y * 2 ** z) / TILE_SIZE - size.height / 2 / tileScreenSize;
    const right = left + size.width / tileScreenSize;
    const bottom = top + size.height / tileScreenSize;

    const maxTile = 2 ** z;

    for (let x = Math.floor(left); x <= Math.floor(right); x += 1) {
      for (let y = Math.floor(top); y <= Math.floor(bottom); y += 1) {
        if (y < 0 || y >= maxTile) continue;
        // Longitude wraps; latitude does not.
        const wrappedX = ((x % maxTile) + maxTile) % maxTile;
        const key = `${z}/${wrappedX}/${y}`;
        if (tileCache.current.has(key)) continue;

        const image = new Image();
        image.crossOrigin = 'anonymous';
        image.src = TILE_URL.replace('{z}', String(z))
          .replace('{x}', String(wrappedX))
          .replace('{y}', String(y));
        tileCache.current.set(key, image);
        image.onload = () => setTileVersion((version) => version + 1);
        image.onerror = () => tileCache.current.delete(key);
      }
    }

    // Bound the cache so a long panning session cannot exhaust memory.
    if (tileCache.current.size > 400) {
      const keys = [...tileCache.current.keys()].slice(0, 200);
      for (const key of keys) tileCache.current.delete(key);
    }
  }, [center, zoom, size.width, size.height, layers.base]);

  /* ---- Render ----------------------------------------------------------- */

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.width === 0 || size.height === 0) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = size.width * dpr;
    canvas.height = size.height * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.width, size.height);

    ctx.fillStyle = '#0b0e10';
    ctx.fillRect(0, 0, size.width, size.height);

    if (layers.base && TILE_URL) drawTiles(ctx);
    drawGraticule(ctx, size, center, zoom);
    if (layers.heatmap) drawHeatmap(ctx, markers, toScreen);
    if (layers.zones) drawAccuracyZones(ctx, operator, operatorAccuracy, zoom, toScreen);
    if (layers.observations) drawMarkers(ctx, markers, toScreen);
    if (operator) drawOperator(ctx, toScreen(operator));

    function drawTiles(context: CanvasRenderingContext2D) {
      const z = Math.round(zoom);
      const scale = zoomScale(zoom);
      const tileScreenSize = TILE_SIZE * (scale / 2 ** z);
      const originWorld = project(center);
      const originTileX = (originWorld.x * 2 ** z) / TILE_SIZE;
      const originTileY = (originWorld.y * 2 ** z) / TILE_SIZE;

      // Tiles are dimmed and desaturated so markers stay the brightest thing on
      // screen — a full-colour basemap would fight the data.
      context.save();
      context.globalAlpha = 0.55;
      context.filter = 'grayscale(1) contrast(0.85) brightness(0.7)';

      for (const [key, image] of tileCache.current) {
        const [tz, tx, ty] = key.split('/').map(Number);
        if (tz !== z || !image.complete || image.naturalWidth === 0) continue;
        const screenX = (tx! - originTileX) * tileScreenSize + size.width / 2;
        const screenY = (ty! - originTileY) * tileScreenSize + size.height / 2;
        context.drawImage(image, screenX, screenY, tileScreenSize + 1, tileScreenSize + 1);
      }
      context.restore();
    }
  }, [
    markers,
    operator,
    operatorAccuracy,
    center,
    zoom,
    size,
    layers,
    toScreen,
    tileVersion,
  ]);

  /* ---- Interaction ------------------------------------------------------- */

  const panBy = useCallback(
    (dx: number, dy: number) => {
      const scale = zoomScale(zoom);
      const world = project(center);
      onViewChange({
        center: unproject({ x: world.x - dx / scale, y: world.y - dy / scale }),
        zoom,
      });
    },
    [center, zoom, onViewChange],
  );

  const zoomBy = useCallback(
    (delta: number) => {
      onViewChange({ center, zoom: Math.max(1, Math.min(19, zoom + delta)) });
    },
    [center, zoom, onViewChange],
  );

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    pinchState.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pinchState.current.size === 1) {
      dragState.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    }
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!pinchState.current.has(event.pointerId)) return;

    // Two pointers down: pinch-zoom from the change in separation.
    if (pinchState.current.size === 2) {
      const previous = [...pinchState.current.values()];
      pinchState.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      const next = [...pinchState.current.values()];
      const previousSpan = Math.hypot(
        previous[0]!.x - previous[1]!.x,
        previous[0]!.y - previous[1]!.y,
      );
      const nextSpan = Math.hypot(next[0]!.x - next[1]!.x, next[0]!.y - next[1]!.y);
      if (previousSpan > 0 && nextSpan > 0) zoomBy(Math.log2(nextSpan / previousSpan));
      return;
    }

    const drag = dragState.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    dragState.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    pinchState.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    panBy(dx, dy);
  };

  const onPointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    pinchState.current.delete(event.pointerId);
    if (dragState.current?.pointerId === event.pointerId) dragState.current = null;
  };

  const onClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (!onSelectMarker) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    // Hit testing runs over the same clusters that were drawn, so tapping a
    // cluster selects a marker that is actually under the finger. The 18px
    // radius is generous because markers are small and fingers are not.
    for (const cluster of clusterMarkers(markers, toScreen)) {
      if (Math.hypot(cluster.x - x, cluster.y - y) <= 18) {
        if (cluster.members.length > 0) onSelectMarker(cluster.members);
        return;
      }
    }
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLCanvasElement>) => {
    const step = 60;
    switch (event.key) {
      case 'ArrowLeft':
        panBy(step, 0);
        break;
      case 'ArrowRight':
        panBy(-step, 0);
        break;
      case 'ArrowUp':
        panBy(0, step);
        break;
      case 'ArrowDown':
        panBy(0, -step);
        break;
      case '+':
      case '=':
        zoomBy(1);
        break;
      case '-':
        zoomBy(-1);
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  const scaleMeters = metersPerPixel(center.latitude, zoom) * 80;

  return (
    <div ref={containerRef} className={cn('relative overflow-hidden bg-abyss', className)}>
      <canvas
        ref={canvasRef}
        role="application"
        aria-label={`Observation map, ${markers.length} markers, zoom level ${zoom.toFixed(1)}. Use arrow keys to pan and plus or minus to zoom.`}
        tabIndex={0}
        style={{ width: size.width, height: size.height, touchAction: 'none' }}
        className="block cursor-grab active:cursor-grabbing"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClick={onClick}
        onKeyDown={onKeyDown}
        onWheel={(event) => zoomBy(event.deltaY > 0 ? -0.35 : 0.35)}
      />

      {/* Scale bar — an operational map without one invites misjudged distance. */}
      <div className="pointer-events-none absolute bottom-3 left-3 flex flex-col gap-1">
        <span className="tabular font-mono text-[10px] text-ash">
          {formatDistance(scaleMeters)}
        </span>
        <span className="h-1.5 w-20 border-x border-b border-ash" />
      </div>

      {!TILE_URL && (
        <span className="pointer-events-none absolute right-3 bottom-3 font-mono text-[9px] tracking-[0.1em] text-shadowtext uppercase">
          Reference grid · no basemap configured
        </span>
      )}
      {TILE_URL && process.env.NEXT_PUBLIC_MAP_ATTRIBUTION && (
        <span className="pointer-events-none absolute right-3 bottom-3 font-mono text-[9px] text-shadowtext">
          {process.env.NEXT_PUBLIC_MAP_ATTRIBUTION}
        </span>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Painters                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Reference graticule. Spacing is chosen so the lines stay roughly 80-160px
 * apart at any zoom, which keeps the grid legible without becoming moiré.
 */
function drawGraticule(
  ctx: CanvasRenderingContext2D,
  size: { width: number; height: number },
  center: LatLon,
  zoom: number,
) {
  const scale = zoomScale(zoom);
  const degreesPerPixel = 360 / (TILE_SIZE * scale);
  const targetDegrees = degreesPerPixel * 120;
  const step = niceStep(targetDegrees);

  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.045)';
  ctx.lineWidth = 1;
  ctx.font = '9px ui-monospace, monospace';
  ctx.fillStyle = 'rgba(154,164,173,0.4)';

  const originWorld = project(center);
  const halfWidthDegrees = (size.width / 2) * degreesPerPixel;
  const startLon = Math.floor((center.longitude - halfWidthDegrees) / step) * step;
  const endLon = center.longitude + halfWidthDegrees;

  for (let lon = startLon; lon <= endLon; lon += step) {
    const x = (project({ latitude: center.latitude, longitude: lon }).x - originWorld.x) * scale + size.width / 2;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, size.height);
    ctx.stroke();
    ctx.fillText(lon.toFixed(step < 0.01 ? 4 : 2), x + 3, 12);
  }

  // Latitude lines are computed in projected space so spacing stays even on
  // screen rather than in degrees, which Mercator distorts.
  const topLat = unproject({ x: originWorld.x, y: originWorld.y - size.height / 2 / scale }).latitude;
  const bottomLat = unproject({
    x: originWorld.x,
    y: originWorld.y + size.height / 2 / scale,
  }).latitude;
  const startLat = Math.floor(bottomLat / step) * step;

  for (let lat = startLat; lat <= topLat; lat += step) {
    const y = (project({ latitude: lat, longitude: center.longitude }).y - originWorld.y) * scale + size.height / 2;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(size.width, y);
    ctx.stroke();
    ctx.fillText(lat.toFixed(step < 0.01 ? 4 : 2), 4, y - 3);
  }

  ctx.restore();
}

/** Rounds a step to a 1/2/5 × 10^n sequence, as survey grids do. */
function niceStep(value: number): number {
  const exponent = Math.floor(Math.log10(value));
  const magnitude = 10 ** exponent;
  const normalized = value / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}

/**
 * Draws observation markers, clustering any that land within `CLUSTER_RADIUS`
 * of each other on screen.
 *
 * Clustering is essential rather than cosmetic here: a stationary session
 * records every observation at one coordinate, so without it a dozen markers
 * and their labels pile up on the same few pixels and none of them is legible.
 * Zooming in separates genuinely distinct positions, exactly as expected.
 */
const CLUSTER_RADIUS = 26;

interface ScreenCluster {
  x: number;
  y: number;
  members: MapMarker[];
  /** Total sightings across the cluster. */
  total: number;
}

export function clusterMarkers(
  markers: MapMarker[],
  toScreen: (position: LatLon) => { x: number; y: number },
): ScreenCluster[] {
  const clusters: ScreenCluster[] = [];

  for (const marker of markers) {
    const point = toScreen(marker.position);
    const existing = clusters.find(
      (cluster) => Math.hypot(cluster.x - point.x, cluster.y - point.y) <= CLUSTER_RADIUS,
    );
    if (existing) {
      existing.members.push(marker);
      existing.total += marker.count;
      // Re-centre on the mean so the cluster does not drift toward whichever
      // marker happened to be processed first.
      existing.x += (point.x - existing.x) / existing.members.length;
      existing.y += (point.y - existing.y) / existing.members.length;
    } else {
      clusters.push({ x: point.x, y: point.y, members: [marker], total: marker.count });
    }
  }

  return clusters;
}

function drawMarkers(
  ctx: CanvasRenderingContext2D,
  markers: MapMarker[],
  toScreen: (position: LatLon) => { x: number; y: number },
) {
  ctx.save();
  ctx.font = '9px ui-monospace, monospace';

  for (const cluster of clusterMarkers(markers, toScreen)) {
    const primary = cluster.members[0]!;
    // A mixed cluster gets a neutral colour: tinting it by whichever member
    // sorted first would assert a composition the marker does not have.
    const mixed = new Set(cluster.members.map((m) => m.kind)).size > 1;
    const color = mixed ? '#7f96a8' : KIND_ACCENT[primary.kind].color;

    // Radius grows with sighting count, damped so a busy location does not
    // produce a marker that swallows the map.
    const radius = 5 + Math.min(7, Math.log2(cluster.total + 1) * 2);

    ctx.beginPath();
    ctx.arc(cluster.x, cluster.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = `${color}33`;
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.stroke();

    // Centre tick keeps the exact position readable at any marker size.
    ctx.beginPath();
    ctx.moveTo(cluster.x - 2, cluster.y);
    ctx.lineTo(cluster.x + 2, cluster.y);
    ctx.moveTo(cluster.x, cluster.y - 2);
    ctx.lineTo(cluster.x, cluster.y + 2);
    ctx.strokeStyle = color;
    ctx.stroke();

    ctx.fillStyle = color;
    const label =
      cluster.members.length === 1
        ? primary.label
        : `${cluster.members.length} ENTITIES`;
    ctx.fillText(label, cluster.x + radius + 4, cluster.y + 3);
  }
  ctx.restore();
}

/** Density shading. Coarse cells rather than a true kernel — cheap and honest. */
function drawHeatmap(
  ctx: CanvasRenderingContext2D,
  markers: MapMarker[],
  toScreen: (position: LatLon) => { x: number; y: number },
) {
  if (markers.length === 0) return;
  ctx.save();
  for (const marker of markers) {
    const { x, y } = toScreen(marker.position);
    const radius = 48;
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, 'rgba(126,224,138,0.16)');
    gradient.addColorStop(1, 'rgba(126,224,138,0)');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** GPS accuracy circle. Drawn to true scale — never a decorative fixed radius. */
function drawAccuracyZones(
  ctx: CanvasRenderingContext2D,
  operator: LatLon | null | undefined,
  accuracy: number | undefined,
  zoom: number,
  toScreen: (position: LatLon) => { x: number; y: number },
) {
  if (!operator || !accuracy) return;
  const { x, y } = toScreen(operator);
  const radiusPixels = accuracy / metersPerPixel(operator.latitude, zoom);
  if (radiusPixels < 2 || radiusPixels > 2000) return;

  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, radiusPixels, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(126,224,138,0.06)';
  ctx.fill();
  ctx.setLineDash([3, 3]);
  ctx.strokeStyle = 'rgba(126,224,138,0.3)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}

/** Operator position: a distinct chevron so it is never read as an observation. */
function drawOperator(ctx: CanvasRenderingContext2D, point: { x: number; y: number }) {
  ctx.save();
  ctx.translate(point.x, point.y);
  ctx.beginPath();
  ctx.moveTo(0, -8);
  ctx.lineTo(6, 7);
  ctx.lineTo(0, 4);
  ctx.lineTo(-6, 7);
  ctx.closePath();
  ctx.fillStyle = '#7ee08a';
  ctx.fill();
  ctx.strokeStyle = '#07090a';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}
