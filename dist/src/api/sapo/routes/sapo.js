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
    ],
};
