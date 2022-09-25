export default class Application {
  constructor({ server }) {
    this.server = server;
  }

  async start() {
    await this.server.start(process.env.SERVER_PORT);
  }
}
