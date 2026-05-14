export default {
  // Mỗi 5 phút: chạy polling (gọi trực tiếp poll-misa)

  // Test cron: mỗi 2 phút gọi testMisa (chỉ khi được bật)
  '*/2 * * * *': async () => {
    try {
      // Kiểm tra trạng thái từ bảng Setting
      const setting = await strapi.db.query('api::setting.setting').findOne({
        where: { key: 'misa_test_cron_enabled' }
      });
      if (!setting || setting.value !== true) {
        return;
      }
      console.log('>>> TEST CRON for MISA direct (enabled)');
      const { testMisa } = await import('../src/scripts/test-misa');
      await testMisa();
    } catch (err) {
      strapi.log.error('Test cron error:', err);
    }
  },

  // Cron Sapo: mỗi 5 phút, lấy đơn hàng cập nhật gần nhất để tránh miss order/webhook
  '*/5 * * * *': async () => {
    try {
      const setting = await strapi.db.query('api::setting.setting').findOne({
        where: { key: 'sapo_test_cron_enabled' }
      });
      if (!setting || setting.value !== true) {
        return;
      }
      console.log('>>> SAPO cron sync enabled');
      const { testSapo } = await import('../src/scripts/test-sapo');
      await testSapo();
    } catch (err) {
      strapi.log.error('SAPO cron error:', err);
    }
  }
};