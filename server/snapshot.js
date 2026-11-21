import fs from 'node:fs';
import path from 'node:path';
import { db, now, transaction, DATA_DIR } from './db.js';

// 快照放在数据目录内：数据目录位于项目之外，重新发布时不会被项目文件覆盖。
export const SNAPSHOT_DIR = path.join(DATA_DIR, 'snapshots');
const KEEP = 24;
let pending = null;

export function dataset() {
  return {
    exportedAt: now(),
    posts: db.prepare('SELECT * FROM posts').all(),
    comments: db.prepare('SELECT * FROM comments').all(),
    settings: db.prepare('SELECT * FROM settings').all(),
    subscribers: db.prepare('SELECT * FROM subscribers').all()
  };
}

export function counts() {
  return {
    posts: db.prepare('SELECT COUNT(*) AS n FROM posts').get().n,
    comments: db.prepare('SELECT COUNT(*) AS n FROM comments').get().n
  };
}

function prune() {
  try {
    const files = fs.readdirSync(SNAPSHOT_DIR)
      .filter((name) => name.startsWith('snap-') && name.endsWith('.json'))
      .sort();
    for (const name of files.slice(0, Math.max(0, files.length - KEEP))) {
      fs.rmSync(path.join(SNAPSHOT_DIR, name), { force: true });
    }
  } catch (error) {
    console.warn('[snapshot] 清理旧快照失败：', error.message);
  }
}

export function writeSnapshot(reason = 'auto') {
  try {
    fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
    const data = { ...dataset(), reason };
    const body = JSON.stringify(data);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.writeFileSync(path.join(SNAPSHOT_DIR, `snap-${stamp}.json`), body);
    fs.writeFileSync(path.join(SNAPSHOT_DIR, 'latest.json'), body);
    prune();
    return true;
  } catch (error) {
    console.warn('[snapshot] 写入快照失败：', error.message);
    return false;
  }
}

// 写操作后延迟合并成一次快照，避免频繁落盘。
export function scheduleSnapshot(reason = 'auto') {
  if (pending) return;
  pending = setTimeout(() => {
    pending = null;
    writeSnapshot(reason);
  }, 1200);
  if (typeof pending.unref === 'function') pending.unref();
}

export function readLatestSnapshot() {
  try {
    const file = path.join(SNAPSHOT_DIR, 'latest.json');
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

export function snapshotInfo() {
  let files = 0;
  let latestAt = null;
  try {
    const names = fs.readdirSync(SNAPSHOT_DIR).filter((n) => n.startsWith('snap-'));
    files = names.length;
    if (names.length) latestAt = fs.statSync(path.join(SNAPSHOT_DIR, names.sort().at(-1))).mtime.toISOString();
  } catch { /* 目录尚未创建 */ }
  const latest = readLatestSnapshot();
  return {
    dataDir: DATA_DIR,
    snapshotDir: SNAPSHOT_DIR,
    files,
    latestAt,
    latestPosts: latest?.posts?.length || 0,
    latestComments: latest?.comments?.length || 0
  };
}

// 用备份数据集整体替换文章/评论/设置/订阅，管理员账号保持不动。
export function importDataset(backup) {
  const groups = ['posts', 'comments', 'settings', 'subscribers'];
  for (const key of groups) {
    if (backup[key] !== undefined && !Array.isArray(backup[key])) {
      throw Object.assign(new Error(`${key} 必须是数组`), { status: 400 });
    }
    if ((backup[key]?.length || 0) > 2000) {
      throw Object.assign(new Error(`${key} 数据过多`), { status: 400 });
    }
  }
  const postsIn = backup.posts || [];
  const commentsIn = backup.comments || [];
  const settingsIn = backup.settings || [];
  const subscribersIn = backup.subscribers || [];
  if (postsIn.some((p) => !p || typeof p.slug !== 'string' || typeof p.title !== 'string')) {
    throw Object.assign(new Error('文章数据格式不正确'), { status: 400 });
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
  return { posts: postsIn.length, comments: commentsIn.length, settings: settingsIn.length, subscribers: subscribersIn.length };
}

// 数据库被清空（例如重新发布覆盖了数据文件）时，用最近快照自动补回内容。
export function autoRestore() {
  const { posts } = counts();
  if (posts > 0) return null;
  const latest = readLatestSnapshot();
  if (!latest || !Array.isArray(latest.posts) || latest.posts.length === 0) return null;
  try {
    const restored = importDataset(latest);
    console.log(`[snapshot] 检测到空数据库，已从快照恢复 ${restored.posts} 篇文章`);
    writeSnapshot('auto-restore');
    return restored;
  } catch (error) {
    console.warn('[snapshot] 自动恢复失败：', error.message);
    return null;
  }
}
