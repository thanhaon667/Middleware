"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = {
    async syncOrders(misaConnection) {
        const misaService = strapi.service('misa-service');
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
                if (!orderId)
                    continue;
                const existing = await strapi.db.query('api::order.order').findOne({
                    where: { orderId, client: misaConnection.client.id }
                });
                if (existing)
                    continue;
                const newOrder = await strapi.db.query('api::order.order').create({
                    data: {
                        orderId,
                        payload: order,
                        orderStatus: 'new',
                        source: 'MISA',
                        client: misaConnection.client.id
                    }
                });
                await strapi.service('queue-service').addToQueue(newOrder.orderId, misaConnection.client.id);
            }
            if (orders.length < pageSize) {
                hasMore = false;
            }
            else {
                page++;
            }
        }
    }
};
