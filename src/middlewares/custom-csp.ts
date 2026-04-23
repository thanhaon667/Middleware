export default (config, { strapi }) => {
  return async (ctx, next) => {
    await next();
    // Đặt CSP header sau khi response được tạo
    ctx.set('Content-Security-Policy', `
      default-src 'self';
      script-src 'self' 'unsafe-inline' 'unsafe-eval';
      style-src 'self' 'unsafe-inline';
      img-src 'self' data: blob: https://market-assets.strapi.io;
      font-src 'self' data:;
      connect-src 'self' https://crmconnect.misa.vn https://open-api.as2-dev.zeek.solutions;
      frame-ancestors 'none';
      base-uri 'self';
      form-action 'self';
    `.replace(/\s+/g, ' ').trim());
  };
};