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
import locale from 'locale';
import { fileURLToPath } from 'url';
import { nanoid } from 'nanoid';
import { format } from '@fast-csv/format';
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
      error: req.__(errCode),
    });
  }

  renderReport(req, res) {
    const userName = req.body.userName.toLowerCase();
    const fromDate = Date.parse((req.body.fromDate ? req.body.fromDate : new Date().getFullYear() + '-01-01') + 'T00:00:00.000Z');
    const toDate = req.body.toDate ? Date.parse(req.body.toDate + 'T23:59:59.999Z') : Date.now();
    const limit = parseInt(req.body.limit);
    const paidOnly = req.body.paidOnly === 'on' ? 'checked' : '';
    const paidDate = paidOnly === 'checked' ? 1 : -2;
    const currentLocale = res.getLocale();

    const authToken = nanoid(13);
    const authExpire = Date.now() + 3600000; // 1 hour
    
    this.db.updateOne('keys', { userName }, { $set: { authToken, authExpire } });

    this.db.find('invoices', { $and: [{ userName }, { timePaid: { $gte: paidDate } }, { timeCreated: { $gte: fromDate } }, { timeCreated: { $lte: toDate } } ] }, { timeCreated: -1 }, limit )
      .then((resp) => {
        resp.toArray((err, invoices) => {
          if (err) console.error(err);
          let table = '<table class="table table-sm table-hover"><thead class="thead-light"><tr><th scope="col">';
          table += '#</th><th scope="col">' + req.__('tbl_date') + '</th>'; 
          table += '<th scope="col">' + req.__('amount') + '</th>';
          table += '<th scope="col">' + req.__('tbl_amt_to') + '</th>';
          table += '<th scope="col">' + req.__('tbl_memo') + '</th>';
          table += '<th scope="col">' + req.__('tbl_status') + '</th>';
          table += '</tr></thead><tbody>';

          for (let i = 0; i < invoices.length; i += 1) {
            const inv = invoices[i];
            const status = inv.timePaid < 0 ? 'failed' : (inv.timePaid > 0 ? 'paid' : 'pending');
            const receivedAs = (status === 'paid' ? (typeof inv.amountTo === 'undefined' || inv.currencyTo === 'BTC' ? toFix(inv.amountSat, 0) + ' Sats': toFix(inv.amountTo + inv.feeAmount, 2) + ' ' + inv.currencyTo) : '');
 
            table += '<tr><th scope="row">' + (i + 1)+ '</th>';
            table += '<td>' + toZulu(inv.timeCreated) + '</td>';
            table += '<td>' + toFix(inv.amountFiat, 2) + ' ' + inv.currencyFrom + '</td>';
            table += '<td>' + receivedAs + '</td>';
            table += '<td>' + inv.memo + '</td>';
            table += '<td><a href="/' + inv.invoiceId + '?status&lang=' + currentLocale + '" target="_blank"><img src="' + status + '.png" style="width: auto; height: 20px"></a></td></tr>';
          }
          table += '</tbody></table>';
          
          res.render('report', {
            currentLocale,
            table,
            toDate: toZulu(new Date(toDate)).substring(0, 10),
            fromDate: toZulu(new Date(fromDate)).substring(0, 10),
            limit,
            userName,
            authToken,
            paidOnly
          });
        });
      })
      .catch((err) => console.log(err)); 
  }

  renderCSV(req, res, userName) { 
    const fromDate = req.query.fromDate ? Date.parse(req.query.fromDate + 'T00:00:00.000Z') : 1;
    const toDate = req.query.toDate ? Date.parse(req.query.toDate + 'T23:59:59.999Z') : Date.now();
    const paidDate = req.query.paidOnly === 'checked' ? 1 : -2;
    const limit = parseInt(req.query.limit); 

    this.db.find('invoices', { $and: [{ userName }, { timePaid: { $gte: paidDate } }, { timeCreated: { $gte: fromDate } }, { timeCreated: { $lte: toDate } } ] }, { timeCreated: -1 }, limit )
      .then((resp) => {
        resp.toArray((err, invoices) => {
          if (err) console.error(err);
          
          const csvStream = format({ headers: true });
          res.setHeader('Content-disposition', 'attachment; filename=report.csv');
          res.setHeader('Content-type', 'text/csv');
          csvStream.pipe(res);

          for (let i = 0; i < invoices.length; i += 1) {
            const inv = invoices[i];
            const invoiceId = inv.invoiceId;
            const issueDate = toZulu(inv.timeCreated).substring(0, 19);
            const invoiceCurency = inv.currencyFrom;
            const invoiceAmount = inv.amountFiat;
            const satoshiAmount = inv.amountSat;
            const status = inv.timePaid < 0 ? 'Failed' : (inv.timePaid > 0 ? 'Paid' : 'Pending');
            const receivedCurency = (status === 'Paid' ? (typeof inv.amountTo === 'undefined' || inv.currencyTo === 'BTC' ? 'BTC': inv.currencyTo) : '');
            const receivedAmount = (status === 'Paid' ? (typeof inv.amountTo === 'undefined' || inv.currencyTo === 'BTC' ? inv.amountSat / 100000000: inv.amountTo + inv.feeAmount) : '');
            const paymentDate = status === 'Paid' ? toZulu(inv.timePaid).substring(0, 19) : '';
            const conversionDate = status === 'Paid' && typeof inv.timeHedged !== 'undefined' ? toZulu(inv.timeHedged).substring(0, 19) : '';
            const profitLoss = (status === 'Paid' && receivedCurency === invoiceCurency ) ?  receivedAmount - invoiceAmount : ''; 
            const details = inv.memo;

            csvStream.write({ 
              issueDate, 
              invoiceId,
              invoiceCurency,
              invoiceAmount,
              satoshiAmount,
              details,
              paymentDate,
              conversionDate,
              receivedCurency,
              receivedAmount,
              profitLoss,
              status
            });
          }
          csvStream.end();
        });
      })
      .catch((err) => {
        this.renderError(req, res, 'error_database_down', err);
      });
  }

  // append details of conversion to fiat or stablecoin for all paid invoices
  async completeInvoices(userName) {
    const p = new Promise((allResolve) => {
      this.db.findOne('keys', { userName }).then((rec) => {
        this.gw = new Gateway(rec.key, rec.secret);
        this.db.find('invoices', { $and: [{ userName }, { currencyTo: { $ne : "BTC" } }, { timePaid: {$gt: 0} }, { amountTo: {$exists: false} } ] } )
          .then((resp) => {
            resp.toArray((err, invoices) => {
              const promises = invoices.map(inv => {
                return new Promise((resolve) => { 
                  this.gw.getTrades('tBTC' + inv.currencyTo, inv.timePresented, Date.now(), 1, 1)
                    .then((r) => r.json())
                    .then((json) => {
                      if (json.length === 1) {
                        const tradeAmount = -json[0][4] * 100000000;
                        // one trade can convert many small previous deposits
                        const ratio = inv.amountSat / tradeAmount;
                        const timeHedged = json[0][2];
                        const executionPrice = json[0][5];
                        const amountTo = -json[0][4] * executionPrice * ratio;
                        const feeAmount = json[0][9] * ratio;
                        const feeCurrency = json[0][10];
                        const invoiceId = inv.invoiceId;
                        console.log(inv.amountFiat, amountTo, feeAmount);
                        this.db.updateOne('invoices', { invoiceId }, { $set: { timeHedged, executionPrice, amountTo, feeAmount, feeCurrency } });
                        resolve(true);
                      }
                      resolve(true);
                    });
                })
                .catch((err) => { 
                  console.log(err); 
                  resolve(true);
                } );
              });
              Promise.all(promises).then(() => {allResolve(true)});
            });
          });
      });
    });
    return p;
  }

  // check and update the payment status of one invoice
  invoiceStatus(invoiceId) {
    const promise = new Promise((resolve, reject) => {
      this.db.findOne('invoices', { invoiceId }).then((record) => {
        if (record) {
          const userName = record.userName;
          const timePresented = record.timePresented;
          
          if (record.timePaid) {
            if (record.timePaid === -1) return resolve('failed'); 
            return resolve('paid');
          }

          this.db.findOne('keys', { userName }).then((rec) => {
            this.gw = new Gateway(rec.key, rec.secret);
            this.gw.getMovements('LNX', timePresented, timePresented + 600000)
              .then((r) => r.json())
              .then((json) => {
                let received = null;
                let i = json.length;
                
                while (i > 0) {
                  i -= 1;
                  if (json[i][12] * 100000000 === record.amountSat) received = json[i][5];
                }

                if (received) {
                  this.db.updateOne('invoices', { invoiceId }, { $set: { timePaid: received } });
                  return resolve('paid');
                }

                if (timePresented > 0 && timePresented < Date.now() - 600000) {
                  this.db.updateOne('invoices', { invoiceId }, { $set: { timePaid: -1 } });
                  return resolve('failed');
                } 
                return resolve('pending');
              });
          });
        } else { reject('invoice_not_found') }
      })
      .catch((err) => {
        reject('error_database_down');
        console.error(err);
      });
    });
    return promise;
  }
  
  renderReceipt(req, res, status) {
    const invoiceId = req.params.id;
    this.db.findOne('invoices', { invoiceId }).then((record) => {
      if (record) {
        const currentLocale = res.getLocale();
        const timePresented = record.timePresented;
        const dateTimeCreated = toZulu(record.timeCreated);
        const dateTimePresented = timePresented > 0 ? toZulu(timePresented) : req.__('pending');
        const amountFiat = toFix(record.amountFiat, 2);
        const amountSat = record.amountSat > 0 ? toFix(record.amountSat, 0) : req.__('pending');
        const paymentPicure = status +'.png';
        const url = req.protocol + '://' + req.get('host') + '/' + invoiceId + '?status&lang=' + currentLocale;

        let dateTimePaid = '';
        let copyHtml = '';
        
        qr.toDataURL(url, (err, src) => {
          if (err) this.renderError(req, res, 'error_qr', err);
          
          switch(status) {
            case  'paid':
              dateTimePaid = toZulu(record.timePaid);
              copyHtml = '<p>' + req.__('need_copy') + '</p><img src="' + src + '" alt="QR code"></img>';
              break;
            default:
              copyHtml = '<p><a href="/' + invoiceId + '?lang='+ currentLocale + '">' + req.__('try_again') + '</a></p>';
              dateTimePaid = req.__(status);
          }
            
          res.render('receipt', {
            currentLocale,
            record,
            amountFiat,
            amountSat,
            dateTimeCreated,
            dateTimePresented,
            dateTimePaid,
            paymentPicure,
            copyHtml,
          });
        });
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
      max: 20, // limit each IP 
    });

    this.express = express();
    this.express.disable('x-powered-by');
    this.express.set('view engine', 'html');
    this.express.use(bodyParser.json());
    this.express.engine('html', consolidate.mustache);
    this.express.use(locale(i18nProvider.getLocales(), 'en'));
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
      const currentLocale = res.getLocale();
      const filename = fileURLToPath(import.meta.url);
      const dirname = path.dirname(filename);
            
      if (id) {
        switch (id) {
          case 'robots.txt':
          case 'sitemap.xml':
          case 'favicon.ico':
            return fs.createReadStream(path.join(dirname, '../views/', id)).pipe(res);
          case 'ru':
          case 'es':
          case 'fr':
          case 'en':
          case 'de':
          case 'it':
          case 'pt':
            req.setLocale(id);
            return res.render('index', {
              currentLocale: id,
              refCode: 'TuVr9K55M',
            });
          case 'login':
              return res.render('login', {
                currentLocale: res.getLocale()
              });
          case 'a4':
            const url = req.protocol + '://' + req.get('host') + '/' + req.query.id;
            return qr.toDataURL(url, (err, src) => {
              if (err) this.renderError(req, res, 'error_qr', err);
              res.render('a4', {
                currentLocale,
                src,
              });
            });
          default:
            switch (id.length) {
              case 10: // affiliate code
                return res.render('index', {
                  currentLocale,
                  refCode: id,
                });
              case 11: // user id
                return this.db.findOne('keys', { id })
                  .then((record) => {
                    if (record) {
                      const memoOptions = req.query.memo ? 'value="' + req.query.memo + '" readonly' : '';
                      const amountOptions = req.query.amount ? 'value="' + req.query.amount + '" readonly' : '';
                      const secondaryButtonOptions = req.query.amount ? 'hidden' : '';
                      const secondaryLabelOptions = secondaryButtonOptions === 'hidden' ? '' : 'hidden';

                      res.render('request', {
                        invoiceId: nanoid(12),
                        timeCreated: Date.now(),
                        currentLocale,
                        primaryLabelOptions: 'hidden',
                        secondaryLabelOptions: 'hidden',
                        memoOptions,
                        amountOptions,
                        secondaryButtonOptions,
                        secondaryLabelOptions,
                        record
                      });
                    } else this.renderError(req, res, 'error_id_not_found');   
                  })
                  .catch((err) => this.renderError(req, res, 'error_database_down', err));
              case 12: // invoice id
                return this.db.findOne('invoices', { invoiceId: id })
                  .then((record) => {
                    if (record) {
                      if (typeof req.query.status !== 'undefined') {
                        this.invoiceStatus(id)
                          .then((status) => {
                            this.renderReceipt(req, res, status);
                          })
                          .catch((error) => {
                            this.renderError(error);
                          })
                        return;
                      }
                
                      const amountOptions = 'value="' + record.amountFiat + '" readonly';
                      const memoOptions = record.memo ? 'value="' + record.memo + '" readonly' : '';
                      const primaryLabelOptions = record.timePaid > 0 ? '' : 'hidden';
                      const primaryButtonOptions = record.timePaid > 0 ? 'hidden' : '';
                      const secondaryButtonOptions = 'hidden';

                      res.render('request', {
                        invoiceId: id,
                        currentLocale,
                        amountOptions,
                        memoOptions,
                        primaryButtonOptions,
                        secondaryButtonOptions,
                        primaryLabelOptions,
                        record
                      });
                    } else this.renderError(req, res, 'invoice_not_found');
                  }).catch((err) => this.renderError(req, res, 'error_database_down', err));
                
                case 13: // authToken to download csv
                  return this.db.findOne('keys', { authToken: id })
                    .then((record) => {
                      if (record && record.authExpire > Date.now()) this.renderCSV(req, res, record.userName);
                      else res.render('index', { currentLocale, refCode: 'TuVr9K55M'});
                    });
              default:
            }
        }
      } 
      res.render('index', { currentLocale, refCode: 'TuVr9K55M' });
    });

    this.express.post('/report', (req, res) => {
      req.setLocale(req.body.lang);
      const userName = req.body.userName.toLowerCase();
      this.db.findOne('keys', { userName })
        .then((record) => {
          if (!record) return this.renderError(req, res, 'error_password');

          if (req.body.password && record.secret.substring(0, 7) !== req.body.password) {
            return this.renderError(req, res, 'error_password');
          } 

          if (req.body.authToken && !(record.authToken === req.body.authToken && record.authExpire > Date.now())) { 
            return res.render('login', { currentLocale: res.getLocale() });
          }
          
          this.completeInvoices(userName).then(() => this.renderReport(req, res));
        });
    });

    this.express.post('/ref', (req, res) => {
      const currentLocale = req.body.lang;
      const code = req.body.refCode;
      req.setLocale(currentLocale);
      if (code.length !== 10)
        return this.renderError(req, res, 'error_invalid_ref');
      const desc = req.get('host') + '/' + code;
      const url = req.protocol + '://' + desc;
      qr.toDataURL(url, (err, src) => {
        if (err) this.renderError(req, res, 'error_qr', err);
        res.render('ref', {
          currentLocale,
          url,
          desc,
          src,
        });
      });
    });

    this.express.post('/add', (req, res) => {
      const currentLocale = req.body.lang;
      const payee = req.body.payee;
      req.setLocale(currentLocale);
      this.gw = new Gateway(req.body.apiKey, req.body.apiSecret);
      this.gw.getUserInfo()
        .then((r) => r.json())
        .then((json) => {
          if (json[0] === 'error') {
            this.renderError(req, res, 'error_invalid_keys');
          } else {
            const userName = json[2].toLowerCase();
            const timeZone = json[7];
            let id = nanoid(11);
            this.db.findOne('keys', { key: req.body.apiKey })
              .then((record) => {
                if(record) id = record.id; // keep old id
                // Delete previous keys to avoid duplicates
                this.db.deleteMany('keys', { userName }) 
                  .then(r => {
                    const data = new Keys({
                      id,
                      userName,
                      timeZone,
                      key: req.body.apiKey,
                      secret: req.body.apiSecret,
                      exchange: req.body.exchange,
                      currencyFrom: req.body.currencyFrom,
                      currencyTo: req.body.currencyTo,
                      lang: currentLocale,
                      payee 
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
                              qr.toDataURL(url, (err, src) => {
                                if (err) this.renderError(req, res, 'error_qr', err);
                                res.render('add', {
                                  currentLocale,
                                  url,
                                  desc,
                                  src,
                                  id: i,
                                });
                              });
                            }
                          });
                      });
                  })
                  .catch((err) => {
                    this.renderError(req, res, 'error_database_down', err);
                  });
              });
          }
        })
        .catch((err) => {
          this.renderError(req, res, 'error_exchange_down', err);
        });
    });

    this.express.post('/pay', (req, res) => {
      const currentLocale = req.body.lang;
      const userName = req.body.userName;
      const invoiceId = req.body.invoiceId;
      const timeCreated = req.body.timeCreated;
      const currencyFrom = req.body.currencyFrom;
      const memo = typeof req.body.memo === 'undefined' ? '' : req.body.memo ;
      const amountFiat = parseFloat(req.body.amountFiat);

      req.setLocale(currentLocale);

      this.db.findOne('keys', { userName })
        .then((record) => {
          this.gw = new Gateway(record.key, record.secret);
          this.gw.getBook('tBTC' + currencyFrom)
            .then((result) => {
              const amountBTC = this.gw.simulateSell(amountFiat, result.data);
              const wap = amountFiat / amountBTC;
              const currencyTo = record.currencyTo;
              const payee = record.payee;

              if (amountBTC > this.gw.maxInvoiceAmount) { return this.renderError(req, res, 'amount_too_large'); }
              if (amountBTC < this.gw.minInvoiceAmount) { return this.renderError(req, res, 'amount_too_small'); }

              if (req.body.button === 'link') {
                this.db.findOne('invoices', { invoiceId })
                  .then((i) => {
                    if (i) {
                      this.db.updateOne('invoices', { invoiceId }, { $set: { 
                          timePresented: 0,
                          timePaid: 0,
                          amountFiat,
                          exchangeRate: 0,
                          amountSat: 0,
                          memo,
                          lang: currentLocale
                        } });
                    } else {
                      const inv = new Invoices({
                        invoiceId,
                        userName,
                        timeCreated,
                        timePresented: 0,
                        timePaid: 0,
                        currencyFrom,
                        currencyTo,
                        amountFiat,
                        exchangeRate: 0,
                        exchange: record.exchange,
                        amountSat: 0,
                        memo,
                        lang: currentLocale,
                        payee,
                      });
                      inv.save();
                    }
                    const desc = req.get('host') + '/' + invoiceId;
                    const url = req.protocol + '://' + desc;
                    res.render('payremote', {
                      currentLocale,
                      url,
                      desc,
                    }); 
                  });
                return;            
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

                        this.db.findOne('invoices', { invoiceId })
                          .then((inv) => {
                            if (inv) {
                              this.db.updateOne('invoices', { invoiceId }, { $set: { 
                                  timePresented: Date.now(),
                                  timePaid: 0,
                                  amountFiat,
                                  exchangeRate,
                                  amountSat,
                                  memo,
                                  lang: currentLocale
                                } });
                            } else {
                              const inv = new Invoices({
                                invoiceId,
                                userName,
                                timeCreated,
                                timePresented: Date.now(),
                                timePaid: 0,
                                currencyFrom,
                                currencyTo,
                                amountFiat,
                                exchangeRate,
                                exchange: record.exchange,
                                amountSat,
                                memo,
                                lang: currentLocale,
                                payee,
                              });
                              inv.save();  
                            }

                            const url = req.protocol + '://' + req.get('host') + '/' + invoiceId + '?status&lang=' + currentLocale;
                            
                            let html = '<!DOCTYPE html>';
                            html += '<html lang="' + currentLocale + '">';
                            html += '<head><meta charset="utf-8"><title>' + req.__('lightning_invoice') + '</title>';
                            html += '<meta name="viewport" content="width=device-width, initial-scale=1">';
                            html += '<link rel="mask-icon" href="safari-pinned-tab.svg" color="#000000"></link>';
                            html += '<link rel="icon" type="image/svg+xml" href="favicon.svg">';
                            html += '<link rel="alternate icon" type="image/png" href="favicon.png">';
                            html += '<link rel="stylesheet" href="https://stackpath.bootstrapcdn.com/bootstrap/4.3.1/css/bootstrap.min.css" integrity="sha384-ggOyR0iXCbMQv3Xipma34MD+dH/1fQ784/j6cY/iJTQUOhcWr7x9JvoRxT2MZw1T" crossorigin="anonymous">';
                            html += '<style>@import url("https://fonts.googleapis.com/css2?family=Montserrat:wght@500&display=swap");';
                            html += '* {font-family: Montserrat;}';
                            html += 'body { margin: 5px; padding: 5px; }th, td {padding-right: 10px;}</style></head>';
                            html += '<body><div class="container">';
                            html += '<h2 class="text-center">' + req.__('lightning_invoice') + '</h2>';
                            html += '<hr><center><table><tr><td><h4>' + req.__('amount') + ' </td><td><h4>' + currencyFrom + ' ' + toFix(amountFiat, 2) + '</h4></td></tr>';
                            html += '<tr><td><h4>BTC/' + currencyFrom + ': </h4></td><td><h4>' + toFix(exchangeRate, 2) + '</h4></td>';
                            html += '<tr><td><h4>' + req.__('satoshi') + ': </h4></td><td><h4>' + toFix(amountSat, 0) + '</h4></td></tr></table>';
                            html += '<p class="text-md-center">' + req.__('ln_qr') + '<br>';
                            html += '<a href="lightning:' + invoice + '" target="_blank"><img src=' + src + '></a><br>';
                            html += '<a href="' + url + '" target="_blank">' + req.__('show_receipt') + '</a><br>';

                            try {
                              res.set('Content-type', 'text/html');
                            } catch (e) { return console.error("Cannot set headers error") };

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

  // check and update payment status of all pending invoices
  resolvePendingInvoices(self) {
    console.log('Resolving hang invoices...');
    self.db.find('invoices', { $and: [{ timePresented: { $gt: 0 } }, { timePaid: 0 }] }).then((resp) => {
      resp.toArray((err, records) => {
        if (err) return console.error('resolvePendingInvoices', err);
        let j = records.length;
        while (j > 0) {
          j -= 1;
          const inv = records[j];
          const userName = inv.userName;
          const invoiceId = inv.invoiceId;
          self.db.findOne('keys', { userName })
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
                    console.log('Invoice', invoiceId, 'of', userName, toZulu(inv.timePresented), "was paid")
                    self.db.updateOne('invoices', { invoiceId }, { $set: { timePaid: received } });
                  } else if (inv.timePresented < Date.now() - 600000) { // invoice failed
                    console.log('Invoice', invoiceId, 'of', userName, toZulu(inv.timePresented), "has failed")
                    self.db.updateOne('invoices', { invoiceId }, { $set: { timePaid: -1 } });
                  } else {
                    console.log('Invoice', invoiceId, 'of', userName, toZulu(inv.timePresented), "is still pending");
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
      setTimeout(this.resolvePendingInvoices, 1000, this); // wait 1 sec for db to connect
    });
  }
}
