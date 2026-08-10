// POST /api/create-ticket
// Body: { reference, name, email, qty, unitPrice }
// Verifies Paystack, stores one ticket record per purchased ticket, emails all QRs.

const QRCode = require('qrcode');
const { getRedis } = require('./_redis');
const { loadConfig } = require('./config');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { reference, name, email, qty } = req.body || {};
    const quantity = Math.max(1, Math.min(10, Number(qty) || 0));

    if (!reference || !name || !email || !quantity) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // ---- 1. Verify with Paystack ----
    const verifyRes = await fetch(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
      { headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` } }
    );
    const verifyData = await verifyRes.json();

    if (!verifyRes.ok || !verifyData.status || verifyData.data?.status !== 'success') {
      return res.status(402).json({ error: 'Payment could not be verified with Paystack' });
    }

    // ---- 2. Server-side price ----
    const config = await loadConfig();
    const now = new Date();
    const ev = new Date(config.eventDateISO);
    const isDoor =
      (now.getFullYear() === ev.getFullYear() &&
        now.getMonth() === ev.getMonth() &&
        now.getDate() === ev.getDate()) ||
      now > ev;
    const serverUnit = isDoor ? Number(config.doorPrice) : Number(config.earlyPrice);
    const minAcceptable = Math.min(Number(config.earlyPrice), Number(config.doorPrice));
    const paid = Number(verifyData.data.amount);

    if (paid < Math.round(minAcceptable * quantity * 100)) {
      return res.status(402).json({ error: 'Amount paid does not match the ticket total' });
    }

    const amountPaid = paid / 100;
    const redis = getRedis();

    // ---- 3. Idempotency ----
    const existingRef = await redis.get(`ref:${reference}`);
    if (existingRef) {
      let existingIds;
      try {
        existingIds = JSON.parse(existingRef);
      } catch (e) {
        existingIds = [existingRef];
      }
      if (!Array.isArray(existingIds)) existingIds = [existingIds];

      const existingTickets = [];
      for (const existingId of existingIds) {
        const existing = await redis.get(`ticket:${existingId}`);
        if (existing) existingTickets.push(typeof existing === 'string' ? JSON.parse(existing) : existing);
      }
      if (existingTickets.length) {
        return res.status(200).json({ ticket: existingTickets[0], tickets: existingTickets });
      }
    }

    // ---- 4. Create one independent ticket per purchased ticket ----
    const purchaseId = 'AQF-P-' + Math.random().toString(36).slice(2, 8).toUpperCase();
    const purchasedAt = new Date().toISOString();
    const ticketAmount = amountPaid / quantity;
    const ticketIds = [];
    const tickets = [];

    for (let i = 1; i <= quantity; i++) {
      const id = 'AQF-' + Math.random().toString(36).slice(2, 8).toUpperCase();
      const ticket = {
        id,
        purchaseId,
        ticketNumber: i,
        ticketCount: quantity,
        name,
        email,
        qty: 1,
        amountPaid: ticketAmount,
        unitPrice: serverUnit,
        status: 'unused',
        purchasedAt,
        reference
      };

      await redis.set(`ticket:${id}`, ticket);
      await redis.sadd('ticket-index', id);
      ticketIds.push(id);
      tickets.push(ticket);
    }

    await redis.set(`ref:${reference}`, JSON.stringify(ticketIds));

    // ---- 5. Email (best-effort) ----
    try {
      await sendTicketEmail({ name, email, reference, purchaseId, quantity, amountPaid, tickets });
    } catch (emailErr) {
      console.error('Email send failed for purchase', purchaseId, emailErr);
    }

    return res.status(200).json({ ticket: tickets[0], tickets });
  } catch (err) {
    console.error(err);
    if (err.code === 'REDIS_NOT_CONFIGURED') {
      return res.status(503).json({ error: err.message });
    }
    return res.status(500).json({ error: 'Something went wrong creating the ticket' });
  }
};

async function sendTicketEmail(purchase) {
  if (!process.env.RESEND_API_KEY) {
    console.warn('RESEND_API_KEY not set — skipping email send for', purchase.purchaseId);
    return;
  }

  const attachments = [];
  for (const ticket of purchase.tickets) {
    const qrDataUrl = await QRCode.toDataURL(JSON.stringify({ id: ticket.id, name: ticket.name }));
    attachments.push({
      filename: `${ticket.id}.png`,
      content: qrDataUrl.split(',')[1]
    });
  }

  const emailRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: process.env.RESEND_FROM_EMAIL,
      to: purchase.email,
      subject: 'Your AquaFest tickets',
      html: `
        <p>Hi ${purchase.name},</p>
        <p>Your AquaFest purchase is confirmed.</p>
        <p><strong>Tickets:</strong> ${purchase.quantity}<br/>
        <strong>Purchase ID:</strong> ${purchase.purchaseId}</p>
        <p>Each attached QR code is a separate entry pass. Give one QR code to each person attending. Every QR code can be scanned once at the gate.</p>
      `,
      attachments
    })
  });

  if (!emailRes.ok) {
    const body = await emailRes.text();
    throw new Error(`Resend API error: ${emailRes.status} ${body}`);
  }
}
