/* eslint-disable no-underscore-dangle */
/* eslint-disable class-methods-use-this */
import crypto from 'crypto';
import WebSocket from 'ws';
import axios from 'axios';

export default class Kraken {
  constructor(apiKey, apiSecret) {
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.minInvoiceAmount = 0.00001; // 1000 sats
    this.maxInvoiceAmount = 1;
    this.minTradeAmount = 0.0001;
    this.tradingFeeTaker = 0.0026;
    this.lastNonce = Date.now() * 1000;
  }

  async QueryPublicEndpoint(endPointName, inputParameters) {
    let jsonData;
    const baseDomain = 'https://api.kraken.com';
    const publicPath = '/0/public/';
    const apiEndpointFullURL = baseDomain + publicPath + endPointName + "?" + inputParameters;

    jsonData = await axios.get(apiEndpointFullURL);
    return jsonData.data;
  }

  getNonce() {
    const now = Date.now() * 1000;
    this.lastNonce = (this.lastNonce < now) ? now : this.lastNonce + 1;
    return this.lastNonce;
  }

  // Create a signature for a request
  getSignature(apiPath, endPointName, nonce, apiPostBodyData) {
    const apiPost = nonce + apiPostBodyData;
    const secret = Buffer.from(this.apiSecret, 'base64');
    const sha256 = crypto.createHash('sha256');
    const hash256 = sha256.update(apiPost).digest('binary');
    const hmac512 = crypto.createHmac('sha512', secret);
    const signatureString = hmac512.update(apiPath + endPointName + hash256, 'binary').digest('base64');
    return signatureString;
  }

  async QueryPrivateEndpoint(endPointName, inputParameters) {
    const baseDomain = 'https://api.kraken.com';
    const privatePath = '/0/private/';

    const apiEndpointFullURL = baseDomain + privatePath + endPointName;
    const nonce = this.getNonce();
    const apiPostBodyData = "nonce=" + nonce + "&" + inputParameters;

    const signature = this.getSignature(privatePath, endPointName, nonce, apiPostBodyData);

    const httpOptions = { headers: { 'API-Key': this.apiKey, 'API-Sign': signature } };

    const jsonData = await axios.post(apiEndpointFullURL, apiPostBodyData, httpOptions);
    return jsonData.data;
  }

  async simulateSell(currency, amount) {
    const promise = new Promise((resolve, reject) => {
      this.QueryPublicEndpoint('Ticker', 'pair=xbt' + currency.toLowerCase())
        .then((data) => {
          if (data.error[0]) return reject(new Error('Kraken simulateSell: ' + data.error[0]));
          const whatToSell = amount * (1 + this.tradingFeeTaker);
          const x = data.result['XXBTZ' + currency];
          const bidPrice = x.b[0];
          const btcReceived = whatToSell / bidPrice;
          resolve(Math.round(btcReceived * 100000000));
        });
    });
    return promise;
  }

  async convertProceeds(amountBtc, currencyTo, res) {
    const promise = new Promise((resolve, reject) => {
      const timeLimit = Date.now() + 10 * 60 * 1000; // 10 minutes
      this.QueryPrivateEndpoint('GetWebSocketsToken', '')
        .then((data) => {
          if (data.error[0]) return reject(new Error('Kraken convertProceeds: ' + data.error[0]));
          const webSocketToken = data.result.token;
          const wss = new WebSocket('wss://ws-auth.kraken.com/');

          wss.on('open', () => {
            wss.send(`{ "event": "subscribe", "subscription": { "name": "balances", "token": "${webSocketToken}"}}`);
            wss.send(`{ "event": "subscribe", "subscription": { "name": "ownTrades", "token": "${webSocketToken}"}}`);
          });
          wss.on('error', (err) => { reject(new Error('Kraken convertProceeds: ' + err)); });

          let transferComplete = false;
          let depositComplete = false;
          let t = 0;

          wss.on('message', (msg) => {
            let data = '';
            try {
              data = JSON.parse(msg);
            } catch (e) {
              return; // not JSON
            }

            console.log(data);

            switch (data.event) {
              case 'heartbeat': // every second
                if (Date.now() > timeLimit) {
                  wss.close();
                  return resolve(0);
                }
                t += 1;
                if (t == 15) {
                  t = 0;
                  wss.close(); return resolve(0);
                  // res.write('.');
                }
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
                      if (amount > 0 && currencyTo !== 'LNX') this.transferBetweenWallets('exchange', 'exchange', 'LNX', 'BTC', amount);
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
    });
    return promise;
  }

  async getFirstTrade(currency, fromTime) {
    const promise = new Promise((resolve, reject) => {
      this.QueryPrivateEndpoint('TradesHistory', 'start=' + fromTime)
        .then((data) => {
          if (data.error[0] === 'error') return reject(new Error('Kraken getFirstTrade: ' + data.error[0]));
          let i = 0;
          const pair = 'xbt' + currency.toLowerCase();
          const names = Object.getOwnPropertyNames(data.result.trades);
          while (i < data.result.count) {
            const trade = trades[names[i]];
            if (trade.pair === pair) {
              return resolve({
                amount: parseFloat(trade.cost),
                time: trade.time,
                price: parseFloat(trade.price),
                feeAmount: parseFloat(trade.fee),
                feeCurrency: currencyTo,
              });
            }
            i += 1;
          }
          resolve(null);
        });
    });
    return promise;
  }

  async getLightningDeposit(txid, fromTime, toTime) {
    const promise = new Promise((resolve, reject) => {
      this.getMovements('LNX', fromTime, toTime)
        .then((r) => r.json())
        .then((json) => {
          if (json[0] === 'error') return reject(new Error('Kraken getLightningDeposit: ' + json[2]));
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
          if (j[0] === 'error') return reject(new Error('Kraken generateLightningInvoice: ' + j[2]));
          const depositAddress = j[4][4];
          this.getLightningInvoice(amount)
            .then((r) => r.json())
            .then((json) => {
              if (json[0] === 'error') return reject(new Error('Kraken generateLightningInvoice: ' + json[2]));
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
}
