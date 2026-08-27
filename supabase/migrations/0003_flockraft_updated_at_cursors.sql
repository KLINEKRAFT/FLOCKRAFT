-- ===========================================================================
-- Change cursors for incremental sync
-- ===========================================================================
-- FLOCKRAFT is local-first: IndexedDB is the source of truth and Supabase is a
-- sync peer, not the primary store. A pull therefore has to answer "what
-- changed since I last looked", which `created_at` alone cannot — an entity
-- renamed, favourited or merged on another device keeps its original
-- created_at and would be invisible to the puller.
--
-- `updated_at` is maintained by a trigger rather than by the client so a buggy
-- or malicious client cannot backdate a row to hide it from another device's
-- pull cursor.

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

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
      'alter table public.%I add column if not exists updated_at timestamptz not null default now()',
      t
    );

    -- Cursor index: every pull is "my rows, ordered by updated_at, since X".
    execute format(
      'create index if not exists %I on public.%I (user_id, updated_at desc)',
      t || '_user_updated_idx', t
    );

    execute format('drop trigger if exists %I on public.%I', t || '_touch_updated_at', t);
    execute format(
      'create trigger %I before update on public.%I
         for each row execute function public.touch_updated_at()',
      t || '_touch_updated_at', t
    );
  end loop;
end
$$;
