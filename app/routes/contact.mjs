import nodemailer from 'nodemailer';
import express from 'express';
import svgCaptcha from 'svg-captcha';

const router = express.Router();

function renderError(req, res, errCode, err, link) {
  if (err) console.error(err);
  res.render('message', {
    currentLocale: res.getLocale(),
    message: req.__(errCode),
    color: 'red',
    link,
  });
}

// this is the authentication for sending email.
const transport = {
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
};

// call the transport function
const transporter = nodemailer.createTransport(transport);

router.get('/contact', (req, res) => {
  const captcha = svgCaptcha.create();

  res.render('contact', {
    currentLocale: res.getLocale(),
    captcha,
  });
});

router.post('/contact', (req, res) => {
  const currentLocale = req.body.lang;
  req.setLocale(currentLocale);
  if (req.body.captchaInput !== req.body.captchaText) {
    return renderError(req, res, 'invalid_captcha', '', '/contact?lang=' + currentLocale);
  }

  const text = `email: ${req.body.email}\n`
               + `message: ${req.body.message}`;

  // make mailable object
  const mailOptions = {
    from: process.env.SMTP_FROM,
    to: process.env.SMTP_TO,
    subject: 'Contact Form',
    text,
  };

  // send mail to recepient
  transporter.sendMail(mailOptions, (err, result) => {
    if (err) {
      console.error(err);
      res.render('message', {
        currentLocale: req.locale,
        message: req.__('message_error'),
        color: 'red',
        link: `/contact&lang=${req.locale}`,
      });
    } else {
      res.render('message', {
        currentLocale: req.locale,
        message: req.__('message_sent'),
        color: 'black',
        link: '/',
      });
    }
  });
});

export default router;
