-- =============================================================================
-- Naav Bins · 004 · Campus wallet (Phase 2) and delayed cashback (Phase 3)
--
-- Run AFTER 003_vendors.sql. Safe to run more than once.
--
-- Phase 2 · Campus wallet (works like coins in a UPI app)
--   * Students earn Eco-Points only (reward_program.points_only) — the "coins".
--   * Redeem: Eco-Points convert into ₹ in the campus wallet ("walletBalance") at
--     points_per_rupee (default 10) points = ₹1, whole rupees only (naav_convert_points).
--   * Pay any amount from the ₹ wallet: the student enters ₹2, ₹70, …; the app shows a one-time
--     code / QR valid for 3 minutes; the counter confirms it and exactly that ₹ is deducted.
--   * Every change to points is written to points_ledger and every change to the ₹ wallet to
--     wallet_ledger, both by triggers.
--   * The ₹ wallet is spent only at campus counters: no withdrawals.
--   * Fixed-value vouchers and UPI withdrawals are removed (section 8): the reward_catalog and
--     redemptions tables and their functions are dropped.
--
-- Phase 3 · Delayed cashback
--   * Part of each item's points is paid at once (instant_pct); the rest builds a visible pending
--     bonus that is released at milestones (e.g. items 5, 10 and 20 of a cycle), with a random
--     multiplier (multiplier_min … multiplier_max) capped by a daily bonus budget.
--   * A pending bonus expires after pending_expiry_days without a deposit.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Counter limits for payments
-- -----------------------------------------------------------------------------
alter table public.vendors add column if not exists max_txn_inr    integer not null default 500
    check (max_txn_inr between 1 and 100000);
alter table public.vendors add column if not exists daily_limit_inr integer not null default 20000
    check (daily_limit_inr between 1 and 10000000);

-- -----------------------------------------------------------------------------
-- 2. Reward programme (one row; edited from the console)
-- -----------------------------------------------------------------------------
create table if not exists public.reward_program (
    id                   smallint primary key default 1 check (id = 1),
    active               boolean  not null default true,      -- cashback on/off (off = full points at once)
    points_only          boolean  not null default true,      -- deposits earn points, not ₹
    points_per_rupee     integer  not null default 10  check (points_per_rupee between 1 and 1000),
    instant_pct          integer  not null default 60  check (instant_pct between 0 and 100),
    milestones           integer[] not null default '{5,10,20}',
    multiplier_min       numeric  not null default 1.0 check (multiplier_min >= 1),
    multiplier_max       numeric  not null default 1.3 check (multiplier_max <= 3),
    daily_bonus_budget   integer  not null default 5000 check (daily_bonus_budget >= 0),
    pending_expiry_days  integer  not null default 30 check (pending_expiry_days between 1 and 365),
    updated_at           timestamptz not null default now(),
    constraint reward_program_multiplier_check check (multiplier_max >= multiplier_min)
);
insert into public.reward_program (id) values (1) on conflict (id) do nothing;
-- The campus wallet is points-only by design (₹ comes only from redeeming points), so lock it on.
update public.reward_program set points_only = true where not points_only;
alter table public.reward_program add column if not exists updated_by text;

-- Every change to the programme is kept (old and new row, who, when), so a change to the
-- points-per-₹ rate (which changes what every student's unredeemed points are worth) is traceable.
create table if not exists public.reward_program_history (
    id          bigint generated always as identity primary key,
    changed_at  timestamptz not null default now(),
    changed_by  text,
    old_row     jsonb not null,
    new_row     jsonb not null,
    rate_before integer not null,
    rate_after  integer not null
);
create index if not exists reward_program_history_time_idx on public.reward_program_history (changed_at desc);

create or replace function public.naav_program_history_trigger() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
    if to_jsonb(new) - 'updated_at' - 'updated_by' is distinct from to_jsonb(old) - 'updated_at' - 'updated_by' then
        insert into public.reward_program_history (changed_by, old_row, new_row, rate_before, rate_after)
        values (new.updated_by, to_jsonb(old), to_jsonb(new), old.points_per_rupee, new.points_per_rupee);
    end if;
    return new;
end;
$$;
drop trigger if exists naav_program_history on public.reward_program;
create trigger naav_program_history after update on public.reward_program
    for each row execute function public.naav_program_history_trigger();

-- -----------------------------------------------------------------------------
-- 3. Per-student cashback state
-- -----------------------------------------------------------------------------
alter table public.user_profiles add column if not exists pending_points integer not null default 0;
alter table public.user_profiles add column if not exists cycle_items    integer not null default 0;
alter table public.user_profiles add column if not exists last_earn_at   timestamptz;
alter table public.user_profiles drop constraint if exists user_profiles_cashback_check;
alter table public.user_profiles add constraint user_profiles_cashback_check
    check (pending_points >= 0 and cycle_items >= 0);

-- Nominal points stay in waste_logs.points (leagues and challenges use them); these show the split.
alter table public.waste_logs add column if not exists points_instant integer;
alter table public.waste_logs add column if not exists bonus_released integer not null default 0;

create table if not exists public.bonus_releases (
    id          bigint generated always as identity primary key,
    user_id     uuid not null references public.user_profiles (id) on delete cascade,
    kind        text not null check (kind in ('release', 'expired')),
    points      integer not null,          -- pending points released (or expired)
    multiplier  numeric not null default 1,
    extra       integer not null default 0, -- bonus on top, from the multiplier (counts against the budget)
    cycle_item  integer,
    created_at  timestamptz not null default now()
);
create index if not exists bonus_releases_created_idx on public.bonus_releases (created_at desc);
create index if not exists bonus_releases_user_idx on public.bonus_releases (user_id, created_at desc);

-- -----------------------------------------------------------------------------
-- 4. Points ledger: every change to "ecoPoints", written by a trigger
--    Functions name the reason with set_config('naav.kind' / 'naav.ref', …, true) first.
-- -----------------------------------------------------------------------------
create table if not exists public.points_ledger (
    id             bigint generated always as identity primary key,
    user_id        uuid not null references public.user_profiles (id) on delete cascade,
    delta          integer not null,
    balance_after  integer not null,
    kind           text not null,
    ref            text,
    created_at     timestamptz not null default now()
);
create index if not exists points_ledger_user_idx on public.points_ledger (user_id, created_at desc);

create or replace function public.naav_points_ledger_trigger() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
    if new."ecoPoints" is distinct from old."ecoPoints" then
        insert into public.points_ledger (user_id, delta, balance_after, kind, ref)
        values (new.id, new."ecoPoints" - old."ecoPoints", new."ecoPoints",
                coalesce(nullif(current_setting('naav.kind', true), ''), 'adjustment'),
                nullif(current_setting('naav.ref', true), ''));
    end if;
    return new;
end;
$$;
drop trigger if exists naav_points_ledger on public.user_profiles;
create trigger naav_points_ledger after update of "ecoPoints" on public.user_profiles
    for each row execute function public.naav_points_ledger_trigger();

-- Same for the ₹ campus wallet ("walletBalance").
create table if not exists public.wallet_ledger (
    id             bigint generated always as identity primary key,
    user_id        uuid not null references public.user_profiles (id) on delete cascade,
    delta          integer not null,
    balance_after  integer not null,
    kind           text not null,
    ref            text,
    created_at     timestamptz not null default now()
);
create index if not exists wallet_ledger_user_idx on public.wallet_ledger (user_id, created_at desc);

create or replace function public.naav_wallet_ledger_trigger() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
    if new."walletBalance" is distinct from old."walletBalance" then
        insert into public.wallet_ledger (user_id, delta, balance_after, kind, ref)
        values (new.id, new."walletBalance" - old."walletBalance", new."walletBalance",
                coalesce(nullif(current_setting('naav.kind', true), ''), 'adjustment'),
                nullif(current_setting('naav.ref', true), ''));
    end if;
    return new;
end;
$$;
drop trigger if exists naav_wallet_ledger on public.user_profiles;
create trigger naav_wallet_ledger after update of "walletBalance" on public.user_profiles
    for each row execute function public.naav_wallet_ledger_trigger();

-- Redeem Eco-Points into ₹ in the campus wallet (both sides in one statement, so it is atomic).
create or replace function public.naav_convert_points(p_user uuid, p_points integer, p_inr integer) returns text
language plpgsql security definer set search_path = '' as $$
begin
    if p_points is null or p_inr is null or p_points <= 0 or p_inr <= 0 then
        return 'invalid';
    end if;
    perform set_config('naav.kind', 'convert', true);
    perform set_config('naav.ref', '', true);
    update public.user_profiles
       set "ecoPoints" = "ecoPoints" - p_points,
           "walletBalance" = "walletBalance" + p_inr
     where id = p_user and "ecoPoints" >= p_points;
    if not found then return 'insufficient'; end if;
    return 'ok';
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. Deposit with cashback (replaces naav_apply_deposit for the new API)
--    p_expected: balances and cashback state that were read (compare-and-swap)
--    p_award:    { credit, pending_after, cycle_after, released, multiplier, extra, expired, cycle_item }
-- -----------------------------------------------------------------------------
create or replace function public.naav_apply_deposit_v2(
    p_user uuid, p_expected jsonb, p_log jsonb, p_award jsonb
) returns text
language plpgsql security definer set search_path = '' as $$
declare
    v_reward   integer := coalesce((p_log ->> 'reward_inr')::integer, 0);
    v_credit   integer := coalesce((p_award ->> 'credit')::integer, 0);
    v_released integer := coalesce((p_award ->> 'released')::integer, 0);
    v_expired  integer := coalesce((p_award ->> 'expired')::integer, 0);
    v_id       uuid;
begin
    if v_credit < 0 or v_reward < 0 then
        return 'invalid';
    end if;
    begin
        insert into public.waste_logs (user_id, bin_id, bin_name, waste_type, stream, accepted, reject_reason,
                                       reward_inr, points, est_weight_kg, session_id, image_hash, gps_distance_m,
                                       points_instant, bonus_released)
        values (p_user, p_log ->> 'bin_id', p_log ->> 'bin_name', p_log ->> 'waste_type', p_log ->> 'stream',
                coalesce((p_log ->> 'accepted')::boolean, true), p_log ->> 'reject_reason',
                v_reward, coalesce((p_log ->> 'points')::integer, 0), coalesce((p_log ->> 'est_weight_kg')::numeric, 0),
                p_log ->> 'session_id', p_log ->> 'image_hash', (p_log ->> 'gps_distance_m')::numeric,
                (p_award ->> 'instant')::integer, v_released)
        returning id into v_id;

        perform set_config('naav.kind', case when v_released > 0 then 'deposit_bonus' else 'deposit' end, true);
        perform set_config('naav.ref', v_id::text, true);

        update public.user_profiles
           set "walletBalance" = "walletBalance" + v_reward,
               "ecoPoints"     = "ecoPoints" + v_credit,
               pending_points  = (p_award ->> 'pending_after')::integer,
               cycle_items     = (p_award ->> 'cycle_after')::integer,
               last_earn_at    = now()
         where id = p_user
           and "walletBalance" = (p_expected ->> 'walletBalance')::integer
           and "ecoPoints"     = (p_expected ->> 'ecoPoints')::integer
           and pending_points  = (p_expected ->> 'pendingPoints')::integer
           and cycle_items     = (p_expected ->> 'cycleItems')::integer;
        if not found then
            raise exception 'naav_conflict';
        end if;

        if v_expired > 0 then
            insert into public.bonus_releases (user_id, kind, points) values (p_user, 'expired', v_expired);
        end if;
        if v_released > 0 then
            insert into public.bonus_releases (user_id, kind, points, multiplier, extra, cycle_item)
            values (p_user, 'release', v_released, coalesce((p_award ->> 'multiplier')::numeric, 1),
                    coalesce((p_award ->> 'extra')::integer, 0), (p_award ->> 'cycle_item')::integer);
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

-- -----------------------------------------------------------------------------
-- 6. Weekly challenge bonus, naming its ledger reason
-- -----------------------------------------------------------------------------
create or replace function public.naav_claim_challenge(
    p_user uuid, p_challenge text, p_points integer
) returns text
language plpgsql security definer set search_path = '' as $$
begin
    if p_points is null or p_points < 0 then
        return 'invalid';
    end if;
    perform set_config('naav.kind', 'challenge', true);
    perform set_config('naav.ref', p_challenge, true);
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
-- 7. Pay at a counter
-- -----------------------------------------------------------------------------
create table if not exists public.vendor_payments (
    id            uuid primary key default gen_random_uuid(),
    code          text not null unique,
    user_id       uuid not null references public.user_profiles (id) on delete cascade,
    vendor_id     text not null references public.vendors (id) on delete restrict,
    amount_inr    integer not null check (amount_inr > 0),
    points        integer not null default 0 check (points >= 0), -- legacy, always 0: payments debit the ₹ wallet (kept so re-runs never drop data)
    status        text not null default 'Pending'
                  check (status in ('Pending', 'Completed', 'Expired', 'Cancelled', 'Refunded')),
    expires_at    timestamptz not null,
    created_at    timestamptz not null default now(),
    completed_at  timestamptz,
    staff_id      uuid references public.user_profiles (id) on delete set null,
    staff_email   text,
    refunded_at   timestamptz,
    refunded_by   text,
    refund_reason text
);
alter table public.vendor_payments add column if not exists refund_reason text;
-- Payments now debit the ₹ wallet, so points may be 0 (older installs had check points > 0).
-- Older installs created the column without a default ("create table if not exists" never changes it).
alter table public.vendor_payments alter column points set default 0;
alter table public.vendor_payments drop constraint if exists vendor_payments_points_check;
alter table public.vendor_payments add constraint vendor_payments_points_check check (points >= 0);
create index if not exists vendor_payments_user_idx   on public.vendor_payments (user_id, created_at desc);
create index if not exists vendor_payments_vendor_idx on public.vendor_payments (vendor_id, completed_at desc);
create index if not exists vendor_payments_open_idx   on public.vendor_payments (status) where status = 'Pending';

-- Start a payment: cancel the student's open code and create the new one in one transaction, so
-- only one code is ever live. The per-student advisory lock serialises two quick requests.
-- Returns 'ok' or 'duplicate' (code collision: the API retries with a new code).
create or replace function public.naav_create_payment(
    p_user uuid, p_code text, p_vendor text, p_amount integer, p_expires timestamptz
) returns text
language plpgsql security definer set search_path = '' as $$
begin
    if p_amount is null or p_amount <= 0 then return 'invalid'; end if;
    perform pg_advisory_xact_lock(hashtext('naav_pay:' || p_user::text));
    update public.vendor_payments set status = 'Cancelled' where user_id = p_user and status = 'Pending';
    begin
        insert into public.vendor_payments (code, user_id, vendor_id, amount_inr, points, expires_at)
        values (p_code, p_user, p_vendor, p_amount, 0, p_expires);
    exception when unique_violation then
        return 'duplicate';
    end;
    return 'ok';
end;
$$;

-- Confirm a payment at a counter: checks the counter, expiry, the counter's daily ₹ limit and the
-- student's ₹ wallet, then deducts exactly that amount. Runs once (row lock + status).
-- p_vendor null = admin (any counter).
create or replace function public.naav_confirm_payment(
    p_code text, p_vendor text, p_staff uuid, p_staff_email text
) returns text
language plpgsql security definer set search_path = '' as $$
declare
    r        public.vendor_payments%rowtype;
    v_limit  integer;
    v_today  integer;
    v_start  timestamptz := (date_trunc('day', now() at time zone 'Asia/Kolkata')) at time zone 'Asia/Kolkata';
begin
    select * into r from public.vendor_payments where code = p_code for update;
    if not found then return 'not_found'; end if;
    if p_vendor is not null and r.vendor_id <> p_vendor then return 'wrong_vendor'; end if;
    if r.status <> 'Pending' then return 'not_pending'; end if;
    if r.expires_at < now() then
        update public.vendor_payments set status = 'Expired' where id = r.id;
        return 'expired';
    end if;

    select daily_limit_inr into v_limit from public.vendors where id = r.vendor_id;
    select coalesce(sum(amount_inr), 0) into v_today from public.vendor_payments
     where vendor_id = r.vendor_id and status = 'Completed' and completed_at >= v_start;
    if v_today + r.amount_inr > coalesce(v_limit, 0) then return 'daily_limit'; end if;

    perform set_config('naav.kind', 'payment', true);
    perform set_config('naav.ref', r.code, true);
    update public.user_profiles set "walletBalance" = "walletBalance" - r.amount_inr
     where id = r.user_id and "walletBalance" >= r.amount_inr;
    if not found then return 'insufficient'; end if;

    update public.vendor_payments
       set status = 'Completed', completed_at = now(), staff_id = p_staff, staff_email = p_staff_email
     where id = r.id;
    return 'ok';
end;
$$;

-- Admin refund of a completed payment (₹ goes back to the wallet). Once only, within
-- p_window_days of completion, and a reason (3–200 characters) is required and stored.
-- Returns 'ok', 'no_reason', 'not_found', 'not_completed' or 'too_old'.
drop function if exists public.naav_refund_payment(text, text);
create or replace function public.naav_refund_payment(
    p_code text, p_actor text, p_reason text, p_window_days integer default 7
) returns text
language plpgsql security definer set search_path = '' as $$
declare
    r        public.vendor_payments%rowtype;
    v_reason text := btrim(coalesce(p_reason, ''));
begin
    if char_length(v_reason) < 3 or char_length(v_reason) > 200 then return 'no_reason'; end if;
    select * into r from public.vendor_payments where code = p_code for update;
    if not found then return 'not_found'; end if;
    if r.status <> 'Completed' then return 'not_completed'; end if;
    if r.completed_at < now() - make_interval(days => greatest(coalesce(p_window_days, 7), 0)) then
        return 'too_old';
    end if;
    update public.vendor_payments
       set status = 'Refunded', refunded_at = now(), refunded_by = p_actor, refund_reason = v_reason
     where id = r.id;
    perform set_config('naav.kind', 'payment_refund', true);
    perform set_config('naav.ref', r.code, true);
    update public.user_profiles set "walletBalance" = "walletBalance" + r.amount_inr where id = r.user_id;
    return 'ok';
end;
$$;

-- -----------------------------------------------------------------------------
-- 8. Remove fixed-value vouchers and UPI withdrawals. Exact-amount payments from the ₹ wallet
--    replace vouchers, and the wallet is spent only on campus. Also drops the pre-wallet deposit
--    function (the API uses naav_apply_deposit_v2) and the voucher claim limit on counters.
-- -----------------------------------------------------------------------------
drop function if exists public.naav_apply_redemption(uuid, integer, integer, jsonb);
drop function if exists public.naav_set_redemption_status(text, text, text, boolean, text);
drop function if exists public.naav_apply_deposit(uuid, integer, integer, jsonb);
drop table if exists public.redemptions;
drop table if exists public.reward_catalog;
alter table public.vendors drop column if exists daily_claim_limit;

-- -----------------------------------------------------------------------------
-- 9. Lock down: only the API (secret key) has access.
-- -----------------------------------------------------------------------------
alter table public.reward_program  enable row level security;
alter table public.points_ledger   enable row level security;
alter table public.bonus_releases  enable row level security;
alter table public.vendor_payments enable row level security;
alter table public.wallet_ledger   enable row level security;
alter table public.reward_program_history enable row level security;
revoke all on public.reward_program, public.points_ledger, public.bonus_releases, public.vendor_payments,
              public.wallet_ledger, public.reward_program_history
    from anon, authenticated;

revoke execute on function public.naav_points_ledger_trigger()                              from public, anon, authenticated;
revoke execute on function public.naav_wallet_ledger_trigger()                              from public, anon, authenticated;
revoke execute on function public.naav_convert_points(uuid, integer, integer)               from public, anon, authenticated;
grant execute on function public.naav_convert_points(uuid, integer, integer)                to service_role;
revoke execute on function public.naav_apply_deposit_v2(uuid, jsonb, jsonb, jsonb)          from public, anon, authenticated;
revoke execute on function public.naav_claim_challenge(uuid, text, integer)                 from public, anon, authenticated;
revoke execute on function public.naav_confirm_payment(text, text, uuid, text)              from public, anon, authenticated;
revoke execute on function public.naav_refund_payment(text, text, text, integer)          from public, anon, authenticated;
revoke execute on function public.naav_program_history_trigger()                            from public, anon, authenticated;
revoke execute on function public.naav_create_payment(uuid, text, text, integer, timestamptz) from public, anon, authenticated;
grant execute on function public.naav_create_payment(uuid, text, text, integer, timestamptz)  to service_role;
grant execute on function public.naav_apply_deposit_v2(uuid, jsonb, jsonb, jsonb)           to service_role;
grant execute on function public.naav_claim_challenge(uuid, text, integer)                  to service_role;
grant execute on function public.naav_confirm_payment(text, text, uuid, text)               to service_role;
grant execute on function public.naav_refund_payment(text, text, text, integer)           to service_role;

commit;
