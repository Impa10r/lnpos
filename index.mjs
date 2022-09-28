import fs from 'fs';
import container from './app/container.mjs';

const app = container.resolve('app');

const port = process.env.SERVER_PORT;

const httpsOptions = (port.toString() === '8443') ? {
  key: fs.readFileSync('/etc/ssl/web/privkey.pem'),
  cert: fs.readFileSync('/etc/ssl/web/fullchain.pem'),
} : null;

app
  .start(port, httpsOptions)
  .catch((error) => {
    console.error(error);
    process.exit();
  });
