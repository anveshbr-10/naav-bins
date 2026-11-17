// Race-safe balance updates for user_profiles.
//
// Uses optimistic concurrency (compare-and-swap): the UPDATE only applies if walletBalance and
// ecoPoints are still exactly what we read. If another request changed them in between, zero rows
// match, and we re-read and re-decide. This prevents double-spending and lost rewards without
// requiring any database migration.

function matchValue(query, column, value) {
    return value === null || value === undefined ? query.is(column, null) : query.eq(column, value);
}

function createProfileStore(supabase) {
    async function getProfile(email) {
        const { data, error } = await supabase
            .from('user_profiles')
            .select('*')
            .eq('email', email)
            .maybeSingle();
        if (error) throw error;
        return data;
    }

    // decide(user) -> { reject: { code, message } } | { changes, result }
    // Every accepted change MUST modify walletBalance or ecoPoints (that is what the CAS guards).
    async function atomicUpdate(email, decide, maxAttempts = 4) {
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            const user = await getProfile(email);
            if (!user) return { outcome: 'not_found' };

            const decision = decide(user);
            if (decision.reject) return { outcome: 'rejected', ...decision.reject };

            const { changes } = decision;
            const touchesBalance =
                ('walletBalance' in changes && changes.walletBalance !== user.walletBalance) ||
                ('ecoPoints' in changes && changes.ecoPoints !== user.ecoPoints);
            if (!touchesBalance) throw new Error('atomicUpdate: change must modify walletBalance or ecoPoints');

            let query = supabase.from('user_profiles').update(changes).eq('email', email);
            query = matchValue(query, 'walletBalance', user.walletBalance);
            query = matchValue(query, 'ecoPoints', user.ecoPoints);

            const { data, error } = await query.select('email');
            if (error) throw error;
            if (Array.isArray(data) && data.length === 1) {
                return { outcome: 'ok', result: decision.result };
            }
            // Someone else updated the row first — loop and retry with fresh data.
        }
        return { outcome: 'conflict' };
    }

    return { getProfile, atomicUpdate };
}

module.exports = { createProfileStore };
