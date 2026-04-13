"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = {
    routes: [
        {
            method: 'POST',
            path: '/smartminds/webhook',
            handler: 'smartminds.receive',
            config: {
                auth: false,
            },
        },
    ],
};
