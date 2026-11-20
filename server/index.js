import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleApi } from './api.js';
import { serveStatic } from './static.js';

export function createApp() {
  return http.createServer(async (req, res) => {
    const host = req.headers.host || 'localhost';
    let url;
    try {
      url = new URL(req.url, `http://${host}`);
    } catch {
      res.writeHead(400); return res.end('Bad Request');
    }
    try {
      const handled = await handleApi(req, res, url);
      if (!handled) serveStatic(req, res, url);
    } catch (error) {
      console.error('[server]', error);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('500 · 服务器开小差了');
      }
    }
  });
}

const invokedDirectly = Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  const port = Number(process.env.PORT) || 8787;
  const host = process.env.HOST || '0.0.0.0';
  const server = createApp();
  server.on('error', (error) => {
    console.error('[server] 启动失败：', error.message);
    process.exit(1);
  });
  server.listen(port, host, () => {
    console.log(`\n  freebird 后端已就绪  →  http://${host}:${port}`);
    console.log(`  管理后台            →  http://localhost:${port}/admin.html`);
    console.log(`  API 健康检查         →  http://localhost:${port}/api/health\n`);
  });
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => server.close(() => process.exit(0)));
  }
}
