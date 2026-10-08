-- ═══════════════════════════════════════════════════════════════════════
-- WaveJack-New — database schema v1
-- Run ONCE in the WaveJack-New SQL editor (as postgres). Review first.
-- Matches the current backend/frontend code; no app changes required.
-- ═══════════════════════════════════════════════════════════════════════
begin;

-- ─── 1. songs ──────────────────────────────────────────────────────────
-- The song library. Written only by the backend (admin routes).
create table public.songs (
  id          bigint generated always as identity primary key,
  title       text        not null check (char_length(title)  between 1 and 200),
  artist      text        not null check (char_length(artist) between 1 and 200),
  filename    text        not null,
  youtube_url text        check (youtube_url is null
                                 or (youtube_url ~* '^https?://' and char_length(youtube_url) <= 500)),
  created_at  timestamptz not null default now()
);

-- ─── 2. fingerprints ───────────────────────────────────────────────────
-- One row per (hash, time) pair of every song. Millions of rows; only the
-- backend (service role) ever reads or writes it.
create table public.fingerprints (
  id          bigint  generated always as identity primary key,  -- used to page through very common hashes
  hash        text    not null check (hash ~ '^[0-9a-f]{16}$'),  -- first 16 hex chars of SHA-1, as fingerprint.py makes them
  song_id     bigint  not null references public.songs (id) on delete cascade,
  time_offset integer not null check (time_offset >= 0)          -- STFT frame number (hop 512 @ 22050 Hz)
);

-- Every recognition looks fingerprints up by hash (WHERE hash IN (...)).
create index fingerprints_hash_idx    on public.fingerprints (hash);
-- Deleting a song (and the cascade above) finds its rows by song_id.
create index fingerprints_song_id_idx on public.fingerprints (song_id);

-- ─── 3. users (app profile, one row per Supabase Auth account) ─────────
-- Passwords live in Supabase Auth only. The row is created automatically
-- by the trigger below when someone signs up.
create table public.users (
  id         uuid        primary key references auth.users (id) on delete cascade,
  email      text        not null,
  username   text        not null check (char_length(username) between 1 and 100),
  created_at timestamptz not null default now()
);

-- ─── 4. search_history ─────────────────────────────────────────────────
-- FIX: user_id is the Supabase Auth UUID (was an integer FK to users.id,
-- so every insert from the frontend failed silently).
create table public.search_history (
  id          bigint      generated always as identity primary key,
  user_id     uuid        not null default auth.uid()
                          references auth.users (id) on delete cascade,
  song_id     bigint      references public.songs (id) on delete set null,  -- nullable: the frontend may send null
  searched_at timestamptz not null default now()
);

-- "My history, newest first" — the exact query the History page runs.
create index search_history_user_time_idx on public.search_history (user_id, searched_at desc);
-- Lets "on delete set null" find rows quickly when a song is deleted.
create index search_history_song_id_idx   on public.search_history (song_id);

-- ─── 5. Supabase Auth integration ──────────────────────────────────────
-- Create the profile row when an account is created.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.users (id, email, username)
  values (
    new.id,
    coalesce(new.email, ''),
    left(coalesce(nullif(trim(new.raw_user_meta_data ->> 'name'), ''),
                  nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
                  'user'), 100)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Keep users.email in step if someone changes their email in Auth.
create or replace function public.handle_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.users set email = coalesce(new.email, '') where id = new.id;
  return new;
end;
$$;

create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row when (old.email is distinct from new.email)
  execute function public.handle_user_email_change();

-- These run only as triggers; nobody should call them through the API.
revoke execute on function public.handle_new_user()          from public, anon, authenticated;
revoke execute on function public.handle_user_email_change() from public, anon, authenticated;

-- ─── 6. Row Level Security + privileges ────────────────────────────────
alter table public.songs          enable row level security;
alter table public.fingerprints   enable row level security;
alter table public.users          enable row level security;
alter table public.search_history enable row level security;

-- Start from no access for browser roles, then grant exactly what the frontend uses.
revoke all on public.songs, public.fingerprints, public.users, public.search_history
  from anon, authenticated;

grant select                        on public.songs          to authenticated;  -- history page joins songs(title, artist)
grant select, insert                on public.search_history to authenticated;
grant select, update (username)     on public.users          to authenticated;
grant all on public.songs, public.fingerprints, public.users, public.search_history to service_role;

-- songs: any signed-in user may read; nobody but the backend may write.
create policy "signed-in users can read songs"
  on public.songs for select to authenticated
  using (true);

-- fingerprints: NO policies on purpose -> only the service role (backend) can touch it.

-- users: read and rename your own profile only.
create policy "read own profile"
  on public.users for select to authenticated
  using (id = (select auth.uid()));
create policy "update own username"
  on public.users for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- search_history: read and add your own entries only.
create policy "read own history"
  on public.search_history for select to authenticated
  using (user_id = (select auth.uid()));
create policy "add own history"
  on public.search_history for insert to authenticated
  with check (user_id = (select auth.uid()));

commit;
