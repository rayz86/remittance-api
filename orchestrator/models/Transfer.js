const mongoose = require("mongoose");

const TransferSchema = new mongoose.Schema({
  sender: Object,
  recipient: Object,
  amount: Number,
  currency: String,
  state: String,
  quote: Object,
  confirmedQuote: Object,
  compliance: Object,
  partnerPayoutId: String,

  createdAt: {
    type: Date,
    default: Date.now
  }
});

TransferSchema.index(
  { partnerPayoutId: 1 },
  { unique: true, sparse: true } //not null validation and uniqueness
);

module.exports = mongoose.model("Transfer", TransferSchema);