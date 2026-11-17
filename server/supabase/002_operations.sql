-- =============================================================================
-- Naav Bins — operations, leagues, fraud controls and normalised tables
--
-- Run AFTER schema.sql, in the Supabase SQL Editor. Safe to run more than once:
-- every statement is idempotent and existing data is preserved.
--
-- What it adds:
--   • bins: waste stream (BBMP dry / wet / reject, or a multi-compartment station),
--     fill level, capacity, dynamic-QR mode and device key version.
--   • reward_rules + reward_catalog: the reward table now lives in the database.
--     The API reads it; the web app fetches it from the API.
--   • waste_logs + redemptions: their own tables (moved out of the JSON columns on
--     user_profiles). Existing JSON data is migrated, then the JSON columns are dropped.
--     waste_logs records the estimated weight and, when the bin has a scale, the
--     measured weight.
--   • fraud_flags, bin_collections, challenge_claims, campus_groups (departments, hostels).
--   • Transactional functions for every balance change (deposit, redemption, admin
--     decision, challenge bonus). They are callable only with the secret key.
--   • Row Level Security on every table: the browser key can read or write none of them.
-- =============================================================================

begin;

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- 1. Bins
-- -----------------------------------------------------------------------------
create table if not exists public.bins (
    id      text primary key,
    name    text not null,
    lat     double precision,
    lng     double precision,
    status  text not null default 'Active'
);

alter table public.bins add column if not exists stream text not null default 'station';
alter table public.bins add column if not exists zone text;
alter table public.bins add column if not exists capacity_items integer not null default 200;
alter table public.bins add column if not exists fill_level numeric;
alter table public.bins add column if not exists fill_source text;
alter table public.bins add column if not exists fill_updated_at timestamptz;
alter table public.bins add column if not exists last_emptied_at timestamptz;
alter table public.bins add column if not exists last_seen_at timestamptz;
alter table public.bins add column if not exists qr_mode text not null default 'static';
alter table public.bins add column if not exists device_key_version integer not null default 1;

alter table public.bins drop constraint if exists bins_stream_check;
alter table public.bins add constraint bins_stream_check check (stream in ('station', 'dry', 'wet', 'reject'));
alter table public.bins drop constraint if exists bins_qr_mode_check;
alter table public.bins add constraint bins_qr_mode_check check (qr_mode in ('static', 'dynamic'));
alter table public.bins drop constraint if exists bins_fill_level_check;
alter table public.bins add constraint bins_fill_level_check check (fill_level is null or (fill_level >= 0 and fill_level <= 100));
alter table public.bins drop constraint if exists bins_capacity_check;
alter table public.bins add constraint bins_capacity_check check (capacity_items > 0);

comment on column public.bins.stream is 'station = multi-compartment (accepts every stream); dry / wet / reject = single-stream bin (BBMP).';
comment on column public.bins.qr_mode is 'static = printed signed QR; dynamic = rotating code on the bin''s screen (printed codes are refused).';

-- -----------------------------------------------------------------------------
-- 2. Campus groups (departments and hostels) and profile fields
-- -----------------------------------------------------------------------------
create table if not exists public.campus_groups (
    id      text primary key,
    kind    text not null check (kind in ('department', 'hostel')),
    name    text not null,
    labels  jsonb not null default '{}'::jsonb,   -- {"kn": "...", "hi": "..."}
    sort    integer not null default 0,
    active  boolean not null default true
);

insert into public.campus_groups (id, kind, name, labels, sort) values
    ('dept-cse',  'department', 'Computer Science',          '{"kn":"ಕಂಪ್ಯೂಟರ್ ಸೈನ್ಸ್","hi":"कंप्यूटर साइंस"}', 1),
    ('dept-ise',  'department', 'Information Science',       '{"kn":"ಇನ್ಫರ್ಮೇಷನ್ ಸೈನ್ಸ್","hi":"इन्फॉर्मेशन साइंस"}', 2),
    ('dept-aiml', 'department', 'AI & Machine Learning',     '{"kn":"ಎಐ ಮತ್ತು ಮೆಷಿನ್ ಲರ್ನಿಂಗ್","hi":"एआई और मशीन लर्निंग"}', 3),
    ('dept-ece',  'department', 'Electronics & Communication','{"kn":"ಎಲೆಕ್ಟ್ರಾನಿಕ್ಸ್ ಮತ್ತು ಸಂವಹನ","hi":"इलेक्ट्रॉनिक्स और संचार"}', 4),
    ('dept-eee',  'department', 'Electrical & Electronics',  '{"kn":"ಎಲೆಕ್ಟ್ರಿಕಲ್ ಮತ್ತು ಎಲೆಕ್ಟ್ರಾನಿಕ್ಸ್","hi":"इलेक्ट्रिकल और इलेक्ट्रॉनिक्स"}', 5),
    ('dept-mech', 'department', 'Mechanical',                '{"kn":"ಮೆಕ್ಯಾನಿಕಲ್","hi":"मैकेनिकल"}', 6),
    ('dept-civil','department', 'Civil',                     '{"kn":"ಸಿವಿಲ್","hi":"सिविल"}', 7),
    ('dept-mba',  'department', 'MBA / MCA',                 '{"kn":"ಎಂಬಿಎ / ಎಂಸಿಎ","hi":"एमबीए / एमसीए"}', 8),
    ('dept-staff','department', 'Faculty & Staff',           '{"kn":"ಅಧ್ಯಾಪಕರು ಮತ್ತು ಸಿಬ್ಬಂದಿ","hi":"शिक्षक और कर्मचारी"}', 9),
    ('hostel-b1', 'hostel',     'Boys'' Hostel 1',           '{"kn":"ಬಾಲಕರ ವಸತಿ ನಿಲಯ 1","hi":"बॉयज़ हॉस्टल 1"}', 1),
    ('hostel-b2', 'hostel',     'Boys'' Hostel 2',           '{"kn":"ಬಾಲಕರ ವಸತಿ ನಿಲಯ 2","hi":"बॉयज़ हॉस्टल 2"}', 2),
    ('hostel-g1', 'hostel',     'Girls'' Hostel',            '{"kn":"ಬಾಲಕಿಯರ ವಸತಿ ನಿಲಯ","hi":"गर्ल्स हॉस्टल"}', 3),
    ('hostel-day','hostel',     'Day Scholars',              '{"kn":"ದಿನ ವಿದ್ಯಾರ್ಥಿಗಳು","hi":"डे स्कॉलर्स"}', 4)
on conflict (id) do nothing;

alter table public.user_profiles add column if not exists department text references public.campus_groups (id) on delete set null;
alter table public.user_profiles add column if not exists hostel     text references public.campus_groups (id) on delete set null;
alter table public.user_profiles add column if not exists is_blocked boolean not null default false;

-- 'vendor' = canteen / store counter staff: may look up and claim voucher codes only.
alter table public.user_profiles drop constraint if exists user_profiles_role_check;
alter table public.user_profiles add constraint user_profiles_role_check check (role in ('user', 'admin', 'vendor'));

-- -----------------------------------------------------------------------------
-- 3. Reward table (source of truth; editable from the operations console)
-- -----------------------------------------------------------------------------
create table if not exists public.reward_rules (
    waste_type   text primary key,
    reward_inr   integer not null check (reward_inr >= 0),
    points       integer not null check (points >= 0),
    stream       text not null check (stream in ('dry', 'wet', 'reject')),
    est_item_kg  numeric not null default 0.05 check (est_item_kg > 0),
    co2_per_kg   numeric not null default 0 check (co2_per_kg >= 0),
    active       boolean not null default true,
    sort         integer not null default 0,
    updated_at   timestamptz not null default now()
);

-- Streams follow BBMP segregation rules: dry (recyclables), wet (compostable), reject (sanitary / inert).
-- est_item_kg: typical weight of one item. co2_per_kg: conservative, rounded-down US EPA WARM factors.
insert into public.reward_rules (waste_type, reward_inr, points, stream, est_item_kg, co2_per_kg, sort) values
    ('Plastic',           25, 125, 'dry',    0.025, 1.0, 1),
    ('Metal',             30, 150, 'dry',    0.015, 4.0, 2),
    ('Paper / Cardboard', 10,  50, 'dry',    0.05,  3.0, 3),
    ('Glass',             15,  75, 'dry',    0.25,  0.3, 4),
    ('Organic',            5,  25, 'wet',    0.1,   0.5, 5),
    ('Other Trash',        8,  40, 'reject', 0.05,  0,   6)
on conflict (waste_type) do nothing;

create table if not exists public.reward_catalog (
    item         text primary key,
    type         text not null check (type in ('points', 'money')),
    cost         integer not null check (cost > 0),
    description  text not null default '',
    vendor       text,                                   -- where the code is claimed
    labels       jsonb not null default '{}'::jsonb,     -- {"kn": {"item": "...", "description": "...", "vendor": "..."}, "hi": {...}}
    active       boolean not null default true,
    sort         integer not null default 0,
    updated_at   timestamptz not null default now()
);

-- Campus credits, claimed at a counter on campus with the issued code.
insert into public.reward_catalog (item, type, cost, description, vendor, labels, sort) values
    ('Canteen Coupon ₹20', 'points', 200, '₹20 off any order at the campus canteen', 'Main canteen counter',
        '{"kn":{"item":"ಕ್ಯಾಂಟೀನ್ ಕೂಪನ್ ₹20","description":"ಕ್ಯಾಂಪಸ್ ಕ್ಯಾಂಟೀನ್‌ನಲ್ಲಿ ಯಾವುದೇ ಆರ್ಡರ್‌ಗೆ ₹20 ರಿಯಾಯಿತಿ","vendor":"ಮುಖ್ಯ ಕ್ಯಾಂಟೀನ್ ಕೌಂಟರ್"},"hi":{"item":"कैंटीन कूपन ₹20","description":"कैंपस कैंटीन में किसी भी ऑर्डर पर ₹20 की छूट","vendor":"मुख्य कैंटीन काउंटर"}}', 1),
    ('Canteen Coupon ₹50', 'points', 450, '₹50 off any order at the campus canteen', 'Main canteen counter',
        '{"kn":{"item":"ಕ್ಯಾಂಟೀನ್ ಕೂಪನ್ ₹50","description":"ಕ್ಯಾಂಪಸ್ ಕ್ಯಾಂಟೀನ್‌ನಲ್ಲಿ ಯಾವುದೇ ಆರ್ಡರ್‌ಗೆ ₹50 ರಿಯಾಯಿತಿ","vendor":"ಮುಖ್ಯ ಕ್ಯಾಂಟೀನ್ ಕೌಂಟರ್"},"hi":{"item":"कैंटीन कूपन ₹50","description":"कैंपस कैंटीन में किसी भी ऑर्डर पर ₹50 की छूट","vendor":"मुख्य कैंटीन काउंटर"}}', 2),
    ('Stationery Credit ₹30', 'points', 300, '₹30 credit at the campus stationery store', 'Campus stationery store',
        '{"kn":{"item":"ಸ್ಟೇಷನರಿ ಕ್ರೆಡಿಟ್ ₹30","description":"ಕ್ಯಾಂಪಸ್ ಸ್ಟೇಷನರಿ ಅಂಗಡಿಯಲ್ಲಿ ₹30 ಕ್ರೆಡಿಟ್","vendor":"ಕ್ಯಾಂಪಸ್ ಸ್ಟೇಷನರಿ ಅಂಗಡಿ"},"hi":{"item":"स्टेशनरी क्रेडिट ₹30","description":"कैंपस स्टेशनरी स्टोर पर ₹30 का क्रेडिट","vendor":"कैंपस स्टेशनरी स्टोर"}}', 3),
    ('Print Credits (25 pages)', 'points', 250, '25 free black-and-white pages at the print centre', 'Xerox / print centre',
        '{"kn":{"item":"ಪ್ರಿಂಟ್ ಕ್ರೆಡಿಟ್ (25 ಪುಟಗಳು)","description":"ಪ್ರಿಂಟ್ ಕೇಂದ್ರದಲ್ಲಿ 25 ಉಚಿತ ಕಪ್ಪು-ಬಿಳುಪು ಪುಟಗಳು","vendor":"ಜೆರಾಕ್ಸ್ / ಪ್ರಿಂಟ್ ಕೇಂದ್ರ"},"hi":{"item":"प्रिंट क्रेडिट (25 पेज)","description":"प्रिंट सेंटर पर 25 मुफ़्त ब्लैक-एंड-व्हाइट पेज","vendor":"ज़ेरॉक्स / प्रिंट सेंटर"}}', 4),
    ('Bank Transfer', 'money', 100, 'Withdraw ₹100 to your UPI ID', null,
        '{"kn":{"item":"ಬ್ಯಾಂಕ್ ವರ್ಗಾವಣೆ","description":"₹100 ಅನ್ನು ನಿಮ್ಮ UPI ಐಡಿಗೆ ಹಿಂಪಡೆಯಿರಿ"},"hi":{"item":"बैंक ट्रांसफ़र","description":"₹100 अपनी UPI आईडी पर निकालें"}}', 9)
on conflict (item) do nothing;

-- -----------------------------------------------------------------------------
-- 4. Waste logs and redemptions in their own tables
-- -----------------------------------------------------------------------------
create table if not exists public.waste_logs (
    id                  uuid primary key default gen_random_uuid(),
    user_id             uuid not null references public.user_profiles (id) on delete cascade,
    bin_id              text,
    bin_name            text,
    waste_type          text not null,
    stream              text,
    accepted            boolean not null default true,     -- false = wrong stream for this bin (no reward)
    reject_reason       text,
    reward_inr          integer not null default 0 check (reward_inr >= 0),
    points              integer not null default 0 check (points >= 0),
    est_weight_kg       numeric not null default 0,
    measured_weight_kg  numeric,                           -- from the bin's load cell, when it has one
    session_id          text unique,                       -- one reward per verified bin scan
    image_hash          text,                              -- 64-bit perceptual hash (hex) of the capture
    gps_distance_m      numeric,                           -- user's distance from the bin at scan time
    created_at          timestamptz not null default now()
);
create index if not exists waste_logs_user_idx on public.waste_logs (user_id, created_at desc);
create index if not exists waste_logs_bin_idx on public.waste_logs (bin_id, created_at desc);
create index if not exists waste_logs_created_idx on public.waste_logs (created_at desc);

create table if not exists public.redemptions (
    id            uuid primary key default gen_random_uuid(),
    code          text not null unique,
    user_id       uuid not null references public.user_profiles (id) on delete cascade,
    item          text not null,
    type          text not null check (type in ('points', 'money')),
    cost          integer not null check (cost > 0),
    status        text not null,
    upi_id        text,
    vendor        text,
    created_at    timestamptz not null default now(),
    processed_at  timestamptz,
    processed_by  text
);
create index if not exists redemptions_user_idx on public.redemptions (user_id, created_at desc);
create index if not exists redemptions_open_idx on public.redemptions (status) where status in ('Pending', 'Issued');

-- Move existing JSON data into the new tables (only when the old columns still exist).
do $$
begin
    if exists (select 1 from information_schema.columns
               where table_schema = 'public' and table_name = 'user_profiles' and column_name = 'logs') then
        insert into public.waste_logs (user_id, bin_name, waste_type, stream, reward_inr, points, est_weight_kg, session_id, created_at)
        select p.id,
               l ->> 'location',
               coalesce(l ->> 'wasteType', 'Other Trash'),
               r.stream,
               greatest(0, round(coalesce((l ->> 'amount')::numeric, 0)))::integer,
               coalesce(r.points, 0),
               coalesce(r.est_item_kg, 0.05),
               nullif(l ->> 'session', ''),
               coalesce((l ->> 'date')::timestamptz, p."createdAt")
        from public.user_profiles p
        cross join lateral jsonb_array_elements(coalesce(p.logs, '[]'::jsonb)) as l
        left join public.reward_rules r on r.waste_type = l ->> 'wasteType'
        on conflict (session_id) do nothing;
        alter table public.user_profiles drop column logs;
    end if;

    if exists (select 1 from information_schema.columns
               where table_schema = 'public' and table_name = 'user_profiles' and column_name = 'redemptions') then
        insert into public.redemptions (code, user_id, item, type, cost, status, upi_id, created_at, processed_at, processed_by)
        select coalesce(nullif(x ->> 'code', ''), 'LEGACY-' || upper(substr(md5(random()::text), 1, 8))),
               p.id,
               coalesce(x ->> 'item', 'Unknown'),
               case when x ->> 'type' = 'money' then 'money' else 'points' end,
               greatest(1, round(coalesce((x ->> 'cost')::numeric, 1)))::integer,
               coalesce(x ->> 'status', 'Completed'),
               x ->> 'upiId',
               coalesce((x ->> 'date')::timestamptz, p."createdAt"),
               (x ->> 'processedAt')::timestamptz,
               x ->> 'processedBy'
        from public.user_profiles p
        cross join lateral jsonb_array_elements(coalesce(p.redemptions, '[]'::jsonb)) as x
        on conflict (code) do nothing;
        alter table public.user_profiles drop column redemptions;
    end if;
end $$;

-- -----------------------------------------------------------------------------
-- 5. Operations: collections, fraud flags, challenge bonuses
-- -----------------------------------------------------------------------------
create table if not exists public.bin_collections (
    id                  uuid primary key default gen_random_uuid(),
    bin_id              text not null,
    collected_at        timestamptz not null default now(),
    collected_by        text,
    fill_level_before   numeric,
    items_since_last    integer,
    measured_weight_kg  numeric check (measured_weight_kg is null or measured_weight_kg >= 0),
    contamination_pct   numeric check (contamination_pct is null or (contamination_pct >= 0 and contamination_pct <= 100)),
    notes               text
);
create index if not exists bin_collections_bin_idx on public.bin_collections (bin_id, collected_at desc);

create table if not exists public.fraud_flags (
    id           uuid primary key default gen_random_uuid(),
    user_id      uuid references public.user_profiles (id) on delete cascade,
    bin_id       text,
    kind         text not null,
    severity     text not null default 'medium' check (severity in ('low', 'medium', 'high')),
    details      jsonb not null default '{}'::jsonb,
    created_at   timestamptz not null default now(),
    resolved_at  timestamptz,
    resolved_by  text,
    resolution   text
);
create index if not exists fraud_flags_created_idx on public.fraud_flags (created_at desc);
create index if not exists fraud_flags_user_idx on public.fraud_flags (user_id, kind, created_at desc);

create table if not exists public.challenge_claims (
    user_id       uuid not null references public.user_profiles (id) on delete cascade,
    challenge_id  text not null,
    points        integer not null check (points >= 0),
    claimed_at    timestamptz not null default now(),
    primary key (user_id, challenge_id)
);

-- Per-user, per-material totals (accepted items only). Measured weight is used when known.
create or replace view public.naav_user_material_stats
with (security_invoker = true) as
select user_id,
       waste_type,
       count(*)::integer                                       as items,
       sum(coalesce(measured_weight_kg, est_weight_kg))        as weight_kg,
       count(measured_weight_kg)::integer                      as measured_items,
       sum(reward_inr)::integer                                as reward_inr,
       sum(points)::integer                                    as points
from public.waste_logs
where accepted
group by user_id, waste_type;

-- -----------------------------------------------------------------------------
-- 6. Transactional balance changes (called by the API with the secret key)
-- -----------------------------------------------------------------------------

-- Deposit: insert the log and credit the reward in one transaction. The balance update is a
-- compare-and-swap on the balances the API read, so concurrent requests cannot both pass the
-- cooldown / daily-limit checks. A reused scan session hits the unique index.
create or replace function public.naav_apply_deposit(
    p_user uuid, p_expected_wallet integer, p_expected_points integer, p_log jsonb
) returns text
language plpgsql security definer set search_path = '' as $$
declare
    v_reward integer := coalesce((p_log ->> 'reward_inr')::integer, 0);
    v_points integer := coalesce((p_log ->> 'points')::integer, 0);
begin
    begin
        insert into public.waste_logs (user_id, bin_id, bin_name, waste_type, stream, accepted, reject_reason,
                                       reward_inr, points, est_weight_kg, session_id, image_hash, gps_distance_m)
        values (p_user, p_log ->> 'bin_id', p_log ->> 'bin_name', p_log ->> 'waste_type', p_log ->> 'stream',
                coalesce((p_log ->> 'accepted')::boolean, true), p_log ->> 'reject_reason',
                v_reward, v_points, coalesce((p_log ->> 'est_weight_kg')::numeric, 0),
                p_log ->> 'session_id', p_log ->> 'image_hash', (p_log ->> 'gps_distance_m')::numeric);

        update public.user_profiles
           set "walletBalance" = "walletBalance" + v_reward,
               "ecoPoints"     = "ecoPoints" + v_points
         where id = p_user
           and "walletBalance" = p_expected_wallet
           and "ecoPoints" = p_expected_points;
        if not found then
            raise exception 'naav_conflict';
        end if;
    exception
        when unique_violation then return 'duplicate_session';
        when raise_exception then
            if sqlerrm = 'naav_conflict' then return 'conflict'; end if;
            raise;
    end;
    return 'ok';
end;
$$;

-- Redemption: deduct the cost (never below zero) and record the redemption atomically.
create or replace function public.naav_apply_redemption(
    p_user uuid, p_expected_wallet integer, p_expected_points integer, p_redemption jsonb
) returns text
language plpgsql security definer set search_path = '' as $$
declare
    v_type text := p_redemption ->> 'type';
    v_cost integer := (p_redemption ->> 'cost')::integer;
begin
    if v_cost is null or v_cost <= 0 or v_type not in ('points', 'money') then
        return 'invalid';
    end if;
    begin
        insert into public.redemptions (code, user_id, item, type, cost, status, upi_id, vendor)
        values (p_redemption ->> 'code', p_user, p_redemption ->> 'item', v_type, v_cost,
                p_redemption ->> 'status', p_redemption ->> 'upi_id', p_redemption ->> 'vendor');

        if v_type = 'money' then
            update public.user_profiles set "walletBalance" = "walletBalance" - v_cost
             where id = p_user and "walletBalance" = p_expected_wallet and "ecoPoints" = p_expected_points
               and "walletBalance" >= v_cost;
        else
            update public.user_profiles set "ecoPoints" = "ecoPoints" - v_cost
             where id = p_user and "walletBalance" = p_expected_wallet and "ecoPoints" = p_expected_points
               and "ecoPoints" >= v_cost;
        end if;
        if not found then
            raise exception 'naav_conflict';
        end if;
    exception
        when unique_violation then return 'duplicate_code';
        when raise_exception then
            if sqlerrm = 'naav_conflict' then return 'conflict'; end if;
            raise;
    end;
    return 'ok';
end;
$$;

-- Admin / counter decision on a redemption. The status guard makes each decision happen once,
-- so a refund can never be applied twice.
create or replace function public.naav_set_redemption_status(
    p_code text, p_from text, p_to text, p_refund boolean, p_actor text
) returns text
language plpgsql security definer set search_path = '' as $$
declare
    r public.redemptions%rowtype;
begin
    update public.redemptions
       set status = p_to, processed_at = now(), processed_by = p_actor
     where code = p_code and status = p_from
    returning * into r;
    if not found then
        return 'conflict';
    end if;
    if p_refund then
        if r.type = 'money' then
            update public.user_profiles set "walletBalance" = "walletBalance" + r.cost where id = r.user_id;
        else
            update public.user_profiles set "ecoPoints" = "ecoPoints" + r.cost where id = r.user_id;
        end if;
    end if;
    return 'ok';
end;
$$;

-- Weekly-challenge bonus: once per user per challenge.
create or replace function public.naav_claim_challenge(
    p_user uuid, p_challenge text, p_points integer
) returns text
language plpgsql security definer set search_path = '' as $$
begin
    if p_points is null or p_points < 0 then
        return 'invalid';
    end if;
    begin
        insert into public.challenge_claims (user_id, challenge_id, points) values (p_user, p_challenge, p_points);
        update public.user_profiles set "ecoPoints" = "ecoPoints" + p_points where id = p_user;
        if not found then
            raise exception 'naav_missing';
        end if;
    exception
        when unique_violation then return 'already_claimed';
        when raise_exception then
            if sqlerrm = 'naav_missing' then return 'not_found'; end if;
            raise;
    end;
    return 'ok';
end;
$$;

-- -----------------------------------------------------------------------------
-- 7. Lock everything down: only the API (secret key, bypasses RLS) has access.
-- -----------------------------------------------------------------------------
alter table public.campus_groups    enable row level security;
alter table public.reward_rules     enable row level security;
alter table public.reward_catalog   enable row level security;
alter table public.waste_logs       enable row level security;
alter table public.redemptions      enable row level security;
alter table public.bin_collections  enable row level security;
alter table public.fraud_flags      enable row level security;
alter table public.challenge_claims enable row level security;
alter table public.bins             enable row level security;

revoke all on public.campus_groups, public.reward_rules, public.reward_catalog, public.waste_logs,
              public.redemptions, public.bin_collections, public.fraud_flags, public.challenge_claims
    from anon, authenticated;
revoke all on public.naav_user_material_stats from anon, authenticated;
revoke insert, update, delete, truncate on public.bins from anon, authenticated;

revoke execute on function public.naav_apply_deposit(uuid, integer, integer, jsonb)         from public, anon, authenticated;
revoke execute on function public.naav_apply_redemption(uuid, integer, integer, jsonb)      from public, anon, authenticated;
revoke execute on function public.naav_set_redemption_status(text, text, text, boolean, text) from public, anon, authenticated;
revoke execute on function public.naav_claim_challenge(uuid, text, integer)                 from public, anon, authenticated;
grant execute on function public.naav_apply_deposit(uuid, integer, integer, jsonb)          to service_role;
grant execute on function public.naav_apply_redemption(uuid, integer, integer, jsonb)       to service_role;
grant execute on function public.naav_set_redemption_status(text, text, text, boolean, text) to service_role;
grant execute on function public.naav_claim_challenge(uuid, text, integer)                  to service_role;

commit;
