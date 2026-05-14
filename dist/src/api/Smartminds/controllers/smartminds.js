"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const axios_1 = __importDefault(require("axios"));
// =========================
// BIẾN TOÀN CỤC (sẽ được gán từ database)
// =========================
let MISA_CLIENT_ID;
let MISA_CLIENT_SECRET;
let MISA_API_BASE_URL;
let MISA_APP_ID;
/**
 * Tải thông tin xác thực từ collection integration-credential (dùng cho webhook cũ)
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
    let base = cred.misaApiUrl;
    if (base.includes('/api/v2/Account')) {
        base = base.replace('/api/v2/Account', '');
    }
    MISA_API_BASE_URL = base;
    MISA_APP_ID = cred.misaAppID;
    console.log('[LOAD CREDENTIALS] ✅ Đã tải thành công:');
    console.log(`  - MISA_CLIENT_ID: ${MISA_CLIENT_ID}`);
    console.log(`  - MISA_API_BASE_URL: ${MISA_API_BASE_URL}`);
    console.log(`  - MISA_APP_ID: ${MISA_APP_ID}`);
}
/**
 * Tìm integration credential active theo clientName (dùng cho webhook mới)
 */
async function getCredentialByClientName(clientName) {
    console.log(`[CREDENTIAL] Tìm credential với clientName = ${clientName}`);
    const cred = await strapi.db.query('api::integration-credential.integration-credential').findOne({
        where: { clientName: clientName, isActive: true }
    });
    if (!cred) {
        throw new Error(`No active integration credential found for clientName: ${clientName}`);
    }
    console.log(`[CREDENTIAL] Tìm thấy credential cho client: ${cred.clientName}`);
    return cred;
}
/**
 * Helper: ghi log vào processingLog của order
 */
async function addOrderLog(orderId, step, message, isError = false) {
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
            try {
                logs = JSON.parse(logs);
            }
            catch {
                logs = [];
            }
        }
        if (!Array.isArray(logs))
            logs = [];
        logs.push({
            timestamp: new Date().toISOString(),
            step,
            message,
            isError
        });
        if (logs.length > 100)
            logs = logs.slice(-100);
        await strapi.db.query('api::order.order').update({
            where: { id: order.id },
            data: { processingLog: logs }
        });
        console.log(`[ORDER LOG] Đã ghi log thành công cho order ${orderId}`);
    }
    catch (err) {
        console.error(`[ORDER LOG] Lỗi khi ghi log cho order ${orderId}:`, err);
    }
}
/**
 * Lấy token MISA (dùng client_id và secret từ biến toàn cục - webhook cũ)
 */
async function getMisaToken() {
    console.log('[MISA TOKEN] Bắt đầu lấy token...');
    const requestData = { client_id: MISA_CLIENT_ID, client_secret: MISA_CLIENT_SECRET };
    const tokenUrl = `${MISA_API_BASE_URL}/api/v2/Account`;
    console.log(`[MISA TOKEN] URL: ${tokenUrl}`);
    console.log(`[MISA TOKEN] Request body: ${JSON.stringify(requestData)}`);
    try {
        const response = await axios_1.default.post(tokenUrl, requestData, {
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
    }
    catch (error) {
        console.error(`[MISA TOKEN] ❌ Lỗi: ${error.message}`);
        throw error;
    }
}
/**
 * Lấy token MISA theo credential cụ thể (dùng cho webhook mới)
 */
async function getMisaTokenByCredential(cred) {
    console.log('[MISA TOKEN] Bắt đầu lấy token theo credential...');
    const requestData = { client_id: cred.misaClientId, client_secret: cred.misaClientSecret };
    let baseUrl = cred.misaApiUrl;
    if (baseUrl.includes('/api/v2/Account')) {
        baseUrl = baseUrl.replace('/api/v2/Account', '');
    }
    const tokenUrl = `${baseUrl}/api/v2/Account`;
    console.log(`[MISA TOKEN] URL: ${tokenUrl}`);
    console.log(`[MISA TOKEN] Request body: ${JSON.stringify(requestData)}`);
    try {
        const response = await axios_1.default.post(tokenUrl, requestData, {
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
    }
    catch (error) {
        console.error(`[MISA TOKEN] ❌ Lỗi: ${error.message}`);
        throw error;
    }
}
/**
 * Map trạng thái từ mã Zeek (order_status) sang một trong các giá trị:
 * 'COMPLETED', 'FAILED', 'IN_DELIVERY', 'PICKING_UP'
 */
function mapZeekStatusToEnum(code, desc) {
    console.log(`[MAP STATUS] Mapping code ${code} with desc "${desc}"`);
    switch (code) {
        case 9021:
            return 'COMPLETED';
        case 9025:
        case 9026:
            return 'FAILED';
        case 9015:
            return 'IN_DELIVERY';
        case 9005:
            return 'PICKING_UP';
        case 9010:
        case 9011:
        case 9017:
        case 8012:
            return 'IN_DELIVERY';
        default:
            const lowerDesc = desc.toLowerCase();
            if (lowerDesc.includes('đã giao hàng') || lowerDesc.includes('giao thành công'))
                return 'COMPLETED';
            if (lowerDesc.includes('thất bại') || lowerDesc.includes('không giao được') || lowerDesc.includes('hủy'))
                return 'FAILED';
            if (lowerDesc.includes('đang giao'))
                return 'IN_DELIVERY';
            if (lowerDesc.includes('đang lấy hàng') || lowerDesc.includes('lấy hàng'))
                return 'PICKING_UP';
            console.warn(`[MAP STATUS] Không xác định được status cho code=${code}, desc="${desc}", mặc định PENDING`);
            return 'PENDING';
    }
}
// ==================== BỔ SUNG HÀM HELPER CHO SAPO ====================
/**
 * Lấy SAPO credential từ integration-credential theo clientName
 */
async function getSapoCredentialForClient(clientName) {
    console.log(`[SAPO CRED] Fetching credential for client ${clientName}`);
    const cred = await strapi.db.query('api::integration-credential.integration-credential').findOne({
        where: { clientName, isActive: true }
    });
    if (!cred || !cred.sapoApiKey || !cred.sapoShopDomain) {
        throw new Error(`SAPO credential missing for client ${clientName}`);
    }
    console.log(`[SAPO CRED] Found: shop=${cred.sapoShopDomain}`);
    return cred;
}
/**
 * Cập nhật tags trên SAPO order
 */
async function updateSapoOrderTags(sapoOrderId, sapoCred, newTag) {
    const baseUrl = `https://${sapoCred.sapoApiKey}:${sapoCred.sapoApiSecret}@${sapoCred.sapoShopDomain}`;
    // 1. Lấy tags hiện tại
    let currentTags = '';
    try {
        console.log(`[SAPO TAGS] GET current tags for order ${sapoOrderId}`);
        const getUrl = `${baseUrl}/admin/orders/${sapoOrderId}.json`;
        const getResp = await axios_1.default.get(getUrl, { headers: { 'Content-Type': 'application/json' } });
        currentTags = getResp.data.order.tags || '';
        console.log(`[SAPO TAGS] Current tags: "${currentTags}"`);
    }
    catch (err) {
        console.warn(`[SAPO TAGS] Cannot fetch current tags: ${err.message}`);
    }
    // 2. Lọc bỏ các tag cũ bắt đầu bằng 'zeek:' hoặc 'SmartMinds:'
    let tagsArray = currentTags.split(',').map(t => t.trim()).filter(t => t && !t.startsWith('zeek:') && !t.startsWith('SmartMinds:'));
    tagsArray.push(newTag);
    const updatedTags = tagsArray.join(',');
    console.log(`[SAPO TAGS] New tags: "${updatedTags}"`);
    // 3. Cập nhật tags
    const putUrl = `${baseUrl}/admin/orders/${sapoOrderId}.json`;
    const payload = { order: { id: sapoOrderId, tags: updatedTags } };
    console.log(`[SAPO TAGS] PUT request to ${putUrl}`);
    console.log(`[SAPO TAGS] PUT body: ${JSON.stringify(payload, null, 2)}`);
    const putResp = await axios_1.default.put(putUrl, payload, {
        headers: { 'Content-Type': 'application/json' }
    });
    console.log(`[SAPO TAGS] Response status: ${putResp.status}`);
    console.log(`[SAPO TAGS] Response data: ${JSON.stringify(putResp.data, null, 2)}`);
    return putResp.data;
}
// ==================== KẾT THÚC PHẦN THÊM ====================
// ==================== WEBHOOK CŨ (GIỮ NGUYÊN) ====================
exports.default = {
    async receive(ctx) {
        var _a, _b, _c;
        console.log('\n========== WEBHOOK RECEIVED ==========');
        try {
            await loadCredentials();
            const rawPayload = ctx.request.body;
            console.log('[WEBHOOK] Raw payload:', JSON.stringify(rawPayload, null, 2));
            const zeekData = rawPayload.data;
            if (!zeekData) {
                console.error('[WEBHOOK] ❌ Missing data field in webhook');
                ctx.status = 400;
                ctx.body = { error: 'Invalid webhook structure: missing data' };
                return;
            }
            const merchantOrderID = zeekData.client_order_id || zeekData.order_id;
            if (!merchantOrderID) {
                console.error('[WEBHOOK] ❌ Thiếu client_order_id/order_id');
                ctx.status = 400;
                ctx.body = { error: 'Missing merchantOrderID' };
                return;
            }
            console.log(`[WEBHOOK] merchantOrderID: ${merchantOrderID}`);
            const orderStatusCode = zeekData.order_status;
            const statusDesc = zeekData.status_desc || '';
            console.log(`[WEBHOOK] order_status = ${orderStatusCode}, status_desc = "${statusDesc}"`);
            const statusEnum = mapZeekStatusToEnum(orderStatusCode, statusDesc);
            console.log(`[WEBHOOK] Mapped status enum: ${statusEnum}`);
            const deliveryID = zeekData.order_id || ((_b = (_a = zeekData.tasks) === null || _a === void 0 ? void 0 : _a[0]) === null || _b === void 0 ? void 0 : _b.id) || null;
            const trackURL = null;
            const driver = zeekData.partner ? {
                name: zeekData.partner.partner_name,
                phone: zeekData.partner.partner_phone
            } : null;
            const recipient = null;
            console.log(`[WEBHOOK] deliveryID = ${deliveryID}, driver = ${JSON.stringify(driver)}`);
            await addOrderLog(merchantOrderID, 'WEBHOOK_RECEIVED', `Received order_status=${orderStatusCode}, desc=${statusDesc}, mapped=${statusEnum}`);
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
            const statusMapping = {
                'COMPLETED': 'Đã giao hàng',
                'FAILED': 'Chưa giao hàng',
                'IN_DELIVERY': 'Đang giao hàng',
                'PICKING_UP': 'Đang giao hàng',
            };
            const deliveryStatus = statusMapping[statusEnum] || 'Chưa giao hàng';
            console.log(`[WEBHOOK] delivery_status sẽ cập nhật: ${deliveryStatus} (từ enum ${statusEnum})`);
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
                zeek_driver_name: driver === null || driver === void 0 ? void 0 : driver.name,
                zeek_driver_phone: driver === null || driver === void 0 ? void 0 : driver.phone,
                zeek_recipient_name: recipient === null || recipient === void 0 ? void 0 : recipient.name,
                zeek_recipient_address: recipient === null || recipient === void 0 ? void 0 : recipient.address
            };
            if (updatedPayload.sale_order_product_mappings) {
                updatedPayload.sale_order_product_mappings = updatedPayload.sale_order_product_mappings.map(item => {
                    const { stock_name, ...rest } = item;
                    return rest;
                });
            }
            console.log('[WEBHOOK] Đã tạo updatedPayload (giữ nguyên mọi trường, chỉ cập nhật delivery_status và thêm zeek fields)');
            let token;
            try {
                token = await getMisaToken();
            }
            catch (err) {
                console.error(`[WEBHOOK] ❌ Lỗi lấy token: ${err.message}`);
                await addOrderLog(merchantOrderID, 'WEBHOOK_ERROR', `Token error: ${err.message}`, true);
                ctx.status = 500;
                ctx.body = { error: 'Token error', details: err.message };
                return;
            }
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
                response = await axios_1.default.put(putUrl, [updatedPayload], {
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`,
                        'Clientid': MISA_APP_ID
                    }
                });
                console.log(`[MISA PUT] ✅ Response status: ${response.status}`);
                console.log(`[MISA PUT] Response data: ${JSON.stringify(response.data)}`);
            }
            catch (err) {
                console.error(`[MISA PUT] ❌ Axios error: ${err.message}`);
                if (err.response) {
                    console.error(`[MISA PUT] Response status: ${err.response.status}`);
                    console.error(`[MISA PUT] Response data: ${JSON.stringify(err.response.data)}`);
                }
                else if (err.request) {
                    console.error(`[MISA PUT] No response received: ${err.request}`);
                }
                else {
                    console.error(`[MISA PUT] Request setup error: ${err.message}`);
                }
                await addOrderLog(merchantOrderID, 'WEBHOOK_ERROR', `MISA PUT failed: ${err.message}`, true);
                ctx.status = 500;
                ctx.body = { error: 'MISA update failed', details: err.message };
                return;
            }
            let success = false;
            let errorMsg = '';
            if (response.data && typeof response.data === 'object') {
                if (response.data.success === true) {
                    success = true;
                }
                else if (response.data.success === false) {
                    success = false;
                    errorMsg = response.data.user_msg || response.data.dev_msg || 'Unknown error';
                    if (response.data.results && ((_c = response.data.results[0]) === null || _c === void 0 ? void 0 : _c.validate_infos)) {
                        const errors = response.data.results[0].validate_infos
                            .map((e) => `${e.field_name}: ${e.error_message}`)
                            .join(', ');
                        errorMsg = `${errorMsg} (${errors})`;
                    }
                }
                else {
                    errorMsg = 'Unexpected response structure from MISA';
                }
            }
            else {
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
            console.log('[WEBHOOK] Cập nhật local database...');
            let newOrderStatus = order.orderStatus;
            if (statusEnum === 'COMPLETED')
                newOrderStatus = 'completed';
            else if (statusEnum === 'FAILED')
                newOrderStatus = 'failed';
            else if (statusEnum === 'IN_DELIVERY' || statusEnum === 'PICKING_UP')
                newOrderStatus = 'processing';
            await strapi.db.query('api::order.order').update({
                where: { id: order.id },
                data: {
                    payload: updatedPayload,
                    orderStatus: newOrderStatus,
                    zeekStatus: statusEnum,
                    deliveredAt: statusEnum === 'COMPLETED' ? new Date() : null,
                    processingLog: [
                        ...(order.processingLog || []),
                        {
                            timestamp: new Date().toISOString(),
                            step: 'WEBHOOK',
                            message: `Order updated to delivery_status = ${deliveryStatus} (SmartMinds status: ${statusEnum})`,
                            isError: false
                        }
                    ]
                }
            });
            console.log('[WEBHOOK] ✅ Đã cập nhật local database');
            await addOrderLog(merchantOrderID, 'WEBHOOK_SUCCESS', `Successfully updated MISA: ${deliveryStatus}`);
            console.log('[WEBHOOK] Ghi log vào integration-log...');
            await strapi.db.query('api::integration-log.integration-log').create({
                data: {
                    direction: 'incoming',
                    endpoint: '/smartminds/webhook',
                    requestBody: rawPayload,
                    responseBody: { success: true, misaResponse: response.data },
                    logStatus: 'success'
                }
            });
            console.log('[WEBHOOK] ✅ Đã ghi integration-log');
            ctx.status = 200;
            ctx.body = { error: 0, err_msg: '' };
            console.log('========== WEBHOOK PROCESSED SUCCESSFULLY ==========\n');
        }
        catch (error) {
            console.error('[WEBHOOK] ❌ Lỗi không xác định:', error);
            ctx.status = 500;
            ctx.body = { error: 1, err_msg: error.message };
        }
    },
    // ==================== WEBHOOK MỚI THEO CLIENT ====================
    async receiveByClient(ctx) {
        var _a, _b, _c, _d;
        const { clientName } = ctx.params;
        console.log(`\n========== WEBHOOK RECEIVED FOR CLIENT: ${clientName} ==========`);
        try {
            // 1. Lấy credential theo clientName
            let credential;
            try {
                credential = await getCredentialByClientName(clientName);
            }
            catch (err) {
                console.error(`[WEBHOOK] ❌ ${err.message}`);
                ctx.status = 404;
                ctx.body = { error: `Client '${clientName}' not configured` };
                return;
            }
            // 2. Lấy payload từ Zeek
            const rawPayload = ctx.request.body;
            console.log('[WEBHOOK] Raw payload:', JSON.stringify(rawPayload, null, 2));
            const zeekData = rawPayload.data;
            if (!zeekData) {
                console.error('[WEBHOOK] ❌ Missing data field in webhook');
                ctx.status = 400;
                ctx.body = { error: 'Invalid webhook structure: missing data' };
                return;
            }
            // 3. merchantOrderID
            const merchantOrderID = zeekData.client_order_id || zeekData.order_id;
            const fallbackMerchantOrderID = zeekData.merchant_order_id || null;
            if (!merchantOrderID && !fallbackMerchantOrderID) {
                console.error('[WEBHOOK] ❌ Thiếu client_order_id/order_id/merchant_order_id');
                ctx.status = 400;
                ctx.body = { error: 'Missing merchantOrderID' };
                return;
            }
            console.log(`[WEBHOOK] merchantOrderID: ${merchantOrderID || 'none'}, merchant_order_id: ${fallbackMerchantOrderID}`);
            // 4. order_status
            const orderStatusCode = zeekData.order_status;
            const statusDesc = zeekData.status_desc || '';
            console.log(`[WEBHOOK] order_status = ${orderStatusCode}, status_desc = "${statusDesc}"`);
            // 5. Map status
            const statusEnum = mapZeekStatusToEnum(orderStatusCode, statusDesc);
            console.log(`[WEBHOOK] Mapped status enum: ${statusEnum}`);
            // 6. deliveryID, driver,...
            const deliveryID = zeekData.order_id || ((_b = (_a = zeekData.tasks) === null || _a === void 0 ? void 0 : _a[0]) === null || _b === void 0 ? void 0 : _b.id) || null;
            const trackURL = null;
            const driver = zeekData.partner ? {
                name: zeekData.partner.partner_name,
                phone: zeekData.partner.partner_phone
            } : null;
            const recipient = null;
            console.log(`[WEBHOOK] deliveryID = ${deliveryID}, driver = ${JSON.stringify(driver)}`);
            // 7. Ghi log nhận webhook (search log sẽ được thực hiện sau khi tìm được order)
            // 8. Tìm order theo orderId + clientName
            console.log(`[WEBHOOK] Tìm order với orderId = ${merchantOrderID}, clientName = ${clientName}...`);
            // 🔄 THÊM PHẦN TÌM TRONG SAPO-ORDER TRƯỚC
            let order = null;
            let platform = null;
            // Thử tìm trong sapo-order collection trước (dành cho đơn hàng SAPO)
            try {
                if (merchantOrderID) {
                    order = await strapi.db.query('api::sapo-order.sapo-order').findOne({
                        where: { orderId: merchantOrderID, clientName: clientName }
                    });
                }
                if (!order && fallbackMerchantOrderID) {
                    order = await strapi.db.query('api::sapo-order.sapo-order').findOne({
                        where: { merchantOrderId: fallbackMerchantOrderID, clientName: clientName }
                    });
                }
                if (order) {
                    platform = 'sapo';
                    console.log(`[WEBHOOK] ✅ Tìm thấy order trong sapo-order (id=${order.id})`);
                    // Gắn thêm trường platform tạm thời cho đối tượng order để xử lý sau
                    order.platform = 'sapo';
                }
            }
            catch (err) {
                console.warn(`[WEBHOOK] Không thể truy cập sapo-order: ${err.message}`);
            }
            // Nếu không tìm thấy trong sapo-order, tìm trong order collection (MISA)
            if (!order) {
                order = await strapi.db.query('api::order.order').findOne({
                    where: { orderId: merchantOrderID, clientName: clientName }
                });
                if (order) {
                    platform = order.platform || 'misa';
                    console.log(`[WEBHOOK] ✅ Tìm thấy order trong order collection (id=${order.id}, platform=${platform})`);
                }
            }
            if (!order) {
                console.error(`[WEBHOOK] ❌ Không tìm thấy order ${merchantOrderID} cho client ${clientName}`);
                // Trả về 200 để Zeek không retry (có thể order chưa sync kịp)
                ctx.status = 200;
                ctx.body = { error: 0, err_msg: 'Order not found' };
                return;
            }
            console.log(`[WEBHOOK] Order hiện tại: id=${order.id}, orderStatus=${order.orderStatus}`);
            // Xác định platform (nếu chưa có)
            if (!platform) {
                platform = order.platform || (((_c = order.payload) === null || _c === void 0 ? void 0 : _c.id) ? 'sapo' : 'misa');
            }
            console.log(`[WEBHOOK] Detected platform: ${platform}`);
            // Ghi log nhận webhook (sau khi đã có orderId)
            await addOrderLog(merchantOrderID, 'WEBHOOK_RECEIVED', `Client ${clientName}: status=${orderStatusCode}, mapped=${statusEnum}`);
            // ==================== XỬ LÝ RIÊNG CHO SAPO (cập nhật tags) ====================
            if (platform === 'sapo') {
                console.log(`[SAPO] Processing Zeek callback for SAPO order ${order.orderId}`);
                // Map Zeek status -> tag tiếng Việt
                const tagMap = {
                    'PICKING_UP': 'SmartMinds:đã_lấy_hàng',
                    'IN_DELIVERY': 'SmartMinds:đang_giao',
                    'COMPLETED': 'SmartMinds:đã_giao',
                    'FAILED': 'SmartMinds:giao_thất_bại'
                };
                const newTag = tagMap[statusEnum] || 'SmartMinds:chờ_giao';
                console.log(`[SAPO] Zeek status ${statusEnum} -> tag: ${newTag}`);
                try {
                    // Lấy SAPO credential
                    const sapoCred = await getSapoCredentialForClient(clientName);
                    const sapoOrderId = order.payload.id;
                    if (!sapoOrderId) {
                        throw new Error('SAPO order id not found in payload');
                    }
                    console.log(`[SAPO] Updating tags for SAPO order ${sapoOrderId}`);
                    // Cập nhật tags trên SAPO
                    await updateSapoOrderTags(sapoOrderId, sapoCred, newTag);
                    // Cập nhật local database (nếu order lấy từ sapo-order)
                    if (order.platform === 'sapo') {
                        // Đã là bản ghi sapo-order, cập nhật trực tiếp
                        let newStatus = order.orderStatus;
                        if (statusEnum === 'COMPLETED')
                            newStatus = 'completed';
                        else if (statusEnum === 'FAILED')
                            newStatus = 'failed';
                        else if (statusEnum === 'IN_DELIVERY' || statusEnum === 'PICKING_UP')
                            newStatus = 'processing';
                        await strapi.db.query('api::sapo-order.sapo-order').update({
                            where: { id: order.id },
                            data: {
                                orderStatus: newStatus,
                                zeekStatus: statusEnum,
                                processingLog: {
                                    push: {
                                        timestamp: new Date().toISOString(),
                                        step: 'zeek_callback',
                                        message: `Zeek status ${statusEnum} -> tag ${newTag}`
                                    }
                                }
                            }
                        });
                        console.log(`[SAPO] Local sapo-order updated (id=${order.id})`);
                    }
                    else {
                        // Thử tìm lại trong sapo-order nếu order lấy từ order collection (trường hợp hiếm)
                        const sapoLocalOrder = await strapi.db.query('api::sapo-order.sapo-order').findOne({
                            where: { orderId: order.orderId, clientName }
                        });
                        if (sapoLocalOrder) {
                            let newStatus = order.orderStatus;
                            if (statusEnum === 'COMPLETED')
                                newStatus = 'completed';
                            else if (statusEnum === 'FAILED')
                                newStatus = 'failed';
                            else if (statusEnum === 'IN_DELIVERY' || statusEnum === 'PICKING_UP')
                                newStatus = 'processing';
                            await strapi.db.query('api::sapo-order.sapo-order').update({
                                where: { id: sapoLocalOrder.id },
                                data: {
                                    orderStatus: newStatus,
                                    zeekStatus: statusEnum,
                                    processingLog: {
                                        push: {
                                            timestamp: new Date().toISOString(),
                                            step: 'zeek_callback',
                                            message: `Zeek status ${statusEnum} -> tag ${newTag}`
                                        }
                                    }
                                }
                            });
                            console.log(`[SAPO] Local sapo-order updated (id=${sapoLocalOrder.id})`);
                        }
                        else {
                            console.warn(`[SAPO] No sapo-order record found for orderId ${order.orderId}`);
                        }
                    }
                    // Ghi integration log
                    await strapi.db.query('api::integration-log.integration-log').create({
                        data: {
                            direction: 'incoming',
                            endpoint: `/smartminds/webhook/${clientName}`,
                            requestBody: rawPayload,
                            responseBody: { ok: true, tag: newTag },
                            logStatus: 'success'
                        }
                    });
                    ctx.status = 200;
                    ctx.body = { error: 0, err_msg: '', updated_tag: newTag };
                    console.log(`========== WEBHOOK FOR SAPO CLIENT ${clientName} PROCESSED ==========`);
                    return; // Kết thúc, không chạy phần MISA
                }
                catch (sapoErr) {
                    console.error(`[SAPO] Error updating SAPO: ${sapoErr.message}`);
                    ctx.status = 500;
                    ctx.body = { error: 1, err_msg: sapoErr.message };
                    return;
                }
            }
            // ==================== XỬ LÝ CHO MISA (GIỮ NGUYÊN) ====================
            const statusMapping = {
                'COMPLETED': 'Đã giao hàng',
                'FAILED': 'Chưa giao hàng',
                'IN_DELIVERY': 'Đang giao hàng',
                'PICKING_UP': 'Đang giao hàng',
            };
            const deliveryStatus = statusMapping[statusEnum] || 'Chưa giao hàng';
            console.log(`[WEBHOOK] delivery_status sẽ cập nhật: ${deliveryStatus} (từ enum ${statusEnum})`);
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
                zeek_driver_name: driver === null || driver === void 0 ? void 0 : driver.name,
                zeek_driver_phone: driver === null || driver === void 0 ? void 0 : driver.phone,
                zeek_recipient_name: recipient === null || recipient === void 0 ? void 0 : recipient.name,
                zeek_recipient_address: recipient === null || recipient === void 0 ? void 0 : recipient.address
            };
            if (updatedPayload.sale_order_product_mappings) {
                updatedPayload.sale_order_product_mappings = updatedPayload.sale_order_product_mappings.map(item => {
                    const { stock_name, ...rest } = item;
                    return rest;
                });
            }
            console.log('[WEBHOOK] Đã tạo updatedPayload (giữ nguyên mọi trường, chỉ cập nhật delivery_status và thêm zeek fields)');
            let token;
            try {
                token = await getMisaTokenByCredential(credential);
            }
            catch (err) {
                console.error(`[WEBHOOK] ❌ Lỗi lấy token: ${err.message}`);
                await addOrderLog(merchantOrderID, 'WEBHOOK_ERROR', `Token error: ${err.message}`, true);
                ctx.status = 500;
                ctx.body = { error: 'Token error', details: err.message };
                return;
            }
            let misaBaseUrl = credential.misaApiUrl;
            if (misaBaseUrl.includes('/api/v2/Account')) {
                misaBaseUrl = misaBaseUrl.replace('/api/v2/Account', '');
            }
            const misaAppId = credential.misaAppID;
            const putUrl = `${misaBaseUrl}/api/v2/SaleOrders`;
            let response;
            try {
                console.log('[MISA PUT] ===== GỬI REQUEST PUT =====');
                console.log(`[MISA PUT] URL: ${putUrl}`);
                console.log(`[MISA PUT] Headers:`, {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token.substring(0, 20)}...`,
                    'Clientid': misaAppId
                });
                console.log(`[MISA PUT] Body (full): ${JSON.stringify([updatedPayload], null, 2)}`);
                response = await axios_1.default.put(putUrl, [updatedPayload], {
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`,
                        'Clientid': misaAppId
                    }
                });
                console.log(`[MISA PUT] ✅ Response status: ${response.status}`);
                console.log(`[MISA PUT] Response data: ${JSON.stringify(response.data)}`);
            }
            catch (err) {
                console.error(`[MISA PUT] ❌ Axios error: ${err.message}`);
                if (err.response) {
                    console.error(`[MISA PUT] Response status: ${err.response.status}`);
                    console.error(`[MISA PUT] Response data: ${JSON.stringify(err.response.data)}`);
                }
                else if (err.request) {
                    console.error(`[MISA PUT] No response received: ${err.request}`);
                }
                else {
                    console.error(`[MISA PUT] Request setup error: ${err.message}`);
                }
                await addOrderLog(merchantOrderID, 'WEBHOOK_ERROR', `MISA PUT failed: ${err.message}`, true);
                ctx.status = 500;
                ctx.body = { error: 'MISA update failed', details: err.message };
                return;
            }
            let success = false;
            let errorMsg = '';
            if (response.data && typeof response.data === 'object') {
                if (response.data.success === true) {
                    success = true;
                }
                else if (response.data.success === false) {
                    success = false;
                    errorMsg = response.data.user_msg || response.data.dev_msg || 'Unknown error';
                    if (response.data.results && ((_d = response.data.results[0]) === null || _d === void 0 ? void 0 : _d.validate_infos)) {
                        const errors = response.data.results[0].validate_infos
                            .map((e) => `${e.field_name}: ${e.error_message}`)
                            .join(', ');
                        errorMsg = `${errorMsg} (${errors})`;
                    }
                }
                else {
                    errorMsg = 'Unexpected response structure from MISA';
                }
            }
            else {
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
            console.log('[WEBHOOK] Cập nhật local database...');
            let newOrderStatus = order.orderStatus;
            if (statusEnum === 'COMPLETED')
                newOrderStatus = 'completed';
            else if (statusEnum === 'FAILED')
                newOrderStatus = 'failed';
            else if (statusEnum === 'IN_DELIVERY' || statusEnum === 'PICKING_UP')
                newOrderStatus = 'processing';
            await strapi.db.query('api::order.order').update({
                where: { id: order.id },
                data: {
                    payload: updatedPayload,
                    orderStatus: newOrderStatus,
                    zeekStatus: statusEnum,
                    deliveredAt: statusEnum === 'COMPLETED' ? new Date() : null,
                    processingLog: [
                        ...(order.processingLog || []),
                        {
                            timestamp: new Date().toISOString(),
                            step: 'WEBHOOK',
                            message: `Order updated to delivery_status = ${deliveryStatus} (SmartMinds status: ${statusEnum})`,
                            isError: false
                        }
                    ]
                }
            });
            console.log('[WEBHOOK] ✅ Đã cập nhật local database');
            await addOrderLog(merchantOrderID, 'WEBHOOK_SUCCESS', `Successfully updated MISA: ${deliveryStatus}`);
            console.log('[WEBHOOK] Ghi log vào integration-log...');
            await strapi.db.query('api::integration-log.integration-log').create({
                data: {
                    direction: 'incoming',
                    endpoint: `/smartminds/webhook/${clientName}`,
                    requestBody: rawPayload,
                    responseBody: { success: true, misaResponse: response.data },
                    logStatus: 'success'
                }
            });
            console.log('[WEBHOOK] ✅ Đã ghi integration-log');
            ctx.status = 200;
            ctx.body = { error: 0, err_msg: '' };
            console.log(`========== WEBHOOK FOR CLIENT ${clientName} PROCESSED SUCCESSFULLY ==========\n`);
        }
        catch (error) {
            console.error(`[WEBHOOK] ❌ Lỗi không xác định cho client ${clientName}:`, error);
            ctx.status = 500;
            ctx.body = { error: 1, err_msg: error.message };
        }
    },
    // Test SAPO API endpoint
    async testSapo(ctx) {
        console.log('\n========== TEST SAPO API ==========');
        try {
            const { testSapo } = await Promise.resolve().then(() => __importStar(require('../../../scripts/test-sapo')));
            await testSapo();
            ctx.status = 200;
            ctx.body = { success: true, message: 'SAPO test completed - check logs' };
        }
        catch (error) {
            console.error('[TEST SAPO] ❌ Error:', error);
            ctx.status = 500;
            ctx.body = { success: false, error: error.message };
        }
    },
    // Update SAPO credentials for TestSa
    async updateSapoCredentials(ctx) {
        console.log('\n========== UPDATE SAPO CREDENTIALS ==========');
        try {
            const updated = await strapi.db.query('api::integration-credential.integration-credential').update({
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
            ctx.status = 200;
            ctx.body = { success: true, message: 'Credentials updated', data: updated };
        }
        catch (error) {
            console.error('[UPDATE CREDENTIALS] ❌ Error:', error);
            ctx.status = 500;
            ctx.body = { success: false, error: error.message };
        }
    }
};
