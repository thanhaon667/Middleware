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
            const orderIds = orders.map((o) => o.sale_order_no);
            const existingTop = await strapi.db.query('api::order.order').findMany({
                select: ['orderId'],
                where: { client: misaConnection.client.id },
                orderBy: { orderId: 'desc' },
                limit: 200
            });
            const existingIdSet = new Set(existingTop.map((e) => e.orderId));
            const newOrders = orders.filter((o) => !existingIdSet.has(o.sale_order_no));
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
