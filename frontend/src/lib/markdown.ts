// Minimal Markdown → HTML for the bundled user guide (headings, lists, tables, quotes, code, links, bold).
// Text is HTML-escaped first, so only the formatting below can produce markup.
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function inline(s) {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, text, href) => {
      const safe = /^(\/|https?:\/\/|#)/.test(href) ? href : '#';
      const ext = safe.startsWith('http');
      return `<a href="${safe}"${ext ? ' target="_blank" rel="noreferrer"' : ''}>${text}</a>`;
    });
}

export function slugify(s) {
  return s.toLowerCase().replace(/<[^>]+>/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function renderMarkdown(md) {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i += 1; continue; }
    if (line.startsWith('```')) {
      const buf = [];
      i += 1;
      while (i < lines.length && !lines[i].startsWith('```')) { buf.push(esc(lines[i])); i += 1; }
      i += 1;
      out.push(`<pre class="card" style="padding:12px 14px;overflow-x:auto;font-size:13px">${buf.join('\n')}</pre>`);
      continue;
    }
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    if (h) {
      const level = h[1].length;
      out.push(`<h${level} id="${slugify(h[2])}">${inline(h[2])}</h${level}>`);
      i += 1;
      continue;
    }
    if (line.startsWith('>')) {
      const buf = [];
      while (i < lines.length && lines[i].startsWith('>')) { buf.push(lines[i].replace(/^>\s?/, '')); i += 1; }
      const text = buf.join(' ');
      out.push(`<blockquote class="${text.startsWith('⚠') ? 'warn' : ''}"><p>${inline(text)}</p></blockquote>`);
      continue;
    }
    if (line.startsWith('|')) {
      const rows = [];
      while (i < lines.length && lines[i].startsWith('|')) { rows.push(lines[i]); i += 1; }
      const cells = (r) => r.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const [head, , ...body] = rows;
      out.push(`<div class="table-wrap"><table><thead><tr>${cells(head).map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${
        body.map((r) => `<tr>${cells(r).map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }
    const ol = /^\d+\.\s+/;
    const ul = /^[-*]\s+/;
    if (ol.test(line) || ul.test(line)) {
      const ordered = ol.test(line);
      const items = [];
      while (i < lines.length && (ol.test(lines[i]) || ul.test(lines[i]) || /^\s{2,}\S/.test(lines[i]))) {
        const l = lines[i];
        if (/^\s{2,}[-*]\s+/.test(l) && items.length) items[items.length - 1].sub.push(l.trim().replace(ul, ''));
        else if (/^\s{2,}\S/.test(l) && items.length) items[items.length - 1].text += ` ${l.trim()}`;
        else items.push({ text: l.replace(ordered ? ol : ul, ''), sub: [] });
        i += 1;
      }
      const tag = ordered ? 'ol' : 'ul';
      out.push(`<${tag}>${items.map((it) => `<li>${inline(it.text)}${it.sub.length ? `<ul>${it.sub.map((s) => `<li>${inline(s)}</li>`).join('')}</ul>` : ''}</li>`).join('')}</${tag}>`);
      continue;
    }
    const buf = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,3}\s|>|\||```|\d+\.\s|[-*]\s)/.test(lines[i])) { buf.push(lines[i]); i += 1; }
    out.push(`<p>${inline(buf.join(' '))}</p>`);
  }
  return out.join('\n');
}
