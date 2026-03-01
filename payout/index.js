const express = require("express");
const crypto = require("crypto");
require("dotenv").config();

const app = express();
app.use(express.json());

//to handle payment result
async function processPayout(partnerPayoutId){
    const success = Math.random() > 0.3;

    const status = success ? "PAID" : "FAILED";
    console.log(`Payout ${partnerPayoutId}, status: ${status}`);

    await sendWebhook({
        partnerPayoutId,
        status
    });
}

//to handle the payout status webhook
const axios = require('axios');
async function sendWebhook(payload) {
    const signature = signPayload(payload);

    await axios.post(process.env.ORCHESTRATOR_URL || 'http://localhost:3000/webhooks/payout-status', payload, {
        headers: {'x-webhook-signature': signature }
    });
}

//to handle HMAC signature
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;
function signPayload(payload) {
    return crypto.createHmac('sha256', WEBHOOK_SECRET)
        .update(JSON.stringify(payload))
        .digest('hex');
}

app.listen(4000, () => {
  console.log("Payout partner running on port 4000");
});

//test endpoint to trigger a payout
app.post("/partner/payouts", (req, res) => {
    const partnerPayoutId = crypto.randomUUID();
    res.json({
        partnerPayoutId,
        status: "PENDING",
    });
    console.log("Received payout request. partnerPayoutId:", partnerPayoutId);

    setTimeout(() => {
        processPayout(partnerPayoutId);
    }, 3000);
});
