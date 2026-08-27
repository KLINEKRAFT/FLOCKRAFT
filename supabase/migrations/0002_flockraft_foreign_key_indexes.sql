-- Covering indexes for foreign keys that had none.
--
-- These matter most on cascade delete: removing one entity has to find every
-- dependent row, and without a covering index each of those lookups is a
-- sequential scan. Deleting an entity is a first-class user action in
-- FLOCKRAFT, so this is on the interactive path, not a background chore.

create index if not exists media_sighting_idx on public.media (sighting_id);

create index if not exists associations_other_entity_idx
  on public.associations (other_entity_id);

create index if not exists attributes_sighting_idx on public.attributes (sighting_id);
create index if not exists attributes_user_idx     on public.attributes (user_id);
create index if not exists entities_thumbnail_idx  on public.entities (thumbnail_id);
create index if not exists media_session_idx       on public.media (session_id);
create index if not exists media_user_idx          on public.media (user_id);
create index if not exists notes_sighting_idx      on public.notes (sighting_id);
create index if not exists notes_user_idx          on public.notes (user_id);
create index if not exists sightings_thumbnail_idx on public.sightings (thumbnail_id);
