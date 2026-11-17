// Signed bin QR codes: only codes made with the server secret may start a scan session.
const test = require('node:test');
const assert = require('node:assert/strict');
const {
    createBinQrPayload, verifyBinQrPayload, verifyBinQr,
    deriveDeviceKey, counterAt, createDynamicBinQrPayload, verifyDeviceKey,
} = require('../lib/binQr');

const SECRET = 'test-secret-do-not-use';
const NOW = Date.parse('2026-11-17T10:00:00.000Z');
const PERIOD = 30;

// ---------------- static (printed) codes ----------------

test('a generated code verifies back to its bin id', () => {
    const qr = createBinQrPayload('bin_01', SECRET);
    assert.match(qr, /^NAAVBIN:v1:bin_01:[A-Za-z0-9_-]{32}$/);
    assert.equal(verifyBinQrPayload(qr, SECRET), 'bin_01');
    assert.equal(verifyBinQrPayload(`  ${qr}\n`, SECRET), 'bin_01');
    assert.equal(verifyBinQrPayload(createBinQrPayload(42, SECRET), SECRET), '42');
    assert.deepEqual(verifyBinQr(qr, SECRET), { ok: true, binId: 'bin_01', mode: 'static' });
});

test('codes signed with another secret are rejected as forged', () => {
    const qr = createBinQrPayload('bin_01', 'other-secret');
    assert.equal(verifyBinQrPayload(qr, SECRET), null);
    assert.deepEqual(verifyBinQr(qr, SECRET), { ok: false, reason: 'forged', binId: 'bin_01' });
});

test('changing the bin id or the signature invalidates the code', () => {
    const qr = createBinQrPayload('bin_01', SECRET);
    const [prefix, version, , sig] = qr.split(':');
    assert.equal(verifyBinQrPayload(`${prefix}:${version}:bin_02:${sig}`, SECRET), null);
    const flipped = sig[0] === 'A' ? `B${sig.slice(1)}` : `A${sig.slice(1)}`;
    assert.equal(verifyBinQrPayload(`${prefix}:${version}:bin_01:${flipped}`, SECRET), null);
    assert.equal(verifyBinQrPayload(`${prefix}:${version}:bin_01:${sig.slice(0, -1)}`, SECRET), null);
});

test('malformed payloads are rejected without throwing', () => {
    const qr = createBinQrPayload('bin_01', SECRET);
    const cases = [
        qr.replace('NAAVBIN', 'SMARTBIN'),
        qr.replace(':v1:', ':v2:'),
        `${qr}:extra`,
        'bin_01',
        'https://example.com/?bin=bin_01',
        `NAAVBIN:v1:${'a'.repeat(300)}:sig`,
        'NAAVBIN:v1:bad id!:sig',
        '', null, undefined, 123, {},
    ];
    for (const c of cases) {
        assert.equal(verifyBinQrPayload(c, SECRET), null, String(c));
        assert.equal(verifyBinQr(c, SECRET).ok, false, String(c));
    }
});

test('foreign QR codes are "not_naav" (not suspicious); tampered Naav codes are "forged"', () => {
    assert.equal(verifyBinQr('https://example.com/menu', SECRET).reason, 'not_naav');
    assert.equal(verifyBinQr('SMARTBIN:v1:x:y', SECRET).reason, 'not_naav');
    assert.equal(verifyBinQr('NAAVBIN:v9:bin_01:x', SECRET).reason, 'forged');
    assert.equal(verifyBinQr('NAAVBIN:v1:bin_01:nope', SECRET).reason, 'forged');
});

test('verification fails closed without a secret', () => {
    assert.equal(verifyBinQrPayload(createBinQrPayload('bin_01', SECRET), ''), null);
    assert.equal(verifyBinQrPayload(createBinQrPayload('bin_01', SECRET), undefined), null);
    assert.equal(verifyBinQr(createBinQrPayload('bin_01', SECRET), '').ok, false);
});

test('creating a code validates its inputs', () => {
    assert.throws(() => createBinQrPayload('bin 01', SECRET), /unsupported characters/);
    assert.throws(() => createBinQrPayload('a:b', SECRET), /unsupported characters/);
    assert.throws(() => createBinQrPayload('bin_01', ''), /secret is required/);
});

// ---------------- dynamic (rotating) codes ----------------

const dynamic = (binId, { at = NOW, version = 1, secret = SECRET } = {}) =>
    createDynamicBinQrPayload(binId, deriveDeviceKey(secret, binId, version), version, counterAt(at, PERIOD));

test('dynamic: a current code verifies with its key version', () => {
    const qr = dynamic('bin_01');
    assert.match(qr, /^NAAVBIN:v2:bin_01:1:\d+:[A-Za-z0-9_-]{22}$/);
    assert.deepEqual(verifyBinQr(qr, SECRET, { nowMs: NOW, periodS: PERIOD }), { ok: true, binId: 'bin_01', mode: 'dynamic', keyVersion: 1 });
});

test('dynamic: the previous and next period are accepted (clock skew), older codes expire', () => {
    const opts = { nowMs: NOW, periodS: PERIOD };
    assert.equal(verifyBinQr(dynamic('bin_01', { at: NOW - PERIOD * 1000 }), SECRET, opts).ok, true);
    assert.equal(verifyBinQr(dynamic('bin_01', { at: NOW + PERIOD * 1000 }), SECRET, opts).ok, true);
    const screenshot = verifyBinQr(dynamic('bin_01', { at: NOW - 3 * PERIOD * 1000 }), SECRET, opts);
    assert.deepEqual(screenshot, { ok: false, reason: 'expired', binId: 'bin_01' });
});

test('dynamic: a code cannot be moved to another bin, counter or key version', () => {
    const opts = { nowMs: NOW, periodS: PERIOD };
    const [p, v, , ver, ctr, sig] = dynamic('bin_01').split(':');
    assert.equal(verifyBinQr([p, v, 'bin_02', ver, ctr, sig].join(':'), SECRET, opts).reason, 'forged');
    assert.equal(verifyBinQr([p, v, 'bin_01', ver, String(Number(ctr) + 1), sig].join(':'), SECRET, opts).reason, 'forged');
    assert.equal(verifyBinQr([p, v, 'bin_01', '2', ctr, sig].join(':'), SECRET, opts).reason, 'forged');
    assert.equal(verifyBinQr(dynamic('bin_01', { secret: 'other-secret' }), SECRET, opts).reason, 'forged');
});

test('dynamic: rotating the key version gives a different device key', () => {
    assert.notEqual(deriveDeviceKey(SECRET, 'bin_01', 1), deriveDeviceKey(SECRET, 'bin_01', 2));
    assert.notEqual(deriveDeviceKey(SECRET, 'bin_01', 1), deriveDeviceKey(SECRET, 'bin_02', 1));
    const qr = dynamic('bin_01', { version: 2 });
    assert.equal(verifyBinQr(qr, SECRET, { nowMs: NOW, periodS: PERIOD }).keyVersion, 2);
});

test('device keys verify in constant time and only for the right bin and version', () => {
    const key = deriveDeviceKey(SECRET, 'bin_01', 3);
    assert.equal(verifyDeviceKey(SECRET, 'bin_01', 3, key), true);
    assert.equal(verifyDeviceKey(SECRET, 'bin_01', 2, key), false);
    assert.equal(verifyDeviceKey(SECRET, 'bin_02', 3, key), false);
    assert.equal(verifyDeviceKey(SECRET, 'bin_01', 3, key.slice(1)), false);
    assert.equal(verifyDeviceKey('', 'bin_01', 3, key), false);
    assert.equal(verifyDeviceKey(SECRET, 'bad id', 3, key), false);
});

test('the browser display algorithm matches the server (HMAC over the device key text)', async () => {
    // Same steps as client/smartbin/src/binDisplay.jsx, using WebCrypto.
    const key = deriveDeviceKey(SECRET, 'bin_01', 1);
    const counter = counterAt(NOW, PERIOD);
    const cryptoKey = await globalThis.crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const mac = new Uint8Array(await globalThis.crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(`v2:bin_01:1:${counter}`)));
    const sig = Buffer.from(mac).toString('base64url').slice(0, 22);
    assert.equal(`NAAVBIN:v2:bin_01:1:${counter}:${sig}`, dynamic('bin_01'));
});
