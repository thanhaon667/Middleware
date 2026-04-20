import axios from 'axios';

// =========================
// BIẾN TOÀN CỤC (sẽ được gán từ database)
// =========================
let MISA_CLIENT_ID: string;        // dùng để lấy token
let MISA_CLIENT_SECRET: string;
let MISA_API_BASE_URL: string;
let MISA_APP_ID: string;           // Clientid cho header

/**
 * Tải thông tin xác thực từ collection integration-credential
 */
async function loadCredentials() {
  console.log('[LOAD CREDENTIALS] Bắt đầu tải credentials từ integration-credential...');
  const cred = await strapi.db.query('api::integration-credential.integration-credential').findOne({
    where: { isActive: true }
  });
  if (!cred) {
    console.error('[LOAD CREDENTIALS] ❌ Không tìm thấy bản ghi integration-credential nào đang active');
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
  MISA_APP_ID = cred.misaAppID;   // lấy giá trị từ trường misaAppID
  console.log('[LOAD CREDENTIALS] ✅ Đã tải thành công:');
  console.log(`  - MISA_CLIENT_ID (cho token): ${MISA_CLIENT_ID}`);
  console.log(`  - MISA_API_BASE_URL: ${MISA_API_BASE_URL}`);
  console.log(`  - MISA_APP_ID (cho header Clientid): ${MISA_APP_ID}`);
}

/**
 * Helper: ghi log vào processingLog của order
 */
async function addOrderLog(orderId: string, step: string, message: string, isError: boolean = false) {
  try {
    console.log(`[ORDER LOG] ${step} - ${orderId}: ${message} ${isError ? '(ERROR)' : ''}`);
    const order = await strapi.db.query('api::order.order').findOne({
      where: { orderId }
    });
    if (!order) {
      console.warn(`[ORDER LOG] Order ${orderId} not found, không thể ghi log`);
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
    console.log(`[ORDER LOG] Đã ghi log thành công cho order ${orderId}`);
  } catch (err) {
    console.error(`[ORDER LOG] Lỗi khi ghi log cho order ${orderId}:`, err);
  }
}

/**
 * Lấy token MISA (dùng client_id và secret từ database)
 */
async function getMisaToken(): Promise<string> {
  console.log('[MISA TOKEN] Bắt đầu lấy token...');
  const requestData = { client_id: MISA_CLIENT_ID, client_secret: MISA_CLIENT_SECRET };
  const tokenUrl = `${MISA_API_BASE_URL}/api/v2/Account`;
  console.log(`[MISA TOKEN] URL: ${tokenUrl}`);
  console.log(`[MISA TOKEN] Request body: ${JSON.stringify(requestData)}`);
  try {
    const response = await axios.post(tokenUrl, requestData, {
      headers: { 'Content-Type': 'application/json' }
    });
    console.log(`[MISA TOKEN] Response status: ${response.status}`);
    console.log(`[MISA TOKEN] Response data: ${JSON.stringify(response.data)}`);
    if (!response.data.success) {
      throw new Error(`MISA token error: ${response.data.user_msg}`);
    }
    const token = response.data.data;
    console.log(`[MISA TOKEN] ✅ Token nhận được: ${token.substring(0, 20)}...`);
    return token;
  } catch (error: any) {
    console.error(`[MISA TOKEN] ❌ Lỗi: ${error.message}`);
    throw error;
  }
}

export default {
  async receive(ctx) {
    console.log('\n========== WEBHOOK RECEIVED ==========');
    try {
      // 1. Load credentials
      await loadCredentials();

      // 2. Lấy payload từ Zeek
      const payload = ctx.request.body;
      console.log('[WEBHOOK] Payload nhận được:', JSON.stringify(payload, null, 2));

      const {
        merchantOrderID,
        status,
        deliveryID,
        trackURL,
        driver,
        recipient
      } = payload;

      if (!merchantOrderID) {
        console.error('[WEBHOOK] ❌ Thiếu merchantOrderID');
        ctx.status = 400;
        ctx.body = { error: 'Missing merchantOrderID' };
        return;
      }
      console.log(`[WEBHOOK] merchantOrderID: ${merchantOrderID}, status: ${status}`);

      // 3. Ghi log nhận webhook
      await addOrderLog(merchantOrderID, 'WEBHOOK_RECEIVED', `Received status: ${status}`);

      // 4. Tìm order trong database
      console.log(`[WEBHOOK] Tìm order với orderId = ${merchantOrderID}...`);
      const order = await strapi.db.query('api::order.order').findOne({
        where: { orderId: merchantOrderID }
      });

      if (!order) {
        console.error(`[WEBHOOK] ❌ Không tìm thấy order ${merchantOrderID}`);
        await addOrderLog(merchantOrderID, 'WEBHOOK_ERROR', 'Order not found', true);
        ctx.status = 404;
        ctx.body = { error: 'Order not found' };
        return;
      }
      console.log(`[WEBHOOK] ✅ Đã tìm thấy order, id: ${order.id}, orderStatus hiện tại: ${order.orderStatus}`);

// Mapping status từ Zeek sang delivery_status MISA
const statusMapping: Record<string, string> = {
  'COMPLETED': 'Đã giao hàng',
  'FAILED': 'Chưa giao hàng',
  'IN_DELIVERY': 'Đang giao hàng',
  'PICKING_UP': 'Đang giao hàng',
};
const deliveryStatus = statusMapping[status] || 'Chưa giao hàng'; // fallback
      console.log(`[WEBHOOK] delivery_status sẽ cập nhật: ${deliveryStatus}`);

const { list_product_category, list_product, organization_unit_name, ...restPayload } = order.payload;

const updatedPayload = {
  ...restPayload,
  account_name: order.payload.account_code || order.payload.account_name,
  contact_name: order.payload.contact_code || order.payload.contact_name,
  billing_account: order.payload.account_code || order.payload.billing_account,
  billing_contact: order.payload.contact_code || order.payload.billing_contact,
  delivery_status: deliveryStatus,
  zeek_delivery_id: deliveryID,
  zeek_track_url: trackURL,
  zeek_driver_name: driver?.name,
  zeek_driver_phone: driver?.phone,
  zeek_recipient_name: recipient?.name,
  zeek_recipient_address: recipient?.address
};

// Loại bỏ stock_name khỏi mỗi sản phẩm trong mảng sale_order_product_mappings
if (updatedPayload.sale_order_product_mappings) {
  updatedPayload.sale_order_product_mappings = updatedPayload.sale_order_product_mappings.map(item => {
    const { stock_name, ...rest } = item;
    return rest;
  });
}


      console.log('[WEBHOOK] Đã tạo updatedPayload (giữ nguyên mọi trường, chỉ cập nhật delivery_status và thêm zeek fields)');

      // 7. Lấy token MISA
      let token;
      try {
        token = await getMisaToken();
      } catch (err) {
        console.error(`[WEBHOOK] ❌ Lỗi lấy token: ${err.message}`);
        await addOrderLog(merchantOrderID, 'WEBHOOK_ERROR', `Token error: ${err.message}`, true);
        ctx.status = 500;
        ctx.body = { error: 'Token error', details: err.message };
        return;
      }

      // 8. Gửi PUT lên MISA (dùng MISA_APP_ID động)
      const putUrl = `${MISA_API_BASE_URL}/api/v2/SaleOrders`;
      let response;
      try {
        console.log('[MISA PUT] ===== GỬI REQUEST PUT =====');
        console.log(`[MISA PUT] URL: ${putUrl}`);
        console.log(`[MISA PUT] Headers:`, {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token.substring(0, 20)}...`,
          'Clientid': MISA_APP_ID
        });
        console.log(`[MISA PUT] Body (full): ${JSON.stringify([updatedPayload], null, 2)}`);

        response = await axios.put(putUrl, [updatedPayload], {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
            'Clientid': MISA_APP_ID
          }
        });
        console.log(`[MISA PUT] ✅ Response status: ${response.status}`);
        console.log(`[MISA PUT] Response data: ${JSON.stringify(response.data)}`);
      } catch (err) {
        console.error(`[MISA PUT] ❌ Axios error: ${err.message}`);
        if (err.response) {
          console.error(`[MISA PUT] Response status: ${err.response.status}`);
          console.error(`[MISA PUT] Response data: ${JSON.stringify(err.response.data)}`);
        } else if (err.request) {
          console.error(`[MISA PUT] No response received: ${err.request}`);
        } else {
          console.error(`[MISA PUT] Request setup error: ${err.message}`);
        }
        await addOrderLog(merchantOrderID, 'WEBHOOK_ERROR', `MISA PUT failed: ${err.message}`, true);
        ctx.status = 500;
        ctx.body = { error: 'MISA update failed', details: err.message };
        return;
      }

      // 9. Kiểm tra phản hồi MISA
      let success = false;
      let errorMsg = '';
      if (response.data && typeof response.data === 'object') {
        if (response.data.success === true) {
          success = true;
        } else if (response.data.success === false) {
          success = false;
          errorMsg = response.data.user_msg || response.data.dev_msg || 'Unknown error';
          if (response.data.results && response.data.results[0]?.validate_infos) {
            const errors = response.data.results[0].validate_infos
              .map((e: any) => `${e.field_name}: ${e.error_message}`)
              .join(', ');
            errorMsg = `${errorMsg} (${errors})`;
          }
        } else {
          errorMsg = 'Unexpected response structure from MISA';
        }
      } else {
        errorMsg = 'Invalid response from MISA';
      }
      console.log(`[MISA PUT] Success: ${success}, Error message: ${errorMsg}`);

      if (!success) {
        console.error(`[WEBHOOK] ❌ MISA update failed: ${errorMsg}`);
        await addOrderLog(merchantOrderID, 'WEBHOOK_ERROR', `MISA rejected: ${errorMsg}`, true);
        ctx.status = 500;
        ctx.body = { error: 'MISA update failed', details: errorMsg };
        return;
      }

      // 10. Cập nhật local database
      console.log('[WEBHOOK] Cập nhật local database...');
  // Xác định orderStatus dựa trên status Zeek
let newOrderStatus = order.orderStatus;
if (status === 'COMPLETED') newOrderStatus = 'completed';
else if (status === 'FAILED') newOrderStatus = 'failed';
else if (status === 'IN_DELIVERY' || status === 'PICKING_UP') newOrderStatus = 'processing';

await strapi.db.query('api::order.order').update({
  where: { id: order.id },
  data: {
    payload: updatedPayload,
    orderStatus: newOrderStatus,
    zeekStatus: status,
    deliveredAt: status === 'COMPLETED' ? new Date() : null,
    processingLog: [
      ...(order.processingLog || []),
      {
        timestamp: new Date().toISOString(),
        step: 'WEBHOOK',
        message: `Order updated to delivery_status = ${deliveryStatus} (Zeek status: ${status})`,
        isError: false
      }
    ]
  }
});
      console.log('[WEBHOOK] ✅ Đã cập nhật local database');

      // 11. Ghi log thành công
      await addOrderLog(merchantOrderID, 'WEBHOOK_SUCCESS', `Successfully updated MISA: ${deliveryStatus}`);

      // 12. Ghi log IntegrationLog
      console.log('[WEBHOOK] Ghi log vào integration-log...');
      await strapi.db.query('api::integration-log.integration-log').create({
        data: {
          direction: 'incoming',
          endpoint: '/smartminds/webhook',
          requestBody: payload,
          responseBody: { success: true, misaResponse: response.data },
          logStatus: 'success'
        }
      });
      console.log('[WEBHOOK] ✅ Đã ghi integration-log');

      ctx.status = 200;
      ctx.body = { error: 0, err_msg: '' };
      console.log('========== WEBHOOK PROCESSED SUCCESSFULLY ==========\n');
    } catch (error) {
      console.error('[WEBHOOK] ❌ Lỗi không xác định:', error);
      ctx.status = 500;
      ctx.body = { error: 1, err_msg: error.message };
    }
  }
};