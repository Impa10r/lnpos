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