import axios from 'axios';

// Helper lấy credential SAPO (có chứa cả thông tin Zeek)
async function getSapoCredential(clientName: string) {
  const cred = await strapi.db.query('api::integration-credential.integration-credential').findOne({
    where: { clientName, isActive: true }
  });
  if (!cred || !cred.sapoApiKey || !cred.sapoShopDomain || !cred.zeekApiUrl) {
    throw new Error(`Credential incomplete for ${clientName}`);
  }
  return cred;
}

// Log chi tiết request/response
function logJson(label: string, data: any) {
  console.log(`\n========== ${label} ==========`);
  console.log(JSON.stringify(data, null, 2));
  console.log('================================\n');
}

// Map SAPO order → Zeek payload (dựa trên cấu trúc đã test)
function mapSapoOrderToZeek(order: any, cred: any) {
  const address = order.shipping_address || order.billing_address;
  const phone = address?.phone?.replace(/^0+/, '') || '';
  let totalWeight = 0;
  if (order.line_items) {
    totalWeight = order.line_items.reduce((sum, item) => sum + (item.grams || 0) * (item.quantity || 1), 0) / 1000;
  }
  const clientOrderId = String(order.id);
  const merchantOrderId = String(order.order_number || order.id).slice(-6);
  const orderTime = Math.floor(new Date(order.created_on).getTime() / 1000);
  const timestamp = Math.floor(Date.now() / 1000);
  let userAddress = '';
  if (address) {
    const parts = [address.address1, address.ward, address.district, address.province].filter(p => p);
    userAddress = parts.join(', ');
  }
  return {
    auth: {
      appid: Number(cred.zeekAppId),
      timestamp,
      signature: cred.zeekAppSecret,
    },
    data: {
      meta: { language: 'vi', lang: 'vi', region: 'SGN' },
      client_merchant_id: cred.clientMerchantId,
      client_order_id: clientOrderId,
      merchant_order_id: merchantOrderId,
      order_time: orderTime,
      is_appoint: 0,
      remark: order.note || '',
      cod_type: order.financial_status === 'paid' ? 2 : 1,
      receive: {
        user_name: address?.name || '',
        user_phone: phone,
        user_phone_country_code: '84',
        user_location: '',
        user_address: userAddress || 'Địa chỉ mặc định',
      },
      order_detail: {
        total_price: order.total_price || 0,
        item_weight: totalWeight,
      },
    },
  };
}

// Gửi sang Zeek
async function sendToZeek(payload: any, cred: any): Promise<string> {
  logJson('Zeek Request Payload', payload);
  const response = await axios.post(cred.zeekApiUrl, payload, {
    headers: {
      'Content-Type': 'application/json',
      AppID: cred.zeekAppId,
      AppSecret: cred.zeekAppSecret,
    },
  });
  logJson('Zeek Response', response.data);
  if (response.data.error !== 0) {
    throw new Error(response.data.err_msg || 'Zeek API error');
  }
  return response.data.data.order_id;
}

export default {
  async receiveOrder(ctx) {
    const { clientName } = ctx.params;
    console.log(`\n🚀 [SAPO] Webhook received for client: ${clientName}`);

    try {
      // 1. Lấy credential
      const cred = await getSapoCredential(clientName);

      // 2. Nhận payload từ SAPO (body là chính order object)
      const sapoOrder = ctx.request.body;
      logJson('Incoming Webhook from SAPO', sapoOrder);
      const orderId = String(sapoOrder.id);
      const merchantOrderId = String(sapoOrder.order_number || sapoOrder.id).slice(-6);
      console.log(`📦 Order ID: ${orderId}, Name: ${sapoOrder.name}, merchantOrderId: ${merchantOrderId}`);

      // 3. Kiểm tra trùng lặp (dùng collection sapo-order)
      const existing = await strapi.db.query('api::sapo-order.sapo-order').findOne({
        where: { orderId, clientName },
      });
      if (existing) {
        console.log(`⚠️ Order ${orderId} already exists, skipping.`);
        ctx.status = 200;
        ctx.body = { ok: true, message: 'already processed' };
        return;
      }

      // 4. Tạo bản ghi mới trong collection sapo-order ở trạng thái live
      const newOrder = await (strapi.entityService as any).create('api::sapo-order.sapo-order', {
        data: {
          orderId,
          merchantOrderId,
          orderName: sapoOrder.name || `Order ${orderId}`,
          clientName,
          payload: sapoOrder,
          orderStatus: 'new',
          platform: 'sapo',
          processingLog: [
            {
              timestamp: new Date().toISOString(),
              step: 'webhook_received',
              message: `Order from SAPO, source: ${sapoOrder.source_name || 'unknown'}`,
            },
          ],
        },
        publicationState: 'live',
      });
      console.log(`✅ Order saved with local ID: ${newOrder.id}`);
      console.log(`📢 Order created live in CMS`);

      // 5. Map và gửi sang Zeek
      const zeekPayload = mapSapoOrderToZeek(sapoOrder, cred);
      const zeekOrderId = await sendToZeek(zeekPayload, cred);
      console.log(`🚀 Zeek order created: ${zeekOrderId}`);

      // 6. Cập nhật trạng thái order
      await strapi.db.query('api::sapo-order.sapo-order').update({
        where: { id: newOrder.id },
        data: {
          orderStatus: 'sent',
          externalOrderId: zeekOrderId,
          sentAt: new Date().toISOString(),
          processingLog: {
            push: {
              timestamp: new Date().toISOString(),
              step: 'sent_to_zeek',
              message: `Zeek order ID: ${zeekOrderId}`,
            },
          },
        },
      });

      ctx.status = 200;
      ctx.body = { ok: true, zeekOrderId };
    } catch (error) {
      console.error('🔥 [SAPO] Critical error:', error);
      ctx.status = 500;
      ctx.body = { error: error.message };
    }
  },

  // Debug function - kiểm tra sapo-order data
  async debugOrders(ctx) {
    const { clientName } = ctx.params;
    console.log(`\n🔍 [DEBUG] Checking sapo-orders for client: ${clientName}`);

    try {
      const orders = await strapi.db.query('api::sapo-order.sapo-order').findMany({
        where: { clientName },
        limit: 10,
        orderBy: { createdAt: 'desc' },
      });

      console.log(`📊 Found ${orders.length} sapo-orders for ${clientName}`);

      // Log chi tiết từng order
      orders.forEach((order, index) => {
        console.log(`\n--- Order ${index + 1} ---`);
        console.log(`ID: ${order.id}`);
        console.log(`orderId: ${order.orderId}`);
        console.log(`merchantOrderId: ${order.merchantOrderId}`);
        console.log(`orderStatus: ${order.orderStatus}`);
        console.log(`platform: ${order.platform}`);
        console.log(`publishedAt: ${order.publishedAt}`);
        console.log(`Payload exists: ${!!order.payload}`);
        if (order.payload) {
          console.log(`Payload keys: ${Object.keys(order.payload).join(', ')}`);
          console.log(`Order name from payload: ${order.payload.name}`);
        } else {
          console.log('Payload is null/undefined');
        }
      });

      ctx.status = 200;
      ctx.body = {
        count: orders.length,
        orders: orders.map(order => ({
          id: order.id,
          orderId: order.orderId,
          merchantOrderId: order.merchantOrderId,
          orderStatus: order.orderStatus,
          platform: order.platform,
          publishedAt: order.publishedAt,
          hasPayload: !!order.payload,
          payloadKeys: order.payload ? Object.keys(order.payload) : null,
          orderName: order.payload?.name || null,
        }))
      };
    } catch (error) {
      console.error('🔥 [DEBUG] Error:', error);
      ctx.status = 500;
      ctx.body = { error: error.message };
    }
  },
};