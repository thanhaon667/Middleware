export default {
  routes: [
    {
      method: 'GET',
      path: '/google-sheet-config/auth-url/:clientName',
      handler: 'google-sheet-config.getAuthUrl',
      config: { auth: false }
    },
    {
      method: 'GET',
      path: '/google-sheet-config/oauth/callback',
      handler: 'google-sheet-config.oauthCallback',
      config: { auth: false }
    },
    {
      method: 'POST',
      path: '/google-sheet-config/sync/:clientName',
      handler: 'google-sheet-config.syncClient',
      config: { auth: false }
    },
    {
      method: 'POST',
      path: '/google-sheet-config/sync-all',
      handler: 'google-sheet-config.syncAll',
      config: { auth: false }
    }
  ]
};
