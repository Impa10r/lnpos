import { mongoose } from 'mongoose';

const counterSchema = new mongoose.Schema(
  {
    ip: { type: String, index: { unique: true } },
    country: { type: String, required: false },
  },
);

const model = mongoose.model('counters', counterSchema);
export default model;
