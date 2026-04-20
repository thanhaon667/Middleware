export default {
  async handleSM(ctx: any) {
    const { orderId, status } = ctx.request.body;

    // TODO: Xác thực webhook (dùng webhookSecret)

    const order = await strapi.db.query('api::order.order').findOne({
      where: { externalOrderId: orderId },
      populate: { client: true }
    });
    if (!order) ctx.throw(404, 'Order not found');

    const misaConnection = await strapi.db.query('api::platform-connection.platform-connection').findOne({
      where: { client: order.client.id, platform: 'MISA', isActive: true }
    });
    if (!misaConnection) ctx.throw(500, 'No active MISA connection');

    const updatedPayload = { ...order.payload, delivery_status: status };
    const misaService = strapi.service('misa-service' as any);
    await misaService.updateOrderStatus(misaConnection.id, order.orderId, updatedPayload);

    await strapi.db.query('api::order.order').update({
      where: { id: order.id },
      data: { payload: updatedPayload, orderStatus: 'completed' }
    });

    ctx.send({ ok: true });
  }
};