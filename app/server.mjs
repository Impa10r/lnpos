/* eslint-disable max-len */
/* eslint-disable consistent-return */
/* eslint-disable class-methods-use-this */
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
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { nanoid } from 'nanoid';
import Keys from './models/keys.mjs';
import Invoices from './models/invoices.mjs';
import Gateway from './bitfinex.mjs';
import DataBase from './mongo.mjs';

function toFix(number, decimals) {
  return Number(number).toFixed(decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function toZulu(unixTime) {
  return new Date(unixTime).toISOString().replace(/T/, ' ').replace(/\..+/, 'z')
}

export default class Server {
  renderError(req, res, errCode, err) {
    if (err) console.error(err);
    res.render('error', {
      currentLocale: req.locale,
      error: 'Error: ' + req.__(errCode),
    });
  }

  renderReport(req, res) {
    const id = req.query.r;
    this.db.findOne('keys', { id }).then((rec) => {
      this.gw = new Gateway(rec.key, rec.secret);
      this.gw. getTrades('tBTCEUR', 0, Date.now())
        .then((r) => r.json())
        .then((json) => {
          console.log(json);
        });
    });
  }

  renderReceipt(req, res) {
    const invoiceId =req.query.i;

    this.db.findOne('invoices', { invoiceId }).then((record) => {
      if (record) {
        const id = record.payee;
        let lang = record.lang;
        if (req.query && req.query.lang) lang = req.query.lang;
        req.setLocale(lang);
        const timePresented = record.timePresented;
        const dateTimeCreated = toZulu(record.timeCreated);
        const dateTimePresented = toZulu(timePresented);
        const amountFiat = toFix(record.amountFiat, 2);
        const amountSat = parseInt(record.amountSat);
        let paymentPicure = 'check-mark.png';
        let dateTimePaid = '';

        if (record.timePaid) {
          if (record.timePaid === -1) {
            dateTimePaid = req.__('failed');
            paymentPicure = 'red-cross.png';
          } else {
            dateTimePaid = toZulu(record.timePaid);
          }
          res.render('receipt', {
            currentLocale: lang,
            record,
            amountFiat,
            amountSat: toFix(amountSat),
            dateTimeCreated,
            dateTimePresented,
            dateTimePaid,
            paymentPicure,
          });
        } else {
          this.db.findOne('keys', { id }).then((rec) => {
            this.gw = new Gateway(rec.key, rec.secret);
            this.gw.getMovements('LNX', timePresented, timePresented + 600000)
              .then((r) => r.json())
              .then((json) => {
                let received = null;
                let i = json.length;
                while (i > 0) {
                  i -= 1;
                  if (json[i][12] * 100000000 === amountSat) received = json[i][5];
                }
                if (received) {
                  this.db.updateOne('invoices', { invoiceId }, { $set: { timePaid: received } });
                  dateTimePaid = toZulu(received);
                  return res.render('receipt', {
                    currentLocale: lang,
                    record,
                    amountFiat,
                    amountSat: toFix(amountSat),
                    dateTimeCreated,
                    dateTimePresented,
                    dateTimePaid,
                    paymentPicure,
                  });
                }

                if (timePresented < Date.now() - 600000) {
                  this.db.updateOne('invoices', { invoiceId }, { $set: { timePaid: -1 } });
                  dateTimePaid = req.__('failed');
                  paymentPicure = 'red-cross.png';
                } else {
                  dateTimePaid = req.__('pending');
                  paymentPicure = 'question-mark.png';
                }
                return res.render('receipt', {
                  currentLocale: lang,
                  record,
                  amountFiat,
                  amountSat: toFix(amountSat),
                  dateTimeCreated,
                  dateTimePresented,
                  dateTimePaid,
                  paymentPicure,
                });
              });
          });
        }
      } else {
        this.renderError(req, res, 'invoice_not_found');
      }
    })
    .catch((err) => {
      this.renderError(req, res, 'error_database_down', err);
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

    this.express.get('/:id?', (req, res) => {
      const id = req.params.id;
      const browserLang = req.headers['accept-language'] ? req.headers['accept-language'].substring(0, 2) : 'en';
      let lang = 'en';

      if (!lang && ['es', 'ru'].includes(browserLang)) lang = browserLang;
      if (res.locale) lang = res.locale;

      req.setLocale(lang);

      if (req.query.i) return this.renderReceipt(req, res);
      if (req.query.r) return this.renderReport(req, res);
      if (id) {
        switch (id) {
          case 'robots.txt':
          case 'sitemap.xml':
            const filename = fileURLToPath(import.meta.url);
            const dirname = path.dirname(filename);
            return fs.createReadStream(path.join(dirname, '../views/', id)).pipe(res);
          case 'ru':
          case 'es':
          case 'en':
            req.setLocale(id);
            return res.render('index', {
              currentLocale: id,
              refCode: 'TuVr9K55M',
            });
          case 'a4':
            const url = req.protocol + '://' + req.get('host') + '/' + req.query.id;
            return qr.toDataURL(url, (err, src) => {
              if (err) this.renderError(req, res, 'error_qr', err);
              res.render('a4', {
                currentLocale: lang,
                src,
              });
            });
          default:
            switch (id.length) {
              case 10: // affiliate code
                return res.render('index', {
                  currentLocale: lang,
                  refCode: id,
                });
              case 11: // user id
                return this.db.findOne('keys', { id })
                  .then((record) => {
                    if (record) {
                      res.render('request', {
                        currentLocale: lang,
                        payee: id,
                        currencyFrom: record.currencyFrom,
                        primaryLabelOptions: 'hidden',
                        secondaryLabelOptions: 'hidden',
                      });
                    } else this.renderError(req, res, 'error_id_not_found');   
                  })
                  .catch((err) => this.renderError(req, res, 'error_database_down', err));
              case 12: // invoice id
                return this.db.findOne('invoices', { invoiceId: id })
                  .then((record) => {
                    if (record) {
                      const amountOptions = 'value="' + record.amountFiat + '" readonly';
                      const memoOptions = record.memo ? 'value="' + record.memo + '" readonly' : '';
                      const primaryLabelOptions = record.timePaid > 0 ? '' : 'hidden';
                      const primaryButtonOptions = record.timePaid > 0 ? 'hidden' : '';
                      const secondaryButtonOptions = 'hidden';
                      req.setLocale(lang);
                      res.render('request', {
                        currentLocale: lang,
                        invoiceId: record.invoiceId,
                        payee: record.payee,
                        currencyFrom: record.currencyFrom,
                        amountOptions,
                        memoOptions,
                        primaryButtonOptions,
                        secondaryButtonOptions,
                        primaryLabelOptions
                      });
                    } else this.renderError(req, res, 'invoice_not_found');
                  }).catch((err) => this.renderError(req, res, 'error_database_down', err));
              default:
            }
        }
      } 
      res.render('index', { currentLocale: res.locale, refCode: 'TuVr9K55M', });
    });

    this.express.post('/ref', (req, res) => {
      const lang = req.body.lang;
      const code = req.body.refCode;
      req.setLocale(lang);
      if (code.length !== 10)
        return this.renderError(req, res, 'error_invalid_ref');
      const desc = req.get('host') + '/' + code;
      const url = req.protocol + '://' + desc;
      qr.toDataURL(url, (err, src) => {
        if (err) this.renderError(req, res, 'error_qr', err);
        res.render('ref', {
          currentLocale: lang,
          url,
          desc,
          src,
        });
      });
    });

    this.express.post('/add', (req, res) => {
      const lang = req.body.lang;
      req.setLocale(lang);
      this.gw = new Gateway(req.body.apiKey, req.body.apiSecret);
      this.gw.getUserInfo()
        .then((r) => r.json())
        .then((json) => {
          if (json[0] === 'error') {
            this.renderError(req, res, 'error_invalid_keys');
          } else {
            const id = nanoid(11);
            // Delete previous key to avoid duplicates
            this.db.deleteMany('keys', { key: req.body.apiKey }) 
              .then(r => {
                const data = new Keys({
                  id,
                  key: req.body.apiKey,
                  secret: req.body.apiSecret,
                  exchange: req.body.exchange,
                  currencyFrom: req.body.currencyFrom,
                  currencyTo: req.body.currencyTo,
                  lang
                });
                data.save()
                  .then(() => {
                    // check that it was saved ok
                    this.db.findOne('keys', { id })
                      .then((record) => {
                        if (!record) {
                          this.renderError(req, res, 'error_database_down');
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
                this.renderError(req, res, 'error_database_down', err);
              });
          }
        })
        .catch((err) => {
          this.renderError(req, res, 'error_exchange_down', err);
        });
    });

    this.express.post('/pay', (req, res) => {
      const lang = req.body.lang;
      const payee = req.body.payee;
      
      const currencyFrom = req.body.currencyFrom;
      const memo = typeof req.body.memo === 'undefined' ? '' : req.body.memo ;
      const amountFiat = parseFloat(req.body.amountFiat);

      req.setLocale(lang);

      this.db.findOne('keys', { id: payee })
        .then((record) => {
          this.gw = new Gateway(record.key, record.secret);
          this.gw.getBook('tBTC' + currencyFrom)
            .then((result) => {
              const amountBTC = this.gw.simulateSell(amountFiat, result.data);
              const wap = amountFiat / amountBTC;
              const currencyTo = record.currencyTo;

              if (amountBTC > this.gw.maxInvoiceAmount) { return this.renderError(req, res, 'amount_too_large'); }
              if (amountBTC < this.gw.minInvoiceAmount) { return this.renderError(req, res, 'amount_too_small'); }

              if (req.body.button === 'link') {
                const invoiceId = nanoid(12);
                const inv = new Invoices({
                  invoiceId,
                  payee,
                  timeCreated: Date.now(),
                  timePresented: 0,
                  timePaid: 0,
                  currencyFrom,
                  currencyTo,
                  amountFiat,
                  exchangeRate: 0,
                  exchange: record.exchange,
                  amountSat: 0,
                  memo,
                  lang,
                });
                inv.save();
                const desc = req.get('host') + '/' + invoiceId;
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
                    return this.renderError(req, res, j[2], j);
                  }
                  this.gw.getLightningInvoice(amountBTC)
                    .then((r) => r.json())
                    .then((json) => {
                      if (json[0] === 'error') {
                        return this.renderError(req, res, json[2], json);
                      }
                      const exchangeRate = wap.toFixed(2);
                      const amountSat = amountBTC * 100000000;
                      const invoice = json[1];

                      qr.toDataURL(invoice, (err, src) => {
                        if (err) this.renderError(req, res, 'error_qr', err);
                        if (!this.gw) {
                          this.renderError(req, res, 'error_qr', err);
                          return;
                        }

                        let invoiceId = req.body.invoiceId;
                        
                        if (invoiceId) {
                          this.db.updateOne('invoices', { invoiceId }, { $set: { 
                              timePresented: Date.now(),
                              timePaid: 0,
                              exchangeRate,
                              amountSat,
                              memo,
                              lang
                            } });
                        } else {
                          invoiceId = nanoid(12);
                          const inv = new Invoices({
                            invoiceId,
                            payee,
                            timeCreated: Date.now(),
                            timePresented: Date.now(),
                            timePaid: 0,
                            currencyFrom,
                            currencyTo,
                            amountFiat,
                            exchangeRate,
                            exchange: record.exchange,
                            amountSat,
                            memo,
                            lang,
                          });
                          inv.save();  
                        }

                        const url = req.protocol + '://' + req.get('host') + '/?i=' + invoiceId;
                        
                        let html = '<!DOCTYPE html>';
                        html += '<html lang="' + lang + '">';
                        html += '<head><meta charset="utf-8"><title>' + req.__('lightning_invoice') + '</title>';
                        html += '<meta name="viewport" content="width=device-width, initial-scale=1">';
                        html += '<link rel="icon" type="image/svg+xml" href="favicon.svg">';
                        html += '<link rel="icon" type="image/png" href="favicon.png">';
                        html += '<link rel="stylesheet" href="https://stackpath.bootstrapcdn.com/bootstrap/4.3.1/css/bootstrap.min.css" integrity="sha384-ggOyR0iXCbMQv3Xipma34MD+dH/1fQ784/j6cY/iJTQUOhcWr7x9JvoRxT2MZw1T" crossorigin="anonymous">';
                        html += '<style>@import url("https://fonts.googleapis.com/css2?family=Montserrat:wght@500&display=swap");';
                        html += '* {font-family: Montserrat;}';
                        html += 'body { margin: 5px; padding: 5px; }th, td {padding-right: 10px;}</style></head>';
                        html += '<body><div class="container">';
                        html += '<h2 class="text-center">' + req.__('lightning_invoice') + '</h2>';
                        html += '<hr><center><table><tr><td><h4>' + req.__('Fiat amount:') + ' </td><td><h4>' + currencyTo + ' ' + toFix(amountFiat, 2) + '</h4></td></tr>';
                        html += '<tr><td><h4>BTC/' + currencyTo + ': </h4></td><td><h4>' + toFix(exchangeRate, 2) + '</h4></td>';
                        html += '<tr><td><h4>' + req.__('Satoshi amount:') + ' </h4></td><td><h4>' + toFix(amountSat, 0) + '</h4></td></tr></table>';
                        html += '<p class="text-md-center">' + req.__('ln_qr') + '<br>';
                        html += '<a href="lightning:' + invoice + '" target="_blank"><img src=' + src + '></a><br>';
                        html += '<a href="' + url + '" target="_blank">' + req.__('show_receipt') + '</a><br>';

                        res.set('Content-type', 'text/html');
                        res.write(html);

                        this.gw.convertProceeds(amountBTC, currencyTo, res)
                          .then((success) => {
                            if (success) {
                              this.db.updateOne('invoices', { invoiceId }, { $set: { timePaid: Date.now() } });
                              const html2 = '<h4 style="color:green"><b>' + req.__('PAID') + '</b></h4></center></div></body></html>';
                              res.end(html2);
                            } else {
                              this.db.updateOne('invoices', { invoiceId }, { $set: { timePaid: -1 } });
                              const html2 = '<h4 style="color:red"><b>' + req.__('FAILED') + '</b></h4></center></div></body></html>';
                              res.end(html2);
                            }
                          });
                      });
                    });
                });
            })
            .catch((err) => {
              this.renderError(req, res, 'error_exchange_down', err);
            });
        })
        .catch((err) => {
          this.renderError(req, res, 'error_database_down', err);
        });
    });
  }

  resolvePendingInvoices(self) {
    console.log('Resolving hang invoices...');
    self.db.find('invoices', { $and: [{ timePresented: { $gt: 0 } }, { timePaid: 0 }] }).then((resp) => {
      resp.toArray((err, records) => {
        if (err) return console.error('resolvePendingInvoices', err);
        let j = records.length;
        while (j > 0) {
          j -= 1;
          const inv = records[j];
          const id = inv.payee;
          const invoiceId = inv.invoiceId;
          self.db.findOne('keys', { id })
            .then((rec) => {
              if (!rec) return;
              self.gw = new Gateway(rec.key, rec.secret);
              self.gw.getMovements('LNX', inv.timePresented, inv.timePresented + 600000)
                .then((r) => r.json())
                .then((json) => {
                  let received = null;
                  let i = json.length;
                  while (i > 0) {
                    i -= 1;
                    if (json[i][12] * 100000000 === inv.amountSat) received = json[i][5];
                  }
                  if (received) { // invoice received
                    console.log('Invoice', invoiceId, 'of', id, toZulu(inv.timePresented), "was paid")
                    self.db.updateOne('invoices', { invoiceId }, { $set: { timePaid: received } });
                  } else if (inv.timePresented < Date.now() - 600000) { // invoice failed
                    console.log('Invoice', invoiceId, 'of', id, toZulu(inv.timePresented), "has failed")
                    self.db.updateOne('invoices', { invoiceId }, { $set: { timePaid: -1 } });
                  } else {
                    console.log('Invoice', invoiceId, 'of', id, toZulu(inv.timePresented), "is still pending");
                    setTimeout(self.resolvePendingInvoices, inv.timePresented + 600001 - Date.now(), self); // repeat after due date
                  }
                });
            });
        }
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
      setTimeout(this.resolvePendingInvoices, 1000, this); // must wait for db to connect
    });
  }
}
