# Naav Bins

Naav Bins is a smart waste-segregation platform for campuses. People scan a QR code on a smart bin, show the item to their phone camera, and an AI model identifies the material (Plastic, Metal, Paper / Cardboard, Organic, Glass or Other Trash) and tells them which bin to use. Every correctly sorted item earns wallet money and Eco-Points that can be redeemed for vouchers or withdrawn to UPI.

## Architecture

```text
Browser (React + Vite, hosted on Vercel)
  │  sign-up / login / Google · Facebook · LinkedIn / email verification / password reset
  ├──────────────────────────────► Supabase Auth
  │
  │  API calls with "Authorization: Bearer <Supabase access token>"
  └──────────────────────────────► Express API (Render) ──► Supabase Postgres (secret key)
                                    verifies the token,       user_profiles, bins
                                    applies all business rules
```

- **One platform:** Supabase provides both authentication and the database.
- **Every login has exactly one profile:** `user_profiles.id` references `auth.users.id`. A database trigger creates the profile when someone signs up, and deleting a user deletes their profile (`on delete cascade`).
- **Roles live in one place:** `user_profiles.role` (`user` or `admin`), read fresh by the API on every admin request.
- **The browser cannot reach the data directly:** Row Level Security blocks it. Only the API, which uses the secret key, reads and writes profiles.
- **Rewards are decided on the server:** bin QR codes are signed, each scan is a short-lived single-use session, and there are cooldowns and daily limits. Balance changes are atomic.

## Features

- Email/password accounts with email verification and password reset
- Social sign-in with Google, Facebook and LinkedIn
- Signed bin QR codes, then AI identification (TensorFlow.js + Teachable Machine), then an instant reward
- Wallet and Eco-Points, vouchers with codes, UPI withdrawal requests
- Personal dashboard: earnings trend, waste mix, estimated CO₂ saved, redemption history
- Leaderboard; live map of bins with distance sorting, directions and status colours
- Admin portal: live stats, redemption queue (pay / reject / claim / cancel), user details, CSV export

## Project structure

```text
naav-bins/
├── .github/
│   ├── workflows/ci.yml        tests, lint, build and audit on every push / PR
│   └── dependabot.yml          weekly dependency update PRs
├── client/smartbin/            React app (Vite, Tailwind, installable PWA)
│   ├── src/
│   │   ├── supabase.js         Supabase client (publishable key) + auth helpers
│   │   ├── AuthProvider.jsx    session + profile/role for the whole app
│   │   ├── auth.jsx            sign-in / sign-up screen (incl. social buttons)
│   │   ├── authPages.jsx       auth callback, forgot password, reset password
│   │   ├── api.js              API client (adds the access token)
│   │   ├── layout.jsx          shared navbar, footer, phone bottom bar
│   │   ├── brand.jsx           product name and logo
│   │   └── …                   dashboard, scanner, map, leaderboard, admin, about
│   ├── public/                 logo, PWA manifest, service worker, app icons
│   ├── scripts/                generate-icons.mjs (rebuilds the PNG app icons)
│   └── vercel.json             single-page-app rewrites (deep links, email links)
└── server/                     Express API
    ├── index.js                routes + token verification
    ├── lib/                    rewards rules, signed QR codes, profile store
    ├── scripts/                generate-bin-qr.js (printable bin QR sheet)
    ├── test/                   unit tests for rewards, redemptions, QR signing, balance writes
    └── supabase/schema.sql     database schema, triggers and security
```

## Setup

### 1. Supabase

1. **Database:** open the SQL Editor and run [`server/supabase/schema.sql`](server/supabase/schema.sql).
   ⚠️ It deletes all existing profiles and auth users. The `bins` table is kept.
2. **Authentication → Sign In / Providers → Email:** enabled, with **Confirm email** on. Set the minimum password length to 8.
3. **Authentication → URL Configuration:**
   - Site URL: `https://naav-bins.vercel.app`
   - Redirect URLs: `https://naav-bins.vercel.app/**` and `http://localhost:5173/**`
4. **Social providers (optional):** in Authentication → Sign In / Providers, enable Google, Facebook and LinkedIn (OIDC). Paste each provider's client ID and secret, and register Supabase's callback URL with the provider: `https://<project-ref>.supabase.co/auth/v1/callback`. Buttons for providers that aren't enabled show a friendly message.
5. **Emails:** the built-in sender is rate-limited and meant for testing. For real use, add a custom SMTP sender under Authentication → Emails → SMTP Settings.

### 2. Backend (`server/`)

```bash
cd server
cp .env.example .env      # fill in SUPABASE_URL, SUPABASE_SECRET_KEY, JWT_SECRET, QR_SECRET, CORS_ORIGINS
npm ci
npm run dev               # restarts on file changes (node --watch); production: npm start
```

Requires Node.js 20. Set the same variables on Render.

### 3. Frontend (`client/smartbin/`)

```bash
cd client/smartbin
cp .env.example .env.local   # VITE_API_URL (and optionally the Supabase URL / publishable key)
npm ci
npm run dev                  # http://localhost:5173
```

## Tests and CI

```bash
cd server && npm test             # money logic: rewards, redemptions, refunds, double-spend, QR signatures
cd client/smartbin && npm test    # formatting helpers
cd client/smartbin && npm run lint && npm run build
```

Tests use Node's built-in test runner, so there is nothing extra to install. GitHub Actions runs all of the above, plus `npm audit` on production dependencies, for every push to `main` and every pull request. Keep the check green before merging.

## Repository hygiene

- Never commit `node_modules/`, `dist/`, `.env` files or generated QR sheets; `.gitignore` covers them. Commit only `.env.example` templates.
- Install with `npm ci` (exact versions from `package-lock.json`). Add packages inside `server/` or `client/smartbin/`, never at the repository root.
- `client/smartbin` overrides `node-fetch` to a patched 2.x release: it is only pulled in by the old TensorFlow version that Teachable Machine requires.

## Admin access

Register normally, confirm the email, then run this in the Supabase SQL Editor:

```sql
update public.user_profiles set role = 'admin' where email = 'naavhackers@gmail.com';
```

Sign out and back in to open the Admin portal.

## Bin QR codes

```bash
cd server
npm run generate:qr        # writes server/bin-qr-codes.html (print and stick on the bins)
```

Codes stay valid until `QR_SECRET` changes.

## API

| Method | Path | Access |
|---|---|---|
| GET | `/api/me` | signed in: id, email, name, role |
| GET | `/api/dashboard` | signed in: profile + impact |
| POST | `/api/scan/start` | signed in: verify bin QR, start scan session |
| POST | `/api/add-waste` | signed in: record an item (needs scan session) |
| POST | `/api/redeem` | signed in: voucher or UPI withdrawal request |
| GET | `/api/admin/users` | admin |
| POST | `/api/admin/redemptions/status` | admin |
| GET | `/api/bins`, `/api/leaderboard`, `/api/stats`, `/api/rewards/catalog` | public |

## License

This repository does not currently declare a license.
