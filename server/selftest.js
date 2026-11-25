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
await check('备份导出与恢复', async () => {
  const headers = { Authorization: `Bearer ${token}` };
  const created = await json('/api/posts', {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: '备份测试文章', slug: 'backup-test', content: '<p>backup</p>', status: 'published' })
  });
  assert(created.status === 201, '备份前置文章创建失败');
  const backup = await json('/api/backup', { headers });
  assert(backup.body.posts.length >= 1, '备份数据为空');
  const unauthImport = await json('/api/backup/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert(unauthImport.status === 401, '未授权导入未被拒绝');
  const restored = await json('/api/backup/import', {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ backup: backup.body })
  });
  assert(restored.status === 200, `恢复失败：${restored.status}`);
  const list = await json('/api/posts');
  assert(list.body.items.some((p) => p.slug === 'backup-test'), '恢复后文章缺失');
});

await check('自动快照与一键恢复', async () => {
  const headers = { Authorization: `Bearer ${token}` };
  const info = await json('/api/backup/snapshots', { headers });
  assert(info.status === 200, '快照信息接口不可用');
  assert(info.body.files >= 1, '尚无自动快照');
  const unauth = await json('/api/backup/snapshots');
  assert(unauth.status === 401, '未授权查询快照未被拒绝');
  const snap = await json('/api/backup/snapshot', {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ access_token: token })
  });
  assert(snap.status === 200, '手动生成快照失败');
  assert(snap.body.latestPosts >= 1, '快照中没有文章');
  const restore = await json('/api/backup/restore-latest', {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ access_token: token })
  });
  assert(restore.status === 200, `快照恢复失败：${restore.status}`);
  assert(restore.body.counts.posts >= 1, '快照恢复后文章缺失');
});

await check('Markdown 正文格式与渲染', async () => {
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const created = await json('/api/posts', {
    method: 'POST', headers,
    body: JSON.stringify({ title: 'Markdown 测试', slug: 'md-test', content: '# 标题\n\n**加粗**', format: 'markdown', status: 'published' })
  });
  assert(created.status === 201, `Markdown 文章创建失败：${created.status}`);
  assert(created.body.post.format === 'markdown', '未返回 markdown 格式');
  const fetched = await json('/api/posts/md-test');
  assert(fetched.body.post.format === 'markdown', 'Markdown 格式未持久化');
  const htmlPost = await json('/api/posts', {
    method: 'POST', headers,
    body: JSON.stringify({ title: 'HTML 文章', slug: 'html-test', content: '<p>hello</p>', status: 'published' })
  });
  assert(htmlPost.body.post.format === 'html', 'HTML 内容未被识别为 html');

  const { markdownToHtml, renderContent } = await import('../assets/js/markdown.js');
  const rendered = markdownToHtml('# 标题\n\n**加粗**\n\n```js\nconst a = 1 < 2;\n```');
  assert(rendered.includes('<h1>标题</h1>') && rendered.includes('<strong>加粗</strong>'), 'Markdown 基本语法渲染失败');
  assert(rendered.includes('1 &lt; 2'), '代码块未转义');
  assert(!markdownToHtml('<script>alert(1)</script>').includes('<script>'), '原始 HTML 未转义');
  assert(renderContent('<p>旧文章</p>').includes('<p>旧文章</p>'), '既有 HTML 内容渲染异常');
});

await check('正文 Base64 传输与脚本片段保留', async () => {
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const raw = '# 示例\n\n```js\nalert(1);\n```\n\n<script>console.log(1)</script>';
  const encoded = Buffer.from(raw, 'utf8').toString('base64');
  const created = await json('/api/posts', {
    method: 'POST', headers,
    body: JSON.stringify({ title: 'Base64 正文', slug: 'b64-body', content: encoded, contentEncoding: 'base64', format: 'markdown', status: 'draft' })
  });
  assert(created.status === 201, `Base64 文章创建失败：${created.status}`);
  assert(created.body.post.content === raw, 'Base64 正文未被原样还原');
});

await new Promise((resolve) => server.close(resolve));
closeDb();
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* 临时文件可稍后清理 */ }
console.log(`\n结果：${passed} 通过，${failed} 失败\n`);
process.exit(failed ? 1 : 0);
