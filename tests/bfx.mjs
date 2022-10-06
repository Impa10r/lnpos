import assert from 'assert';
import Gateway from '../app/bitfinex.mjs';

describe('new Gateway()', () => {
  const gw = new Gateway(null, null);
  describe('getStatus()', () => {
    it('should return 1 when Bitfinex is operational', () => {
      gw.getStatus()
        .then((r) => r.json())
        .then((json) => {
          assert.equal(json[0], 1);
        });
    });
  });
});
