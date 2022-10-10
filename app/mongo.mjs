import { mongoose } from 'mongoose';
import {} from 'dotenv/config';

export default class DataBase {
  constructor(quiet = false) {
    // Set up default mongoose connection
    const credentials = process.env.DB_USER ? `${process.env.DB_USER}:${process.env.DB_PASS}@` : '';
    const MONGO_URI = `mongodb://${credentials}${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}?authSource=admin`;
    // mongoose.Promise = global.Promise;
    mongoose.set('bufferCommands', false);
    mongoose.connect(MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    })
      .then(() => { if (!quiet) console.info('DB Connection Successfull');})
      .catch((error) => { throw new Error(error); })

    // Get the default connection
    this.db = mongoose.connection;
    // Bind connection to error event (to get notification of connection errors)
    this.db.on('error', console.error.bind(console, 'MongoDB connection error:'));
  }

  // case insensitive
  async findOne(collection, query) {
    return this.db.collection(collection).findOne(query);
  }

  async updateOne(collection, query, update) {
    return this.db.collection(collection).updateOne(query, update, { upsert: true });
  }

  async deleteOne(collection, query) {
    return this.db.collection(collection).deleteOne(query);
  }

  async deleteMany(collection, query) {
    return this.db.collection(collection).deleteMany(query);
  }
}
