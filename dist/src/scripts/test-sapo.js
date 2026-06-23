"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.testSapo = void 0;
const axios_1 = __importDefault(require("axios"));
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
const SAPO_WATERMARK_OVERLAP_MINUTES = 2;
function isCredentialActive(value) {
    if (value === true)
        return true;
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        return ['true', '1', 'active', 'yes'].includes(normalized);
    }
    return false;
}
function hasSapoCredential(cred) {
    return Boolean(cred.sapoApiKey && cred.sapoApiSecret && cred.sapoShopDomain);
}
function parseSchedules(raw) {
    if (!raw)
        return [];
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
function getCurrentUtc7MinuteMarker(date) {
    const parts = getUtc7DateParts(date);
    const pad = (value) => String(value).padStart(2, '0');
    return `${parts.year}-${pad(parts.month + 1)}-${pad(parts.day)} ${pad(parts.hour)}:${pad(parts.minute)}`;
}
function normalizeShopDomain(domain) {
    return domain.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
}
function getUtc7DateParts(date) {
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
function createUtcDateFromUtc7Parts(year, month, day, hour, minute, second = 0) {
    return new Date(Date.UTC(year, month, day, hour, minute, second) - SAPO_TIMEZONE_OFFSET_MS);
}
function formatSapoDate(date) {
    const parts = getUtc7DateParts(date);
    const pad = (value) => String(value).padStart(2, '0');
    return `${parts.year}-${pad(parts.month + 1)}-${pad(parts.day)} ${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)}`;
}
function getStartOfUtc7Day(date) {
    const parts = getUtc7DateParts(date);
    return createUtcDateFromUtc7Parts(parts.year, parts.month, parts.day, 0, 0, 0);
}
function parseSapoOrderTimestamp(order) {
    const raw = (order === null || order === void 0 ? void 0 : order.updated_on) || (order === null || order === void 0 ? void 0 : order.updated_at) || (order === null || order === void 0 ? void 0 : order.created_on) || (order === null || order === void 0 ? void 0 : order.created_at);
    if (!raw)
        return null;
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}
function compareWatermark(order, watermark) {
    const orderDate = parseSapoOrderTimestamp(order);
    if (!orderDate)
        return true;
    if (!watermark.modifiedAt)
        return true;
    const orderMs = orderDate.getTime();
    const watermarkMs = watermark.modifiedAt.getTime();
    if (orderMs > watermarkMs)
        return true;
    if (orderMs < watermarkMs)
        return false;
    const orderId = String(order.id || '');
    const watermarkId = watermark.orderId || '';
    return orderId > watermarkId;
}
function buildWatermarkFromCredential(cred) {
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
async function getSapoScheduleConfig() {
    var _a, _b, _c, _d, _e;
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
    const map = new Map();
    for (const row of rows || []) {
        map.set(row.key, row);
    }
    return {
        enabled: ((_a = map.get('sapo_test_cron_enabled')) === null || _a === void 0 ? void 0 : _a.value) === true,
        manualRunOnce: ((_b = map.get('sapo_manual_run_once')) === null || _b === void 0 ? void 0 : _b.value) === true,
        triggerTimes: parseSchedules((_c = map.get('sapo_poll_trigger_times')) === null || _c === void 0 ? void 0 : _c.valueText).map((item) => item.label),
        lastRunMarker: ((_e = (_d = map.get('sapo_poll_last_run_marker')) === null || _d === void 0 ? void 0 : _d.valueText) === null || _e === void 0 ? void 0 : _e.trim()) || null,
    };
}
async function setBooleanSetting(key, value, description) {
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
async function setSapoLastRunMarker(marker) {
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
function shouldRunByGlobalSchedule(config, now) {
    if (config.manualRunOnce) {
        return { shouldRun: true, reason: 'manual-run-once', matchedRule: 'manual-run-once' };
    }
    if (!config.enabled) {
        return { shouldRun: false, reason: 'disabled', matchedRule: null };
    }
    const currentMarker = getCurrentUtc7MinuteMarker(now);
    if (config.lastRunMarker === currentMarker) {
        return { shouldRun: false, reason: 'already-ran-this-minute', matchedRule: null };
    }
    const currentTime = currentMarker.slice(11, 16);
    if (config.triggerTimes.length > 0 && config.triggerTimes.includes(currentTime)) {
        return { shouldRun: true, reason: 'trigger-time-match', matchedRule: currentTime };
    }
    if (config.triggerTimes.length === 0) {
        return { shouldRun: true, reason: 'no-schedule-config', matchedRule: null };
    }
    return { shouldRun: false, reason: 'schedule-not-matched', matchedRule: null };
}
async function getActiveCredentials() {
    const credentials = await strapi.db.query('api::integration-credential.integration-credential').findMany();
    const activeCredentials = (credentials || []).filter((cred) => isCredentialActive(cred.isActive) && hasSapoCredential(cred));
    if (!activeCredentials.length) {
        throw new Error('No active SAPO integration credential found');
    }
    const dedupedCredentials = [];
    const seenClientNames = new Set();
    for (const cred of activeCredentials) {
        const clientKey = (cred.clientName || cred.clientMerchantId || cred.sapoShopDomain || 'UnknownClient').trim().toLowerCase();
        if (seenClientNames.has(clientKey)) {
            console.log(`[SAPO] Skip duplicate active credential for client: ${cred.clientName || clientKey}`);
            continue;
        }
        seenClientNames.add(clientKey);
        dedupedCredentials.push(cred);
    }
    return dedupedCredentials;
}
function loadCredential(cred) {
    var _a, _b;
    CURRENT_CLIENT_NAME = ((_a = cred.clientName) === null || _a === void 0 ? void 0 : _a.trim()) || 'UnknownClient';
    SAPO_API_KEY = cred.sapoApiKey || '';
    SAPO_API_SECRET = cred.sapoApiSecret || '';
    SAPO_SHOP_DOMAIN = normalizeShopDomain(cred.sapoShopDomain || '');
    ZEEK_API_URL = cred.zeekApiUrl || '';
    ZEEK_APP_ID = cred.zeekAppId || '';
    ZEEK_APP_SECRET = cred.zeekAppSecret || '';
    CLIENT_MERCHANT_ID = cred.clientMerchantId || CURRENT_CLIENT_NAME;
    SAPO_PUSH_TAG = ((_b = cred.sapoPushTag) === null || _b === void 0 ? void 0 : _b.trim()) || 'SmartMinds:da_day_sang_zeek';
    if (!SAPO_API_KEY || !SAPO_API_SECRET || !SAPO_SHOP_DOMAIN) {
        throw new Error(`SAPO credential incomplete for ${CURRENT_CLIENT_NAME}`);
    }
    if (!ZEEK_API_URL || !ZEEK_APP_ID || !ZEEK_APP_SECRET) {
        throw new Error(`Smart Minds credential incomplete for ${CURRENT_CLIENT_NAME}`);
    }
}
async function saveCredentialPollState(credentialId, data) {
    await strapi.db.query('api::integration-credential.integration-credential').update({
        where: { id: credentialId },
        data,
    });
}
async function fetchSapoOrdersPage(modifiedSince, page = 1, limit = SAPO_PAGE_LIMIT) {
    const url = `https://${SAPO_SHOP_DOMAIN}/admin/orders.json`;
    const params = {
        limit,
        page,
        modified_on_min: modifiedSince,
        status: 'any',
        financial_status: 'any',
        fulfillment_status: 'any',
        fields: 'id,name,order_number,created_on,updated_on,total_price,financial_status,fulfillment_status,tags,shipping_address,billing_address,line_items,note',
    };
    const response = await axios_1.default.get(url, {
        auth: {
            username: SAPO_API_KEY,
            password: SAPO_API_SECRET,
        },
        params,
        timeout: 20000,
    });
    const data = response.data || {};
    if (Array.isArray(data.orders))
        return data.orders;
    if (Array.isArray(data.data))
        return data.data;
    return [];
}
function detectPayloadChanges(oldPayload, newPayload) {
    const changes = {
        added: [],
        removed: [],
        modified: [],
        timestamp: new Date().toISOString(),
    };
    const oldKeys = new Set(Object.keys(oldPayload || {}));
    const newKeys = new Set(Object.keys(newPayload || {}));
    for (const key of Array.from(newKeys)) {
        if (!oldKeys.has(key))
            changes.added.push(key);
    }
    for (const key of Array.from(oldKeys)) {
        if (!newKeys.has(key))
            changes.removed.push(key);
    }
    for (const key of Array.from(newKeys)) {
        if (!oldKeys.has(key))
            continue;
        const oldValue = JSON.stringify(oldPayload[key]);
        const newValue = JSON.stringify(newPayload[key]);
        if (oldValue !== newValue) {
            changes.modified.push({ key, oldValue: oldPayload[key], newValue: newPayload[key] });
        }
    }
    return changes;
}
async function appendSapoOrderLog(localOrderId, step, message, isError = false) {
    const localOrder = await strapi.documents('api::sapo-order.sapo-order').findFirst({
        filters: { id: localOrderId },
    });
    if (!localOrder)
        return;
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
async function getOrCreateClient(cred) {
    var _a, _b;
    const clientName = ((_a = cred.clientName) === null || _a === void 0 ? void 0 : _a.trim()) || 'UnknownClient';
    const clientAppId = ((_b = cred.clientMerchantId) === null || _b === void 0 ? void 0 : _b.trim()) || clientName;
    let client = await strapi.documents('api::client.client').findFirst({
        filters: { name: clientName },
    });
    if (!client) {
        client = await strapi.documents('api::client.client').create({
            data: { name: clientName, appId: clientAppId, isActive: true },
            status: 'published',
        });
    }
    return client;
}
async function upsertSapoOrder(order, clientName) {
    const orderId = String(order.id || '');
    if (!orderId)
        return null;
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
    return created;
}
function normalizePhone(rawPhone) {
    const digits = (rawPhone || '').replace(/\D+/g, '');
    const trimmed = digits.replace(/^0+/, '');
    return trimmed || '868036856';
}
function calculateTotalWeight(lineItems) {
    if (!Array.isArray(lineItems) || lineItems.length === 0)
        return 0;
    let totalKg = 0;
    for (const item of lineItems) {
        const quantity = Number(item.quantity || 1) || 1;
        const rawWeight = Number(item.grams || item.weight || 0) || 0;
        const itemWeightKg = item.grams ? rawWeight / 1000 : rawWeight > 50 ? rawWeight / 1000 : rawWeight;
        totalKg += itemWeightKg * quantity;
    }
    return Number(totalKg.toFixed(3));
}
function normalizeSapoAddress(address) {
    const parts = [
        address === null || address === void 0 ? void 0 : address.address1,
        address === null || address === void 0 ? void 0 : address.address2,
        address === null || address === void 0 ? void 0 : address.ward,
        address === null || address === void 0 ? void 0 : address.district,
        (address === null || address === void 0 ? void 0 : address.province) || (address === null || address === void 0 ? void 0 : address.city),
    ]
        .map((item) => String(item || '').trim())
        .filter(Boolean);
    return parts.length > 0 ? Array.from(new Set(parts)).join(', ') : 'Dia chi mac dinh';
}
function buildSmartMindsPayload(localOrder) {
    const sapo = localOrder.payload || {};
    const shippingAddress = sapo.shipping_address || sapo.billing_address || {};
    const lineItems = Array.isArray(sapo.line_items) ? sapo.line_items : [];
    const clientOrderId = String(sapo.name || sapo.order_number || sapo.id || localOrder.orderId);
    const merchantOrderId = String(sapo.order_number || sapo.id || localOrder.orderId).slice(-6);
    const createdAt = new Date(sapo.created_on || sapo.created_at || new Date().toISOString());
    const orderTime = Math.floor(createdAt.getTime() / 1000);
    const timestamp = Math.floor(Date.now() / 1000);
    const totalWeight = calculateTotalWeight(lineItems);
    const phone = normalizePhone(shippingAddress.phone || shippingAddress.phone_number || '');
    const financialStatus = String(sapo.financial_status || '').toLowerCase();
    const codType = financialStatus === 'paid' ? 2 : 1;
    const totalPrice = Number(sapo.total_price || 0) || 0;
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
            is_appoint: 0,
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
async function sendToSmartMinds(localOrder) {
    var _a, _b, _c, _d;
    const payload = buildSmartMindsPayload(localOrder);
    const response = await axios_1.default.post(ZEEK_API_URL, payload, {
        headers: {
            'Content-Type': 'application/json',
            AppID: ZEEK_APP_ID,
            AppSecret: ZEEK_APP_SECRET,
        },
        timeout: 20000,
    });
    if (((_a = response.data) === null || _a === void 0 ? void 0 : _a.error) !== 0) {
        throw new Error(((_b = response.data) === null || _b === void 0 ? void 0 : _b.err_msg) || 'Smart Minds API error');
    }
    const zeekOrderId = (_d = (_c = response.data) === null || _c === void 0 ? void 0 : _c.data) === null || _d === void 0 ? void 0 : _d.order_id;
    if (!zeekOrderId) {
        throw new Error('Smart Minds response missing order_id');
    }
    return {
        success: true,
        zeekOrderId,
    };
}
async function updateSapoOrderTag(sapoOrderId, tag) {
    var _a, _b;
    const orderUrl = `https://${SAPO_SHOP_DOMAIN}/admin/orders/${sapoOrderId}.json`;
    let currentTags = '';
    try {
        const current = await axios_1.default.get(orderUrl, {
            auth: {
                username: SAPO_API_KEY,
                password: SAPO_API_SECRET,
            },
            timeout: 15000,
        });
        currentTags = ((_b = (_a = current.data) === null || _a === void 0 ? void 0 : _a.order) === null || _b === void 0 ? void 0 : _b.tags) || '';
    }
    catch (error) {
        console.warn(`[SAPO] Cannot load current tags for order ${sapoOrderId}: ${error.message}`);
    }
    const tagsArray = currentTags
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item && !item.startsWith('SmartMinds:'));
    tagsArray.push(tag);
    const uniqueTags = Array.from(new Set(tagsArray));
    await axios_1.default.put(orderUrl, { order: { id: Number(sapoOrderId), tags: uniqueTags.join(',') } }, {
        auth: {
            username: SAPO_API_KEY,
            password: SAPO_API_SECRET,
        },
        headers: {
            'Content-Type': 'application/json',
        },
        timeout: 15000,
    });
}
async function markLocalOrderAsSent(localOrderId, zeekOrderId) {
    const localOrder = await strapi.documents('api::sapo-order.sapo-order').findFirst({
        filters: { id: localOrderId },
    });
    const currentLog = Array.isArray(localOrder === null || localOrder === void 0 ? void 0 : localOrder.processingLog) ? localOrder.processingLog : [];
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
async function markLocalOrderAsFailed(localOrderId, errorMessage) {
    const localOrder = await strapi.documents('api::sapo-order.sapo-order').findFirst({
        filters: { id: localOrderId },
    });
    const currentLog = Array.isArray(localOrder === null || localOrder === void 0 ? void 0 : localOrder.processingLog) ? localOrder.processingLog : [];
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
async function processPendingOrdersForClient(clientName) {
    var _a;
    const pendingOrders = await strapi.documents('api::sapo-order.sapo-order').findMany({
        filters: {
            clientName,
            orderStatus: { $in: ['new', 'failed'] },
        },
    });
    let sentCount = 0;
    for (const pendingOrder of pendingOrders) {
        try {
            await appendSapoOrderLog(pendingOrder.id, 'SEND_TO_SMARTMINDS', 'Sending order to Smart Minds');
            const result = await sendToSmartMinds(pendingOrder);
            await markLocalOrderAsSent(pendingOrder.id, result.zeekOrderId);
            await updateSapoOrderTag(String(((_a = pendingOrder.payload) === null || _a === void 0 ? void 0 : _a.id) || pendingOrder.orderId), SAPO_PUSH_TAG);
            await appendSapoOrderLog(pendingOrder.id, 'SAPO_TAG_UPDATED', `Applied SAPO tag ${SAPO_PUSH_TAG}`);
            sentCount++;
        }
        catch (error) {
            await markLocalOrderAsFailed(pendingOrder.id, `Failed to send order: ${error.message}`);
            console.error(`[SAPO] Failed to push order ${pendingOrder.orderId} for ${clientName}: ${error.message}`);
        }
    }
    return sentCount;
}
async function syncSapoOrdersForCredential(cred) {
    if (!cred.id) {
        throw new Error(`Credential missing database id for ${cred.clientName || 'UnknownClient'}`);
    }
    const now = new Date();
    loadCredential(cred);
    await getOrCreateClient(cred);
    const fetchWatermark = buildWatermarkFromCredential(cred);
    const modifiedSince = formatSapoDate(fetchWatermark.modifiedAt || getStartOfUtc7Day(now));
    console.log(`[SAPO] Watermark from ${modifiedSince}, lastOrderId=${fetchWatermark.orderId || 'none'}`);
    let page = 1;
    let fetchedCount = 0;
    let upsertedCount = 0;
    let newestProcessed = {
        modifiedAt: cred.sapoLastOrderModifiedAt ? new Date(cred.sapoLastOrderModifiedAt) : null,
        orderId: cred.sapoLastOrderId || null,
    };
    while (true) {
        const pageOrders = await fetchSapoOrdersPage(modifiedSince, page, SAPO_PAGE_LIMIT);
        if (!pageOrders.length)
            break;
        const incrementalOrders = pageOrders
            .filter((order) => compareWatermark(order, fetchWatermark))
            .sort((a, b) => {
            var _a, _b;
            const aDate = ((_a = parseSapoOrderTimestamp(a)) === null || _a === void 0 ? void 0 : _a.getTime()) || 0;
            const bDate = ((_b = parseSapoOrderTimestamp(b)) === null || _b === void 0 ? void 0 : _b.getTime()) || 0;
            if (aDate !== bDate)
                return aDate - bDate;
            return String(a.id || '').localeCompare(String(b.id || ''));
        });
        fetchedCount += pageOrders.length;
        for (const order of incrementalOrders) {
            const localOrder = await upsertSapoOrder(order, CURRENT_CLIENT_NAME);
            if (localOrder) {
                upsertedCount++;
            }
            const orderDate = parseSapoOrderTimestamp(order);
            if (!orderDate)
                continue;
            if (!newestProcessed.modifiedAt || orderDate.getTime() > newestProcessed.modifiedAt.getTime()) {
                newestProcessed = {
                    modifiedAt: orderDate,
                    orderId: String(order.id || ''),
                };
            }
            else if (newestProcessed.modifiedAt && orderDate.getTime() === newestProcessed.modifiedAt.getTime()) {
                const currentId = String(order.id || '');
                if (currentId > (newestProcessed.orderId || '')) {
                    newestProcessed.orderId = currentId;
                }
            }
        }
        if (pageOrders.length < SAPO_PAGE_LIMIT)
            break;
        page++;
    }
    const sentCount = await processPendingOrdersForClient(CURRENT_CLIENT_NAME);
    await saveCredentialPollState(cred.id, {
        sapoLastPolledAt: now.toISOString(),
        sapoLastOrderModifiedAt: newestProcessed.modifiedAt ? newestProcessed.modifiedAt.toISOString() : cred.sapoLastOrderModifiedAt || null,
        sapoLastOrderId: newestProcessed.orderId || cred.sapoLastOrderId || null,
    });
    console.log(`[SAPO] Done ${CURRENT_CLIENT_NAME}: fetched=${fetchedCount}, upserted=${upsertedCount}, sent=${sentCount}`);
}
async function testSapo() {
    console.log('[SAPO] Start polling flow for all active SAPO credentials');
    const now = new Date();
    const scheduleConfig = await getSapoScheduleConfig();
    const scheduleDecision = shouldRunByGlobalSchedule(scheduleConfig, now);
    if (!scheduleDecision.shouldRun) {
        console.log(`[SAPO] Skip flow: ${scheduleDecision.reason}`);
        return;
    }
    const credentials = await getActiveCredentials();
    for (const cred of credentials) {
        try {
            await syncSapoOrdersForCredential(cred);
        }
        catch (error) {
            console.error(`[SAPO] Flow failed for ${cred.clientName || 'UnknownClient'}: ${error.message}`);
        }
    }
    if (scheduleConfig.manualRunOnce) {
        await setBooleanSetting('sapo_manual_run_once', false, 'Set true and save to trigger SAPO polling flow manually one time');
    }
    await setSapoLastRunMarker(getCurrentUtc7MinuteMarker(now));
    console.log('[SAPO] Polling flow completed');
}
exports.testSapo = testSapo;
