export default {
  routes: [
    {
      method: 'POST',
      path: '/smartminds/webhook',
      handler: 'smartminds.receive',
      config: {
        auth: false,
      },
    },
  ],
};