"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = {
    async receive(ctx) {
        // Lấy dữ liệu SmartMinds gửi lên
        const payload = ctx.request.body;
        // In ra terminal để kiểm tra
        console.log('📩 Received data from SmartMinds:', payload);
        // TODO: Sau này sẽ thêm logic xử lý, ví dụ: cập nhật đơn hàng
        // await strapi.db.query('api::order.order').update({...});
        // Gửi phản hồi thành công về cho SmartMinds
        ctx.send({
            status: 'ok',
            message: 'Webhook received successfully'
        });
    }
};
