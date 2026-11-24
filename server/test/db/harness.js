// Loads the real Supabase scripts into PGlite (Postgres compiled to WASM, in-process) so the
// money-moving SQL functions can be tested without a database server.
const fs = require('node:fs');
const path = require('node:path');

const SQL_DIR = path.join(__dirname, '..', '..', 'supabase');
const SCRIPTS = ['schema.sql', '002_operations.sql', '003_vendors.sql', '004_wallet_cashback.sql'];

// What Supabase provides and the scripts expect: the auth schema/users table and the API roles.
const SUPABASE_STUBS = `
create schema if not exists auth;
create table if not exists auth.users (
    id uuid primary key default gen_random_uuid(),
    email text,
    raw_user_meta_data jsonb default '{}'::jsonb,
    created_at timestamptz default now()
);
do $$ begin
    create role anon; exception when duplicate_object then null; end $$;
do $$ begin
    create role authenticated; exception when duplicate_object then null; end $$;
do $$ begin
    create role service_role; exception when duplicate_object then null; end $$;
`;

async function createDb() {
    const { PGlite } = await import('@electric-sql/pglite');
    const { pgcrypto } = await import('@electric-sql/pglite/contrib/pgcrypto');
    const db = await PGlite.create({ extensions: { pgcrypto } });
    await db.exec(SUPABASE_STUBS);
    // schema.sql assumes the bins table already exists (created in the dashboard originally);
    // 002_operations.sql defines it with "if not exists", so create it first from that definition.
    const ops = fs.readFileSync(path.join(SQL_DIR, '002_operations.sql'), 'utf8');
    const binsDdl = ops.match(/create table if not exists public\.bins \([\s\S]*?\n\);/);
    if (!binsDdl) throw new Error('bins definition not found in 002_operations.sql');
    await db.exec(binsDdl[0]);
    for (const f of SCRIPTS) {
        try {
            await db.exec(fs.readFileSync(path.join(SQL_DIR, f), 'utf8'));
        } catch (err) {
            err.message = `${f}: ${err.message}`;
            throw err;
        }
    }
    return db;
}

module.exports = { createDb, SCRIPTS };
