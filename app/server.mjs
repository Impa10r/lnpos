/* eslint-disable no-console */
/* eslint-disable import/extensions */
/* eslint-disable prefer-template */
/* eslint-disable no-underscore-dangle */
import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import bodyParser from 'body-parser';
import consolidate from 'consolidate';
import ShortUniqueId from 'short-unique-id';
import qr from 'qrcode';
import Model from './model.mjs';
import Gateway from './bitfinex.mjs';
import DataBase from './mongo.mjs';

export default class Server {
  constructor({ i18nProvider }) {
    this.gw = null;
    this.db = new DataBase();

    const limiter = rateLimit({
      windowMs: 1 * 60 * 1000, // 1 minute
      max: 10, // limit each IP to 100 requests per windowMs
    });

    function showError(res, req, errCode, err) {
      if (err) console.error(err);
      res.render('error', {
        currentLocale: req.locale,
        error: 'Error: ' + req.__(errCode),
      });
    }

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
      if (id) {
        const url = req.protocol + '://' + req.get('host') + '/' + req.query.id;
        switch (id) {
          case 'a4':
            qr.toDataURL(url, (err, src) => {
              if (err) showError(res, req, 'error_qr', err);
              res.render('a4', {
                currentLocale: res.locale,
                src,
              });
            });
            break;
          case 'ref':
            res.render('ref', {
              currentLocale: res.locale,
              url: url + '?lang=' + res.locale,
              id: req.query.id,
            });
            break;
          case 'add':
            res.render('add', {
              currentLocale: res.locale,
              url,
              id: req.query.id,
            });
            break;
          case 'pay':
            this.db.findOne('keys',{ id: req.query.id })
              .then((record) => {
                qr.toDataURL(req.query.i, (err, src) => {
                  if (err) showError(res, req, 'error_qr', err);
                  if (!this.gw) {
                    showError(res, req, 'error_qr', err);
                    return;
                  }
                  res.render('pay', {
                    currentLocale: res.locale,
                    invoice: req.query.i,
                    currency: req.query.c,
                    amountFiat: req.query.af,
                    amountSat: req.query.as,
                    rate: req.query.x,
                    src
                  });
                  this.gw.convertProceeds(record.currencyTo, req.query.as / 100000000);
                });
              })
              .catch((err) => {
                showError(res, req, 'error_id_not_found', err);
              });
            break;
          case 'error':
            res.render('error', {
              currentLocale: res.locale,
              error: req.query.error,
            });
            break;
          default:
            this.db.findOne('keys', { id })
              .then((record) => {
                if (res.locale !== record.lang) {
                  res.redirect(`/${id}?lang=${record.lang}`);
                } else {
                  res.render('request', {
                    currentLocale: record.lang,
                    id,
                    currencyFrom: record.currencyFrom,
                  });
                }
              })
              .catch((err) => {
                if (id.length === 10) {
                  res.render('index', {
                    currentLocale: res.locale,
                    refCode: id,
                  });
                } else {
                  showError(res, req, 'error_id_not_found', err);
                }
              });
        }
      } else {
        res.render('index', {
          currentLocale: res.locale,
          refCode: 'TuVr9K55M',
        });
      }
    });

    this.express.post('/ref', (req,res) => {
      const lang = req.body.lang;
      req.setLocale(lang);
      res.redirect(`/ref?id=${req.body.refCode}&lang=${lang}`);
    });

    this.express.post('/add', (req,res) => {
      const lang = req.body.lang;
      req.setLocale(lang);
      this.gw = new Gateway(req.body.apiKey, req.body.apiSecret);
      this.gw.getDepositAddr('LNX', 'exchange')
        .then((r) => r.json())
        .then((json) => {
          if (json[0] === 'error') {
            showError(res, req, 'err_invalid_keys');
          } else {
            // Delete previous to avoid duplicates
            this.db.deleteOne('keys', { key: req.body.apiKey })
              .then(r => {
                const uid = new ShortUniqueId({ length: 10 });
                const data = new Model({
                  id: uid(),
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
                    this.db.findOne('keys', { key: req.body.apiKey })
                      .then((record) => {
                        if (!record) {
                          showError(res, req, 'error_database_down');
                        } else {
                          res.redirect(`/add?id=${record.id.toString()}&lang=${lang}`);
                        }
                      });
                  });
              })
              .catch((err) => {
                showError(res, req, 'error_database_down', err);
              });
          }
        })
        .catch((err) => {
          showError(res, req, 'error_exchange_down', err);
        });
    });

    this.express.post('/pay', (req, res) => {
      const lang = req.body.lang;
      const id = req.body.id;
      const currency = req.body.currency;
      const amountFiat = parseFloat(req.body.amountFiat);

      this.db.findOne('keys', { id })
        .then((record) => {
          this.gw = new Gateway(record.key, record.secret);
          this.gw.getBook('tBTC' + currency)
            .then((result) => {
              const amountBTC = this.gw.simulateSell(parseFloat(amountFiat), result.data);
              const wap = amountFiat / amountBTC;
              if (amountBTC > this.gw.maxInvoiceAmount)
                return showError(res, req, 'amount_too_large');
              if (amountBTC < this.gw.minInvoiceAmount)
                return showError(res, req, 'amount_too_small');
              this.gw.getDepositAddr('LNX', 'exchange')
                .then((r) => r.json())
                .then((json) => {
                  if (json[0] === 'error') {
                    return showError(res, req, json[2], json);
                  }
                  this.gw.getLightningInvoice(amountBTC)
                    .then((r) => r.json())
                    .then((json) => {
                      if (json[0] === 'error') {
                        return showError(res, req, json[2], json);
                      }
                      const rate = wap.toFixed(2);
                      const amountSat = (amountBTC * 100000000).toFixed(0);
                      const af = amountFiat.toFixed(2);
                      this.awaitDeposit = (amountSat / 100000000).toFixed(8);
                      this.awaitCurrency = record.currencyTo;
                      res.redirect(`/pay?id=${id}&i=${json[1]}&c=${currency}&af=${af}&as=${amountSat}&x=${rate}&lang=${lang}`);
                    })
                })
            })
            .catch((err) => {
              showError(res, req, 'error_exchange_down', err);
            });
        })
        .catch((err) => {
          showError(res, req, 'error_database_down', err);
        });
    });
  }

  start(serverPort) {
    return new Promise((resolve) => {
      const http = this.express.listen(serverPort, () => {
        const { port } = http.address();
        console.info(`[p ${process.pid}] Listening at port ${port}`);
        resolve();
      });
    });
  }
}
