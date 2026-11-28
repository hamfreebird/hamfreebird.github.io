// 构建静态站点时的数据补全：
// 1. 从线上 API 拉取已发布文章，写入 content/posts.json，作为后端不可用时的降级快照；
// 2. 生成静态 rss.xml 与 sitemap.xml，避免订阅器依赖带 sharecode 的接口。
// 只依赖 Node 内置能力，API 不可达时保留仓库中已有的快照。
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.resolve(process.env.OUT_DIR || '_site');
const SITE = (process.env.SITE_URL || 'https://hamfreebird.github.io').replace(/\/$/, '');
const API = (process.env.SITE_API || 'https://freebird-blog-backend.app.workbuddy.host').replace(/\/$/, '');
const SHARE = process.env.API_SHARECODE || 'APC5TNO3YU';

const escapeXml = (value = '') => String(value).replace(/[<>&'"]/g, (c) => ({
  '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;'
})[c]);

const snapshotPath = path.join(OUT, 'content', 'posts.json');
const repoSnapshot = path.resolve('content', 'posts.json');

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

let base = readJson(snapshotPath, null) || readJson(repoSnapshot, { site: {}, posts: [] });
const site = base.site || {};
let posts = Array.isArray(base.posts) ? base.posts : [];
let source = 'snapshot';

try {
  const response = await fetch(`${API}/api/posts?sharecode=${encodeURIComponent(SHARE)}&limit=50`, {
    signal: AbortSignal.timeout(15000)
  });
  if (response.ok) {
    const data = await response.json();
    if (Array.isArray(data.items)) {
      posts = data.items;
      source = 'api';
    }
  }
} catch (error) {
  console.warn(`[build-static] API 不可达，沿用已有快照：${error.message}`);
}

fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
fs.writeFileSync(snapshotPath, `${JSON.stringify({ site, posts }, null, 2)}\n`);

const published = posts
  .filter((post) => post && post.status === 'published')
  .sort((a, b) => String(b.publishedAt || '').localeCompare(String(a.publishedAt || '')));

const items = published.map((post) => {
  const link = `${SITE}/post.html?slug=${encodeURIComponent(post.slug)}`;
  return `    <item>
      <title>${escapeXml(post.title)}</title>
      <link>${escapeXml(link)}</link>
      <guid isPermaLink="true">${escapeXml(link)}</guid>
      <pubDate>${new Date(post.publishedAt || Date.now()).toUTCString()}</pubDate>
      <description>${escapeXml(post.excerpt || '')}</description>
      <category>${escapeXml(post.category || '随笔')}</category>
    </item>`;
}).join('\n');

const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(site.name || 'freebird的自留地')}</title>
    <link>${escapeXml(SITE)}</link>
    <atom:link href="${escapeXml(`${SITE}/rss.xml`)}" rel="self" type="application/rss+xml" />
    <description>${escapeXml(site.description || '')}</description>
    <language>zh-CN</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${items}
  </channel>
</rss>
`;
fs.writeFileSync(path.join(OUT, 'rss.xml'), rss);

const urls = [
  { loc: `${SITE}/`, priority: '1.0' },
  { loc: `${SITE}/archive.html`, priority: '0.8' },
  { loc: `${SITE}/about.html`, priority: '0.6' },
  ...published.map((post) => ({
    loc: `${SITE}/post.html?slug=${encodeURIComponent(post.slug)}`,
    lastmod: String(post.updatedAt || post.publishedAt || '').slice(0, 10) || undefined,
    priority: '0.7'
  }))
];
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((item) => `  <url>
    <loc>${escapeXml(item.loc)}</loc>${item.lastmod ? `\n    <lastmod>${item.lastmod}</lastmod>` : ''}
    <priority>${item.priority}</priority>
  </url>`).join('\n')}
</urlset>
`;
fs.writeFileSync(path.join(OUT, 'sitemap.xml'), sitemap);

console.log(`[build-static] 数据来源：${source}，文章 ${published.length} 篇，已生成 posts.json / rss.xml / sitemap.xml`);
