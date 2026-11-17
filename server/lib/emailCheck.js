// Registration email check: catches addresses that can never receive the confirmation link.
//
// No service can prove a mailbox exists without sending to it (mail servers hide that to stop
// spammers), so this checks everything short of that:
//   1. format          – one @, a sensible local part, a dotted domain
//   2. typo            – gmial.com, gmail.co, yaho.com … → suggests the intended domain
//   3. disposable      – throwaway inbox services (mailinator, 10minutemail, …)
//   4. domain receives – the domain publishes mail servers (DNS MX, or an A record as the fallback)
// The confirmation link then proves the mailbox itself. If DNS is unreachable the address is
// allowed, so an outage never blocks sign-ups.

const dns = require('dns').promises;

const EMAIL_RE = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@([A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+)$/;

const COMMON_DOMAINS = [
    'gmail.com', 'yahoo.com', 'yahoo.co.in', 'outlook.com', 'hotmail.com', 'live.com', 'icloud.com',
    'rediffmail.com', 'protonmail.com', 'proton.me', 'zoho.com', 'aol.com',
];

const DISPOSABLE = new Set([
    'mailinator.com', '10minutemail.com', '10minutemail.net', 'guerrillamail.com', 'guerrillamail.net',
    'guerrillamailblock.com', 'sharklasers.com', 'grr.la', 'yopmail.com', 'yopmail.net', 'tempmail.com',
    'temp-mail.org', 'temp-mail.io', 'tempmail.net', 'tempmailo.com', 'throwawaymail.com', 'trashmail.com',
    'trashmail.net', 'getnada.com', 'nada.email', 'dispostable.com', 'maildrop.cc', 'mintemail.com',
    'mohmal.com', 'fakeinbox.com', 'emailondeck.com', 'mailnesia.com', 'mytemp.email', 'tempinbox.com',
    'spamgourmet.com', 'mailcatch.com', 'burnermail.io', 'moakt.com', 'tmail.ws', 'tmpmail.org',
    'tmpmail.net', 'emailfake.com', 'fakemail.net', 'mailpoof.com', 'inboxkitten.com', 'discard.email',
    'example.com', 'example.org', 'example.net', 'test.com',
]);

// Edit distance, for "did you mean gmail.com?".
function distance(a, b) {
    const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) dp[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
            dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        }
    }
    return dp[a.length][b.length];
}

function suggestDomain(domain) {
    if (COMMON_DOMAINS.includes(domain)) return null;
    let best = null;
    for (const d of COMMON_DOMAINS) {
        const dist = distance(domain, d);
        if (dist > 0 && dist <= 2 && (!best || dist < best.dist)) best = { domain: d, dist };
    }
    return best ? best.domain : null;
}

function withTimeout(promise, ms) {
    return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error('timeout'), { code: 'ETIMEOUT' })), ms))]);
}

const NO_DOMAIN = new Set(['ENOTFOUND', 'ENODATA', 'NXDOMAIN']);

// Does the domain accept mail? true / false, or null when DNS could not answer.
async function domainReceivesMail(domain, resolver = dns, timeoutMs = 4000) {
    try {
        const mx = await withTimeout(resolver.resolveMx(domain), timeoutMs);
        if (mx.some(r => r.exchange && r.exchange !== '.')) return true;
        return false; // "null MX": the domain explicitly accepts no mail
    } catch (err) {
        if (!NO_DOMAIN.has(err.code)) return null;
    }
    try {
        const a = await withTimeout(resolver.resolve4(domain), timeoutMs);
        return a.length > 0;
    } catch (err) {
        return NO_DOMAIN.has(err.code) ? false : null;
    }
}

const cache = new Map(); // domain → { ok, at }
const CACHE_MS = 6 * 60 * 60 * 1000;

// Returns { ok: true } or { ok: false, reason: 'format'|'typo'|'disposable'|'no_mail', suggestion? }.
async function checkEmail(raw, { resolver, nowMs = Date.now() } = {}) {
    const email = String(raw || '').trim().toLowerCase();
    const m = email.length <= 254 ? EMAIL_RE.exec(email) : null;
    if (!m || email.includes('..')) return { ok: false, reason: 'format' };
    const domain = m[1];
    const local = email.slice(0, email.indexOf('@'));

    const suggestion = suggestDomain(domain);
    if (suggestion) return { ok: false, reason: 'typo', suggestion: `${local}@${suggestion}` };
    if (DISPOSABLE.has(domain)) return { ok: false, reason: 'disposable' };
    if (COMMON_DOMAINS.includes(domain)) return { ok: true };

    const hit = cache.get(domain);
    let receives = hit && nowMs - hit.at < CACHE_MS ? hit.ok : undefined;
    if (receives === undefined) {
        receives = await domainReceivesMail(domain, resolver);
        if (receives !== null) cache.set(domain, { ok: receives, at: nowMs });
    }
    return receives === false ? { ok: false, reason: 'no_mail' } : { ok: true };
}

module.exports = { checkEmail, suggestDomain, domainReceivesMail };
