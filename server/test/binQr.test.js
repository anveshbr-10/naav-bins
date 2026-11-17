// Signed bin QR codes: only codes made with the server secret may start a scan session.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createBinQrPayload, verifyBinQrPayload } = require('../lib/binQr');

const SECRET = 'test-secret-do-not-use';

test('a generated code verifies back to its bin id', () => {
    const qr = createBinQrPayload('bin_01', SECRET);
    assert.match(qr, /^NAAVBIN:v1:bin_01:[A-Za-z0-9_-]{32}$/);
    assert.equal(verifyBinQrPayload(qr, SECRET), 'bin_01');
    assert.equal(verifyBinQrPayload(`  ${qr}\n`, SECRET), 'bin_01');
    assert.equal(verifyBinQrPayload(createBinQrPayload(42, SECRET), SECRET), '42');
});

test('codes signed with another secret are rejected', () => {
    assert.equal(verifyBinQrPayload(createBinQrPayload('bin_01', 'other-secret'), SECRET), null);
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
    for (const c of cases) assert.equal(verifyBinQrPayload(c, SECRET), null, String(c));
});

test('verification fails closed without a secret', () => {
    assert.equal(verifyBinQrPayload(createBinQrPayload('bin_01', SECRET), ''), null);
    assert.equal(verifyBinQrPayload(createBinQrPayload('bin_01', SECRET), undefined), null);
});

test('creating a code validates its inputs', () => {
    assert.throws(() => createBinQrPayload('bin 01', SECRET), /unsupported characters/);
    assert.throws(() => createBinQrPayload('a:b', SECRET), /unsupported characters/);
    assert.throws(() => createBinQrPayload('bin_01', ''), /secret is required/);
});
