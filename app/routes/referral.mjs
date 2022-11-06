import express from 'express';
import qr from 'qrcode';

const router = express.Router();

function renderError(req, res, errCode, err) {
  if (err) console.error(err);
  res.render('message', {
    currentLocale: req.locale,
    message: req.__(errCode),
    color: 'red',
  });
}

router.get('/affiliate', (req, res) => {
  const currentLocale = res.getLocale();
  res.render('affiliate', {
    currentLocale,
  });
});

router.post('/referral', (req, res) => {
  const currentLocale = res.getLocale();
  const code = req.body.refCode;
  req.setLocale(currentLocale);
  if (code.length !== 10)
    return renderError(req, res, 'error_invalid_ref');
  const desc = req.get('host') + '/' + code;
  const url = req.protocol + '://' + desc;
  qr.toDataURL(url, (err, src) => {
    if (err) renderError(req, res, 'error_qr', err);
    res.render('referral', {
      currentLocale,
      url,
      desc,
      src,
    });
  });
});

export default router;
