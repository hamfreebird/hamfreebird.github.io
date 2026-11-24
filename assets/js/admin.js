import { api } from './api.js';
import { mountShell, birdIcon, escapeHtml, formatDate, toast } from './common.js';
import { initEditor } from './editor.js';

mountShell('');
const root = document.getElementById('adminRoot');
const TOKEN_KEY = 'freebird_admin_token';
const DRAFT_KEY = 'freebird_admin_draft';
let token = sessionStorage.getItem(TOKEN_KEY) || '';
let posts = [];
let editorApi = null;
let editingId = null;
let postPage = 1;
let initializing = false;
let autosaveTimer = null;

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
  return `<div class="admin-head">
    <div><div class="eyebrow">Control tower</div><h1>管理后台</h1></div>
    <div style="display:flex;gap:10px;flex-wrap:wrap">
      <a class="btn btn-ghost" href="index.html">查看站点</a>
      <button class="btn btn-ghost" id="logoutBtn">退出登录</button>
    </div>
  </div>
  <div class="admin-stats" id="adminStats">
    <div class="stat"><strong data-admin="posts">—</strong><small>全部文章</small></div>
    <div class="stat"><strong data-admin="published">—</strong><small>已发布</small></div>
    <div class="stat"><strong data-admin="pendingComments">—</strong><small>待审留言</small></div>
    <div class="stat"><strong data-admin="views">—</strong><small>累计阅读</small></div>
  </div>

  <section class="admin-panel">
    <div class="draft-notice" id="draftNotice" hidden>
      <span id="draftTime"></span>
      <button type="button" class="mini-btn" id="restoreDraft">恢复草稿</button>
      <button type="button" class="mini-btn danger" id="discardDraft">丢弃</button>
    </div>
    <h2 id="editorTitle">写新文章</h2>
    <form class="editor" id="postEditor">
      <div class="row"><label>标题<input class="input" name="title" maxlength="200" required placeholder="文章标题"></label>
        <label>Slug（留空自动生成）<input class="input" name="slug" maxlength="60" placeholder="my-post"></label></div>
      <div class="row"><label>分类<input class="input" name="category" maxlength="40" value="随笔" list="categoryOptions"></label>
        <datalist id="categoryOptions"><option value="随笔"><option value="技术"><option value="生活"><option value="城市"></datalist>
        <label>标签（英文逗号分隔）<input class="input" name="tags" maxlength="200" placeholder="自由, 生活"></label></div>
      <div class="row"><label>封面<select class="select" name="cover">
        <option value="dawn">dawn · 晨光</option><option value="night">night · 夜色</option>
        <option value="code">code · 代码</option><option value="autumn">autumn · 秋日</option>
        <option value="default">default · 默认</option></select></label>
        <label>阅读分钟数（留空自动估算）<input class="input" name="readMinutes" type="number" min="1" max="180" value="3"></label></div>
      <div class="row"><label>状态<select class="select" name="status">
        <option value="published">已发布</option><option value="draft">草稿</option></select></label>
        <label style="display:flex;align-items:center;gap:8px;align-self:end;padding-bottom:12px">
          <input type="checkbox" name="featured" style="accent-color:var(--teal)"> 设为精选</label></div>
      <label>摘要<textarea class="textarea" name="excerpt" maxlength="300" style="min-height:70px" placeholder="留空可由正文自动生成"></textarea></label>

      <div class="editor-block">
        <div class="editor-bar">
          <div class="editor-modes">
            <button type="button" class="mini-btn active" data-editor-mode="visual">可视化</button>
            <button type="button" class="mini-btn" data-editor-mode="markdown">Markdown</button>
            <button type="button" class="mini-btn" data-editor-mode="source">HTML 源码</button>
            <button type="button" class="mini-btn" data-editor-mode="preview">预览</button>
          </div>
          <div class="editor-toolbar" id="editorToolbar">
            <button type="button" class="mini-btn" data-cmd="block:p">正文</button>
            <button type="button" class="mini-btn" data-cmd="block:h2">H2</button>
            <button type="button" class="mini-btn" data-cmd="block:h3">H3</button>
            <button type="button" class="mini-btn" data-cmd="bold"><b>B</b></button>
            <button type="button" class="mini-btn" data-cmd="italic"><i>I</i></button>
            <button type="button" class="mini-btn" data-cmd="underline">U</button>
            <button type="button" class="mini-btn" data-cmd="strikeThrough">S</button>
            <button type="button" class="mini-btn" data-cmd="block:blockquote">引用</button>
            <button type="button" class="mini-btn" data-cmd="insertUnorderedList">列表</button>
            <button type="button" class="mini-btn" data-cmd="insertOrderedList">编号</button>
            <button type="button" class="mini-btn" data-cmd="link">链接</button>
            <button type="button" class="mini-btn" data-cmd="image">图片</button>
            <button type="button" class="mini-btn" data-cmd="code">代码</button>
            <button type="button" class="mini-btn" data-cmd="hr">分隔</button>
            <button type="button" class="mini-btn" data-cmd="clear">清除格式</button>
          </div>
        </div>
        <div class="editor-surface">
          <div class="editor-visual article-body" id="editorVisual" contenteditable="true" data-placeholder="从这里开始写…"></div>
          <textarea class="editor-source editor-markdown" id="editorMarkdown" spellcheck="false" placeholder="# 用 Markdown 写作…&#10;&#10;支持标题、列表、引用、代码块与表格" hidden></textarea>
          <textarea class="editor-source" id="editorSource" spellcheck="false" placeholder="<p>也可以直接粘贴 HTML…</p>" hidden></textarea>
          <div class="editor-preview article-body preview-body" id="editorPreview" hidden></div>
        </div>
        <div class="editor-status">
          <span>字数 <b id="editorWords">0</b></span>
          <span>预计阅读 <b id="editorMinutes">1 分钟</b></span>
          <button type="button" class="mini-btn" id="generateExcerpt">从正文生成摘要</button>
        </div>
      </div>

      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button class="btn btn-primary" type="submit">保存文章</button>
        <button class="btn btn-ghost" type="button" id="resetEditor">清空编辑器</button>
      </div>
    </form>
  </section>

  <section class="admin-panel">
    <h2>文章管理</h2>
    <div class="admin-toolbar">
      <input class="input" id="postSearch" placeholder="搜索标题、摘要或正文…">
      <select class="select" id="postStatusFilter">
        <option value="all">全部状态</option><option value="published">已发布</option><option value="draft">草稿</option>
      </select>
      <button class="mini-btn" id="postFilterBtn">筛选</button>
    </div>
    <table class="admin-table"><thead><tr><th>标题</th><th>分类</th><th>状态</th><th>发布时间</th><th>阅读</th><th>操作</th></tr></thead>
      <tbody id="postRows"></tbody></table>
    <div class="admin-pager" id="postPager"></div>
  </section>

  <section class="admin-panel">
    <h2>留言审核</h2>
    <div class="admin-toolbar">
      <select class="select" id="commentPost"></select>
      <select class="select" id="commentStatus">
        <option value="all">全部状态</option><option value="pending">待审</option>
        <option value="approved">已通过</option><option value="spam">垃圾</option>
      </select>
      <button class="mini-btn" id="refreshComments">刷新</button>
      <button class="mini-btn" id="selectAllComments">全选</button>
      <button class="mini-btn" id="bulkApprove">批量通过</button>
      <button class="mini-btn danger" id="bulkDeleteComments">批量删除</button>
    </div>
    <div id="commentList" class="comment-list"></div>
  </section>

  <section class="admin-panel"><h2>站点设置</h2>
    <form class="editor" id="settingsForm">
      <div class="row"><label>站点名称<input class="input" name="name"></label><label>标语<input class="input" name="tagline"></label></div>
      <label>描述<input class="input" name="description"></label>
      <div class="row"><label>邮箱<input class="input" name="email" type="email"></label><label>ICP 备案（可选）<input class="input" name="icp"></label></div>
      <button class="btn btn-primary" type="submit" style="justify-self:start">保存设置</button>
    </form>
  </section>

  <section class="admin-panel"><h2>安全与数据</h2>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:30px">
      <form class="editor" id="passwordForm">
        <label>修改管理员密码（至少 8 位）<input class="input" name="password" type="password" minlength="8" required></label>
        <button class="btn btn-ghost" type="submit" style="justify-self:start">更新密码</button>
      </form>
      <div>
        <p class="muted" style="margin-top:0">导出全部文章、评论、设置与订阅数据为 JSON 备份。</p>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <button class="btn btn-ghost" id="backupBtn">下载备份</button>
          <button class="btn btn-ghost" id="importBtn">从备份恢复</button>
          <input type="file" id="importFile" accept="application/json,.json" hidden>
        </div>
        <p class="import-note">恢复会覆盖现有文章、评论、设置与订阅；管理员账号与密码不受影响。</p>
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:14px">
          <button class="btn btn-ghost" id="snapshotBtn">立即生成快照</button>
          <button class="btn btn-ghost" id="restoreLatestBtn">从最近快照恢复</button>
        </div>
        <p class="import-note" id="snapshotNote">自动快照：读取中…</p>
      </div>
    </div>
  </section>`;
}

function field(name) {
  return document.querySelector(`#postEditor [name="${name}"]`);
}

function editorValues() {
  const tags = (field('tags')?.value || '').split(',').map((s) => s.trim()).filter(Boolean);
  return {
    title: (field('title')?.value || '').trim(),
    slug: (field('slug')?.value || '').trim(),
    category: (field('category')?.value || '').trim() || '随笔',
    tags,
    cover: field('cover')?.value || 'dawn',
    readMinutes: Number(field('readMinutes')?.value) || 1,
    status: field('status')?.value || 'draft',
    featured: Boolean(field('featured')?.checked),
    excerpt: (field('excerpt')?.value || '').trim(),
    ...(editorApi?.getContent() || { content: '', format: 'markdown' })
  };
}

function showDraftNotice() {
  const notice = document.getElementById('draftNotice');
  if (!notice) return;
  const raw = localStorage.getItem(DRAFT_KEY);
  notice.hidden = !raw;
  if (raw) {
    try {
      const draft = JSON.parse(raw);
      document.getElementById('draftTime').textContent =
        `发现 ${new Date(draft.at).toLocaleString('zh-CN', { hour12: false })} 的未保存草稿`;
    } catch { notice.hidden = true; }
  }
}

function saveDraft() {
  if (initializing) return;
  const values = editorValues();
  localStorage.setItem(DRAFT_KEY, JSON.stringify({ values, editingId, at: Date.now() }));
  showDraftNotice();
}

function clearDraft() {
  localStorage.removeItem(DRAFT_KEY);
  const notice = document.getElementById('draftNotice');
  if (notice) notice.hidden = true;
}

function debounceSave() {
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(saveDraft, 700);
}

let slugTouched = false;
function fillEditor(p) {
  initializing = true;
  editingId = p?.id || null;
  field('title').value = p?.title || '';
  field('slug').value = p?.slug || '';
  field('category').value = p?.category || '随笔';
  field('tags').value = (p?.tags || []).join(', ');
  field('cover').value = p?.cover || 'dawn';
  field('readMinutes').value = p?.readMinutes || 3;
  field('readMinutes').dataset.touched = p ? '1' : '';
  field('status').value = p?.status || 'published';
  field('featured').checked = Boolean(p?.featured);
  field('excerpt').value = p?.excerpt || '';
  slugTouched = Boolean(p);
  editorApi?.setContent(p?.content || '', p?.format || '');
  editorApi?.setMode(p?.format === 'html' ? 'visual' : 'markdown');
  document.getElementById('editorTitle').textContent = p ? `编辑文章 · ${p.title}` : '写新文章';
  initializing = false;
  document.getElementById('postEditor')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function autoSlug() {
  if (slugTouched || editingId) return;
  const base = (field('title').value || '').toLowerCase()
    .replace(/[^\w\u4e00-\u9fa5]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  field('slug').value = base || '';
  debounceSave();
}

function postUrl(p) {
  const base = (window.FREEBIRD_CONFIG?.PAGES || '').replace(/\/$/, '');
  return `${base}/post.html?slug=${encodeURIComponent(p.slug)}`;
}

function bindDashboard() {
  const form = document.getElementById('postEditor');
  form.addEventListener('input', (event) => {
    if (event.target.name === 'title') autoSlug();
    debounceSave();
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = editorValues();
    if (!data.content) return toast('请先写下正文');
    try {
      if (editingId) await api.updatePost(editingId, data, token);
      else await api.createPost(data, token);
      toast(editingId ? '文章已更新' : '文章已创建');
      clearDraft();
      fillEditor(null);
      await Promise.all([loadPosts(postPage), loadStats()]);
    } catch (error) { toast(error.message); }
  });

  document.getElementById('resetEditor').addEventListener('click', () => {
    if (!confirm('清空当前编辑内容并丢弃本地草稿？')) return;
    fillEditor(null);
    clearDraft();
    toast('编辑器已清空');
  });

  document.getElementById('restoreDraft').addEventListener('click', () => {
    try {
      const draft = JSON.parse(localStorage.getItem(DRAFT_KEY));
      if (!draft) return;
      fillEditor({ ...draft.values, id: draft.editingId });
      toast('草稿已恢复');
    } catch { toast('草稿格式不正确'); }
  });
  document.getElementById('discardDraft').addEventListener('click', () => { clearDraft(); toast('草稿已丢弃'); });

  document.getElementById('logoutBtn').addEventListener('click', () => {
    sessionStorage.removeItem(TOKEN_KEY);
    token = '';
    renderLogin('已安全退出');
  });

  document.getElementById('settingsForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
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

  document.getElementById('importBtn').addEventListener('click', () => document.getElementById('importFile').click());  document.getElementById('importFile').addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!['posts', 'comments', 'settings', 'subscribers'].some((k) => Array.isArray(data[k]))) {
        throw new Error('这不是有效的备份文件');
      }
      if (!confirm('恢复备份会覆盖现有文章、评论、设置与订阅，确定继续吗？')) return;
      const result = await api.importBackup(data, token);
      toast(result.message || '备份已恢复');
      await Promise.all([loadPosts(1), loadStats(), loadComments()]);
    } catch (error) { toast(error.message); }
    event.target.value = '';
  });

  document.getElementById('snapshotBtn').addEventListener('click', async () => {
    try {
      const result = await api.snapshotNow(token);
      toast(`快照已生成（${result.latestPosts} 篇文章）`);
      renderSnapshotInfo(result);
    } catch (error) { toast(error.message); }
  });

  document.getElementById('restoreLatestBtn').addEventListener('click', async () => {
    if (!confirm('从最近一次快照恢复会覆盖现有文章、评论、设置与订阅，确定继续吗？')) return;
    try {
      const result = await api.restoreLatest(token);
      toast(`已从快照恢复 ${result.counts.posts} 篇文章`);
      await Promise.all([loadPosts(1), loadStats(), loadComments()]);
      loadSnapshotInfo();
    } catch (error) { toast(error.message); }
  });

  document.getElementById('postFilterBtn').addEventListener('click', () => { postPage = 1; loadPosts(1); });
  document.getElementById('postSearch').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { postPage = 1; loadPosts(1); }
  });
  document.getElementById('commentStatus').addEventListener('change', loadComments);
  document.getElementById('refreshComments').addEventListener('click', loadComments);
  document.getElementById('commentPost').addEventListener('change', loadComments);
  document.getElementById('selectAllComments').addEventListener('click', () => {
    const boxes = [...document.querySelectorAll('#commentList [data-check]')];
    const all = boxes.length > 0 && boxes.every((b) => b.checked);
    boxes.forEach((b) => { b.checked = !all; });
  });
  document.getElementById('bulkApprove').addEventListener('click', () => bulkModerate('approved'));
  document.getElementById('bulkDeleteComments').addEventListener('click', () => bulkModerate('delete'));
}

function renderSnapshotInfo(info) {
  const note = document.getElementById('snapshotNote');
  if (!note || !info) return;
  const at = info.latestAt ? formatDate(info.latestAt) : '暂无';
  note.textContent = `自动快照：共 ${info.files || 0} 份，最近 ${at}，含 ${info.latestPosts || 0} 篇文章 · 数据目录 ${info.dataDir || '未知'}`;
}

async function loadSnapshotInfo() {
  const note = document.getElementById('snapshotNote');
  if (!note) return;
  try { renderSnapshotInfo(await api.snapshotInfo(token)); }
  catch (error) { note.textContent = `自动快照信息不可用：${error.message}`; }
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

async function loadPosts(page = 1) {
  const q = document.getElementById('postSearch').value.trim();
  const status = document.getElementById('postStatusFilter').value;
  const data = await api.listPosts({ page, limit: 10, q, status }, token);
  posts = data.items || [];
  const rows = document.getElementById('postRows');
  rows.innerHTML = posts.length ? posts.map((p) => `<tr>
    <td><strong>${escapeHtml(p.title)}</strong><br><span class="dim">/${escapeHtml(p.slug)}</span></td>
    <td class="dim">${escapeHtml(p.category)}</td>
    <td><span class="status-chip ${p.status === 'published' ? 'live' : ''}">${p.status === 'published' ? '已发布' : '草稿'}${p.featured ? ' · 精选' : ''}</span></td>
    <td class="dim">${formatDate(p.publishedAt)}</td><td>${p.views || 0}</td>
    <td><div class="admin-actions">
      <button class="mini-btn" data-edit="${p.id}">编辑</button>
      <a class="mini-btn" href="${postUrl(p)}" target="_blank" rel="noopener">查看</a>
      <button class="mini-btn" data-copy="${p.id}">复制链接</button>
      <button class="mini-btn" data-toggle="${p.id}" data-status="${p.status}">${p.status === 'published' ? '转草稿' : '发布'}</button>
      <button class="mini-btn danger" data-delete="${p.id}">删除</button>
    </div></td></tr>`).join('')
    : '<tr><td colspan="6" class="muted">没有匹配的文章，调整筛选条件或新建一篇。</td></tr>';

  rows.querySelectorAll('[data-edit]').forEach((btn) => btn.addEventListener('click', () => {
    fillEditor(posts.find((p) => p.id === Number(btn.dataset.edit)));
  }));
  rows.querySelectorAll('[data-copy]').forEach((btn) => btn.addEventListener('click', async () => {
    const p = posts.find((item) => item.id === Number(btn.dataset.copy));
    try { await navigator.clipboard.writeText(postUrl(p)); toast('文章链接已复制'); }
    catch { prompt('复制文章链接', postUrl(p)); }
  }));
  rows.querySelectorAll('[data-toggle]').forEach((btn) => btn.addEventListener('click', async () => {
    const id = Number(btn.dataset.toggle);
    const next = btn.dataset.status === 'published' ? 'draft' : 'published';
    try {
      await api.updatePost(id, { status: next }, token);
      toast(next === 'published' ? '已发布' : '已转为草稿');
      await Promise.all([loadPosts(data.page), loadStats()]);
    } catch (error) { toast(error.message); }
  }));
  rows.querySelectorAll('[data-delete]').forEach((btn) => btn.addEventListener('click', async () => {
    if (!confirm('确定删除这篇文章及其全部留言吗？此操作不可撤销。')) return;
    try {
      await api.deletePost(Number(btn.dataset.delete), token);
      toast('文章已删除');
      if (editingId === Number(btn.dataset.delete)) fillEditor(null);
      await Promise.all([loadPosts(data.page), loadStats()]);
    } catch (error) { toast(error.message); }
  }));

  const pager = document.getElementById('postPager');
  pager.innerHTML = data.pages > 1 ? `
    <button class="mini-btn" data-page="${data.page - 1}" ${data.page === 1 ? 'disabled' : ''}>上一页</button>
    <span>${data.page} / ${data.pages} · 共 ${data.total} 篇</span>
    <button class="mini-btn" data-page="${data.page + 1}" ${data.page === data.pages ? 'disabled' : ''}>下一页</button>` : '';
  pager.querySelectorAll('[data-page]').forEach((btn) => btn.addEventListener('click', () => {
    postPage = Number(btn.dataset.page);
    loadPosts(postPage);
  }));

  const select = document.getElementById('commentPost');
  const previous = select.value;
  select.innerHTML = posts.map((p) => `<option value="${p.id}">${escapeHtml(p.title)}</option>`).join('') ||
    '<option value="">暂无文章</option>';
  if (previous && posts.some((p) => String(p.id) === previous)) select.value = previous;
}

async function loadComments() {
  const postId = Number(document.getElementById('commentPost').value);
  const statusFilter = document.getElementById('commentStatus').value;
  const list = document.getElementById('commentList');
  if (!postId) { list.innerHTML = '<div class="muted" style="font-size:13px">先创建一篇文章，才有人留言。</div>'; return; }
  try {
    const data = await api.comments(postId, token);
    const items = data.items.filter((c) => statusFilter === 'all' || c.status === statusFilter);
    list.innerHTML = items.length ? items.map((c) => `<div class="comment-item">
      <label style="display:flex;gap:10px;align-items:flex-start">
        <input type="checkbox" class="check" data-check="${c.id}" style="margin-top:4px">
        <span style="flex:1">
          <span class="who"><span>${escapeHtml(c.author)}</span><span>${formatDate(c.createdAt)} · ${c.status}</span></span>
          <span style="display:block;color:var(--muted);font-size:14px">${escapeHtml(c.content)}</span>
        </span>
      </label>
      <div class="admin-actions" style="margin-top:10px;margin-left:26px">
        <button class="mini-btn" data-approve="${c.id}">通过</button>
        <button class="mini-btn" data-pending="${c.id}">待审</button>
        <button class="mini-btn danger" data-delcomment="${c.id}">删除</button>
      </div></div>`).join('')
      : '<div class="muted" style="font-size:13px">当前筛选条件下没有留言。</div>';

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

async function bulkModerate(action) {
  const ids = [...document.querySelectorAll('#commentList [data-check]:checked')].map((b) => Number(b.dataset.check));
  if (!ids.length) return toast('请先勾选留言');
  if (action === 'delete' && !confirm(`确定删除选中的 ${ids.length} 条留言吗？`)) return;
  try {
    for (const id of ids) {
      if (action === 'delete') await api.deleteComment(id, token);
      else await api.moderateComment(id, action, token);
    }
    toast(action === 'delete' ? '留言已批量删除' : '留言已批量通过');
    await Promise.all([loadComments(), loadStats()]);
  } catch (error) { toast(error.message); }
}

async function renderDashboard() {
  root.innerHTML = dashboardHtml();
  editorApi = initEditor({ onInput: debounceSave });
  bindDashboard();
  await Promise.all([loadStats(), loadPosts(1)]);
  const settings = await api.siteSettings();
  const form = document.getElementById('settingsForm');
  ['name', 'tagline', 'description', 'email', 'icp'].forEach((key) => {
    if (form.elements[key]) form.elements[key].value = settings[key] || '';
  });
  showDraftNotice();
  loadSnapshotInfo();
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
