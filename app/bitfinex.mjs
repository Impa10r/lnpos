/* eslint-disable no-underscore-dangle */
/* eslint-disable class-methods-use-this */
import fetch from 'node-fetch';
import crypto from 'crypto';
import axios from 'axios';
import WebSocket from 'ws';
import { Resolver } from 'dns';
//import WSv2 from './lib/WSv2.js';

export default class Gateway {
  constructor(apiKey, apiSecret) {
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.minInvoiceAmount = 0.000001;
    this.maxInvoiceAmount = 5;
    this.minTradeAmount = 0.00006;
    this.tradingFeeTaker = 0.002;
    this.lastNonce = Date.now() * 1000;
  }

  async restPublic(apiPath, params) {
    return axios.get(`https://api-pub.bitfinex.com/v2/${apiPath}`, params);
  }

  getNonce() {
    const now = Date.now() * 1000;
    this.lastNonce = (this.lastNonce < now) ? now : this.lastNonce + 1;
    return this.lastNonce;
  }

  async getStatus() {
    return axios.get('https://api-pub.bitfinex.com/v2/platform/status');
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

  simulateSell(fiatAmount, book) {
    let i = 0;
    let btcReceived = 0;
    let leftToSell = fiatAmount * (1 + this.tradingFeeTaker);

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
    return btcReceived;
  }

  async convertProceeds(currencyTo) {
    const promise = new Promise((resolve, reject) => {
      const timeLimit = Date.now() + 10 * 60 * 1000; // 10 minutes
      const authNonce = this.getNonce().toString();
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

      wss.on('message', (msg) => {
        const data = JSON.parse(msg);
        if (data[1] === 'wu' && data[2][0] === 'exchange' && data[2][2] >= 0) {
          const amount = data[2][2]; // balance total amount
          switch (data[2][1]) { // balance currency
            case 'LNX':
              if (amount > 0) {
                resolve(true); // assume the deposit was just received
                if (currencyTo !== 'LNX') {
                  // console.log('transfer', amount);
                  this.transferBetweenWallets('exchange', 'exchange', 'LNX', 'BTC', amount)
                    .then((r) => r.json())
                    .then((json) => {
                      if (json[0] === 'error') {
                        console.error(json);
                      }
                    });
                }
              }
              break;
            case 'BTC':
              if (currencyTo !== 'BTC' && amount >= this.minTradeAmount) {
                console.log('sell BTC' + currencyTo, amount);
                this.placeMarketOrder(`tBTC${currencyTo}`, -amount)
                  .then((r) => r.json())
                  .then((json) => {
                    if (json[0] === 'error') {
                      console.error(json);
                    }
                  });
              }
              break;
            default:
              if (Date.now() > timeLimit) {
                wss.close();
                resolve(false);
              }
          }
        }
      });
    });

    return promise;
  }
}
