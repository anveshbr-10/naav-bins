// Signed smart-bin QR codes.
//
// Static (printed) code:   NAAVBIN:v1:<binId>:<sig>
//   sig = HMAC-SHA256(QR_SECRET, "v1:<binId>")                        (base64url, 32 chars)
//
// Dynamic (rotating, shown on the bin's screen):   NAAVBIN:v2:<binId>:<keyVersion>:<counter>:<sig>
//   deviceKey = HMAC-SHA256(QR_SECRET, "naav-device:<keyVersion>:<binId>")   (base64url)
//   counter   = floor(unixSeconds / period)   (period = 30 s by default)
//   sig       = HMAC-SHA256(deviceKey, "v2:<binId>:<keyVersion>:<counter>")  (base64url, 22 chars)
//
// Only the server knows QR_SECRET, so random or self-made codes cannot start a scan session and bin
// IDs cannot be forged. A dynamic code is only valid for about one period, so a photo or screenshot
// of the bin's screen stops working within a minute (remote / shared-screenshot fraud).
// The bin's screen holds only its own device key, which an admin can rotate per bin.

const crypto = require('crypto');

const PREFIX = 'NAAVBIN';
const BIN_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const SIG_LENGTH = 32;
const DYN_SIG_LENGTH = 22;
const DEFAULT_PERIOD_S = 30;

function hmac(key, message) {
    return crypto.createHmac('sha256', key).update(message).digest('base64url');
}

function safeEqual(a, b) {
    const x = Buffer.from(String(a));
    const y = Buffer.from(String(b));
    return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function assertBinId(binId) {
    const id = String(binId);
    if (!BIN_ID_RE.test(id)) throw new Error(`Bin id "${id}" contains unsupported characters`);
    return id;
}

// ---------- static (printed) codes ----------

function sign(binId, secret) {
    return hmac(secret, `v1:${binId}`).slice(0, SIG_LENGTH);
}

function createBinQrPayload(binId, secret) {
    const id = assertBinId(binId);
    if (!secret) throw new Error('QR secret is required');
    return `${PREFIX}:v1:${id}:${sign(id, secret)}`;
}

// ---------- dynamic (rotating) codes ----------

function deriveDeviceKey(secret, binId, keyVersion = 1) {
    if (!secret) throw new Error('QR secret is required');
    return hmac(secret, `naav-device:${Number(keyVersion)}:${assertBinId(binId)}`);
}

function counterAt(nowMs, periodS = DEFAULT_PERIOD_S) {
    return Math.floor(nowMs / 1000 / periodS);
}

function dynamicSignature(deviceKey, binId, keyVersion, counter) {
    return hmac(deviceKey, `v2:${binId}:${keyVersion}:${counter}`).slice(0, DYN_SIG_LENGTH);
}

function createDynamicBinQrPayload(binId, deviceKey, keyVersion, counter) {
    const id = assertBinId(binId);
    if (!deviceKey) throw new Error('Device key is required');
    return `${PREFIX}:v2:${id}:${Number(keyVersion)}:${counter}:${dynamicSignature(deviceKey, id, Number(keyVersion), counter)}`;
}

// ---------- verification ----------

// Returns one of:
//   { ok: true, binId, mode: 'static' }
//   { ok: true, binId, mode: 'dynamic', keyVersion }
//   { ok: false, reason: 'not_naav' }   not one of our codes at all (e.g. a product QR) — not suspicious
//   { ok: false, reason: 'forged', binId? }  our prefix but a bad signature — suspicious
//   { ok: false, reason: 'expired', binId }  a correctly signed dynamic code from an old period (screenshot replay)
function verifyBinQr(payload, secret, { nowMs = Date.now(), periodS = DEFAULT_PERIOD_S, skew = 1 } = {}) {
    if (!secret || typeof payload !== 'string' || payload.length > 256) return { ok: false, reason: 'not_naav' };
    const parts = payload.trim().split(':');
    if (parts[0] !== PREFIX) return { ok: false, reason: 'not_naav' };

    if (parts[1] === 'v1' && parts.length === 4) {
        const [, , id, sig] = parts;
        if (!BIN_ID_RE.test(id)) return { ok: false, reason: 'forged' };
        return safeEqual(sig, sign(id, secret)) ? { ok: true, binId: id, mode: 'static' } : { ok: false, reason: 'forged', binId: id };
    }

    if (parts[1] === 'v2' && parts.length === 6) {
        const [, , id, ver, ctr, sig] = parts;
        if (!BIN_ID_RE.test(id) || !/^\d{1,4}$/.test(ver) || !/^\d{1,12}$/.test(ctr)) return { ok: false, reason: 'forged' };
        const keyVersion = Number(ver);
        const counter = Number(ctr);
        const expected = dynamicSignature(deriveDeviceKey(secret, id, keyVersion), id, keyVersion, counter);
        if (!safeEqual(sig, expected)) return { ok: false, reason: 'forged', binId: id };
        const current = counterAt(nowMs, periodS);
        if (Math.abs(current - counter) > skew) return { ok: false, reason: 'expired', binId: id };
        return { ok: true, binId: id, mode: 'dynamic', keyVersion };
    }

    return { ok: false, reason: 'forged' };
}

// Backwards-compatible helper: bin id for a valid static code, otherwise null.
function verifyBinQrPayload(payload, secret) {
    if (typeof payload !== 'string' || !payload.trim().startsWith(`${PREFIX}:v1:`)) return null;
    const r = verifyBinQr(payload, secret);
    return r.ok && r.mode === 'static' ? r.binId : null;
}

// Constant-time check of a device key presented by a bin (telemetry, display provisioning).
function verifyDeviceKey(secret, binId, keyVersion, presented) {
    if (!secret || typeof presented !== 'string' || !BIN_ID_RE.test(String(binId))) return false;
    return safeEqual(presented, deriveDeviceKey(secret, binId, keyVersion));
}

module.exports = {
    DEFAULT_PERIOD_S,
    createBinQrPayload, verifyBinQrPayload,
    deriveDeviceKey, counterAt, createDynamicBinQrPayload, verifyBinQr, verifyDeviceKey,
};
