// Generates signed QR codes for every bin in the Supabase `bins` table.
//
// Usage (from the server/ folder, with server/.env filled in):
//   node scripts/generate-bin-qr.js [output.html]
//
// Print the resulting page and stick each QR on its bin. Codes stay valid until QR_SECRET changes.

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true });

const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');
const { createClient } = require('@supabase/supabase-js');
const { createBinQrPayload } = require('../lib/binQr');

const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function main() {
    const { QR_SECRET, SUPABASE_URL } = process.env;
    const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!QR_SECRET || QR_SECRET.length < 32) throw new Error('QR_SECRET (min 32 chars) must be set in server/.env');
    if (!SUPABASE_URL || !key) throw new Error('SUPABASE_URL and SUPABASE_SECRET_KEY must be set in server/.env');

    const supabase = createClient(SUPABASE_URL, key, { auth: { persistSession: false } });
    const { data: bins, error } = await supabase.from('bins').select('id, name, status').order('id');
    if (error) throw error;
    if (!bins.length) throw new Error('No bins found in the bins table');

    const cards = [];
    for (const bin of bins) {
        const payload = createBinQrPayload(bin.id, QR_SECRET);
        const dataUrl = await QRCode.toDataURL(payload, { errorCorrectionLevel: 'M', margin: 2, width: 320 });
        console.log(`${String(bin.id).padEnd(6)} ${bin.name.padEnd(40)} ${payload}`);
        cards.push(`
      <figure>
        <img src="${dataUrl}" alt="QR for ${escapeHtml(bin.name)}" />
        <figcaption><strong>${escapeHtml(bin.name)}</strong><br/>Bin #${escapeHtml(bin.id)} · ${escapeHtml(bin.status)}</figcaption>
      </figure>`);
    }

    const out = path.resolve(process.argv[2] || path.join(__dirname, '..', 'bin-qr-codes.html'));
    fs.writeFileSync(out, `<!doctype html>
<html><head><meta charset="utf-8"><title>Naav Bins — Bin QR codes</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 24px; }
  main { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 24px; }
  figure { margin: 0; padding: 16px; border: 1px dashed #999; text-align: center; break-inside: avoid; }
  img { width: 100%; max-width: 240px; }
</style></head>
<body><h1>Naav Bins QR codes</h1><main>${cards.join('')}</main></body></html>`);

    console.log(`\n✅ Wrote ${bins.length} QR code(s) to ${out}`);
}

main().catch(err => {
    console.error('❌', err.message || err);
    process.exit(1);
});
