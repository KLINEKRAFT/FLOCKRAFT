-- ===========================================================================
-- Entity profiles
-- ===========================================================================
-- Structured, mostly operator-recorded fields: vehicle make/model/year/plate
-- and tag state, person gender/age/height/description, and so on.
--
-- Stored as JSONB rather than as ~15 nullable typed columns because the field
-- set differs per entity kind and is expected to grow. A column-per-field
-- schema would be mostly NULL on every row and would need a migration for each
-- new field; the shape is declared once in src/lib/profiles.ts and drives
-- storage, editing, display and search from there.
--
-- Each value carries its own provenance:
--   {"plate": {"value": "ABC-1234", "source": "user", "confidence": 1,
--              "observedAt": 1787846400000}}
-- so the interface can distinguish a colour the detector sampled from a plate
-- an operator read off the vehicle. Search runs locally against IndexedDB, so
-- this column needs no full-text index; the GIN index below serves containment
-- queries such as "every vehicle with a plate recorded".

alter table public.entities
  add column if not exists profile jsonb not null default '{}'::jsonb;

create index if not exists entities_profile_idx
  on public.entities using gin (profile jsonb_path_ops);

comment on column public.entities.profile is
  'Operator-maintained structured fields, keyed by field id, each carrying value/source/confidence/observedAt. Schema declared in src/lib/profiles.ts.';
