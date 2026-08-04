# AquaFest Ticketing

A pool-party-themed ticketing site for AquaFest (by HOH): countdown, Paystack
checkout, emailed QR gate passes, and a camera-based scanner for check-in.

```
aquafest-ticketing/
├── index.html          ← the whole front end (countdown, purchase, wristband, scanner)
├── package.json
├── .env.example         ← copy to .env.local for local dev
├── .gitignore
└── api/
    ├── create-ticket.js ← verifies Paystack payment, saves ticket, emails QR
    ├── checkin.js        ← called by the scanner to validate + mark a ticket used
    └── stats.js          ← sold / checked-in / revenue counters for staff
```

## 1. Before you touch any code

Fill in these three things — they're the only genuinely open questions:

- **Event date** — `index.html`, near the top of the `<script>` block, in
  `CONFIG.eventDateISO`. Everything (countdown, the door-price cutover)
  reacts to this automatically.
- **Prices** — `CONFIG.earlyPrice` and `CONFIG.doorPrice` in the same block.
- **Paystack public key** — `CONFIG.paystackPublicKey`, also in the same
  block. This is the *public* key (starts `pk_`) — safe to commit.

## 2. Install dependencies

```bash
npm install
```

## 3. Set up Vercel KV (where tickets are stored)

Serverless functions have no persistent disk, so tickets live in
[Vercel KV](https://vercel.com/docs/storage/vercel-kv) (a hosted Redis).

1. In the Vercel dashboard: **Storage → Create Database → KV**.
2. Connect it to this project.
3. Vercel will auto-inject `KV_REST_API_URL`, `KV_REST_API_TOKEN`, etc. as
   environment variables — you don't set these by hand.

## 4. Set the remaining environment variables

In **Project → Settings → Environment Variables** on Vercel (see
`.env.example` for the full list with comments):

| Variable | Where it comes from |
|---|---|
| `PAYSTACK_SECRET_KEY` | Paystack dashboard → API Keys (starts `sk_`) |
| `RESEND_API_KEY` | [resend.com](https://resend.com) → API Keys |
| `RESEND_FROM_EMAIL` | e.g. `AquaFest <tickets@yourdomain.com>` — needs a verified sending domain in Resend (or use their test address while developing) |

For local development, run `vercel env pull .env.local` after step 3 to pull
the KV variables down, then add the Paystack/Resend ones to that same file.

## 5. Run it locally

```bash
npm i -g vercel   # if you don't have it
vercel dev
```

This serves `index.html` and runs the `/api` functions together, so the
whole flow — buy a ticket, get emailed a QR, scan it in — works exactly as
it will in production.

## 6. Deploy

```bash
vercel        # first deploy, follow the prompts to link the project
vercel --prod # promote to production
```

Or connect the GitHub repo to a Vercel project in the dashboard for
auto-deploys on every push.

## How the pieces fit together

1. Buyer fills the form → **Paystack inline popup** opens in the browser
   using the public key.
2. On successful payment, Paystack hands back a `reference`. The front end
   sends that to `POST /api/create-ticket`.
3. `create-ticket.js` **re-verifies the reference directly with Paystack**
   (never trusts the browser alone), then saves the ticket in KV and emails
   the QR pass via Resend.
4. The buyer's browser renders the same ticket as an on-screen wristband
   with a QR code (using the `id`/`name` payload).
5. At the gate, staff open the "Gate Staff" view, scan the QR with the
   camera, and the browser calls `POST /api/checkin`, which looks the
   ticket up in KV and marks it used — so a ticket can't be scanned in
   twice, even from two different phones.

## Known limits worth knowing about

- Ticket price increases are based on the visitor's **local clock** — fine
  for a prototype, but for a hard cutover you'd want the price decided
  server-side too (have `create-ticket.js` compute the expected amount
  itself rather than trusting `unitPrice` from the client).
- Resend needs a verified sending domain before it'll deliver to arbitrary
  inboxes — their docs walk through DNS setup in a few minutes.
