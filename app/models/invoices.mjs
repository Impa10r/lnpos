import { mongoose } from 'mongoose';

const keySchema = new mongoose.Schema(
  {
    id: { type: String, index: { unique: false } },
    timeCreated: { type: Number, index: { unique: false } },
    timePaid: { type: Number, required: false },
    currencyFrom: { type: String, required: true },
    currencyTo: { type: String, required: true },
    amountFiat: { type: Number, required: true },
    exchangeRate: { type: Number, required: true },
    exchange: { type: String, required: true },
    amountSat: { type: Number, required: true },
    memo: { type: String, required: false },
    lang: { type: String, required: true },
  },
);

const model = mongoose.model('invoices', keySchema);
export default model;
