# Change Log - Google Sheet Integration

Date: 2026-05-14

## 1) New feature added
- Added a full flow to sync MISA orders from middleware to Google Sheets.
- Added Google OAuth authorization flow (similar to Make/Zapier) to grant sheet access.
- Added admin custom page with action buttons so users do not need to call API manually.

## 2) Backend additions

### New content type
- `api::google-sheet-config.google-sheet-config`
- File: `src/api/google-sheet-config/content-types/google-sheet-config/schema.json`
- Stores:
  - `clientName`
  - `sheetUrl`, `sheetId`, `sheetTab`
  - `isActive`
  - `googleAccessToken`, `googleRefreshToken`, `tokenExpiresAt`
  - `lastSyncedAt`, `lastSyncStatus`, `lastSyncMessage`

### New service
- File: `src/api/google-sheet-config/services/google-sheet-config.ts`
- Implemented:
  - Build Google OAuth consent URL
  - OAuth callback token exchange
  - Access token refresh via refresh token
  - Client sync and sync-all
  - Append rows to Google Sheet

### New controller/routes
- Controller: `src/api/google-sheet-config/controllers/google-sheet-config.ts`
- Routes: `src/api/google-sheet-config/routes/google-sheet-config.ts`
- Endpoints:
  - `GET /api/google-sheet-config/auth-url/:clientName`
  - `GET /api/google-sheet-config/oauth/callback`
  - `POST /api/google-sheet-config/sync/:clientName`
  - `POST /api/google-sheet-config/sync-all`

### Cron integration
- File: `config/cron-tasks.ts`
- Added auto-sync job every 6 minutes.
- Controlled by Setting key:
  - `key = misa_gsheet_cron_enabled`
  - `value = true`

### Env requirements
- Updated `.env.example`:
  - `GOOGLE_CLIENT_ID`
  - `GOOGLE_CLIENT_SECRET`
  - `GOOGLE_REDIRECT_URI`

## 3) Idempotency improvement
- Added duplicate prevention when syncing to Sheet.
- Before append, system reads existing order IDs from column C (`middlewareOrderId`).
- Only new `orderId` values are appended.
- Prevents duplicate rows on repeated sync.

## 4) Admin UI additions

### New admin page
- `src/admin/pages/GoogleSheetToolsPage.tsx`
- Added into admin menu via `src/admin/app.tsx`
- Route in admin: `/admin/google-sheet-tools`

### UI capabilities
- Connect Google (OAuth launch)
- Refresh config list
- Sync all now
- Per-client actions:
  - Reconnect Google
  - Sync now
- Display current sync status/message per config

### UX/UI updates
- Reworked layout to be cleaner and easier to scan.
- Added Quick Setup checklist on top of page.
- Improved button grouping/spacing.
- Improved error rendering from backend response.
- Added popup-block fallback for OAuth (redirect current tab if popup blocked).
- Fixed text encoding display issues on page content.

## 5) Earlier stability fixes included in current branch
- Normalized multiple schema/code mismatches (`client`, `sentAt`, `endpoint`, `platformType`, etc.).
- Added basic webhook secret check for SmartMinds callback.
- Locked debug behavior in production for SAPO debug endpoint.

## 6) Notes for next edits
- If OAuth shows `Missing GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET`, configure `.env` and restart server.
- Recommended redirect URI (local):
  - `http://localhost:1337/api/google-sheet-config/oauth/callback`
