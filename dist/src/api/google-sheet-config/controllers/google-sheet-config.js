"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = {
    async getAuthUrl(ctx) {
        var _a, _b;
        try {
            const clientName = ctx.params.clientName;
            const sheetUrl = (ctx.query.sheetUrl || ((_a = ctx.request.body) === null || _a === void 0 ? void 0 : _a.sheetUrl));
            const sheetTab = (ctx.query.sheetTab || ((_b = ctx.request.body) === null || _b === void 0 ? void 0 : _b.sheetTab) || 'Orders');
            const service = strapi.service('api::google-sheet-config.google-sheet-config');
            const authUrl = await service.createAuthUrl(clientName, sheetUrl, sheetTab);
            ctx.body = { ok: true, authUrl };
        }
        catch (error) {
            ctx.status = 400;
            ctx.body = { ok: false, error: error.message };
        }
    },
    async oauthCallback(ctx) {
        try {
            const code = ctx.query.code;
            const state = ctx.query.state;
            const service = strapi.service('api::google-sheet-config.google-sheet-config');
            const config = await service.handleOAuthCallback(code, state);
            ctx.type = 'text/html';
            ctx.body = `<html><body><h2>Google Sheet connected for ${config.clientName}</h2><p>You can close this tab and return to CMS.</p></body></html>`;
        }
        catch (error) {
            ctx.status = 400;
            ctx.type = 'text/html';
            ctx.body = `<html><body><h2>Google OAuth failed</h2><pre>${error.message}</pre></body></html>`;
        }
    },
    async syncClient(ctx) {
        try {
            const clientName = ctx.params.clientName;
            const service = strapi.service('api::google-sheet-config.google-sheet-config');
            const result = await service.syncClientOrders(clientName);
            ctx.body = { ok: true, ...result };
        }
        catch (error) {
            ctx.status = 400;
            ctx.body = { ok: false, error: error.message };
        }
    },
    async syncAll(ctx) {
        try {
            const service = strapi.service('api::google-sheet-config.google-sheet-config');
            const results = await service.syncAllActiveClients();
            ctx.body = { ok: true, results };
        }
        catch (error) {
            ctx.status = 500;
            ctx.body = { ok: false, error: error.message };
        }
    }
};
