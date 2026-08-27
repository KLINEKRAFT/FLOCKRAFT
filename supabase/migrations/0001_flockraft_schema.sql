-- ===========================================================================
-- FLOCKRAFT — core observation schema
-- ===========================================================================
-- Mirrors src/types/domain.ts. Every table is owner-scoped and protected by
-- row-level security: a user can only ever read or write their own rows. There
-- is no shared or public read path anywhere in this schema.
-- ===========================================================================

create extension if not exists "pgcrypto";

-- --- Enumerations ----------------------------------------------------------

create type entity_kind as enum ('person', 'vehicle', 'animal', 'object');

create type camera_direction as enum (
  'left', 'right', 'up', 'down', 'toward', 'away', 'static'
);

create type attribute_source as enum ('model', 'user');

create type media_kind as enum ('thumbnail', 'snapshot', 'clip');

-- --- Sessions --------------------------------------------------------------

create table sessions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  started_at    timestamptz not null default now(),
  ended_at      timestamptz,
  device_label  text,
  facing_mode   text check (facing_mode in ('user', 'environment')),
  detector_id   text not null,
  -- Geography is optional and only written when the user enables location.
  latitude      double precision,
  longitude     double precision,
  accuracy_m    double precision,
  counts        jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

create index sessions_user_started_idx on sessions (user_id, started_at desc);

-- --- Entities --------------------------------------------------------------

create table entities (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  label           text not null,
  kind            entity_kind not null,
  class           text not null,
  first_seen_at   timestamptz not null,
  last_seen_at    timestamptz not null,
  sighting_count  integer not null default 0,
  favorite        boolean not null default false,
  summary         text,
  thumbnail_id    uuid,
  -- Retained so that a user-performed merge can be offered as a split later.
  merged_from_ids uuid[] not null default '{}',
  archived_at     timestamptz,
  created_at      timestamptz not null default now()
);

create index entities_user_last_seen_idx on entities (user_id, last_seen_at desc);
create index entities_user_kind_idx on entities (user_id, kind);
-- Partial index: favourites are a small, frequently-filtered subset.
create index entities_favorite_idx on entities (user_id) where favorite;

-- Per-user, per-kind ordinal source for designations such as `PERSON 014`.
create table entity_ordinals (
  user_id uuid not null references auth.users (id) on delete cascade,
  kind    entity_kind not null,
  value   integer not null default 0,
  primary key (user_id, kind)
);

-- --- Sightings -------------------------------------------------------------

create table sightings (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  entity_id     uuid not null references entities (id) on delete cascade,
  session_id    uuid not null references sessions (id) on delete cascade,
  observation_id uuid not null,
  class         text not null,
  kind          entity_kind not null,
  started_at    timestamptz not null,
  ended_at      timestamptz not null,
  duration_ms   integer not null,
  confidence    real not null check (confidence between 0 and 1),
  -- Normalised 0..1 box, stored as {x,y,width,height}.
  box           jsonb not null,
  direction     camera_direction not null default 'static',
  thumbnail_id  uuid,
  latitude      double precision,
  longitude     double precision,
  accuracy_m    double precision,
  created_at    timestamptz not null default now()
);

create index sightings_user_started_idx on sightings (user_id, started_at desc);
create index sightings_entity_idx on sightings (entity_id, started_at desc);
create index sightings_session_idx on sightings (session_id);

-- --- Attributes ------------------------------------------------------------
-- Time-stamped observations, never permanent properties: a subject wore a blue
-- jacket on a given day; they are not "a person with a blue jacket".

create table attributes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  entity_id   uuid not null references entities (id) on delete cascade,
  sighting_id uuid references sightings (id) on delete cascade,
  key         text not null,
  value       text not null,
  confidence  real not null check (confidence between 0 and 1),
  observed_at timestamptz not null,
  source      attribute_source not null default 'model'
);

create index attributes_entity_idx on attributes (entity_id, observed_at desc);

-- --- Notes -----------------------------------------------------------------

create table notes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  entity_id   uuid not null references entities (id) on delete cascade,
  sighting_id uuid references sightings (id) on delete set null,
  body        text not null check (length(body) between 1 and 4000),
  author      text not null,
  created_at  timestamptz not null default now()
);

create index notes_entity_idx on notes (entity_id, created_at desc);

-- --- Associations ----------------------------------------------------------
-- Symmetric co-visibility. Both directions are stored so per-entity lookup is
-- a single index read; the check constraint prevents self-association.

create table associations (
  user_id          uuid not null references auth.users (id) on delete cascade,
  entity_id        uuid not null references entities (id) on delete cascade,
  other_entity_id  uuid not null references entities (id) on delete cascade,
  count            integer not null default 1,
  last_observed_at timestamptz not null,
  primary key (entity_id, other_entity_id),
  constraint associations_not_self check (entity_id <> other_entity_id)
);

create index associations_user_idx on associations (user_id, count desc);

-- --- Media -----------------------------------------------------------------
-- Binary content lives in Storage; this table holds only metadata and the
-- object path.

create table media (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  entity_id    uuid references entities (id) on delete cascade,
  sighting_id  uuid references sightings (id) on delete cascade,
  session_id   uuid references sessions (id) on delete cascade,
  kind         media_kind not null,
  mime_type    text not null,
  width        integer not null,
  height       integer not null,
  byte_size    integer not null,
  storage_path text not null,
  created_at   timestamptz not null default now()
);

create index media_entity_idx on media (entity_id, created_at desc);

alter table entities
  add constraint entities_thumbnail_fk
  foreign key (thumbnail_id) references media (id) on delete set null;

alter table sightings
  add constraint sightings_thumbnail_fk
  foreign key (thumbnail_id) references media (id) on delete set null;

-- ===========================================================================
-- ROW-LEVEL SECURITY
-- ===========================================================================
-- Enabled on every table. Each policy compares auth.uid() to the row's owner,
-- so a leaked anon key grants nothing without a valid session token.

alter table sessions        enable row level security;
alter table entities        enable row level security;
alter table entity_ordinals enable row level security;
alter table sightings       enable row level security;
alter table attributes      enable row level security;
alter table notes           enable row level security;
alter table associations    enable row level security;
alter table media           enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array[
    'sessions', 'entities', 'entity_ordinals', 'sightings',
    'attributes', 'notes', 'associations', 'media'
  ]
  loop
    execute format(
      'create policy %I on %I for select using (auth.uid() = user_id)',
      t || '_select_own', t
    );
    execute format(
      'create policy %I on %I for insert with check (auth.uid() = user_id)',
      t || '_insert_own', t
    );
    execute format(
      'create policy %I on %I for update using (auth.uid() = user_id) with check (auth.uid() = user_id)',
      t || '_update_own', t
    );
    execute format(
      'create policy %I on %I for delete using (auth.uid() = user_id)',
      t || '_delete_own', t
    );
  end loop;
end
$$;

-- ===========================================================================
-- STORAGE
-- ===========================================================================
-- The observations bucket is PRIVATE. Objects are addressed as
-- `<user_id>/<media_id>.jpg` and every policy asserts that the first path
-- segment equals the caller's uid, so one user can never enumerate or read
-- another's media.

insert into storage.buckets (id, name, public)
values ('observations', 'observations', false)
on conflict (id) do nothing;

create policy "observations_read_own"
  on storage.objects for select
  using (
    bucket_id = 'observations'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "observations_insert_own"
  on storage.objects for insert
  with check (
    bucket_id = 'observations'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "observations_delete_own"
  on storage.objects for delete
  using (
    bucket_id = 'observations'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ===========================================================================
-- Ordinal allocation
-- ===========================================================================
-- Atomically increments and returns the next per-kind designation number.
-- SECURITY INVOKER so RLS still applies to the underlying table.

create or replace function next_entity_ordinal(p_kind entity_kind)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  next_value integer;
begin
  insert into entity_ordinals (user_id, kind, value)
  values (auth.uid(), p_kind, 1)
  on conflict (user_id, kind)
    do update set value = entity_ordinals.value + 1
  returning value into next_value;

  return next_value;
end;
$$;
