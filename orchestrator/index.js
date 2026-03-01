require('./db');
require('dotenv').config();
const express = require('express');

const Transfer = require('./models/Transfer');

const STATES={
    CREATED: "CREATED",
    QUOTED: "QUOTED",
    CONFIRMED: "CONFIRMED",
    COMPLIANCE_PENDING: "COMPLIANCE_PENDING",
    COMPLIANCE_APPROVED: "COMPLIANCE_APPROVED",
    COMPLIANCE_REJECTED: "COMPLIANCE_REJECTED",
    PAYMENT_PENDING: "PAYMENT_PENDING",
    PAID: "PAID",
    FAILED: "FAILED"
};

const allowedTransitions = {
    CREATED: [STATES.QUOTED],
    QUOTED: [STATES.CONFIRMED],
    CONFIRMED: [STATES.COMPLIANCE_PENDING, STATES.COMPLIANCE_APPROVED, STATES.COMPLIANCE_REJECTED],
    COMPLIANCE_PENDING: [STATES.COMPLIANCE_APPROVED, STATES.COMPLIANCE_REJECTED],
    COMPLIANCE_APPROVED: [STATES.PAYMENT_PENDING],
    COMPLIANCE_REJECTED: [],
    PAYMENT_PENDING: [STATES.PAID, STATES.FAILED],
    PAID: [],
    FAILED: []
};

const crypto = require('crypto'); //for HMAC
const axios = require('axios'); //for making HTTP requests

function changeState(transfer, newState){
    const allowed = allowedTransitions[transfer.state];

    if (!allowed.includes(newState)) {
        throw new Error (`Invalid state transition from ${transfer.state} to ${newState}`);
    }

    transfer.state = newState;
}

function generateQuote(amount){
    const rate = 0.95;
    const fee = 50;
    const payoutAmount = amount * rate - fee;

    return {
        rate,
        fee,
        payoutAmount,
        expiresAt: new Date(Date.now() + 60 * 1000)
    }
}

function complianceCheck(transfer){
    if(transfer.recipient?.country === "US") {
        return {
            decision: "REJECT",
            reason: "Country Blocked"
        }
    }

    //to handle COMPLIANCE_PENDING
    if (transfer.amount > 5000) {
        return {
            decision: "MANUAL",
            reason: "Amount exceeds limit of auto-approval"
        }
    }

    if (transfer.recipient?.name?.toLowerCase().includes("test")) {
        return {
            decision: "REJECT",
            reason: "Name contains test"
        }
    }

    return {
        decision: "APPROVE",
        reason: "Auto-approved"
    }
}

const app = express();

//webhook endpoint to receive payout status
app.post("/webhooks/payout-status", express.raw({ type: 'application/json' }), async (req, res) => {
    const rawBody = req.body;

    const expectedSignature = crypto.createHmac('sha256', process.env.WEBHOOK_SECRET)
        .update(rawBody)
        .digest('hex');

    if (req.headers['x-webhook-signature'] !== expectedSignature) {
        return res.status(401).send("Invalid signature");
    }

    const { partnerPayoutId, status } = JSON.parse(rawBody);
    console.log(`Webhook received: partnerPayoutId=${partnerPayoutId}, status=${status}`);

    const transfer = await Transfer.findOne({ partnerPayoutId });

    if (!transfer) {
        return res.send("Transfer not found");
    }

    if (transfer.state === STATES.PAID || transfer.state === STATES.FAILED) {
        return res.send("Already processed beyond payment state");
    }

    try {
    changeState(
        transfer,
        status === "PAID" ? STATES.PAID : STATES.FAILED
    );
    await transfer.save();
    console.log(`Transfer ${transfer._id} updated to ${transfer.state}`);
    res.send("OK");
    } catch (e) {
        res.status(400).send(e.message);
    }
});

app.use(express.json());

app.get('/', (req, res) => {
    res.send('Server running');
});

//to initiate a transfer
app.post('/transfers', async (req, res) => {
    const { sender, recipient, amount, currency } = req.body;
    const transfer = await Transfer.create({
        sender,
        recipient,
        amount,
        currency,
        state: STATES.CREATED,
    });
    res.status(201).json(transfer);
});

//to get transfer details
app.get('/transfers/:id', async (req, res) => {
    const {id} = req.params;
    const transfer = await Transfer.findById(id);

    if (!transfer){
        return res.status(404).json({message: "Transfer not found"});
    }
    res.json(transfer);
});

//to get a quote for a transfer
app.post("/transfers/:id/quote", async (req, res) => {
    const transfer = await Transfer.findById(req.params.id);

    if (!transfer){
        return res.status(404).json({message: "Transfer not found"});
    }

    try {
        const quote = generateQuote(transfer.amount);

        transfer.quote = quote;
        changeState(transfer, STATES.QUOTED);
        await transfer.save();
        res.json(transfer);
    } catch (error) {
        res.status(400).json({message: error.message});
    }
});

//to confirm a transfer and trigger compliance
app.post("/transfers/:id/confirm", async (req, res) => {
    const transfer = await Transfer.findById(req.params.id);

    if(!transfer){
        return res.status(404).json({message: "Transfer not found"});
    }

    if (new Date() > new Date(transfer.quote.expiresAt)){
        return res.status(400).json({message: "Quote has expired"});
    }
    try {
        transfer.confirmedQuote = { ...transfer.quote };
        delete transfer.quote; //remove the old quote
        changeState(transfer, STATES.CONFIRMED);
        await transfer.save();

        const complianceResult = complianceCheck(transfer);

        transfer.compliance = {
            decision: complianceResult.decision,
            reason: complianceResult.reason,
            checkedAt: new Date()
        }

        if (complianceResult.decision === "APPROVE"){
            changeState(transfer, STATES.COMPLIANCE_APPROVED);
            await transfer.save();
    }
        else if (complianceResult.decision === "REJECT"){
            changeState(transfer, STATES.COMPLIANCE_REJECTED);
            await transfer.save();
        }
        else if (complianceResult.decision === "MANUAL"){
            changeState(transfer, STATES.COMPLIANCE_PENDING);
            await transfer.save();
        }
        else {
            changeState(transfer, STATES.FAILED);
            await transfer.save();
        }
        res.json(transfer);

    } catch (error) {
        res.status(400).json({message: error.message});
    }
});

//to approve a transfer
app.post("/transfers/:id/compliance/approve", async (req, res) => {
    const transfer = await Transfer.findById(req.params.id);

    if (!transfer){
        return res.status(404).json({message: "Transfer not found"});
    }

    if (transfer.state !== STATES.COMPLIANCE_PENDING){
        return res.status(400).json({message: "Transfer not in compliance pending state"});
    }

    try {
        changeState(transfer, STATES.COMPLIANCE_APPROVED);

        transfer.compliance.reviewedAt = new Date();
        transfer.compliance.reviewedBy = "admin";

        await transfer.save();
        res.json(transfer);
    } catch (error) {
        res.status(400).json({message: error.message});
    }
});

//to reject a transfer
app.post("/transfers/:id/compliance/reject", async (req, res) => {
    const transfer = await Transfer.findById(req.params.id);

    if (!transfer){
        return res.status(404).json({message: "Transfer not found"});
    }

    if (transfer.state !== STATES.COMPLIANCE_PENDING){
        return res.status(400).json({message: "Transfer not in compliance pending state"});
    }

    try {
        changeState(transfer, STATES.COMPLIANCE_REJECTED);

        transfer.compliance.reviewedAt = new Date();
        transfer.compliance.reviewedBy = "admin";

        await transfer.save();
        res.json(transfer);
    } catch (error) {
        res.status(400).json({message: error.message});
    }
});

//to trigger payment and call the webhook
app.post("/transfers/:id/payment", async (req, res) => {
    const transfer = await Transfer.findById(req.params.id);

    if (!transfer){
        return res.status(404).json({message: "Transfer not found"});
    }
    if (transfer.state !== STATES.COMPLIANCE_APPROVED){
        return res.status(400).json({message: "Transfer not approved for payment"});
    }
    try {
        const response = await axios.post(
            (process.env.PAYOUT_URL || "http://localhost:4000") + "/partner/payouts",
            {
                transferId: transfer._id,
                amount: transfer.confirmedQuote.payoutAmount
            }
        );

        transfer.partnerPayoutId = response.data.partnerPayoutId;
        changeState(transfer, STATES.PAYMENT_PENDING);
        await transfer.save();

        res.json({
            message: "Payment processing",
            transfer
        });
    } catch (error) {
        res.status(400).json({message: error.message});
    }
});

app.listen(3000, () => {
    console.log('Server is running on port 3000');
});