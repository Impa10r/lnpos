/* eslint-disable */
import container from './app/container.mjs';
/* eslint-enable console */

const app = container.resolve('app');

const port = process.env.SERVER_PORT;

const httpsOptions = (port.toString() === '8433') ? { // HTTPS flag{
  ca: fs.readFileSync('options-ssl-apache.conf'),
  key: fs.readFileSync('privkey.pem'),
  cert: fs.readFileSync('fullchain.pem'),
} : {};

app
  .start(port, httpsOptions)
  .catch((error) => {
    console.warn(error);
    process.exit();
  });