import { api } from './api.js';

const CFG = window.FREEBIRD_CONFIG || {};
export const EMAIL = CFG.EMAIL || 'freebirdflyinthesky@outlook.com';
export const REPO = CFG.REPO || 'https://github.com/hamfreebird/hamfreebird.github.io';
export const SITE = CFG.SITE_NAME || 'freebird的自留地';
const RSS_URL = CFG.API_BASE
  ? `${CFG.API_BASE}/rss.xml${CFG.API_SHARECODE ? `?sharecode=${encodeURIComponent(CFG.API_SHARECODE)}` : ''}`
  : 'rss.xml';

export const birdIcon = (cls = '') => `
<svg class="bird ${cls}" viewBox="0 0 32 32" fill="none" aria-hidden="true">
  <g class="wing left"><path d="M15.4 17.6C11.5 9.3 5.6 6.9 2.7 8.4c3.4.6 5.9 3.7 7.3 7.6.7 2 2.4 3.2 5.4 3.4z" fill="currentColor"/></g>
  <g class="wing right"><path d="M16.6 17.6c3.9-8.3 9.8-10.7 12.7-9.2-3.4.6-5.9 3.7-7.3 7.6-.7 2-2.4 3.2-5.4 3.4z" fill="currentColor" opacity=".68"/></g>
  <path d="M13.8 17.2c1-3.1 3.2-4.1 4.5-1.5 1.3 2.6-.2 7.2-3.3 7.2-2.4 0-3.4-2.1-1.2-5.7z" fill="currentColor"/>
  <circle cx="17.2" cy="14.8" r=".8" fill="#07111c"/>
</svg>`;

export const starIcon = (cls = '') => `
<svg class="star-icon ${cls}" viewBox="0 0 32 32" fill="none" aria-hidden="true">
  <path d="M16 3V29M3 16H29" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>
  <circle cx="16" cy="16" r="2.1" fill="currentColor"/>
  <circle cx="16" cy="16" r=".9" fill="#ffffff"/>
</svg>`;

export const escapeHtml = (value = '') => String(value).replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[c]);

export function formatDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? String(value).slice(0, 10) :
    `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
}

let toastTimer;
export function toast(message) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3000);
}

export function observeReveal() {
  const items = document.querySelectorAll('.reveal:not(.in)');
  if (!('IntersectionObserver' in window)) {
    items.forEach((el) => el.classList.add('in'));
    return;
  }
  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) { entry.target.classList.add('in'); io.unobserve(entry.target); }
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -40px' });
  items.forEach((el) => io.observe(el));
}

function buildSky() {
  const stars = Array.from({ length: 70 }, () => {
    const left = Math.random() * 100;
    const top = Math.random() * 100;
    const dur = (2.5 + Math.random() * 5).toFixed(1);
    return `<i class="star" style="left:${left}%;top:${top}%;--dur:${dur}s;animation-delay:${(Math.random() * 5).toFixed(1)}s"></i>`;
  }).join('');
  const wind = Array.from({ length: 8 }, (_, i) =>
    `<i class="wind" style="top:${8 + i * 11}%;--dur:${(9 + i * 2.2).toFixed(1)}s;--delay:-${(i * 2.7).toFixed(1)}s"></i>`).join('');
  return `<div class="sky" aria-hidden="true"><div class="aurora a1"></div><div class="aurora a2"></div><div class="aurora a3"></div><div class="stars">${stars}</div>${wind}</div><div class="grid-overlay" aria-hidden="true"></div>`;
}

function buildHeader(active) {
  const links = [
    ['home', 'index.html', '首页'],
    ['archive', 'archive.html', '归档'],
    ['about', 'about.html', '关于']
  ];
  return `<header class="site-header" id="siteHeader"><div class="header-inner">
    <a class="brand" href="index.html" aria-label="${SITE}">${starIcon()}<span class="brand-name">freebird<span class="brand-suffix">的自留地</span></span></a>
    <nav class="nav" aria-label="主导航">${links.map(([key, href, label]) =>
      `<a href="${href}" data-nav="${key}" class="${active === key ? 'active' : ''}">${label}</a>`).join('')}</nav>
    <div class="header-actions">
      <button class="icon-btn" id="searchToggle" aria-label="搜索" title="搜索">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>
      </button>
      <a class="admin-link" href="admin.html">管理</a>
    </div>
  </div></header>
  <div class="search-panel" id="searchPanel"><div>
    <div class="search-box">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>
      <input id="searchInput" type="search" placeholder="搜索文章，按 Esc 关闭…" autocomplete="off" aria-label="搜索文章">
    </div>
    <div class="search-results" id="searchResults"></div>
  </div></div>`;
}

function buildFooter() {
  return `<footer class="site-footer"><div class="footer-inner">
    <div class="footer-brand">
      <a class="brand" href="index.html">${starIcon()}<span class="brand-name">freebird<span class="brand-suffix">的自留地</span></span></a>
      <p>fly free · write true<br>一块留给风、文字与自由的空地。</p>
    </div>
    <div class="footer-col"><h4>联络</h4>
      <a href="mailto:${EMAIL}">${EMAIL}</a>
      <a href="${REPO}" target="_blank" rel="noopener">个人仓库 · GitHub ↗</a>
      <a href="${CFG.PAGES || 'https://hamfreebird.github.io'}" target="_blank" rel="noopener">站点首页 ↗</a>
    </div>
    <div class="footer-col"><h4>导航</h4>
      <a href="index.html">首页</a><a href="archive.html">归档</a>
      <a href="about.html">关于</a><a href="admin.html">管理后台</a>
      <a href="${RSS_URL}" id="rssLink">RSS 订阅</a>
    </div>
  </div><div class="footer-bottom">© ${new Date().getFullYear()} freebird · 本站由 GitHub Pages 驱动</div></footer>
  <button class="to-top" id="toTop" aria-label="回到顶部">${birdIcon('bird-small')}</button>
  <div class="toast" id="toast" role="status" aria-live="polite"></div>`;
}

function initLoader() {
  const loader = document.getElementById('loader');
  if (!loader) return;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finish = () => {
    loader.classList.add('done');
    document.body.classList.remove('loading');
    observeReveal();
  };
  if (reduced || sessionStorage.getItem('freebird-loaded')) {
    finish();
  } else {
    sessionStorage.setItem('freebird-loaded', '1');
    setTimeout(finish, 1150);
  }
}

function initSearch() {
  const toggle = document.getElementById('searchToggle');
  const panel = document.getElementById('searchPanel');
  const input = document.getElementById('searchInput');
  const results = document.getElementById('searchResults');
  if (!toggle || !panel) return;
  let timer;
  const close = () => panel.classList.remove('open');
  toggle.addEventListener('click', () => {
    panel.classList.toggle('open');
    if (panel.classList.contains('open')) input.focus();
  });
  document.addEventListener('click', (e) => {
    if (!panel.contains(e.target) && e.target !== toggle) close();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (!q) { results.innerHTML = ''; return; }
    timer = setTimeout(async () => {
      const data = await api.listPosts({ q, limit: 8 });
      results.innerHTML = data.items.length
        ? data.items.map((p) => `<a href="post.html?slug=${encodeURIComponent(p.slug)}">${escapeHtml(p.title)} <span class="dim">· ${formatDate(p.publishedAt)}</span></a>`).join('')
        : '<div style="padding:12px;color:var(--dim);font-size:13px">暂无匹配内容</div>';
    }, 260);
  });
}

function initPageTransitions() {
  const overlay = document.getElementById('pageTransition');
  if (!overlay) return;
  document.addEventListener('click', (event) => {
    const link = event.target.closest('a[href]');
    if (!link || event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    const href = link.getAttribute('href');
    if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:') || link.target === '_blank') return;
    if (!/\.html($|\?)/.test(href) || link.origin && link.origin !== location.origin) return;
    event.preventDefault();
    overlay.classList.add('active');
    setTimeout(() => { location.href = link.href; }, 360);
  });
  window.addEventListener('pageshow', () => overlay.classList.remove('active'));
}

function initFeatherCursor() {
  const canvas = document.getElementById('featherCanvas');
  if (!canvas || !matchMedia('(pointer: fine)').matches || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const ctx = canvas.getContext('2d');
  let w, h, dpr;
  const resize = () => {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = canvas.width = innerWidth * dpr;
    h = canvas.height = innerHeight * dpr;
    canvas.style.width = `${innerWidth}px`;
    canvas.style.height = `${innerHeight}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();
  addEventListener('resize', resize);
  const points = [];
  let mouse = { x: -100, y: -100 }, last = { x: -100, y: -100 };
  addEventListener('pointermove', (e) => {
    mouse = { x: e.clientX, y: e.clientY };
    const speed = Math.hypot(mouse.x - last.x, mouse.y - last.y);
    if (speed > 3 && points.length < 34) {
      points.push({ x: mouse.x, y: mouse.y, life: 1, size: 1.5 + Math.min(speed / 14, 4), angle: Math.atan2(mouse.y - last.y, mouse.x - last.x) });
    }
    last = mouse;
  }, { passive: true });
  const drawFeather = (x, y, angle, size, alpha, color) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(-size, 0);
    ctx.quadraticCurveTo(0, -size * 0.75, size * 1.5, 0);
    ctx.quadraticCurveTo(0, size * 0.75, -size, 0);
    ctx.fill();
    ctx.restore();
  };
  const tick = () => {
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    for (let i = points.length - 1; i >= 0; i--) {
      const p = points[i];
      p.life -= 0.018;
      p.x += Math.sin(p.life * 8 + i) * 0.25;
      p.y -= 0.35;
      if (p.life <= 0) { points.splice(i, 1); continue; }
      drawFeather(p.x, p.y, p.angle, p.size, p.life * 0.45, '#7dd3fc');
    }
    requestAnimationFrame(tick);
  };
  tick();
}

function initMisc() {
  const header = document.getElementById('siteHeader');
  const toTop = document.getElementById('toTop');
  const update = () => {
    if (header) header.classList.toggle('scrolled', scrollY > 20);
    if (toTop) toTop.classList.toggle('show', scrollY > 480);
  };
  addEventListener('scroll', update, { passive: true });
  update();
  toTop?.addEventListener('click', () => scrollTo({ top: 0, behavior: 'smooth' }));

  const heroVisual = document.querySelector('.hero-visual');
  if (heroVisual && matchMedia('(pointer: fine)').matches) {
    addEventListener('pointermove', (e) => {
      heroVisual.style.setProperty('--px', ((e.clientX / innerWidth) - 0.5).toFixed(3));
      heroVisual.style.setProperty('--py', ((e.clientY / innerHeight) - 0.5).toFixed(3));
    }, { passive: true });
  }

  if (document.querySelector('.article-body:not(.preview-body)')) {
    const bar = document.createElement('div');
    bar.className = 'progress';
    bar.innerHTML = birdIcon('bird-small');
    document.body.prepend(bar);
    addEventListener('scroll', () => {
      const height = document.documentElement.scrollHeight - innerHeight;
      bar.style.width = `${height > 0 ? Math.min(100, (scrollY / height) * 100) : 0}%`;
    }, { passive: true });
  }
}

export function mountShell(activePage = '') {
  document.body.insertAdjacentHTML('afterbegin', `<a class="skip-link" href="#main">跳到主内容</a>${buildSky()}`);
  const headerSlot = document.getElementById('shell-header');
  const footerSlot = document.getElementById('shell-footer');
  if (headerSlot) headerSlot.outerHTML = buildHeader(activePage) + `
    <div class="loader" id="loader"><div class="loader-inner">${birdIcon('loader-bird')}
      <div class="loader-title">${SITE}</div><div class="loader-line"></div></div></div>
    <div class="page-transition" id="pageTransition">${birdIcon()}</div>
    <canvas id="featherCanvas" aria-hidden="true"></canvas>`;
  if (footerSlot) footerSlot.outerHTML = buildFooter();
  else document.body.insertAdjacentHTML('beforeend', buildFooter());

  initLoader();
  initSearch();
  initPageTransitions();
  initFeatherCursor();
  initMisc();
  observeReveal();
}
