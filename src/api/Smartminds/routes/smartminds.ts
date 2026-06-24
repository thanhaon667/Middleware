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
    // Test SAPO API
    {
      method: 'GET',
      path: '/test-sapo',
      handler: 'smartminds.testSapo',
      config: { auth: false },
    },
    // Test SAPO direct connection for Postman
    {
      method: 'GET',
      path: '/test-sapo-connection/:clientName',
      handler: 'smartminds.testSapoConnection',
      config: { auth: false },
    },
    // Update SAPO credentials
    {
      method: 'POST',
      path: '/update-sapo-credentials',
      handler: 'smartminds.updateSapoCredentials',
      config: { auth: false },
    },
  ],
};
