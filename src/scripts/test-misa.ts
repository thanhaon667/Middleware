import axios from 'axios';

// =========================
// BIẾN TOÀN CỤC (sẽ được gán từ database)
// =========================
type IntegrationCredential = {
  clientName?: string;
  misaClientId?: string;
  misaClientSecret?: string;
  misaApiUrl?: string;
  zeekAppId?: string;
  zeekAppSecret?: string;
  zeekApiUrl?: string;
  clientMerchantId?: string;
  isActive?: string | boolean;
};

let MISA_CLIENT_ID: string;
let MISA_CLIENT_SECRET: string;
let MISA_API_BASE_URL: string;  // ví dụ: https://crmconnect.misa.vn
let ZEEK_APP_ID: string;
let ZEEK_APP_SECRET: string;
let ZEEK_API_URL: string;
let CLIENT_MERCHANT_ID: string;
let CURRENT_CLIENT_NAME: string;
let CACHED_MISA_TOKEN: string | null = null;
let CACHED_MISA_TOKEN_CLIENT: string | null = null;

/**
 * `isActive` là cờ bật/tắt client trong CMS.
 * Vẫn giữ tương thích với dữ liệu cũ nếu DB còn record dạng string.
 */
function isCredentialActive(value: string | boolean | undefined) {
  if (value === true) return true;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return ['true', '1', 'active', 'yes'].includes(normalized);
  }
  return false;
}

async function getActiveCredentials(): Promise<IntegrationCredential[]> {
  const credentials = await strapi.db.query('api::integration-credential.integration-credential').findMany();
  const activeCredentials = (credentials || []).filter((cred: IntegrationCredential) => isCredentialActive(cred.isActive));

  if (!activeCredentials.length) {
    throw new Error('No active integration credential found');
  }

  const dedupedCredentials: IntegrationCredential[] = [];
  const seenClientNames = new Set<string>();

  for (const cred of activeCredentials) {
    const clientKey = (cred.clientName || cred.clientMerchantId || cred.misaClientId || 'UnknownClient').trim().toLowerCase();
    if (seenClientNames.has(clientKey)) {
      console.log(`⚠️ Skipping duplicate active credential for client: ${cred.clientName || clientKey}`);
      continue;
    }
    seenClientNames.add(clientKey);
    dedupedCredentials.push(cred);
  }

  return dedupedCredentials;
}

/**
 * Tải thông tin xác thực cho 1 khách hàng cụ thể
 */
function loadCredential(cred: IntegrationCredential) {
  MISA_CLIENT_ID = cred.misaClientId;
  MISA_CLIENT_SECRET = cred.misaClientSecret;
  CURRENT_CLIENT_NAME = cred.clientName?.trim() || 'UnknownClient';
  // Lấy base URL từ misaApiUrl (loại bỏ phần /api/v2/Account nếu có)
  let base = cred.misaApiUrl || '';
  if (base.includes('/api/v2/Account')) {
    base = base.replace('/api/v2/Account', '');
  }
  MISA_API_BASE_URL = base;
  ZEEK_APP_ID = cred.zeekAppId;
  ZEEK_APP_SECRET = cred.zeekAppSecret;
  ZEEK_API_URL = cred.zeekApiUrl;
  CLIENT_MERCHANT_ID = cred.clientMerchantId;
  console.log(`✅ Loaded credentials from database for client: ${CURRENT_CLIENT_NAME}`);
}

function hasCachedToken() {
  if (!CACHED_MISA_TOKEN || !CACHED_MISA_TOKEN_CLIENT) {
    return false;
  }

  if (CACHED_MISA_TOKEN_CLIENT !== CURRENT_CLIENT_NAME) {
    return false;
  }

  return true;
}

function clearCachedToken() {
  CACHED_MISA_TOKEN = null;
  CACHED_MISA_TOKEN_CLIENT = null;
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
async function addOrderLog(clientName: string, orderId: string, step: string, message: string, isError: boolean = false) {
  try {
    const order = await strapi.documents('api::order.order').findFirst({
      filters: { orderId, clientName }
    });
    if (!order) {
      console.warn(`[OrderLog] Order ${orderId} not found for clientName ${clientName}`);
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

    await strapi.documents('api::order.order').update({
      documentId: order.documentId,
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
  if (hasCachedToken()) {
    console.log(`♻️ Reusing cached MISA token for ${CURRENT_CLIENT_NAME}`);
    return CACHED_MISA_TOKEN!;
  }

  console.log('🔐 [1/6] Getting MISA token...');
  const requestData = { client_id: MISA_CLIENT_ID, client_secret: MISA_CLIENT_SECRET };
  const tokenUrl = `${MISA_API_BASE_URL}/api/v2/Account`;
  try {
    const response = await axios.post(tokenUrl, requestData, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 15000
    });
    console.log(`[MISA Token] Request: ${JSON.stringify(requestData)}`);
    console.log(`[MISA Token] Response status: ${response.status}, data: ${JSON.stringify(response.data)}`);
    if (!response.data.success) {
      throw new Error(`MISA token error: ${response.data.user_msg}`);
    }
    const token = response.data.data;
    CACHED_MISA_TOKEN = token;
    CACHED_MISA_TOKEN_CLIENT = CURRENT_CLIENT_NAME;
    console.log('✅ MISA token obtained');
    return token;
  } catch (error: any) {
    console.error(`❌ MISA token error: ${error.message}`);
    throw error;
  }
}

async function withMisaAuthRetry<T>(requestFn: (token: string) => Promise<T>): Promise<T> {
  let token = await getMisaToken();

  try {
    return await requestFn(token);
  } catch (error: any) {
    const status = error?.response?.status;
    if (status !== 401) {
      throw error;
    }

    console.warn(`⚠️ MISA returned 401 for ${CURRENT_CLIENT_NAME}, refreshing token and retrying once...`);
    clearCachedToken();
    token = await getMisaToken();
    return await requestFn(token);
  }
}

/**
 * Lấy danh sách order từ MISA
 */
async function fetchMisaOrders(): Promise<any[]> {
  console.log('📦 [2/6] Fetching orders from MISA...');
  const ordersUrl = `${MISA_API_BASE_URL}/api/v2/SaleOrders`;
  const params = { page: 0, pageSize: 20, orderBy: 'modified_date', isDescending: true };
  try {
    const response = await withMisaAuthRetry((token) =>
      axios.get(ordersUrl, {
        headers: { Authorization: `Bearer ${token}`, Clientid: MISA_CLIENT_ID },
        params,
        timeout: 15000
      })
    );
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
 * Tạo hoặc lấy client theo integration credential
 */
async function getOrCreateClient(cred: IntegrationCredential) {
  const clientName = cred.clientName?.trim() || 'UnknownClient';
  const clientAppId = cred.clientMerchantId?.trim() || cred.misaClientId?.trim() || clientName;

  console.log(`👤 [3/6] Ensuring client exists for ${clientName}...`);
  let client = await strapi.documents('api::client.client').findFirst({
    filters: { name: clientName }
  });
  if (!client) {
    console.log(`🆕 Creating new client ${clientName}...`);
    client = await strapi.documents('api::client.client').create({
      data: { name: clientName, appId: clientAppId, isActive: true },
      status: 'published'
    });
    console.log(`✅ Created client ${clientName} with documentId: ${client.documentId}`);
  } else {
    console.log(`✅ Client ${clientName} already exists, documentId: ${client.documentId}`);
  }
  return client;
}

/**
 * Lưu order vào database (nếu chưa có) - có ghi log processing
 */
async function upsertOrder(order: any, clientName: string, clientDocId: string) {
  const orderId = order.sale_order_no;
  if (!orderId) return null;
  console.log(`🔄 Checking order ${orderId} for client ${clientName}...`);
  const existed = await strapi.documents('api::order.order').findFirst({
    filters: { orderId, clientName }
  });
  if (existed) {
    console.log(`📌 Order ${orderId} already exists (status: ${existed.orderStatus})`);
    await addOrderLog(clientName, orderId, 'UPSERT', `Order already exists, status: ${existed.orderStatus}`);
    return existed;
  }
  console.log(`📝 Creating new order ${orderId}...`);
  let newOrder;
  try {
    newOrder = await strapi.documents('api::order.order').create({
      data: {
        orderId,
        clientName,
        payload: order,
        orderStatus: 'new',
        Client: clientDocId
      },
      status: 'published'
    });
  } catch (error: any) {
    throw error;
  }
  console.log(`✅ Created new order ${orderId} with documentId: ${newOrder.documentId}`);
  await addOrderLog(clientName, orderId, 'UPSERT', 'Order created with status new');
  return newOrder;
}

/**
 * Gửi order sang Smart Minds (Zeek) - có log chi tiết
 */
async function sendToZeek(order: any, clientName: string) {
  console.log(`📤 Sending order ${order.orderId} to Zeek...`);
  await addOrderLog(clientName, order.orderId, 'SEND_TO_ZEEK', 'Attempting to send order to Zeek');

  const misa = order.payload;
  const clientOrderId = misa.sale_order_no;
  const merchantOrderId = clientOrderId.slice(-6);
  const orderTime = Math.floor(new Date(misa.created_date).getTime() / 1000);
  const timestamp = Math.floor(Date.now() / 1000);
 
// Xử lý số điện thoại: lấy từ order, bỏ số 0 đầu nếu có
  let rawPhone = misa.phone || '';
  let cleanPhone = rawPhone.replace(/^0+/, ''); // xóa tất cả số 0 ở đầu
  if (!cleanPhone) cleanPhone = '868036856'; // fallback

  const receive = {
    user_name: misa.shipping_contact_name || misa.account_name || 'Khách hàng',
    user_phone: cleanPhone,
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
      client_merchant_id: CLIENT_MERCHANT_ID,
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
      await addOrderLog(clientName, order.orderId, 'SEND_TO_ZEEK', `Successfully sent, Zeek order ID: ${zeekOrderId}`);
      return { success: true, zeekOrderId };
    } else {
      throw new Error(response.data.err_msg || 'Zeek API error');
    }
  } catch (error: any) {
    console.error(`❌ Zeek API error for order ${order.orderId}:`, error.message);
    if (error.response) {
      console.error(`Response data: ${JSON.stringify(error.response.data)}`);
    }
    await addOrderLog(clientName, order.orderId, 'SEND_TO_ZEEK', `Failed: ${error.message}`, true);
    throw error;
  }
}

/**
 * Cập nhật order sau khi gửi thành công
 */
async function updateOrderAfterSend(order: any, clientName: string, zeekOrderId: string) {
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
  await addOrderLog(clientName, order.orderId, 'UPDATE_STATUS', `Order status updated to sent, externalOrderId=${zeekOrderId}`);
}

async function processCredential(cred: IntegrationCredential) {
  let client: any = null;
  const clientName = cred.clientName?.trim() || 'UnknownClient';
  const startTime = Date.now();
  console.log(`🚀 [START] MISA to Zeek integration test for ${clientName}`);

  try {
    loadCredential(cred);

    // 1. Fetch orders using cached token and refresh on 401
    const orders = await fetchMisaOrders();
    if (orders.length === 0) {
      console.log(`No orders to process for ${clientName}. Exiting.`);
      client = await getOrCreateClient(cred);
      await writeStepLog(client.documentId, 'no_orders', { message: `No orders from MISA for ${clientName}` }, false);
      return;
    }
    // 3. Client
    client = await getOrCreateClient(cred);
    // 4. Xử lý từng order
    let createdCount = 0;
    let sentCount = 0;
    for (const misaOrder of orders) {
      const order = await upsertOrder(misaOrder, clientName, client.documentId);
      if (order && order.orderStatus === 'new') {
        try {
          const zeekResult = await sendToZeek(order, clientName);
          if (zeekResult.success) {
            await updateOrderAfterSend(order, clientName, zeekResult.zeekOrderId);
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
    console.log(`🎉 DONE | ${clientName} | Processed ${orders.length} orders, sent ${sentCount} to Zeek in ${duration}s`);
  } catch (error: any) {
    console.error(`❌ Test failed for ${clientName}:`, error.message);
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

/**
 * Hàm chính
 */
export async function testMisa() {
  console.log('🚀 [START] MISA to Zeek integration test for all active credentials');

  const credentials = await getActiveCredentials();
  console.log(`📋 Found ${credentials.length} active credential(s)`);

  for (const cred of credentials) {
    await processCredential(cred);
  }
}

