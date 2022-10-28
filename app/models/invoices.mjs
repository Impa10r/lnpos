import { mongoose } from 'mongoose';

const keySchema = new mongoose.Schema(
  {
    invoiceId: { type: String, index: { unique: false } },
    userName: { type: String, index: { unique: false } },
    timeCreated: { type: Number, required: true },
    timePresented: { type: Number, required: true }, // 0 = in transit
    timePaid: { type: Number, required: true }, // 0 = in transit, -1 = failed
    currencyFrom: { type: String, required: true },
    currencyTo: { type: String, required: true },
    amountFiat: { type: Number, required: true },
    exchangeRate: { type: Number, required: true },
    exchange: { type: String, required: true },
    amountSat: { type: Number, required: true },
    memo: { type: String, required: false },
    lang: { type: String, required: true },
    timeHedged: { type: Number, required: false },
    executionPrice: { type: Number, required: false },
    amountTo: { type: Number, required: false },
    feeAmount: { type: Number, required: false },
    feeCurrency: { type: String, required: false },
    payee: { type: String, required: false },
  },
);

const model = mongoose.model('invoices', keySchema);
export default model;
