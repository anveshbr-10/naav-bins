# Naav Bins

Naav Bins is a smart waste-segregation platform for campuses in Bengaluru. People scan the QR code on a smart bin (printed, or a live rotating code on the bin's screen). They then show the item to their phone camera, and an AI model identifies the material (Plastic, Metal, Paper / Cardboard, Glass, Organic or Other Trash). The app tells them which BBMP stream (dry, wet or reject) and which bin the item belongs in. Every correctly sorted item earns Eco-Points (like coins in a UPI app). Students redeem them into ₹ in their **campus wallet** (10 points = ₹1) and spend any exact amount (₹2 for a photocopy, ₹70 for a record book) at the campus canteen, snack stall, stationery store or print centre by showing a one-time QR code. Part of each reward is paid at once and the rest builds a bonus that unlocks at milestones, with a random multiplier on top. The whole app is available in English, ಕನ್ನಡ and हिन्दी.

**Live app:** [naav-bins.vercel.app](https://naav-bins.vercel.app) · API hosted on Render · database and auth on Supabase.

## Why Naav Bins

Most campus waste ends up mixed, even though BBMP rules require dry, wet and reject waste to be separated at source. Mixed bins are hard to recycle, collection crews have no idea which bins are full, and students get no feedback or reason to sort correctly. Naav Bins tackles all three:

- **Guidance at the moment of disposal:** the phone identifies the item and names the right stream and bin.
- **A reason to care:** every correct item earns money and points, and campus leagues turn sorting into a friendly competition between departments and hostels.
- **Data for the people who run the bins:** fill levels, contamination rates and an optimised collection route, so crews empty the bins that need it instead of following a fixed round.
- **Trustworthy rewards:** signed and rotating QR codes, a geofence, rate limits and duplicate-photo detection stop people farming money without sorting anything.

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 19, Vite 7, Tailwind CSS 3, React Router 7, installable PWA with light and dark themes |
| AI | Teachable Machine image model (TensorFlow.js), running entirely on the phone |
| Maps and charts | Leaflet (bin map, fleet map, collection route), Recharts (dashboards) |
| QR | `qrcode` (bin screens and printed sheets), camera QR scanning in the browser |
| Backend | Node.js 20, Express 5 |
| Database and auth | Supabase Postgres (Row Level Security, transactional SQL functions) and Supabase Auth (email, Google, Facebook, LinkedIn) |
| Hosting | Vercel (frontend), Render (API), Supabase (data) |
| Quality | Node test runner, ESLint, translation coverage checks, GitHub Actions CI |

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
                                   user_profiles, bins, waste_logs, vendor_payments,
                                   reward_rules, reward_program, campus_groups,
                                   fraud_flags, bin_collections, challenge_claims
```

- **One platform:** Supabase provides both authentication and the database.
- **Every login has exactly one profile:** `user_profiles.id` references `auth.users.id`. A trigger creates the profile at sign-up, and deleting a user deletes their profile, logs and payments (`on delete cascade`).
- **Roles live in one place:** `user_profiles.role` is `user`, `vendor` (counter staff) or `admin`. A `vendor` account also carries `vendor_id`, the one campus counter it works at (a database constraint makes the two go together). The API reads both fresh on every request.
- **The browser cannot reach the data directly:** Row Level Security blocks every table. Only the API, which uses the secret key, reads and writes them.
- **The reward table lives in the database:** `reward_rules` (points, BBMP stream, weight and CO₂ factors per material) and `reward_program` (the campus wallet and cashback settings). The API reads them and the app fetches them from the API. Admins edit them in the console, with no deploy needed.
- **Money moves atomically:** each deposit, conversion, payment, refund and challenge bonus runs in one Postgres transaction (`naav_apply_deposit_v2`, `naav_convert_points`, `naav_create_payment`, `naav_confirm_payment`, `naav_refund_payment`, `naav_claim_challenge`). The balance update is a compare-and-swap, so concurrent requests cannot double-spend or slip past the cooldown.

## How a deposit works

1. **Scan the bin.** The user scans the bin's QR code. The API checks the signature (or the rotating code for live bins), confirms the bin is Active, and checks the phone's GPS fix is within the geofence. It then issues a short-lived scan session.
2. **Show the item.** The camera feeds the on-device AI model, which names the material. Nothing but a 32×32 grayscale thumbnail leaves the phone.
3. **Get guidance.** The app shows the BBMP stream and bin colour. If the bin is for a different stream, the user is told where to go and nothing is rewarded.
4. **Earn.** The API re-checks every rule (session, cooldown, daily cap, duplicate photo, blocked user) and records the item in one transaction. 60% of the item's points are credited straight away. The other 40% join the pending bonus, which is released at items 5, 10 and 20 of each cycle with a random 1.0–1.3× multiplier (see [Delayed cashback](#delayed-cashback)). Streaks, badges and league standings count the item's full points straight away.
5. **Redeem and spend.** The student redeems Eco-Points into ₹ in the campus wallet. At a campus counter they enter the exact amount, show the one-time QR code, and the counter confirms it. Only that amount is deducted (see [Campus wallet](#campus-wallet)).

## Features

**For students and staff**
- Scan → identify → earn, with BBMP segregation guidance (dry: blue bin, wet: green bin, reject/sanitary: red bin). An item scanned at a bin of the wrong stream earns nothing; the user is told which bin to use, and the attempt is recorded for contamination reports.
- Campus leagues: department vs department and hostel vs hostel (weekly and all-time, with points per member so small teams can compete), plus individual rankings.
- Daily streaks, 12 badges, and three weekly challenges (one fixed, two rotating every Monday IST) with claimable bonus points.
- **Campus wallet:** redeem Eco-Points into ₹, then spend any exact amount at campus counters with a one-time QR code (no withdrawals). Includes ₹ and points transaction history.
- **Delayed cashback:** a visible "bonus on the way" with progress to the next milestone, a random multiplier when it unlocks, and an expiry date if the student stops recycling.
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
- Users with impact, campus-wallet payments and flags, CSV export, and giving counter staff access to one specific counter.
- **Vendors** tab: add, edit or switch off campus counters, set each counter's payment limits, see its staff and settlement (payments and ₹ owed to the vendor) with CSV export.
- Reward table and campus wallet / cashback settings editor.
- One-click fill marking per bin: **Partly full** (60%, stays open), **Full** (100%, closed to deposits and added to the route) and **Emptied** (resets to 0% and records the collection). See [Bin fill levels and status](#bin-fill-levels-and-status).

**Sign-up email check**
- Before Supabase sends a confirmation link, the API checks the address: valid format, common typos (`gmial.com` → offers `gmail.com`), throwaway inbox services (Mailinator, 10-minute mail, …) and whether the domain can receive mail at all (DNS MX lookup). Dummy addresses are refused, so no link is wasted on them. No service can confirm a mailbox exists without emailing it, so the confirmation link remains the final proof. If the check cannot run (server asleep, DNS down), sign-up continues.
- "Resend link" has a 60-second countdown, so repeated taps cannot exhaust the email limit.

**Navigation and sessions**
- Every page (except the landing page and the bin kiosk screen) has an in-app **Back** button. It returns to the previous page on the site or, if there is none, to the visitor's home page (dashboard, operations console or counter), so nobody depends on the browser's own back control.
- **Log out** clears the pages visited in that tab: the browser's Back then leaves the site instead of reopening the dashboard or console. Protected pages always redirect to login once the session is gone.

**Campus counters (vendors)**

Each counter on campus is a record in the `vendors` table. Four are created by default: **Utsav Cafe Canteen**, **MTR Snacks Stall**, **College Stationery** and **College Xerox & Print**. Students pay at a counter from their campus wallet, and each payment belongs to exactly one counter.

| Rule (enforced by the API and the database) | Effect |
|---|---|
| Staff belong to exactly one counter | `role = 'vendor'` requires `vendor_id`, and other roles cannot have one |
| Staff only see their own counter's payments | A canteen payment code typed at the print centre is refused with "This payment is for Utsav Cafe Canteen, not this counter." |
| Each code works once | Row lock and status guard in `naav_confirm_payment` |
| Payment limits per counter | Default ₹500 per payment and ₹20,000 per IST day, editable per counter; limits damage from a misused staff login |
| Switching a counter off | Its staff are locked out at once, and students can no longer choose it to pay |
| Admins | Can act at any counter |

**Counter page:** `/counter` shows the counter's name and location, a large **Scan the student's QR** button (live camera, or **Scan from photo** where the live camera is blocked, e.g. on a non-HTTPS address), a typed-code lookup, and today's payments against the daily limit.

## Campus wallet

It works like coins in a UPI app:

1. **Eco-Points (coins):** earned by recycling, shown large on the dashboard with their ₹ value.
2. **Redeem to wallet:** the student converts any whole number of rupees' worth of points into ₹ in the campus wallet (`walletBalance`) at `points_per_rupee` points (default 10) = ₹1. `naav_convert_points` takes the points and adds the ₹ in one statement (`POST /api/wallet/convert`).
3. **Spend:** the ₹ wallet pays only at campus counters (the `vendors` table). It cannot be withdrawn: there is no withdrawal.

**Paying any amount** (no more fixed ₹20 or ₹50 vouchers, so no leftover value is lost):

1. **Student:** taps **Pay at a counter**, chooses the counter (for example College Xerox & Print), enters the amount (₹2), and taps **Get payment code**.
2. **App:** shows a QR code (`NAAVPAY:NP-XXXX-XXXX`) and the code itself. It is valid for **3 minutes**, tied to that counter and amount. Starting a new code cancels the previous one.
3. **Counter staff:** scan the QR with `/counter` (or type the code), see "₹2 from Ravi", and tap **Confirm ₹2 received**.
4. **Database:** `naav_confirm_payment` locks the row and checks the counter, the expiry, the counter's daily ₹ limit and the student's balance. It then deducts exactly ₹2 from the ₹ wallet, all in one transaction. The student's screen shows "Paid ₹2" within 3 seconds.

| Rule | Where it is enforced |
|---|---|
| Only the student can start a payment; counters can only confirm | The API: there is no endpoint for a counter to pull money |
| One use per code, and only at the named counter | `naav_confirm_payment` (row lock and status check) |
| Codes expire after 3 minutes | Checked when the code is created and when it is confirmed |
| Per-payment maximum (default ₹500) and per-counter daily limit (default ₹20,000) | `vendors.max_txn_inr` and `daily_limit_inr`, editable in the **Vendors** tab |
| Refunds by admins only, once, within 7 days, with a reason | `naav_refund_payment`, from the **Payments** tab (the reason and admin are stored on the payment) |
| Every point change is recorded | A trigger on `user_profiles."ecoPoints"` writes to `points_ledger` (deposit, bonus, challenge, convert, adjustment) |
| Only one payment code is live | `naav_create_payment` cancels the open code and creates the new one in one transaction |
| Every ₹ change is recorded | A trigger on `user_profiles."walletBalance"` writes to `wallet_ledger` (convert, payment, refund) |

- **No fixed vouchers:** exact-amount payments replaced them, and the voucher tables are removed.
- **No withdrawals:** the ₹ wallet can only be spent on campus.
- **Settlement:** the **Vendors** tab shows each counter's payments in ₹, so the college knows what it owes each shop.

## Delayed cashback

Engagement works like UPI cashback, except the student is always paid **in full**:

| Setting (`reward_program`, edited in **Rewards → Campus wallet & cashback**) | Default |
|---|---|
| Share of each item's points paid at once | 60% |
| Milestones (items in a cycle) | 5, 10, 20; a new cycle starts after the last one |
| Random multiplier on the released bonus | ×1.0 to ×1.3 |
| Daily budget for the extra multiplier points (all students together) | 5,000 points |
| Pending bonus expires after this many days without recycling | 30 |
| Items earn points only (no ₹) | always on (locked; ₹ comes only from redeeming points) |

**Example:** a plastic bottle is worth 125 points. 75 are paid now and 50 go to the pending bonus. At the 5th item, the whole pending bonus (say 250 points) is released. With a ×1.15 multiplier the student also gets 37 extra points. The dashboard always shows the pending amount, the items left until the next milestone, and the expiry date.

- **Rate changes:** changing points per ₹1 changes what every student's unredeemed points are worth, so the console asks for confirmation (the API refuses it without `confirmRateChange: true`). Every programme change is kept in `reward_program_history` (who, when, old and new values) and the last 20 are shown under the settings.
- **Honesty:** only the *extra* is random or limited by the budget. The promised points are always paid at the milestone, and if an admin switches cashback off, everything still pending is paid with the next item.
- **Expiry:** the pending bonus expires after 30 days without a deposit (recorded in `bonus_releases`).
- **Atomic:** `naav_apply_deposit_v2` writes the item, the instant points, the pending bonus and the cycle position in one compare-and-swap transaction.

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
│   │   ├── counter.jsx         counter page: scan or type payment codes (NP-), today's totals
│   │   ├── payModal.jsx        pay any amount at a counter: one-time QR, countdown, live confirmation
│   │   ├── walletHistory.jsx   wallet ₹ and Eco-Points transactions (ledgers)
│   │   ├── convertModal.jsx    redeem Eco-Points into ₹
│   │   ├── layout.jsx          shared page frame: navbar, bottom bar, footer
│   │   ├── nav.jsx, logout.js  in-app Back button; logout that clears the tab's history
│   │   └── admin/              operations console (fleet map, bins, flags, users, vendors, payments, rewards + cashback settings)
│   │       └── fill.js         fill-level colour bands shared by the bins table and fleet map
│   └── scripts/i18n-sync.mjs  extract strings, check and machine-translate translations
└── server/                    Express API
    ├── index.js               configuration, auth middleware, rate limits
    ├── routes/                public, user, admin (+ counter), device
    ├── lib/
    │   ├── rewards.js         deposit decisions and impact (pure)
    │   ├── binQr.js           signed and rotating QR codes, device keys
    │   ├── emailCheck.js      sign-up email check (format, typos, disposable, MX)
    │   ├── geo.js             geofence, route optimisation
    │   ├── imageHash.js       perceptual hash
    │   ├── leagues.js         streaks, badges, challenges, standings
    │   ├── operations.js      fill levels, contamination, collection plan
    │   ├── vendors.js         counter access, vendor input, settlement
    │   ├── payments.js        campus wallet: payment codes, amounts, expiry, counter ownership
    │   ├── cashback.js        delayed cashback: instant / pending split, milestones, multiplier, expiry
    │   └── store.js           database access and transactional balance changes
    ├── scripts/generate-bin-qr.js   printable QR sheet (static bins)
    ├── supabase/schema.sql          base schema (accounts)
    ├── supabase/002_operations.sql  tables, functions and data migration for everything above
    ├── supabase/003_vendors.sql     campus counters (vendors), staff ↔ counter link
    ├── supabase/004_wallet_cashback.sql  campus wallet, payments, points ledger, reward programme, delayed cashback
    └── test/                  unit tests; test/db/ runs the SQL scripts in PGlite
```

## Setup

### 1. Supabase

1. **Database:** in the SQL Editor run [`server/supabase/schema.sql`](server/supabase/schema.sql) (fresh installs only; ⚠️ it deletes all profiles and auth users), then run [`server/supabase/002_operations.sql`](server/supabase/002_operations.sql).
   **Existing deployments: run only `002_operations.sql`.** It is idempotent. It moves the JSON `logs` / `redemptions` from `user_profiles` into the new `waste_logs` / `redemptions` tables, then drops the JSON columns. Deploy the new API immediately after it, because the old API reads those columns.

   Then run [`server/supabase/003_vendors.sql`](server/supabase/003_vendors.sql) (all installs, idempotent). It creates the campus counters and links counter staff to them. ⚠️ Old `vendor` accounts that are not linked to a counter are moved back to `user`: give them access again from **Users → (user) → Give counter access**. Deploy the new API right after it.

   Then run [`server/supabase/004_wallet_cashback.sql`](server/supabase/004_wallet_cashback.sql) (all installs, idempotent). It adds the campus wallet (payments, points ledger), the reward programme and delayed cashback. It also locks deposits to points only and removes the old fixed vouchers and UPI withdrawals (the `reward_catalog` and `redemptions` tables and their functions). **The API requires this script:** run it before deploying, and re-run it after updating (it is idempotent).
2. **Authentication → Sign In / Providers → Email:** enabled, with **Confirm email** on. Minimum password length 8.
3. **Authentication → URL Configuration:** Site URL `https://naav-bins.vercel.app`; Redirect URLs `https://naav-bins.vercel.app/**` and `http://localhost:5173/**`.
4. **Social providers (optional):** enable Google, Facebook and LinkedIn (OIDC) and register `https://<project-ref>.supabase.co/auth/v1/callback` with each provider.
5. **Emails and rate limits:** Supabase's built-in email sender allows only a handful of auth emails per hour **for the whole project**, which causes "too many emails were sent" errors after a few sign-ups. To lift it:
   1. Authentication → Emails → **SMTP Settings**: enable custom SMTP. A free option is Gmail (host `smtp.gmail.com`, port `465`, your Gmail address as username, a [Google app password](https://myaccount.google.com/apppasswords) as password); Brevo or Resend also have free tiers.
   2. Authentication → **Rate Limits**: raise *Rate limit for sending emails* (e.g. 30 per hour). This field is locked until custom SMTP is on.
   3. Authentication → Providers → Email: keep the minimum interval between emails to the same address at **60 seconds**. The app shows a matching 60 s countdown on its "Resend link" button.
6. **Campus data:** edit `campus_groups` (departments, hostels), `vendors` (campus counters) and the bins' `stream`, `lat`, `lng` and `capacity_items` to match your campus.

### 2. Backend (`server/`)

```bash
cd server
cp .env.example .env      # SUPABASE_URL, SUPABASE_SECRET_KEY, JWT_SECRET, QR_SECRET, CORS_ORIGINS (+ optional tuning)
npm ci
npm run dev               # restarts on file changes; production: npm start
```

Requires Node.js 20. Set the same variables on Render. [`server/.env.example`](server/.env.example) documents every setting: geofence radius, cooldown, daily cap, photo-hash threshold, QR period and route depot. The points-to-rupee rate and the cashback settings live in the database (`reward_program`) and are edited in the console.

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

## Bin fill levels and status

Each bin has a **status** (Active, Full or Inactive) and a **fill level** (0–100%). They are kept consistent everywhere: the bins table, the fleet map, the public bin map and the collection route.

**Where the fill level comes from**, highest priority first:

| Source | Rule |
|---|---|
| Status Full | A bin marked Full always reports 100%. |
| Sensor | A sensor reading from the last 6 hours. |
| Manual | A level set by an admin (**Partly full**, **Full** or the settings form). It holds until the bin is emptied; items deposited since can only raise it. |
| Estimate | Items deposited since the bin was last emptied, divided by its capacity. |

**Colours** (shared by the bins table and the fleet map's fill layer):

| Fill | Colour | Meaning |
|---|---|---|
| under 50% | green | plenty of space |
| 50–79% | orange | partly full |
| 80% and over | red | full or nearly full; due for collection |
| Inactive bin | grey, no percentage | out of service; not scannable and not on the route |

**What each admin action stores in Supabase** (the `bins` table):

| Action | Stored |
|---|---|
| Partly full | `status = Active`, `fill_level = 60`, `fill_source = manual`, `fill_updated_at = now` |
| Full | `status = Full`, `fill_level = 100`, `fill_source = manual`, `fill_updated_at = now` |
| Emptied | `fill_level = 0`, `last_emptied_at = now`, Full → Active, and a new `bin_collections` row with weight, contamination and notes |
| Settings | status, stream, QR mode, capacity, zone and optional fill level |

Colours, labels and the Full-means-100% rule are computed when the data is read, so the screen can never drift from what is stored. A sensor reading overrides a manual level: at 95% or more it marks the bin Full, and under 50% it reopens a Full bin.

## Tests and CI

```bash
cd server && npm test                    # rewards, QR signing (static + rotating), geofence, routing, photo hash,
                                         # leagues, fleet metrics, transactional balance writes, vendors,
                                         # campus-wallet payments, delayed cashback, and the wallet SQL
                                         # (convert, create/confirm/refund payment, deposit, programme
                                         # history) run against the real scripts in PGlite (Postgres in
                                         # WASM: no database server needed)
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
update public.user_profiles set role = 'admin' where email = 'you@example.com';
```

Sign out and back in to open the operations console. To give canteen or store staff counter access, open **Users**, select the person, choose their counter and click **Give counter access**. Counter staff only see the payment counter for that counter. Add or switch off counters in the **Vendors** tab.

## Bin QR codes (printed)

```bash
cd server
npm run generate:qr        # writes server/bin-qr-codes.html for bins in static mode
```

Codes stay valid until `QR_SECRET` changes. Bins in live mode get a "Live QR on screen" card instead.

### Changing `QR_SECRET` (only if required)

Change it only if the secret has leaked (committed, shared or shown on screen). For a single lost or tampered bin screen, use **Replace key** on that bin instead; it affects only that bin.

1. Generate a new secret (at least 32 characters). Open any terminal (VS Code terminal, PowerShell, Command Prompt or Git Bash); any folder works, it only needs Node.js installed. Run:

   ```bash
   node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
   ```

   It prints a 96-character random string. Copy it; that is your new `QR_SECRET`. Nothing is saved anywhere until you paste it in step 2.

2. Put the **same value** in both places:
   - Local: `QR_SECRET=<value>` in `server/.env`, then restart the server.
   - Production: Render → your service → **Environment** → edit `QR_SECRET` → save (Render redeploys).
3. Redo everything the old secret signed. Changing it invalidates every code and bin key at once:
   - **Printed codes:** run `npm run generate:qr` (with the new secret in your local `.env`), then reprint and replace every sticker.
   - **Bin screens:** for each live bin, open **Admin → Bins → Bin screen setup** and reopen the new link on its tablet.
   - **Sensors:** update them with the new device key from the same setup screen.

Never commit `server/.env`; keep `QR_SECRET` empty in `.env.example`.

## Managing bins (add, update, move, remove)

Bins live in the `bins` table in Supabase. The admin console edits existing bins (status, stream, capacity, zone, QR mode, fill), but adding, moving and deleting are done in Supabase: **SQL Editor → New query**, or **Table Editor → bins** if you prefer a form.

### Get a location's coordinates

In Google Maps, right-click the exact spot where the bin stands and click the coordinates at the top of the menu to copy them (e.g. `12.96354, 77.50512`). The first number is `lat`, the second `lng`. Be accurate: scans are accepted only within about 50 m of this point.

### Add a bin

```sql
insert into public.bins (id, name, lat, lng, status, stream, zone, capacity_items, qr_mode)
values ((select coalesce(max(id), 0) + 1 from public.bins),
        'Library Bin', 12.96354, 77.50512, 'Active', 'station', 'Library block', 200, 'static')
returning id, name;
```

The production `bins` table uses **numeric ids** (it predates the setup scripts), so the id is the next free number; `returning` shows which one was used. Note it down: every other command below needs it (the examples use `7`; replace it with your bin's id). To list existing bins: `select id, name, status from public.bins order by id;`

| Column | Meaning |
|---|---|
| `id` | Permanent unique number (picked automatically above). It is baked into the QR code, so **never change it**. |
| `name` | Name shown to users and admins |
| `lat`, `lng` | Location (see above) |
| `status` | `Active`, `Full` or `Inactive` (use `Inactive` until the bin is installed) |
| `stream` | `station` (multi-compartment, accepts every stream), or a single BBMP stream: `dry`, `wet`, `reject` |
| `zone` | Optional label, e.g. `Hostel block A` |
| `capacity_items` | Roughly how many items fill it; used for the fill estimate (default 200) |
| `qr_mode` | `static` (printed sticker) or `dynamic` (rotating code on a screen) |

Then give it a QR code:
- **Printed:** `cd server && npm run generate:qr`, open `server/bin-qr-codes.html` and print the new bin's code. Your local `server/.env` must have the **same `QR_SECRET` as Render**.
- **Screen:** console → **Bins → Bin screen setup** for the bin, open the link on its tablet, then set its QR mode to *Live rotating QR*.

Refresh the console: the bin appears in the bins table, the fleet map and the public bin map. Scan it once at the spot to confirm.

### Update a bin

- **Status, stream, capacity, zone, QR mode, fill level:** console → **Bins → Settings** (gear icon), or the **Partly full / Full / Emptied** buttons. No SQL needed.
- **Rename:**

  ```sql
  update public.bins set name = 'Main Library Bin' where id = 7;
  ```

### Move a bin to a new location

```sql
update public.bins set lat = 12.96410, lng = 77.50633, zone = 'New block' where id = 7;
```

The QR code stays the same (it contains the `id`, not the location), so the sticker or screen simply moves with the bin. Past deposits keep their history.

### Remove a bin

**Prefer retiring it** — it disappears from scanning and the collection route but keeps its history in reports:

```sql
update public.bins set status = 'Inactive' where id = 7;
```

(or console → **Bins → Settings → Status: Inactive**). Remove its sticker or screen so nobody tries to scan it.

**Delete permanently** only for a bin added by mistake:

```sql
delete from public.bins where id = 7;
```

Past deposits and collections are kept (they store the bin's id and name), but the bin vanishes from every map and report filter, and its QR code stops working. Do not reuse a deleted bin's `id` for a different bin: its old printed codes would become valid again.

### Other locations

- **Collection depot** (where routes start): set `DEPOT_LAT` / `DEPOT_LNG` in Render's environment.
- **Departments and hostels** (for leagues): add, rename or deactivate rows in the `campus_groups` table.

## API

| Method | Path | Access |
|---|---|---|
| GET | `/api/me` | signed in: id, email, name, role, department, hostel |
| POST | `/api/me/profile` | signed in: name, department, hostel |
| GET | `/api/dashboard` | signed in: balances, campus wallet, pending bonus, recent logs, impact, streak, badges, challenges, rank |
| POST | `/api/challenges/claim` | signed in: weekly challenge bonus (once) |
| POST | `/api/scan/start` | signed in: verify QR (signed / rotating) + geofence, start scan session |
| POST | `/api/add-waste` | signed in: record an item (scan session + thumbnail) |
| GET | `/api/wallet` | signed in: campus wallet, pending bonus, open counters, open payment code, ₹ and points history, recent payments |
| POST | `/api/wallet/convert` | signed in: redeem Eco-Points into ₹ in the campus wallet (`{ amountInr }`) |
| POST | `/api/pay/create`, GET `/api/pay/:code`, POST `/api/pay/:code/cancel` | signed in: start a payment (exact ₹ at one counter), poll its status, cancel it |
| GET | `/api/counter/me` | counter staff (own counter, today's payments), admin |
| GET | `/api/counter/payment/:code`, POST `/api/counter/payment/:code/confirm` | counter staff (own counter's payments only), admin |
| GET/POST | `/api/admin/vendors`, POST `/api/admin/vendors/:id` | admin: list with staff + settlement, create, update / switch off, payment limits |
| GET | `/api/admin/payments`, POST `/api/admin/payments/:code/refund` | admin: campus-wallet payments; refund once within 7 days, body `{ reason }` |
| GET/POST | `/api/admin/program` | admin: campus wallet + cashback settings and recent changes (a rate change needs `confirmRateChange: true`) |
| GET | `/api/admin/overview`, `/api/admin/ops`, `/api/admin/ops/route` | admin |
| GET/POST | `/api/admin/bins/:id`, `/:id/empty`, `/:id/collections`, `/:id/device`, `/:id/rotate-key` | admin |
| GET/POST | `/api/admin/flags`, `/api/admin/flags/:id/resolve` | admin |
| GET/POST | `/api/admin/users`, `/api/admin/users/:id`, `/:id/block`, `/:id/role` (`{ role: 'vendor', vendorId }` or `{ role: 'user' }`) | admin |
| GET/POST | `/api/admin/rewards`, `/api/admin/rewards/rule`, `/api/admin/rewards/item` | admin |
| GET | `/api/device/hello`, POST `/api/device/telemetry` | bin device key |
| POST | `/api/auth/check-email` | public, rate-limited: can this address receive the confirmation link? |
| GET | `/api/bins`, `/api/leaderboard`, `/api/leagues`, `/api/campus-groups`, `/api/stats`, `/api/rewards/catalog` | public |

Errors return `{ error, message, i18n: { key, params } }`, so the app can show them in the user's language.

## License

This repository does not currently declare a license.
