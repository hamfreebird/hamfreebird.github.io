// 前端配置：本地开发走同源后端；线上站点连接已发布的 Node 服务。
const isLocal = ['localhost', '127.0.0.1'].includes(location.hostname);

window.FREEBIRD_CONFIG = {
  API_BASE: isLocal ? '' : 'https://freebird-blog-backend.app.workbuddy.host',
  API_SHARECODE: isLocal ? '' : 'APC5TNO3YU',
  SITE_NAME: 'freebird的自留地',
  EMAIL: 'freebirdflyinthesky@outlook.com',
  REPO: 'https://github.com/hamfreebird/hamfreebird.github.io',
  PAGES: 'https://hamfreebird.github.io'
};
