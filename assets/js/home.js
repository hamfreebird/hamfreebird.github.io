import { api } from './api.js';
import { mountShell, birdIcon, escapeHtml, formatDate, toast, observeReveal } from './common.js';

mountShell('home');
document.getElementById('emptyBird').innerHTML = birdIcon();

const grid = document.getElementById('postGrid');
const empty = document.getElementById('emptyState');
const chip = document.getElementById('sourceChip');
const tagBar = document.getElementById('tagBar');
let activeTag = '';

function card(p, index) {
  const cover = ['dawn', 'night', 'code', 'autumn'].includes(p.cover) ? p.cover : 'default';
  return `<article class="post-card reveal" data-delay="${index % 3}">
    <a href="post.html?slug=${encodeURIComponent(p.slug)}" class="cover" data-cover="${cover}">
      <span class="cover-wing"></span><span class="cover-bird">${birdIcon('bird-small')}</span>
    </a>
    <div class="post-body">
      <div class="post-meta"><span>${escapeHtml(p.category || '随笔')}</span><i class="dot"></i><time>${formatDate(p.publishedAt)}</time></div>
      <h3><a href="post.html?slug=${encodeURIComponent(p.slug)}">${escapeHtml(p.title)}</a></h3>
      <p>${escapeHtml(p.excerpt || '暂无摘要')}</p>
      <div class="post-tags">${(p.tags || []).slice(0, 3).map((t) => `<a class="tag" href="archive.html?tag=${encodeURIComponent(t)}">#${escapeHtml(t)}</a>`).join('')}</div>
      <div class="post-foot"><span>${p.readMinutes || 3} 分钟阅读 · ${p.views || 0} 次阅读</span>
        <a class="read-more" href="post.html?slug=${encodeURIComponent(p.slug)}">读下去
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14m-6-6 6 6-6 6"/></svg>
        </a>
      </div>
    </div>
  </article>`;
}

async function loadPosts() {
  const params = { page: 1, limit: 6 };
  if (activeTag) params.tag = activeTag;
  const data = await api.listPosts(params);
  grid.innerHTML = data.items.map(card).join('');
  empty.hidden = data.items.length > 0;
  chip.innerHTML = data.source === 'backend'
    ? '<span class="status-chip live"><i></i> 实时数据 · 后端已连接</span>'
    : '<span class="status-chip">静态快照模式 · 连接后端后自动切换</span>';
  observeReveal();
}

function countUp(el, target) {
  const start = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - start) / 900);
    el.textContent = Math.round(target * (1 - Math.pow(1 - t, 3))).toLocaleString();
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

(async () => {
  await loadPosts();
  const [stats, tags] = await Promise.all([api.stats(), api.tags()]);
  if (stats) {
    countUp(document.getElementById('statPosts'), stats.posts);
    countUp(document.getElementById('statViews'), stats.views);
    countUp(document.getElementById('statComments'), stats.approvedComments);
  } else {
    ['statPosts', 'statViews', 'statComments'].forEach((id) => { document.getElementById(id).textContent = '—'; });
  }
  if (tags.length) {
    tagBar.innerHTML = `<span class="muted" style="font-size:12px">标签</span>` +
      tags.slice(0, 8).map((t) => `<button class="tag ${activeTag === t.name ? 'active' : ''}" data-tag="${escapeHtml(t.name)}">#${escapeHtml(t.name)} · ${t.count}</button>`).join('') +
      (activeTag ? '<button class="tag" data-tag="">全部</button>' : '');
    tagBar.querySelectorAll('[data-tag]').forEach((btn) => btn.addEventListener('click', () => {
      activeTag = btn.dataset.tag;
      tagBar.querySelectorAll('[data-tag]').forEach((b) => b.classList.toggle('active', b.dataset.tag === activeTag));
      loadPosts();
    }));
  }

  document.getElementById('subscribeForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!await api.backendAvailable()) return toast('静态站点暂不支持订阅，连接后端后即可使用');
    try {
      const data = await api.subscribe(form.email.value);
      toast(data.message || '订阅成功');
      form.reset();
    } catch (error) { toast(error.message); }
  });
})();
