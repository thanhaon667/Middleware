import axios from 'axios';

// Helper lấy credential SAPO (có chứa cả thông tin Zeek)
async function getSapoCredential(clientName: string) {
  const normalizedName = clientName?.trim();
  const cred = await strapi.db.query('api::integration-credential.integration-credential').findOne({
    where: {
      clientName: { $eqi: normalizedName },
      isActive: true,
    },
  });

  if (!cred) {
    throw new Error(`Credential not found for ${clientName}. Verify the integration-credential entry is published, active, and uses the same clientName.`);
  }

  const missingFields = [];
  if (!cred.sapoApiKey) missingFields.push('sapoApiKey');
  if (!cred.sapoApiSecret) missingFields.push('sapoApiSecret');
  if (!cred.sapoShopDomain) missingFields.push('sapoShopDomain');
  if (!cred.zeekApiUrl) missingFields.push('zeekApiUrl');
  if (!cred.zeekAppId) missingFields.push('zeekAppId');
  if (!cred.zeekAppSecret) missingFields.push('zeekAppSecret');
  if (!cred.clientMerchantId) missingFields.push('clientMerchantId');

  if (missingFields.length) {
    throw new Error(`Credential incomplete for ${clientName}. Missing: ${missingFields.join(', ')}`);
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

async function updateSapoOrderTag(sapoOrderId: number | string, cred: any, newTag: string) {
  const baseUrl = `https://${cred.sapoApiKey}:${cred.sapoApiSecret}@${cred.sapoShopDomain}`;
  const getUrl = `${baseUrl}/admin/orders/${sapoOrderId}.json`;
  let currentTags = '';

  try {
    const getResp = await axios.get(getUrl, {
      headers: { 'Content-Type': 'application/json' },
    });
    currentTags = getResp.data.order?.tags || '';
    console.log(`[SAPO TAG] Current tags for order ${sapoOrderId}: ${currentTags}`);
  } catch (err: any) {
    console.warn(`[SAPO TAG] Cannot fetch current tags for order ${sapoOrderId}: ${err.message}`);
  }

  const tagsArray = currentTags
    .split(',')
    .map((t: string) => t.trim())
    .filter(
      (t: string) =>
        t && !t.startsWith('Smart Minds') && !t.startsWith('SmartMinds:') && !t.startsWith('SmartMinds')
    );
  tagsArray.push(newTag);
  const updatedTags = tagsArray.join(',');

  const putUrl = `${baseUrl}/admin/orders/${sapoOrderId}.json`;
  const payload = { order: { id: sapoOrderId, tags: updatedTags } };
  console.log(`[SAPO TAG] PUT ${putUrl}`);
  console.log(`[SAPO TAG] Body: ${JSON.stringify(payload, null, 2)}`);

  const putResp = await axios.put(putUrl, payload, {
    headers: { 'Content-Type': 'application/json' },
  });
  console.log(`[SAPO TAG] Update response: ${JSON.stringify(putResp.data, null, 2)}`);
  return updatedTags;
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

      // 6. Ghi tag SAPO: SmartMinds đã tiếp nhận
      const sapoOrderId = sapoOrder.id;
      try {
        const updatedTags = await updateSapoOrderTag(sapoOrderId, cred, 'SmartMinds:đã tiếp nhận');
        console.log(`🏷️ SAPO order ${sapoOrderId} tagged: ${updatedTags}`);

        await strapi.db.query('api::sapo-order.sapo-order').update({
          where: { id: newOrder.id },
          data: {
            orderStatus: 'sent',
            externalOrderId: zeekOrderId,
            sentAt: new Date().toISOString(),
            processingLog: {
              push: {
                timestamp: new Date().toISOString(),
                step: 'sapo_tag_updated',
                message: `SAPO tag updated: ${updatedTags}`,
              },
            },
          },
        });
      } catch (tagError: any) {
        console.warn(`⚠️ [SAPO] Tag update failed for order ${sapoOrderId}: ${tagError.message}`);
        await strapi.db.query('api::sapo-order.sapo-order').update({
          where: { id: newOrder.id },
          data: {
            orderStatus: 'sent',
            externalOrderId: zeekOrderId,
            sentAt: new Date().toISOString(),
            processingLog: {
              push: {
                timestamp: new Date().toISOString(),
                step: 'sapo_tag_failed',
                message: `SAPO tag update failed: ${tagError.message}`,
              },
            },
          },
        });
        throw tagError;
      }

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
    if (process.env.NODE_ENV === 'production') {
      ctx.status = 403;
      ctx.body = { error: 'Debug endpoint is disabled in production' };
      return;
    }

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
