import { api } from './api.js';
import { mountShell, birdIcon, escapeHtml, formatDate, toast, observeReveal } from './common.js';
import { renderContent } from './markdown.js';
import { cleanHtml } from './editor.js';

mountShell('');
const root = document.getElementById('articleRoot');
const slug = new URLSearchParams(location.search).get('slug') || '';

function commentHtml(c) {
  return `<div class="comment-item reveal">
    <div class="who"><span>${escapeHtml(c.author)}</span><span>${formatDate(c.createdAt)}</span></div>
    <p>${escapeHtml(c.content)}</p>
  </div>`;
}

(async () => {
  if (!slug) {
    root.innerHTML = `<div class="empty">${birdIcon()}<h3>缺少文章标识</h3><p>请从文章列表进入。</p><a class="btn btn-ghost" href="index.html">返回首页</a></div>`;
    return;
  }
  const data = await api.getPost(slug);
  if (!data) {
    root.innerHTML = `<div class="empty">${birdIcon()}<h3>这篇文章飞走了</h3><p>它可能已被删除，或尚未发布。</p><a class="btn btn-ghost" href="archive.html">查看归档</a></div>`;
    return;
  }
  const p = data.post;
  const cover = ['dawn', 'night', 'code', 'autumn'].includes(p.cover) ? p.cover : 'default';
  document.title = `${p.title} · freebird的自留地`;
  root.innerHTML = `
    <header class="article-head reveal">
      <a class="eyebrow" href="archive.html">← 返回归档</a>
      <h1>${escapeHtml(p.title)}</h1>
      <div class="post-meta"><span>${escapeHtml(p.category)}</span><i class="dot"></i>
        <time>${formatDate(p.publishedAt)}</time><i class="dot"></i><span>${p.readMinutes || 3} 分钟阅读</span></div>
    </header>
    <div class="article-cover reveal" data-cover="${cover}"><span class="cover-wing" style="position:absolute;width:280px;height:150px;right:40px;top:70px;border-radius:100% 0 100% 0;background:linear-gradient(120deg,rgba(125,211,252,.32),transparent);transform:rotate(-22deg)"></span></div>
    <div class="article-body reveal">${cleanHtml(renderContent(p.content, p.format))}</div>
    <div class="article-tags">${(p.tags || []).map((t) => `<a class="tag" href="archive.html?tag=${encodeURIComponent(t)}">#${escapeHtml(t)}</a>`).join('')}</div>
    <section class="comments">
      <h3>${birdIcon('bird-small')} 留言 <span class="muted" style="font-size:13px">（${(p.comments || []).length}）</span></h3>
      <form class="comment-form" id="commentForm">
        <div class="row"><input class="input" name="author" placeholder="你的名字" maxlength="40" required>
          <input class="input" name="email" type="email" placeholder="邮箱（可选，不公开）"></div>
        <textarea class="textarea" name="content" placeholder="写下你的想法…" maxlength="1000" required></textarea>
        <div><button class="btn btn-primary" type="submit">送出留言</button>
          <span class="muted" style="font-size:12px;margin-left:12px">留言经审核后显示</span></div>
      </form>
      <div class="comment-list" id="commentList">${(p.comments || []).map(commentHtml).join('') ||
        '<div class="dim" style="font-size:13px">还没有留言，来当第一只飞过的鸟。</div>'}</div>
    </section>`;
  observeReveal();
  if (api.configured) api.recordView(p.id);

  document.getElementById('commentForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!await api.backendAvailable()) return toast('静态站点暂不支持留言，连接后端后即可使用');
    const payload = {
      postId: p.id, author: form.author.value.trim(),
      email: form.email.value.trim(), content: form.content.value.trim()
    };
    try {
      const result = await api.addComment(payload);
      toast(result.message || '留言已提交');
      form.reset();
    } catch (error) { toast(error.message); }
  });
})();
