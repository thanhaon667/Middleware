import axios from 'axios';

export default {
  async sendOrder(order: any, connection: any) {
    try {
      const payload = this.mapOrderToSmartMinds(order, connection.config);
      const response = await axios.post(`${connection.apiUrl}/order/takeaway/create`, payload, {
        headers: {
          'Authorization': `Bearer ${connection.apiKey}`,
          'Content-Type': 'application/json'
        }
      });
      if (response.data.error === 0) {
        return { success: true, orderId: response.data.data.order_id };
      } else {
        throw new Error(response.data.err_msg || 'Smart Minds API error');
      }
    } catch (error: any) {
      strapi.log.error(`Failed to send order ${order.orderId} to SM:`, error.message);
      return { success: false, error: error.message };
    }
  },

  mapOrderToSmartMinds(order: any, config: any) {
    const misa = order.payload;
    const clientMerchantId = config.client_merchant_id;
    const clientOrderId = misa.sale_order_no;
    const merchantOrderId = clientOrderId.slice(-4);
    const orderTime = Math.floor(new Date(misa.created_date).getTime() / 1000);
    const codType = misa.pay_status === 'Chưa thanh toán' ? 1 : 2;
    const defaultLocation = config.default_location || '10.787869977764046,106.70002656897043';
    const receive = {
      user_name: misa.shipping_contact_name || misa.account_name || 'Khách hàng',
      user_phone: misa.phone || '0000000000',
      user_phone_country_code: '84',
      user_location: defaultLocation,
      user_address: misa.shipping_address || misa.billing_address || 'Địa chỉ mặc định'
    };
    let itemWeight = 0.5;
    if (misa.sale_order_product_mappings && misa.sale_order_product_mappings.length) {
      itemWeight = misa.sale_order_product_mappings.reduce((sum: number, item: any) => {
        return sum + (item.amount || 1) * (item.weight || 0.2);
      }, 0);
    }
    const orderDetail = {
      total_price: misa.to_currency_summary || 0,
      item_weight: itemWeight
    };
    return {
      auth: {},
      data: {
        meta: {
          lang: 'vi',
          region: config.region || 'SGN'
        },
        client_merchant_id: clientMerchantId,
        client_order_id: clientOrderId,
        merchant_order_id: merchantOrderId,
        order_time: orderTime,
        delivery_type: config.delivery_type || 'pandago',
        is_appoint: 0,
        appoint_time: '',
        remark: misa.description || '',
        merchant_remark: '',
        cod_type: codType,
        receive: receive,
        order_detail: orderDetail,
        requestId: `req_${clientOrderId}_${Date.now()}`
      }
    };
  }
};