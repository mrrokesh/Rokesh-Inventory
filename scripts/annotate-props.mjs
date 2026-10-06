import fs from 'node:fs';
import path from 'node:path';

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (/\.(tsx|ts)$/.test(e.name)) acc.push(p);
  }
  return acc;
}

function skipFile(file) {
  return /[\\/](api|auth|types|vite-env)\./.test(file);
}

function annotateDestructure(src) {
  const re = /((?:export\s+(?:default\s+)?)?function\s+[A-Za-z0-9_]+)\s*\(/g;
  let last = 0;
  let out = '';
  let m;
  while ((m = re.exec(src))) {
    const start = m.index + m[0].length;
    if (src[start] !== '{') continue;
    let i = start;
    let depth = 0;
    for (; i < src.length; i += 1) {
      const ch = src[i];
      if (ch === '{') depth += 1;
      else if (ch === '}') {
        depth -= 1;
        if (depth === 0) {
          i += 1;
          break;
        }
      }
    }
    const rest = src.slice(i);
    if (!/^\s*\)/.test(rest)) continue;
    if (/^\s*:\s*any/.test(rest) || src.slice(start, i).includes(': any')) continue;
    out += src.slice(last, i) + ': any';
    last = i;
  }
  return last ? out + src.slice(last) : src;
}

const root = process.argv[2];
let n = 0;
for (const file of walk(root)) {
  if (skipFile(file)) continue;
  const before = fs.readFileSync(file, 'utf8');
  const after = annotateDestructure(before);
  if (after !== before) {
    fs.writeFileSync(file, after);
    n += 1;
  }
}
console.log(`annotated ${n} files`);
