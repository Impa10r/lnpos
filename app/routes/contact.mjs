import nodemailer from 'nodemailer';
import express from 'express';

const router = express.Router();

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
  res.render('contact', {
    currentLocale: res.getLocale(),
  });
});

router.post('/contact', (req, res) => {
  const text = 'userName: ' + req.body.userName + '\n' +
    'email: ' + req.body.email + '\n' +
    'message: ' + req.body.message;
  
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
      });
    } else {
      res.render('message', {
        currentLocale: req.locale,
        message: req.__('message_sent'),
        color: 'black',
      });
    }
  });
});

export default router;
