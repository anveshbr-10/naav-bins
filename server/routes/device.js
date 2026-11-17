// Endpoints for the bins themselves (the screen that shows the rotating QR code, a fill-level
// sensor, a load cell). A bin authenticates with its own device key (headers X-Bin-Id and
// X-Device-Key), provisioned from the operations console and revocable per bin.

const { verifyDeviceKey } = require('../lib/binQr');

const BIN_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const WEIGHT_MATCH_WINDOW_MS = 2 * 60 * 1000;

module.exports = function deviceRoutes(ctx) {
    const { app, supabase, store, config, fail, limiters } = ctx;

    async function authenticateBin(req, res, next) {
        const binId = String(req.get('x-bin-id') || '');
        const key = String(req.get('x-device-key') || '');
        if (!config.QR_SECRET) return fail(res, 503, 'Bin verification is not configured on the server.');
        if (!BIN_ID_RE.test(binId) || !key) return fail(res, 401, 'Unknown device.');
        const { data: bin, error } = await supabase.from('bins')
            .select('id, name, status, stream, qr_mode, device_key_version, fill_source').eq('id', binId).maybeSingle();
        if (error) throw error;
        if (!bin || !verifyDeviceKey(config.QR_SECRET, bin.id, Number(bin.device_key_version || 1), key)) {
            return fail(res, 401, 'Unknown device.');
        }
        req.bin = bin;
        next();
    }

    // The bin's screen calls this on start-up and every few minutes: confirms its key is valid and
    // syncs its clock with the server, so its rotating codes match what the server expects.
    app.get('/api/device/hello', limiters.device, authenticateBin, async (req, res) => {
        await supabase.from('bins').update({ last_seen_at: new Date().toISOString() }).eq('id', req.bin.id);
        res.json({
            status: 'ok',
            serverTime: Date.now(),
            period: config.DYNAMIC_QR_PERIOD_S,
            keyVersion: Number(req.bin.device_key_version || 1),
            bin: { id: req.bin.id, name: req.bin.name, status: req.bin.status, stream: req.bin.stream || 'station', qrMode: req.bin.qr_mode },
        });
    });

    // Sensor readings.
    //   fillLevel:        0–100 from an ultrasonic / ToF sensor. >= 95 marks the bin Full; < 50 reopens it.
    //   depositWeightKg:  weight added by the last deposit (load cell). It is attached to the most recent
    //                     rewarded item at this bin from the last 2 minutes, so impact uses real weight.
    app.post('/api/device/telemetry', limiters.device, authenticateBin, async (req, res) => {
        const body = req.body || {};
        const nowIso = new Date().toISOString();
        const changes = { last_seen_at: nowIso };

        if (body.fillLevel !== undefined) {
            const level = Number(body.fillLevel);
            if (!Number.isFinite(level) || level < 0 || level > 100) return fail(res, 400, 'Invalid request');
            Object.assign(changes, { fill_level: Math.round(level * 10) / 10, fill_source: 'sensor', fill_updated_at: nowIso });
            if (level >= 95 && req.bin.status === 'Active') changes.status = 'Full';
            if (level < 50 && req.bin.status === 'Full') changes.status = 'Active';
        }

        let attached = null;
        if (body.depositWeightKg !== undefined) {
            const kg = Number(body.depositWeightKg);
            if (!Number.isFinite(kg) || kg <= 0 || kg > 20) return fail(res, 400, 'Invalid request');
            const { data: log, error } = await supabase.from('waste_logs')
                .select('id, user_id, waste_type, est_weight_kg')
                .eq('bin_id', String(req.bin.id)).eq('accepted', true).is('measured_weight_kg', null)
                .gte('created_at', new Date(Date.now() - WEIGHT_MATCH_WINDOW_MS).toISOString())
                .order('created_at', { ascending: false }).limit(1).maybeSingle();
            if (error) throw error;
            if (log) {
                const { error: updateError } = await supabase.from('waste_logs').update({ measured_weight_kg: kg }).eq('id', log.id).is('measured_weight_kg', null);
                if (updateError) throw updateError;
                attached = log.id;
                // Far heavier than the item could be (e.g. a brick declared as a bottle): flag for review.
                const expected = Number(log.est_weight_kg) || 0.05;
                if (kg > Math.max(expected * 10, 0.5)) {
                    store.recordFlag({ userId: log.user_id, binId: req.bin.id, kind: 'weight_mismatch', severity: 'low', details: { wasteType: log.waste_type, measuredKg: kg, expectedKg: expected } });
                }
            }
        }

        const { error } = await supabase.from('bins').update(changes).eq('id', req.bin.id);
        if (error) throw error;
        res.json({ status: 'ok', attachedLog: attached, binStatus: changes.status || req.bin.status });
    });
};
