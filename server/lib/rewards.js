// Server-side source of truth for rewards and redemptions.
// The client never decides amounts, costs or types — it only names what happened.

const REWARD_MAP = Object.freeze({
    'Plastic':           Object.freeze({ reward: 25, points: 125 }),
    'Metal':             Object.freeze({ reward: 30, points: 150 }),
    'Paper / Cardboard': Object.freeze({ reward: 10, points: 50 }),
    'Organic':           Object.freeze({ reward: 5,  points: 25 }),
    'Glass':             Object.freeze({ reward: 15, points: 75 }),
    'Other Trash':       Object.freeze({ reward: 8,  points: 40 }),
});

const REDEEM_CATALOG = Object.freeze({
    'Movie Voucher':  Object.freeze({ cost: 500, type: 'points' }),
    'Bus Pass':       Object.freeze({ cost: 200, type: 'points' }),
    'Metro Recharge': Object.freeze({ cost: 300, type: 'points' }),
    'Bank Transfer':  Object.freeze({ cost: 100, type: 'money' }),
});

const DAY_MS = 24 * 60 * 60 * 1000;

function lookup(table, key) {
    return typeof key === 'string' && Object.prototype.hasOwnProperty.call(table, key) ? table[key] : null;
}

function toNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
}

function reject(code, message) {
    return { reject: { code, message } };
}

// Decide what a waste deposit does to a profile. Pure function: no I/O.
function planWasteDeposit(user, { wasteType, binName, sessionId, now, cooldownMs, dailyLimit }) {
    const rule = lookup(REWARD_MAP, wasteType);
    if (!rule) return reject(400, 'Unknown waste type');

    const logs = Array.isArray(user.logs) ? user.logs : [];

    // One reward per verified bin scan (persisted in the log, so it survives restarts).
    if (logs.some(log => log && log.session === sessionId)) {
        return reject(409, 'This bin scan has already been used. Please scan the bin QR code again.');
    }

    const times = logs.map(log => Date.parse(log && log.date)).filter(Number.isFinite);
    const last = times.length ? Math.max(...times) : -Infinity;
    if (now - last < cooldownMs) {
        const wait = Math.ceil((cooldownMs - (now - last)) / 1000);
        return reject(429, `Please wait ${wait}s before depositing the next item.`);
    }

    const itemsLast24h = times.filter(t => t > now - DAY_MS).length;
    if (itemsLast24h >= dailyLimit) {
        return reject(429, 'Daily deposit limit reached. Please come back tomorrow.');
    }

    const newLog = {
        date: new Date(now).toISOString(),
        wasteType,
        weight: 0.5,
        amount: rule.reward,
        location: binName,
        session: sessionId,
    };

    return {
        changes: {
            walletBalance: toNumber(user.walletBalance) + rule.reward,
            ecoPoints: toNumber(user.ecoPoints) + rule.points,
            logs: [...logs, newLog],
        },
        result: { reward: rule.reward, points: rule.points },
    };
}

// Decide what a redemption does to a profile. Pure function: no I/O.
function planRedemption(user, { item, now }) {
    const entry = lookup(REDEEM_CATALOG, item);
    if (!entry) return reject(400, 'Unknown reward item');

    const wallet = toNumber(user.walletBalance);
    const points = toNumber(user.ecoPoints);
    const changes = {};

    if (entry.type === 'money') {
        if (wallet < entry.cost) return reject(400, 'Insufficient Funds');
        changes.walletBalance = wallet - entry.cost;
    } else {
        if (points < entry.cost) return reject(400, 'Insufficient Points');
        changes.ecoPoints = points - entry.cost;
    }

    const redemptions = Array.isArray(user.redemptions) ? user.redemptions : [];
    changes.redemptions = [
        ...redemptions,
        { date: new Date(now).toISOString(), item, cost: entry.cost, type: entry.type },
    ];

    return { changes, result: { item, cost: entry.cost, type: entry.type } };
}

module.exports = { REWARD_MAP, REDEEM_CATALOG, planWasteDeposit, planRedemption };
