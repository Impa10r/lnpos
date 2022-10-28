import { mongoose } from 'mongoose';

const keySchema = new mongoose.Schema(
  {
    id: { type: String, index: { unique: true } },
    userName: { type: String, index: { unique: false } },
    payee: { type: String, required: false },
    email: { type: String, required: true },
    timeZone: { type: String, required: false },
    key: { type: String, index: { unique: true } },
    secret: { type: String, required: true },
    exchange: { type: String, required: true },
    currencyFrom: { type: String, required: true },
    currencyTo: { type: String, required: true },
    lang: { type: String, required: true },
    parentId: { type: String, required: false },
  },
);

const model = mongoose.model('keys', keySchema);
export default model;
