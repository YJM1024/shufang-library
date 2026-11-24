// 高亮器自检：从书稿里取真实代码块，验证 token 输出无损、标签平衡、转义正确。
import fs from 'node:fs';
import path from 'node:path';
import { highlight, normalizeLanguage, languageLabel } from './highlight.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const BOOKS = path.join(ROOT, 'books');

function unescapeHtml(text) {
  return text
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function collectSamples() {
  const samples = new Map();
  const files = [];
  for (const dir of fs.readdirSync(BOOKS)) {
    const body = path.join(BOOKS, dir, 'body.md');
    if (fs.existsSync(body)) files.push(body);
  }
  for (const file of files) {
    const lines = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n').split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      const open = lines[i].trim().match(/^```\s*([A-Za-z0-9+#._-]*)\s*$/);
      if (!open) continue;
      const lang = normalizeLanguage(open[1]);
      const code = [];
      i += 1;
      while (i < lines.length && !/^```/.test(lines[i].trim())) {
        code.push(lines[i]);
        i += 1;
      }
      const list = samples.get(lang) || [];
      if (list.length < 4) list.push({ file: path.relative(ROOT, file), code: code.join('\n') });
      samples.set(lang, list);
    }
  }
  return samples;
}

let failures = 0;
let checked = 0;

for (const [lang, list] of collectSamples()) {
  for (const sample of list) {
    const html = highlight(sample.code, lang);
    checked += 1;
    const opens = (html.match(/<span class="tok-/g) || []).length;
    const closes = (html.match(/<\/span>/g) || []).length;
    const stripped = unescapeHtml(html);
    const problems = [];
    if (opens !== closes) problems.push(`span 不平衡 open=${opens} close=${closes}`);
    if (stripped !== sample.code) problems.push('还原后与源码不一致');
    if (/<(?!\/?span\b)/.test(html)) problems.push('存在未转义的原始标签');
    if (problems.length) {
      failures += 1;
      console.log(`FAIL ${lang} ${sample.file}`);
      for (const problem of problems) console.log(`  - ${problem}`);
      if (stripped !== sample.code) {
        let index = 0;
        while (index < sample.code.length && sample.code[index] === stripped[index]) index += 1;
        console.log(`  差异位置 ${index}: 源=${JSON.stringify(sample.code.slice(index, index + 40))} 还原=${JSON.stringify(stripped.slice(index, index + 40))}`);
      }
    }
  }
  const first = list[0];
  const html = highlight(first.code.split('\n').slice(0, 6).join('\n'), lang);
  console.log(`\n[${languageLabel(lang)}] ${first.file}`);
  console.log(html.split('\n').slice(0, 6).join('\n'));
}

console.log(`\n检查 ${checked} 个代码块，失败 ${failures} 个。`);
process.exitCode = failures ? 1 : 0;
