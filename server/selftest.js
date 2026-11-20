import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'freebird-check-'));
process.env.DATA_DIR = path.join(tmp, 'data');
process.env.ADMIN_PASSWORD = 'selftest-password-2026';

const { createApp } = await import('./index.js');
const { closeDb } = await import('./db.js');
const server = createApp();
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

let passed = 0;
let failed = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`  PASS  ${name}`);
    passed += 1;
  } catch (error) {
    console.error(`  FAIL  ${name} → ${error.message}`);
    failed += 1;
  }
}
function assert(condition, message) {
  if (!condition) throw new Error(message);
}
async function json(pathname, options) {
  const res = await fetch(base + pathname, options);
  return { status: res.status, body: await res.json().catch(() => null) };
}

console.log('\nfreebird 后端自检（临时数据目录，数据与仓库隔离）\n');

let token;
await check('健康检查', async () => {
  const r = await json('/api/health');
  assert(r.status === 200 && r.body.ok, '健康检查失败');
});
await check('初始仓库为空（不携带任何博客内容）', async () => {
  const r = await json('/api/posts');
  assert(r.status === 200 && r.body.total === 0, '初始文章列表应为空');
});
await check('未授权访问被拒绝', async () => {
  const r = await json('/api/auth/me');
  assert(r.status === 401, '未授权请求未被拒绝');
  const create = await json('/api/posts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert(create.status === 401, '未授权创建未被拒绝');
});
await check('管理员登录', async () => {
  const r = await json('/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'freebird', password: process.env.ADMIN_PASSWORD })
  });
  assert(r.status === 200 && r.body.token, '登录失败');
  token = r.body.token;
});
let testPostId;
await check('创建文章与列表/搜索/详情', async () => {
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  const created = await json('/api/posts', {
    method: 'POST', headers,
    body: JSON.stringify({ title: '临时测试文章', slug: 'temporary-test-post', content: '<p>test content</p>', status: 'published', tags: ['测试'] })
  });
  assert(created.status === 201, `创建失败：${created.status}`);
  testPostId = created.body.post.id;
  const list = await json('/api/posts?page=1&limit=5');
  assert(list.body.total === 1 && list.body.items[0].slug === 'temporary-test-post', '列表返回错误');
  const search = await json('/api/posts?q=测试');
  assert(search.body.total === 1, '搜索结果错误');
  const detail = await json('/api/posts/temporary-test-post');
  assert(detail.body.post.title === '临时测试文章', '详情返回错误');
});
await check('公开评论提交', async () => {
  const r = await json('/api/comments', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ postId: testPostId, author: '测试旅人', content: '这是一条自检留言' })
  });
  assert(r.status === 202, `期望 202，实际 ${r.status}`);
});
await check('文章更新', async () => {
  const r = await json(`/api/posts/${testPostId}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ title: '临时测试文章（已更新）', content: '<p>updated</p>' })
  });
  assert(r.status === 200 && r.body.post.title.includes('已更新'), '更新失败');
});
await check('评论审核与统计', async () => {
  const headers = { Authorization: `Bearer ${token}` };
  const comments = await json(`/api/comments?postId=${testPostId}`, { headers });
  assert(comments.body.items.length >= 1, '未读到待审留言');
  const approved = await json(`/api/comments/${comments.body.items[0].id}`, {
    method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'approved' })
  });
  assert(approved.status === 200, '审核失败');
  const stats = await json('/api/stats');
  assert(stats.body.stats.approvedComments >= 1, '统计未更新');
});
await check('站点信息含邮箱与仓库链接', async () => {
  const r = await json('/api/settings');
  assert(r.body.settings.email === 'freebirdflyinthesky@outlook.com', '邮箱缺失');
  assert(r.body.settings.repo.includes('github.com/hamfreebird'), '仓库链接缺失');
});
await check('RSS、删除与静态入口', async () => {
  const rss = await fetch(base + '/rss.xml');
  assert((await rss.text()).includes('<rss'), 'RSS 输出异常');
  const removed = await json(`/api/posts/${testPostId}`, {
    method: 'DELETE', headers: { Authorization: `Bearer ${token}` }
  });
  assert(removed.status === 200, '删除失败');
  const home = await fetch(base + '/');
  assert((await home.text()).includes('freebird'), '首页输出异常');
});

await new Promise((resolve) => server.close(resolve));
closeDb();
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* 临时文件可稍后清理 */ }
console.log(`\n结果：${passed} 通过，${failed} 失败\n`);
process.exit(failed ? 1 : 0);
