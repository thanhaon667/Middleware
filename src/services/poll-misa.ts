export default {
  async syncOrders(misaConnection: any) {
    const misaService = strapi.service('misa-service' as any);
    const pageSize = 100;
    let page = 0;
    let hasMore = true;

    while (hasMore) {
      const orders = await misaService.fetchOrders(misaConnection.id, page, pageSize);
      if (!orders || orders.length === 0) {
        hasMore = false;
        break;
      }

      for (const order of orders) {
        const orderId = order.sale_order_no;
        if (!orderId) continue;

        const existing = await strapi.db.query('api::order.order').findOne({
          where: { orderId, client: misaConnection.client.id }
        });
        if (existing) continue;

        const newOrder = await strapi.db.query('api::order.order').create({
          data: {
            orderId,
            payload: order,
            orderStatus: 'new',
            source: 'MISA',
            client: misaConnection.client.id
          }
        });
        await (strapi.service('queue-service' as any) as any).addToQueue(newOrder.orderId, misaConnection.client.id);
      }

      if (orders.length < pageSize) {
        hasMore = false;
      } else {
        page++;
      }
    }
  }
};
