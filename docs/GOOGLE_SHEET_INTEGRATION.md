# Google Sheet Integration (MISA Orders -> Sheet)

## 1) Env setup
Add these vars to `.env`:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI` (example: `https://your-domain.com/api/google-sheet-config/oauth/callback`)

## 2) Create Google OAuth client
In Google Cloud Console:
1. Enable Google Sheets API.
2. Create OAuth 2.0 Client ID (Web application).
3. Add redirect URI = `GOOGLE_REDIRECT_URI`.

## 3) Configure in CMS
Open Content Manager -> `Google Sheet Config` and create one record per client:
- `clientName`: must match order `clientName` in middleware
- `sheetUrl`: full Google Sheet URL
- `sheetTab`: optional (default `Orders`)
- `isActive`: true

## 4) Connect Google account (grant permission)
Open this URL in browser:

`GET /api/google-sheet-config/auth-url/:clientName?sheetUrl=<ENCODED_SHEET_URL>&sheetTab=Orders`

You will be redirected to Google consent screen (like Make/Zapier).
After granting permission, callback will store access/refresh token in CMS record.

## 5) Sync data
Manual sync:
- `POST /api/google-sheet-config/sync/:clientName`
- `POST /api/google-sheet-config/sync-all`

Auto sync by cron:
- Add setting record: `key = misa_gsheet_cron_enabled`, `value = true`
- Cron runs every 6 minutes.

## 6) Columns written to sheet
A -> K:
1. syncedAt
2. clientName
3. middlewareOrderId
4. orderStatus
5. misaSaleOrderNo
6. misaCreatedDate
7. customerName
8. phone
9. address
10. totalAmount
11. payStatus
