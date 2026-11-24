// Database tests for the functions that move money and points. They run the real Supabase scripts
// in PGlite (Postgres in WASM, in-process), so `npm test` needs no database server.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createDb } = require('./harness');

let db;
let seq = 0;

test.before(async () => { db = await createDb(); });
test.after(async () => { if (db) await db.close(); });

const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const call = async (fn, args) => {
    const marks = args.map((_, i) => `$${i + 1}`).join(', ');
    return (await one(`select public.${fn}(${marks}) as r`, args)).r;
};

// A student created the way Supabase sign-up does it (auth.users insert -> profile trigger).
async function student({ points = 0, inr = 0 } = {}) {
    seq += 1;
    const { id } = await one(`insert into auth.users (email) values ($1) returning id`, [`s${seq}@campus.test`]);
    await db.query(`update public.user_profiles set "ecoPoints" = $2, "walletBalance" = $3 where id = $1`, [id, points, inr]);
    await db.query(`delete from public.wallet_ledger where user_id = $1`, [id]);
    await db.query(`delete from public.points_ledger where user_id = $1`, [id]);
    return id;
}
const profile = id => one(`select "ecoPoints" as points, "walletBalance" as inr, pending_points, cycle_items from public.user_profiles where id = $1`, [id]);
const payment = code => one(`select * from public.vendor_payments where code = $1`, [code]);
const walletLedger = id => db.query(`select delta, balance_after, kind, ref from public.wallet_ledger where user_id = $1 order by id`, [id]).then(r => r.rows);

let codeSeq = 0;
const newCode = () => { codeSeq += 1; return `NP-TEST-${String(codeSeq).padStart(4, '0')}`; };
const inMinutes = m => new Date(Date.now() + m * 60000).toISOString();

async function openPayment(user, amount, vendor = 'utsav-cafe') {
    const code = newCode();
    assert.equal(await call('naav_create_payment', [user, code, vendor, amount, inMinutes(3)]), 'ok');
    return code;
}
async function paidPayment(user, amount, vendor = 'utsav-cafe') {
    const code = await openPayment(user, amount, vendor);
    assert.equal(await call('naav_confirm_payment', [code, vendor, null, 'staff@campus.test']), 'ok');
    return code;
}

// ---------------- naav_convert_points ----------------

test('convert: points become ₹ in one step, and the ₹ ledger records it', async () => {
    const u = await student({ points: 1234 });
    assert.equal(await call('naav_convert_points', [u, 1230, 123]), 'ok');
    assert.deepEqual(await profile(u), { points: 4, inr: 123, pending_points: 0, cycle_items: 0 });
    assert.deepEqual(await walletLedger(u), [{ delta: 123, balance_after: 123, kind: 'convert', ref: null }]);
});

test('convert: refuses more points than the student has, and bad input', async () => {
    const u = await student({ points: 50 });
    assert.equal(await call('naav_convert_points', [u, 60, 6]), 'insufficient');
    assert.equal(await call('naav_convert_points', [u, 0, 0]), 'invalid');
    assert.equal(await call('naav_convert_points', [u, -10, -1]), 'invalid');
    assert.deepEqual(await profile(u), { points: 50, inr: 0, pending_points: 0, cycle_items: 0 });
});

// ---------------- naav_create_payment ----------------

test('create payment: a new code cancels the open one, so only one is live', async () => {
    const u = await student({ inr: 100 });
    const first = await openPayment(u, 10);
    const second = await openPayment(u, 20);
    assert.equal((await payment(first)).status, 'Cancelled');
    assert.equal((await payment(second)).status, 'Pending');
    const { n } = await one(`select count(*)::int as n from public.vendor_payments where user_id = $1 and status = 'Pending'`, [u]);
    assert.equal(n, 1);
});

test('create payment: a code collision returns duplicate and leaves the other code alone', async () => {
    const a = await student({ inr: 100 });
    const b = await student({ inr: 100 });
    const code = await openPayment(a, 10);
    assert.equal(await call('naav_create_payment', [b, code, 'utsav-cafe', 5, inMinutes(3)]), 'duplicate');
    assert.equal((await payment(code)).user_id, a);
    assert.equal((await payment(code)).status, 'Pending');
});

test('create payment: rejects a non-positive amount', async () => {
    const u = await student({ inr: 100 });
    assert.equal(await call('naav_create_payment', [u, newCode(), 'utsav-cafe', 0, inMinutes(3)]), 'invalid');
});

// ---------------- naav_confirm_payment ----------------

test('confirm: deducts exactly the amount once, and records the counter', async () => {
    const u = await student({ inr: 100 });
    const code = await openPayment(u, 70);
    assert.equal(await call('naav_confirm_payment', [code, 'utsav-cafe', null, 'staff@campus.test']), 'ok');
    assert.equal((await profile(u)).inr, 30);
    const p = await payment(code);
    assert.equal(p.status, 'Completed');
    assert.equal(p.staff_email, 'staff@campus.test');
    assert.equal(await call('naav_confirm_payment', [code, 'utsav-cafe', null, 'staff@campus.test']), 'not_pending');
    assert.equal((await profile(u)).inr, 30, 'a second confirm must not deduct again');
    assert.deepEqual((await walletLedger(u)).at(-1), { delta: -70, balance_after: 30, kind: 'payment', ref: code });
});

test('confirm: the wrong counter cannot take the payment', async () => {
    const u = await student({ inr: 100 });
    const code = await openPayment(u, 10, 'utsav-cafe');
    assert.equal(await call('naav_confirm_payment', [code, 'mtr-stall', null, 'x@campus.test']), 'wrong_vendor');
    assert.equal((await payment(code)).status, 'Pending');
    assert.equal((await profile(u)).inr, 100);
});

test('confirm: an expired code is marked Expired and nothing is deducted', async () => {
    const u = await student({ inr: 100 });
    const code = newCode();
    assert.equal(await call('naav_create_payment', [u, code, 'utsav-cafe', 10, inMinutes(-1)]), 'ok');
    assert.equal(await call('naav_confirm_payment', [code, 'utsav-cafe', null, 'x@campus.test']), 'expired');
    assert.equal((await payment(code)).status, 'Expired');
    assert.equal((await profile(u)).inr, 100);
});

test('confirm: fails if the student spent the money after creating the code', async () => {
    const u = await student({ inr: 50 });
    const code = await openPayment(u, 40);
    await db.query(`update public.user_profiles set "walletBalance" = 30 where id = $1`, [u]);
    assert.equal(await call('naav_confirm_payment', [code, 'utsav-cafe', null, 'x@campus.test']), 'insufficient');
    assert.equal((await payment(code)).status, 'Pending');
    assert.equal((await profile(u)).inr, 30);
});

test("confirm: a counter's daily ₹ limit is enforced", async () => {
    await db.query(`insert into public.vendors (id, name, category, daily_limit_inr) values ('limit-test', 'Limit Test', 'print', 100)
                    on conflict (id) do update set daily_limit_inr = 100`);
    const u = await student({ inr: 500 });
    await paidPayment(u, 60, 'limit-test');
    const code = await openPayment(u, 50, 'limit-test');
    assert.equal(await call('naav_confirm_payment', [code, 'limit-test', null, 'x@campus.test']), 'daily_limit');
    assert.equal((await profile(u)).inr, 440);
});

test('confirm: unknown code', async () => {
    assert.equal(await call('naav_confirm_payment', ['NP-NONE-0000', null, null, 'x@campus.test']), 'not_found');
});

// ---------------- naav_refund_payment ----------------

test('refund: puts the ₹ back once, with the reason and who did it', async () => {
    const u = await student({ inr: 100 });
    const code = await paidPayment(u, 25);
    assert.equal(await call('naav_refund_payment', [code, 'admin@campus.test', '  Counter charged twice  ', 7]), 'ok');
    assert.equal((await profile(u)).inr, 100);
    const p = await payment(code);
    assert.equal(p.status, 'Refunded');
    assert.equal(p.refunded_by, 'admin@campus.test');
    assert.equal(p.refund_reason, 'Counter charged twice');
    assert.equal(await call('naav_refund_payment', [code, 'admin@campus.test', 'again please', 7]), 'not_completed');
    assert.equal((await profile(u)).inr, 100, 'a second refund must not pay again');
    assert.deepEqual((await walletLedger(u)).at(-1), { delta: 25, balance_after: 100, kind: 'payment_refund', ref: code });
});

test('refund: a reason is required', async () => {
    const u = await student({ inr: 100 });
    const code = await paidPayment(u, 10);
    for (const reason of [null, '', '  ', 'no', 'x'.repeat(201)]) {
        assert.equal(await call('naav_refund_payment', [code, 'admin@campus.test', reason, 7]), 'no_reason', `reason ${JSON.stringify(reason)}`);
    }
    assert.equal((await payment(code)).status, 'Completed');
});

test('refund: only within the window', async () => {
    const u = await student({ inr: 100 });
    const code = await paidPayment(u, 10);
    await db.query(`update public.vendor_payments set completed_at = now() - interval '8 days' where code = $1`, [code]);
    assert.equal(await call('naav_refund_payment', [code, 'admin@campus.test', 'late complaint', 7]), 'too_old');
    assert.equal((await profile(u)).inr, 90);
});

test('refund: only completed payments', async () => {
    const u = await student({ inr: 100 });
    const code = await openPayment(u, 10);
    assert.equal(await call('naav_refund_payment', [code, 'admin@campus.test', 'never paid', 7]), 'not_completed');
    assert.equal(await call('naav_refund_payment', ['NP-NONE-0000', 'admin@campus.test', 'missing', 7]), 'not_found');
});

// ---------------- naav_apply_deposit_v2 ----------------

const expected = p => ({ walletBalance: p.inr, ecoPoints: p.points, pendingPoints: p.pending_points, cycleItems: p.cycle_items });
const log = session => ({ bin_id: 'bin-1', bin_name: 'Bin 1', waste_type: 'Plastic', stream: 'dry', reward_inr: 0, points: 10, session_id: session });

test('deposit: credits points and the pending bonus state; one reward per bin session', async () => {
    const u = await student();
    const before = await profile(u);
    const award = { credit: 6, instant: 6, pending_after: 4, cycle_after: 1, released: 0, expired: 0 };
    assert.equal(await call('naav_apply_deposit_v2', [u, expected(before), log(`s-${u}`), award]), 'ok');
    assert.deepEqual(await profile(u), { points: 6, inr: 0, pending_points: 4, cycle_items: 1 });
    const again = await profile(u);
    assert.equal(await call('naav_apply_deposit_v2', [u, expected(again), log(`s-${u}`), award]), 'duplicate_session');
    assert.deepEqual(await profile(u), again);
});

test('deposit: a stale read is refused (compare-and-swap) and nothing is logged', async () => {
    const u = await student({ points: 100 });
    const stale = { walletBalance: 0, ecoPoints: 90, pendingPoints: 0, cycleItems: 0 };
    const award = { credit: 6, instant: 6, pending_after: 4, cycle_after: 1, released: 0, expired: 0 };
    assert.equal(await call('naav_apply_deposit_v2', [u, stale, log(`stale-${u}`), award]), 'conflict');
    assert.equal((await profile(u)).points, 100);
    const { n } = await one(`select count(*)::int as n from public.waste_logs where session_id = $1`, [`stale-${u}`]);
    assert.equal(n, 0);
});

test('deposit: a milestone release is recorded in bonus_releases', async () => {
    const u = await student();
    await db.query(`update public.user_profiles set pending_points = 16, cycle_items = 4 where id = $1`, [u]);
    const award = { credit: 26, instant: 6, pending_after: 0, cycle_after: 5, released: 20, multiplier: 1.0, extra: 0, expired: 0, cycle_item: 5 };
    assert.equal(await call('naav_apply_deposit_v2', [u, expected(await profile(u)), log(`m-${u}`), award]), 'ok');
    assert.deepEqual(await profile(u), { points: 26, inr: 0, pending_points: 0, cycle_items: 5 });
    const r = await one(`select kind, points, cycle_item from public.bonus_releases where user_id = $1`, [u]);
    assert.deepEqual(r, { kind: 'release', points: 20, cycle_item: 5 });
});

test('deposit: negative credit is refused', async () => {
    const u = await student();
    const award = { credit: -1, pending_after: 0, cycle_after: 0 };
    assert.equal(await call('naav_apply_deposit_v2', [u, expected(await profile(u)), log(`neg-${u}`), award]), 'invalid');
});

// ---------------- reward programme ----------------

test('programme: every change is kept with who and the rate before/after; a no-op save is not', async () => {
    const before = (await one(`select count(*)::int as n from public.reward_program_history`)).n;
    await db.query(`update public.reward_program set points_per_rupee = 20, updated_by = 'admin@campus.test', updated_at = now() where id = 1`);
    await db.query(`update public.reward_program set updated_by = 'admin@campus.test', updated_at = now() where id = 1`);
    const rows = (await db.query(`select changed_by, rate_before, rate_after from public.reward_program_history order by id`)).rows;
    assert.equal(rows.length, before + 1);
    assert.deepEqual(rows.at(-1), { changed_by: 'admin@campus.test', rate_before: 10, rate_after: 20 });
    await db.query(`update public.reward_program set points_per_rupee = 10 where id = 1`);
});

test('programme: points-only is locked on by the script', async () => {
    assert.equal((await one(`select points_only from public.reward_program where id = 1`)).points_only, true);
});

test('script: vouchers and UPI withdrawals are removed (tables, functions, counter claim limit)', async () => {
    const { tables } = await one(`select count(*)::int as tables from information_schema.tables
                                  where table_schema = 'public' and table_name in ('reward_catalog', 'redemptions')`);
    assert.equal(tables, 0);
    const { fns } = await one(`select count(*)::int as fns from pg_proc
                               where proname in ('naav_apply_redemption', 'naav_set_redemption_status', 'naav_apply_deposit')`);
    assert.equal(fns, 0);
    const { cols } = await one(`select count(*)::int as cols from information_schema.columns
                                where table_schema = 'public' and table_name = 'vendors' and column_name = 'daily_claim_limit'`);
    assert.equal(cols, 0);
});

// Regression: installs from the first wallet version have vendor_payments.points with no default.
test('script: re-running 004 fixes an old points column without a default', async () => {
    await db.query(`alter table public.vendor_payments alter column points drop default`);
    await db.exec(fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', '004_wallet_cashback.sql'), 'utf8'));
    const { d } = await one(`select column_default as d from information_schema.columns
                             where table_schema = 'public' and table_name = 'vendor_payments' and column_name = 'points'`);
    assert.equal(d, '0');
    const u = await student({ inr: 10 });
    await openPayment(u, 5);
});

test('create payment: works even if the points column has no default', async () => {
    await db.query(`alter table public.vendor_payments alter column points drop default`);
    try {
        const u = await student({ inr: 10 });
        const code = await openPayment(u, 5);
        assert.equal((await payment(code)).points, 0);
    } finally {
        await db.query(`alter table public.vendor_payments alter column points set default 0`);
    }
});

// Last: re-running 004 must work on an installed database and keep data.
test('script: 004 can be run again without losing balances or payments', async () => {
    const u = await student({ inr: 100 });
    const code = await paidPayment(u, 10);
    await db.query(`update public.reward_program set points_only = false where id = 1`);
    await db.exec(fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', '004_wallet_cashback.sql'), 'utf8'));
    assert.equal((await profile(u)).inr, 90);
    assert.equal((await payment(code)).status, 'Completed');
    assert.equal((await one(`select points_only from public.reward_program where id = 1`)).points_only, true);
});
