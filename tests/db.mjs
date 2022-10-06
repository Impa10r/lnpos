import assert from 'assert';
import DataBase from '../app/mongo.mjs';

describe('new DataBase()', function () {
  const db = new DataBase(true);
  describe('readyState', function () {
    it('should return 1 when connection is active', function () {
      assert.equal(db.db.readyState, 1);
    });
  });
});

