export default {
  async addToQueue(orderId: string, clientId: number) {
    await strapi.db.query('api::order.order').update({
      where: { orderId, client: clientId },
      data: { orderStatus: 'pending' }
    });
  },

  async processNext(clientId: number) {
    const order = await strapi.db.query('api::order.order').findOne({
      where: { orderStatus: 'pending', client: clientId },
      orderBy: { createdAt: 'asc' }
    });
    if (!order) return false;

    const smConnection = await strapi.db.query('api::platform-connection.platform-connection').findOne({
      where: { client: clientId, platform: 'SM', isActive: true }
    });
    if (!smConnection) {
      strapi.log.error(`No active SM connection for client ${clientId}`);
      return false;
    }

    const smService = strapi.service('sm-service' as any);
    const result = await smService.sendOrder(order, smConnection);
    if (result.success) {
      await strapi.db.query('api::order.order').update({
        where: { id: order.id },
        data: {
          orderStatus: 'sent',
          sentAt: new Date(),
          externalOrderId: result.orderId
        }
      });
      await strapi.db.query('api::integration-log.integration-log').create({
        data: {
          client: clientId,
          direction: 'outgoing',
          endpoint: smConnection.apiUrl,
          requestBody: order.payload,
          responseBody: result,
          logStatus: 'success'
        }
      });
    } else {
      await strapi.db.query('api::integration-log.integration-log').create({
        data: {
          client: clientId,
          direction: 'outgoing',
          endpoint: smConnection.apiUrl,
          requestBody: order.payload,
          responseBody: { error: result.error },
          logStatus: 'failed'
        }
      });
    }
    return true;
  }
};