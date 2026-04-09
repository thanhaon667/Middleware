import axios from 'axios';

export default {
  async getToken(connectionId: number) {
    const connection = await strapi.db.query('api::platform-connection.platform-connection').findOne({
      where: { id: connectionId }
    });
    if (!connection) throw new Error('Platform connection not found');

    if (connection.accessToken && connection.tokenExpiresAt && new Date(connection.tokenExpiresAt) > new Date()) {
      return connection.accessToken;
    }

    const { client_id, client_secret } = connection.config || {};
    if (!client_id || !client_secret) {
      throw new Error(`Missing client_id/client_secret for connection ${connection.id}`);
    }

    const response = await axios.post('https://crmconnect.misa.vn/api/v2/Account', {
      client_id,
      client_secret
    }, {
      headers: { 'Content-Type': 'application/json' }
    });

    if (response.data && response.data.success && response.data.code === 0) {
      const token = response.data.data;
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + 24);
      await strapi.db.query('api::platform-connection.platform-connection').update({
        where: { id: connection.id },
        data: {
          accessToken: token,
          tokenExpiresAt: expiresAt
        }
      });
      return token;
    } else {
      throw new Error(`Failed to get token: ${response.data?.user_msg || 'Unknown error'}`);
    }
  }
};