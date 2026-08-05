# AquaFest Ticketing

A pool-party-themed ticketing site for AquaFest (by HOH): countdown, Paystack
checkout, emailed QR gate passes, and a camera-based scanner for check-in —
plus staff login, an admin price panel, and a full transactions / QR ledger.

```
aquafest-ticketing/
├── index.html              ← front end (countdown, purchase, wristband, staff UI)
├── package.json
├── .env.example
├── .gitignore
└── api/
    ├── auth.js             ← staff/admin login → Bearer token (KV session)
    ├── config.js           ← public GET prices; admin POST to change them
    ├── create-ticket.js    ← verifies Paystack, saves ticket, emails QR
    ├── checkin.js          ← scanner validates + marks ticket used (auth required)
    ├── stats.js            ← sold / checked-in / revenue (auth required)
    └── tickets.js          ← full transaction + QR list (auth required)
```

## 1. Before you touch any code

Fill in these:

- **Event date & prices** — either edit the defaults in `index.html` (`CONFIG`)
  or, after deploy, change them live from the **Admin → Prices** panel
  (stored in Vercel KV under `config:event`).
- **Paystack public key** — `CONFIG.paystackPublicKey` in `index.html`
  (starts with `pk_`). Safe to commit.
- **Staff / admin passwords** — set in environment variables (see below).

## 2. Install dependencies

```bash
npm install
```

## 3. Set up Redis (Upstash)

Vercel KV is **deprecated**. Use Upstash Redis instead:

1. In the Vercel dashboard: **Storage** or **Integrations → Marketplace → Upstash Redis**.
2. Create / connect a Redis database to this project.
3. Vercel injects `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`.
4. For local dev: `vercel env pull .env.local`

(Legacy `KV_REST_API_URL` / `KV_REST_API_TOKEN` still work if present.)

## 4. Environment variables

In **Project → Settings → Environment Variables** (see `.env.example`):

| Variable | Purpose |
|---|---|
| `PAYSTACK_SECRET_KEY` | Paystack secret (`sk_…`) |
| `RESEND_API_KEY` | Resend API key |
| `RESEND_FROM_EMAIL` | e.g. `AquaFest <tickets@yourdomain.com>` |
| `STAFF_USERNAME` | Gate staff login name (default `staff`) |
| `STAFF_PASSWORD` | Gate staff password |
| `ADMIN_USERNAME` | Admin login name (default `admin`) |
| `ADMIN_PASSWORD` | Admin password (can change prices) |

For local dev: `vercel env pull .env.local`, then add the values above.

## 5. Run locally

```bash
npm i -g vercel   # if needed
vercel dev
```

## 6. Deploy

```bash
vercel
vercel --prod
```

Or connect the GitHub repo for auto-deploys.

## How the pieces fit together

1. Buyer fills the form → **Paystack inline popup** (public key).
2. On success, front end sends the reference to `POST /api/create-ticket`.
3. Backend **re-verifies with Paystack**, loads the current price from KV
   (`config:event`), stores the ticket, and emails the QR via Resend.
4. Buyer sees an on-screen wristband with the same QR.
5. Gate staff open **Gate Staff →**, log in with name + password, then scan.
6. Scanner calls `POST /api/checkin` with a Bearer token; ticket is marked used.
7. **Admin** role also gets a **Prices** tab (edit early/door price & event
   date live) and both roles can open **Transactions** to see every sale
   and its QR code.

## Auth model

- `POST /api/auth` with `{ username, password }` returns `{ token, role, name }`.
- Token is a random string stored in KV (`auth:<token>`) for 12 hours.
- Front end keeps it in `sessionStorage` and sends `Authorization: Bearer …`
  on check-in, stats, tickets, and admin config routes.
- Roles: `staff` (scanner + transactions), `admin` (same + price editor).

## Known limits

- Resend needs a verified sending domain for production delivery.
- Token is session-scoped (browser tab / sessionStorage); closing the tab
  requires logging in again — fine for gate devices.
