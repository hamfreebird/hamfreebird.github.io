import path from 'node:path';
import { db, seedDatabase, ROOT } from './db.js';

if (process.argv.includes('--reset')) {
  db.exec('DELETE FROM comments; DELETE FROM posts; DELETE FROM settings; DELETE FROM subscribers;');
  console.log('[seed] 已清空本地文章、评论、设置与订阅数据。');
}

const count = seedDatabase();
const total = db.prepare('SELECT COUNT(*) AS n FROM posts').get().n;
console.log(`[seed] 新增 ${count} 篇，当前共 ${total} 篇。数据源：${path.join(ROOT, 'content', 'posts.json')}`);
