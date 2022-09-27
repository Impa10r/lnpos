export default class Application {
  constructor({ server }) {
    this.server = server;
  }

  async start(port, httpsOptions) {
    await this.server.start(port, httpsOptions);
  }
}
