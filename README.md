# Naav Bins

Naav Bins is a smart waste-segregation platform for campuses in Bengaluru. People scan the QR code on a smart bin (printed, or a live rotating code on the bin's screen). They then show the item to their phone camera, and an AI model identifies the material (Plastic, Metal, Paper / Cardboard, Glass, Organic or Other Trash). The app tells them which BBMP stream (dry, wet or reject) and which bin the item belongs in. Every correctly sorted item earns wallet money and Eco-Points, which can be spent as canteen, stationery or print-centre credits or withdrawn to UPI. The whole app is available in English, ಕನ್ನಡ and हिन्दी.

## Architecture

```text
Browser (React + Vite, hosted on Vercel)          Bin hardware (optional)
  │  sign-up / login / social / password reset      screen: rotating QR (computed offline)
  ├──────────────────────────────► Supabase Auth     sensors: fill level, load cell
  │                                                    │  X-Bin-Id + X-Device-Key
  │  "Authorization: Bearer <access token>"           │
  └──────────────────────────────► Express API (Render) ◄──┘
                                    verifies tokens and device keys,
                                    applies every business rule
                                          │ secret key
                                          ▼
                                   Supabase Postgres
                                   user_profiles, bins, waste_logs, redemptions,
                                   reward_rules, reward_catalog, campus_groups,
                                   fraud_flags, bin_collections, challenge_claims
```

- **One platform:** Supabase provides both authentication and the database.
- **Every login has exactly one profile:** `user_profiles.id` references `auth.users.id`. A trigger creates the profile at sign-up, and deleting a user deletes their profile, logs and redemptions (`on delete cascade`).
- **Roles live in one place:** `user_profiles.role` is `user`, `vendor` (canteen or store counter staff) or `admin`. The API reads it fresh on every request.
- **The browser cannot reach the data directly:** Row Level Security blocks every table. Only the API, which uses the secret key, reads and writes them.
- **The reward table lives in the database:** `reward_rules` (reward, points, BBMP stream, weight and CO₂ factors per material) and `reward_catalog` (campus credits). The API reads them and the app fetches them from the API. Admins edit them in the console, with no deploy needed.
- **Money moves atomically:** each deposit, redemption, admin decision and challenge bonus runs in one Postgres transaction (`naav_apply_deposit`, `naav_apply_redemption`, `naav_set_redemption_status`, `naav_claim_challenge`). The balance update is a compare-and-swap, so concurrent requests cannot double-spend or slip past the cooldown.

## Features

**For students and staff**
- Scan → identify → earn, with BBMP segregation guidance (dry: blue bin, wet: green bin, reject/sanitary: red bin). An item scanned at a bin of the wrong stream earns nothing; the user is told which bin to use, and the attempt is recorded for contamination reports.
- Campus leagues: department vs department and hostel vs hostel (weekly and all-time, with points per member so small teams can compete), plus individual rankings.
- Daily streaks, 12 badges, and three weekly challenges (one fixed, two rotating every Monday IST) with claimable bonus points.
- Campus credits instead of external vouchers: canteen coupons, stationery credit and print credits, claimed at the counter with a one-time code. UPI withdrawal stays available.
- Live bin map with stream filters, fill level, status colours, distance sorting and directions.
- English, Kannada and Hindi throughout, including server error messages. The choice is remembered per device.

**Fraud controls (all enforced on the server)**

| Control | How it works |
|---|---|
| Signed QR codes | `NAAVBIN:v1:<binId>:<HMAC>`. Unknown or forged codes are rejected; a tampered Naav code raises a *high* fraud flag. |
| Dynamic QR | Bins in *live* mode show `NAAVBIN:v2:<binId>:<keyVersion>:<counter>:<HMAC>` on a screen. A new code appears every 30 s and is valid for ±1 period, so a photo or shared screenshot stops working within a minute. Each bin has its own device key, which can be revoked. Printed codes are refused at live bins. |
| Geofence | The phone's GPS fix must be within 50 m of the bin, plus up to 25 m for GPS error. Fixes worse than ±100 m are refused, and far-away scans are flagged. |
| Rate limits | 20 s cooldown per user per bin, and 30 items per user per 24 hours (configurable). Each bin scan rewards at most once. |
| Duplicate photos | The scanner uploads a 32×32 grayscale thumbnail. The server computes a 64-bit DCT perceptual hash and rejects captures within 6 bits of the user's photos from the last 30 days, or of anyone's photos at that bin in the last 24 hours. |
| Weight check | When the bin has a scale, an item far heavier than its material could weigh is flagged. |

**Operations console (admins)**
- Fleet map with heat layers for fill level, activity and contamination.
- Optimised collection route: bins at or above a fill threshold (or marked Full) in shortest visiting order (nearest-neighbour + 2-opt), with an "Open in Google Maps" link.
- Per bin: fill level (sensor, manual or estimated from items since last emptied), items and weight (measured vs estimated), automatic contamination rate (wrong-stream share), audited contamination from collections, open flags, and a "mark emptied" form that records weight and contamination.
- Bin settings (status, stream, capacity, zone, QR mode), bin-screen provisioning and key rotation.
- Fraud flags with dismiss / confirm / confirm-and-block. Blocked users cannot earn.
- Redemption queue (pay / reject / claim / cancel), users with impact and flags, CSV export, and giving counter staff the vendor role.
- Reward table and campus-credit catalogue editor.

**Voucher counter (vendors and admins):** `/counter`. Look up a code and mark it used; each code works once.

## Project structure

```text
naav-bins/
├── .github/workflows/ci.yml   tests, translation check, lint, build and audit on every push / PR
├── client/smartbin/           React app (Vite, Tailwind, installable PWA)
│   ├── src/
│   │   ├── i18n.js, I18nProvider.jsx   English / Kannada / Hindi
│   │   ├── locales/kn.json, hi.json    translations (kept in sync automatically, see below)
│   │   ├── waste.js            materials and BBMP streams (display only; rewards come from the API)
│   │   ├── scanner.jsx         QR → geofence → AI → deposit (sends a thumbnail for the photo check)
│   │   ├── dashboard.jsx, progress.jsx   wallet, streak, badges, challenges, campus credits
│   │   ├── leaderboard.jsx     campus leagues
│   │   ├── binMap.jsx          bin map with stream filters and fill levels
│   │   ├── binDisplay.jsx      the bin's screen: rotating QR code
│   │   ├── counter.jsx         voucher counter for canteen / store staff
│   │   └── admin/              operations console (fleet map, bins, flags, redemptions, users, rewards)
│   └── scripts/i18n-sync.mjs  extract strings, check and machine-translate translations
└── server/                    Express API
    ├── index.js               configuration, auth middleware, rate limits
    ├── routes/                public, user, admin (+ counter), device
    ├── lib/
    │   ├── rewards.js         deposit / redemption decisions (pure)
    │   ├── binQr.js           signed and rotating QR codes, device keys
    │   ├── geo.js             geofence, route optimisation
    │   ├── imageHash.js       perceptual hash
    │   ├── leagues.js         streaks, badges, challenges, standings
    │   ├── operations.js      fill levels, contamination, collection plan
    │   └── store.js           database access and transactional balance changes
    ├── scripts/generate-bin-qr.js   printable QR sheet (static bins)
    ├── supabase/schema.sql          base schema (accounts)
    ├── supabase/002_operations.sql  tables, functions and data migration for everything above
    └── test/                  unit tests
```

## Setup

### 1. Supabase

1. **Database:** in the SQL Editor run [`server/supabase/schema.sql`](server/supabase/schema.sql) (fresh installs only; ⚠️ it deletes all profiles and auth users), then run [`server/supabase/002_operations.sql`](server/supabase/002_operations.sql).
   **Existing deployments: run only `002_operations.sql`.** It is idempotent. It moves the JSON `logs` / `redemptions` from `user_profiles` into the new `waste_logs` / `redemptions` tables, then drops the JSON columns. Deploy the new API immediately after it, because the old API reads those columns.
2. **Authentication → Sign In / Providers → Email:** enabled, with **Confirm email** on. Minimum password length 8.
3. **Authentication → URL Configuration:** Site URL `https://naav-bins.vercel.app`; Redirect URLs `https://naav-bins.vercel.app/**` and `http://localhost:5173/**`.
4. **Social providers (optional):** enable Google, Facebook and LinkedIn (OIDC) and register `https://<project-ref>.supabase.co/auth/v1/callback` with each provider.
5. **Emails:** for real use, add a custom SMTP sender under Authentication → Emails → SMTP Settings.
6. **Campus data:** edit `campus_groups` (departments, hostels), `reward_catalog` (credits and where they are claimed) and the bins' `stream`, `lat`, `lng` and `capacity_items` to match your campus.

### 2. Backend (`server/`)

```bash
cd server
cp .env.example .env      # SUPABASE_URL, SUPABASE_SECRET_KEY, JWT_SECRET, QR_SECRET, CORS_ORIGINS (+ optional tuning)
npm ci
npm run dev               # restarts on file changes; production: npm start
```

Requires Node.js 20. Set the same variables on Render. [`server/.env.example`](server/.env.example) documents every setting: geofence radius, cooldown, daily cap, photo-hash threshold, QR period and route depot.

### 3. Frontend (`client/smartbin/`)

```bash
cd client/smartbin
cp .env.example .env.local   # VITE_API_URL (and optionally the Supabase URL / publishable key)
npm ci
npm run dev                  # http://localhost:5173
```

## Languages (English, ಕನ್ನಡ, हिन्दी)

English text is the translation key. Components call `t('Scan a bin')`, constant tables wrap strings in `tk('…')`, and placeholders look like `t('Hello, {name}!', { name })`. Database content (campus credits, departments, hostels) carries its own `labels` column with Kannada and Hindi.

Translations stay in step with the UI automatically:

- `npm run dev` and `npm run build` first run `scripts/i18n-sync.mjs`. It extracts every string from the app and every error template from the API, adds new keys and removes unused ones.
- While the dev server runs, saving a source file re-runs the sync.
- If `GOOGLE_TRANSLATE_API_KEY` or `LIBRETRANSLATE_URL` is set, new strings are machine-translated into Kannada and Hindi. Placeholders and product terms are protected, and nothing a person has edited is overwritten. Review the results in `src/locales/*.json`.
- `npm run i18n:check` and the test suite fail if any string lacks a Kannada or Hindi translation, or a translation changes a `{placeholder}`. CI runs both, so the UI cannot change without its translations.
- At runtime a string that is not translated yet falls back to English, so the UI never breaks.

## Bin hardware (optional)

Each bin has a device key derived from `QR_SECRET` and the bin's `device_key_version`. Get it from the console (**Bins → Bin screen setup**), and use **Replace key** if a screen is lost.

**Screen (rotating QR):** open the setup link on a tablet or kiosk browser mounted on the bin: `/bin-display#bin=<id>&v=<version>&key=<deviceKey>`. The key stays in the URL fragment and is never sent to a server. The page computes codes offline and syncs its clock with `/api/device/hello` when it can. Once the screen works, switch the bin's QR mode to *Live rotating QR*. To reproduce the codes on a microcontroller, compute `base64url(HMAC-SHA256(deviceKey, "v2:<binId>:<v>:<floor(unix/30)>"))[0..22]`.

**Sensors:**

```bash
# Fill level from an ultrasonic / ToF sensor (>= 95 marks the bin Full, < 50 reopens it)
curl -X POST https://<api>/api/device/telemetry -H "Content-Type: application/json" \
  -H "X-Bin-Id: bin_01" -H "X-Device-Key: <deviceKey>" -d '{"fillLevel": 72}'

# Weight of the item just deposited (load cell): attached to the latest rewarded item at this bin
curl -X POST https://<api>/api/device/telemetry -H "Content-Type: application/json" \
  -H "X-Bin-Id: bin_01" -H "X-Device-Key: <deviceKey>" -d '{"depositWeightKg": 0.031}'
```

Measured weights replace the per-material estimates in every impact figure. Bins without sensors get a fill estimate from items deposited since they were last emptied.

## Tests and CI

```bash
cd server && npm test                    # rewards, QR signing (static + rotating), geofence, routing, photo hash,
                                         # leagues, fleet metrics, transactional balance writes
cd client/smartbin && npm run i18n:check # translations complete
cd client/smartbin && npm test           # formatting + translation coverage
cd client/smartbin && npm run lint && npm run build
```

GitHub Actions runs all of the above, plus `npm audit` on production dependencies, on every push to `main` and every pull request.

## Repository hygiene

- Never commit `node_modules/`, `dist/`, `.env` files or generated QR sheets. Commit only `.env.example` templates.
- Install with `npm ci`. Add packages inside `server/` or `client/smartbin/`, never at the repository root.
- `client/smartbin` overrides `node-fetch` to a patched 2.x release (pulled in only by the TensorFlow version Teachable Machine needs).

## Roles

Register normally, confirm the email, then in the Supabase SQL Editor:

```sql
update public.user_profiles set role = 'admin' where email = 'naavhackers@gmail.com';
```

Sign out and back in to open the operations console. Admins give canteen or store staff the `vendor` role from **Users → Give counter access**. Vendors only see the voucher counter.

## Bin QR codes (printed)

```bash
cd server
npm run generate:qr        # writes server/bin-qr-codes.html for bins in static mode
```

Codes stay valid until `QR_SECRET` changes. Bins in live mode get a "Live QR on screen" card instead.

## API

| Method | Path | Access |
|---|---|---|
| GET | `/api/me` | signed in: id, email, name, role, department, hostel |
| POST | `/api/me/profile` | signed in: name, department, hostel |
| GET | `/api/dashboard` | signed in: balances, recent logs, redemptions, impact, streak, badges, challenges, rank |
| POST | `/api/challenges/claim` | signed in: weekly challenge bonus (once) |
| POST | `/api/scan/start` | signed in: verify QR (signed / rotating) + geofence, start scan session |
| POST | `/api/add-waste` | signed in: record an item (scan session + thumbnail) |
| POST | `/api/redeem` | signed in: campus credit or UPI withdrawal |
| GET | `/api/counter/voucher/:code`, POST `/api/counter/voucher/:code/claim` | vendor, admin |
| GET | `/api/admin/overview`, `/api/admin/ops`, `/api/admin/ops/route` | admin |
| GET/POST | `/api/admin/bins/:id`, `/:id/empty`, `/:id/collections`, `/:id/device`, `/:id/rotate-key` | admin |
| GET/POST | `/api/admin/flags`, `/api/admin/flags/:id/resolve` | admin |
| GET/POST | `/api/admin/users`, `/api/admin/users/:id`, `/:id/block`, `/:id/role` | admin |
| GET/POST | `/api/admin/redemptions`, `/api/admin/redemptions/status` | admin |
| GET/POST | `/api/admin/rewards`, `/api/admin/rewards/rule`, `/api/admin/rewards/item` | admin |
| GET | `/api/device/hello`, POST `/api/device/telemetry` | bin device key |
| GET | `/api/bins`, `/api/leaderboard`, `/api/leagues`, `/api/campus-groups`, `/api/stats`, `/api/rewards/catalog` | public |

Errors return `{ error, message, i18n: { key, params } }`, so the app can show them in the user's language.

## License

This repository does not currently declare a license.
