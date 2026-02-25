const express = require('express');

const {randomUUID} = require ('crypto');
const { create } = require('domain');
const transfers= [];

const STATES={
    CREATED: "CREATED",
    QUOTED: "QUOTED",
    CONFIRMED: "CONFIRMED",
    PAID: "PAID",
    FAILED: "FAILED"
};

const allowedTransitions = {
    CREATED: ["QUOTED"],
    QUOTED: ["CONFIRMED"],
    CONFIRMED: ["PAID", "FAILED"],
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
        res.json(transfer);
    } catch (error) {
        res.status(400).json({message: error.message});
    }
});
app.listen(3000, () => {
    console.log('Server is running on port 3000');
});