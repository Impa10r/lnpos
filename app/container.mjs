import awilix from 'awilix';
import i18n from './i18n.config.mjs';
import LocaleService from './localeService.mjs';
import Application from './application.mjs';
import Server from './server.mjs';
//import DataBase from './mongo.mjs';

const container = awilix.createContainer();

container
  .register({
    localeService: awilix.asClass(LocaleService, { lifetime: awilix.Lifetime.SINGLETON }),
  })
  .register({
    i18nProvider: awilix.asValue(i18n),
  })
  .register({
    app: awilix.asClass(Application, { lifetime: awilix.Lifetime.SINGLETON }),
  })
  .register({
    server: awilix.asClass(Server, { lifetime: awilix.Lifetime.SINGLETON }),
  });

export default container;
