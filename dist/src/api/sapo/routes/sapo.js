"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = {
    routes: [
        {
            method: 'POST',
            path: '/sapo/webhook/:clientName',
            handler: 'sapo.receiveOrder',
            config: { auth: false },
        },
        // Debug route - tạm thời để kiểm tra sapo-order data
        {
            method: 'GET',
            path: '/sapo/debug-orders/:clientName',
            handler: 'sapo.debugOrders',
            config: { auth: true },
        },
    ],
};
