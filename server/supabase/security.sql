-- Naav Bins — lock the database so it can only be reached through the backend API.
--
-- WHY: the public (publishable/anon) Supabase key has been committed to git. While Row Level
-- Security is OFF, anyone holding that key can read and edit every user's wallet directly through
-- Supabase's REST API, bypassing all of the backend's checks.
--
-- ORDER MATTERS:
--   1. Put SUPABASE_SECRET_KEY (Project Settings → API Keys → Secret key) in the server environment
--      (server/.env locally AND the Render dashboard) and restart/redeploy the backend.
--   2. Confirm the app works (login, dashboard, map, leaderboard).
--   3. Only then run this script in the Supabase SQL Editor.
-- If you run this before step 1, the backend (still on the public key) will see empty tables.
--
-- With RLS enabled and NO policies, the anon/authenticated roles get no rows at all, while the
-- secret (service role) key used by the backend bypasses RLS.

alter table public.user_profiles enable row level security;
alter table public.bins           enable row level security;

-- Belt and braces: the public roles never need direct write access.
revoke insert, update, delete, truncate on public.user_profiles from anon, authenticated;
revoke insert, update, delete, truncate on public.bins           from anon, authenticated;

-- To undo (NOT recommended):
--   alter table public.user_profiles disable row level security;
--   alter table public.bins           disable row level security;
