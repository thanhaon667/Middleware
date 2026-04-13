"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = {
    routes: [
        {
            method: 'POST',
            path: '/webhook/sm',
            handler: 'webhook.handleSM',
            config: { auth: false }
        }
    ]
};
