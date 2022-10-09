# Lightning Network Point of Sale
A web app which allows small businesses to easily accept LN Bitcoin payments as deposits to Bitfinex account with immediate conversion to fiat (this is optional). The value proposition is: zero cost, zero market risk and 1% to 3% savings compared to credit card processors.

## Try it out!
Wherever you are you can start using the [LNPOS.me](https://lnpos.me) for your business right away without installation. Or join the project as an affiliate to earn trading fee rebates from the businesses that you subscribe.

# Instalation
Install git and NVM for your system. Use NVM to instal LTS version of Node.js:
```
nvm install lts/*
```
To install LNPOS just run:
```
$ git clone https://github.com/impa10r/lnpos.git
$ cd lnpos
$ npm install
```
You will need to create an `.env` file in the root dir. You can use a sample env file called `.env.sample`. An easy way of doing this is just to copy the sample file to `.env`:

```
cp .env-sample .env
```
## MongoDB
You will need to have [mongo](https://www.mongodb.com) installed and fill the mongo variables on the .env file, those that start with `DB_`.

# Running it
```
$ npm start
```
# Testing
```
$ npm test
```
# Support
You are welcome to join our [telegram group](http://t.me/lnpos).

# Contribute
We appreciate help with translations and imrovements to code. See [contributing guide](CONTRIBUTING.md).
