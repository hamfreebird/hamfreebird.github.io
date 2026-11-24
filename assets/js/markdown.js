// 零依赖 Markdown 渲染器：浏览器与 Node 共用，输出已转义的安全 HTML。
// 设计取舍：Markdown 中的原始 HTML 一律按文本显示，链接只允许安全协议，避免注入。

const escapeHtml = (value = '') => String(value).replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[c]);

function safeUrl(raw = '') {
  const url = String(raw).trim();
  if (!url) return '';
  if (/^(https?:|mailto:|tel:)/i.test(url) || /^(#|\/|\.\/|\.\.\/)/.test(url)) return url;
  return '';
}

function inline(text = '') {
  const codes = [];
  let out = escapeHtml(text);
  // 行内代码先占位，避免内部符号被后续规则改写。
  out = out.replace(/`([^`]+)`/g, (_, code) => {
    codes.push(`<code>${code}</code>`);
    return `\u0000${codes.length - 1}\u0000`;
  });
  out = out.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, (_, alt, url, title) => {
    const href = safeUrl(url);
    if (!href) return escapeHtml(alt || '');
    return `<img src="${escapeHtml(href)}" alt="${alt}"${title ? ` title="${title}"` : ''} loading="lazy">`;
  });
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, (_, label, url, title) => {
    const href = safeUrl(url);
    if (!href) return label;
    return `<a href="${escapeHtml(href)}"${title ? ` title="${title}"` : ''} rel="noopener noreferrer">${label}</a>`;
  });
  out = out.replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, (_, a, b) => `<strong>${a || b}</strong>`);
  out = out.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, (_, pre, body) => `${pre}<em>${body}</em>`);
  out = out.replace(/(^|[^_])_([^_\n]+)_(?!_)/g, (_, pre, body) => `${pre}<em>${body}</em>`);
  out = out.replace(/~~([^~]+)~~/g, (_, body) => `<del>${body}</del>`);
  out = out.replace(/\u0000(\d+)\u0000/g, (_, i) => codes[Number(i)] || '');
  return out;
}

const isBlockStart = (line = '') => /^\s*(#{1,6}\s|>|[-*+]\s|\d+[.)]\s|```|(-{3,}|\*{3,}|_{3,})\s*$|\|)/.test(line);

function tableRow(line = '') {
  return line.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim());
}

export function markdownToHtml(source = '') {
  const lines = String(source || '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i += 1; continue; }

    // 围栏代码块
    const fence = line.match(/^\s*```\s*([\w+-]*)\s*$/);
    if (fence) {
      const code = [];
      i += 1;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) { code.push(lines[i]); i += 1; }
      if (i < lines.length) i += 1;
      const cls = fence[1] ? ` class="language-${escapeHtml(fence[1])}"` : '';
      out.push(`<pre><code${cls}>${escapeHtml(code.join('\n'))}</code></pre>`);
      continue;
    }

    // 标题
    const heading = line.match(/^\s*(#{1,6})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      out.push(`<h${level}>${inline(heading[2].trim())}</h${level}>`);
      i += 1;
      continue;
    }

    // 分隔线
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      out.push('<hr>');
      i += 1;
      continue;
    }

    // 引用
    if (/^\s*>/.test(line)) {
      const quoted = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        quoted.push(lines[i].replace(/^\s*>\s?/, ''));
        i += 1;
      }
      out.push(`<blockquote>${markdownToHtml(quoted.join('\n'))}</blockquote>`);
      continue;
    }

    // 表格
    if (line.includes('|') && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1])) {
      const head = tableRow(line);
      const aligns = tableRow(lines[i + 1]).map((cell) =>
        /^:-+:$/.test(cell) ? 'center' : /^-+:$/.test(cell) ? 'right' : /^:-+$/.test(cell) ? 'left' : '');
      i += 2;
      const body = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
        body.push(tableRow(lines[i]));
        i += 1;
      }
      const th = head.map((cell, n) => `<th${aligns[n] ? ` style="text-align:${aligns[n]}"` : ''}>${inline(cell)}</th>`).join('');
      const tr = body.map((cells) => `<tr>${head.map((_, n) => `<td${aligns[n] ? ` style="text-align:${aligns[n]}"` : ''}>${inline(cells[n] || '')}</td>`).join('')}</tr>`).join('');
      out.push(`<table><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table>`);
      continue;
    }

    // 列表（支持任务列表与有序列表）
    const bullet = line.match(/^\s*[-*+]\s+(.+)$/);
    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (bullet || ordered) {
      const isOl = Boolean(ordered);
      const pattern = isOl ? /^\s*\d+[.)]\s+(.+)$/ : /^\s*[-*+]\s+(.+)$/;
      const items = [];
      while (i < lines.length && pattern.test(lines[i])) {
        let text = lines[i].match(pattern)[1];
        const task = text.match(/^\[([ xX])\]\s+(.*)$/);
        if (task) {
          text = `<input type="checkbox" disabled${task[1].toLowerCase() === 'x' ? ' checked' : ''}> ${inline(task[2])}`;
        } else {
          text = inline(text);
        }
        items.push(`<li>${text}</li>`);
        i += 1;
      }
      const tag = isOl ? 'ol' : 'ul';
      out.push(`<${tag}>${items.join('')}</${tag}>`);
      continue;
    }

    // 段落：连续普通行合并，用 <br> 保留换行。
    const para = [];
    while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i])) {
      para.push(lines[i].trim());
      i += 1;
    }
    if (para.length) out.push(`<p>${para.map(inline).join('<br>')}</p>`);
    else i += 1;
  }
  return out.join('\n');
}

const HTML_BLOCK = /<(p|div|h[1-6]|ul|ol|li|blockquote|pre|table|section|article|img|hr|br|span|a|strong|em|code)\b/i;

export function looksLikeHtml(content = '') {
  return HTML_BLOCK.test(String(content || ''));
}

// format 缺省时自动识别：历史数据中既有 HTML，也有新写的 Markdown。
export function renderContent(content = '', format = '') {
  const text = String(content || '');
  if (format === 'markdown') return markdownToHtml(text);
  if (format === 'html') return text;
  return looksLikeHtml(text) ? text : markdownToHtml(text);
}

export { escapeHtml, safeUrl };
