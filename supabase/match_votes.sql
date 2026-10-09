-- WaveJack: one-round-trip fingerprint matching.
--
-- Apply once in the Supabase SQL Editor (safe to re-run). Read-only: it creates a
-- function and changes no data.
--
-- match_votes(hashes, offsets, bin) does the time-offset voting the backend used
-- to do in Python, inside the database, and returns only each song's best score:
--
--   for every clip hash h (at clip frame o) and every stored row with that hash:
--       delta = row.time_offset - o
--       bin = 2 (POST /identify): delta -> round_half_even(delta / 2) * 2
--                                 (exactly Python's round(delta / 2) * 2)
--       bin = 1 (WebSocket):      delta unchanged
--   votes(song, delta) = number of such rows
--   result: one row per song = its best (delta, votes), best songs first.
--
-- The caller passes each hash once with its clip frame (the backend dedupes with
-- the same "last occurrence wins" dict it always used). Returning a handful of rows
-- instead of thousands removes the PostgREST 1000-row cap from the lookup.
--
-- Ties (equal votes) are broken deterministically: songs by lowest song_id, a
-- song's offsets by lowest delta. The old Python code broke ties by database row
-- order, which was not deterministic either.

create or replace function public.match_votes(
  p_hashes  text[],
  p_offsets integer[],
  p_bin     integer default 1,
  p_limit   integer default 50
)
returns table (song_id bigint, delta integer, votes integer)
language sql
stable
security invoker
set search_path = public
as $$
  with clip as (
    select t.hash, t.clip_offset
    from unnest(p_hashes, p_offsets) as t(hash, clip_offset)
  ),
  hits as (
    select f.song_id, f.time_offset - clip.clip_offset as d
    from clip
    join public.fingerprints f on f.hash = clip.hash
  ),
  binned as (
    select
      hits.song_id,
      case
        when p_bin = 2 then
          case
            when hits.d % 2 = 0 then hits.d                                   -- d/2 is whole
            when (floor(hits.d / 2.0)::integer) % 2 = 0
              then 2 * floor(hits.d / 2.0)::integer                           -- tie -> even (down)
            else 2 * (floor(hits.d / 2.0)::integer + 1)                       -- tie -> even (up)
          end
        else hits.d
      end as delta
    from hits
  ),
  counted as (
    select binned.song_id, binned.delta, count(*)::integer as votes
    from binned
    group by binned.song_id, binned.delta
  ),
  best_per_song as (
    select distinct on (counted.song_id) counted.song_id, counted.delta, counted.votes
    from counted
    order by counted.song_id, counted.votes desc, counted.delta
  )
  select b.song_id, b.delta, b.votes
  from best_per_song b
  order by b.votes desc, b.song_id
  limit greatest(p_limit, 1);
$$;

comment on function public.match_votes(text[], integer[], integer, integer) is
  'WaveJack time-offset voting: best (delta, votes) per song for a clip''s hashes. bin 2 = /identify, 1 = WebSocket.';

-- Only the backend (service_role) may call it; browsers have no access to fingerprints.
revoke all on function public.match_votes(text[], integer[], integer, integer) from public, anon, authenticated;
grant execute on function public.match_votes(text[], integer[], integer, integer) to service_role;

-- Make the API see the new function right away.
notify pgrst, 'reload schema';
