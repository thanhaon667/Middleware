export default {
  routes: [
    {
      method: 'POST',
      path: '/sapo/webhook/:clientName',
      handler: 'sapo.receiveOrder',
      config: { auth: false },
    },
  ],
};