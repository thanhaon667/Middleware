import axios from 'axios';

type IntegrationCredential = {
  clientName?: string;
  sapoApiKey?: string;
  sapoApiSecret?: string;
  sapoShopDomain?: string;
  zeekApiUrl?: string;
  zeekAppId?: string;
  zeekAppSecret?: string;
  clientMerchantId?: string;
  isActive?: string | boolean;
};

let SAPO_API_KEY: string;
let SAPO_API_SECRET: string;
let SAPO_SHOP_DOMAIN: string;
let CURRENT_CLIENT_NAME: string;

function isCredentialActive(value: string | boolean | undefined) {
  if (value === true) return true;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return ['true', '1', 'active', 'yes'].includes(normalized);
  }
  return false;
}

async function getActiveCredentials(): Promise<IntegrationCredential[]> {
  console.log('[SAPO CRON] 🔍 Fetching active SAPO credentials from database...');
  const credentials = await strapi.db.query('api::integration-credential.integration-credential').findMany();
  console.log(`[SAPO CRON] 📊 Found ${credentials?.length || 0} total credentials`);

  const activeCredentials = (credentials || []).filter((cred: IntegrationCredential) => isCredentialActive(cred.isActive));
  console.log(`[SAPO CRON] ✅ Found ${activeCredentials.length} active SAPO credentials`);

  if (!activeCredentials.length) {
    throw new Error('No active SAPO integration credential found');
  }

  const dedupedCredentials: IntegrationCredential[] = [];
  const seenClientNames = new Set<string>();
  for (const cred of activeCredentials) {
    const clientKey = (cred.clientName || cred.clientMerchantId || 'UnknownClient').trim().toLowerCase();
    if (seenClientNames.has(clientKey)) {
      console.log(`[SAPO CRON] ⚠️ Skipping duplicate active credential for client: ${cred.clientName || clientKey}`);
      continue;
    }
    seenClientNames.add(clientKey);
    dedupedCredentials.push(cred);
  }

  console.log(`[SAPO CRON] 🎯 Final deduped credentials: ${dedupedCredentials.length}`);
  return dedupedCredentials;
}

function loadCredential(cred: IntegrationCredential) {
  CURRENT_CLIENT_NAME = cred.clientName?.trim() || 'UnknownClient';
  SAPO_API_KEY = cred.sapoApiKey || '';
  SAPO_API_SECRET = cred.sapoApiSecret || '';
  SAPO_SHOP_DOMAIN = cred.sapoShopDomain || '';

  console.log(`[SAPO CRON] 🔑 Loading credential for client: ${CURRENT_CLIENT_NAME}`);
  console.log(`[SAPO CRON] 🏪 Shop domain: ${SAPO_SHOP_DOMAIN}`);

  if (!SAPO_API_KEY || !SAPO_API_SECRET || !SAPO_SHOP_DOMAIN) {
    console.error(`[SAPO CRON] ❌ Credential incomplete for ${CURRENT_CLIENT_NAME}:`, {
      hasApiKey: !!SAPO_API_KEY,
      hasApiSecret: !!SAPO_API_SECRET,
      hasShopDomain: !!SAPO_SHOP_DOMAIN
    });
    throw new Error(`SAPO credential incomplete for ${CURRENT_CLIENT_NAME}`);
  }

  console.log(`[SAPO CRON] ✅ Credential loaded successfully for ${CURRENT_CLIENT_NAME}`);
}

function formatSapoDate(date: Date) {
  const pad = (value: number) => String(value).padStart(2, '0');
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hour = pad(date.getHours());
  const minute = pad(date.getMinutes());
  const second = pad(date.getSeconds());
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}

async function fetchSapoOrders(since: string, page = 1, limit = 100) {
  const url = `https://${SAPO_SHOP_DOMAIN}/admin/orders.json`;

  console.log(`[SAPO CRON] 📡 Fetching SAPO orders for ${CURRENT_CLIENT_NAME}`);
  console.log(`[SAPO CRON] 🔗 URL: ${url}`);
  console.log(`[SAPO CRON] 📅 Since: ${since}, Page: ${page}, Limit: ${limit}`);

  const params = {
    limit,
    page,
    // modified_on_min: since,  // Temporarily comment out to test
    // created_on_min: since,  // Try created_on_min instead - comment out to test without date filter
    // status: 'any',
    // financial_status: 'any',
    fields: 'id,name,order_number,created_on,updated_on,total_price,financial_status,shipping_address,line_items',
  };

  console.log(`[SAPO CRON] 🔍 Request params:`, params);

  // Log full URL with query string
  const queryString = new URLSearchParams(params as any).toString();
  const fullUrl = `${url}?${queryString}`;
  console.log(`[SAPO CRON] 🌐 Full request URL: ${fullUrl}`);

  try {
    const response = await axios.get(url, {
      auth: {
        username: SAPO_API_KEY,
        password: SAPO_API_SECRET,
      },
      params,
      timeout: 20000,
    });

    console.log(`[SAPO CRON] 📥 Response status: ${response.status}`);
    console.log(`[SAPO CRON] 📊 Response headers:`, response.headers);

    const data = response.data;
    console.log(`[SAPO CRON] 📦 Raw response data keys:`, Object.keys(data || {}));

    if (!data) {
      console.error(`[SAPO CRON] ❌ Invalid SAPO response: no data`);
      throw new Error('Invalid SAPO response while fetching orders');
    }

    let orders = [];
    if (Array.isArray(data.orders)) {
      orders = data.orders;
      console.log(`[SAPO CRON] 📋 Found orders in data.orders array`);
    } else if (Array.isArray(data.data)) {
      orders = data.data;
      console.log(`[SAPO CRON] 📋 Found orders in data.data array`);
    } else {
      console.log(`[SAPO CRON] ⚠️ No orders array found in response`);
    }

    console.log(`[SAPO CRON] ✅ Fetched ${orders.length} orders from SAPO`);
    if (orders.length > 0) {
      console.log(`[SAPO CRON] 📝 Sample order IDs: ${orders.slice(0, 3).map(o => o.id || o.order_number).join(', ')}`);
    }

    return orders;
  } catch (error: any) {
    console.error(`[SAPO CRON] ❌ SAPO API error:`, error.message);
    if (error.response) {
      console.error(`[SAPO CRON] ❌ Response status: ${error.response.status}`);
      console.error(`[SAPO CRON] ❌ Response data:`, error.response.data);
    }
    throw error;
  }
}

async function getOrCreateClient(cred: IntegrationCredential) {
  const clientName = cred.clientName?.trim() || 'UnknownClient';
  const clientAppId = cred.clientMerchantId?.trim() || clientName;

  console.log(`[SAPO CRON] 👤 Ensuring client exists: ${clientName} (appId: ${clientAppId})`);

  let client = await strapi.documents('api::client.client').findFirst({
    filters: { name: clientName }
  });

  if (!client) {
    console.log(`[SAPO CRON] 🆕 Creating new client: ${clientName}`);
    client = await strapi.documents('api::client.client').create({
      data: { name: clientName, appId: clientAppId, isActive: true },
      status: 'published'
    });
    console.log(`[SAPO CRON] ✅ Created client ${clientName} with documentId: ${client.documentId}`);
  } else {
    console.log(`[SAPO CRON] ✅ Client ${clientName} already exists, documentId: ${client.documentId}`);
  }

  return client;
}

// Helper function to detect payload changes
function detectPayloadChanges(oldPayload: any, newPayload: any) {
  const changes = {
    added: [] as string[],
    removed: [] as string[],
    modified: [] as { key: string; oldValue: any; newValue: any }[],
    timestamp: new Date().toISOString()
  };

  const oldKeys = new Set(Object.keys(oldPayload || {}));
  const newKeys = new Set(Object.keys(newPayload || {}));

  // Check for added keys
  for (const key of newKeys) {
    if (!oldKeys.has(key)) {
      changes.added.push(key);
      console.log(`[SAPO CRON] ➕ Added key: ${key}`);
    }
  }

  // Check for removed keys
  for (const key of oldKeys) {
    if (!newKeys.has(key)) {
      changes.removed.push(key);
      console.log(`[SAPO CRON] ➖ Removed key: ${key}`);
    }
  }

  // Check for modified keys
  for (const key of newKeys) {
    if (oldKeys.has(key)) {
      const oldValue = JSON.stringify(oldPayload[key]);
      const newValue = JSON.stringify(newPayload[key]);
      if (oldValue !== newValue) {
        changes.modified.push({ key, oldValue: oldPayload[key], newValue: newPayload[key] });
        console.log(`[SAPO CRON] ✏️ Modified key: ${key}`);
      }
    }
  }

  return changes;
}

async function upsertSapoOrder(order: any, clientName: string, clientDocId: string) {
  const orderId = String(order.id);
  if (!orderId) {
    console.warn(`[SAPO CRON] ⚠️ Order missing ID, skipping:`, order);
    return null;
  }

  console.log(`[SAPO CRON] 🔄 Checking sapo-order ${orderId} for client ${clientName}`);

  const existing = await strapi.db.query('api::sapo-order.sapo-order').findOne({
    where: { orderId, clientName }
  });

  if (existing) {
    console.log(`[SAPO CRON] 📌 Order ${orderId} already exists (id: ${existing.id})`);

    const oldPayload = existing.payload || {};
    const updatedOn = order.updated_on || order.updated_at || null;
    const existingUpdatedOn = oldPayload.updated_on || oldPayload.updated_at || null;

    console.log(`[SAPO CRON] 📅 Comparing timestamps - New: ${updatedOn}, Existing: ${existingUpdatedOn}`);

    // Detect payload changes
    const payloadChanges = detectPayloadChanges(oldPayload, order);

    if (payloadChanges.added.length > 0 || payloadChanges.removed.length > 0 || payloadChanges.modified.length > 0) {
      console.log(`[SAPO CRON] 🔄 Updating existing order ${orderId} with new payload`);
      console.log(`[SAPO CRON] 📊 Changes summary - Added: ${payloadChanges.added.length}, Removed: ${payloadChanges.removed.length}, Modified: ${payloadChanges.modified.length}`);
      
      // Append to existing payloadChanges history
      const existingHistory = existing.payloadChanges || [];
      const updatedHistory = Array.isArray(existingHistory) ? [...existingHistory, payloadChanges] : [payloadChanges];

      await strapi.db.query('api::sapo-order.sapo-order').update({
        where: { id: existing.id },
        data: { 
          payload: order,
          payloadChanges: updatedHistory
        }
      });
      console.log(`[SAPO CRON] ✅ Updated order ${orderId} with payload changes tracked`);
    } else {
      console.log(`[SAPO CRON] ⏭️ No payload changes detected for order ${orderId}`);
    }

    return existing;
  }

  console.log(`[SAPO CRON] 📝 Creating new sapo-order ${orderId}`);

  const merchantOrderId = String(order.order_number || order.id).slice(-6);
  const orderName = order.name || `Order ${orderId}`;

  console.log(`[SAPO CRON] 🏷️ Order details: merchantOrderId=${merchantOrderId}, name=${orderName}`);

  const newOrder = await strapi.db.query('api::sapo-order.sapo-order').create({
    data: {
      orderId,
      merchantOrderId,
      orderName,
      clientName,
      payload: order,
      payloadChanges: [
        {
          timestamp: new Date().toISOString(),
          step: 'initial_fetch',
          message: 'Initial payload from SAPO cron sync',
          added: Object.keys(order),
          removed: [],
          modified: []
        }
      ],
      orderStatus: 'new',
      platform: 'sapo',
      processingLog: [
        {
          timestamp: new Date().toISOString(),
          step: 'cron_fetched',
          message: 'Order fetched by SAPO cron sync'
        }
      ]
    }
  });

  console.log(`[SAPO CRON] ✅ Created new sapo-order ${orderId} with local ID: ${newOrder.id}`);
  return newOrder;
}

async function syncSapoOrdersForCredential(cred: IntegrationCredential) {
  console.log(`[SAPO CRON] 🚀 Starting SAPO sync for credential: ${cred.clientName || 'UnknownClient'}`);

  loadCredential(cred);
  const client = await getOrCreateClient(cred);

  const bufferMinutes = 12;
  const sinceDate = new Date(Date.now() - bufferMinutes * 60 * 1000);
  const since = formatSapoDate(sinceDate);

  console.log(`[SAPO CRON] ⏰ Sync window: ${bufferMinutes} minutes buffer`);
  console.log(`[SAPO CRON] 📅 Fetching orders since: ${since} (${sinceDate.toISOString()})`);

  let page = 1;
  let totalFetched = 0;
  let totalCreated = 0;
  let totalUpdated = 0;

  while (true) {
    console.log(`[SAPO CRON] 📄 Fetching page ${page}...`);

    const orders = await fetchSapoOrders(since, page, 100);
    if (!orders || orders.length === 0) {
      console.log(`[SAPO CRON] 🛑 No more orders on page ${page}, stopping pagination`);
      break;
    }

    console.log(`[SAPO CRON] 🔄 Processing ${orders.length} orders from page ${page}...`);

    for (const order of orders) {
      const result = await upsertSapoOrder(order, CURRENT_CLIENT_NAME, client.documentId);
      if (result) {
        if (result.createdAt === result.updatedAt) {
          totalCreated++;
        } else {
          totalUpdated++;
        }
      }
    }

    totalFetched += orders.length;
    console.log(`[SAPO CRON] 📊 Page ${page} summary: ${orders.length} fetched, ${totalFetched} total so far`);

    if (orders.length < 100) {
      console.log(`[SAPO CRON] 🛑 Less than 100 orders (${orders.length}), this is the last page`);
      break;
    }

    page++;
  }

  console.log(`[SAPO CRON] 🎉 SAPO sync completed for ${CURRENT_CLIENT_NAME}`);
  console.log(`[SAPO CRON] 📊 Final stats: ${totalFetched} fetched, ${totalCreated} created, ${totalUpdated} updated`);
}

export async function testSapo() {
  console.log('[SAPO CRON] 🚀 Starting SAPO cron sync for all active credentials');

  try {
    const credentials = await getActiveCredentials();
    console.log(`[SAPO CRON] 🎯 Processing ${credentials.length} active SAPO credentials`);

    for (let i = 0; i < credentials.length; i++) {
      const cred = credentials[i];
      const clientName = cred.clientName || 'UnknownClient';

      console.log(`[SAPO CRON] 🔄 Processing credential ${i + 1}/${credentials.length}: ${clientName}`);

      try {
        await syncSapoOrdersForCredential(cred);
        console.log(`[SAPO CRON] ✅ Successfully processed credential: ${clientName}`);
      } catch (error: any) {
        console.error(`[SAPO CRON] ❌ Failed to process credential ${clientName}:`, error.message);
        console.error(`[SAPO CRON] ❌ Error details:`, error);
      }
    }

    console.log('[SAPO CRON] 🎉 SAPO cron sync completed for all credentials');
  } catch (error: any) {
    console.error('[SAPO CRON] 🔥 Critical error in testSapo:', error.message);
    console.error('[SAPO CRON] 🔥 Error details:', error);
  }
}
