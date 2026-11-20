import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

export const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
export const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
fs.mkdirSync(DATA_DIR, { recursive: true });

const secretPath = path.join(DATA_DIR, 'secret.key');
// 线上可能由多个实例分担请求：文件密钥只在单实例内稳定，跨实例会失效。
// 因此优先用部署环境变量派生固定密钥；本地无环境变量时仍使用文件密钥。
const tokenSeed = process.env.TOKEN_SECRET || process.env.ADMIN_PASSWORD;
export const SECRET = tokenSeed
  ? crypto.createHash('sha256').update(`freebird-token|${tokenSeed}`).digest('hex')
  : (() => {
    if (!fs.existsSync(secretPath)) {
      fs.writeFileSync(secretPath, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
    }
    return fs.readFileSync(secretPath, 'utf8').trim();
  })();

export const db = new DatabaseSync(path.join(DATA_DIR, 'blog.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
  CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    excerpt TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT '随笔',
    tags TEXT NOT NULL DEFAULT '[]',
    cover TEXT NOT NULL DEFAULT 'dawn',
    read_minutes INTEGER NOT NULL DEFAULT 3,
    featured INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'draft',
    views INTEGER NOT NULL DEFAULT 0,
    published_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER NOT NULL,
    author TEXT NOT NULL,
    email TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    ip_hash TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS subscribers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_posts_status ON posts(status, published_at DESC);
  CREATE INDEX IF NOT EXISTS idx_comments_post ON comments(post_id, status, created_at DESC);
`);

export const now = () => new Date().toISOString();

export function transaction(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, hash: crypto.scryptSync(String(password), salt, 64).toString('hex') };
}

export function verifyPassword(password, salt, expected) {
  const actual = crypto.scryptSync(String(password), salt, 64);
  const target = Buffer.from(expected, 'hex');
  return actual.length === target.length && crypto.timingSafeEqual(actual, target);
}

function b64url(input) {
  return Buffer.from(input).toString('base64url');
}

export function signToken(username, ttlSeconds = 7 * 24 * 3600) {
  const payload = b64url(JSON.stringify({ sub: username, iat: Date.now(), exp: Date.now() + ttlSeconds * 1000 }));
  const sig = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export function verifyToken(token) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [payload, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', SECRET).update(payload).digest();
  let given;
  try { given = Buffer.from(sig, 'base64url'); } catch { return null; }
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data.sub || !data.exp || Date.now() > data.exp) return null;
    return data;
  } catch {
    return null;
  }
}

export function ensureAdmin(username = 'freebird') {
  const existing = db.prepare('SELECT id FROM admins WHERE username = ?').get(username);
  if (existing) return { created: false, password: null };

  let password = process.env.ADMIN_PASSWORD;
  let generated = false;
  if (!password) {
    password = crypto.randomBytes(9).toString('base64url');
    generated = true;
  }
  const { salt, hash } = hashPassword(password);
  db.prepare('INSERT INTO admins (username, password_hash, salt, created_at) VALUES (?, ?, ?, ?)')
    .run(username, hash, salt, now());
  return { created: true, password, generated, username };
}

export function setAdminPassword(username, password) {
  const { salt, hash } = hashPassword(password);
  const existing = db.prepare('SELECT id FROM admins WHERE username = ?').get(username);
  if (existing) {
    db.prepare('UPDATE admins SET password_hash = ?, salt = ? WHERE username = ?').run(hash, salt, username);
  } else {
    db.prepare('INSERT INTO admins (username, password_hash, salt, created_at) VALUES (?, ?, ?, ?)')
      .run(username, hash, salt, now());
  }
}

export function seedDatabase() {
  const seed = JSON.parse(fs.readFileSync(path.join(ROOT, 'content', 'posts.json'), 'utf8'));
  const existing = db.prepare('SELECT COUNT(*) AS n FROM posts').get().n;
  if (existing > 0) return 0;

  const insert = db.prepare(`
    INSERT INTO posts (slug, title, excerpt, content, category, tags, cover, read_minutes,
                       featured, status, views, published_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
  `);
  const stamp = now();
  transaction(() => {
    for (const p of seed.posts) {
      insert.run(
        p.slug, p.title, p.excerpt, p.content, p.category,
        JSON.stringify(p.tags || []), p.cover || 'dawn', p.readMinutes || 3,
        p.featured ? 1 : 0, p.status || 'published', p.publishedAt || stamp, stamp, stamp
      );
    }
  });

  const defaults = {
    ...seed.site,
    nav: '首页,归档,关于',
    icp: '',
    analytics: ''
  };
  const putSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [key, value] of Object.entries(defaults)) putSetting.run(key, String(value));
  return seed.posts.length;
}

export function getSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

export function publicPost(row) {
  if (!row) return null;
  const { id, slug, title, excerpt, content, category, tags, cover, read_minutes,
    featured, status, views, published_at, created_at, updated_at } = row;
  return {
    id, slug, title, excerpt, content, category,
    tags: safeParseArray(tags), cover, readMinutes: read_minutes,
    featured: Boolean(featured), status, views,
    publishedAt: published_at, createdAt: created_at, updatedAt: updated_at
  };
}

export function closeDb() {
  db.close();
}

export function safeParseArray(value) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

seedDatabase();
const admin = ensureAdmin();
if (admin.created) {
  console.log(`[freebird] 已创建管理员账号 ${admin.username}`);
  if (admin.generated) {
    console.log(`[freebird] 初始随机密码：${admin.password}（请立即通过 ADMIN_PASSWORD 环境变量修改）`);
  }
}
