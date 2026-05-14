const strapi = require('@strapi/strapi');

async function updateSapoCredentials() {
  console.log('🔄 Updating SAPO credentials for TestSa...');

  try {
    // Initialize Strapi
    const app = await strapi({
      appDir: process.cwd(),
      distDir: './dist',
    }).load();

    // Update credentials
    const updated = await app.db.query('api::integration-credential.integration-credential').update({
      where: { clientName: 'TestSa' },
      data: {
        clientMerchantId: 'SMVN01',
        sapoApiKey: '31ad7fce508c4f969e121cf0798683cd',
        sapoApiSecret: '5364aa9489ec4659b8d44bb1703dca1a',
        sapoShopDomain: 'lonege.mysapo.net',
        isActive: true
      }
    });

    console.log('✅ SAPO credentials updated successfully!');
    console.log('📊 Updated record:', updated);

    // Close Strapi
    await app.destroy();

  } catch (error) {
    console.error('❌ Error updating credentials:', error);
  }
}

updateSapoCredentials();