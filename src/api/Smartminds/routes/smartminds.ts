export default {
  routes: [
    // Webhook cũ
    {
      method: 'POST',
      path: '/smartminds/webhook',
      handler: 'smartminds.receive',
      config: { auth: false },
    },
    // Webhook mới: nhận clientName từ URL
    {
      method: 'POST',
      path: '/smartminds/webhook/:clientName',
      handler: 'smartminds.receiveByClient',
      config: { auth: false },
    },
  ],
};