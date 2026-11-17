// Perceptual hash (pHash) of a capture, used to reject repeated photos of the same item.
//
// The scanner sends a 32×32 grayscale thumbnail of the photo (1,024 bytes, base64). The server — not
// the client — computes a 64-bit DCT perceptual hash from it. Near-identical images (same item, same
// framing, small changes in light or position) give hashes a few bits apart; different items differ
// by ~20–35 bits. Pure functions: no I/O.

const SIZE = 32;
const LOW = 8;

// DCT-II basis, computed once.
const COS = Array.from({ length: LOW }, (_, u) =>
    Float64Array.from({ length: SIZE }, (__, x) => Math.cos(((2 * x + 1) * u * Math.PI) / (2 * SIZE))));

// Returns a Uint8Array(1024) or null when the input is not a valid thumbnail.
function decodeThumbnail(base64) {
    if (typeof base64 !== 'string' || base64.length > 2000) return null;
    let buf;
    try { buf = Buffer.from(base64, 'base64'); } catch { return null; }
    return buf.length === SIZE * SIZE ? new Uint8Array(buf) : null;
}

// Standard deviation of the pixels. Near-zero means a blank / covered / pitch-black frame, which
// carries no information, so it is not hashed.
function contrast(pixels) {
    let sum = 0, sq = 0;
    for (const p of pixels) { sum += p; sq += p * p; }
    const mean = sum / pixels.length;
    return Math.sqrt(Math.max(0, sq / pixels.length - mean * mean));
}

// 64-bit pHash as 16 hex characters, or null for an unusable image.
function perceptualHash(pixels, { minContrast = 4 } = {}) {
    if (!pixels || pixels.length !== SIZE * SIZE) return null;
    if (contrast(pixels) < minContrast) return null;

    // Separable 2-D DCT, keeping only the 8×8 lowest frequencies.
    const rows = Array.from({ length: SIZE }, () => new Float64Array(LOW));
    for (let y = 0; y < SIZE; y++) {
        for (let u = 0; u < LOW; u++) {
            let s = 0;
            for (let x = 0; x < SIZE; x++) s += pixels[y * SIZE + x] * COS[u][x];
            rows[y][u] = s;
        }
    }
    const coeffs = [];
    for (let v = 0; v < LOW; v++) {
        for (let u = 0; u < LOW; u++) {
            let s = 0;
            for (let y = 0; y < SIZE; y++) s += rows[y][u] * COS[v][y];
            coeffs.push(s);
        }
    }

    // Compare each coefficient with the median, excluding the DC term (overall brightness).
    const sorted = coeffs.slice(1).sort((a, b) => a - b);
    const median = (sorted[31] + sorted[32]) / 2;
    let hex = '';
    for (let i = 0; i < 64; i += 4) {
        let nibble = 0;
        for (let b = 0; b < 4; b++) nibble = (nibble << 1) | (coeffs[i + b] > median ? 1 : 0);
        hex += nibble.toString(16);
    }
    return hex;
}

const POP = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4];

function hammingDistance(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string' || a.length !== 16 || b.length !== 16) return 64;
    let d = 0;
    for (let i = 0; i < 16; i++) {
        const x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
        if (Number.isNaN(x)) return 64;
        d += POP[x];
    }
    return d;
}

// The closest earlier hash within the threshold, or null.
function findNearDuplicate(hash, previous, threshold) {
    if (!hash) return null;
    let best = null;
    for (const p of previous) {
        const d = hammingDistance(hash, p && p.image_hash);
        if (d <= threshold && (!best || d < best.distance)) best = { ...p, distance: d };
    }
    return best;
}

module.exports = { SIZE, decodeThumbnail, perceptualHash, hammingDistance, findNearDuplicate, contrast };
