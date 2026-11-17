const test = require('node:test');
const assert = require('node:assert/strict');
const { SIZE, decodeThumbnail, perceptualHash, hammingDistance, findNearDuplicate } = require('../lib/imageHash');

// Synthetic 32×32 grayscale "photos".
function image(fn) {
    const px = new Uint8Array(SIZE * SIZE);
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) px[y * SIZE + x] = Math.max(0, Math.min(255, Math.round(fn(x, y))));
    return px;
}
// An off-centre bottle with a cap and a label, under diagonal light (camera thumbnails are smooth
// at 32×32). dx shifts the framing; gain/offset change the exposure.
const soft = (v, edge, k = 1.2) => 1 / (1 + Math.exp((v - edge) * k));
const scene = (dx = 0, gain = 1, offset = 0) => image((x0, y) => {
    const x = x0 + dx;
    const body = soft(Math.abs(x - 11), 4) * soft(-y, -6) * soft(y, 27);
    const cap = soft(Math.abs(x - 11), 2) * soft(-y, -2) * soft(y, 6);
    const label = body * soft(Math.abs(y - 17), 3);
    return offset + gain * (30 + x * 2.5 + y * 1.5 + 150 * body - 70 * label + 120 * cap);
});
const bottle = scene();
const can = image((x, y) => ((x - 20) ** 2 + (y - 14) ** 2 < 70 ? 200 : 60) + x * 1.5);
const stripes = image(x => (x % 8 < 4 ? 230 : 20));

test('thumbnails must be exactly 32×32 bytes of base64', () => {
    assert.equal(decodeThumbnail(Buffer.from(bottle).toString('base64')).length, 1024);
    for (const bad of [undefined, null, 42, '', Buffer.alloc(100).toString('base64'), 'x'.repeat(5000)]) {
        assert.equal(decodeThumbnail(bad), null, String(bad).slice(0, 20));
    }
});

test('the hash is 64 bits (16 hex chars) and deterministic', () => {
    const h = perceptualHash(bottle);
    assert.match(h, /^[0-9a-f]{16}$/);
    assert.equal(perceptualHash(bottle), h);
});

test('the same frame again (exposure change, sensor noise) stays within the default threshold of 6', () => {
    const h = perceptualHash(bottle);
    assert.ok(hammingDistance(h, perceptualHash(scene(0, 1.15, 10))) <= 6, 'brighter');
    assert.ok(hammingDistance(h, perceptualHash(scene(0, 0.8, -5))) <= 6, 'dimmer');
    const noisy = image((x, y) => bottle[y * SIZE + x] + (((x * 31 + y * 17) % 7) - 3));
    assert.ok(hammingDistance(h, perceptualHash(noisy)) <= 6, 'noise');
    // A slightly re-framed retake is closer than any different item.
    assert.ok(hammingDistance(h, perceptualHash(scene(1))) < 16, 'shifted by a pixel');
});

test('different items are far apart', () => {
    const h = perceptualHash(bottle);
    assert.ok(hammingDistance(h, perceptualHash(can)) > 10);
    assert.ok(hammingDistance(h, perceptualHash(stripes)) > 10);
});

test('blank or covered frames are not hashed', () => {
    assert.equal(perceptualHash(new Uint8Array(1024)), null);
    assert.equal(perceptualHash(image(() => 128)), null);
    assert.equal(perceptualHash(new Uint8Array(10)), null);
});

test('hammingDistance and findNearDuplicate', () => {
    assert.equal(hammingDistance('0000000000000000', '000000000000000f'), 4);
    assert.equal(hammingDistance('ffffffffffffffff', '0000000000000000'), 64);
    assert.equal(hammingDistance('zz', '00'), 64);
    const prev = [{ id: 'a', image_hash: '0000000000000003' }, { id: 'b', image_hash: '0000000000000001' }, { id: 'c', image_hash: null }];
    assert.equal(findNearDuplicate('0000000000000000', prev, 4).id, 'b');
    assert.equal(findNearDuplicate('ffffffffffffffff', prev, 4), null);
    assert.equal(findNearDuplicate(null, prev, 4), null);
});
