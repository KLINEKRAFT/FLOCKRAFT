import type { DetectionClass, Entity, EntityKind, EntityProfile, ProfileField } from '@/types/domain';

/**
 * ENTITY PROFILES
 * ---------------------------------------------------------------------------
 * Structured, mostly operator-maintained fields describing a subject.
 *
 * Why these are recorded rather than inferred
 * -------------------------------------------
 * A single uncalibrated camera cannot determine most of what an operator needs
 * to record, and the honest response is to let the operator record it rather
 * than to guess convincingly:
 *
 *  - **Height** requires a ground plane and a known camera geometry. Pixel
 *    height alone is a function of distance, not stature.
 *  - **Make, model and year** need a fine-grained classifier trained on
 *    hundreds of vehicle classes. COCO reports `car` / `truck` / `bus` and
 *    nothing finer.
 *  - **Licence plates** need plate localisation plus OCR at a resolution a
 *    wide-angle phone camera rarely delivers. The original specification is
 *    explicit that plate recognition is not a version-one dependency.
 *  - **Gender** is not visually determinable at all. A classifier here would
 *    be predicting perceived presentation from its training distribution and
 *    would be confidently wrong about real people. FLOCKRAFT records what an
 *    operator observed and marks it as exactly that.
 *
 * What *is* filled automatically is only what is genuinely measured: colour,
 * sampled from the frame, and the two body types COCO reports directly. Every
 * field carries its provenance so the interface can show the difference.
 */

export type ProfileFieldType = 'text' | 'select' | 'textarea' | 'plate';

export interface ProfileFieldDef {
  key: string;
  label: string;
  type: ProfileFieldType;
  placeholder?: string;
  options?: readonly string[];
  /** Rendered under the input; use for provenance or accuracy caveats. */
  hint?: string;
  maxLength?: number;
  /** Shown in the compact profile summary on cards and list rows. */
  summary?: boolean;
}

/* -------------------------------------------------------------------------- */
/* Option sets                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Gender as an operator observation.
 *
 * "Not determined" is first and is the default for a reason: it is the correct
 * answer far more often than an interface like this usually admits, and making
 * it the path of least resistance keeps the record honest.
 */
export const GENDER_OPTIONS = [
  'Not determined',
  'Male',
  'Female',
  'Non-binary / other',
] as const;

export const AGE_OPTIONS = [
  'Unclear',
  'Child (0–12)',
  'Teen (13–17)',
  '18–24',
  '25–34',
  '35–44',
  '45–54',
  '55–64',
  '65+',
] as const;

/** Imperial bands, matching how an operator actually estimates stature. */
export const HEIGHT_OPTIONS = [
  'Unclear',
  'Under 5′0″',
  '5′0″ – 5′3″',
  '5′4″ – 5′7″',
  '5′8″ – 5′11″',
  '6′0″ – 6′3″',
  'Over 6′3″',
] as const;

export const BODY_TYPE_OPTIONS = [
  'Unknown',
  'Sedan',
  'Coupe',
  'Hatchback',
  'Wagon',
  'SUV',
  'Crossover',
  'Pickup',
  'Van / minivan',
  'Box truck',
  'Semi / tractor',
  'Bus',
  'Motorcycle',
  'Trailer',
  'Other',
] as const;

/** US jurisdictions that issue plates, plus escapes for anything else. */
export const PLATE_STATES = [
  'Unknown',
  'Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado',
  'Connecticut', 'Delaware', 'District of Columbia', 'Florida', 'Georgia',
  'Hawaii', 'Idaho', 'Illinois', 'Indiana', 'Iowa', 'Kansas', 'Kentucky',
  'Louisiana', 'Maine', 'Maryland', 'Massachusetts', 'Michigan', 'Minnesota',
  'Mississippi', 'Missouri', 'Montana', 'Nebraska', 'Nevada', 'New Hampshire',
  'New Jersey', 'New Mexico', 'New York', 'North Carolina', 'North Dakota',
  'Ohio', 'Oklahoma', 'Oregon', 'Pennsylvania', 'Rhode Island',
  'South Carolina', 'South Dakota', 'Tennessee', 'Texas', 'Utah', 'Vermont',
  'Virginia', 'Washington', 'West Virginia', 'Wisconsin', 'Wyoming',
  'Puerto Rico', 'Guam', 'US Virgin Islands', 'Tribal', 'Government / federal',
  'Canada', 'Mexico', 'Other / foreign',
] as const;

/* -------------------------------------------------------------------------- */
/* Field definitions per entity kind                                           */
/* -------------------------------------------------------------------------- */

const PERSON_FIELDS: ProfileFieldDef[] = [
  {
    key: 'gender',
    label: 'Gender',
    type: 'select',
    options: GENDER_OPTIONS,
    hint: 'Operator observation. FLOCKRAFT never infers this from the camera.',
    summary: true,
  },
  {
    key: 'ageApprox',
    label: 'Approx. age',
    type: 'select',
    options: AGE_OPTIONS,
    summary: true,
  },
  {
    key: 'heightApprox',
    label: 'Approx. height',
    type: 'select',
    options: HEIGHT_OPTIONS,
    hint: 'Estimated by eye. A single camera cannot measure stature.',
    summary: true,
  },
  {
    key: 'description',
    label: 'Brief description',
    type: 'textarea',
    placeholder: 'Distinguishing features, clothing, behaviour, direction of travel…',
    maxLength: 500,
  },
];

const VEHICLE_FIELDS: ProfileFieldDef[] = [
  { key: 'make', label: 'Make', type: 'text', placeholder: 'Ford', summary: true },
  { key: 'model', label: 'Model', type: 'text', placeholder: 'F-150', summary: true },
  {
    key: 'yearApprox',
    label: 'Approx. year',
    type: 'text',
    placeholder: '2018 or 2015–2019',
    maxLength: 16,
  },
  {
    key: 'bodyType',
    label: 'Body type',
    type: 'select',
    options: BODY_TYPE_OPTIONS,
    summary: true,
  },
  {
    key: 'plate',
    label: 'Licence plate',
    type: 'plate',
    placeholder: 'ABC-1234',
    maxLength: 12,
    hint: 'Recorded by hand. Plate reading is not automated.',
  },
  { key: 'plateState', label: 'Tag state', type: 'select', options: PLATE_STATES },
  {
    key: 'distinguishing',
    label: 'Distinguishing features',
    type: 'textarea',
    placeholder: 'Roof rack, trailer, damage, decals, ladder rack…',
    maxLength: 500,
  },
];

const ANIMAL_FIELDS: ProfileFieldDef[] = [
  { key: 'species', label: 'Species', type: 'text', placeholder: 'Dog', summary: true },
  { key: 'breed', label: 'Breed (approx.)', type: 'text', placeholder: 'German Shepherd-type', summary: true },
  {
    key: 'size',
    label: 'Size',
    type: 'select',
    options: ['Unknown', 'Small', 'Medium', 'Large', 'Very large'],
    summary: true,
  },
  {
    key: 'collar',
    label: 'Collar / harness',
    type: 'select',
    options: ['Not observed', 'Collar', 'Harness', 'Collar and harness', 'None'],
  },
  { key: 'description', label: 'Brief description', type: 'textarea', maxLength: 500 },
];

const OBJECT_FIELDS: ProfileFieldDef[] = [
  { key: 'descriptor', label: 'Descriptor', type: 'text', placeholder: 'Black backpack', summary: true },
  { key: 'description', label: 'Brief description', type: 'textarea', maxLength: 500 },
];

const FIELDS_BY_KIND: Record<EntityKind, ProfileFieldDef[]> = {
  person: PERSON_FIELDS,
  vehicle: VEHICLE_FIELDS,
  animal: ANIMAL_FIELDS,
  object: OBJECT_FIELDS,
};

export function profileFieldsFor(kind: EntityKind): ProfileFieldDef[] {
  return FIELDS_BY_KIND[kind] ?? OBJECT_FIELDS;
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

/** Wraps an operator-entered value. User entries are facts, so confidence is 1. */
export function userField(value: string, observedAt = Date.now()): ProfileField {
  return { value, source: 'user', confidence: 1, observedAt };
}

export function modelField(value: string, confidence: number, observedAt = Date.now()): ProfileField {
  return { value, source: 'model', confidence, observedAt };
}

/**
 * Values that mean "nothing recorded". Storing them would make an untouched
 * field look deliberately answered, so they are treated as a clear instead.
 */
const EMPTY_VALUES = new Set(['', 'Unknown', 'Unclear', 'Not determined', 'Not observed']);

export function isEmptyProfileValue(value: string | undefined): boolean {
  return value === undefined || EMPTY_VALUES.has(value.trim());
}

/**
 * Applies an edit, dropping fields cleared back to their empty value so the
 * profile never accumulates meaningless entries.
 */
export function applyProfileEdit(
  current: EntityProfile | undefined,
  edits: Record<string, string>,
  observedAt = Date.now(),
): EntityProfile {
  const next: EntityProfile = { ...(current ?? {}) };
  for (const [key, raw] of Object.entries(edits)) {
    const value = raw.trim();
    if (isEmptyProfileValue(value)) {
      delete next[key];
      continue;
    }
    // Unchanged values keep their original timestamp: re-saving a form should
    // not make every field look freshly observed.
    if (next[key]?.value === value && next[key]?.source === 'user') continue;
    next[key] = userField(value, observedAt);
  }
  return next;
}

/**
 * Seeds a new entity's profile from what detection genuinely established.
 *
 * Only two body types come from the detector, and only because COCO reports
 * them as distinct classes rather than as an inference from box shape. A
 * sedan-versus-SUV guess from aspect ratio would be close to noise, so it is
 * not made.
 */
export function seedProfile(kind: EntityKind, cls: DetectionClass): EntityProfile | undefined {
  if (kind !== 'vehicle') return undefined;
  if (cls === 'motorcycle') return { bodyType: modelField('Motorcycle', 0.9) };
  if (cls === 'bus') return { bodyType: modelField('Bus', 0.9) };
  return undefined;
}

/** Ordered, populated fields for display. */
export function populatedFields(
  entity: Pick<Entity, 'kind' | 'profile'>,
): Array<{ def: ProfileFieldDef; field: ProfileField }> {
  const profile = entity.profile;
  if (!profile) return [];
  return profileFieldsFor(entity.kind)
    .map((def) => ({ def, field: profile[def.key] }))
    .filter((row): row is { def: ProfileFieldDef; field: ProfileField } => Boolean(row.field));
}

/**
 * Compact one-line descriptor built from the fields marked `summary`.
 *
 * Used on entity cards, where a plate or a make/model tells an operator far
 * more at a glance than a sampled colour does.
 */
export function profileSummary(entity: Pick<Entity, 'kind' | 'profile'>): string | undefined {
  const profile = entity.profile;
  if (!profile) return undefined;

  const parts = profileFieldsFor(entity.kind)
    .filter((def) => def.summary)
    .map((def) => profile[def.key]?.value)
    .filter((value): value is string => Boolean(value) && !isEmptyProfileValue(value));

  if (parts.length === 0) return undefined;
  return parts.slice(0, 3).join(' · ');
}

/** Plate text, normalised for display and search. */
export function normalizePlate(value: string): string {
  return value.toUpperCase().replace(/\s+/g, ' ').trim();
}

/** Every profile value as plain text, so local search can match against it. */
export function profileSearchText(entity: Pick<Entity, 'kind' | 'profile'>): string[] {
  const profile = entity.profile;
  if (!profile) return [];
  return Object.entries(profile).flatMap(([key, field]) => [key, field.value]);
}
