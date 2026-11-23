-- =============================================================================
-- Naav Bins · 003 · Vendor accounts (Phase 1)
--
-- Run AFTER 002_operations.sql. Safe to run more than once.
--
-- What it does:
--   1. vendors table: each campus counter (canteen, snack stall, stationery, print centre) is a
--      real record with its own name, category, location, translations, daily claim limit and an
--      on/off switch.
--   2. user_profiles.vendor_id: every counter-staff account (role 'vendor') belongs to exactly one
--      vendor. Existing 'vendor' accounts without a vendor are moved back to 'user' — give them
--      counter access again from the console (Users → Give counter access).
--   3. reward_catalog.vendor_id / redemptions.vendor_id: each campus credit can be claimed only at
--      the counter it was issued for. Existing rows are back-filled.
--   4. naav_apply_redemption now records the vendor on the redemption.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Vendors
-- -----------------------------------------------------------------------------
create table if not exists public.vendors (
    id                 text primary key check (id ~ '^[a-z0-9-]{2,40}$'),
    name               text not null check (length(name) between 2 and 80),
    category           text not null check (category in ('canteen', 'snacks', 'stationery', 'print', 'other')),
    location           text not null default '',
    labels             jsonb not null default '{}'::jsonb,   -- {"kn": "...", "hi": "..."} (translated name)
    active             boolean not null default true,        -- off = staff cannot look up or claim codes
    daily_claim_limit  integer not null default 300 check (daily_claim_limit between 1 and 10000),
    sort               integer not null default 0,
    created_at         timestamptz not null default now(),
    updated_at         timestamptz not null default now()
);

insert into public.vendors (id, name, category, location, labels, sort) values
    ('utsav-cafe',         'Utsav Cafe Canteen',     'canteen',    'Main canteen block',
        '{"kn":"ಉತ್ಸವ್ ಕೆಫೆ ಕ್ಯಾಂಟೀನ್","hi":"उत्सव कैफ़े कैंटीन"}', 1),
    ('mtr-stall',          'MTR Snacks Stall',       'snacks',     'Near the main gate',
        '{"kn":"ಎಂಟಿಆರ್ ತಿಂಡಿ ಮಳಿಗೆ","hi":"एमटीआर स्नैक्स स्टॉल"}', 2),
    ('college-stationery', 'College Stationery',     'stationery', 'Academic block, ground floor',
        '{"kn":"ಕಾಲೇಜು ಸ್ಟೇಷನರಿ","hi":"कॉलेज स्टेशनरी"}', 3),
    ('college-xerox',      'College Xerox & Print',  'print',      'Library entrance',
        '{"kn":"ಕಾಲೇಜು ಜೆರಾಕ್ಸ್ ಮತ್ತು ಪ್ರಿಂಟ್","hi":"कॉलेज ज़ेरॉक्स और प्रिंट"}', 4)
on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- 2. Counter staff belong to exactly one vendor
-- -----------------------------------------------------------------------------
alter table public.user_profiles add column if not exists vendor_id text references public.vendors (id) on delete restrict;

-- Old-style vendor accounts have no counter yet: return them to 'user' (re-assign in the console).
update public.user_profiles set role = 'user' where role = 'vendor' and vendor_id is null;
-- Non-vendor accounts never carry a vendor.
update public.user_profiles set vendor_id = null where role <> 'vendor' and vendor_id is not null;

alter table public.user_profiles drop constraint if exists user_profiles_vendor_check;
alter table public.user_profiles add constraint user_profiles_vendor_check
    check ((role = 'vendor') = (vendor_id is not null));

-- -----------------------------------------------------------------------------
-- 3. Campus credits and vouchers are tied to a vendor
-- -----------------------------------------------------------------------------
alter table public.reward_catalog add column if not exists vendor_id text references public.vendors (id) on delete restrict;
alter table public.redemptions    add column if not exists vendor_id text references public.vendors (id) on delete restrict;

-- New: a snack coupon for the MTR stall.
insert into public.reward_catalog (item, type, cost, description, vendor, vendor_id, labels, sort) values
    ('MTR Snack Coupon ₹20', 'points', 200, '₹20 off snacks at the MTR stall', 'MTR Snacks Stall', 'mtr-stall',
        '{"kn":{"item":"ಎಂಟಿಆರ್ ತಿಂಡಿ ಕೂಪನ್ ₹20","description":"ಎಂಟಿಆರ್ ಮಳಿಗೆಯಲ್ಲಿ ತಿಂಡಿಗಳ ಮೇಲೆ ₹20 ರಿಯಾಯಿತಿ","vendor":"ಎಂಟಿಆರ್ ತಿಂಡಿ ಮಳಿಗೆ"},"hi":{"item":"एमटीआर स्नैक कूपन ₹20","description":"एमटीआर स्टॉल पर स्नैक्स पर ₹20 की छूट","vendor":"एमटीआर स्नैक्स स्टॉल"}}', 3)
on conflict (item) do nothing;

-- Map the original catalogue items to their counters (only where not set yet).
update public.reward_catalog c set vendor_id = m.vendor_id
  from (values
        ('Canteen Coupon ₹20',       'utsav-cafe'),
        ('Canteen Coupon ₹50',       'utsav-cafe'),
        ('Stationery Credit ₹30',    'college-stationery'),
        ('Print Credits (25 pages)', 'college-xerox')
       ) as m(item, vendor_id)
 where c.item = m.item and c.vendor_id is null;

-- Keep the display name (and its translations) in step with the vendor record.
update public.reward_catalog c
   set vendor = v.name,
       labels = case
           when jsonb_typeof(c.labels -> 'kn') = 'object' and jsonb_typeof(c.labels -> 'hi') = 'object' then
               jsonb_set(jsonb_set(c.labels, '{kn,vendor}', coalesce(v.labels -> 'kn', to_jsonb(v.name))),
                         '{hi,vendor}', coalesce(v.labels -> 'hi', to_jsonb(v.name)))
           else c.labels end,
       updated_at = now()
  from public.vendors v
 where c.vendor_id = v.id;

-- Campus credits (points items) must name their counter. NOT VALID: existing custom rows are left
-- alone, but every new or edited row is checked.
alter table public.reward_catalog drop constraint if exists reward_catalog_vendor_check;
alter table public.reward_catalog add constraint reward_catalog_vendor_check
    check (type = 'money' or vendor_id is not null) not valid;

-- Back-fill vouchers already issued, from the item they were issued for.
update public.redemptions r set vendor_id = c.vendor_id
  from public.reward_catalog c
 where r.vendor_id is null and r.type = 'points' and r.item = c.item and c.vendor_id is not null;

create index if not exists redemptions_vendor_idx on public.redemptions (vendor_id, processed_at desc) where vendor_id is not null;
create index if not exists user_profiles_vendor_idx on public.user_profiles (vendor_id) where vendor_id is not null;

-- -----------------------------------------------------------------------------
-- 4. Redemptions record their vendor
-- -----------------------------------------------------------------------------
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
        insert into public.redemptions (code, user_id, item, type, cost, status, upi_id, vendor, vendor_id)
        values (p_redemption ->> 'code', p_user, p_redemption ->> 'item', v_type, v_cost,
                p_redemption ->> 'status', p_redemption ->> 'upi_id', p_redemption ->> 'vendor',
                nullif(p_redemption ->> 'vendor_id', ''));

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
        when foreign_key_violation then return 'invalid';
        when raise_exception then
            if sqlerrm = 'naav_conflict' then return 'conflict'; end if;
            raise;
    end;
    return 'ok';
end;
$$;

-- -----------------------------------------------------------------------------
-- 5. Lock down: only the API (secret key) has access.
-- -----------------------------------------------------------------------------
alter table public.vendors enable row level security;
revoke all on public.vendors from anon, authenticated;

revoke execute on function public.naav_apply_redemption(uuid, integer, integer, jsonb) from public, anon, authenticated;
grant  execute on function public.naav_apply_redemption(uuid, integer, integer, jsonb) to service_role;

commit;
