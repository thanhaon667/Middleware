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
    // Mỗi 5 phút: chạy polling (gọi trực tiếp poll-misa)
    // Test cron: mỗi 2 phút gọi testMisa (chỉ khi được bật)
    '*/2 * * * *': async () => {
        try {
            // Kiểm tra trạng thái từ bảng Setting
            const setting = await strapi.db.query('api::setting.setting').findOne({
                where: { key: 'misa_test_cron_enabled' }
            });
            if (!setting || setting.value !== true) {
                // Không làm gì nếu chưa bật
                return;
            }
            console.log('>>> TEST CRON for MISA direct (enabled)');
            const { testMisa } = await Promise.resolve().then(() => __importStar(require('../src/scripts/test-misa')));
            await testMisa();
        }
        catch (err) {
            strapi.log.error('Test cron error:', err);
        }
    }
};
