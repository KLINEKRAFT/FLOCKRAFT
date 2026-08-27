# FLOCKRAFT

A browser-based visual observation and memory system.

FLOCKRAFT watches a live camera feed, detects and tracks what is in frame, and
turns continuous appearances into structured, searchable records:

```
SEE → DETECT → TRACK → DESCRIBE → LOG → REMEMBER → SEARCH
```

It runs entirely in the browser — mobile Safari and desktop Chrome — with
detection on-device and observations stored locally. No camera frame is ever
uploaded.

---

## What it is not

Being explicit about this shapes the whole design:

- **Not a biometric identification system.** FLOCKRAFT does not build an
  identity database of unknown people. Entity matching is *proposed* and
  requires user confirmation; it is off by default.
- **Not a geographic tracker.** A single uncalibrated camera cannot recover a
  subject's world position. The map plots where the *camera* was, and the
  interface says so where it matters.
- **Not a claim of certainty.** Every model output carries a confidence, and
  readings below 70% are hedged in the copy ("possible blue jacket") rather than
  asserted.

---

## Running it

```bash
npm install
npm run dev          # http://localhost:3000
```

Camera access requires a secure context. `localhost` counts; any other host
needs HTTPS.

```bash
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
npm run build        # production build
npm run check        # all three
```

---

## Architecture

```
src/
  app/                  routes (App Router)
  components/
    ui/                 design system primitives
    layout/             shell, navigation, top bar
    live/               camera stage, overlay, controls, settings sheet
    timeline/           event log
    entities/           entity list and profile
    map/                canvas map renderer
    settings/           privacy, storage, sync and account
  hooks/                camera, pipeline, geolocation, settings, sync, queries
  lib/
    vision/             detectors, tracker, attributes, entity matcher
    store/              repository interface, IndexedDB, sync outbox
    profiles.ts         entity profile field definitions
    sync/               sync engine and domain↔row mappers
  types/                domain model + generated database types
supabase/migrations/    Postgres schema with row-level security
```

### The pipeline

```
camera → frame sample → detect → track → record → store
```

Each stage is replaceable, and the boundaries are real interfaces rather than
conventions.

**Frame sampling.** The video preview runs at the display refresh rate,
untouched. Only *inference* is throttled — 8 FPS by default. Detection is driven
by a self-rescheduling timer rather than `requestAnimationFrame`, so a slow
inference cannot stall compositing.

**Adaptive backoff.** Inference latency is tracked as a moving average; when it
exceeds the frame budget, the interval stretches to match what the device can
actually do. A thermally-throttled phone slows down instead of locking up.

**Detection** (`lib/vision/detector.ts`). Every backend implements one
interface. Two ship today:

| Detector | Size | Notes |
| --- | --- | --- |
| `coco-ssd` | ~6 MB | MobileNet V2 via TensorFlow.js, WebGL backend. 80 COCO classes. |
| `simulated` | 0 | Synthetic, temporally-coherent detections. Fallback and QA fixture. |

TensorFlow.js is dynamically imported, so ~1 MB of JS never enters the initial
bundle — the shell renders and the camera starts before the model is requested.
Adding an ONNX Runtime Web or WebGPU backend means implementing `Detector` and
adding one line to the registry.

**Tracking** (`lib/vision/tracker.ts`). A detector is stateless: without a
tracker, a person standing in view for thirty frames produces thirty entities.
This is a tracking-by-detection associator in the SORT family — predict by
smoothed velocity, score candidates on IoU plus centroid proximity plus shape
similarity, assign greedily, age out unmatched tracks after a grace period so
brief occlusion does not fragment a track.

Two identifiers are kept strictly separate:

- **Track ID** — ephemeral, valid only within one tracker run (`PERSON TEMP-04`)
- **Entity ID** — durable, survives sessions, user-mergeable (`PERSON 014`)

**Attributes** (`lib/vision/attributes.ts`). Dominant-colour sampling from
anatomically-motivated sub-regions of a detection box, with confidence derived
from how dominant the colour actually is. It deliberately does *not* classify
garment type, bags, or headwear — that needs a dedicated model, and inventing
plausible-sounding labels would be worse than reporting nothing.

**Recording** (`lib/observationRecorder.ts`). A track becomes an observation
only after it has been continuously visible past a dwell threshold (1.5 s by
default). Without that, every momentary false positive would mint a permanent
entity. The sighting is written to storage *at promotion* and updated on close,
so an interrupted session — tab closed, page reclaimed, battery dead — still
leaves a coherent record.

### Entity profiles

Structured, mostly operator-recorded fields — vehicle make / model / approximate
year / body type / licence plate / tag state, person gender / approximate age /
approximate height / description, plus animal and object sets.

These are **recorded, not inferred**, and that is a deliberate design decision
rather than a missing feature. A single uncalibrated camera cannot determine
most of them:

| Field | Why it isn't automatic |
| --- | --- |
| Height | Needs a ground plane and known camera geometry. Pixel height is a function of distance, not stature. |
| Make / model / year | Needs a fine-grained classifier over hundreds of vehicle classes. COCO reports `car` / `truck` / `bus` and nothing finer. |
| Licence plate | Needs plate localisation plus OCR at a resolution a wide-angle phone camera rarely delivers. |
| Gender | Not visually determinable. A classifier would predict perceived presentation from its training distribution and be confidently wrong about real people. |

What *is* filled automatically is only what is genuinely measured: colour
sampled from the frame, and the two body types COCO reports as distinct classes
(motorcycle, bus). A sedan-versus-SUV guess from box aspect ratio would be close
to noise, so it isn't made.

Every field carries provenance — `source: 'model' | 'user'` with a confidence —
so the interface shows a sampled colour and an operator's plate reading
differently. Field definitions live in one place, `lib/profiles.ts`, and drive
storage, the editor, display and search; adding a field is one line there.

Profile values are part of the local search surface, so searching a plate or a
make finds the entity.

### Storage and sync

`ObservationRepository` is the persistence contract. IndexedDB is the primary
implementation and the source of truth — the app is fully functional with no
account and no network.

Signing in does **not** swap the store. `SyncingRepository` decorates the local
one, delegating every read untouched and recording a sync intent on every
mutation. That choice is the whole point: a network-backed repository would
have turned every timeline scroll into a round-trip and made the app unusable
on a bad connection, which is the opposite of what a field tool needs.

```
        reads ─────────────────────────► IndexedDB   (always local, always fast)
        writes ──► SyncingRepository ──► IndexedDB
                          │
                          └─► outbox ──► SyncEngine ──► Supabase
```

**Outbox.** Every mutation appends an intent keyed by record id. An outbox
rather than diffing tables, because a delete leaves no row to diff — without a
recorded intent, deleting an entity offline would never propagate and the next
pull would resurrect it. Entries carry identity only, never a payload snapshot,
so ten rapid edits cost one upload of the final state.

**Push** drains the outbox parents-first (sessions → entities → media →
sightings → attributes → notes → associations) so a foreign key is never
dangling. Media blobs upload to the private bucket; thumbnails are linked in a
second pass once their media row exists.

**Pull** fetches rows whose `updated_at` is newer than the local cursor.
`updated_at` is maintained by a Postgres trigger rather than the client, so a
buggy client cannot backdate a row out of another device's view.

Everything is idempotent — every write is an upsert keyed by the record's own
id — so a push that lands server-side but dies before clearing the outbox
simply replays harmlessly.

**Conflicts** are last-write-wins, stated as a limitation rather than hidden.
FLOCKRAFT's records are overwhelmingly append-only: a sighting is written once
and never edited. The only realistic conflict is the same entity being renamed
or favourited on two devices while both were offline, and losing one of those
does not justify a CRDT. What must never be lost is an *observation*, and
observations cannot conflict — their ids are generated locally and are unique
per device.

### Authentication

Email magic link only. No password to store, reset, or leak.

Authentication exists for exactly one reason: row-level security needs an
`auth.uid()` to scope rows to. FLOCKRAFT stays fully usable signed out —
detection, entity memory and every screen work with no account. Signing in adds
cross-device sync and nothing else, and while signed out the outbox stays
empty rather than quietly accumulating.

### Database

`supabase/migrations/` defines the Postgres schema: every table owner-scoped,
RLS enabled with per-user policies granted only to the `authenticated` role, and
a private storage bucket whose policies assert the object path's first segment
equals the caller's uid, with a 5 MB image-only cap.

Policies use `(select auth.uid())` rather than the bare call — `auth.uid()` is
STABLE, not IMMUTABLE, so the unwrapped form re-evaluates once per row instead
of being hoisted into a single initplan. That is measurable on a timeline read.

Regenerate types after a schema change:

```bash
npx supabase gen types typescript --project-id <ref> > src/types/supabase.ts
```

### Map

`components/map/TacticalMap.tsx` is a canvas renderer built on ~30 lines of Web
Mercator maths rather than a mapping library — MapLibre is several hundred
kilobytes for features this screen does not use. It supports pan, pinch/wheel
zoom, keyboard navigation, a true-to-scale accuracy circle, a scale bar, and
screen-space marker clustering (a stationary session records everything at one
coordinate, so without clustering the markers pile up illegibly).

Set `NEXT_PUBLIC_MAP_TILE_URL` to an XYZ template for a raster basemap;
without it the map renders a coordinate reference grid.

---

## Privacy model

Defaults are conservative. Off until explicitly enabled:

- video clips
- location capture
- face analysis
- automatic entity matching

On by default: observations and thumbnails (~4–8 KB each).

Everything is on one screen (`/settings`) with live storage usage, and deletion
is complete — deleting an entity offers explicit control over sightings, media,
notes and associations; purging removes everything irreversibly.

### Secrets

Only `NEXT_PUBLIC_*` values reach the browser. The service-role key must never
carry that prefix, is not read anywhere in this codebase, and belongs only in a
route handler or server action. See `.env.example`.

---

## PWA

Installable with a manifest, maskable icons, and an offline shell. The service
worker uses network-first for navigations (a cached HTML document would pin a
stale JS bundle), stale-while-revalidate for content-hashed assets, and
cache-first for model weights — several megabytes that never change for a given
URL.

---

## Accessibility

- 44 px minimum touch targets
- status never communicated by colour alone — every badge carries a text label
  and a distinct indicator shape
- full dialog semantics on sheets: focus trap, focus restoration, Escape,
  scroll lock
- semantic landmarks, visible focus rings, `prefers-reduced-motion` honoured
- zoom is not disabled

---

## Deploying

Vercel, zero configuration. HTTPS is mandatory for camera access, which Vercel
provides by default.

Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` in the
project settings to enable sync; without them the app runs local-only and says
so on the settings screen.

For magic links to work, every origin the app is served from — production,
preview deployments and `http://localhost:3000` — must be listed under
**Authentication → URL Configuration → Redirect URLs** in Supabase, as
`<origin>/auth/callback`. A link opened at an unlisted origin bounces.

---

## Roadmap

**Shipped** — design system, four-screen shell, camera lifecycle, live
detection with COCO-SSD, multi-object tracking, dwell-gated observation
recording, appearance sampling, entity memory with merge and split, timeline
with filters and activity graph, canvas map, privacy controls, PWA.

Cross-device sync — Postgres schema with RLS, magic-link auth, an offline
outbox, and a bidirectional sync engine with lazy media fetch.

Entity profiles — operator-recorded vehicle and person fields with provenance,
searchable, synced.

CI — typecheck, lint and build on every pull request.

**Next**

1. Appearance embeddings for occlusion recovery and stronger match proposals
2. Face bounding boxes and landmarks (boxes only — no identity database)
3. Event clip capture, opt-in
4. Natural-language search over the structured filters already in place
5. Conflict surfacing — show when a pull overwrote a local edit, rather than
   silently applying last-write-wins
