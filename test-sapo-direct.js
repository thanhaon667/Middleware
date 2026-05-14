const axios = require('axios');

// Test SAPO API directly
async function testSapoDirect() {
  const url = 'https://lonege.mysapo.net/admin/orders.json';
  const username = '31ad7fce508c4f969e121cf0798683cd';
  const password = '5364aa9489ec4659b8d44bb1703dca1a';

  console.log('🧪 Testing SAPO API directly...');
  console.log(`🔗 URL: ${url}`);
  console.log(`👤 Username: ${username}`);
  console.log(`🔑 Password: ${password.substring(0, 10)}...`);

  try {
    const response = await axios.get(url, {
      auth: {
        username: username,
        password: password
      },
      timeout: 30000
    });

    console.log(`✅ Response status: ${response.status}`);
    console.log(`📊 Response headers:`, response.headers);
    console.log(`📦 Response data keys:`, Object.keys(response.data || {}));

    if (response.data && response.data.orders) {
      console.log(`📋 Orders count: ${response.data.orders.length}`);
      if (response.data.orders.length > 0) {
        console.log(`📝 Sample order:`, response.data.orders[0]);
      }
    } else {
      console.log(`⚠️ No orders array in response`);
      console.log(`📄 Raw response:`, JSON.stringify(response.data, null, 2));
    }

  } catch (error) {
    console.error(`❌ Error:`, error.message);
    if (error.response) {
      console.error(`❌ Response status: ${error.response.status}`);
      console.error(`❌ Response data:`, error.response.data);
    }
  }
}

testSapoDirect();