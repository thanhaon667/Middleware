import type { StrapiApp } from '@strapi/strapi/admin';

export default {
  config: {
    locales: []
  },

  bootstrap(app: StrapiApp) {
    app.addMenuLink({
      to: '/google-sheet-tools',
      icon: () => null,
      intlLabel: {
        id: 'google-sheet-tools.menu.label',
        defaultMessage: 'Google Sheet Tools'
      },
      Component: async () => {
        const component = await import('./pages/GoogleSheetToolsPage');
        return component.default;
      },
      permissions: []
    });
  }
};
