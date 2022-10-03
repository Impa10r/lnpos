import { mongoose } from 'mongoose';

const keySchema = new mongoose.Schema(
  {
    id: { type: String, index: { unique: false } },
    dateTime: { type: Number, index: { unique: false } },
    currency: { type: String, required: true },
    amountFiat: { type: Number, required: true },
    exchangeRate: { type: Number, required: true },
    exchange: { type: String, required: true },
    amountSat: { type: Number, required: true },
    memo: { type: String, required: false },
  },
);

const model = mongoose.model('invoices', keySchema);
export default model;
