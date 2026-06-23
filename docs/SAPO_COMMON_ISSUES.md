# SAPO Common Issues

File này ghi lại các lỗi hay gặp của luồng SAPO để xử lý nhanh khi phát sinh lại.

## 1. CMS `Sapo Order` hiện `0 entries found` nhưng DB có dữ liệu

### Triệu chứng
- Trong Strapi CMS, collection `Sapo Order` hiển thị `0 entries found`
- Nhưng bảng `sapo_orders` trong database vẫn có dữ liệu
- Debug route `/api/sapo/debug-orders/:clientName` vẫn trả ra order
- `strapi.documents('api::sapo-order.sapo-order').findMany()` vẫn thấy record

### Nguyên nhân
- Content type `sapo-order` để `draftAndPublish: true`
- Đây là dữ liệu hệ thống được sync tự động, không cần workflow draft/publish như content biên tập
- Content Manager của Strapi 5 có thể list sai/ra rỗng với kiểu dữ liệu này

### Cách sửa
Tắt Draft & Publish cho `sapo-order`:

- [src/api/sapo-order/content-types/sapo-order/schema.json](/d:/MSW/middleware/src/api/sapo-order/content-types/sapo-order/schema.json)
- [dist/src/api/sapo-order/content-types/sapo-order/schema.json](/d:/MSW/middleware/dist/src/api/sapo-order/content-types/sapo-order/schema.json)

Giá trị đúng:

```json
"options": {
  "draftAndPublish": false
}
```

### Sau khi sửa
1. Restart Strapi
2. Hard refresh admin CMS (`Ctrl+F5`)
3. Mở lại `Sapo Order`

### Cách kiểm tra nhanh
Kiểm tra DB:

```sql
select id, document_id, published_at, order_id, client_name
from sapo_orders
order by id desc
limit 10;
```

Kiểm tra debug route:

```http
GET /api/sapo/debug-orders/TestSa
```

---

## 2. `test-sapo` chạy xong nhưng CMS không ổn định / dữ liệu không đồng nhất

### Nguyên nhân
- Luồng SAPO trước đây dùng lẫn:
  - `strapi.db.query(...)`
  - `strapi.entityService.create(...)`
- Trong khi Strapi 5 ở project này ổn định hơn khi dùng `strapi.documents(...)`

### Cách sửa
Trong [src/scripts/test-sapo.ts](/d:/MSW/middleware/src/scripts/test-sapo.ts), ưu tiên dùng:

- `strapi.documents('api::sapo-order.sapo-order').findFirst(...)`
- `strapi.documents('api::sapo-order.sapo-order').findMany(...)`
- `strapi.documents('api::sapo-order.sapo-order').create(...)`
- `strapi.documents('api::sapo-order.sapo-order').update(...)`

Không nên tạo record mới bằng `strapi.db.query(...).create(...)` cho `sapo-order`.

---

## 3. Payload địa chỉ SAPO gửi sang Smart Minds bị thiếu phường/quận/thành phố

### Triệu chứng
`user_address` chỉ có `address1`, ví dụ:

```json
"user_address": "9 đinh tiên hoàng"
```

### Cách sửa
Chuẩn hóa địa chỉ bằng cách ghép:

- `address1`
- `address2`
- `ward`
- `district`
- `province` hoặc `city`

Không ghép `country`.

### Format đúng

```json
"user_address": "9 đinh tiên hoàng, Phường Đa Kao, Quận 1, TP Hồ Chí Minh"
```

### Vị trí code
- [src/scripts/test-sapo.ts](/d:/MSW/middleware/src/scripts/test-sapo.ts)
- hàm `normalizeSapoAddress()`

---

## 4. Callback Smart Minds code `8001` làm local status bị giữ sai

### Triệu chứng
- Tag SAPO update đúng
- Nhưng local `orderStatus` bị giữ từ trạng thái cũ như `failed`

### Nguyên nhân
- Case `8001` map về `PENDING`
- Nhưng local status không được reset rõ ràng

### Cách sửa
Trong callback controller Smart Minds:
- nếu `statusEnum === 'PENDING'`
- set local `orderStatus = 'new'`

Commit fix local:

```text
af16c8b fix(sapo): reset pending callback status correctly
```

---

## 5. Cách khoanh vùng nhanh khi SAPO lỗi

Nếu gặp lỗi lại, kiểm tra theo thứ tự:

1. DB có record không?
2. Debug route `/api/sapo/debug-orders/:clientName` có thấy record không?
3. `strapi.documents('api::sapo-order.sapo-order').findMany()` có thấy không?
4. CMS có đang bị cache / chưa refresh không?
5. `schema.json` của `sapo-order` có đang bật `draftAndPublish` lại không?
6. `test-sapo.ts` có ai sửa quay lại `db.query(...).create(...)` không?

---

## 6. File liên quan chính của luồng SAPO

- [src/scripts/test-sapo.ts](/d:/MSW/middleware/src/scripts/test-sapo.ts)
- [src/api/sapo/controllers/sapo.ts](/d:/MSW/middleware/src/api/sapo/controllers/sapo.ts)
- [src/api/Smartminds/controllers/smartminds.ts](/d:/MSW/middleware/src/api/Smartminds/controllers/smartminds.ts)
- [src/api/sapo-order/content-types/sapo-order/schema.json](/d:/MSW/middleware/src/api/sapo-order/content-types/sapo-order/schema.json)
- [config/cron-tasks.ts](/d:/MSW/middleware/config/cron-tasks.ts)

