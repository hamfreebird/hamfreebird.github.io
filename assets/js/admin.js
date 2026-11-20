import { api } from './api.js';
import { mountShell, birdIcon, escapeHtml, formatDate, toast } from './common.js';

mountShell('');
const root = document.getElementById('adminRoot');
const TOKEN_KEY = 'freebird_admin_token';
let token = sessionStorage.getItem(TOKEN_KEY) || '';
let posts = [];

function renderLogin(note = '') {
  root.innerHTML = `<div class="login-card">
    ${birdIcon()}
    <h1>进入自留地</h1>
    <p>${note || '管理后台需要管理员身份验证'}</p>
    <form class="editor" id="loginForm">
      <label>用户名<input class="input" name="username" value="freebird" autocomplete="username" required></label>
      <label>密码<input class="input" name="password" type="password" autocomplete="current-password" required></label>
      <button class="btn btn-primary" type="submit">登录</button>
    </form>
  </div>`;
  document.getElementById('loginForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      const data = await api.login(form.username.value.trim(), form.password.value);
      token = data.token;
      sessionStorage.setItem(TOKEN_KEY, token);
      form.password.value = '';
      renderDashboard();
      toast('欢迎回来，freebird');
    } catch (error) { toast(error.message); }
  });
}

function dashboardHtml() {
  return `<div class="admin-head reveal">
    <div><div class="eyebrow">Control tower</div><h1>管理后台</h1></div>
    <div style="display:flex;gap:10px;flex-wrap:wrap">
      <a class="btn btn-ghost" href="index.html">查看站点</a>
      <button class="btn btn-ghost" id="logoutBtn">退出登录</button>
    </div>
  </div>
  <div class="admin-stats reveal" id="adminStats">
    <div class="stat"><strong data-admin="posts">—</strong><small>全部文章</small></div>
    <div class="stat"><strong data-admin="published">—</strong><small>已发布</small></div>
    <div class="stat"><strong data-admin="pendingComments">—</strong><small>待审留言</small></div>
    <div class="stat"><strong data-admin="views">—</strong><small>累计阅读</small></div>
  </div>

  <section class="admin-panel reveal">
    <h2 id="editorTitle">写新文章</h2>
    <form class="editor" id="postEditor">
      <div class="row"><label>标题<input class="input" name="title" maxlength="200" required placeholder="文章标题"></label>
        <label>Slug（留空自动生成）<input class="input" name="slug" maxlength="60" placeholder="my-post"></label></div>
      <div class="row"><label>分类<input class="input" name="category" maxlength="40" value="随笔"></label>
        <label>标签（英文逗号分隔）<input class="input" name="tags" maxlength="200" placeholder="自由, 生活"></label></div>
      <div class="row"><label>封面<select class="select" name="cover">
        <option value="dawn">dawn · 晨光</option><option value="night">night · 夜色</option>
        <option value="code">code · 代码</option><option value="autumn">autumn · 秋日</option>
        <option value="default">default · 默认</option></select></label>
        <label>阅读分钟数<input class="input" name="readMinutes" type="number" min="1" max="180" value="3"></label></div>
      <div class="row"><label>状态<select class="select" name="status">
        <option value="published">已发布</option><option value="draft">草稿</option></select></label>
        <label style="display:flex;align-items:center;gap:8px;align-self:end;padding-bottom:12px">
          <input type="checkbox" name="featured" style="accent-color:var(--teal)"> 设为精选</label></div>
      <label>摘要<textarea class="textarea" name="excerpt" maxlength="300" style="min-height:70px"></textarea></label>
      <label>正文（支持 HTML 标签）<textarea class="textarea" name="content" style="min-height:200px" required placeholder="<p>从这里开始写…</p>"></textarea></label>
      <div style="display:flex;gap:10px"><button class="btn btn-primary" type="submit">保存文章</button>
        <button class="btn btn-ghost" type="button" id="resetEditor">清空</button></div>
    </form>
  </section>

  <section class="admin-panel reveal">
    <h2>文章管理</h2>
    <table class="admin-table"><thead><tr><th>标题</th><th>状态</th><th>发布时间</th><th>阅读</th><th>操作</th></tr></thead>
      <tbody id="postRows"></tbody></table>
  </section>

  <section class="admin-panel reveal">
    <h2>留言审核</h2>
    <div style="display:flex;gap:12px;align-items:center;margin-bottom:18px;flex-wrap:wrap">
      <select class="select" id="commentPost" style="max-width:340px"></select>
      <button class="mini-btn" id="refreshComments">刷新留言</button>
    </div>
    <div id="commentList" class="comment-list"></div>
  </section>

  <section class="admin-panel reveal"><h2>站点设置</h2>
    <form class="editor" id="settingsForm">
      <div class="row"><label>站点名称<input class="input" name="name"></label><label>标语<input class="input" name="tagline"></label></div>
      <label>描述<input class="input" name="description"></label>
      <div class="row"><label>邮箱<input class="input" name="email" type="email"></label><label>ICP 备案（可选）<input class="input" name="icp"></label></div>
      <button class="btn btn-primary" type="submit" style="justify-self:start">保存设置</button>
    </form>
  </section>

  <section class="admin-panel reveal"><h2>安全与数据</h2>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:30px">
      <form class="editor" id="passwordForm">
        <label>修改管理员密码（至少 8 位）<input class="input" name="password" type="password" minlength="8" required></label>
        <button class="btn btn-ghost" type="submit" style="justify-self:start">更新密码</button>
      </form>
      <div><p class="muted" style="margin-top:0">导出全部文章、评论、设置与订阅数据为 JSON 备份。</p>
        <button class="btn btn-ghost" id="backupBtn">下载数据备份</button></div>
    </div>
  </section>`;
}

function editorValues() {
  const form = document.getElementById('postEditor');
  const f = new FormData(form);
  return {
    title: f.get('title').trim(), slug: f.get('slug').trim(), category: f.get('category').trim(),
    tags: f.get('tags').split(',').map((s) => s.trim()).filter(Boolean),
    cover: f.get('cover'), readMinutes: Number(f.get('readMinutes')),
    status: f.get('status'), featured: f.has('featured'),
    excerpt: f.get('excerpt').trim(), content: f.get('content').trim()
  };
}

let editingId = null;
function fillEditor(p) {
  editingId = p?.id || null;
  const form = document.getElementById('postEditor');
  form.title.value = p?.title || '';
  form.slug.value = p?.slug || '';
  form.category.value = p?.category || '随笔';
  form.tags.value = (p?.tags || []).join(', ');
  form.cover.value = p?.cover || 'dawn';
  form.readMinutes.value = p?.readMinutes || 3;
  form.status.value = p?.status || 'published';
  form.featured.checked = Boolean(p?.featured);
  form.excerpt.value = p?.excerpt || '';
  form.content.value = p?.content || '';
  document.getElementById('editorTitle').textContent = p ? `编辑文章 · ${p.title}` : '写新文章';
  form.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function bindDashboard() {
  document.getElementById('logoutBtn').addEventListener('click', () => {
    sessionStorage.removeItem(TOKEN_KEY);
    token = '';
    renderLogin('已安全退出');
  });

  document.getElementById('postEditor').addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = editorValues();
    try {
      if (editingId) await api.updatePost(editingId, data, token);
      else await api.createPost(data, token);
      toast(editingId ? '文章已更新' : '文章已创建');
      fillEditor(null);
      await Promise.all([loadPosts(), loadStats()]);
    } catch (error) { toast(error.message); }
  });
  document.getElementById('resetEditor').addEventListener('click', () => fillEditor(null));

  document.getElementById('settingsForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form));
    try { await api.updateSettings(data, token); toast('设置已保存'); }
    catch (error) { toast(error.message); }
  });

  document.getElementById('passwordForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      await api.changePassword(form.password.value, token);
      form.reset();
      sessionStorage.removeItem(TOKEN_KEY);
      token = '';
      renderLogin('密码已更新，请重新登录');
      toast('密码已更新');
    } catch (error) { toast(error.message); }
  });

  document.getElementById('backupBtn').addEventListener('click', async () => {
    try {
      const data = await api.backup(token);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `freebird-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast('备份已下载');
    } catch (error) { toast(error.message); }
  });

  document.getElementById('refreshComments').addEventListener('click', loadComments);
  document.getElementById('commentPost').addEventListener('change', loadComments);
}

async function loadStats() {
  const stats = await api.stats();
  if (!stats) return;
  document.querySelectorAll('[data-admin]').forEach((el) => {
    const value = Number(stats[el.dataset.admin]);
    if (!Number.isFinite(value)) return;
    const start = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - start) / 650);
      el.textContent = Math.round(value * (1 - Math.pow(1 - t, 3))).toLocaleString();
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

async function loadPosts() {
  const data = await api.listPosts({ page: 1, limit: 50, status: 'all' }, token);
  posts = data.items || [];
  const rows = document.getElementById('postRows');
  rows.innerHTML = posts.length ? posts.map((p) => `<tr>
    <td><strong>${escapeHtml(p.title)}</strong><br><span class="dim">/${escapeHtml(p.slug)}</span></td>
    <td><span class="status-chip ${p.status === 'published' ? 'live' : ''}">${p.status === 'published' ? '已发布' : '草稿'}</span></td>
    <td class="dim">${formatDate(p.publishedAt)}</td><td>${p.views || 0}</td>
    <td><div class="admin-actions">
      <button class="mini-btn" data-edit="${p.id}">编辑</button>
      <button class="mini-btn" data-toggle="${p.id}" data-status="${p.status}">${p.status === 'published' ? '转草稿' : '发布'}</button>
      <button class="mini-btn danger" data-delete="${p.id}">删除</button>
    </div></td></tr>`).join('')
    : '<tr><td colspan="5" class="muted">暂无文章，使用上方表单写下第一篇。</td></tr>';

  rows.querySelectorAll('[data-edit]').forEach((btn) => btn.addEventListener('click', () => {
    fillEditor(posts.find((p) => p.id === Number(btn.dataset.edit)));
  }));
  rows.querySelectorAll('[data-toggle]').forEach((btn) => btn.addEventListener('click', async () => {
    const id = Number(btn.dataset.toggle);
    const next = btn.dataset.status === 'published' ? 'draft' : 'published';
    try {
      await api.updatePost(id, { status: next }, token);
      toast(next === 'published' ? '已发布' : '已转为草稿');
      await Promise.all([loadPosts(), loadStats()]);
    } catch (error) { toast(error.message); }
  }));
  rows.querySelectorAll('[data-delete]').forEach((btn) => btn.addEventListener('click', async () => {
    if (!confirm('确定删除这篇文章及其全部留言吗？此操作不可撤销。')) return;
    try {
      await api.deletePost(Number(btn.dataset.delete), token);
      toast('文章已删除');
      if (editingId === Number(btn.dataset.delete)) fillEditor(null);
      await Promise.all([loadPosts(), loadStats()]);
    } catch (error) { toast(error.message); }
  }));

  const select = document.getElementById('commentPost');
  const previous = select.value;
  select.innerHTML = posts.map((p) => `<option value="${p.id}">${escapeHtml(p.title)}</option>`).join('');
  if (previous && posts.some((p) => String(p.id) === previous)) select.value = previous;
}

async function loadComments() {
  const postId = Number(document.getElementById('commentPost').value);
  const list = document.getElementById('commentList');
  if (!postId) { list.innerHTML = '<div class="muted" style="font-size:13px">先创建一篇文章，才有人留言。</div>'; return; }
  try {
    const data = await api.comments(postId, token);
    list.innerHTML = data.items.length ? data.items.map((c) => `<div class="comment-item">
      <div class="who"><span>${escapeHtml(c.author)}</span><span>${formatDate(c.createdAt)} · ${c.status}</span></div>
      <p>${escapeHtml(c.content)}</p>
      <div class="admin-actions" style="margin-top:10px">
        <button class="mini-btn" data-approve="${c.id}">通过</button>
        <button class="mini-btn" data-pending="${c.id}">待审</button>
        <button class="mini-btn danger" data-delcomment="${c.id}">删除</button>
      </div></div>`).join('')
      : '<div class="muted" style="font-size:13px">这篇文章还没有留言。</div>';

    list.querySelectorAll('[data-approve]').forEach((b) => b.addEventListener('click', () => moderate(Number(b.dataset.approve), 'approved')));
    list.querySelectorAll('[data-pending]').forEach((b) => b.addEventListener('click', () => moderate(Number(b.dataset.pending), 'pending')));
    list.querySelectorAll('[data-delcomment]').forEach((b) => b.addEventListener('click', async () => {
      try { await api.deleteComment(Number(b.dataset.delcomment), token); toast('留言已删除'); loadComments(); loadStats(); }
      catch (error) { toast(error.message); }
    }));
  } catch (error) { toast(error.message); }
}

async function moderate(id, status) {
  try { await api.moderateComment(id, status, token); toast(status === 'approved' ? '留言已通过' : '状态已更新'); loadComments(); loadStats(); }
  catch (error) { toast(error.message); }
}

async function renderDashboard() {
  root.innerHTML = dashboardHtml();
  bindDashboard();
  await Promise.all([loadStats(), loadPosts()]);
  const settings = await api.siteSettings();
  const form = document.getElementById('settingsForm');
  ['name', 'tagline', 'description', 'email', 'icp'].forEach((key) => {
    if (form.elements[key]) form.elements[key].value = settings[key] || '';
  });
  await loadComments();
}

(async () => {
  const live = await api.backendAvailable();
  if (!live) {
    renderLogin(`当前为静态快照模式：连接后端后即可登录管理后台。（${api.lastError || '接口不可用'}）`);
    return;
  }
  if (token) {
    try {
      await api.me(token);
      await renderDashboard();
      return;
    } catch { token = ''; sessionStorage.removeItem(TOKEN_KEY); }
  }
  renderLogin();
})();
