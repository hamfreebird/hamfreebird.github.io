// 文章编辑器：可视化 / Markdown / HTML 源码三模式 + 实时预览 + 格式工具栏
import { renderContent, markdownToHtml, looksLikeHtml } from './markdown.js';

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

// HTML → Markdown：用于打开既有 HTML 文章后切到 Markdown 模式继续编辑。
export function htmlToMarkdown(html = '') {
  const tpl = document.createElement('template');
  tpl.innerHTML = cleanHtml(html);
  const inline = (node) => {
    if (node.nodeType === 3) return node.nodeValue;
    if (node.nodeType !== 1) return '';
    const tag = node.tagName.toLowerCase();
    const kids = [...node.childNodes].map(inline).join('');
    if (tag === 'br') return '\n';
    if (tag === 'img') return `![${node.alt || ''}](${node.getAttribute('src') || ''})`;
    if (tag === 'a') return `[${kids}](${node.getAttribute('href') || ''})`;
    if (['strong', 'b'].includes(tag)) return `**${kids}**`;
    if (['em', 'i'].includes(tag)) return `*${kids}*`;
    if (['s', 'del', 'strike'].includes(tag)) return `~~${kids}~~`;
    if (tag === 'code') return `\`${kids}\``;
    return kids;
  };
  const block = (node) => {
    if (node.nodeType === 3) return node.nodeValue.trim();
    if (node.nodeType !== 1) return '';
    const tag = node.tagName.toLowerCase();
    if (tag === 'pre') {
      const code = node.querySelector('code') || node;
      return `\`\`\`\n${code.textContent}\n\`\`\``;
    }
    if (/^h[1-6]$/.test(tag)) return `${'#'.repeat(Number(tag[1]))} ${inline(node).trim()}`;
    if (tag === 'blockquote') {
      return [...node.childNodes].map(block).filter(Boolean).map((line) => `> ${line}`).join('\n');
    }
    if (tag === 'ul' || tag === 'ol') {
      return [...node.children].map((li, index) =>
        `${tag === 'ol' ? `${index + 1}.` : '-'} ${[...li.childNodes].map(block).filter(Boolean).join(' ')}`).join('\n');
    }
    if (tag === 'hr') return '---';
    if (tag === 'table') {
      const rows = [...node.querySelectorAll('tr')].map((tr) =>
        `| ${[...tr.children].map((cell) => (cell.textContent || '').trim()).join(' | ')} |`);
      if (rows.length > 1) {
        const columns = Math.max(1, rows[0].split('|').length - 2);
        rows.splice(1, 0, `| ${Array(columns).fill('---').join(' | ')} |`);
      }
      return rows.join('\n');
    }
    return [...node.childNodes].map(block).filter(Boolean).join('\n');
  };
  return [...tpl.content.childNodes].map(block).filter(Boolean).join('\n\n').trim();
}

export function initEditor({ onInput = () => {} } = {}) {
  const visual = document.getElementById('editorVisual');
  const markdown = document.getElementById('editorMarkdown');
  const source = document.getElementById('editorSource');
  const preview = document.getElementById('editorPreview');
  const toolbar = document.getElementById('editorToolbar');
  const modeButtons = [...document.querySelectorAll('[data-editor-mode]')];
  const wordsEl = document.getElementById('editorWords');
  const minutesEl = document.getElementById('editorMinutes');
  const excerptBtn = document.getElementById('generateExcerpt');
  const excerptInput = document.querySelector('#postEditor [name="excerpt"]');
  const readInput = document.querySelector('#postEditor [name="readMinutes"]');
  if (!visual || !markdown || !source || !preview) return null;

  let mode = 'visual';
  let savedRange = null;
  let current = { content: '', format: 'markdown' };

  function rendered() {
    return renderContent(current.content, current.format);
  }

  function updateStats() {
    const count = plainText(rendered()).replace(/\s/g, '').length;
    wordsEl && (wordsEl.textContent = count.toLocaleString());
    if (readInput && !readInput.dataset.touched) readInput.value = Math.max(1, Math.round(count / 320));
    minutesEl && (minutesEl.textContent = `${readInput?.value || 1} 分钟`);
  }

  function syncViews() {
    markdown.value = current.format === 'markdown' ? current.content : htmlToMarkdown(current.content);
    source.value = current.format === 'html' ? current.content : markdownToHtml(current.content);
    visual.innerHTML = cleanHtml(rendered());
    preview.innerHTML = cleanHtml(rendered());
  }

  function commit(content, format) {
    current = { content: String(content || ''), format };
    preview.innerHTML = cleanHtml(rendered());
    updateStats();
    onInput();
  }

  function setContent(content = '', format = '') {
    const fmt = ['markdown', 'html'].includes(format)
      ? format
      : (looksLikeHtml(content) ? 'html' : 'markdown');
    current = { content: String(content || ''), format: fmt };
    syncViews();
    updateStats();
  }

  function setHtml(html = '', options = {}) {
    setContent(html, 'html');
    if (!options.silent) onInput();
  }

  function getContent() {
    return { content: current.content.trim(), format: current.format };
  }

  function getHtml() {
    return cleanHtml(rendered()).trim();
  }

  function setMode(next) {
    if (next === mode) return;
    mode = next;
    syncViews();
    visual.hidden = next !== 'visual';
    markdown.hidden = next !== 'markdown';
    source.hidden = next !== 'source';
    preview.hidden = next !== 'preview';
    modeButtons.forEach((b) => b.classList.toggle('active', b.dataset.editorMode === next));
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
    commit(visual.innerHTML, 'html');
  }

  // 源码 / Markdown 模式下按光标位置插入语法。
  function insertIntoTextarea(text, selectInner = '') {
    const target = mode === 'markdown' ? markdown : source;
    const start = target.selectionStart ?? target.value.length;
    const end = target.selectionEnd ?? start;
    const chosen = target.value.slice(start, end);
    const body = chosen || selectInner;
    const hasSlot = text.includes('{}');
    const filled = hasSlot ? text.replace('{}', body) : text + chosen;
    target.value = target.value.slice(0, start) + filled + target.value.slice(end);
    const caret = start + (hasSlot ? text.indexOf('{}') + body.length : filled.length);
    target.focus();
    target.setSelectionRange(caret, caret);
    commit(target.value, mode === 'markdown' ? 'markdown' : 'html');
  }

  const mdSnippets = {
    'block:p': '\n\n', 'block:h2': '\n## ', 'block:h3': '\n### ',
    bold: '**{}**', italic: '*{}*', underline: '<u>{}</u>', strikeThrough: '~~{}~~',
    blockquote: '\n> {}', insertUnorderedList: '\n- {}', insertOrderedList: '\n1. {}',
    clear: '', hr: '\n\n---\n\n'
  };
  const htmlSnippets = {
    'block:p': '<p>{}</p>', 'block:h2': '<h2>{}</h2>', 'block:h3': '<h3>{}</h3>',
    bold: '<strong>{}</strong>', italic: '<em>{}</em>', underline: '<u>{}</u>',
    strikeThrough: '<del>{}</del>', blockquote: '<blockquote>{}</blockquote>',
    insertUnorderedList: '<ul><li>{}</li></ul>', insertOrderedList: '<ol><li>{}</li></ol>',
    clear: '', hr: '<hr>'
  };

  modeButtons.forEach((btn) => btn.addEventListener('click', () => setMode(btn.dataset.editorMode)));
  visual.addEventListener('input', () => commit(visual.innerHTML, 'html'));
  visual.addEventListener('mouseup', saveRange);
  visual.addEventListener('keyup', saveRange);
  markdown.addEventListener('input', () => commit(markdown.value, 'markdown'));
  source.addEventListener('input', () => commit(source.value, 'html'));
  readInput?.addEventListener('input', () => { readInput.dataset.touched = '1'; updateStats(); onInput(); });

  toolbar?.addEventListener('mousedown', (e) => { if (e.target.closest('button')) e.preventDefault(); });
  toolbar?.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-cmd]');
    if (!btn) return;
    const cmd = btn.dataset.cmd;

    if (cmd === 'link') {
      const url = prompt('链接地址（https://…）');
      if (!url) return;
      if (mode === 'visual') return exec('createLink', url);
      const label = mode === 'markdown' ? '[链接文字]' : '链接文字';
      return insertIntoTextarea(mode === 'markdown' ? `[${label}](${url})` : `<a href="${attr(url)}">${label}</a>`);
    }
    if (cmd === 'image') {
      const url = prompt('图片地址（https://…）');
      if (!url) return;
      if (mode === 'visual') {
        const alt = prompt('图片说明（可选）') || '';
        return exec('insertHTML', `<img src="${attr(url)}" alt="${attr(alt)}">`);
      }
      const alt = prompt('图片说明（可选）') || '';
      return insertIntoTextarea(mode === 'markdown' ? `![${alt}](${url})` : `<img src="${attr(url)}" alt="${attr(alt)}">`);
    }
    if (cmd === 'code') {
      const code = prompt('粘贴代码');
      if (!code) return;
      if (mode === 'visual') return exec('insertHTML', `<pre><code>${attr(code)}</code></pre>`);
      return insertIntoTextarea(mode === 'markdown' ? `\n\`\`\`\n${code}\n\`\`\`\n` : `<pre><code>${attr(code)}</code></pre>`);
    }
    if (cmd === 'clear') {
      if (mode === 'visual') return exec('removeFormat');
      return;
    }

    if (mode === 'visual') {
      if (['bold', 'italic', 'underline', 'strikeThrough', 'insertUnorderedList', 'insertOrderedList'].includes(cmd)) exec(cmd);
      else if (cmd.startsWith('block:')) exec('formatBlock', cmd.slice(6));
      return;
    }
    const snippets = mode === 'markdown' ? mdSnippets : htmlSnippets;
    if (snippets[cmd] !== undefined) insertIntoTextarea(snippets[cmd], '文字');
  });

  excerptBtn?.addEventListener('click', () => {
    if (!excerptInput) return;
    const text = plainText(rendered());
    excerptInput.value = text.length > 140 ? `${text.slice(0, 140)}…` : text;
    excerptInput.dispatchEvent(new Event('input', { bubbles: true }));
    onInput();
  });

  setContent('', 'markdown');
  setMode('markdown');
  return {
    getHtml, setHtml, getContent, setContent, setMode, updateStats,
    get mode() { return mode; },
    get format() { return current.format; },
    focus() { (mode === 'markdown' ? markdown : mode === 'source' ? source : visual).focus(); }
  };
}
