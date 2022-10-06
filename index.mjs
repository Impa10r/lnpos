import fs from 'fs';
import container from './app/container.mjs';

const app = container.resolve('app');

const port = process.env.NODE_ENV === 'dev' ? process.env.HTTP_PORT : process.env.HTTPS_PORT;

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
  // Secondary http app
  var express = require('express');
  var httpApp = express();
  var httpRouter = express.Router();
  httpApp.use('*', httpRouter);
  httpRouter.get('*', function(req, res){
    var host = req.get('Host');
    // replace the port in the host
    host = host.replace(/:\d+$/, ":"+app.get('port'));
    // determine the redirect destination
    var destination = ['https://', host, req.url].join('');
    return res.redirect(destination);
  });
  var httpServer = http.createServer(httpApp);
  httpServer.listen(process.env.HTTP_PORT);
}
