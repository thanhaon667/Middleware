// src/utils/order-logger.ts

export async function addOrderLog(orderId: string, step: string, message: string, isError: boolean = false) {
  try {
    // Tìm order theo orderId
    const order = await strapi.db.query('api::order.order').findOne({
      where: { orderId }
    });
    if (!order) {
      console.warn(`[OrderLog] Order ${orderId} not found`);
      return;
    }

    // Lấy log hiện tại (có thể là array hoặc string)
    let logs = order.processingLog;
    if (typeof logs === 'string') {
      try {
        logs = JSON.parse(logs);
      } catch {
        logs = [];
      }
    }
    if (!Array.isArray(logs)) logs = [];

    // Thêm log mới
    logs.push({
      timestamp: new Date().toISOString(),
      step,
      message,
      isError
    });

    // Giới hạn số lượng log (ví dụ 100 bản ghi)
    if (logs.length > 100) logs = logs.slice(-100);

    // Cập nhật lại order
    await strapi.db.query('api::order.order').update({
      where: { id: order.id },
      data: { processingLog: logs }
    });
  } catch (err) {
    console.error('[OrderLog] Failed to write log:', err);
  }
}