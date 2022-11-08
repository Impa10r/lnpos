import { mongoose } from 'mongoose';

const counterSchema = new mongoose.Schema(
  {
    ip: { type: String, index: { unique: true } },
  },
);

const model = mongoose.model('counters', counterSchema);
export default model;
