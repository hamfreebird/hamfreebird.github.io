import crypto from 'node:crypto';
import {
  db, now, publicPost, safeParseArray, getSettings,
  verifyPassword, verifyToken, signToken, setAdminPassword, transaction
} from './db.js';

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

function authUser(req, url) {
  const header = req.headers.authorization || '';
  const fromHeader = header.startsWith('Bearer ') ? header.slice(7) : '';
  const fromQuery = url?.searchParams.get('access_token') || '';
  const fromBody = req._parsedBody?.access_token || '';
  const token = fromHeader || fromQuery || fromBody;
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

function clientIp(req) {
  return req.socket.remoteAddress || 'unknown';
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
  const content = typeof body.content === 'string' ? body.content : (existing?.content || '');
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
  return {
    slug, title, content, category, tags: JSON.stringify(tags), cover, status, readMinutes,
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
    INSERT INTO posts (slug, title, excerpt, content, category, tags, cover, read_minutes,
      featured, status, published_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(p.slug, p.title, p.excerpt, p.content, p.category, p.tags, p.cover,
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
    UPDATE posts SET slug=?, title=?, excerpt=?, content=?, category=?, tags=?, cover=?,
      read_minutes=?, featured=?, status=?, published_at=?, updated_at=? WHERE id=?
  `).run(p.slug, p.title, p.excerpt, p.content, p.category, p.tags, p.cover,
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
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400'
    });
    res.end();
    return true;
  }

  try {
    if (pathname === '/api/health' && req.method === 'GET') {
      return json(res, 200, { ok: true, service: 'freebird-blog-api', time: now(), version: '2026-11-20-token-body' }), true);
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

    const isAdmin = Boolean(authUser(req, url));

    if (pathname === '/api/auth/me' && req.method === 'GET') {
      if (!isAdmin) return fail(res, 401, '请先登录'), true;
      return json(res, 200, { ok: true, user: authUser(req, url) }), true;
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
      return json(res, 201, { ok: true, post: insertPost(await readBody(req)) }), true;
    }

    if (match && (req.method === 'PUT' || req.method === 'DELETE')) {
      if (!isAdmin) return fail(res, 401, '请先登录'), true;
      const id = Number(match[1]);
      if (!Number.isInteger(id)) return fail(res, 400, '文章 ID 无效'), true;
      if (req.method === 'DELETE') {
        const result = db.prepare('DELETE FROM posts WHERE id = ?').run(id);
        if (!result.changes) return fail(res, 404, '文章不存在'), true;
        return json(res, 200, { ok: true }), true;
      }
      return json(res, 200, { ok: true, post: updatePost(id, await readBody(req)) }), true;
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
      return json(res, 202, { ok: true, message: '留言已提交，等待站长审核后显示' }), true;
    }

    match = pathname.match(/^\/api\/comments\/(\d+)$/);
    if (match && (req.method === 'PATCH' || req.method === 'DELETE')) {
      if (!isAdmin) return fail(res, 401, '请先登录'), true;
      const id = Number(match[1]);
      if (req.method === 'DELETE') {
        db.prepare('DELETE FROM comments WHERE id = ?').run(id);
        return json(res, 200, { ok: true }), true;
      }
      const body = await readBody(req);
      if (!['approved', 'pending', 'spam'].includes(body.status)) return fail(res, 400, '状态无效'), true;
      db.prepare('UPDATE comments SET status = ? WHERE id = ?').run(body.status, id);
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
      const me = authUser(req, url);
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
      const groups = ['posts', 'comments', 'settings', 'subscribers'];
      for (const key of groups) {
        if (backup[key] !== undefined && !Array.isArray(backup[key])) {
          return fail(res, 400, `${key} 必须是数组`), true;
        }
        if ((backup[key]?.length || 0) > 2000) return fail(res, 400, `${key} 数据过多`), true;
      }
      const postsIn = backup.posts || [];
      const commentsIn = backup.comments || [];
      const settingsIn = backup.settings || [];
      const subscribersIn = backup.subscribers || [];
      if (postsIn.some((p) => !p || typeof p.slug !== 'string' || typeof p.title !== 'string')) {
        return fail(res, 400, '文章数据格式不正确'), true;
      }
      const idOr = (v) => (v === undefined || v === null || v === '' ? null : (Number.isInteger(Number(v)) ? Number(v) : null));
      const numOr = (v, fallback) => (v === undefined || v === null || v === '' ? fallback : (Number.isFinite(Number(v)) ? Number(v) : fallback));
      const textOr = (v, fallback = '') => (typeof v === 'string' ? v : fallback);
      transaction(() => {
        db.exec('DELETE FROM comments; DELETE FROM posts; DELETE FROM settings; DELETE FROM subscribers;');
        const addPost = db.prepare(`INSERT INTO posts
          (id, slug, title, excerpt, content, category, tags, cover, read_minutes, featured, status, views, published_at, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
        for (const p of postsIn) {
          addPost.run(
            idOr(p.id), textOr(p.slug).slice(0, 60), textOr(p.title).slice(0, 200),
            textOr(p.excerpt), textOr(p.content), textOr(p.category, '随笔').slice(0, 40),
            typeof p.tags === 'string' ? p.tags : JSON.stringify(Array.isArray(p.tags) ? p.tags : []),
            textOr(p.cover, 'dawn').slice(0, 30), numOr(p.readMinutes ?? p.read_minutes, 3),
            p.featured ? 1 : 0, ['published', 'draft'].includes(p.status) ? p.status : 'draft',
            numOr(p.views, 0), textOr(p.publishedAt ?? p.published_at) || null,
            textOr(p.createdAt ?? p.created_at) || now(), textOr(p.updatedAt ?? p.updated_at) || now()
          );
        }
        const addComment = db.prepare(`INSERT INTO comments
          (id, post_id, author, email, content, status, ip_hash, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
        for (const c of commentsIn) {
          addComment.run(
            idOr(c.id), numOr(c.postId ?? c.post_id, 0), textOr(c.author, '匿名旅人').slice(0, 40),
            textOr(c.email).slice(0, 120), textOr(c.content),
            ['approved', 'pending', 'spam'].includes(c.status) ? c.status : 'pending',
            textOr(c.ipHash ?? c.ip_hash).slice(0, 64), textOr(c.createdAt ?? c.created_at) || now()
          );
        }
        const addSetting = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
        for (const s of settingsIn) {
          if (!s || typeof s.key !== 'string') continue;
          addSetting.run(s.key.slice(0, 100), textOr(s.value).slice(0, 2000));
        }
        const addSubscriber = db.prepare('INSERT INTO subscribers (email, created_at) VALUES (?, ?)');
        for (const s of subscribersIn) {
          const email = textOr(s?.email).trim().toLowerCase();
          if (email) addSubscriber.run(email.slice(0, 120), textOr(s?.createdAt ?? s?.created_at) || now());
        }
      });
      return json(res, 200, {
        ok: true, message: '备份已恢复',
        counts: { posts: postsIn.length, comments: commentsIn.length, settings: settingsIn.length, subscribers: subscribersIn.length }
      }), true;
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
