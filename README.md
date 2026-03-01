# Remittance Project

A simple money-transfer system with two services: an **Orchestrator** (handles transfers end-to-end) and a **Payout Partner** (simulates sending money).

---

## Prerequisites

- **Docker** (recommended) — that's all you need
- Or for local dev: **Node.js** v18+ and **MongoDB** on port `27017`

---

## Project Structure

```
remittance-project/
├── docker-compose.yml
├── orchestrator/       # Main API
│   ├── Dockerfile
│   ├── index.js
│   ├── db.js
│   ├── models/
│   │   └── Transfer.js
│   └── .env
├── payout/             # Simulated payout partner
│   ├── Dockerfile
│   ├── index.js
│   └── .env
```

---

## Setup

### Option A — Docker (recommended)

```bash
docker-compose up --build
```

This starts everything — MongoDB, orchestrator (port 3000), and payout partner (port 4000). No other setup needed.

To stop:

```bash
docker-compose down
```

---

### Option B — Run locally

### 1. Install dependencies

```bash
cd orchestrator
npm install

cd ../payout
npm install
```

### 2. Environment variables

Both services need a `.env` file with the same shared secret:

**orchestrator/.env**

```
WEBHOOK_SECRET=key_123
```

**payout/.env**

```
WEBHOOK_SECRET=key_123
```

### 3. Start MongoDB

Make sure MongoDB is running on `localhost:27017`.

### 4. Run the services

Open **two terminals**:

```bash
# Terminal 1 — Orchestrator (port 3000)
cd orchestrator
node index.js

# Terminal 2 — Payout Partner (port 4000)
cd payout
node index.js
```

---

## API Walkthrough (curl)

### Step 1 — Create a transfer

```bash
curl -X POST http://localhost:3000/transfers \
  -H "Content-Type: application/json" \
  -d '{
    "sender": { "name": "Alice", "country": "UK" },
    "recipient": { "name": "Bob", "country": "NG" },
    "amount": 1000,
    "currency": "GBP"
  }'
```

Copy the `_id` from the response for the next steps.

### Step 2 — Get a quote

```bash
curl -X POST http://localhost:3000/transfers/<id>/quote
```

### Step 3 — Confirm (runs compliance automatically)

```bash
curl -X POST http://localhost:3000/transfers/<id>/confirm
```

### Step 4 — Trigger payment (calls payout partner)

```bash
curl -X POST http://localhost:3000/transfers/<id>/payment
```

### Step 5 — Check final status

Wait ~3 seconds for the payout webhook, then:

```bash
curl http://localhost:3000/transfers/<id>
```

State should be `PAID` or `FAILED`.

### Manual compliance (for amounts > 5000)

```bash
# Approve
curl -X POST http://localhost:3000/transfers/<id>/compliance/approve

# Reject
curl -X POST http://localhost:3000/transfers/<id>/compliance/reject
```

---
