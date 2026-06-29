export default {
  routes: [
    {
      method: 'POST',
      path: '/sapo/webhook/:clientName',
      handler: 'sapo.receiveOrder',
      config: { auth: false },
    },
    // SmartMinds callback: cập nhật trạng thái giao hàng cho SAPO order
    // SmartMinds gửi về client_order_id = SAPO order.id
    {
      method: 'POST',
      path: '/sapo/sm-callback',
      handler: 'sapo.handleSmCallback',
      config: { auth: false },
    },
    // Debug route - tạm thời để kiểm tra sapo-order data
    {
      method: 'GET',
      path: '/sapo/debug-orders/:clientName',
      handler: 'sapo.debugOrders',
      config: { auth: false },
    },
  ],
};
