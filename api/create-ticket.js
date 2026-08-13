// POST /api/create-ticket
// Body: { reference, name, email, qty }
// Verifies Paystack, creates one independent ticket per admission, and emails all QRs.

const QRCode = require('qrcode');
const crypto = require('crypto');
const { getRedis } = require('./_redis');
const { loadConfig } = require('./config');

const MAX_QTY = 10;
const REF_LOCK_TTL_SECONDS = 5 * 60;

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let redis;
  let lockKey = null;
  let lockToken = null;

  try {
    const { reference, name, email, phone, qty } = req.body || {};
    const quantity = Number(qty);

    if (!reference || !name || !email || !phone) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    if (typeof phone !== 'string' || phone.trim().length < 7 || phone.trim().length > 30) {
      return res.status(400).json({ error: 'A valid phone number is required' });
    }

    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QTY) {
      return res.status(400).json({ error: `Quantity must be an integer between 1 and ${MAX_QTY}` });
    }

    redis = getRedis();

    // Idempotency: a successful Paystack reference can only create one purchase.
    const existingRef = await redis.get(`ref:${reference}`);
    if (existingRef) {
      const existingTickets = await loadTicketsFromReference(redis, existingRef);
      if (existingTickets.length) {
        return res.status(200).json({ ticket: existingTickets[0], tickets: existingTickets });
      }
      return res.status(409).json({ error: 'This payment is still being processed. Please retry shortly.' });
    }

    // Prevent two simultaneous callbacks/retries from creating duplicate tickets.
    lockKey = `ref-lock:${reference}`;
    lockToken = crypto.randomBytes(16).toString('hex');
    const lockAcquired = await redis.set(lockKey, lockToken, { nx: true, ex: REF_LOCK_TTL_SECONDS });
    if (!lockAcquired) {
      const lockedRef = await redis.get(`ref:${reference}`);
      if (lockedRef) {
        const tickets = await loadTicketsFromReference(redis, lockedRef);
        if (tickets.length) return res.status(200).json({ ticket: tickets[0], tickets });
      }
      return res.status(409).json({ error: 'This payment is already being processed. Please retry shortly.' });
    }

    // Re-check after acquiring the lock.
    const refAfterLock = await redis.get(`ref:${reference}`);
    if (refAfterLock) {
      const tickets = await loadTicketsFromReference(redis, refAfterLock);
      if (tickets.length) return res.status(200).json({ ticket: tickets[0], tickets });
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
    const paidKobo = Number(verifyData.data.amount);
    const expectedKobo = Math.round(serverUnit * quantity * 100);

    if (!Number.isFinite(serverUnit) || serverUnit <= 0) {
      return res.status(500).json({ error: 'Ticket price is not configured correctly' });
    }

    if (!Number.isFinite(paidKobo) || paidKobo !== expectedKobo) {
      return res.status(402).json({ error: 'Amount paid does not match the current ticket total' });
    }

    const amountPaid = paidKobo / 100;

    // ---- 3. Create one independent ticket per purchased ticket ----
    const purchaseId = 'AQF-P-' + crypto.randomBytes(4).toString('hex').toUpperCase();
    const purchasedAt = new Date().toISOString();
    const ticketAmount = amountPaid / quantity;
    const ticketIds = [];
    const tickets = [];

    for (let i = 1; i <= quantity; i++) {
      const id = 'AQF-' + crypto.randomBytes(4).toString('hex').toUpperCase();
      const ticket = {
        id,
        purchaseId,
        ticketNumber: i,
        ticketCount: quantity,
        name,
        email,
        phone: phone.trim(),
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

    // The reference becomes the permanent idempotency record only after all tickets exist.
    await redis.set(`ref:${reference}`, JSON.stringify(ticketIds));

    // ---- 4. Email (best-effort) ----
    try {
      await sendTicketEmail({ name, email, phone: phone.trim(), reference, purchaseId, quantity, amountPaid, tickets });
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
  } finally {
    // Release only our lock. A failed request can then be safely retried.
    if (redis && lockKey && lockToken) {
      try {
        const current = await redis.get(lockKey);
        if (current === lockToken) await redis.del(lockKey);
      } catch (e) {
        console.error('Could not release purchase lock', e);
      }
    }
  }
};

async function loadTicketsFromReference(redis, rawRef) {
  let ids;
  try {
    ids = JSON.parse(rawRef);
  } catch (e) {
    ids = [rawRef];
  }
  if (!Array.isArray(ids)) ids = [ids];

  const tickets = [];
  for (const id of ids) {
    if (!id) continue;
    const raw = await redis.get(`ticket:${id}`);
    if (raw) tickets.push(typeof raw === 'string' ? JSON.parse(raw) : raw);
  }
  return tickets;
}

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

  const ticketList = purchase.tickets.map(ticket =>
    `<li><strong>Ticket ${ticket.ticketNumber} of ${purchase.quantity}</strong> — ${ticket.id}</li>`
  ).join('');

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
        <p>Hi ${escapeHtml(purchase.name)},</p>
        <p>Your AquaFest purchase is confirmed.</p>
        <p><strong>Tickets:</strong> ${purchase.quantity}<br/>
        <strong>Purchase ID:</strong> ${purchase.purchaseId}<br/><strong>Phone:</strong> ${escapeHtml(purchase.phone)}</p>
        <p>Each ticket below is a separate entry pass. Give one QR code to each person attending. Every QR code can be scanned once at the gate.</p>
        <ul>${ticketList}</ul>
        <p>The QR images are attached to this email.</p>
      `,
      attachments
    })
  });

  if (!emailRes.ok) {
    const body = await emailRes.text();
    throw new Error(`Resend API error: ${emailRes.status} ${body}`);
  }
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}
