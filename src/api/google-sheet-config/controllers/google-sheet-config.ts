export default {
  async getAuthUrl(ctx: any) {
    try {
      const clientName = ctx.params.clientName as string;
      const sheetUrl = (ctx.query.sheetUrl || ctx.request.body?.sheetUrl) as string;
      const sheetTab = (ctx.query.sheetTab || ctx.request.body?.sheetTab || 'Orders') as string;

      const service: any = strapi.service('api::google-sheet-config.google-sheet-config');
      const authUrl = await service.createAuthUrl(clientName, sheetUrl, sheetTab);
      ctx.body = { ok: true, authUrl };
    } catch (error: any) {
      ctx.status = 400;
      ctx.body = { ok: false, error: error.message };
    }
  },

  async oauthCallback(ctx: any) {
    try {
      const code = ctx.query.code as string;
      const state = ctx.query.state as string;
      const service: any = strapi.service('api::google-sheet-config.google-sheet-config');
      const config = await service.handleOAuthCallback(code, state);

      ctx.type = 'text/html';
      ctx.body = `<html><body><h2>Google Sheet connected for ${config.clientName}</h2><p>You can close this tab and return to CMS.</p></body></html>`;
    } catch (error: any) {
      ctx.status = 400;
      ctx.type = 'text/html';
      ctx.body = `<html><body><h2>Google OAuth failed</h2><pre>${error.message}</pre></body></html>`;
    }
  },

  async syncClient(ctx: any) {
    try {
      const clientName = ctx.params.clientName as string;
      const service: any = strapi.service('api::google-sheet-config.google-sheet-config');
      const result = await service.syncClientOrders(clientName);
      ctx.body = { ok: true, ...result };
    } catch (error: any) {
      ctx.status = 400;
      ctx.body = { ok: false, error: error.message };
    }
  },

  async syncAll(ctx: any) {
    try {
      const service: any = strapi.service('api::google-sheet-config.google-sheet-config');
      const results = await service.syncAllActiveClients();
      ctx.body = { ok: true, results };
    } catch (error: any) {
      ctx.status = 500;
      ctx.body = { ok: false, error: error.message };
    }
  }
};
