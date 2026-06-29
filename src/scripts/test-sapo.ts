import axios from 'axios';

declare const strapi: any;

type IntegrationCredential = {
  id?: number;
  clientName?: string;
  sapoApiKey?: string;
  sapoApiSecret?: string;
  sapoShopDomain?: string;
  zeekApiUrl?: string;
  zeekAppId?: string;
  zeekAppSecret?: string;
  clientMerchantId?: string;
  isActive?: string | boolean;
  sapoLastPolledAt?: string | null;
  sapoLastOrderModifiedAt?: string | null;
  sapoLastOrderId?: string | null;
  sapoPushTag?: string | null;
};

type GlobalSapoScheduleConfig = {
  enabled: boolean;
  manualRunOnce: boolean;
  triggerTimes: string[];
  lastRunMarker: string | null;
};

type SapoOrderRecord = {
  id: number;
  documentId?: string;
  orderId: string;
  merchantOrderId?: string;
  orderName?: string;
  clientName: string;
  payload: any;
  payloadChanges?: any[];
  orderStatus?: string;
  externalOrderId?: string | null;
  sentAt?: string | null;
  processingLog?: any[];
};

type Watermark = {
  modifiedAt: Date | null;
  orderId: string | null;
};

type SmartMindsResult = {
  success: boolean;
  zeekOrderId: string;
};

let SAPO_API_KEY = '';
let SAPO_API_SECRET = '';
let SAPO_SHOP_DOMAIN = '';
let ZEEK_API_URL = '';
let ZEEK_APP_ID = '';
let ZEEK_APP_SECRET = '';
let CLIENT_MERCHANT_ID = '';
let CURRENT_CLIENT_NAME = '';
let SAPO_PUSH_TAG = 'SmartMinds:da_day_sang_zeek';

const SAPO_TIMEZONE_OFFSET_MS = 7 * 60 * 60 * 1000;
const SAPO_PAGE_LIMIT = 250;
const SAPO_MAX_PAGES_PER_RUN = 2;
const SAPO_WATERMARK_OVERLAP_MINUTES = 2;

function maskSecret(value: string | null | undefined) {
  const raw = String(value || '');
  if (!raw) return '';
  if (raw.length <= 8) return '***';
  return `${raw.slice(0, 4)}...${raw.slice(-4)}`;
}

function logDivider(title: string) {
  console.log(`\n========== ${title} ==========`);
}

function logJson(label: string, data: any) {
  console.log(`[SAPO] ${label}:`);
  console.log(JSON.stringify(data, null, 2));
}

function summarizeOrder(order: any) {
  return {
    id: order?.id,
    name: order?.name,
    order_number: order?.order_number,
    created_on: order?.created_on || order?.created_at || null,
    modified_on: order?.modified_on || order?.updated_on || order?.updated_at || null,
    total_price: order?.total_price ?? null,
    financial_status: order?.financial_status ?? null,
    fulfillment_status: order?.fulfillment_status ?? null,
  };
}

function isCredentialActive(value: string | boolean | undefined) {
  if (value === true) return true;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return ['true', '1', 'active', 'yes'].includes(normalized);
  }
  return false;
}

function hasSapoCredential(cred: IntegrationCredential) {
  return Boolean(cred.sapoApiKey && cred.sapoApiSecret && cred.sapoShopDomain);
}

function parseSchedules(raw: string | null | undefined) {
  if (!raw) return [];
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => /^\d{1,2}:\d{2}$/.test(item))
    .map((item) => {
      const [hourText, minuteText] = item.split(':');
      return {
        label: `${hourText.padStart(2, '0')}:${minuteText}`,
        hour: Number(hourText),
        minute: Number(minuteText),
      };
    })
    .filter((item) => item.hour >= 0 && item.hour <= 23 && item.minute >= 0 && item.minute <= 59);
}

function getCurrentUtc7MinuteMarker(date: Date) {
  const parts = getUtc7DateParts(date);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${parts.year}-${pad(parts.month + 1)}-${pad(parts.day)} ${pad(parts.hour)}:${pad(parts.minute)}`;
}

function normalizeShopDomain(domain: string) {
  return domain.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
}

function buildSapoPrivateAppUrl(path: string) {
  const shopDomain = normalizeShopDomain(SAPO_SHOP_DOMAIN);
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `https://${encodeURIComponent(SAPO_API_KEY)}:${encodeURIComponent(SAPO_API_SECRET)}@${shopDomain}${normalizedPath}`;
}

function buildMaskedSapoPrivateAppUrl(path: string) {
  const shopDomain = normalizeShopDomain(SAPO_SHOP_DOMAIN);
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `https://${maskSecret(SAPO_API_KEY)}:${maskSecret(SAPO_API_SECRET)}@${shopDomain}${normalizedPath}`;
}

function getUtc7DateParts(date: Date) {
  const shifted = new Date(date.getTime() + SAPO_TIMEZONE_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds(),
  };
}

function createUtcDateFromUtc7Parts(year: number, month: number, day: number, hour: number, minute: number, second = 0) {
  return new Date(Date.UTC(year, month, day, hour, minute, second) - SAPO_TIMEZONE_OFFSET_MS);
}

function formatSapoDate(date: Date) {
  const parts = getUtc7DateParts(date);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${parts.year}-${pad(parts.month + 1)}-${pad(parts.day)} ${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)}`;
}

function getStartOfUtc7Day(date: Date) {
  const parts = getUtc7DateParts(date);
  return createUtcDateFromUtc7Parts(parts.year, parts.month, parts.day, 0, 0, 0);
}

function parseSapoOrderTimestamp(order: any) {
  // SAPO dùng modified_on (không phải updated_on)
  const raw = order?.modified_on || order?.updated_on || order?.updated_at || order?.created_on || order?.created_at;
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function compareWatermark(order: any, watermark: Watermark) {
  const orderDate = parseSapoOrderTimestamp(order);
  if (!orderDate) return true;
  if (!watermark.modifiedAt) return true;

  const orderMs = orderDate.getTime();
  const watermarkMs = watermark.modifiedAt.getTime();
  if (orderMs > watermarkMs) return true;
  if (orderMs < watermarkMs) return false;

  const orderId = String(order.id || '');
  const watermarkId = watermark.orderId || '';
  return orderId > watermarkId;
}

function buildWatermarkFromCredential(cred: IntegrationCredential): Watermark {
  if (cred.sapoLastOrderModifiedAt) {
    const parsed = new Date(cred.sapoLastOrderModifiedAt);
    if (!Number.isNaN(parsed.getTime())) {
      return {
        modifiedAt: new Date(parsed.getTime() - SAPO_WATERMARK_OVERLAP_MINUTES * 60 * 1000),
        orderId: cred.sapoLastOrderId || null,
      };
    }
  }

  return {
    modifiedAt: getStartOfUtc7Day(new Date()),
    orderId: null,
  };
}

async function getSapoScheduleConfig(): Promise<GlobalSapoScheduleConfig> {
  const keys = [
    'sapo_test_cron_enabled',
    'sapo_manual_run_once',
    'sapo_poll_trigger_times',
    'sapo_poll_last_run_marker',
  ];

  const rows = await strapi.db.query('api::setting.setting').findMany({
    where: {
      key: {
        $in: keys,
      },
    },
  });

  const map = new Map<string, any>();
  for (const row of rows || []) {
    map.set(row.key, row);
  }

  return {
    enabled: map.get('sapo_test_cron_enabled')?.value === true,
    manualRunOnce: map.get('sapo_manual_run_once')?.value === true,
    triggerTimes: parseSchedules(map.get('sapo_poll_trigger_times')?.valueText).map((item) => item.label),
    lastRunMarker: map.get('sapo_poll_last_run_marker')?.valueText?.trim() || null,
  };
}

async function setBooleanSetting(key: string, value: boolean, description?: string) {
  const existing = await strapi.db.query('api::setting.setting').findOne({
    where: { key },
  });

  if (existing) {
    await strapi.db.query('api::setting.setting').update({
      where: { id: existing.id },
      data: { value },
    });
    return;
  }

  await strapi.db.query('api::setting.setting').create({
    data: {
      key,
      value,
      description,
    },
  });
}

async function setSapoLastRunMarker(marker: string) {
  const existing = await strapi.db.query('api::setting.setting').findOne({
    where: { key: 'sapo_poll_last_run_marker' },
  });

  if (existing) {
    await strapi.db.query('api::setting.setting').update({
      where: { id: existing.id },
      data: {
        valueText: marker,
      },
    });
    return;
  }

  await strapi.db.query('api::setting.setting').create({
    data: {
      key: 'sapo_poll_last_run_marker',
      valueText: marker,
      description: 'Last UTC+7 minute marker when SAPO polling flow ran',
    },
  });
}

function shouldRunByGlobalSchedule(config: GlobalSapoScheduleConfig, now: Date) {
  if (config.manualRunOnce) {
    return { shouldRun: true, reason: 'manual-run-once', matchedRule: 'manual-run-once' };
  }

  if (!config.enabled) {
    return { shouldRun: false, reason: 'disabled', matchedRule: null as string | null };
  }

  const currentMarker = getCurrentUtc7MinuteMarker(now);
  if (config.lastRunMarker === currentMarker) {
    return { shouldRun: false, reason: 'already-ran-this-minute', matchedRule: null as string | null };
  }

  const currentTime = currentMarker.slice(11, 16);
  if (config.triggerTimes.length > 0 && config.triggerTimes.includes(currentTime)) {
    return { shouldRun: true, reason: 'trigger-time-match', matchedRule: currentTime };
  }

  if (config.triggerTimes.length === 0) {
    return { shouldRun: true, reason: 'no-schedule-config', matchedRule: null as string | null };
  }

  return { shouldRun: false, reason: 'schedule-not-matched', matchedRule: null as string | null };
}

async function getActiveCredentials(): Promise<IntegrationCredential[]> {
  const credentials = await strapi.db.query('api::integration-credential.integration-credential').findMany();
  const activeCredentials = (credentials || []).filter((cred: IntegrationCredential) => isCredentialActive(cred.isActive) && hasSapoCredential(cred));

  if (!activeCredentials.length) {
    throw new Error('No active SAPO integration credential found');
  }

  const dedupedCredentials: IntegrationCredential[] = [];
  const seenClientNames = new Set<string>();

  for (const cred of activeCredentials) {
    const clientKey = (cred.clientName || cred.clientMerchantId || cred.sapoShopDomain || 'UnknownClient').trim().toLowerCase();
    if (seenClientNames.has(clientKey)) {
      console.log(`[SAPO] Skip duplicate active credential for client: ${cred.clientName || clientKey}`);
      continue;
    }
    seenClientNames.add(clientKey);
    dedupedCredentials.push(cred);
  }

  logJson('Active SAPO credentials', dedupedCredentials.map((cred) => ({
    id: cred.id,
    clientName: cred.clientName,
    shopDomain: cred.sapoShopDomain,
    isActive: cred.isActive,
    hasZeek: Boolean(cred.zeekApiUrl && cred.zeekAppId && cred.zeekAppSecret),
  })));

  return dedupedCredentials;
}

function loadCredential(cred: IntegrationCredential) {
  CURRENT_CLIENT_NAME = cred.clientName?.trim() || 'UnknownClient';
  SAPO_API_KEY = cred.sapoApiKey || '';
  SAPO_API_SECRET = cred.sapoApiSecret || '';
  SAPO_SHOP_DOMAIN = normalizeShopDomain(cred.sapoShopDomain || '');
  ZEEK_API_URL = cred.zeekApiUrl || '';
  ZEEK_APP_ID = cred.zeekAppId || '';
  ZEEK_APP_SECRET = cred.zeekAppSecret || '';
  CLIENT_MERCHANT_ID = cred.clientMerchantId || CURRENT_CLIENT_NAME;
  SAPO_PUSH_TAG = cred.sapoPushTag?.trim() || 'SmartMinds:da_day_sang_zeek';

  logDivider(`LOAD CREDENTIAL ${CURRENT_CLIENT_NAME}`);
  logJson('Credential summary', {
    clientName: CURRENT_CLIENT_NAME,
    shopDomain: SAPO_SHOP_DOMAIN,
    sapoApiKey: maskSecret(SAPO_API_KEY),
    sapoApiSecret: maskSecret(SAPO_API_SECRET),
    zeekApiUrl: ZEEK_API_URL,
    zeekAppId: ZEEK_APP_ID,
    zeekAppSecret: maskSecret(ZEEK_APP_SECRET),
    clientMerchantId: CLIENT_MERCHANT_ID,
    sapoPushTag: SAPO_PUSH_TAG,
  });

  if (!SAPO_API_KEY || !SAPO_API_SECRET || !SAPO_SHOP_DOMAIN) {
    throw new Error(`SAPO credential incomplete for ${CURRENT_CLIENT_NAME}`);
  }

  if (!ZEEK_API_URL || !ZEEK_APP_ID || !ZEEK_APP_SECRET) {
    throw new Error(`Smart Minds credential incomplete for ${CURRENT_CLIENT_NAME}`);
  }
}

async function saveCredentialPollState(credentialId: number, data: Partial<IntegrationCredential>) {
  await strapi.db.query('api::integration-credential.integration-credential').update({
    where: { id: credentialId },
    data,
  });
}

async function fetchSapoOrdersPage(page = 1, limit = SAPO_PAGE_LIMIT, modifiedAtMin?: string) {
  const url = buildSapoPrivateAppUrl('/admin/orders.json');
  const params: Record<string, any> = {
    limit,
    page,
    fields: 'id,name,order_number,created_on,updated_on,total_price,financial_status,fulfillment_status,tags,shipping_address,billing_address,line_items,note',
  };

  if (modifiedAtMin) {
    params.modified_at_min = modifiedAtMin;
  }

  logDivider(`FETCH SAPO PAGE ${page}`);
  logJson('SAPO request', {
    clientName: CURRENT_CLIENT_NAME,
    url: buildMaskedSapoPrivateAppUrl('/admin/orders.json'),
    params,
    authMode: 'private-app-url',
  });

  const response = await axios.get(url, {
    params,
    timeout: 20000,
  });

  const data = response.data || {};
  const orders = Array.isArray(data.orders) ? data.orders : Array.isArray(data.data) ? data.data : [];
  logJson('SAPO response summary', {
    clientName: CURRENT_CLIENT_NAME,
    status: response.status,
    keys: Object.keys(data || {}),
    orderCount: orders.length,
    sampleOrders: orders.slice(0, 3).map((order: any) => summarizeOrder(order)),
  });

  if (Array.isArray(data.orders)) return data.orders;
  if (Array.isArray(data.data)) return data.data;
  return [];
}

function detectPayloadChanges(oldPayload: any, newPayload: any) {
  const changes = {
    added: [] as string[],
    removed: [] as string[],
    modified: [] as { key: string; oldValue: any; newValue: any }[],
    timestamp: new Date().toISOString(),
  };

  const oldKeys = new Set(Object.keys(oldPayload || {}));
  const newKeys = new Set(Object.keys(newPayload || {}));

  for (const key of Array.from(newKeys)) {
    if (!oldKeys.has(key)) changes.added.push(key);
  }

  for (const key of Array.from(oldKeys)) {
    if (!newKeys.has(key)) changes.removed.push(key);
  }

  for (const key of Array.from(newKeys)) {
    if (!oldKeys.has(key)) continue;
    const oldValue = JSON.stringify(oldPayload[key]);
    const newValue = JSON.stringify(newPayload[key]);
    if (oldValue !== newValue) {
      changes.modified.push({ key, oldValue: oldPayload[key], newValue: newPayload[key] });
    }
  }

  return changes;
}

async function appendSapoOrderLog(localOrderId: number, step: string, message: string, isError = false) {
  const localOrder = await strapi.documents('api::sapo-order.sapo-order').findFirst({
    filters: { id: localOrderId },
  });
  if (!localOrder) return;

  const currentLog = Array.isArray(localOrder.processingLog) ? localOrder.processingLog : [];
  currentLog.push({
    timestamp: new Date().toISOString(),
    step,
    message,
    isError,
  });

  await strapi.documents('api::sapo-order.sapo-order').update({
    documentId: localOrder.documentId,
    data: {
      processingLog: currentLog.slice(-100),
    },
  });
}

async function getOrCreateClient(cred: IntegrationCredential) {
  const clientName = cred.clientName?.trim() || 'UnknownClient';
  const clientAppId = cred.clientMerchantId?.trim() || clientName;

  let client = await strapi.documents('api::client.client').findFirst({
    filters: { name: clientName },
  });

  if (!client) {
    client = await strapi.documents('api::client.client').findFirst({
      filters: { appId: clientAppId },
    });
  }

  if (!client) {
    try {
      client = await strapi.documents('api::client.client').create({
        data: { name: clientName, appId: clientAppId, isActive: true },
        status: 'published',
      });
    } catch (createError: any) {
      // Handle race condition or pre-existing record with same appId
      if (createError?.message?.includes('unique') || createError?.details?.errors?.some?.((e: any) => e.path?.includes('appId'))) {
        client = await strapi.documents('api::client.client').findFirst({
          filters: { appId: clientAppId },
        });
        if (!client) throw createError;
      } else {
        throw createError;
      }
    }
  }

  return client;
}

async function upsertSapoOrder(order: any, clientName: string) {
  const orderId = String(order.id || '');
  if (!orderId) return null;

  logJson('UPSERT incoming order', {
    clientName,
    order: summarizeOrder(order),
  });

  const existing = await strapi.documents('api::sapo-order.sapo-order').findFirst({
    filters: { orderId, clientName },
  });

  if (existing) {
    const payloadChanges = detectPayloadChanges(existing.payload || {}, order);
    const hasChanges = payloadChanges.added.length > 0 || payloadChanges.removed.length > 0 || payloadChanges.modified.length > 0;

    if (hasChanges) {
      const history = Array.isArray(existing.payloadChanges) ? existing.payloadChanges : [];
      await strapi.documents('api::sapo-order.sapo-order').update({
        documentId: existing.documentId,
        data: {
          payload: order,
          payloadChanges: [...history, payloadChanges],
        },
      });
      await appendSapoOrderLog(existing.id, 'UPSERT', 'Payload updated from SAPO poll');
      logJson('UPSERT updated existing order', {
        localId: existing.id,
        documentId: existing.documentId,
        orderId,
        changedKeys: {
          added: payloadChanges.added,
          removed: payloadChanges.removed,
          modified: payloadChanges.modified.map((item) => item.key),
        },
      });
    }

    return await strapi.documents('api::sapo-order.sapo-order').findFirst({
      filters: { id: existing.id },
    });
  }

  const merchantOrderId = String(order.order_number || order.id).slice(-6);
  const orderName = order.name || `Order ${orderId}`;

  const created = await strapi.documents('api::sapo-order.sapo-order').create({
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
          message: 'Initial payload from SAPO poll',
          added: Object.keys(order),
          removed: [],
          modified: [],
        },
      ],
      orderStatus: 'new',
      platform: 'sapo',
      processingLog: [
        {
          timestamp: new Date().toISOString(),
          step: 'cron_fetched',
          message: 'Order fetched by SAPO poll',
        },
      ],
    },
    status: 'published',
  });

  logJson('UPSERT created new order', {
    localId: created.id,
    documentId: created.documentId,
    clientName,
    order: summarizeOrder(order),
  });

  return created;
}

function normalizePhone(rawPhone: string) {
  const digits = (rawPhone || '').replace(/\D+/g, '');
  // Xóa prefix quốc tế: +84 hoặc 84 ở đầu → về dạng 9xxxxxxxx
  const withoutCountry = digits.replace(/^(84|0084)/, '');
  // Nếu còn bắt đầu bằng 0 thì xóa 0
  const trimmed = withoutCountry.replace(/^0+/, '');
  return trimmed || '868036856';
}

function calculateTotalWeight(lineItems: any[]) {
  if (!Array.isArray(lineItems) || lineItems.length === 0) return 0;

  let totalKg = 0;
  for (const item of lineItems) {
    const quantity = Number(item.quantity || 1) || 1;
    const rawWeight = Number(item.grams || item.weight || 0) || 0;
    const itemWeightKg = item.grams ? rawWeight / 1000 : rawWeight > 50 ? rawWeight / 1000 : rawWeight;
    totalKg += itemWeightKg * quantity;
  }

  return Number(totalKg.toFixed(3));
}

function normalizeSapoAddress(address: any) {
  const parts = [
    address?.address1,
    address?.address2,
    address?.ward,
    address?.district,
    address?.province || address?.city,
  ]
    .map((item) => String(item || '').trim())
    .filter(Boolean);

  return parts.length > 0 ? Array.from(new Set(parts)).join(', ') : 'Dia chi mac dinh';
}

function buildSmartMindsPayload(localOrder: SapoOrderRecord) {
  const sapo = localOrder.payload || {};
  const shippingAddress = sapo.shipping_address || sapo.billing_address || {};
  const lineItems = Array.isArray(sapo.line_items) ? sapo.line_items : [];
  // Dùng SAPO order.id làm client_order_id — key duy nhất để đối soát callback từ SmartMinds
  const clientOrderId = String(sapo.id || localOrder.orderId);
  const merchantOrderId = String(sapo.order_number || sapo.id || localOrder.orderId).slice(-6);
  const createdAt = new Date(sapo.created_on || sapo.created_at || new Date().toISOString());
  const orderTime = Math.floor(createdAt.getTime() / 1000);
  const timestamp = Math.floor(Date.now() / 1000);
  const totalWeight = calculateTotalWeight(lineItems);
  const phone = normalizePhone(shippingAddress.phone || shippingAddress.phone_number || '');
  const financialStatus = String(sapo.financial_status || '').toLowerCase();
  const codType = financialStatus === 'paid' ? 2 : 1;
  const totalPrice = Number(sapo.total_price || 0) || 0;

  const expectedDeliveryRaw = sapo.expected_delivery_date || sapo.shipment_deadline || null;
  const appointTime = expectedDeliveryRaw ? Math.floor(new Date(expectedDeliveryRaw).getTime() / 1000) : null;

  return {
    auth: {
      appid: Number(ZEEK_APP_ID),
      timestamp,
      signature: ZEEK_APP_SECRET,
      secret_key: ZEEK_APP_SECRET,
    },
    data: {
      meta: {
        language: 'vi',
        lang: 'vi',
        region: 'SGN',
      },
      client_merchant_id: CLIENT_MERCHANT_ID,
      client_order_id: clientOrderId,
      merchant_order_id: merchantOrderId,
      order_time: orderTime,
      is_appoint: appointTime ? 2 : 0,
      appoint_time: appointTime,
      remark: sapo.note || '',
      merchant_remark: '',
      cod_type: codType,
      receive: {
        user_name: shippingAddress.full_name || shippingAddress.name || 'Khach hang',
        user_phone: phone,
        user_phone_country_code: '84',
        user_location: '',
        user_address: normalizeSapoAddress(shippingAddress),
      },
      order_detail: {
        total_price: totalPrice,
        item_weight: totalWeight,
      },
    },
  };
}

async function sendToSmartMinds(localOrder: SapoOrderRecord): Promise<SmartMindsResult> {
  const payload = buildSmartMindsPayload(localOrder);
  logDivider(`SEND TO SMART MINDS ${localOrder.orderId}`);
  logJson('Smart Minds request', {
    clientName: localOrder.clientName,
    orderId: localOrder.orderId,
    url: ZEEK_API_URL,
    headers: {
      AppID: ZEEK_APP_ID,
      AppSecret: maskSecret(ZEEK_APP_SECRET),
    },
    payload,
  });
  const response = await axios.post(ZEEK_API_URL, payload, {
    headers: {
      'Content-Type': 'application/json',
      AppID: ZEEK_APP_ID,
      AppSecret: ZEEK_APP_SECRET,
    },
    timeout: 20000,
  });

  logJson('Smart Minds response', {
    clientName: localOrder.clientName,
    orderId: localOrder.orderId,
    status: response.status,
    data: response.data,
  });

  if (response.data?.error !== 0) {
    throw new Error(response.data?.err_msg || 'Smart Minds API error');
  }

  const zeekOrderId = response.data?.data?.order_id;
  if (!zeekOrderId) {
    throw new Error('Smart Minds response missing order_id');
  }

  return {
    success: true,
    zeekOrderId,
  };
}

async function updateSapoOrderTag(sapoOrderId: string, tag: string) {
  const orderUrl = buildSapoPrivateAppUrl(`/admin/orders/${sapoOrderId}.json`);
  logDivider(`UPDATE SAPO TAG ${sapoOrderId}`);

  let currentTags = '';
  try {
    const current = await axios.get(orderUrl, {
      timeout: 15000,
    });
    currentTags = current.data?.order?.tags || '';
    logJson('Current SAPO tags', {
      sapoOrderId,
      status: current.status,
      currentTags,
    });
  } catch (error: any) {
    console.warn(`[SAPO] Cannot load current tags for order ${sapoOrderId}: ${error.message}`);
  }

  const tagsArray = currentTags
    .split(',')
    .map((item: string) => item.trim())
    .filter((item: string) => item && !item.startsWith('SmartMinds:'));

  tagsArray.push(tag);
  const uniqueTags = Array.from(new Set(tagsArray));
  logJson('SAPO tag update request', {
    sapoOrderId,
    orderUrl: buildMaskedSapoPrivateAppUrl(`/admin/orders/${sapoOrderId}.json`),
    finalTags: uniqueTags,
  });

  const response = await axios.put(
    orderUrl,
    { order: { id: Number(sapoOrderId), tags: uniqueTags.join(',') } },
    {
      headers: {
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    }
  );

  logJson('SAPO tag update response', {
    sapoOrderId,
    status: response.status,
    data: response.data,
  });
}

async function markLocalOrderAsSent(localOrderId: number, zeekOrderId: string) {
  const localOrder = await strapi.documents('api::sapo-order.sapo-order').findFirst({
    filters: { id: localOrderId },
  });
  const currentLog = Array.isArray(localOrder?.processingLog) ? localOrder.processingLog : [];
  currentLog.push({
    timestamp: new Date().toISOString(),
    step: 'SEND_TO_SMARTMINDS',
    message: `Order sent to Smart Minds, externalOrderId=${zeekOrderId}`,
  });

  await strapi.documents('api::sapo-order.sapo-order').update({
    documentId: localOrder.documentId,
    data: {
      orderStatus: 'sent',
      externalOrderId: zeekOrderId,
      sentAt: new Date().toISOString(),
      processingLog: currentLog.slice(-100),
    },
  });
}

async function markLocalOrderAsFailed(localOrderId: number, errorMessage: string) {
  const localOrder = await strapi.documents('api::sapo-order.sapo-order').findFirst({
    filters: { id: localOrderId },
  });
  const currentLog = Array.isArray(localOrder?.processingLog) ? localOrder.processingLog : [];
  currentLog.push({
    timestamp: new Date().toISOString(),
    step: 'SEND_TO_SMARTMINDS',
    message: errorMessage,
    isError: true,
  });

  await strapi.documents('api::sapo-order.sapo-order').update({
    documentId: localOrder.documentId,
    data: {
      orderStatus: 'failed',
      processingLog: currentLog.slice(-100),
    },
  });
}

async function processPendingOrdersForClient(clientName: string) {
  const pendingOrders = await strapi.documents('api::sapo-order.sapo-order').findMany({
    filters: {
      clientName,
      orderStatus: { $in: ['new', 'failed'] },
    },
  });

  let sentCount = 0;
  logJson('Pending SAPO orders for Smart Minds', {
    clientName,
    count: pendingOrders.length,
    orders: pendingOrders.map((order: SapoOrderRecord) => ({
      id: order.id,
      orderId: order.orderId,
      orderName: order.orderName,
      orderStatus: order.orderStatus,
      externalOrderId: order.externalOrderId,
    })),
  });

  for (const pendingOrder of pendingOrders as SapoOrderRecord[]) {
    try {
      await appendSapoOrderLog(pendingOrder.id, 'SEND_TO_SMARTMINDS', 'Sending order to Smart Minds');
      const result = await sendToSmartMinds(pendingOrder);
      await markLocalOrderAsSent(pendingOrder.id, result.zeekOrderId);
      await updateSapoOrderTag(String(pendingOrder.payload?.id || pendingOrder.orderId), SAPO_PUSH_TAG);
      await appendSapoOrderLog(pendingOrder.id, 'SAPO_TAG_UPDATED', `Applied SAPO tag ${SAPO_PUSH_TAG}`);
      sentCount++;
    } catch (error: any) {
      await markLocalOrderAsFailed(pendingOrder.id, `Failed to send order: ${error.message}`);
      console.error(`[SAPO] Failed to push order ${pendingOrder.orderId} for ${clientName}: ${error.message}`);
    }
  }

  return sentCount;
}

async function syncSapoOrdersForCredential(cred: IntegrationCredential) {
  if (!cred.id) {
    throw new Error(`Credential missing database id for ${cred.clientName || 'UnknownClient'}`);
  }

  const now = new Date();
  logDivider(`START CLIENT ${cred.clientName || 'UnknownClient'}`);
  loadCredential(cred);
  await getOrCreateClient(cred);

  const fetchWatermark = buildWatermarkFromCredential(cred);
  const modifiedAtMin = fetchWatermark.modifiedAt ? formatSapoDate(fetchWatermark.modifiedAt) : null;
  console.log(
    `[SAPO] Fetch filter: modified_at_min=${modifiedAtMin || 'none (start of day)'}, lastOrderId=${fetchWatermark.orderId || 'none'}`
  );

  let page = 1;
  let fetchedCount = 0;
  let upsertedCount = 0;
  let newestProcessed: Watermark = {
    modifiedAt: cred.sapoLastOrderModifiedAt ? new Date(cred.sapoLastOrderModifiedAt) : null,
    orderId: cred.sapoLastOrderId || null,
  };

  while (true) {
    if (page > SAPO_MAX_PAGES_PER_RUN) {
      console.log(
        `[SAPO] Stop paging at page ${page - 1}: reached max ${SAPO_MAX_PAGES_PER_RUN} page(s) per run`
      );
      break;
    }

    const pageOrders = await fetchSapoOrdersPage(page, SAPO_PAGE_LIMIT, modifiedAtMin || undefined);
    if (!pageOrders.length) break;

    // Sort tăng dần theo timestamp → orderId để xử lý đúng thứ tự
    const incrementalOrders = [...pageOrders].sort((a: any, b: any) => {
      const aDate = parseSapoOrderTimestamp(a)?.getTime() || 0;
      const bDate = parseSapoOrderTimestamp(b)?.getTime() || 0;
      if (aDate !== bDate) return aDate - bDate;
      return String(a.id || '').localeCompare(String(b.id || ''));
    });

    // Lọc bỏ các order đã nằm dưới watermark (overlap 2 phút có thể trả về order cũ)
    const newOrders = incrementalOrders.filter((order: any) => compareWatermark(order, fetchWatermark));

    fetchedCount += pageOrders.length;
    logJson('Compare SAPO orders', {
      clientName: CURRENT_CLIENT_NAME,
      page,
      fetchedFromSapo: pageOrders.length,
      afterWatermarkFilter: newOrders.length,
      skipped: pageOrders.length - newOrders.length,
      sample: newOrders.slice(0, 3).map((order: any) => summarizeOrder(order)),
    });

    for (const order of newOrders) {
      const localOrder = await upsertSapoOrder(order, CURRENT_CLIENT_NAME);
      if (localOrder) {
        upsertedCount++;
      }

      const orderDate = parseSapoOrderTimestamp(order);
      if (!orderDate) continue;

      if (!newestProcessed.modifiedAt || orderDate.getTime() > newestProcessed.modifiedAt.getTime()) {
        newestProcessed = {
          modifiedAt: orderDate,
          orderId: String(order.id || ''),
        };
      } else if (newestProcessed.modifiedAt && orderDate.getTime() === newestProcessed.modifiedAt.getTime()) {
        const currentId = String(order.id || '');
        if (currentId > (newestProcessed.orderId || '')) {
          newestProcessed.orderId = currentId;
        }
      }
    }

    if (pageOrders.length < SAPO_PAGE_LIMIT) break;
    page++;
  }

  const sentCount = await processPendingOrdersForClient(CURRENT_CLIENT_NAME);

  await saveCredentialPollState(cred.id, {
    sapoLastPolledAt: now.toISOString(),
    sapoLastOrderModifiedAt: newestProcessed.modifiedAt ? newestProcessed.modifiedAt.toISOString() : cred.sapoLastOrderModifiedAt || null,
    sapoLastOrderId: newestProcessed.orderId || cred.sapoLastOrderId || null,
  });

  logJson('Updated SAPO poll watermark', {
    clientName: CURRENT_CLIENT_NAME,
    sapoLastPolledAt: now.toISOString(),
    sapoLastOrderModifiedAt: newestProcessed.modifiedAt ? newestProcessed.modifiedAt.toISOString() : cred.sapoLastOrderModifiedAt || null,
    sapoLastOrderId: newestProcessed.orderId || cred.sapoLastOrderId || null,
  });

  console.log(`[SAPO] Done ${CURRENT_CLIENT_NAME}: fetched=${fetchedCount}, upserted=${upsertedCount}, sent=${sentCount}`);
}

export async function testSapo() {
  logDivider('SAPO POLLING FLOW START');

  const now = new Date();
  const scheduleConfig = await getSapoScheduleConfig();
  logJson('SAPO schedule config', scheduleConfig);
  const scheduleDecision = shouldRunByGlobalSchedule(scheduleConfig, now);
  logJson('SAPO schedule decision', {
    now: now.toISOString(),
    ...scheduleDecision,
  });
  if (!scheduleDecision.shouldRun) {
    console.log(`[SAPO] Skip flow: ${scheduleDecision.reason}`);
    return;
  }

  const credentials = await getActiveCredentials();
  for (const cred of credentials) {
    try {
      await syncSapoOrdersForCredential(cred);
    } catch (error: any) {
      console.error(`[SAPO] Flow failed for ${cred.clientName || 'UnknownClient'}: ${error.message}`);
    }
  }

  if (scheduleConfig.manualRunOnce) {
    await setBooleanSetting(
      'sapo_manual_run_once',
      false,
      'Set true and save to trigger SAPO polling flow manually one time'
    );
  }

  await setSapoLastRunMarker(getCurrentUtc7MinuteMarker(now));

  logDivider('SAPO POLLING FLOW COMPLETED');
}
