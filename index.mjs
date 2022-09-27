import fs from 'fs';
import container from './app/container.mjs';

const app = container.resolve('app');

const port = process.env.SERVER_PORT;

const httpsOptions = (port.toString() === '8443') ? {
  ca: fs.readFileSync('options-ssl-apache.conf'),
  key: fs.readFileSync('privkey.pem'),
  cert: fs.readFileSync('fullchain.pem'),
} : null;

app
  .start(port, httpsOptions)
  .catch((error) => {
    console.error(error);
    process.exit();
  });
