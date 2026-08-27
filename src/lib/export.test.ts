import { describe, expect, it } from 'vitest';
import type { Attribute, Entity, Note, Sighting } from '@/types/domain';
import {
  buildArtifact,
  csvCell,
  entitiesCsv,
  sightingsCsv,
  toJson,
  type ExportBundle,
} from '@/lib/export';

/** Fixed instant so timestamp columns are assertable. */
const T = new Date(2026, 3, 20, 14, 32, 5).getTime();

function entity(overrides: Partial<Entity> = {}): Entity {
  return {
    id: 'ent_1',
    label: 'PERSON 014',
    kind: 'person',
    class: 'person',
    firstSeenAt: T,
    lastSeenAt: T + 60_000,
    sightingCount: 2,
    favorite: false,
    ...overrides,
  };
}

function sighting(overrides: Partial<Sighting> = {}): Sighting {
  return {
    id: 'sig_1',
    entityId: 'ent_1',
    sessionId: 'ses_1',
    observationId: 'obs_1',
    class: 'person',
    kind: 'person',
    startedAt: T,
    endedAt: T + 4200,
    durationMs: 4200,
    confidence: 0.8765,
    box: { x: 0.1, y: 0.1, width: 0.2, height: 0.4 },
    direction: 'left',
    attributes: [],
    coVisibleEntityIds: [],
    ...overrides,
  };
}

function bundle(overrides: Partial<ExportBundle> = {}): ExportBundle {
  return {
    exportedAt: T,
    sessions: [],
    entities: [entity()],
    sightings: [sighting()],
    notes: [],
    associations: [],
    ...overrides,
  };
}

/** Splits on record separators that are not inside a quoted field. */
function rows(csv: string): string[] {
  return csv.replace(/^﻿/, '').trimEnd().split('\r\n');
}

describe('csvCell', () => {
  it('leaves ordinary text unquoted', () => {
    expect(csvCell('PERSON 014')).toBe('PERSON 014');
  });

  it('quotes and doubles embedded quotes', () => {
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
  });

  it('quotes values containing a delimiter or newline', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('line1\nline2')).toBe('"line1\nline2"');
  });

  it('quotes values with significant surrounding whitespace', () => {
    expect(csvCell(' padded ')).toBe('" padded "');
  });

  it('neutralises spreadsheet formula injection in free text', () => {
    // A note body is operator-typed text and must never execute on open.
    for (const payload of ['=1+1', '+1', '-1+1', '@SUM(A1)']) {
      expect(csvCell(payload).startsWith("'")).toBe(true);
    }
    expect(csvCell('=HYPERLINK("http://x","x")')).toBe('"\'=HYPERLINK(""http://x"",""x"")"');
  });

  it('does not treat a negative number as a formula', () => {
    expect(csvCell(-36.15)).toBe('-36.15');
  });

  it('renders empty for null, undefined and non-finite numbers', () => {
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
    expect(csvCell(Number.NaN)).toBe('');
  });
});

describe('entitiesCsv', () => {
  it('writes one row per entity with local timestamps', () => {
    const csv = entitiesCsv(bundle());
    const lines = rows(csv);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^entity_id,label,kind,class,first_seen,last_seen/);
    expect(lines[1]).toContain('2026-04-20 14:32:05');
  });

  it('starts with a BOM so Excel reads UTF-8', () => {
    expect(entitiesCsv(bundle()).startsWith('﻿')).toBe(true);
  });

  it('flattens profile values into the shared column for that key', () => {
    const csv = entitiesCsv(
      bundle({
        entities: [
          entity({
            id: 'ent_2',
            kind: 'vehicle',
            class: 'truck',
            label: 'VEHICLE 003',
            profile: {
              make: { value: 'Ford', source: 'user', confidence: 1, observedAt: T },
              plate: { value: 'ABC-1234', source: 'user', confidence: 1, observedAt: T },
              bodyType: { value: 'Pickup', source: 'model', confidence: 0.9, observedAt: T },
            },
          }),
        ],
      }),
    );
    const [header, row] = rows(csv);
    const columns = header!.split(',');
    const values = row!.split(',');
    expect(values[columns.indexOf('make')]).toBe('Ford');
    expect(values[columns.indexOf('plate')]).toBe('ABC-1234');
  });

  it('records which profile fields the model inferred rather than the operator', () => {
    const csv = entitiesCsv(
      bundle({
        entities: [
          entity({
            kind: 'vehicle',
            profile: {
              make: { value: 'Ford', source: 'user', confidence: 1, observedAt: T },
              bodyType: { value: 'Bus', source: 'model', confidence: 0.9, observedAt: T },
            },
          }),
        ],
      }),
    );
    const [header, row] = rows(csv);
    const index = header!.split(',').indexOf('model_inferred_fields');
    expect(row!.split(',')[index]).toBe('bodyType');
  });

  it('joins note bodies onto the entity row', () => {
    const note = (body: string, id: string): Note => ({
      id,
      entityId: 'ent_1',
      body,
      createdAt: T,
      author: 'operator',
    });
    const csv = entitiesCsv(bundle({ notes: [note('first', 'n1'), note('second', 'n2')] }));
    expect(rows(csv)[1]).toContain('first | second');
  });
});

describe('sightingsCsv', () => {
  it('resolves the entity label and rounds derived numbers', () => {
    const csv = sightingsCsv(bundle());
    const [header, row] = rows(csv);
    const columns = header!.split(',');
    const values = row!.split(',');
    expect(values[columns.indexOf('entity_label')]).toBe('PERSON 014');
    expect(values[columns.indexOf('duration_seconds')]).toBe('4.2');
    expect(values[columns.indexOf('confidence')]).toBe('0.88');
  });

  it('leaves location columns empty when no fix was recorded', () => {
    const [header, row] = rows(sightingsCsv(bundle()));
    const columns = header!.split(',');
    const values = row!.split(',');
    expect(values[columns.indexOf('latitude')]).toBe('');
    expect(values[columns.indexOf('accuracy_m')]).toBe('');
  });

  it('writes coordinates as unquoted numbers when a fix exists', () => {
    const csv = sightingsCsv(
      bundle({
        sightings: [
          sighting({
            location: { latitude: 36.15, longitude: -95.99, accuracy: 12, timestamp: T },
          }),
        ],
      }),
    );
    const [header, row] = rows(csv);
    const columns = header!.split(',');
    const values = row!.split(',');
    expect(values[columns.indexOf('latitude')]).toBe('36.15');
    expect(values[columns.indexOf('longitude')]).toBe('-95.99');
  });

  it('renders attributes with their confidence', () => {
    const attribute = (key: string, value: string, confidence: number): Attribute => ({
      id: `att_${key}`,
      entityId: 'ent_1',
      key,
      value,
      confidence,
      observedAt: T,
      source: 'model',
    });
    const csv = sightingsCsv(
      bundle({
        sightings: [
          sighting({ attributes: [attribute('upper', 'blue', 0.82), attribute('lower', 'dark', 0.6)] }),
        ],
      }),
    );
    expect(rows(csv)[1]).toContain('upper=blue (82%); lower=dark (60%)');
  });

  it('reports whether an image was retained without exporting one', () => {
    const withImage = sightingsCsv(bundle({ sightings: [sighting({ thumbnailId: 'med_1' })] }));
    const [header, row] = rows(withImage);
    expect(row!.split(',')[header!.split(',').indexOf('has_image')]).toBe('yes');
  });
});

describe('toJson', () => {
  it('is parseable and declares its format, counts and image exclusion', () => {
    const parsed = JSON.parse(toJson(bundle())) as Record<string, unknown>;
    expect(parsed.format).toBe('flockraft-export');
    expect(parsed.includesImages).toBe(false);
    expect(parsed.counts).toMatchObject({ entities: 1, sightings: 1 });
    expect(parsed.exportedAtIso).toBe(new Date(T).toISOString());
  });

  it('preserves profile provenance losslessly', () => {
    const source = entity({
      profile: { plate: { value: 'ABC-1234', source: 'user', confidence: 1, observedAt: T } },
    });
    const parsed = JSON.parse(toJson(bundle({ entities: [source] }))) as {
      entities: Entity[];
    };
    expect(parsed.entities[0]?.profile?.plate).toEqual(source.profile?.plate);
  });
});

describe('buildArtifact', () => {
  it('names each file by format and stamps it with the export time', () => {
    expect(buildArtifact(bundle(), 'sightings-csv').filename).toBe(
      'flockraft-sightings-20260420-1432.csv',
    );
    expect(buildArtifact(bundle(), 'entities-csv').mimeType).toBe('text/csv;charset=utf-8');
    expect(buildArtifact(bundle(), 'json').filename).toBe('flockraft-backup-20260420-1432.json');
  });
});
