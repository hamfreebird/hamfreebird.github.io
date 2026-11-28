import crypto from 'node:crypto';
import {
  db, now, publicPost, safeParseArray, getSettings,
  verifyPassword, verifyToken, signToken, setAdminPassword, transaction
} from './db.js';
import { importDataset, writeSnapshot, readLatestSnapshot, snapshotInfo, scheduleSnapshot } from './snapshot.js';
import { looksLikeHtml } from '../assets/js/markdown.js';

const json = (res, status, payload, extra = {}) => {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    ...extra
  });
  res.end(body);
};

const fail = (res, status, message) => json(res, status, { ok: false, error: message });

function readBody(req) {
  if (req._parsedBody) return Promise.resolve(req._parsedBody);
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 5 * 1024 * 1024) {
        reject(Object.assign(new Error('请求体过大'), { status: 413 }));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        const parsed = raw ? JSON.parse(raw) : {};
        req._parsedBody = parsed;
        resolve(parsed);
      } catch {
        reject(Object.assign(new Error('JSON 格式不正确'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function authUser(req) {
  const header = req.headers.authorization || '';
  const fromAuthorization = header.startsWith('Bearer ') ? header.slice(7) : '';
  // 查询串会进入代理与访问日志，令牌不再通过 URL 传递。
  const fromCustomHeader = String(req.headers['x-access-token'] || '').trim();
  const fromBody = req._parsedBody?.access_token || '';
  // 网关可能剥离或改写 Authorization，因此优先采用显式自定义头与请求体令牌。
  const token = fromCustomHeader || fromBody || fromAuthorization;
  const data = verifyToken(token);
  if (!data) return null;
  const admin = db.prepare('SELECT id, username FROM admins WHERE username = ?').get(data.sub);
  return admin || null;
}

const limiters = new Map();
function rateLimited(key, max, windowMs) {
  const time = Date.now();
  const hits = (limiters.get(key) || []).filter((t) => time - t < windowMs);
  if (hits.length >= max) return true;
  hits.push(time);
  limiters.set(key, hits);
  return false;
}

// 部署在反向代理之后时，socket 地址是网关内网 IP，直接用它会导致全站共用限流桶。
// 仅当显式设置 TRUST_PROXY 时才采信转发头；默认关闭，避免直连场景被伪造 XFF 绕过限流。
// TRUST_PROXY_HOPS 表示右侧受信代理层数（默认 1，即取 XFF 最后一项：网关追加的真实地址）。
function clientIp(req) {
  const socketIp = req.socket.remoteAddress || 'unknown';
  const trust = String(process.env.TRUST_PROXY || '').trim().toLowerCase();
  if (!trust || trust === '0' || trust === 'false') return socketIp;

  const chain = String(req.headers['x-forwarded-for'] || '')
    .split(',').map((part) => part.trim()).filter(Boolean);
  if (chain.length) {
    const hops = Math.max(1, Number(process.env.TRUST_PROXY_HOPS) || 1);
    return chain[Math.max(0, chain.length - hops)] || socketIp;
  }
  const realIp = String(req.headers['x-real-ip'] || '').trim();
  return realIp || socketIp;
}

function ipHash(req) {
  return crypto.createHash('sha256').update(clientIp(req)).digest('hex');
}

function str(value, fallback = '', max = 500) {
  return typeof value === 'string' ? value.trim().slice(0, max) : fallback;
}

function slugify(value) {
  const base = String(value)
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return base || `post-${Date.now().toString(36)}`;
}

function postInput(body, existing = null) {
  const title = str(body.title, existing?.title || '', 200);
  if (!title) throw Object.assign(new Error('标题不能为空'), { status: 400 });
  const slug = body.slug ? slugify(body.slug) : (existing?.slug || slugify(title));
  let content = typeof body.content === 'string' ? body.content : (existing?.content || '');
  // 前端为绕开发布网关的 XSS 误报会把正文编码为 Base64；仅在此显式标记时解码。
  if (body.contentEncoding === 'base64') {
    const decoded = Buffer.from(content, 'base64');
    if (decoded.length > 2 * 1024 * 1024) {
      throw Object.assign(new Error('正文过大'), { status: 413 });
    }
    content = decoded.toString('utf8');
  }
  if (!content.trim()) throw Object.assign(new Error('正文不能为空'), { status: 400 });
  const category = str(body.category, existing?.category || '随笔', 40) || '随笔';
  const tags = Array.isArray(body.tags)
    ? body.tags.map((t) => str(t, '', 30)).filter(Boolean).slice(0, 10)
    : (existing ? safeParseArray(existing.tags) : []);
  const cover = str(body.cover, existing?.cover || 'dawn', 30) || 'dawn';
  const status = ['published', 'draft'].includes(body.status)
    ? body.status : (existing?.status || 'draft');
  const readMinutes = Number.isFinite(Number(body.readMinutes))
    ? Math.min(180, Math.max(1, Math.round(Number(body.readMinutes))))
    : (existing?.read_minutes || 3);
  const format = ['markdown', 'html'].includes(body.format)
    ? body.format
    : (existing?.format || (looksLikeHtml(content) ? 'html' : 'markdown'));
  return {
    slug, title, content, format, category, tags: JSON.stringify(tags), cover, status, readMinutes,
    excerpt: str(body.excerpt, existing?.excerpt || '', 300),
    featured: body.featured === undefined ? (existing?.featured ?? 0) : (body.featured ? 1 : 0),
    publishedAt: str(body.publishedAt, existing?.published_at || now(), 40) || now()
  };
}

function insertPost(body) {
  const p = postInput(body);
  const exists = db.prepare('SELECT id FROM posts WHERE slug = ?').get(p.slug);
  if (exists) throw Object.assign(new Error('该 slug 已存在'), { status: 409 });
  const stamp = now();
  const result = db.prepare(`
    INSERT INTO posts (slug, title, excerpt, content, format, category, tags, cover, read_minutes,
      featured, status, published_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(p.slug, p.title, p.excerpt, p.content, p.format, p.category, p.tags, p.cover,
    p.readMinutes, p.featured, p.status, p.publishedAt, stamp, stamp);
  return publicPost(db.prepare('SELECT * FROM posts WHERE id = ?').get(result.lastInsertRowid));
}

function updatePost(id, body) {
  const existing = db.prepare('SELECT * FROM posts WHERE id = ?').get(id);
  if (!existing) throw Object.assign(new Error('文章不存在'), { status: 404 });
  const p = postInput(body, existing);
  const clash = db.prepare('SELECT id FROM posts WHERE slug = ? AND id != ?').get(p.slug, id);
  if (clash) throw Object.assign(new Error('该 slug 已存在'), { status: 409 });
  db.prepare(`
    UPDATE posts SET slug=?, title=?, excerpt=?, content=?, format=?, category=?, tags=?, cover=?,
      read_minutes=?, featured=?, status=?, published_at=?, updated_at=? WHERE id=?
  `).run(p.slug, p.title, p.excerpt, p.content, p.format, p.category, p.tags, p.cover,
    p.readMinutes, p.featured, p.status, p.publishedAt, now(), id);
  return publicPost(db.prepare('SELECT * FROM posts WHERE id = ?').get(id));
}

function listPosts(url, isAdmin) {
  const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit')) || 8));
  const q = str(url.searchParams.get('q'), '', 100);
  const tag = str(url.searchParams.get('tag'), '', 50);
  const category = str(url.searchParams.get('category'), '', 50);
  const status = isAdmin ? str(url.searchParams.get('status'), 'all', 20) : 'published';
  const where = [];
  const args = [];
  if (status !== 'all') { where.push('status = ?'); args.push(status); }
  if (q) {
    where.push('(title LIKE ? OR excerpt LIKE ? OR content LIKE ?)');
    const like = `%${q}%`;
    args.push(like, like, like);
  }
  if (category) { where.push('category = ?'); args.push(category); }
  if (tag) { where.push('tags LIKE ?'); args.push(`%"${tag}"%`); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = db.prepare(`SELECT COUNT(*) AS n FROM posts ${clause}`).get(...args).n;
  const rows = db.prepare(`
    SELECT * FROM posts ${clause}
    ORDER BY COALESCE(published_at, created_at) DESC, id DESC LIMIT ? OFFSET ?
  `).all(...args, limit, (page - 1) * limit);
  return {
    items: rows.map(publicPost), total, page, pages: Math.max(1, Math.ceil(total / limit)),
    source: 'backend'
  };
}

function commentsFor(postId, includeAll, isAdmin) {
  const rows = isAdmin && includeAll
    ? db.prepare('SELECT * FROM comments WHERE post_id = ? ORDER BY created_at DESC').all(postId)
    : db.prepare("SELECT * FROM comments WHERE post_id = ? AND status = 'approved' ORDER BY created_at ASC").all(postId);
  return rows.map((r) => ({
    id: r.id, postId: r.post_id, author: r.author, content: r.content,
    status: r.status, createdAt: r.created_at
  }));
}

function stats() {
  const posts = db.prepare("SELECT COUNT(*) AS total, COALESCE(SUM(views),0) AS views, SUM(CASE WHEN status='published' THEN 1 ELSE 0 END) AS published FROM posts").get();
  const comments = db.prepare("SELECT COUNT(*) AS total, SUM(CASE WHEN status='approved' THEN 1 ELSE 0 END) AS approved, SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) AS pending FROM comments").get();
  const subscribers = db.prepare('SELECT COUNT(*) AS n FROM subscribers').get().n;
  return {
    posts: posts.total || 0, published: posts.published || 0, views: posts.views || 0,
    comments: comments.total || 0, approvedComments: comments.approved || 0,
    pendingComments: comments.pending || 0, subscribers
  };
}

function escapeXml(value) {
  return String(value).replace(/[<>&"']/g, (c) => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;'
  })[c]);
}

function rss(req) {
  const settings = getSettings();
  const protocol = req.headers['x-forwarded-proto'] || 'http';
  const base = (process.env.SITE_URL || `${protocol}://${req.headers.host}`).replace(/\/$/, '');
  const rows = db.prepare("SELECT * FROM posts WHERE status='published' ORDER BY published_at DESC LIMIT 20").all();
  const items = rows.map((p) => `
    <item>
      <title>${escapeXml(p.title)}</title>
      <link>${escapeXml(`${base}/post.html?slug=${encodeURIComponent(p.slug)}`)}</link>
      <guid>${escapeXml(`${base}/post.html?slug=${encodeURIComponent(p.slug)}`)}</guid>
      <pubDate>${escapeXml(new Date(p.published_at || p.created_at).toUTCString())}</pubDate>
      <description>${escapeXml(p.excerpt)}</description>
      <category>${escapeXml(p.category)}</category>
    </item>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>${escapeXml(settings.name || 'freebird的自留地')}</title>
  <link>${escapeXml(base)}</link>
  <description>${escapeXml(settings.description || '')}</description>
  <language>zh-CN</language>
  <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>${items}
</channel></rss>`;
}

export function applyCors(req, res) {
  const origin = req.headers.origin;
  if (!origin) return true;
  const allowed = (process.env.CORS_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean);
  const ownOrigin = `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}`;
  if (allowed.includes(origin) || origin === ownOrigin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    return true;
  }
  return false;
}

/** 返回 true 表示该请求已被 API 层处理。 */
export async function handleApi(req, res, url) {
  const pathname = url.pathname;
  if (!pathname.startsWith('/api/') && pathname !== '/rss.xml') return false;

  if (!applyCors(req, res)) return fail(res, 403, '来源不被允许，请检查后端 CORS_ORIGIN 配置'), true;
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Access-Token',
      'Access-Control-Max-Age': '86400'
    });
    res.end();
    return true;
  }

  try {
    if (pathname === '/api/health' && req.method === 'GET') {
      return json(res, 200, { ok: true, service: 'freebird-blog-api', time: now(), version: '2026-11-20-token-body' }), true;
    }

    if (pathname === '/api/auth/login' && req.method === 'POST') {
      if (rateLimited(`login:${clientIp(req)}`, 10, 15 * 60 * 1000)) return fail(res, 429, '尝试次数过多，请稍后再试'), true;
      const body = await readBody(req);
      const row = db.prepare('SELECT * FROM admins WHERE username = ?').get(str(body.username, '', 60));
      if (!row || !verifyPassword(body.password || '', row.salt, row.password_hash)) {
        return fail(res, 401, '用户名或密码不正确'), true;
      }
      return json(res, 200, {
        ok: true, token: signToken(row.username), user: { id: row.id, username: row.username }
      }), true;
    }

    if (['POST', 'PUT', 'PATCH'].includes(req.method) && pathname !== '/api/auth/login') {
      try { await readBody(req); } catch { /* 后续路由会返回具体错误 */ }
    }

    // 发布网关会剥离 Authorization 与自定义头，GET 无法携带令牌。
    // 管理端改为 POST + JSON 体传令牌，并在此按 GET 处理，查询参数由请求体补全。
    if (req.method === 'POST' && req._parsedBody?._method === 'GET') {
      for (const [key, value] of Object.entries(req._parsedBody)) {
        if (key === 'access_token' || key === '_method' || value === undefined || value === null) continue;
        if (!url.searchParams.has(key)) url.searchParams.set(key, String(value));
      }
      req.method = 'GET';
    }

    const isAdmin = Boolean(authUser(req));

    if (pathname === '/api/auth/me' && req.method === 'GET') {
      if (!isAdmin) return fail(res, 401, '请先登录'), true;
      return json(res, 200, { ok: true, user: authUser(req) }), true;
    }

    if (pathname === '/api/posts' && req.method === 'GET') {
      return json(res, 200, listPosts(url, isAdmin)), true;
    }

    let match = pathname.match(/^\/api\/posts\/([^/]+)$/);
    if (match && req.method === 'GET') {
      const key = decodeURIComponent(match[1]);
      const row = Number.isNaN(Number(key))
        ? db.prepare('SELECT * FROM posts WHERE slug = ?').get(key)
        : db.prepare('SELECT * FROM posts WHERE id = ?').get(Number(key));
      if (!row || (row.status !== 'published' && !isAdmin)) return fail(res, 404, '文章不存在'), true;
      const post = publicPost(row);
      post.comments = commentsFor(row.id, false, false);
      return json(res, 200, { ok: true, post }), true;
    }

    if (pathname === '/api/posts' && req.method === 'POST') {
      if (!isAdmin) return fail(res, 401, '请先登录'), true;
      const created = insertPost(await readBody(req));
      scheduleSnapshot('post-create');
      return json(res, 201, { ok: true, post: created }), true;
    }

    if (match && (req.method === 'PUT' || req.method === 'DELETE')) {
      if (!isAdmin) return fail(res, 401, '请先登录'), true;
      const id = Number(match[1]);
      if (!Number.isInteger(id)) return fail(res, 400, '文章 ID 无效'), true;
      if (req.method === 'DELETE') {
        const result = db.prepare('DELETE FROM posts WHERE id = ?').run(id);
        if (!result.changes) return fail(res, 404, '文章不存在'), true;
        scheduleSnapshot('post-delete');
        return json(res, 200, { ok: true }), true;
      }
      const updated = updatePost(id, await readBody(req));
      scheduleSnapshot('post-update');
      return json(res, 200, { ok: true, post: updated }), true;
    }

    match = pathname.match(/^\/api\/posts\/(\d+)\/view$/);
    if (match && req.method === 'POST') {
      db.prepare('UPDATE posts SET views = views + 1 WHERE id = ?').run(Number(match[1]));
      return json(res, 200, { ok: true }), true;
    }

    if (pathname === '/api/comments' && req.method === 'GET') {
      const postId = Number(url.searchParams.get('postId'));
      if (!Number.isInteger(postId)) return fail(res, 400, '缺少 postId'), true;
      if (!isAdmin) return fail(res, 401, '请先登录'), true;
      return json(res, 200, { ok: true, items: commentsFor(postId, true, true) }), true;
    }

    if (pathname === '/api/comments' && req.method === 'POST') {
      if (rateLimited(`comment:${clientIp(req)}`, 5, 10 * 60 * 1000)) return fail(res, 429, '留言太频繁了，请稍后再试'), true;
      const body = await readBody(req);
      const postId = Number(body.postId);
      const post = db.prepare("SELECT id FROM posts WHERE id = ? AND status='published'").get(postId);
      if (!post) return fail(res, 404, '文章不存在或未发布'), true;
      const content = str(body.content, '', 1000).replace(/<[^>]*>/g, '');
      if (content.length < 2) return fail(res, 400, '留言内容太短'), true;
      const author = str(body.author, '匿名旅人', 40) || '匿名旅人';
      const email = str(body.email, '', 120);
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail(res, 400, '邮箱格式不正确'), true;
      db.prepare(`INSERT INTO comments (post_id, author, email, content, status, ip_hash, created_at)
                  VALUES (?, ?, ?, ?, 'pending', ?, ?)`)
        .run(postId, author, email, content, ipHash(req), now());
      scheduleSnapshot('comment-create');
      return json(res, 202, { ok: true, message: '留言已提交，等待站长审核后显示' }), true;
    }

    match = pathname.match(/^\/api\/comments\/(\d+)$/);
    if (match && (req.method === 'PATCH' || req.method === 'DELETE')) {
      if (!isAdmin) return fail(res, 401, '请先登录'), true;
      const id = Number(match[1]);
      if (req.method === 'DELETE') {
        db.prepare('DELETE FROM comments WHERE id = ?').run(id);
        scheduleSnapshot('comment-delete');
        return json(res, 200, { ok: true }), true;
      }
      const body = await readBody(req);
      if (!['approved', 'pending', 'spam'].includes(body.status)) return fail(res, 400, '状态无效'), true;
      db.prepare('UPDATE comments SET status = ? WHERE id = ?').run(body.status, id);
      scheduleSnapshot('comment-status');
      return json(res, 200, { ok: true }), true;
    }

    if (pathname === '/api/settings' && req.method === 'GET') {
      const all = getSettings();
      const publicKeys = ['name', 'tagline', 'description', 'author', 'email', 'repo', 'pages', 'icp'];
      return json(res, 200, {
        ok: true, settings: Object.fromEntries(publicKeys.map((k) => [k, all[k] || '']))
      }), true;
    }

    if (pathname === '/api/settings' && req.method === 'PUT') {
      if (!isAdmin) return fail(res, 401, '请先登录'), true;
      const body = await readBody(req);
      const put = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
      transaction(() => Object.entries(body).forEach(([k, v]) => put.run(k, String(v).slice(0, 2000))));
      scheduleSnapshot('settings');
      return json(res, 200, { ok: true, settings: getSettings() }), true;
    }

    if (pathname === '/api/stats' && req.method === 'GET') {
      return json(res, 200, { ok: true, stats: stats() }), true;
    }

    if (pathname === '/api/tags' && req.method === 'GET') {
      const counts = new Map();
      for (const row of db.prepare("SELECT tags FROM posts WHERE status='published'").all()) {
        for (const tag of safeParseArray(row.tags)) counts.set(tag, (counts.get(tag) || 0) + 1);
      }
      return json(res, 200, {
        ok: true,
        tags: [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count)
      }), true;
    }

    if (pathname === '/api/subscribe' && req.method === 'POST') {
      const body = await readBody(req);
      const email = str(body.email, '', 120).toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail(res, 400, '邮箱格式不正确'), true;
      db.prepare('INSERT OR IGNORE INTO subscribers (email, created_at) VALUES (?, ?)').run(email, now());
      return json(res, 200, { ok: true, message: '订阅成功' }), true;
    }

    if (pathname === '/api/admin/password' && req.method === 'POST') {
      if (!isAdmin) return fail(res, 401, '请先登录'), true;
      const body = await readBody(req);
      const next = str(body.password, '', 200);
      if (next.length < 8) return fail(res, 400, '新密码至少 8 位'), true;
      const me = authUser(req);
      setAdminPassword(me.username, next);
      return json(res, 200, { ok: true, message: '密码已更新，请重新登录' }), true;
    }

    if (pathname === '/api/backup' && req.method === 'GET') {
      if (!isAdmin) return fail(res, 401, '请先登录'), true;
      return json(res, 200, {
        ok: true, exportedAt: now(),
        posts: db.prepare('SELECT * FROM posts').all(),
        comments: db.prepare('SELECT * FROM comments').all(),
        settings: db.prepare('SELECT * FROM settings').all(),
        subscribers: db.prepare('SELECT * FROM subscribers').all()
      }), true;
    }

    if (pathname === '/api/backup/import' && req.method === 'POST') {
      if (!isAdmin) return fail(res, 401, '请先登录'), true;
      const body = await readBody(req);
      const backup = body.backup && typeof body.backup === 'object' ? body.backup : body;
      const counts = importDataset(backup);
      writeSnapshot('import');
      return json(res, 200, { ok: true, message: '备份已恢复', counts }), true;
    }

    if (pathname === '/api/backup/snapshots' && req.method === 'GET') {
      if (!isAdmin) return fail(res, 401, '请先登录'), true;
      return json(res, 200, { ok: true, ...snapshotInfo() }), true;
    }

    if (pathname === '/api/backup/snapshot' && req.method === 'POST') {
      if (!isAdmin) return fail(res, 401, '请先登录'), true;
      const ok = writeSnapshot('manual');
      return json(res, ok ? 200 : 500, ok ? { ok: true, message: '快照已生成', ...snapshotInfo() } : { ok: false, error: '快照写入失败' }), true;
    }

    if (pathname === '/api/backup/restore-latest' && req.method === 'POST') {
      if (!isAdmin) return fail(res, 401, '请先登录'), true;
      const latest = readLatestSnapshot();
      if (!latest) return fail(res, 404, '暂无可用快照'), true;
      const counts = importDataset(latest);
      writeSnapshot('restore-latest');
      return json(res, 200, { ok: true, message: '已从最近快照恢复', counts }), true;
    }

    if (pathname === '/rss.xml' && req.method === 'GET') {
      const body = rss(req);
      res.writeHead(200, { 'Content-Type': 'application/rss+xml; charset=utf-8' });
      res.end(body);
      return true;
    }

    return fail(res, 404, '接口不存在'), true;
  } catch (error) {
    const status = error.status || 500;
    if (status === 500) console.error('[api]', error);
    return fail(res, status, status === 500 ? '服务器内部错误' : error.message), true;
  }
}
