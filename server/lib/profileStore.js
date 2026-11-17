// Race-safe balance updates for user_profiles.
//
// Uses optimistic concurrency (compare-and-swap): the UPDATE only applies if walletBalance and
// ecoPoints are still exactly what we read. If another request changed them in between, zero rows
// match, and we re-read and re-decide. This prevents double-spending and lost rewards without
// requiring any database migration.

function matchValue(query, column, value) {
    return value === null || value === undefined ? query.is(column, null) : query.eq(column, value);
}

// A profile "holds nothing of value" when it has no money, no points and no history.
function isPristine(profile) {
    const n = v => Number(v) || 0;
    const empty = v => !Array.isArray(v) || v.length === 0;
    return n(profile.walletBalance) === 0 && n(profile.ecoPoints) === 0 && empty(profile.logs) && empty(profile.redemptions);
}

function createProfileStore(supabase) {
    // Creates the rewards profile for a newly registered login.
    // If a profile with this email already exists, its login was deleted earlier. Because emails are not
    // verified, an old profile is only reused when it is empty — one that still holds rewards is never
    // handed to whoever registers next (outcome 'blocked').
    async function createProfile({ email, name }) {
        const fresh = { walletBalance: 0, ecoPoints: 0, logs: [], redemptions: [], role: 'user' };
        const { error } = await supabase.from('user_profiles').insert([{ email, name, ...fresh }]);
        if (!error) return { outcome: 'created' };
        if (error.code !== '23505') throw error; // anything other than "this email already has a profile"

        const existing = await getProfile(email);
        if (!existing) throw error; // removed in the meantime — let the caller ask the user to retry
        if (!isPristine(existing)) return { outcome: 'blocked' };

        let query = supabase.from('user_profiles')
            .update({ name, ...fresh, createdAt: new Date().toISOString() })
            .eq('email', email);
        query = matchValue(query, 'walletBalance', existing.walletBalance);
        query = matchValue(query, 'ecoPoints', existing.ecoPoints);
        const { data, error: updateError } = await query.select('email');
        if (updateError) throw updateError;
        if (!Array.isArray(data) || data.length !== 1) throw new Error('Profile changed while being reused');
        return { outcome: 'reused' };
    }

    async function getProfile(email) {
        const { data, error } = await supabase
            .from('user_profiles')
            .select('*')
            .eq('email', email)
            .maybeSingle();
        if (error) throw error;
        return data;
    }

    // decide(user) -> { reject: { code, message } } | { changes, result, guardRedemptions? }
    // Every accepted change MUST modify walletBalance or ecoPoints (that is what the CAS guards),
    // unless it sets guardRedemptions: then the write also requires every redemption's status to be
    // unchanged (jsonb containment), which catches concurrent admin status changes.
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
            if (!touchesBalance && !decision.guardRedemptions) {
                throw new Error('atomicUpdate: change must modify walletBalance or ecoPoints');
            }

            let query = supabase.from('user_profiles').update(changes).eq('email', email);
            query = matchValue(query, 'walletBalance', user.walletBalance);
            query = matchValue(query, 'ecoPoints', user.ecoPoints);
            if (decision.guardRedemptions) {
                const snapshot = (Array.isArray(user.redemptions) ? user.redemptions : [])
                    .filter(r => r && r.code)
                    .map(r => ({ code: r.code, status: r.status }));
                query = query.contains('redemptions', JSON.stringify(snapshot));
            }

            const { data, error } = await query.select('email');
            if (error) throw error;
            if (Array.isArray(data) && data.length === 1) {
                return { outcome: 'ok', result: decision.result };
            }
            // Someone else updated the row first — loop and retry with fresh data.
        }
        return { outcome: 'conflict' };
    }

    return { getProfile, atomicUpdate, createProfile };
}

module.exports = { createProfileStore, isPristine };
