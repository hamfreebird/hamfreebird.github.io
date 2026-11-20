const CFG = window.FREEBIRD_CONFIG || {};
const BASE = (CFG.API_BASE || '').replace(/\/$/, '');
const SHARECODE = CFG.API_SHARECODE || '';
let source = BASE ? 'backend' : 'static';
let snapshotPromise = null;
let availability = null;
let lastError = '';

async function request(path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9000);
  try {
    const headers = { Accept: 'application/json', ...(options.headers || {}) };
    if (options.body && typeof options.body !== 'string') {
      headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(options.body);
    }
    const target = new URL(BASE + path, location.href);
    if (SHARECODE) target.searchParams.set('sharecode', SHARECODE);
    const res = await fetch(target.toString(), { ...options, headers, signal: controller.signal });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { throw new Error(`服务端返回了非 JSON 内容（${res.status}）`); }
    if (!res.ok || data.ok === false) throw new Error(data.error || `请求失败（${res.status}）`);
    source = 'backend';
    return data;
  } finally {
    clearTimeout(timer);
  }
}

function snapshot() {
  if (!snapshotPromise) {
    snapshotPromise = fetch('content/posts.json').then((r) => r.json()).catch(() => ({ site: {}, posts: [] }));
  }
  return snapshotPromise;
}

function staticList(params) {
  return snapshot().then(({ posts = [] }) => {
    const q = (params.q || '').trim().toLowerCase();
    const tag = params.tag || '';
    const category = params.category || '';
    let items = posts.filter((p) => p.status === 'published');
    if (q) items = items.filter((p) => `${p.title} ${p.excerpt} ${(p.tags || []).join(' ')}`.toLowerCase().includes(q));
    if (tag) items = items.filter((p) => (p.tags || []).includes(tag));
    if (category) items = items.filter((p) => p.category === category);
    items = [...items].sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)));
    const page = Number(params.page) || 1;
    const limit = Number(params.limit) || 8;
    return {
      items: items.slice((page - 1) * limit, page * limit),
      total: items.length, page, pages: Math.max(1, Math.ceil(items.length / limit)), source: 'static'
    };
  });
}

export const api = {
  get source() { return source; },
  get configured() { return Boolean(BASE) || availability === true; },

  /** 探测 API 是否可用：显式配置优先，否则尝试同源接口（GitHub Pages 会失败并回退）。 */
  async backendAvailable() {
    if (BASE) return true;
    if (availability !== null) return availability;
    try {
      await request('/api/health');
      availability = true;
    } catch (error) {
      lastError = error.message || '接口不可用';
      availability = false;
    }
    return availability;
  },
  get lastError() { return lastError; },

  async siteSettings() {
    try { return (await request('/api/settings')).settings; }
    catch { return (await snapshot()).site || {}; }
  },

  async listPosts(params = {}, token = '') {
    const query = new URLSearchParams(params).toString();
    try {
      return await request(`/api/posts${query ? `?${query}` : ''}`,
        token ? { headers: { Authorization: `Bearer ${token}` } } : {});
    } catch { source = 'static'; return staticList(params); }
  },

  async getPost(slug) {
    try { return await request(`/api/posts/${encodeURIComponent(slug)}`); }
    catch {
      const { posts = [] } = await snapshot();
      const post = posts.find((p) => p.slug === slug);
      return post ? { post: { ...post, comments: [] } } : null;
    }
  },

  async stats() {
    try { return (await request('/api/stats')).stats; }
    catch { return null; }
  },

  async tags() {
    try { return (await request('/api/tags')).tags; }
    catch {
      const { posts = [] } = await snapshot();
      const counts = new Map();
      posts.forEach((p) => (p.tags || []).forEach((t) => counts.set(t, (counts.get(t) || 0) + 1)));
      return [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
    }
  },

  async login(username, password) {
    return request('/api/auth/login', { method: 'POST', body: { username, password } });
  },
  async me(token) {
    return request('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } });
  },
  async createPost(data, token) {
    return request('/api/posts', { method: 'POST', body: data, headers: { Authorization: `Bearer ${token}` } });
  },
  async updatePost(id, data, token) {
    return request(`/api/posts/${id}`, { method: 'PUT', body: data, headers: { Authorization: `Bearer ${token}` } });
  },
  async deletePost(id, token) {
    return request(`/api/posts/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
  },
  async recordView(id) {
    try { await request(`/api/posts/${id}/view`, { method: 'POST' }); } catch { /* 阅读数非关键路径 */ }
  },
  async addComment(data) {
    return request('/api/comments', { method: 'POST', body: data });
  },
  async comments(postId, token) {
    return request(`/api/comments?postId=${postId}`, { headers: { Authorization: `Bearer ${token}` } });
  },
  async moderateComment(id, status, token) {
    return request(`/api/comments/${id}`, { method: 'PATCH', body: { status }, headers: { Authorization: `Bearer ${token}` } });
  },
  async deleteComment(id, token) {
    return request(`/api/comments/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
  },
  async subscribe(email) {
    return request('/api/subscribe', { method: 'POST', body: { email } });
  },
  async changePassword(password, token) {
    return request('/api/admin/password', { method: 'POST', body: { password }, headers: { Authorization: `Bearer ${token}` } });
  },
  async backup(token) {
    return request('/api/backup', { headers: { Authorization: `Bearer ${token}` } });
  },
  async updateSettings(data, token) {
    return request('/api/settings', { method: 'PUT', body: data, headers: { Authorization: `Bearer ${token}` } });
  }
};
