/* eslint-disable prefer-destructuring */
/* eslint-disable no-console */
/* eslint-disable import/extensions */
/* eslint-disable prefer-template */
/* eslint-disable no-underscore-dangle */
import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import bodyParser from 'body-parser';
import consolidate from 'consolidate';
import qr from 'qrcode';
import https from 'https';
import Keys from './models/keys.mjs';
import Invoices from './models/invoices.mjs';
import Gateway from './bitfinex.mjs';
import DataBase from './mongo.mjs';

function wait(milleseconds) {
  return new Promise((resolve) => setTimeout(resolve, milleseconds))
}

async function waitPayment(db, req, res) {
  const lang = req.body.lang;
  const id = req.body.id;
  const timeCreated = parseInt(req.body.timeCreated);

  let i = 10; // wait 10 seconds
  while (i > 0) {
    db.findOne('invoices', { $and: [{ id }, { timeCreated }] })
      .then((record) => {
        if (i > 0 && record) {
          i = 0;
          req.setLocale(lang);
//          const dateTimeCreated = new Date(timeCreated).toISOString();
//          const dateTimePaid = new Date(record.timePaid).toISOString();
          const dateTimeCreated = new Date(timeCreated).toLocaleString();
          const dateTimePaid = new Date(record.timePaid).toLocaleString();
          return res.render('receipt', {
            currentLocale: lang,
            record,
            dateTimeCreated,
            dateTimePaid,
          });
        }
      });
    i -= 1;
    await wait(1000);
  }
}

export default class Server {
  showError(req, res, errCode, err) {
    if (err) console.error(err);
    res.render('error', {
      currentLocale: req.locale,
      error: 'Error: ' + req.__(errCode),
    });
  }

  renderRequest(req, res) {
    const id = req.params.id;
    this.db.findOne('keys', { id: id.toLowerCase() })
      .then((record) => {
        const lang = req.query.lang || record.lang;
        const currencyFrom = req.query.currency || record.currencyFrom;
        const amountOptions = req.query.amount ? 'value="' + req.query.amount + '" readonly' : '';
        const memoOptions = req.query.memo ? 'value="' + req.query.memo + '" readonly' : '';
        const buttonOptions = typeof req.query.amount !== 'undefined' ? 'hidden' : '';
        const labelOptions = typeof req.query.amount !== 'undefined' ? '' : 'hidden';

        req.setLocale(lang);
        res.render('request', {
          currentLocale: lang,
          id,
          currencyFrom,
          amountOptions,
          memoOptions,
          buttonOptions,
          labelOptions,
        });
      })
      .catch((err) => {
        if (id.length === 10) {
          res.render('index', {
            currentLocale: res.locale,
            refCode: id,
          });
        } else {
          this.showError(req, res, 'error_id_not_found', err);
        }
      });
  }

  constructor({ i18nProvider }) {
    this.gw = null;
    this.db = new DataBase();

    const limiter = rateLimit({
      windowMs: 1 * 60 * 1000, // 1 minute
      max: 20, // limit each IP to 100 requests per windowMs
    });

    this.express = express();
    this.express.disable('x-powered-by');
    this.express.set('view engine', 'html');
    this.express.use(bodyParser.json());
    this.express.engine('html', consolidate.mustache);
    this.express.use(i18nProvider.init);
    this.express.use((req, res, next) => {
      // mustache helper
      res.locals.i18n = () => (text, render) => req.__(text, render);
      res.locals.i18np = () => (text, render) => {
        const parts = text.split(',');
        if (parts.length > 1) {
          const renderedCount = render(parts[1]);
          return req.__n(parts[0], renderedCount, render);
        }
      };
      next();
    });
    this.express.use(express.static('views/img'));
    this.express.use(bodyParser.urlencoded({ extended: false }));
    this.express.use(helmet());
    this.express.use(limiter);

    this.express.get('/robots.txt', (req, res) => {
      res.type('text/plain');
      res.send('User-agent: *\nAllow: /$\nDisallow: /');
    });

    this.express.get('/:id/:amount/:memo?', (req, res) => {
      const amount = req.params.amount;
      req.query.amount = parseFloat(amount);
      const currency = amount.substring(amount.length - 3).toUpperCase();
      if (['USD', 'EUR', 'GBP', 'JPY', 'CNH', 'MXN'].includes(currency)) req.query.currency = currency;
      if (req.params.memo) req.query.memo = req.params.memo;
      return this.renderRequest(req, res);
    });

    this.express.get('/:id?', (req, res) => {
      const id = req.params.id;
      const browserLang = req.headers['accept-language'] ? req.headers['accept-language'].substring(0, 2) : 'en';
      const url = req.protocol + '://' + req.get('host') + '/' + req.query.id;

      if (!res.locale && ['es', 'ru'].includes(browserLang)) req.setLocale(browserLang);

      if (id) {
        switch (id) {
          case 'a4':
            qr.toDataURL(url, (err, src) => {
              if (err) this.showError(req, res, 'error_qr', err);
              res.render('a4', {
                currentLocale: res.locale,
                src,
              });
            });
            break;
          default:
            this.renderRequest(req, res);
        }
      } else {
        res.render('index', {
          currentLocale: res.locale,
          refCode: 'TuVr9K55M',
        });
      }
    });

    this.express.post('/ref', (req, res) => {
      const lang = req.body.lang;
      const code = req.body.refCode;
      req.setLocale(lang);
      if (code.length !== 10)
        return this.showError(req, res, 'error_invalid_ref');
      const desc = req.get('host') + '/' + code;
      const url = req.protocol + '://' + desc;
      qr.toDataURL(url, (err, src) => {
        if (err) this.showError(req, res, 'error_qr', err);
        res.render('ref', {
          currentLocale: lang,
          url,
          desc,
          src,
        });
      });
    });

    this.express.post('/receipt', (req, res) => {
      waitPayment(this.db, req, res);
    });

    this.express.post('/add', (req, res) => {
      const lang = req.body.lang;
      req.setLocale(lang);
      this.gw = new Gateway(req.body.apiKey, req.body.apiSecret);
      this.gw.getUserInfo()
        .then((r) => r.json())
        .then((json) => {
          if (json[0] === 'error') {
            this.showError(req, res, 'error_invalid_keys');
          } else {
            const id = json[2].toLowerCase();
            // Delete previous to avoid duplicates
            this.db.deleteMany('keys', { id: new RegExp(`^${id}$`, 'i') }) // case insensitive
              .then(r => {
                const data = new Keys({
                  id,
                  key: req.body.apiKey,
                  secret: req.body.apiSecret,
                  exchange: req.body.exchange,
                  currencyFrom: req.body.currencyFrom,
                  currencyTo: req.body.currencyTo,
                  lang,
                });
                data.save()
                  .then(() => {
                    // check that it was saved ok
                    this.db.findOne('keys', { id })
                      .then((record) => {
                        if (!record) {
                          this.showError(req, res, 'error_database_down');
                        } else {
                          const i = record.id;
                          const desc = req.get('host') + '/' + i;
                          const url = req.protocol + '://' + desc;
                          res.render('add', {
                            currentLocale: lang,
                            url,
                            desc,
                            id: i,
                          });
                        }
                      });
                  });
              })
              .catch((err) => {
                this.showError(req, res, 'error_database_down', err);
              });
          }
        })
        .catch((err) => {
          this.showError(req, res, 'error_exchange_down', err);
        });
    });

    this.express.post('/pay', (req, res) => {
      const lang = req.body.lang;
      const id = req.body.id.toLowerCase();
      const currency = req.body.currency;
      const memo = req.body.memo;
      const amountFiat = parseFloat(req.body.amountFiat);

      req.setLocale(lang);

      this.db.findOne('keys', { id })
        .then((record) => {
          this.gw = new Gateway(record.key, record.secret);
          this.gw.getBook('tBTC' + currency)
            .then((result) => {
              const amountBTC = this.gw.simulateSell(parseFloat(amountFiat), result.data);
              const wap = amountFiat / amountBTC;
              const currencyTo = record.currencyTo;

              if (amountBTC > this.gw.maxInvoiceAmount) { return this.showError(req, res, 'amount_too_large'); }
              if (amountBTC < this.gw.minInvoiceAmount) { return this.showError(req, res, 'amount_too_small'); }

              if (req.body.button === 'link') {
                const desc = req.get('host') + '/' + id + '/' + amountFiat + (memo ? '/' + memo.replace(/\s/g, "%20") : '');
                const url = req.protocol + '://' + desc;
                return res.render('payremote', {
                  currentLocale: lang,
                  url,
                  desc,
                });
              }

              this.gw.getDepositAddr('LNX', 'exchange')
                .then((r) => r.json())
                .then((j) => {
                  if (j[0] === 'error') {
                    return this.showError(req, res, j[2], j);
                  }
                  this.gw.getLightningInvoice(amountBTC)
                    .then((r) => r.json())
                    .then((json) => {
                      if (json[0] === 'error') {
                        return this.showError(req, res, json[2], json);
                      }
                      const rate = wap.toFixed(2);
                      const amountSat = (amountBTC * 100000000).toFixed(0);
                      const invoice = json[1];

                      qr.toDataURL(invoice, (err, src) => {
                        if (err) this.showError(req, res, 'error_qr', err);
                        if (!this.gw) {
                          this.showError(req, res, 'error_qr', err);
                          return;
                        }

                        const timeCreated = Date.now();
                        this.gw.convertProceeds(currencyTo)
                          .then((success) => {
                            if (success) {
                              const inv = new Invoices({
                                id,
                                timeCreated,
                                timePaid: Date.now(),
                                currencyFrom: currency,
                                currencyTo,
                                amountFiat,
                                exchangeRate: rate,
                                exchange: record.exchange,
                                amountSat,
                                memo,
                              });
                              inv.save();
                              let html2 = '<br><p style="color:green"><b>' + req.__('PAID') + '</b></p>';
                              html2 += '<form class="form" autocomplete="off" action="/receipt" method="POST"><fieldset>';
                              html2 += '<input type="hidden" id="lang" name="lang" value="' + lang + '">';
                              html2 += '<input type="hidden" id="id" name="id" value="' + id + '">';
                              html2 += '<input type="hidden" id="timeCreated" name="timeCreated" value="' + timeCreated + '">';
                              html2 += '<button class="btn btn-secondary" type ="submit">' + req.__('show_receipt') + '</button><br>';
                              html2 += '</center></div></body></html>';
                              
                              res.end(html2);
                            } else {
                              const html2 = '<br><p style="color:red"><b>' + req.__('FAILED') + '</b></p></center></div></body></html>';
                              res.end(html2);
                            }
                          });

                        let html = '<!DOCTYPE html>';
                        html += '<html lang="' + lang + '">';
                        html += '<head><meta charset="utf-8"><title>Payment QR</title>';
                        html += '<meta name="viewport" content="width=device-width, initial-scale=1">';
                        html += '<link rel="icon" type="image/svg+xml" href="favicon.svg">';
                        html += '<link rel="icon" type="image/png" href="favicon.png">';
                        html += '<link rel="stylesheet" href="https://stackpath.bootstrapcdn.com/bootstrap/4.3.1/css/bootstrap.min.css" integrity="sha384-ggOyR0iXCbMQv3Xipma34MD+dH/1fQ784/j6cY/iJTQUOhcWr7x9JvoRxT2MZw1T" crossorigin="anonymous">';
                        html += '<style>@import url("https://fonts.googleapis.com/css2?family=Montserrat:wght@500&display=swap");';
                        html += '* {font-family: Montserrat;}';
                        html += 'body { margin: 10px; padding: 10px; }</style></head>';
                        html += '<body><div class="container">';
                        html += '<h2 class="text-center">' + req.__('lightning_invoice') + '</h1>';
                        html += '<hr><center><p>' + req.__('Fiat amount:') + ' ' + currency + ' ' + amountFiat.toFixed(2);
                        html += '<br>1 BTC = ' + rate + ' ' + currency;
                        html += '<br>' + req.__('Satoshi amount:') + ' ' + amountSat + '</p>';
                        html += req.__('ln_qr');
                        html += '<br><a href="lightning:' + invoice + '"><img src=' + src + '></a>';

                        res.set('Content-type', 'text/html');
                        res.write(html);
                      });
                    });
                });
            })
            .catch((err) => {
              this.showError(req, res, 'error_exchange_down', err);
            });
        })
        .catch((err) => {
          this.showError(req, res, 'error_database_down', err);
        });
    });
  }

  start(serverPort, httpsOptions) {
    return new Promise((resolve) => {
      if (httpsOptions) {
        const httpsServer = https.createServer(httpsOptions, this.express);
        httpsServer.listen(serverPort, () => {
          console.info(`HTTPS listening at port ${serverPort}`);
          resolve();
        });
      } else {
        this.express.listen(serverPort, () => {
          console.info(`HTTP listening at port ${serverPort}`);
          resolve();
        });
      }
    });
  }
}
