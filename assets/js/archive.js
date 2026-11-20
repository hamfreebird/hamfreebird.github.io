import { api } from './api.js';
import { mountShell, birdIcon, escapeHtml, formatDate, observeReveal } from './common.js';

mountShell('archive');
document.getElementById('archiveBird').innerHTML = birdIcon();
const list = document.getElementById('archiveList');
const empty = document.getElementById('archiveEmpty');
const tagBar = document.getElementById('tagBar');
const pagination = document.getElementById('pagination');
const params = new URLSearchParams(location.search);
let activeTag = params.get('tag') || '';
let page = 1;

function row(p) {
  return `<a class="archive-item reveal" href="post.html?slug=${encodeURIComponent(p.slug)}">
    <time>${formatDate(p.publishedAt)}</time>
    <div><h3>${escapeHtml(p.title)}</h3>
      <div class="post-meta" style="margin-top:6px"><span>${escapeHtml(p.category)}</span>
        ${(p.tags || []).slice(0, 3).map((t) => `<span>· #${escapeHtml(t)}</span>`).join('')}</div></div>
    <span class="arrow">${p.readMinutes || 3} min →</span>
  </a>`;
}

async function load() {
  const data = await api.listPosts({ page, limit: 10, tag: activeTag });
  list.innerHTML = data.items.map(row).join('');
  empty.hidden = data.items.length > 0;
  pagination.innerHTML = data.pages > 1
    ? `<button class="mini-btn" data-page="${page - 1}" ${page === 1 ? 'disabled' : ''}>← 上一页</button>
       <span class="muted" style="padding:6px 12px;font-size:13px">${page} / ${data.pages}</span>
       <button class="mini-btn" data-page="${page + 1}" ${page === data.pages ? 'disabled' : ''}>下一页 →</button>`
    : '';
  pagination.querySelectorAll('[data-page]').forEach((btn) => btn.addEventListener('click', () => {
    page = Number(btn.dataset.page);
    load();
    scrollTo({ top: 220, behavior: 'smooth' });
  }));
  observeReveal();
}

(async () => {
  const tags = await api.tags();
  const renderTags = () => {
    tagBar.innerHTML = `<span class="muted" style="font-size:12px">标签筛选</span>
      <button class="tag ${!activeTag ? 'active' : ''}" data-tag="">全部</button>` +
      tags.map((t) => `<button class="tag ${activeTag === t.name ? 'active' : ''}" data-tag="${escapeHtml(t.name)}">#${escapeHtml(t.name)} · ${t.count}</button>`).join('');
    tagBar.querySelectorAll('[data-tag]').forEach((btn) => btn.addEventListener('click', () => {
      activeTag = btn.dataset.tag;
      page = 1;
      history.replaceState(null, '', activeTag ? `?tag=${encodeURIComponent(activeTag)}` : location.pathname);
      renderTags();
      load();
    }));
  };
  renderTags();
  await load();
})();
