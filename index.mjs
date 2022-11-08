import fs from 'fs';
import http from 'http';
import container from './app/container.mjs';

const app = container.resolve('app');

const port = process.env.NODE_ENV !== 'prod' ? process.env.HTTP_PORT : process.env.HTTPS_PORT;

const httpsOptions = (port === process.env.HTTPS_PORT) ? {
  key: fs.readFileSync('/etc/ssl/web/privkey.pem'),
  cert: fs.readFileSync('/etc/ssl/web/fullchain.pem'),
} : null;

app
  .start(port, httpsOptions)
  .catch((error) => {
    console.error(error);
    process.exit();
  });

if (process.env.NODE_ENV === 'prod') {
  // Secondary http server
  http.createServer((req, res) => {
    res.writeHead(301, { Location: `https://${req.headers.host}${req.url}` });
    res.end();
  }).listen(process.env.HTTP_PORT);
  // console.info(`HTTP listening at port ${process.env.HTTP_PORT}`);
}
