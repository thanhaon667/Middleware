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

      const orderIds = orders.map((o: any) => o.sale_order_no);
      const existingTop = await strapi.db.query('api::order.order').findMany({
        select: ['orderId'],
        where: { client: misaConnection.client.id },
        orderBy: { orderId: 'desc' },
        limit: 200
      });
      const existingIdSet = new Set(existingTop.map((e: any) => e.orderId));

      const newOrders = orders.filter((o: any) => !existingIdSet.has(o.sale_order_no));

      for (const order of newOrders) {
        const newOrder = await strapi.db.query('api::order.order').create({
          data: {
            orderId: order.sale_order_no,
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