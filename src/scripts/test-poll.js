// scripts/test-poll.js
const strapi = require('@strapi/strapi');

async function test() {
  const app = await strapi({ autoReload: false }).start();
  const connections = await app.db.query('api::platform-connection.platform-connection').findMany({
    where: { platform: 'MISA', isActive: true },
    populate: { client: true }
  });
  for (const conn of connections) {
    try {
      await app.service('poll-misa').syncOrders(conn);
      console.log(`Polled connection ${conn.id}`);
    } catch (err) {
      console.error(`Error polling ${conn.id}:`, err.message);
    }
  }
  await app.destroy();
}

test();