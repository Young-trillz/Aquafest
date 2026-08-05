// POST /api/create-ticket
// Body: { reference, name, email, qty, unitPrice }
//
// 1. Re-verifies the Paystack transaction server-side (never trust a
//    reference the browser hands you without checking it against Paystack).
// 2. Computes expected price from server-side config (not client unitPrice).
// 3. Creates the ticket record in Vercel KV.
// 4. Emails the buyer their QR gate pass (best-effort — a failed email
//    does not fail the ticket purchase, since the buyer already paid).

const { kv } = require('@vercel/kv');
const QRCode = require('qrcode');
const { loadConfig } = require('./config');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { reference, name, email, qty, unitPrice } = req.body || {};

    if (!reference || !name || !email || !qty) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // ---- 1. Verify the transaction with Paystack ----
    const verifyRes = await fetch(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
      { headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` } }
    );
    const verifyData = await verifyRes.json();

    if (!verifyRes.ok || !verifyData.status || verifyData.data?.status !== 'success') {
      return res.status(402).json({ error: 'Payment could not be verified with Paystack' });
    }

    // ---- 2. Server-side price (don't fully trust client unitPrice) ----
    const config = await loadConfig();
    const now = new Date();
    const ev = new Date(config.eventDateISO);
    const isDoor =
      (now.getFullYear() === ev.getFullYear() &&
        now.getMonth() === ev.getMonth() &&
        now.getDate() === ev.getDate()) ||
      now > ev;
    const serverUnit = isDoor ? Number(config.doorPrice) : Number(config.earlyPrice);
    // Allow a small tolerance if client sent a slightly different price (race on day-of)
    // but never charge less than the lower of the two published prices.
    const minAcceptable = Math.min(Number(config.earlyPrice), Number(config.doorPrice));
    const expectedKobo = Math.round(serverUnit * Number(qty) * 100);
    const paid = Number(verifyData.data.amount);

    if (paid < Math.round(minAcceptable * Number(qty) * 100)) {
      return res.status(402).json({ error: 'Amount paid does not match the ticket total' });
    }

    // Prefer what was actually paid for the ticket record
    const amountPaid = paid / 100;

    // ---- 3. Idempotency: if this reference already produced a ticket, return it ----
    const existingId = await kv.get(`ref:${reference}`);
    if (existingId) {
      const existing = await kv.get(`ticket:${existingId}`);
      if (existing) return res.status(200).json({ ticket: existing });
    }

    // ---- 4. Create and store the ticket ----
    const id = 'AQF-' + Math.random().toString(36).slice(2, 8).toUpperCase();
    const ticket = {
      id,
      name,
      email,
      qty: Number(qty),
      amountPaid,
      unitPrice: serverUnit,
      status: 'unused', // unused | checked-in
      purchasedAt: new Date().toISOString(),
      reference
    };

    await kv.set(`ticket:${id}`, ticket);
    await kv.sadd('ticket-index', id);
    await kv.set(`ref:${reference}`, id);

    // ---- 5. Email the QR pass (best-effort) ----
    try {
      await sendTicketEmail(ticket);
    } catch (emailErr) {
      console.error('Email send failed for ticket', id, emailErr);
    }

    return res.status(200).json({ ticket });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Something went wrong creating the ticket' });
  }
};

async function sendTicketEmail(ticket) {
  if (!process.env.RESEND_API_KEY) {
    console.warn('RESEND_API_KEY not set — skipping email send for', ticket.id);
    return;
  }

  const qrDataUrl = await QRCode.toDataURL(JSON.stringify({ id: ticket.id, name: ticket.name }));
  const qrBase64 = qrDataUrl.split(',')[1];

  const emailRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: process.env.RESEND_FROM_EMAIL,
      to: ticket.email,
      subject: 'Your AquaFest ticket',
      html: `
        <p>Hi ${ticket.name},</p>
        <p>Your AquaFest ticket is confirmed.</p>
        <p><strong>Ticket ID:</strong> ${ticket.id}<br/>
        <strong>Tickets:</strong> ${ticket.qty}</p>
        <p>Show the attached QR code at the gate — it's your entry pass.</p>
      `,
      attachments: [
        { filename: `${ticket.id}.png`, content: qrBase64 }
      ]
    })
  });

  if (!emailRes.ok) {
    const body = await emailRes.text();
    throw new Error(`Resend API error: ${emailRes.status} ${body}`);
  }
};
