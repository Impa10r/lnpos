/* eslint-disable prefer-destructuring */
/* eslint-disable no-console */
/* eslint-disable import/extensions */
/* eslint-disable prefer-template */
/* eslint-disable no-underscore-dangle */
import express from 'express';
import secure from 'express-force-https';
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

export default class Server {
  renderRequest(req, res) {
    const id = req.params.id;
    this.db.findOne('keys', { id: id.toLowerCase() })
      .then((record) => {
        const lang = req.query.lang || record.lang;
        const currencyFrom = req.query.currency || record.currencyFrom;
        const amountOptions = req.query.amount ? 'value="' + req.query.amount + '" readonly' : '';
        const memoOptions = req.query.memo ? 'value="' + req.query.memo + '" readonly' : '';

        req.setLocale(lang);

        res.render('request', {
          currentLocale: lang,
          id,
          currencyFrom,
          amountOptions,
          memoOptions,
        });
      })
      .catch((err) => {
        if (id.length === 10) {
          res.render('index', {
            currentLocale: res.locale,
            refCode: id,
          });
        } else {
          showError(req, res, 'error_id_not_found', err);
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

    function showError(req, res, errCode, err) {
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

    this.express.use(secure);

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
      this.renderRequest(req, res);
    });

    this.express.get('/:id?', (req, res) => {
      const id = req.params.id;
      const browserLang = req.headers['accept-language'] ? req.headers['accept-language'].substring(0, 2) : 'en';

      if (!res.locale && ['es', 'ru'].includes(browserLang)) req.setLocale(browserLang);

      if (id) {
        const url = req.protocol + '://' + req.get('host') + '/' + req.query.id;
        switch (id) {
          case 'a4':
            qr.toDataURL(url, (err, src) => {
              if (err) showError(req, res, 'error_qr', err);
              res.render('a4', {
                currentLocale: res.locale,
                src,
              });
            });
            break;
          case 'ref':
            qr.toDataURL(url, (err, src) => {
              if (err) showError(req, res, 'error_qr', err);
              res.render('ref', {
                currentLocale: res.locale,
                url,
                id: req.query.id,
                src,
              });
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
            const userId = req.query.id.toLowerCase();
            this.db.findOne('keys', { id: userId })
              .then((record) => {
                qr.toDataURL(req.query.i, (err, src) => {
                  if (err) showError(req, res, 'error_qr', err);
                  if (!this.gw) {
                    showError(req, res, 'error_qr', err);
                    return;
                  }
                  req.setLocale(res.locale);
                  res.render('pay', {
                    currentLocale: res.locale,
                    invoice: req.query.i,
                    currency: req.query.c,
                    amountFiat: req.query.af,
                    amountSat: req.query.as,
                    rate: req.query.x,
                    src,
                  });

                  const invoice = new Invoices({
                    id: userId,
                    dateTime: Date.now(),
                    currencyFrom: req.query.c,
                    currencyTo: record.currencyTo,
                    amountFiat: req.query.af,
                    exchangeRate: req.query.x,
                    exchange: record.exchange,
                    amountSat: req.query.as,
                    memo: req.query.m,
                  });

                  this.gw.convertProceeds(record.currencyTo)
                    .then((success) => {
                      if (success) invoice.save();
                    });
                });
              })
              .catch((err) => {
                showError(req, res, 'error_id_not_found', err);
              });
            break;
          case 'error':
            res.render('error', {
              currentLocale: res.locale,
              error: req.query.error,
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
        return showError(req, res, 'error_invalid_ref');
      res.redirect(`/ref?id=${code}&lang=${lang}`);
    });

    this.express.post('/add', (req, res) => {
      const lang = req.body.lang;
      req.setLocale(lang);
      this.gw = new Gateway(req.body.apiKey, req.body.apiSecret);
      this.gw.getUserInfo()
        .then((r) => r.json())
        .then((json) => {
          if (json[0] === 'error') {
            showError(req, res, 'error_invalid_keys');
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
                          showError(req, res, 'error_database_down');
                        } else {
                          res.redirect(`/add?id=${record.id}&lang=${lang}`);
                        }
                      });
                  });
              })
              .catch((err) => {
                showError(req, res, 'error_database_down', err);
              });
          }
        })
        .catch((err) => {
          showError(req, res, 'error_exchange_down', err);
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
              if (amountBTC > this.gw.maxInvoiceAmount) { return showError(req, res, 'amount_too_large'); }
              if (amountBTC < this.gw.minInvoiceAmount) { return showError(req, res, 'amount_too_small'); }
              this.gw.getDepositAddr('LNX', 'exchange')
                .then((r) => r.json())
                .then((json) => {
                  if (json[0] === 'error') {
                    return showError(req, res, json[2], json);
                  }
                  this.gw.getLightningInvoice(amountBTC)
                    .then((r) => r.json())
                    .then((json) => {
                      if (json[0] === 'error') {
                        return showError(req, res, json[2], json);
                      }
                      const rate = wap.toFixed(2);
                      const amountSat = (amountBTC * 100000000).toFixed(0);
                      const af = amountFiat.toFixed(2);

                      res.redirect(`/pay?id=${id}&i=${json[1]}&c=${currency}&af=${af}&as=${amountSat}&x=${rate}&m=${memo}&lang=${lang}`);
                    });
                });
            })
            .catch((err) => {
              showError(req, res, 'error_exchange_down', err);
            });
        })
        .catch((err) => {
          showError(req, res, 'error_database_down', err);
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
