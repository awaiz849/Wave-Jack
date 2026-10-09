-- WaveJack-New — read-only schema check. Safe to run any number of times.
-- Reads only the system catalogs (no table data). Every row should say PASS.
with checks(item, ok) as (
  -- tables
  select 'table public.' || t, to_regclass('public.' || t) is not null
  from (values ('songs'), ('fingerprints'), ('users'), ('search_history')) as v(t)

  -- indexes
  union all
  select 'index ' || i,
         exists (select 1 from pg_indexes where schemaname = 'public' and indexname = i)
  from (values ('fingerprints_hash_idx'), ('fingerprints_song_id_idx'),
               ('search_history_user_time_idx'), ('search_history_song_id_idx')) as v(i)

  -- RLS enabled
  union all
  select 'RLS enabled on public.' || t,
         coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.' || t)), false)
  from (values ('songs'), ('fingerprints'), ('users'), ('search_history')) as v(t)

  -- expected policies
  union all
  select 'policy "' || p || '" on ' || t,
         exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = p)
  from (values ('songs', 'signed-in users can read songs'),
               ('users', 'read own profile'),
               ('users', 'update own username'),
               ('search_history', 'read own history'),
               ('search_history', 'add own history')) as v(t, p)

  -- fingerprints must have no policies (backend-only table)
  union all
  select 'no policies on fingerprints (backend only)',
         not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'fingerprints')

  -- Auth functions and triggers
  union all
  select 'function public.' || f || '()', to_regprocedure('public.' || f || '()') is not null
  from (values ('handle_new_user'), ('handle_user_email_change')) as v(f)
  union all
  select 'trigger ' || g || ' on auth.users',
         exists (select 1 from pg_trigger where tgrelid = 'auth.users'::regclass and tgname = g and not tgisinternal)
  from (values ('on_auth_user_created'), ('on_auth_user_email_changed')) as v(g)

  -- browser roles must not reach fingerprints or write songs
  union all
  select 'anon cannot read fingerprints',          not has_table_privilege('anon', 'public.fingerprints', 'select')
  union all
  select 'authenticated cannot read fingerprints', not has_table_privilege('authenticated', 'public.fingerprints', 'select')
  union all
  select 'authenticated cannot insert songs',      not has_table_privilege('authenticated', 'public.songs', 'insert')
  union all
  select 'authenticated cannot insert users',      not has_table_privilege('authenticated', 'public.users', 'insert')

  -- search_history.user_id is a UUID now
  union all
  select 'search_history.user_id is uuid',
         exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'search_history'
                   and column_name = 'user_id' and data_type = 'uuid')
)
select case when ok then 'PASS' else 'FAIL' end as result, item
from checks
order by ok, item;
