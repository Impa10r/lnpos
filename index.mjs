/* eslint-disable */
import container from './app/container.mjs';
/* eslint-enable console */

const app = container.resolve('app');

app
  .start()
  .catch((error) => {
    console.warn(error);
    process.exit();
  });


/*
import Gateway from './app/bitfinex.mjs';
const gw = new Gateway('5Q7Dfv56tAK0LFcW8ORxnNrIULcrTRoyxquyxXvvm2P', 'ACRyCoUHrQA09yf27JWCakj3BkuT5D6RDilHtgxxLjN');
gw.getUserInfo()
  .then((r) => r.json())
  .then((json) => {
    console.log(json);
  });
*/