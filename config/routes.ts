export default {
  routes: [
    {
      method: 'POST',
      path: '/webhook/sm',
      handler: 'webhook.handleSM',
      config: { auth: false }
    }
  ]
};