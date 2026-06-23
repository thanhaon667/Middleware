export default {
  // Every 2 minutes: run MISA test sync when enabled.
  '*/2 * * * *': async () => {
    try {
      const setting = await strapi.db.query('api::setting.setting').findOne({
        where: { key: 'misa_test_cron_enabled' }
      });
      if (!setting || setting.value !== true) return;

      const { testMisa } = await import('../src/scripts/test-misa');
      await testMisa();
    } catch (err) {
      strapi.log.error('Test cron error:', err);
    }
  },

  // Every minute: SAPO flow decides actual run time from Setting.
  '* * * * *': async () => {
    try {
      const { testSapo } = await import('../src/scripts/test-sapo');
      await testSapo();
    } catch (err) {
      strapi.log.error('SAPO cron error:', err);
    }
  },

  // Every 6 minutes: sync new MISA orders from middleware to Google Sheets when enabled.
  '*/6 * * * *': async () => {
    try {
      const setting = await strapi.db.query('api::setting.setting').findOne({
        where: { key: 'misa_gsheet_cron_enabled' }
      });
      if (!setting || setting.value !== true) return;

      const service = strapi.service('api::google-sheet-config.google-sheet-config') as any;
      await service.syncAllActiveClients();
    } catch (err) {
      strapi.log.error('Google Sheet cron error:', err);
    }
  }
};
