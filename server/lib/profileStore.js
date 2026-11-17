// Access to public.user_profiles, keyed by the Supabase Auth user id.
//
// Balance changes use optimistic concurrency (compare-and-swap): the UPDATE only applies if
// walletBalance and ecoPoints are still exactly what we read. If another request changed them in
// between, zero rows match, and we re-read and re-decide. This prevents double-spending and lost
// rewards without database functions.

function matchValue(query, column, value) {
    return value === null || value === undefined ? query.is(column, null) : query.eq(column, value);
}

function createProfileStore(supabase) {
    async function getProfile(id) {
        const { data, error } = await supabase
            .from('user_profiles')
            .select('*')
            .eq('id', id)
            .maybeSingle();
        if (error) throw error;
        return data;
    }

    // The sign-up trigger normally creates the profile in the same transaction as the auth user.
    // This is a safety net (e.g. for accounts created before the trigger existed).
    // Returns null when the auth user no longer exists.
    async function ensureProfile({ id, email, name }) {
        const existing = await getProfile(id);
        if (existing) return existing;

        const { error } = await supabase.from('user_profiles').insert([{
            id,
            email,
            name: String(name || String(email || '').split('@')[0] || '').trim().slice(0, 60),
        }]);
        if (error && error.code === '23503') return null; // auth user deleted (foreign key)
        if (error && error.code !== '23505') throw error; // 23505: created concurrently — fine
        return getProfile(id);
    }

    // decide(user) -> { reject: { code, message } } | { changes, result, guardRedemptions? }
    // Every accepted change MUST modify walletBalance or ecoPoints (that is what the CAS guards),
    // unless it sets guardRedemptions: then the write also requires every redemption's status to be
    // unchanged (jsonb containment), which catches concurrent admin status changes.
    async function atomicUpdate(id, decide, maxAttempts = 4) {
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            const user = await getProfile(id);
            if (!user) return { outcome: 'not_found' };

            const decision = decide(user);
            if (decision.reject) return { outcome: 'rejected', ...decision.reject };

            const { changes } = decision;
            const touchesBalance =
                ('walletBalance' in changes && changes.walletBalance !== user.walletBalance) ||
                ('ecoPoints' in changes && changes.ecoPoints !== user.ecoPoints);
            if (!touchesBalance && !decision.guardRedemptions) {
                throw new Error('atomicUpdate: change must modify walletBalance or ecoPoints');
            }

            let query = supabase.from('user_profiles').update(changes).eq('id', id);
            query = matchValue(query, 'walletBalance', user.walletBalance);
            query = matchValue(query, 'ecoPoints', user.ecoPoints);
            if (decision.guardRedemptions) {
                const snapshot = (Array.isArray(user.redemptions) ? user.redemptions : [])
                    .filter(r => r && r.code)
                    .map(r => ({ code: r.code, status: r.status }));
                query = query.contains('redemptions', JSON.stringify(snapshot));
            }

            const { data, error } = await query.select('id');
            if (error) throw error;
            if (Array.isArray(data) && data.length === 1) {
                return { outcome: 'ok', result: decision.result };
            }
            // Someone else updated the row first — loop and retry with fresh data.
        }
        return { outcome: 'conflict' };
    }

    return { getProfile, ensureProfile, atomicUpdate };
}

module.exports = { createProfileStore };
