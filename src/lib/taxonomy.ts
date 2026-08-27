import type { DetectionClass, EntityKind } from '@/types/domain';

/**
 * Mapping from detector class to the broad entity kind used for colour coding,
 * filtering and counter buckets. Keeping this in one place means swapping in a
 * model with a different label set only requires editing `normalizeClass`.
 */
const CLASS_TO_KIND: Record<DetectionClass, EntityKind> = {
  person: 'person',
  dog: 'animal',
  cat: 'animal',
  bird: 'animal',
  horse: 'animal',
  sheep: 'animal',
  cow: 'animal',
  bear: 'animal',
  car: 'vehicle',
  truck: 'vehicle',
  bus: 'vehicle',
  motorcycle: 'vehicle',
  bicycle: 'vehicle',
  boat: 'vehicle',
  airplane: 'vehicle',
  train: 'vehicle',
  backpack: 'object',
  handbag: 'object',
  suitcase: 'object',
  umbrella: 'object',
  unknown: 'object',
};

export function kindForClass(cls: DetectionClass): EntityKind {
  return CLASS_TO_KIND[cls] ?? 'object';
}

/**
 * Normalises an arbitrary model label (COCO, Open Images, a custom model) to a
 * FLOCKRAFT detection class. Anything unmapped becomes `'unknown'` rather than
 * being dropped — an unlabelled detection is still a detection.
 */
export function normalizeClass(raw: string): DetectionClass {
  const key = raw.trim().toLowerCase();
  if (key in CLASS_TO_KIND) return key as DetectionClass;

  // Common aliases across model label sets.
  const aliases: Record<string, DetectionClass> = {
    'traffic light': 'unknown',
    van: 'truck',
    suv: 'car',
    pickup: 'truck',
    'fire hydrant': 'unknown',
    aeroplane: 'airplane',
    plane: 'airplane',
    motorbike: 'motorcycle',
    bike: 'bicycle',
    puppy: 'dog',
    kitten: 'cat',
    human: 'person',
    pedestrian: 'person',
  };
  return aliases[key] ?? 'unknown';
}

/**
 * Detection classes enabled by default. Deliberately narrow: every additional
 * class costs post-processing time and increases the false-positive surface.
 */
export const DEFAULT_ENABLED_CLASSES: DetectionClass[] = [
  'person',
  'dog',
  'cat',
  'car',
  'truck',
  'bus',
  'motorcycle',
  'bicycle',
  'boat',
  'airplane',
];

/** Display names for the four entity kinds. */
export const KIND_LABEL: Record<EntityKind, string> = {
  person: 'PEOPLE',
  vehicle: 'VEHICLES',
  animal: 'ANIMALS',
  object: 'OBJECTS',
};

/** Singular designation prefix used to build entity labels: `PERSON 014`. */
export const KIND_DESIGNATION: Record<EntityKind, string> = {
  person: 'PERSON',
  vehicle: 'VEHICLE',
  animal: 'ANIMAL',
  object: 'OBJECT',
};

/**
 * Per-kind accent token. Person observations use amber so that human subjects
 * are never visually confused with materiel; this is a deliberate product
 * decision, not a stylistic one.
 */
export const KIND_ACCENT: Record<EntityKind, { color: string; wash: string }> = {
  person: { color: 'var(--color-amber)', wash: 'var(--color-amber-wash)' },
  vehicle: { color: 'var(--color-sand)', wash: 'var(--color-sand-wash)' },
  animal: { color: 'var(--color-olive)', wash: 'var(--color-olive-wash)' },
  object: { color: 'var(--color-steel)', wash: 'var(--color-steel-wash)' },
};

/**
 * Builds the on-screen designation for an entity. Animals and objects carry
 * their specific class (`DOG 003`) because the class is the most useful
 * discriminator; people and vehicles use the generic kind.
 */
export function designationFor(kind: EntityKind, cls: DetectionClass, ordinal: number): string {
  const prefix =
    kind === 'animal' || (kind === 'object' && cls !== 'unknown')
      ? cls.toUpperCase()
      : KIND_DESIGNATION[kind];
  return `${prefix} ${String(ordinal).padStart(3, '0')}`;
}
