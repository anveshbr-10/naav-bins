// Signed smart-bin QR codes.
//
// A bin QR encodes:  NAAVBIN:v1:<binId>:<signature>
// where signature = HMAC-SHA256(QR_SECRET, "v1:<binId>") (base64url, truncated to 32 chars).
// Only the server knows QR_SECRET, so random / self-made QR codes cannot start a scan session
// and bin IDs cannot be forged.

const crypto = require('crypto');

const PREFIX = 'NAAVBIN';
const VERSION = 'v1';
const BIN_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const SIG_LENGTH = 32;

function sign(binId, secret) {
    return crypto
        .createHmac('sha256', secret)
        .update(`${VERSION}:${binId}`)
        .digest('base64url')
        .slice(0, SIG_LENGTH);
}

function createBinQrPayload(binId, secret) {
    const id = String(binId);
    if (!BIN_ID_RE.test(id)) throw new Error(`Bin id "${id}" contains unsupported characters`);
    if (!secret) throw new Error('QR secret is required');
    return `${PREFIX}:${VERSION}:${id}:${sign(id, secret)}`;
}

// Returns the bin id when the payload is authentic, otherwise null.
function verifyBinQrPayload(payload, secret) {
    if (!secret || typeof payload !== 'string' || payload.length > 256) return null;

    const parts = payload.trim().split(':');
    if (parts.length !== 4 || parts[0] !== PREFIX || parts[1] !== VERSION) return null;

    const id = parts[2];
    const given = Buffer.from(parts[3]);
    if (!BIN_ID_RE.test(id)) return null;

    const expected = Buffer.from(sign(id, secret));
    if (given.length !== expected.length) return null;
    return crypto.timingSafeEqual(given, expected) ? id : null;
}

module.exports = { createBinQrPayload, verifyBinQrPayload };
