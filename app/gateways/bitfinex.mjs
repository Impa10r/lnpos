/* eslint-disable no-underscore-dangle */
/* eslint-disable class-methods-use-this */
import fetch from 'node-fetch';
import crypto from 'crypto';
import WebSocket from 'ws';

export default class Bitfinex {
  constructor(apiKey, apiSecret) {
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.minInvoiceAmount = 0.000001;
    this.maxInvoiceAmount = 5;
    this.minTradeAmount = 0.00006;
    this.tradingFeeTaker = 0.002;
    this.lastNonce = Date.now() * 1000;
  }

  async restPublic(apiPath) {
    //return axios.get(`https://api-pub.bitfinex.com/v2/${apiPath}`, params);
    return fetch(`https://api-pub.bitfinex.com/v2/${apiPath}`);

  }

  async getStatus() {
    return this.restPublic('platform/status');
    //return axios.get('https://api-pub.bitfinex.com/v2/platform/status');
  }

  async restAuth(apiPath, body) {
    const now = Date.now() * 1000;
    this.lastNonce = (this.lastNonce < now) ? now : this.lastNonce + 1;
    const payload = `/api/${apiPath}${this.lastNonce}${JSON.stringify(body)}`;
    const sig = crypto.createHmac('sha384', this.apiSecret).update(payload).digest('hex');


console.log(Date.now(), this.lastNonce);

    return fetch(`https://api.bitfinex.com/${apiPath}`, {
      method: 'POST',
      body: JSON.stringify(body),
      meta: { aff_code: 'TuVr9K55M' },
      headers: {
        'Content-Type': 'application/json',
        'bfx-nonce': this.lastNonce.toString(),
        'bfx-apikey': this.apiKey,
        'bfx-signature': sig,
      },
    });
  }

  async getWallets() {
    return this.restAuth('v2/auth/r/wallets', {});
  }

  async getUserInfo() {
    return this.restAuth('v2/auth/r/info/user', {});
  }

  async getDepositAddr(curr, wallet) {
    const body = {
      wallet,
      method: curr,
      op_renew: 0,
    };
    return this.restAuth('v2/auth/w/deposit/address', body);
  }

  async getLightningInvoice(amount) {
    const body = {
      wallet: 'exchange',
      currency: 'LNX',
      amount: amount.toFixed(8),
    };
    return this.restAuth('v2/auth/w/deposit/invoice', body);
  }

  async placeMarketOrder(symbol, amount) {
    const body = {
      type: 'EXCHANGE MARKET',
      symbol,
      amount: amount.toString(),
    };
    return this.restAuth('v2/auth/w/order/submit', body);
  }

  async transferBetweenWallets(from, to, currency, currency_to, amount) {
    const body = {
      from,
      to,
      currency,
      currency_to,
      amount: amount.toString(),
    };
    return this.restAuth('v2/auth/w/transfer', body);
  }

  async getMovements(currency, start, end, limit) {
    const body = {
      start,
      end,
      limit,
    };
    return this.restAuth(`v2/auth/r/movements/${currency}/hist`, body);
  }

  async getTrades(symbol, start, end, limit = 25, sort = -1) {
    const body = {
      start,
      end,
      limit,
      sort,
    };
    return this.restAuth(`v2/auth/r/trades/${symbol}/hist`, body);
  }

  async getBook(symbol) {
    return this.restPublic(`book/${symbol}/R0`);
  }

  async simulateSell(currency, amount) {
    const promise = new Promise((resolve, reject) => {
      this.getBook(`tBTC${currency}`)
        .then((r) => r.json())
        .then((book) => {
          //if (result.message) return reject(new Error(`Bitfinex simulateSell: ${result.message}`));
          //const book = result.data;
          let i = 0;
          let btcReceived = 0;
          let leftToSell = amount * (1 + this.tradingFeeTaker);

          while (i < book.length) {
            const currentBidSize = book[i][2];
            const currentBidPrice = book[i][1];
            if (currentBidSize > 0 && leftToSell > 0) { // look only at bids
              const fiatForSale = currentBidSize * currentBidPrice;
              if (fiatForSale >= leftToSell) { // current bid is enough
                btcReceived += leftToSell / currentBidPrice;
                leftToSell = 0;
              } else {
                btcReceived += fiatForSale / currentBidPrice;
                leftToSell -= fiatForSale;
              }
            }
            i += 1;
          }
          resolve(Math.round(btcReceived * 100000000));
        })
        .catch((error) => {
          return reject(new Error(`Bitfinex simulateSell: ${error}`));
        });
    });
    return promise;
  }

  async convertProceeds(amountBtc, currencyTo, res) {
    const promise = new Promise((resolve, reject) => {
      const timeLimit = Date.now() + 10 * 60 * 1000; // 10 minutes
      const now = Date.now() * 1000;
      this.lastNonce = (this.lastNonce < now) ? now : this.lastNonce + 1;
      const authNonce = this.lastNonce.toString();
      const authPayload = `AUTH${authNonce}`;
      const authSig = crypto.createHmac('sha384', this.apiSecret).update(authPayload).digest('hex');

      const payload = {
        apiKey: this.apiKey,
        authSig,
        authNonce,
        authPayload,
        event: 'auth', // The connection event, will always equal 'auth'
      };

      const wss = new WebSocket('wss://api.bitfinex.com/ws/2');
      wss.on('open', () => wss.send(JSON.stringify(payload)));
      wss.on('error', (err) => { reject(err); });

      let transferComplete = false;
      let depositComplete = false;

      wss.on('message', (msg) => {
        let data = '';
        try {
          data = JSON.parse(msg);
        } catch (e) {
          return; // not JSON
        }
        // console.log(data);
        switch (data[1]) {
          case 'hb': // heartbeat
            if (Date.now() > timeLimit) {
              wss.close();
              return resolve(0);
            }
            res.write('.');
            break;
          case 'n': // notification
            switch (data[2][1]) {
              case 'deposit_complete':
                // console.log(data[2][4].invoice.invoice);
                if (data[2][4].currency === 'LNX' && parseFloat(data[2][4].amount) === amountBtc) {
                  depositComplete = true;
                  if (currencyTo === 'LNX') wss.close(); // all done
                  resolve(data[2][0]); // Bitfinex timestamp
                }
                break;
              case 'wallet_transfer':
                transferComplete = true;
                if (currencyTo === 'BTC' && depositComplete) wss.close(); // all done
                break;
              default:
            }
            break;
          case 'te': // trade executed
            if (data[2][0] === `tBTC${currencyTo}` && transferComplete && depositComplete) wss.close(); // all done
            break;
          case 'wu': // wallet update
            if (data[2][0] === 'exchange') {
              const amount = data[2][2]; // balance total amount
              switch (data[2][1]) { // balance currency
                case 'LNX':
                  if (amount > 0 && currencyTo !== 'LNX') {
                    this.transferBetweenWallets('exchange', 'exchange', 'LNX', 'BTC', amount)
                      .then((r) => r.json())
                      .then((json) => {
                        if (json[0] === 'error') console.error(json[2]);
                      });
                  }
                  break;
                case 'BTC':
                  if (currencyTo !== 'BTC' && amount > 0 && transferComplete && depositComplete) {
                    if (amount < this.minTradeAmount) wss.close(); // cannot trade
                    else this.placeMarketOrder(`tBTC${currencyTo}`, -amount);
                  }
                  break;
                default:
              }
            }
            break;
          default:
        }
      });
    });
    return promise;
  }

  async getFirstTrade(currency, fromTime) {
    const promise = new Promise((resolve, reject) => {
      this.getTrades(`tBTC${currency}`, fromTime, Date.now(), 1, 1)
        .then((r) => r.json())
        .then((json) => {
          if (json[0] === 'error') return reject(new Error(`Bitfinex getFirstTrade: ${json[2]}, ${currency}`));
          if (json.length === 1) {
            resolve({
              amount: json[0][4],
              time: json[0][2],
              price: json[0][5],
              feeAmount: json[0][9],
              feeCurrency: json[0][10],
            });
          } else resolve(null);
        });
    });
    return promise;
  }

  async getLightningDeposit(txid, fromTime, toTime) {
    const promise = new Promise((resolve, reject) => {
      this.getMovements('LNX', fromTime, toTime)
        .then((r) => r.json())
        .then((json) => {
          if (json[0] === 'error') return reject(new Error(`Bitfinex getLightningDeposit: ${json[2]}`));
          let received = null;
          let i = json.length;
          while (i > 0) {
            i -= 1;
            if (json[i][20] === txid) received = json[i][5];
          }
          resolve(received);
        });
    });
    return promise;
  }

  async generateLightningInvoice(amount) {
    const promise = new Promise((resolve, reject) => {
      this.getDepositAddr('LNX', 'exchange')
        .then((r) => r.json())
        .then((j) => {
          if (j[0] === 'error') return reject(new Error(`Bitfinex generateLightningInvoice: ${j[2]}`));
          const depositAddress = j[4][4];
          this.getLightningInvoice(amount)
            .then((r) => r.json())
            .then((json) => {
              if (json[0] === 'error') return reject(new Error(`Bitfinex generateLightningInvoice: ${json[2]}`));
              resolve({
                txid: json[0],
                invoice: json[1],
                depositAddress,
              });
            });
        });
    });
    return promise;
  }

  async getUserName() {
    const promise = new Promise((resolve, reject) => {
      this.getUserInfo()
        .then((r) => r.json())
        .then((json) => {
          if (json[0] === 'error') return reject(new Error(`Bitfinex getUserName: ${json[2]}`));
          resolve(json[1].toLowerCase());
        });
    });
    return promise;
  }
}
