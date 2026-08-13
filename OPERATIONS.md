# AquaFest Phase 4 Operations Runbook

## Before gates open

- Confirm the admin dashboard says `✓ Operational`.
- Confirm Redis latency is low and stable.
- Confirm Paystack is `Configured`.
- Confirm Email is `Configured`.
- Download a backup from **System health & recovery**.
- Test one real ticket in the gate scanner.
- Confirm a second scan of the same ticket returns **Already checked in**.

## During the event

- Keep the gate dashboard open on a reliable connection.
- If it shows `Connection problem`, stop admitting guests until the server connection is restored.
- Do not manually mark tickets as checked in outside the gate workflow.
- Periodically refresh stats and, when practical, download another backup.

## If the network fails

Do not switch to an offline/manual admission workflow unless the event team has a separate controlled process. The system intentionally requires server confirmation so the same ticket cannot be admitted twice.

## After the event

- Download a final backup.
- Preserve the final JSON export as the event record.
- Reconcile tickets sold, checked in, cancelled/refunded, and revenue.
- Review Vercel function logs for failed requests.
