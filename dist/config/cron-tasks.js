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
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = {
    // Every 2 minutes: run MISA test sync when enabled.
    '*/2 * * * *': async () => {
        try {
            const setting = await strapi.db.query('api::setting.setting').findOne({
                where: { key: 'misa_test_cron_enabled' }
            });
            if (!setting || setting.value !== true)
                return;
            const { testMisa } = await Promise.resolve().then(() => __importStar(require('../src/scripts/test-misa')));
            await testMisa();
        }
        catch (err) {
            strapi.log.error('Test cron error:', err);
        }
    },
    // Every 5 minutes: run SAPO sync when enabled.
    '*/5 * * * *': async () => {
        try {
            const setting = await strapi.db.query('api::setting.setting').findOne({
                where: { key: 'sapo_test_cron_enabled' }
            });
            if (!setting || setting.value !== true)
                return;
            const { testSapo } = await Promise.resolve().then(() => __importStar(require('../src/scripts/test-sapo')));
            await testSapo();
        }
        catch (err) {
            strapi.log.error('SAPO cron error:', err);
        }
    },
    // Every 6 minutes: sync new MISA orders from middleware to Google Sheets when enabled.
    '*/6 * * * *': async () => {
        try {
            const setting = await strapi.db.query('api::setting.setting').findOne({
                where: { key: 'misa_gsheet_cron_enabled' }
            });
            if (!setting || setting.value !== true)
                return;
            const service = strapi.service('api::google-sheet-config.google-sheet-config');
            await service.syncAllActiveClients();
        }
        catch (err) {
            strapi.log.error('Google Sheet cron error:', err);
        }
    }
};
