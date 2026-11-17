-- =============================================================================
-- Naav Bins — user accounts on Supabase Auth (fresh start)
--
-- Run ONCE in the Supabase SQL Editor (Dashboard → SQL Editor → New query → Run).
--
-- ⚠️  This permanently deletes ALL existing user profiles and ALL Supabase Auth users.
--     The `bins` table and its data are NOT touched.
--
-- What it sets up:
--   • public.user_profiles keyed by the Supabase Auth user id. Deleting a user in
--     Authentication → Users deletes their profile automatically (no orphans).
--   • A trigger that creates the profile in the same transaction as sign-up
--     (email/password or Google / Facebook / LinkedIn).
--   • A trigger that keeps the profile email in sync if a user changes their email.
--   • Row Level Security: the browser key cannot read or write profiles or bins
--     directly; only the backend (secret key) can.
--
-- Roles live in ONE place: user_profiles.role ('user' | 'admin'). New accounts are
-- always 'user'. To make someone an admin, run:
--   update public.user_profiles set role = 'admin' where email = 'naavhackers@gmail.com';
-- =============================================================================

begin;

-- 1. Remove the old profile table (keyed by email) and every existing auth user.
drop table if exists public.user_profiles cascade;
delete from auth.users;

-- 2. Profiles, one per auth user.
create table public.user_profiles (
    id              uuid primary key references auth.users (id) on delete cascade,
    email           text not null unique,
    name            text not null default '',
    role            text not null default 'user' check (role in ('user', 'admin')),
    "walletBalance" integer not null default 0 check ("walletBalance" >= 0),
    "ecoPoints"     integer not null default 0 check ("ecoPoints" >= 0),
    logs            jsonb not null default '[]'::jsonb,
    redemptions     jsonb not null default '[]'::jsonb,
    "createdAt"     timestamptz not null default timezone('utc', now())
);

comment on table public.user_profiles is 'Naav Bins rewards profile; one row per auth.users row (cascade delete).';

create index user_profiles_leaderboard_idx on public.user_profiles ("ecoPoints" desc) where role = 'user';

-- 3. Create the profile automatically at sign-up (same transaction as the auth user).
--    The display name comes from the sign-up form ("name") or the social provider
--    ("full_name" / "name"), falling back to the part of the email before "@".
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    insert into public.user_profiles (id, email, name)
    values (
        new.id,
        new.email,
        left(coalesce(
            nullif(trim(new.raw_user_meta_data ->> 'name'), ''),
            nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
            split_part(new.email, '@', 1)
        ), 60)
    )
    on conflict (id) do nothing;
    return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();

-- 4. Keep the profile email in sync when a user changes their email address.
create or replace function public.handle_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    update public.user_profiles set email = new.email where id = new.id;
    return new;
end;
$$;

drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed
    after update of email on auth.users
    for each row
    when (old.email is distinct from new.email)
    execute function public.handle_user_email_change();

-- 5. Lock tables: only the backend (secret key, which bypasses RLS) may access them.
alter table public.user_profiles enable row level security;
alter table public.bins           enable row level security;
revoke all on public.user_profiles from anon, authenticated;
revoke insert, update, delete, truncate on public.bins from anon, authenticated;

commit;
