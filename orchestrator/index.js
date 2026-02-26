const express = require('express');

const {randomUUID} = require ('crypto');
const { create } = require('domain');
const transfers= [];

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
    CREATED: ["QUOTED"],
    QUOTED: ["CONFIRMED"],
    CONFIRMED: ["COMPLIANCE_PENDING", "COMPLIANCE_APPROVED", "COMPLIANCE_REJECTED"],
    COMPLIANCE_PENDING: ["COMPLIANCE_APPROVED", "COMPLIANCE_REJECTED"],
    COMPLIANCE_APPROVED: ["PAYMENT_PENDING"],
    COMPLIANCE_REJECTED: [],
    PAYMENT_PENDING: ["PAID", "FAILED"],
    PAID: [],
    FAILED: []
};

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
app.use(express.json());

app.get('/', (req, res) => {
    res.send('Server running');
});

app.post('/hello', (req, res) => {
    res.json({
        message: "Hello from backend"
    })
})

app.post('/transfers', (req, res) => {
    const { sender, recipient, amount, currency } = req.body;
    const transfer = {
        id: randomUUID(),
        sender,
        recipient,
        amount,
        currency,
        state: "CREATED",
        create: new Date()
    };
    transfers.push(transfer);
    res.status(201).json(transfer);
});

app.get('/transfers/:id', (req, res) => {
    const {id} = req.params;
    const transfer = transfers.find(t => t.id === id);

    if (!transfer){
        return res.status(404).json({message: "Transfer not found"});
    }
    res.json(transfer);
});

app.post("/transfers/:id/quote", (req, res) => {
    const transfer = transfers.find(t => t.id === req.params.id);

    if (!transfer){
        return res.status(404).json({message: "Transfer not found"});
    }

    try {
        const quote = generateQuote(transfer.amount);

        transfer.quote = quote;
        changeState(transfer, STATES.QUOTED);
        res.json(transfer);
    } catch (error) {
        res.status(400).json({message: error.message});
    }
});

app.post("/transfers/:id/confirm", (req, res) => {
    const transfer = transfers.find(t => t.id === req.params.id);

    if(!transfer){
        return res.status(404).json({message: "Transfer not found"});
    }

    if (new Date() > new Date(transfer.quote.expiresAt)){
        return res.status(400).json({message: "Quote has expired"});
    }
    try {
        transfer.confirmedQuote = { ...transfer.quote };
        delete transfer.quote; //old quote is removed after confirmation 
        //from now on after confirm only the confimedQuote will be used for payment
        changeState(transfer, STATES.CONFIRMED);
        // res.json(transfer);

        const complianceResult = complianceCheck(transfer);

        transfer.compliance = {
            decision: complianceResult.decision,
            reason: complianceResult.reason,
            checkedAt: new Date()
        }

        if (complianceResult.decision === "APPROVE"){
            changeState(transfer, STATES.COMPLIANCE_APPROVED);
        }
        else if (complianceResult.decision === "REJECT"){
            changeState(transfer, STATES.COMPLIANCE_REJECTED);
        }
        else if (complianceResult.decision === "MANUAL"){
            changeState(transfer, STATES.COMPLIANCE_PENDING);
        }
        else {
            changeState(transfer, STATES.FAILED);
        }
        res.json(transfer);

    } catch (error) {
        res.status(400).json({message: error.message});
    }
});

app.post("/transfers/:id/compliance/approve", (req, res) => {
    const transfer = transfers.find(t => t.id === req.params.id);

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

        res.json(transfer);
    } catch (error) {
        res.status(400).json({message: error.message});
    }
});

app.post("/transfers/:id/compliance/reject", (req, res) => {
    const transfer = transfers.find(t => t.id === req.params.id);

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

        res.json(transfer);
    } catch (error) {
        res.status(400).json({message: error.message});
    }
});

app.post("/transfers/:id/payment", (req, res) => {
    const transfer = transfers.find(t => t.id === req.params.id);

    if (!transfer){
        return res.status(404).json({message: "Transfer not found"});
    }
    if (transfer.state !== STATES.COMPLIANCE_APPROVED){
        return res.status(400).json({message: "Transfer not approved for payment"});
    }
    try {
        changeState(transfer, STATES.PAYMENT_PENDING);
        setTimeout(() => {
            const success = Math.random() > 0.3;

            try {
                changeState(transfer, success ? STATES.PAID : STATES.FAILED);
            } catch (error) {
                console.error(error.message);
            }
        }, 3000);

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