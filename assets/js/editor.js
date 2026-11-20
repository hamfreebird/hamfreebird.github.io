// 文章编辑器：可视化 / HTML 源码双模式 + 实时预览 + 格式工具栏
const attr = (value = '') => String(value).replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[c]);

export function cleanHtml(html = '') {
  const tpl = document.createElement('template');
  tpl.innerHTML = String(html);
  tpl.content.querySelectorAll('script, iframe, object, embed, style, link').forEach((el) => el.remove());
  tpl.content.querySelectorAll('*').forEach((el) => {
    [...el.attributes].forEach((a) => {
      if (/^on/i.test(a.name) || (/^(href|src)$/i.test(a.name) && /^\s*javascript:/i.test(a.value))) {
        el.removeAttribute(a.name);
      }
    });
  });
  return tpl.innerHTML;
}

export function plainText(html = '') {
  const el = document.createElement('div');
  el.innerHTML = cleanHtml(html);
  return (el.textContent || '').replace(/\s+/g, ' ').trim();
}

export function estimateMinutes(html = '') {
  const count = plainText(html).replace(/\s/g, '').length;
  return Math.max(1, Math.round(count / 320));
}

export function initEditor({ onInput = () => {} } = {}) {
  const visual = document.getElementById('editorVisual');
  const source = document.getElementById('editorSource');
  const preview = document.getElementById('editorPreview');
  const toolbar = document.getElementById('editorToolbar');
  const modeButtons = [...document.querySelectorAll('[data-editor-mode]')];
  const wordsEl = document.getElementById('editorWords');
  const minutesEl = document.getElementById('editorMinutes');
  const excerptBtn = document.getElementById('generateExcerpt');
  const excerptInput = document.querySelector('#postEditor [name="excerpt"]');
  const readInput = document.querySelector('#postEditor [name="readMinutes"]');
  if (!visual || !source || !preview) return null;

  let mode = 'visual';
  let savedRange = null;

  function currentHtml() {
    return mode === 'source' ? source.value : visual.innerHTML;
  }

  function updateStats() {
    const html = currentHtml();
    wordsEl && (wordsEl.textContent = plainText(html).replace(/\s/g, '').length.toLocaleString());
    if (readInput && !readInput.dataset.touched) readInput.value = estimateMinutes(html);
    minutesEl && (minutesEl.textContent = `${readInput?.value || 1} 分钟`);
  }

  function setHtml(html = '', { silent = false } = {}) {
    const clean = cleanHtml(html);
    visual.innerHTML = clean;
    source.value = clean;
    preview.innerHTML = clean;
    updateStats();
    if (!silent) onInput();
  }

  function getHtml() {
    return cleanHtml(currentHtml()).trim();
  }

  function setMode(next) {
    if (next === mode) return;
    if (mode !== 'source') source.value = cleanHtml(visual.innerHTML);
    else visual.innerHTML = cleanHtml(source.value);
    mode = next;
    visual.hidden = next !== 'visual';
    source.hidden = next !== 'source';
    preview.hidden = next !== 'preview';
    modeButtons.forEach((b) => b.classList.toggle('active', b.dataset.editorMode === next));
    if (next === 'preview') preview.innerHTML = cleanHtml(currentHtml());
    updateStats();
  }

  function saveRange() {
    const sel = window.getSelection();
    if (sel?.rangeCount && visual.contains(sel.anchorNode)) savedRange = sel.getRangeAt(0).cloneRange();
  }
  function restoreRange() {
    if (!savedRange) return;
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(savedRange);
  }
  function exec(cmd, value) {
    visual.focus();
    restoreRange();
    document.execCommand(cmd, false, value);
    saveRange();
    source.value = cleanHtml(visual.innerHTML);
    updateStats();
    onInput();
  }

  modeButtons.forEach((btn) => btn.addEventListener('click', () => setMode(btn.dataset.editorMode)));
  visual.addEventListener('input', () => { source.value = cleanHtml(visual.innerHTML); updateStats(); onInput(); });
  visual.addEventListener('mouseup', saveRange);
  visual.addEventListener('keyup', saveRange);
  source.addEventListener('input', () => { visual.innerHTML = cleanHtml(source.value); updateStats(); onInput(); });
  readInput?.addEventListener('input', () => { readInput.dataset.touched = '1'; updateStats(); onInput(); });

  toolbar?.addEventListener('mousedown', (e) => { if (e.target.closest('button')) e.preventDefault(); });
  toolbar?.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-cmd]');
    if (!btn) return;
    const cmd = btn.dataset.cmd;
    if (['bold', 'italic', 'underline', 'strikeThrough', 'insertUnorderedList', 'insertOrderedList'].includes(cmd)) {
      exec(cmd);
    } else if (cmd.startsWith('block:')) {
      exec('formatBlock', cmd.slice(6));
    } else if (cmd === 'link') {
      const url = prompt('链接地址（https://…）');
      if (url) exec('createLink', url);
    } else if (cmd === 'image') {
      const url = prompt('图片地址（https://…）');
      if (!url) return;
      const alt = prompt('图片说明（可选）') || '';
      exec('insertHTML', `<img src="${attr(url)}" alt="${attr(alt)}">`);
    } else if (cmd === 'code') {
      const code = prompt('粘贴代码');
      if (code) exec('insertHTML', `<pre><code>${attr(code)}</code></pre>`);
    } else if (cmd === 'hr') {
      exec('insertHTML', '<hr>');
    } else if (cmd === 'clear') {
      exec('removeFormat');
    }
  });

  excerptBtn?.addEventListener('click', () => {
    if (!excerptInput) return;
    const text = plainText(getHtml());
    excerptInput.value = text.length > 140 ? `${text.slice(0, 140)}…` : text;
    excerptInput.dispatchEvent(new Event('input', { bubbles: true }));
    onInput();
  });

  setHtml('', { silent: true });
  return { getHtml, setHtml, setMode, updateStats, get mode() { return mode; }, focus() { visual.focus(); } };
}
