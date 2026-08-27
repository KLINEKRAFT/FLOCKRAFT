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
    settings/           privacy and storage
  hooks/                camera, pipeline, geolocation, settings, queries
  lib/
    vision/             detectors, tracker, attributes, entity matcher
    store/              repository interface + IndexedDB implementation
  types/                domain model
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

### Storage

`ObservationRepository` is the persistence contract. IndexedDB is the primary
implementation and the source of truth — the app is fully functional with no
account and no network.

`supabase/migrations/0001_flockraft_schema.sql` defines the Postgres schema for
sync: every table owner-scoped, RLS enabled with per-user policies, and a
private storage bucket whose policies assert the path's first segment equals the
caller's uid. The Supabase repository adapter is the next milestone; the
selector in `lib/store/index.ts` is the only call site that changes.

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

Vercel, zero configuration. Set the environment variables from `.env.example` in
the project settings. HTTPS is mandatory for camera access, which Vercel
provides by default.

---

## Roadmap

**Shipped** — design system, four-screen shell, camera lifecycle, live
detection with COCO-SSD, multi-object tracking, dwell-gated observation
recording, appearance sampling, entity memory with merge and split, timeline
with filters and activity graph, canvas map, privacy controls, PWA.

**Next**

1. Supabase repository adapter and sync, behind the existing interface
2. Appearance embeddings for occlusion recovery and stronger match proposals
3. Face bounding boxes and landmarks (boxes only — no identity database)
4. Event clip capture, opt-in
5. Natural-language search over the structured filters already in place
