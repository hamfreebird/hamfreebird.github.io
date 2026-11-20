import { api } from './api.js';
import { mountShell, observeReveal } from './common.js';

mountShell('about');
observeReveal();

(async () => {
  const stats = await api.stats();
  const values = stats
    ? { posts: stats.posts, views: stats.views, comments: stats.approvedComments, subscribers: stats.subscribers }
    : { posts: '—', views: '—', comments: '—', subscribers: '—' };
  document.querySelectorAll('[data-stat]').forEach((el) => {
    const key = el.dataset.stat;
    const target = Number(values[key]);
    if (!Number.isFinite(target)) { el.textContent = values[key]; return; }
    const start = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - start) / 800);
      el.textContent = Math.round(target * (1 - Math.pow(1 - t, 3))).toLocaleString();
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
})();
