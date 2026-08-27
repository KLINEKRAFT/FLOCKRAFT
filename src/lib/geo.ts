/**
 * WEB MERCATOR PROJECTION
 * ---------------------------------------------------------------------------
 * The minimum needed to place observations on a map and, when a tile URL is
 * configured, to line them up with standard XYZ raster tiles.
 *
 * A full mapping library (MapLibre, Leaflet) is several hundred kilobytes and
 * buys features FLOCKRAFT's map does not use: styled vector layers, 3D terrain,
 * globe projection. The projection itself is about thirty lines, so the library
 * is not worth its weight here. If the map later needs vector styling or
 * offline basemaps, swapping in MapLibre is a contained change behind
 * `TacticalMap`.
 */

export const TILE_SIZE = 256;

export interface LatLon {
  latitude: number;
  longitude: number;
}

export interface WorldPoint {
  /** Pixel coordinate at zoom 0, in the range 0..TILE_SIZE. */
  x: number;
  y: number;
}

/** Mercator cannot represent the poles; clamped to the standard web bound. */
const MAX_LATITUDE = 85.05112878;

export function project({ latitude, longitude }: LatLon): WorldPoint {
  const lat = Math.max(-MAX_LATITUDE, Math.min(MAX_LATITUDE, latitude));
  const sin = Math.sin((lat * Math.PI) / 180);
  return {
    x: TILE_SIZE * (0.5 + longitude / 360),
    y: TILE_SIZE * (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)),
  };
}

export function unproject({ x, y }: WorldPoint): LatLon {
  const longitude = (x / TILE_SIZE - 0.5) * 360;
  const n = Math.PI * (1 - (2 * y) / TILE_SIZE);
  const latitude = (180 / Math.PI) * Math.atan(Math.sinh(n));
  return { latitude, longitude };
}

/** Scale factor from zoom-0 world pixels to screen pixels at `zoom`. */
export const zoomScale = (zoom: number) => 2 ** zoom;

/** Ground resolution in metres per screen pixel — used for the scale bar. */
export function metersPerPixel(latitude: number, zoom: number): number {
  const EARTH_CIRCUMFERENCE = 40_075_016.686;
  return (
    (EARTH_CIRCUMFERENCE * Math.cos((latitude * Math.PI) / 180)) /
    (TILE_SIZE * zoomScale(zoom))
  );
}

/** Great-circle distance in metres (haversine). */
export function distanceMeters(a: LatLon, b: LatLon): number {
  const R = 6_371_008.8;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface Bounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

/** Bounding box of a set of points, or `null` when the set is empty. */
export function boundsOf(points: LatLon[]): Bounds | null {
  if (points.length === 0) return null;
  let north = -90;
  let south = 90;
  let east = -180;
  let west = 180;
  for (const point of points) {
    north = Math.max(north, point.latitude);
    south = Math.min(south, point.latitude);
    east = Math.max(east, point.longitude);
    west = Math.min(west, point.longitude);
  }
  return { north, south, east, west };
}

/** Zoom at which `bounds` fits inside a viewport, with margin. */
export function zoomForBounds(bounds: Bounds, width: number, height: number): number {
  const nw = project({ latitude: bounds.north, longitude: bounds.west });
  const se = project({ latitude: bounds.south, longitude: bounds.east });
  const spanX = Math.abs(se.x - nw.x);
  const spanY = Math.abs(se.y - nw.y);
  // A degenerate span (one point, or all points identical) has no natural
  // zoom; a fixed street-level default is more useful than infinity.
  if (spanX < 1e-9 && spanY < 1e-9) return 16;
  const zoomX = Math.log2(width / Math.max(spanX, 1e-9));
  const zoomY = Math.log2(height / Math.max(spanY, 1e-9));
  return Math.max(1, Math.min(19, Math.min(zoomX, zoomY) - 0.4));
}

export function centerOf(bounds: Bounds): LatLon {
  return {
    latitude: (bounds.north + bounds.south) / 2,
    longitude: (bounds.east + bounds.west) / 2,
  };
}

/** Formats a distance for the scale bar. */
export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(meters < 10_000 ? 1 : 0)} km`;
}
