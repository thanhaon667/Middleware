import axios from 'axios';

// =========================
// BIẾN TOÀN CỤC (sẽ được gán từ database)
// =========================
let MISA_CLIENT_ID: string;
let MISA_CLIENT_SECRET: string;
let MISA_API_BASE_URL: string;  // ví dụ: https://crmconnect.misa.vn
let ZEEK_APP_ID: string;
let ZEEK_APP_SECRET: string;
let ZEEK_API_URL: string;

/**
 * Tải thông tin xác thực từ collection integration-credential
 * (Chỉ lấy bản ghi đang active, có thể lọc theo clientName nếu cần)
 */
async function loadCredentials() {
  const cred = await strapi.db.query('api::integration-credential.integration-credential').findOne({
    where: { isActive: true }
  });
  if (!cred) {
    throw new Error('No active integration credential found');
  }
  MISA_CLIENT_ID = cred.misaClientId;
  MISA_CLIENT_SECRET = cred.misaClientSecret;
  // Lấy base URL từ misaApiUrl (loại bỏ phần /api/v2/Account nếu có)
  let base = cred.misaApiUrl;
  if (base.includes('/api/v2/Account')) {
    base = base.replace('/api/v2/Account', '');
  }
  MISA_API_BASE_URL = base;
  ZEEK_APP_ID = cred.zeekAppId;
  ZEEK_APP_SECRET = cred.zeekAppSecret;
  ZEEK_API_URL = cred.zeekApiUrl;
  console.log('✅ Loaded credentials from database');
}

/**
 * Helper: ghi log vào bảng IntegrationLog (tổng hợp)
 */
async function writeStepLog(clientDocId: string | null, step: string, details: any, isError: boolean = false) {
  try {
    if (!clientDocId) {
      console.log(`[LOG] ${step}:`, details);
      return;
    }
    await strapi.documents('api::integration-log.integration-log').create({
      data: {
        Client: clientDocId,
        direction: 'incoming' as any,
        Endpoint: `MISA-Zeek - ${step}`,
        requestBody: details.request || {},
        responseBody: details.response || {},
        logStatus: isError ? ('failed,' as any) : ('success' as any)
      },
      status: 'published'
    });
    console.log(`📝 Integration log written for step: ${step}`);
  } catch (logErr) {
    console.error('Failed to write integration log:', logErr);
  }
}

/**
 * Helper: ghi log vào trường processingLog của order (chi tiết từng bước)
 */
async function addOrderLog(orderId: string, step: string, message: string, isError: boolean = false) {
  try {
    const order = await strapi.db.query('api::order.order').findOne({
      where: { orderId }
    });
    if (!order) {
      console.warn(`[OrderLog] Order ${orderId} not found`);
      return;
    }

    let logs = order.processingLog;
    if (typeof logs === 'string') {
      try { logs = JSON.parse(logs); } catch { logs = []; }
    }
    if (!Array.isArray(logs)) logs = [];

    logs.push({
      timestamp: new Date().toISOString(),
      step,
      message,
      isError
    });

    if (logs.length > 100) logs = logs.slice(-100);

    await strapi.db.query('api::order.order').update({
      where: { id: order.id },
      data: { processingLog: logs }
    });
  } catch (err) {
    console.error(`[OrderLog] Failed to write log for order ${orderId}:`, err);
  }
}

/**
 * Lấy token MISA
 */
async function getMisaToken(): Promise<string> {
  console.log('🔐 [1/6] Getting MISA token...');
  const requestData = { client_id: MISA_CLIENT_ID, client_secret: MISA_CLIENT_SECRET };
  const tokenUrl = `${MISA_API_BASE_URL}/api/v2/Account`;
  try {
    const response = await axios.post(tokenUrl, requestData, {
      headers: { 'Content-Type': 'application/json' }
    });
    console.log(`[MISA Token] Request: ${JSON.stringify(requestData)}`);
    console.log(`[MISA Token] Response status: ${response.status}, data: ${JSON.stringify(response.data)}`);
    if (!response.data.success) {
      throw new Error(`MISA token error: ${response.data.user_msg}`);
    }
    console.log('✅ MISA token obtained');
    return response.data.data;
  } catch (error: any) {
    console.error(`❌ MISA token error: ${error.message}`);
    throw error;
  }
}

/**
 * Lấy danh sách order từ MISA
 */
async function fetchMisaOrders(token: string): Promise<any[]> {
  console.log('📦 [2/6] Fetching orders from MISA...');
  const ordersUrl = `${MISA_API_BASE_URL}/api/v2/SaleOrders`;
  const params = { page: 0, pageSize: 10, orderBy: 'modified_date', isDescending: true };
  try {
    const response = await axios.get(ordersUrl, {
      headers: { Authorization: `Bearer ${token}`, Clientid: MISA_CLIENT_ID },
      params
    });
    console.log(`[MISA Orders] Request params: ${JSON.stringify(params)}`);
    console.log(`[MISA Orders] Response status: ${response.status}`);
    let orders: any[] = [];
    if (Array.isArray(response.data) && response.data[0]?.data?.success) {
      orders = response.data[0].data.data;
    } else if (response.data?.success) {
      orders = response.data.data;
    }
    if (!orders.length) console.warn('⚠️ No orders returned from MISA');
    else console.log(`✅ Fetched ${orders.length} orders`);
    if (orders.length > 0) {
      console.log(`[Sample order] ${JSON.stringify(orders[0]).substring(0, 500)}...`);
    }
    return orders;
  } catch (error: any) {
    console.error(`❌ Fetch orders error: ${error.message}`);
    throw error;
  }
}

/**
 * Tạo hoặc lấy client (TestClient)
 */
async function getOrCreateClient() {
  console.log('👤 [3/6] Ensuring client exists...');
  let client = await strapi.documents('api::client.client').findFirst({
    filters: { name: 'TestClient' }
  });
  if (!client) {
    console.log('🆕 Creating new TestClient...');
    client = await strapi.documents('api::client.client').create({
      data: { name: 'TestClient', appId: 'TEST001', isActive: true },
      status: 'published'
    });
    console.log(`✅ Created TestClient with documentId: ${client.documentId}`);
  } else {
    console.log(`✅ Client TestClient already exists, documentId: ${client.documentId}`);
  }
  return client;
}

/**
 * Lưu order vào database (nếu chưa có) - có ghi log processing
 */
async function upsertOrder(order: any, clientDocId: string) {
  const orderId = order.sale_order_no;
  if (!orderId) return null;
  console.log(`🔄 Checking order ${orderId}...`);
  const existed = await strapi.documents('api::order.order').findFirst({
    filters: { orderId }
  });
  if (existed) {
    console.log(`📌 Order ${orderId} already exists (status: ${existed.orderStatus})`);
    await addOrderLog(orderId, 'UPSERT', `Order already exists, status: ${existed.orderStatus}`);
    return existed;
  }
  console.log(`📝 Creating new order ${orderId}...`);
  const newOrder = await strapi.documents('api::order.order').create({
    data: {
      orderId,
      payload: order,
      orderStatus: 'new',
      Client: clientDocId
    },
    status: 'published'
  });
  console.log(`✅ Created new order ${orderId} with documentId: ${newOrder.documentId}`);
  await addOrderLog(orderId, 'UPSERT', 'Order created with status new');
  return newOrder;
}

/**
 * Gửi order sang Smart Minds (Zeek) - có log chi tiết
 */
async function sendToZeek(order: any) {
  console.log(`📤 Sending order ${order.orderId} to Zeek...`);
  await addOrderLog(order.orderId, 'SEND_TO_ZEEK', 'Attempting to send order to Zeek');

  const misa = order.payload;
  const clientOrderId = misa.sale_order_no;
  const merchantOrderId = clientOrderId.slice(-6);
  const orderTime = Math.floor(new Date(misa.created_date).getTime() / 1000);
  const timestamp = Math.floor(Date.now() / 1000);

  const receive = {
    user_name: misa.shipping_contact_name || misa.account_name || 'Khách hàng',
    user_phone: '868036856',
    user_phone_country_code: '84',
    user_location: '',
    user_address: misa.shipping_address || misa.billing_address || 'Địa chỉ mặc định'
  };

  const payload = {
    auth: {
      appid: Number(ZEEK_APP_ID),
      timestamp: timestamp,
      signature: ZEEK_APP_SECRET
    },
    data: {
      meta: {
        language: 'vi',
        lang: 'vi',
        region: 'SGN'
      },
      client_merchant_id: 'SMID01',
      client_order_id: clientOrderId,
      merchant_order_id: merchantOrderId,
      order_time: orderTime,
      is_appoint: 0,
      appoint_time: new Date().toISOString(),
      remark: misa.description || '',
      merchant_remark: '',
      cod_type: misa.pay_status === 'Chưa thanh toán' ? 1 : 2,
      receive: receive,
      order_detail: {
        total_price: misa.to_currency_summary || 0,
        item_weight: 2
      }
    }
  };

  console.log(`[Zeek Request] URL: ${ZEEK_API_URL}`);
  console.log(`[Zeek Request] Headers: AppID=${ZEEK_APP_ID}, AppSecret=${ZEEK_APP_SECRET}`);
  console.log(`[Zeek Request] Body: ${JSON.stringify(payload, null, 2)}`);

  try {
    const response = await axios.post(ZEEK_API_URL, payload, {
      headers: {
        'Content-Type': 'application/json',
        AppID: ZEEK_APP_ID,
        AppSecret: ZEEK_APP_SECRET
      }
    });
    console.log(`[Zeek Response] Status: ${response.status}`);
    console.log(`[Zeek Response] Data: ${JSON.stringify(response.data)}`);
    if (response.data.error === 0) {
      const zeekOrderId = response.data.data?.order_id;
      console.log(`✅ Order ${order.orderId} sent to Zeek, ID: ${zeekOrderId}`);
      await addOrderLog(order.orderId, 'SEND_TO_ZEEK', `Successfully sent, Zeek order ID: ${zeekOrderId}`);
      return { success: true, zeekOrderId };
    } else {
      throw new Error(response.data.err_msg || 'Zeek API error');
    }
  } catch (error: any) {
    console.error(`❌ Zeek API error for order ${order.orderId}:`, error.message);
    if (error.response) {
      console.error(`Response data: ${JSON.stringify(error.response.data)}`);
    }
    await addOrderLog(order.orderId, 'SEND_TO_ZEEK', `Failed: ${error.message}`, true);
    throw error;
  }
}

/**
 * Cập nhật order sau khi gửi thành công
 */
async function updateOrderAfterSend(order: any, zeekOrderId: string) {
  console.log(`✏️ Updating order ${order.orderId} status to 'sent'...`);
  await strapi.documents('api::order.order').update({
    documentId: order.documentId,
    data: {
      orderStatus: 'sent',
      externalOrderId: zeekOrderId,
      sentAt: new Date().toISOString()
    }
  });
  console.log(`✅ Order ${order.orderId} marked as sent`);
  await addOrderLog(order.orderId, 'UPDATE_STATUS', `Order status updated to sent, externalOrderId=${zeekOrderId}`);
}

/**
 * Hàm chính
 */
export async function testMisa() {
  let client: any = null;
  const startTime = Date.now();
  console.log('🚀 [START] MISA to Zeek integration test');

  try {
    // Nạp credentials từ database
    await loadCredentials();

    // 1. Token MISA
    const token = await getMisaToken();
    // 2. Fetch orders
    const orders = await fetchMisaOrders(token);
    if (orders.length === 0) {
      console.log('No orders to process. Exiting.');
      await writeStepLog(null, 'no_orders', { message: 'No orders from MISA' }, false);
      return;
    }
    // 3. Client
    client = await getOrCreateClient();
    // 4. Xử lý từng order
    let createdCount = 0;
    let sentCount = 0;
    for (const misaOrder of orders) {
      const order = await upsertOrder(misaOrder, client.documentId);
      if (order && order.orderStatus === 'new') {
        try {
          const zeekResult = await sendToZeek(order);
          if (zeekResult.success) {
            await updateOrderAfterSend(order, zeekResult.zeekOrderId);
            sentCount++;
            await writeStepLog(client.documentId, `send_success_${order.orderId}`, {
              request: { orderId: order.orderId, zeekOrderId: zeekResult.zeekOrderId },
              response: { success: true }
            }, false);
          }
        } catch (err: any) {
          console.error(`❌ Failed to send order ${order.orderId}:`, err.message);
          await writeStepLog(client.documentId, `send_fail_${order.orderId}`, {
            request: { orderId: order.orderId, payload: order.payload },
            response: { error: err.message }
          }, true);
        }
      }
      createdCount++;
    }
    // 5. Ghi log tổng kết
    const duration = (Date.now() - startTime) / 1000;
    await writeStepLog(client.documentId, 'summary', {
      request: { totalOrders: orders.length, created: createdCount, sent: sentCount, durationSec: duration },
      response: { success: true }
    }, false);
    console.log(`🎉 DONE | Processed ${orders.length} orders, sent ${sentCount} to Zeek in ${duration}s`);
  } catch (error: any) {
    console.error('❌ Test failed at main level:', error.message);
    if (client) {
      await writeStepLog(client.documentId, 'critical_error', {
        request: {},
        response: { error: error.message, stack: error.stack }
      }, true);
    } else {
      await writeStepLog(null, 'critical_error', { error: error.message }, true);
    }
  }

  
}

