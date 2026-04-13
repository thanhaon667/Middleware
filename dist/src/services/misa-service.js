"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const axios_1 = __importDefault(require("axios"));
exports.default = {
    async fetchOrders(connectionId, page = 0, pageSize = 100) {
        const token = await strapi.service('token-manager').getToken(connectionId);
        const connection = await strapi.db.query('api::platform-connection.platform-connection').findOne({
            where: { id: connectionId }
        });
        const response = await axios_1.default.get(`${connection.apiUrl}/api/v2/SaleOrders`, {
            headers: {
                Authorization: `Bearer ${token}`,
                Clientid: connection.config.client_id
            },
            params: { page, pageSize, orderBy: 'modified_date', isDescending: true }
        });
        let orders = null;
        if (Array.isArray(response.data) && response.data.length > 0) {
            const inner = response.data[0].data;
            if (inner && inner.success && inner.code === 200)
                orders = inner.data;
        }
        else if (response.data && typeof response.data === 'object') {
            if (response.data.success && response.data.code === 200)
                orders = response.data.data;
        }
        if (!orders)
            throw new Error('Failed to parse orders from MISA');
        return orders;
    },
    async updateOrderStatus(connectionId, orderId, fullPayload) {
        const token = await strapi.service('token-manager').getToken(connectionId);
        const connection = await strapi.db.query('api::platform-connection.platform-connection').findOne({
            where: { id: connectionId }
        });
        const payload = [fullPayload];
        const response = await axios_1.default.put(`${connection.apiUrl}/api/v2/SaleOrders`, payload, {
            headers: {
                Authorization: `Bearer ${token}`,
                Clientid: connection.config.client_id,
                'Content-Type': 'application/json'
            }
        });
        let success = false;
        if (Array.isArray(response.data) && response.data.length > 0) {
            const inner = response.data[0].data;
            success = inner && inner.success && inner.code === 200;
        }
        else if (response.data && typeof response.data === 'object') {
            success = response.data.success && response.data.code === 200;
        }
        if (!success)
            throw new Error(`Failed to update order ${orderId} on MISA`);
        return true;
    }
};
