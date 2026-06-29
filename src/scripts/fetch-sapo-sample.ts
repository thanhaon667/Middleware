/**
 * Standalone script để lấy payload mẫu từ SAPO API.
 * Chạy: npx ts-node src/scripts/fetch-sapo-sample.ts
 *
 * Điền credentials vào CREDS bên dưới (chỉ dùng local, không commit).
 */
import axios from 'axios';

const CREDS = {
  sapoApiKey: '2b32bbc425a348e1b8bfa0c4e3e83a15',
  sapoApiSecret: 'e339c0aa8acc49a8acce033b2afca918',
  sapoShopDomain: 'linger.mysapo.net',
};

function buildUrl(path: string) {
  const domain = CREDS.sapoShopDomain.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  return `https://${encodeURIComponent(CREDS.sapoApiKey)}:${encodeURIComponent(CREDS.sapoApiSecret)}@${domain}${path}`;
}

async function main() {
  if (!CREDS.sapoApiKey || !CREDS.sapoApiSecret || !CREDS.sapoShopDomain) {
    console.error('❌ Điền credentials vào CREDS trong file này trước khi chạy.');
    process.exit(1);
  }

  console.log('📡 Fetching 3 orders từ SAPO...\n');

  const response = await axios.get(buildUrl('/admin/orders.json'), {
    params: {
      limit: 3,
      page: 1,
      fields: 'id,name,order_number,created_on,updated_on,total_price,financial_status,fulfillment_status,tags,shipping_address,billing_address,line_items,note',
    },
    timeout: 15000,
  });

  const orders: any[] = response.data?.orders || response.data?.data || [];
  if (!orders.length) {
    console.log('⚠️ Không có order nào trả về.');
    return;
  }

  const sample = orders[0];

  console.log('========== RAW SAPO PAYLOAD (order đầu tiên) ==========');
  console.log(JSON.stringify(sample, null, 2));

  console.log('\n========== KIỂM TRA CÁC TRƯỜNG KEY ==========');
  console.log('order.id              :', sample.id, '→ orderId (lookup key)');
  console.log('order.order_number    :', sample.order_number, '→ merchantOrderId (6 cuối):', String(sample.order_number || sample.id).slice(-6));
  console.log('order.name            :', sample.name, '→ orderName');
  console.log('order.created_on      :', sample.created_on, '→ order_time (unix):', Math.floor(new Date(sample.created_on).getTime() / 1000));
  console.log('order.modified_on     :', sample.modified_on, '→ watermark timestamp (SAPO dùng modified_on)');
  console.log('order.financial_status:', sample.financial_status, '→ cod_type:', sample.financial_status === 'paid' ? 2 : 1, '(2=paid, 1=COD)');
  console.log('order.total_price     :', sample.total_price);
  console.log('order.note            :', sample.note);
  console.log('order.tags            :', sample.tags);

  const addr = sample.shipping_address || sample.billing_address || {};
  console.log('\n--- Shipping Address ---');
  console.log('full_name / name      :', addr.full_name || addr.name);
  console.log('phone                 :', addr.phone || addr.phone_number);
  console.log('address1              :', addr.address1);
  console.log('address2              :', addr.address2);
  console.log('ward                  :', addr.ward);
  console.log('district              :', addr.district);
  console.log('province / city       :', addr.province || addr.city);
  const addressParts = [addr.address1, addr.address2, addr.ward, addr.district, addr.province || addr.city].filter(Boolean);
  console.log('→ user_address        :', addressParts.length ? [...new Set(addressParts)].join(', ') : 'Dia chi mac dinh');

  const lineItems: any[] = sample.line_items || [];
  console.log('\n--- Line Items (' + lineItems.length + ' items) ---');
  let totalKg = 0;
  for (const item of lineItems) {
    const qty = Number(item.quantity || 1);
    const grams = Number(item.grams || 0);
    const weightKg = item.grams ? grams / 1000 : grams > 50 ? grams / 1000 : grams;
    totalKg += weightKg * qty;
    console.log(`  ${item.name} | qty=${qty} | grams=${grams} | weightKg=${weightKg.toFixed(3)}`);
  }
  console.log('→ item_weight (kg)    :', totalKg.toFixed(3));

  console.log('\n========== SMARTMINDS PAYLOAD PREVIEW ==========');
  console.log(JSON.stringify({
    auth: {
      appid: '<ZEEK_APP_ID>',
      timestamp: Math.floor(Date.now() / 1000),
      signature: '<ZEEK_APP_SECRET>',
      secret_key: '<ZEEK_APP_SECRET>',
    },
    data: {
      meta: { language: 'vi', lang: 'vi', region: 'SGN' },
      client_merchant_id: '<CLIENT_MERCHANT_ID>',
      client_order_id: String(sample.name || sample.order_number || sample.id),
      merchant_order_id: String(sample.order_number || sample.id).slice(-6),
      order_time: Math.floor(new Date(sample.created_on).getTime() / 1000),
      is_appoint: 0,
      remark: sample.note || '',
      merchant_remark: '',
      cod_type: sample.financial_status === 'paid' ? 2 : 1,
      receive: {
        user_name: addr.full_name || addr.name || 'Khach hang',
        user_phone: (addr.phone || addr.phone_number || '').replace(/\D+/g, '').replace(/^0+/, '') || '868036856',
        user_phone_country_code: '84',
        user_location: '',
        user_address: addressParts.length ? [...new Set(addressParts)].join(', ') : 'Dia chi mac dinh',
      },
      order_detail: {
        total_price: Number(sample.total_price || 0),
        item_weight: Number(totalKg.toFixed(3)),
      },
    },
  }, null, 2));

  console.log('\n========== TẤT CẢ FIELDS TỪ SAPO ==========');
  console.log('Top-level keys:', Object.keys(sample).join(', '));
}

main().catch((err) => {
  console.error('❌ Error:', err.response?.data || err.message);
  process.exit(1);
});
