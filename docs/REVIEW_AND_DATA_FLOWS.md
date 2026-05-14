# Middleware Project Review & Rewritten Data Flows

## 1) Code Review Findings

### Critical
1. **Schema-field mismatch (runtime write/read can silently fail)**
   - `order` schema defines `SentAt`, `Client` (capitalized), while code uses `sentAt`, `client`.
   - `platform-connection` schema defines `platformType`, but code queries `platform`.
   - `integration-log` schema defines `Endpoint`, but code writes `endpoint`.
   - Impact: data not persisted in expected fields, queries returning empty results.

2. **Webhook authentication not implemented**
   - `src/controllers/webhook.ts` has TODO for webhook verification.
   - Impact: anyone can call `/webhook/sm` and update order status.

3. **Enum value typo in schema**
   - `integration-log.logStatus` enum contains `"failed,"` (with comma), while code often writes `"failed"`.
   - Impact: validation failures or inconsistent statuses.

### High
4. **Duplicate/parallel integration paths without single source of truth**
   - There are two different flows:
     - services path: `poll-misa` + `queue-service` + `sm-service`
     - scripts path: `test-misa` directly sends to Zeek
   - Impact: hard to reason, conflicting states, duplicated business rules.

5. **Idempotency is weak for MISA sync**
   - `poll-misa.ts` only checks top 200 existing order IDs.
   - Impact: duplicate orders when volume is high or delayed polling.

6. **Potential field mismatch in webhook update query**
   - `webhook.ts` queries by `externalOrderId`, but `order` schema shown does not define this field.
   - Impact: webhook may fail to find orders.

### Medium
7. **Excessive sensitive logging**
   - Multiple files log request/response bodies and credentials-related context.
   - Impact: possible secret leakage in logs.

8. **Route-level debug endpoint exposed without auth**
   - `/sapo/debug-orders/:clientName` has `auth: false`.
   - Impact: data exposure in production.

9. **Encoding/noise and mixed naming style**
   - Some files contain garbled Vietnamese comments and inconsistent field naming style.
   - Impact: maintainability drops, onboarding harder.

## 2) Rewritten Data Flows (Target State)

### Shared Principles
1. Canonical entities:
   - `Client`
   - `PlatformConnection` (`platformType`, `isActive`, `config`, `accessToken`, `tokenExpiresAt`)
   - `Order` (single order ledger)
   - `IntegrationLog`

2. Canonical statuses:
   - `new` -> `queued` -> `sent` -> `completed`
   - `failed` (with retry policy)

3. Idempotency key:
   - `source + clientId + sourceOrderId` (unique index).

4. All inbound/outbound calls must write `IntegrationLog` with:
   - `direction`, `endpoint`, sanitized `requestBody`, `responseBody`, `logStatus`, `errorMessage`.

---

### Flow A: MISA -> Middleware -> SmartMinds/Zeek
1. **Trigger**
   - Cron job executes every N minutes.
2. **Load active source connection**
   - Get `PlatformConnection` where `platformType = MISA`, `isActive = true`.
3. **Token management**
   - Use `token-manager`:
     - if token valid => reuse
     - else refresh and persist.
4. **Fetch orders from MISA**
   - Pull by `modified_date >= lastSyncAt`.
5. **Upsert to Order ledger**
   - For each order: upsert by idempotency key.
   - New orders start at `new`.
6. **Queue enqueue**
   - Move order to `queued`.
7. **Dispatcher sends to SmartMinds/Zeek**
   - Map payload.
   - Call target API.
8. **Post-send update**
   - Success => `sent`, store `externalOrderId`, `sentAt`.
   - Failure => `failed`, increment retry count.
9. **Logging**
   - Write IntegrationLog for fetch, send, and update-status steps.

---

### Flow B: SAPO Webhook -> Middleware -> SmartMinds/Zeek
1. **Webhook receive**
   - Endpoint: `/sapo/webhook/:clientName`.
2. **Verify signature**
   - Validate webhook secret/HMAC before any DB write.
3. **Resolve credential/connection**
   - Load active credential by `clientName`.
4. **Idempotency check**
   - Upsert by `source=sapo + sourceOrderId + client`.
5. **Persist order**
   - Save normalized order + raw payload snapshot.
6. **Map and send to target**
   - Build target payload and call API.
7. **Update source tag/status (optional)**
   - If enabled, update SAPO tag.
8. **Finalize state**
   - Success => `sent`; webhook from target later => `completed`.
   - Failure => `failed`.
9. **Logging**
   - Inbound webhook log + outbound API log.

---

### Flow C: SmartMinds Callback -> Middleware -> MISA Status Update
1. **Webhook receive (`/webhook/sm`)**
   - Verify secret/signature.
2. **Find internal order**
   - Lookup by `externalOrderId`.
3. **Validate active MISA target connection**
   - `platformType = MISA`, `isActive = true`.
4. **Update MISA sale order**
   - Patch status/delivery state.
5. **Update internal order**
   - Set `completed`, append processing log.
6. **Log outcome**
   - Success/failure in `IntegrationLog`.

## 3) Minimal Refactor Plan
1. Unify schema names and service queries (`platformType`, `client`, `sentAt`, `endpoint`).
2. Remove enum typo (`failed,` -> `failed`) and normalize statuses.
3. Add webhook verification for SAPO and SM callbacks.
4. Replace "top 200 dedupe" with true unique idempotency key.
5. Merge script-based runtime flow into service-based flow (one pipeline only).
6. Gate debug endpoints behind auth or environment flag.
