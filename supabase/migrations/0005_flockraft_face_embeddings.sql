-- ===========================================================================
-- FLOCKRAFT — face descriptors
-- ===========================================================================
-- Stores the biometric templates that let a subject be recognised across
-- sessions and across devices.
--
-- This table is deliberately NOT folded into `attributes`. An attribute records
-- what someone was wearing on a day; a descriptor identifies a person across
-- time. They carry different obligations and they get different handling:
-- this table has its own delete path, its own storage counter on the privacy
-- screen, and its own setting gating whether anything is ever written to it.
--
-- Storage format
-- --------------
-- `descriptor` is base64 of a little-endian Float32Array, not a `real[]`.
--
--   * Exact. A float32 round-tripped through JSON depends on the serialiser
--     emitting enough digits; base64 of the raw bytes cannot lose precision.
--   * Small. 1024 floats are 4 KB raw and 5.4 KB base64, against roughly 12 KB
--     as a JSON number array. A full pull of a few thousand descriptors onto a
--     phone is the difference between ~11 MB and ~24 MB.
--
-- `dimensions` and `model` are stored alongside so that descriptors produced by
-- a future model can be identified and retired rather than silently compared
-- against incomparable vectors.
--
-- pgvector is deliberately not used. Matching happens on-device against the
-- operator's own gallery, so there is no server-side similarity search to
-- accelerate, and adding an extension to hold data the server never queries
-- would be cost without benefit.

create table face_embeddings (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  entity_id    uuid not null references entities (id) on delete cascade,
  sighting_id  uuid references sightings (id) on delete set null,
  -- base64 of a little-endian Float32Array; see above.
  descriptor   text not null check (length(descriptor) between 16 and 65536),
  dimensions   integer not null check (dimensions between 1 and 4096),
  model        text not null,
  -- Detector confidence for the face the descriptor was taken from.
  score        real not null check (score between 0 and 1),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Every read is "this user's descriptors" or "this entity's gallery".
create index face_embeddings_user_updated_idx
  on face_embeddings (user_id, updated_at desc);
create index face_embeddings_entity_idx
  on face_embeddings (entity_id, created_at desc);
create index face_embeddings_user_id_idx
  on face_embeddings (user_id);

drop trigger if exists face_embeddings_touch_updated_at on public.face_embeddings;
create trigger face_embeddings_touch_updated_at
  before update on public.face_embeddings
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- ROW-LEVEL SECURITY
-- ---------------------------------------------------------------------------
-- Same shape as every other table: owner-scoped, granted only to
-- `authenticated`, and `(select auth.uid())` so the call is hoisted into a
-- single initplan rather than re-evaluated per row.
--
-- The stakes are higher here than elsewhere in the schema. A leaked row from
-- `sightings` discloses that something was seen; a leaked row from this table
-- is a biometric template. There is no shared, public or service-role read path
-- to this data anywhere in the application.

alter table face_embeddings enable row level security;

create policy face_embeddings_select_own on public.face_embeddings
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy face_embeddings_insert_own on public.face_embeddings
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy face_embeddings_update_own on public.face_embeddings
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy face_embeddings_delete_own on public.face_embeddings
  for delete to authenticated
  using ((select auth.uid()) = user_id);
