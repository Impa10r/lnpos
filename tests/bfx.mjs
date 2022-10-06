import assert from 'assert';
import Gateway from '../app/bitfinex.mjs';

describe('new Gateway()', function () {
  const gw = new Gateway(null, null);
  describe('getStatus()', function () {
    it('should return 1 when Bitfinex is operational', function () {
      gw.getStatus()
        .then((r) => r.json())
        .then((json) => {
          assert.equal(json[0], 1);
        });
    });
  });
}); 

