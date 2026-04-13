"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const axios_1 = __importDefault(require("axios"));
exports.default = {
    async getToken(connectionId) {
        var _a;
        const connection = await strapi.db.query('api::platform-connection.platform-connection').findOne({
            where: { id: connectionId }
        });
        if (!connection)
            throw new Error('Platform connection not found');
        if (connection.accessToken && connection.tokenExpiresAt && new Date(connection.tokenExpiresAt) > new Date()) {
            return connection.accessToken;
        }
        const { client_id, client_secret } = connection.config || {};
        if (!client_id || !client_secret) {
            throw new Error(`Missing client_id/client_secret for connection ${connection.id}`);
        }
        const response = await axios_1.default.post('https://crmconnect.misa.vn/api/v2/Account', {
            client_id,
            client_secret
        }, {
            headers: { 'Content-Type': 'application/json' }
        });
        if (response.data && response.data.success && response.data.code === 0) {
            const token = response.data.data;
            const expiresAt = new Date();
            expiresAt.setHours(expiresAt.getHours() + 24);
            await strapi.db.query('api::platform-connection.platform-connection').update({
                where: { id: connection.id },
                data: {
                    accessToken: token,
                    tokenExpiresAt: expiresAt
                }
            });
            return token;
        }
        else {
            throw new Error(`Failed to get token: ${((_a = response.data) === null || _a === void 0 ? void 0 : _a.user_msg) || 'Unknown error'}`);
        }
    }
};
