import assert from 'assert';
import DataBase from '../app/mongo.mjs';

describe('new DataBase()', () => {
  const db = new DataBase(true);
  describe('readyState', () => {
    it('should return 1 when connection is active', () => {
      assert.equal(db.db.readyState, 1);
    });
  });
});
