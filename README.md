# AquaFest Ticketing

A pool-party-themed ticketing site for AquaFest (by HOH): countdown, Paystack
checkout, emailed QR gate passes, and a camera-based scanner for check-in —
plus staff login, an admin price panel, a full transactions / QR ledger, ticket lifecycle controls, and customer phone capture.

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
- **Customer phone** — collected at checkout and stored with every individual ticket.

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
- Token is a random string stored in Redis (`auth:<token>`) for 12 hours; login attempts are rate-limited and logout invalidates the token.
- Front end keeps it in `sessionStorage` and sends `Authorization: Bearer …`
  on check-in, stats, tickets, and admin config routes.
- Roles: `staff` (scanner + transactions), `admin` (same + price editor + ticket cancellation/refund status controls).
- Cancelled/refunded tickets are rejected by the gate scanner.
- "Mark refunded" records the ticket as refunded; it does not initiate a Paystack refund.

## Known limits

- Resend needs a verified sending domain for production delivery.
- Token is session-scoped (browser tab / sessionStorage); closing the tab
  requires logging in again — fine for gate devices.


## Phase 4 — Event-day reliability

### Health monitoring

`GET /api/health` reports AquaFest service health, Redis latency, and whether Paystack/Resend environment variables are configured. The admin dashboard can run the check manually.

For external uptime monitoring, point a monitor at `/api/health`. The endpoint intentionally exposes no credentials or secret values.

### Backup and recovery

Admins can use **System health & recovery → Download backup** to export the current event configuration, ticket records, and check-in markers as JSON. Store the downloaded file outside Vercel as an event-day backup.

The export is a backup artifact; it does not automatically restore data. Do not edit and re-import it without a controlled migration procedure.

### Event-day reliability

- Stats requests retry once after a short delay because GET is safe to retry.
- Check-in requests are not automatically retried by the browser; the server-side atomic admission marker prevents duplicate admission.
- The gate dashboard reports connection problems immediately when operational requests fail.
- The scanner should not admit a guest while the server is unreachable.
- Use Vercel function logs and an external uptime monitor for alerting.

### Recommended event-day backup routine

1. Download a backup immediately before gates open.
2. Download another backup periodically during the event if operationally practical.
3. Keep the files off the production machine/account as a separate recovery copy.
4. After the event, export one final backup for reconciliation and reporting.
