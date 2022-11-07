import fetch from 'node-fetch';
import crypto from 'crypto';

class Bitfinex {
  constructor(apiKey, apiSecret) {
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.lastNonce = Date.now() * 1000;
  }

  getNonce() {
    const now = Date.now() * 1000;
    this.lastNonce = (this.lastNonce < now) ? now : this.lastNonce + 1;
    return this.lastNonce;
  }

  async restAuth(apiPath, body) {
    const nonce = this.getNonce();
    const payload = `/api/${apiPath}${nonce}${JSON.stringify(body)}`;
    const sig = crypto.createHmac('sha384', this.apiSecret).update(payload).digest('hex');

    return fetch(`https://api.bitfinex.com/${apiPath}`, {
      method: 'POST',
      body: JSON.stringify(body),
      meta: { aff_code: 'TuVr9K55M' },
      headers: {
        'Content-Type': 'application/json',
        'bfx-nonce': nonce.toString(),
        'bfx-apikey': this.apiKey,
        'bfx-signature': sig,
      },
    });
  }

  async transferBetweenWallets(from, to, currency, currencyTo, amount) {
    const body = {
      from,
      to,
      currency,
      currencyTo,
      amount: amount.toString(),
    };

    console.log(body);

    return this.restAuth('v2/auth/w/transfer', body);
  }

  async getUserInfo() {
    return this.restAuth('v2/auth/r/info/user', {});
  }
}

const bf = new Bitfinex('', '');

bf.transferBetweenWallets('exchange', 'exchange', 'LNX', 'BTC', 0.00001)
  .then((r) => r.json())
  .then((json) => console.log(json));