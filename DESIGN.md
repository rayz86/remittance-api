# Design Overview

## Architecture

```
Client (Postman)
        │
        ▼
┌───────────────────┐          ┌──────────────────┐
│   Orchestrator    │ ──────▶  │  Payout Partner  │
│   (port 3000)     │ ◀──────  |  (port 4000)     │
│   Express + Mongo │ webhook  │  Express         │
└───────────────────┘          └──────────────────┘
```

- **Orchestrator** — the main API. Manages the full transfer lifecycle: create → quote → confirm → compliance → payment.
- **Payout Partner** — a simulator. Receives a payout request, waits 3 seconds, randomly decides PAID/FAILED, and sends a webhook back.

The client only talks to the Orchestrator. The Orchestrator calls the Payout Partner internally.

---

## State Machine

```
CREATED → QUOTED → CONFIRMED → COMPLIANCE_APPROVED → PAYMENT_PENDING → PAID
                             ↘ COMPLIANCE_PENDING ↗                  ↘ FAILED
                             ↘ COMPLIANCE_REJECTED
```

Each transfer can only move forward through allowed transitions. Invalid transitions throw an error. Terminal states: `PAID`, `FAILED`, `COMPLIANCE_REJECTED`.

---

**CORE FLOW:**

1. Create Transfer
   - Client → Orchestrator
   - POST /transfers
   - Transfer created with state = CREATED

2. Quote
   - Client → Orchestrator
   - POST /transfers/:id/quote
   - Orchestrator calculates:
     • exchange rate
     • fees
     • payout amount
     • expiry timestamp
   - State → QUOTED

3. Confirm
   - Client → Orchestrator
   - POST /transfers/:id/confirm
   - Orchestrator:
     • validates quote is not expired
     • locks quote (immutable confirmedQuote)
     • performs compliance checks
   - State → CONFIRMED

4. Compliance
   - Orchestrator (internally does these)
   - Possible outcomes:
     • APPROVE → COMPLIANCE_APPROVED
     • REJECT → COMPLIANCE_REJECTED
     • MANUAL → COMPLIANCE_PENDING
   - Approved transfers proceed to payment

5. Payment
   - Orchestrator → Payout Partner (webhook call)
   - POST /partner/payouts
   - Partner response:
     • partnerPayoutId
     • status = PENDING
   - Orchestrator:
     • stores partnerPayoutId
     • State → PAYMENT_PENDING

6. Webhook Callback
   - Payout Partner → Orchestrator
   - POST /webhooks/payout-status
   - Payload:
     • partnerPayoutId
     • status = PAID | FAILED
   - Orchestrator:
     • verifies HMAC signature
     • enforces idempotency
     • updates transfer state accordingly

7. Status Polling
   - Client → Orchestrator
   - GET /transfers/:id
   - Returns latest transfer state:
     • PAID
     • FAILED
     • or intermediate states

---

## Webhook Security

- Both services share a secret (`WEBHOOK_SECRET`).
- The payout partner signs the webhook body with **HMAC SHA-256**.
- The orchestrator verifies the signature before processing.

---

## Timeouts & Retries

**Current behavior (simplified):**

- Quotes expire after **60 seconds**. Confirming an expired quote is rejected.
- The payout partner responds after a **3-second delay** to simulate real-world async processing.
- Webhook handling is **idempotent** — if a transfer is already `PAID` or `FAILED`, duplicate webhooks are ignored.
