import type { Attribute, DetectionClass, EntityKind, NormalizedBox } from '@/types/domain';
import { createId } from '@/lib/id';

/**
 * APPEARANCE ATTRIBUTE ANALYSIS
 * ---------------------------------------------------------------------------
 * What this does: samples pixels from anatomically-motivated sub-regions of a
 * detection box and reports the dominant colour of each, with a confidence
 * derived from how dominant that colour actually is.
 *
 * What this explicitly does NOT do: classify garment *type*, detect bags, hats,
 * glasses or accessories. Those require a dedicated attribute model, which is a
 * separate download and a separate inference pass. Rather than fabricate
 * plausible-sounding labels, this module reports only what colour sampling can
 * genuinely support, and the interface shows nothing else.
 *
 * Every result carries a confidence and is stored as a time-stamped observation
 * — never as a permanent property of the subject. A person wears a blue jacket
 * on Tuesday; they are not "a person with a blue jacket".
 *
 * Confidence model: the fraction of sampled pixels falling in the winning
 * colour bucket, attenuated by how few pixels were sampled and by low
 * saturation (a washed-out or badly-lit crop yields a low-confidence result,
 * which is the correct outcome).
 */

/** Sub-regions sampled per entity kind, expressed as fractions of the box. */
const SAMPLE_REGIONS: Partial<Record<EntityKind, Array<{ key: string; region: NormalizedBox }>>> = {
  // Vertical thirds of a standing human: head/hair, torso, legs.
  person: [
    { key: 'hair-color', region: { x: 0.28, y: 0.02, width: 0.44, height: 0.13 } },
    { key: 'upper', region: { x: 0.2, y: 0.22, width: 0.6, height: 0.26 } },
    { key: 'lower', region: { x: 0.25, y: 0.58, width: 0.5, height: 0.26 } },
  ],
  // Vehicle body panels, avoiding glazing and the shadowed underside.
  vehicle: [{ key: 'color', region: { x: 0.18, y: 0.32, width: 0.64, height: 0.34 } }],
  // Animal flank — the largest continuous area of coat.
  animal: [{ key: 'coat-color', region: { x: 0.25, y: 0.25, width: 0.5, height: 0.45 } }],
};

/** Named colour anchors in RGB, chosen to be describable in plain language. */
const COLOR_ANCHORS: Array<{ name: string; rgb: [number, number, number] }> = [
  { name: 'black', rgb: [22, 22, 24] },
  { name: 'dark gray', rgb: [70, 72, 76] },
  { name: 'gray', rgb: [130, 133, 138] },
  { name: 'light gray', rgb: [190, 192, 196] },
  { name: 'white', rgb: [238, 238, 240] },
  { name: 'navy', rgb: [30, 46, 92] },
  { name: 'blue', rgb: [48, 92, 190] },
  { name: 'light blue', rgb: [120, 170, 220] },
  { name: 'teal', rgb: [40, 130, 130] },
  { name: 'green', rgb: [56, 130, 66] },
  { name: 'olive', rgb: [110, 118, 70] },
  { name: 'yellow', rgb: [220, 195, 70] },
  { name: 'orange', rgb: [220, 130, 50] },
  { name: 'brown', rgb: [110, 78, 52] },
  { name: 'tan', rgb: [190, 165, 130] },
  { name: 'red', rgb: [180, 52, 48] },
  { name: 'maroon', rgb: [110, 40, 46] },
  { name: 'pink', rgb: [216, 150, 165] },
  { name: 'purple', rgb: [110, 66, 150] },
];

export interface AttributeAnalysisInput {
  /** Full frame the detection came from. */
  frame: HTMLCanvasElement;
  box: NormalizedBox;
  kind: EntityKind;
  class: DetectionClass;
  entityId: string;
  observedAt: number;
}

/**
 * Samples the frame and returns colour attributes. Returns an empty array
 * rather than throwing when the crop is degenerate or the canvas is tainted.
 */
export function analyzeAppearance(input: AttributeAnalysisInput): Attribute[] {
  const regions = SAMPLE_REGIONS[input.kind];
  if (!regions) return [];

  const ctx = input.frame.getContext('2d', { willReadFrequently: true });
  if (!ctx) return [];

  const frameWidth = input.frame.width;
  const frameHeight = input.frame.height;
  if (frameWidth === 0 || frameHeight === 0) return [];

  const results: Attribute[] = [];

  for (const { key, region } of regions) {
    // Project the sub-region from box space into absolute frame pixels.
    const px = Math.round((input.box.x + region.x * input.box.width) * frameWidth);
    const py = Math.round((input.box.y + region.y * input.box.height) * frameHeight);
    const pw = Math.round(region.width * input.box.width * frameWidth);
    const ph = Math.round(region.height * input.box.height * frameHeight);

    // Below roughly 6x6 px the sample is noise, not signal.
    if (pw < 6 || ph < 6) continue;
    const clampedX = Math.max(0, Math.min(px, frameWidth - 1));
    const clampedY = Math.max(0, Math.min(py, frameHeight - 1));
    const clampedW = Math.min(pw, frameWidth - clampedX);
    const clampedH = Math.min(ph, frameHeight - clampedY);
    if (clampedW < 6 || clampedH < 6) continue;

    let pixels: ImageData;
    try {
      pixels = ctx.getImageData(clampedX, clampedY, clampedW, clampedH);
    } catch {
      // A cross-origin-tainted canvas — cannot read back. Skip silently.
      return results;
    }

    const sample = dominantColor(pixels);
    if (!sample) continue;

    results.push({
      id: createId('attr'),
      entityId: input.entityId,
      key,
      value: `${sample.name}`,
      confidence: sample.confidence,
      observedAt: input.observedAt,
      source: 'model',
    });
  }

  return results;
}

interface ColorSample {
  name: string;
  confidence: number;
}

/**
 * Finds the dominant named colour in an image region.
 *
 * Pixels are stepped rather than fully enumerated — a 4-pixel stride reduces
 * work by 16x with no meaningful loss in a region this small, which matters
 * when this runs inside a detection tick on a phone.
 */
function dominantColor(pixels: ImageData): ColorSample | null {
  const data = pixels.data;
  const buckets = new Map<string, number>();
  let counted = 0;
  let saturationSum = 0;

  const stride = 4 * 4; // every 4th pixel
  for (let i = 0; i < data.length; i += stride) {
    const r = data[i] ?? 0;
    const g = data[i + 1] ?? 0;
    const b = data[i + 2] ?? 0;
    const a = data[i + 3] ?? 0;
    if (a < 200) continue;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    saturationSum += max === 0 ? 0 : (max - min) / max;

    const name = nearestAnchor(r, g, b);
    buckets.set(name, (buckets.get(name) ?? 0) + 1);
    counted += 1;
  }

  if (counted < 20) return null;

  let bestName = '';
  let bestCount = 0;
  for (const [name, count] of buckets) {
    if (count > bestCount) {
      bestName = name;
      bestCount = count;
    }
  }
  if (!bestName) return null;

  const dominance = bestCount / counted;
  const meanSaturation = saturationSum / counted;

  // A flat, desaturated crop is usually shadow or motion blur rather than a
  // genuine reading, so saturation gates confidence for chromatic names.
  const isAchromatic = ACHROMATIC.has(bestName);
  const saturationFactor = isAchromatic ? 1 : Math.min(1, 0.4 + meanSaturation * 1.6);
  // Small samples are inherently less trustworthy.
  const sampleFactor = Math.min(1, counted / 200);

  const confidence = clamp01(dominance * saturationFactor * (0.65 + 0.35 * sampleFactor));

  // Below 0.45 the reading is not worth showing to an operator at all.
  if (confidence < 0.45) return null;

  return { name: bestName, confidence };
}

const ACHROMATIC = new Set(['black', 'dark gray', 'gray', 'light gray', 'white']);

/** Nearest anchor by squared Euclidean distance in RGB. */
function nearestAnchor(r: number, g: number, b: number): string {
  let best = COLOR_ANCHORS[0]!;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const anchor of COLOR_ANCHORS) {
    const [ar, ag, ab] = anchor.rgb;
    const distance = (r - ar) ** 2 + (g - ag) ** 2 + (b - ab) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = anchor;
    }
  }
  return best.name;
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/** Human-readable label for an attribute key. */
export const ATTRIBUTE_LABEL: Record<string, string> = {
  'hair-color': 'Hair',
  upper: 'Upper',
  lower: 'Lower',
  color: 'Color',
  'coat-color': 'Coat',
  bag: 'Bag',
  headwear: 'Head',
  note: 'Note',
};

/**
 * Renders an attribute for display. Readings below 0.7 are explicitly hedged so
 * that uncertain model output is never presented as fact.
 */
export function describeAttribute(attribute: Attribute): string {
  const value = attribute.value;
  if (attribute.source === 'user') return value;
  return attribute.confidence < 0.7 ? `possible ${value}` : value;
}
