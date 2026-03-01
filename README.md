# Remittance Project

A simple money-transfer system with two services: an **Orchestrator** (handles transfers) and a **Payout Partner** (simulates sending money).

---

## Prerequisites

- **Docker**
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

### Option A — Docker

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

## API Walkthrough (Postman)

Use Postman to create and exercise transfers. For each request choose the method and URL, set `Content-Type: application/json`, and put JSON in the request body when needed.

Step 1 — Create a transfer

- Method: `POST`
- URL: `http://localhost:3000/transfers`
- Body (raw JSON):

```
{
  "sender": { "name": "Alice", "country": "UK" },
  "recipient": { "name": "Bob", "country": "NG" },
  "amount": 1000,
  "currency": "GBP"
}
```

Copy the returned `_id` for the next steps.

Step 2 — Get a quote

- Method: `POST`
- URL: `http://localhost:3000/transfers/<id>/quote`

Step 3 — Confirm (runs compliance automatically)

- Method: `POST`
- URL: `http://localhost:3000/transfers/<id>/confirm`

Step 4 — Trigger payment (calls payout partner)

- Method: `POST`
- URL: `http://localhost:3000/transfers/<id>/payment`

Step 5 — Check final status

- Method: `GET`
- URL: `http://localhost:3000/transfers/<id>`

Wait ~3 seconds for the payout webhook; the transfer `state` will be `PAID` or `FAILED`.

Manual compliance (for amounts > 5000)

- Approve: `POST http://localhost:3000/transfers/<id>/compliance/approve`
- Reject: `POST http://localhost:3000/transfers/<id>/compliance/reject`

---
