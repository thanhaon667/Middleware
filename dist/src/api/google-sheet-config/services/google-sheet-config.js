"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const axios_1 = __importDefault(require("axios"));
const GOOGLE_AUTH_BASE = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';
function getGoogleEnv() {
    const clientId = process.env.GOOGLE_CLIENT_ID || '';
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET || '';
    const redirectUri = process.env.GOOGLE_REDIRECT_URI || `${process.env.PUBLIC_URL || 'http://localhost:1337'}/api/google-sheet-config/oauth/callback`;
    if (!clientId || !clientSecret) {
        throw new Error('Missing GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET');
    }
    return { clientId, clientSecret, redirectUri };
}
function encodeState(payload) {
    return Buffer.from(JSON.stringify(payload)).toString('base64url');
}
function decodeState(state) {
    return JSON.parse(Buffer.from(state, 'base64url').toString('utf8'));
}
function extractSheetId(input) {
    if (!input)
        return '';
    const match = input.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (match === null || match === void 0 ? void 0 : match[1])
        return match[1];
    return input.trim();
}
async function upsertConfig(clientName, data) {
    const existing = await strapi.db.query('api::google-sheet-config.google-sheet-config').findOne({
        where: { clientName }
    });
    if (existing) {
        return strapi.db.query('api::google-sheet-config.google-sheet-config').update({
            where: { id: existing.id },
            data
        });
    }
    return strapi.db.query('api::google-sheet-config.google-sheet-config').create({
        data: {
            clientName,
            ...data
        }
    });
}
async function refreshAccessToken(config) {
    if (!config.googleRefreshToken) {
        throw new Error('No refresh token. Please reconnect Google account.');
    }
    const { clientId, clientSecret, redirectUri } = getGoogleEnv();
    const body = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: config.googleRefreshToken,
        grant_type: 'refresh_token',
        redirect_uri: redirectUri
    });
    const response = await axios_1.default.post(GOOGLE_TOKEN_URL, body.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });
    const accessToken = response.data.access_token;
    const expiresIn = Number(response.data.expires_in || 3600);
    const tokenExpiresAt = new Date(Date.now() + expiresIn * 1000);
    await strapi.db.query('api::google-sheet-config.google-sheet-config').update({
        where: { id: config.id },
        data: {
            googleAccessToken: accessToken,
            tokenExpiresAt
        }
    });
    return accessToken;
}
async function getValidAccessToken(config) {
    if (config.googleAccessToken && config.tokenExpiresAt && new Date(config.tokenExpiresAt).getTime() > Date.now() + 60000) {
        return config.googleAccessToken;
    }
    return refreshAccessToken(config);
}
async function fetchExistingOrderIds(sheetId, tab, accessToken) {
    var _a;
    const idRange = `${tab}!C:C`;
    const response = await axios_1.default.get(`${GOOGLE_SHEETS_BASE}/${sheetId}/values/${encodeURIComponent(idRange)}`, {
        headers: {
            Authorization: `Bearer ${accessToken}`
        }
    });
    const values = ((_a = response.data) === null || _a === void 0 ? void 0 : _a.values) || [];
    const ids = new Set();
    for (const row of values) {
        const v = ((row === null || row === void 0 ? void 0 : row[0]) || '').toString().trim();
        if (v && v !== 'middlewareOrderId') {
            ids.add(v);
        }
    }
    return ids;
}
function mapOrderRow(order) {
    var _a;
    const p = order.payload || {};
    return [
        new Date().toISOString(),
        order.clientName || '',
        order.orderId || '',
        order.orderStatus || '',
        p.sale_order_no || '',
        p.created_date || '',
        p.account_name || '',
        p.phone || '',
        p.shipping_address || p.billing_address || '',
        (_a = p.to_currency_summary) !== null && _a !== void 0 ? _a : '',
        p.pay_status || ''
    ];
}
exports.default = {
    extractSheetId,
    async createAuthUrl(clientName, sheetUrl, sheetTab = 'Orders') {
        if (!clientName)
            throw new Error('clientName is required');
        if (!sheetUrl)
            throw new Error('sheetUrl is required');
        const { clientId, redirectUri } = getGoogleEnv();
        const sheetId = extractSheetId(sheetUrl);
        if (!sheetId)
            throw new Error('Invalid sheetUrl');
        await upsertConfig(clientName, {
            sheetUrl,
            sheetId,
            sheetTab,
            isActive: true
        });
        const state = encodeState({ clientName, sheetId, sheetUrl, sheetTab });
        const params = new URLSearchParams({
            client_id: clientId,
            redirect_uri: redirectUri,
            response_type: 'code',
            access_type: 'offline',
            prompt: 'consent',
            scope: 'https://www.googleapis.com/auth/spreadsheets',
            state
        });
        return `${GOOGLE_AUTH_BASE}?${params.toString()}`;
    },
    async handleOAuthCallback(code, state) {
        if (!code)
            throw new Error('Missing code');
        if (!state)
            throw new Error('Missing state');
        const { clientId, clientSecret, redirectUri } = getGoogleEnv();
        const decoded = decodeState(state);
        const body = new URLSearchParams({
            code,
            client_id: clientId,
            client_secret: clientSecret,
            redirect_uri: redirectUri,
            grant_type: 'authorization_code'
        });
        const response = await axios_1.default.post(GOOGLE_TOKEN_URL, body.toString(), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });
        const accessToken = response.data.access_token;
        const refreshToken = response.data.refresh_token;
        const expiresIn = Number(response.data.expires_in || 3600);
        const tokenExpiresAt = new Date(Date.now() + expiresIn * 1000);
        const updated = await upsertConfig(decoded.clientName, {
            sheetUrl: decoded.sheetUrl,
            sheetId: decoded.sheetId,
            sheetTab: decoded.sheetTab || 'Orders',
            googleAccessToken: accessToken,
            googleRefreshToken: refreshToken,
            tokenExpiresAt,
            isActive: true
        });
        return updated;
    },
    async syncClientOrders(clientName) {
        const config = await strapi.db.query('api::google-sheet-config.google-sheet-config').findOne({
            where: { clientName, isActive: true }
        });
        if (!config) {
            throw new Error(`Google Sheet config not found or inactive for client ${clientName}`);
        }
        const accessToken = await getValidAccessToken(config);
        const since = config.lastSyncedAt ? new Date(config.lastSyncedAt) : new Date(Date.now() - 6 * 60 * 60 * 1000);
        const orders = await strapi.db.query('api::order.order').findMany({
            where: {
                clientName,
                source: 'MISA',
                createdAt: { $gt: since.toISOString() }
            },
            orderBy: { createdAt: 'asc' },
            limit: 500
        });
        if (!orders.length) {
            await strapi.db.query('api::google-sheet-config.google-sheet-config').update({
                where: { id: config.id },
                data: {
                    lastSyncedAt: new Date(),
                    lastSyncStatus: 'success',
                    lastSyncMessage: 'No new MISA orders'
                }
            });
            return { appended: 0, message: 'No new MISA orders' };
        }
        const tab = config.sheetTab || 'Orders';
        const existingIds = await fetchExistingOrderIds(config.sheetId, tab, accessToken);
        const newOrders = orders.filter((o) => !!o.orderId && !existingIds.has(String(o.orderId)));
        if (!newOrders.length) {
            await strapi.db.query('api::google-sheet-config.google-sheet-config').update({
                where: { id: config.id },
                data: {
                    lastSyncedAt: new Date(),
                    lastSyncStatus: 'success',
                    lastSyncMessage: 'No new rows (idempotent check passed)'
                }
            });
            return { appended: 0, message: 'No new rows (idempotent check passed)' };
        }
        const rows = newOrders.map(mapOrderRow);
        const range = `${tab}!A:K`;
        await axios_1.default.post(`${GOOGLE_SHEETS_BASE}/${config.sheetId}/values/${encodeURIComponent(range)}:append`, {
            values: rows,
            majorDimension: 'ROWS'
        }, {
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            params: {
                valueInputOption: 'RAW',
                insertDataOption: 'INSERT_ROWS'
            }
        });
        await strapi.db.query('api::google-sheet-config.google-sheet-config').update({
            where: { id: config.id },
            data: {
                lastSyncedAt: new Date(),
                lastSyncStatus: 'success',
                lastSyncMessage: `Appended ${rows.length} new order(s)`
            }
        });
        return { appended: rows.length };
    },
    async syncAllActiveClients() {
        const configs = await strapi.db.query('api::google-sheet-config.google-sheet-config').findMany({
            where: { isActive: true }
        });
        const results = [];
        for (const config of configs) {
            try {
                const result = await this.syncClientOrders(config.clientName);
                results.push({ clientName: config.clientName, ok: true, ...result });
            }
            catch (error) {
                await strapi.db.query('api::google-sheet-config.google-sheet-config').update({
                    where: { id: config.id },
                    data: {
                        lastSyncStatus: 'failed',
                        lastSyncMessage: error.message
                    }
                });
                results.push({ clientName: config.clientName, ok: false, error: error.message });
            }
        }
        return results;
    }
};
