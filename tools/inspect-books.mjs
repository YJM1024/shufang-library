import fs from 'node:fs';
import path from 'node:path';

const root = 'E:/dsh_home/workspaces/ai';
const ids = ['agent-arch', 'context-eng', 'memory', 'rag-interview', 'eval', 'a2a', 'agent-sys-design'];

for (const id of ids) {
  const manifestPath = path.join(root, id, 'publish', 'book.json');
  const j = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const cover = j.cover ? path.join(root, id, j.cover) : '';
  const chapterFiles = (j.chapters || []).map((c) => path.join(root, id, c));
  const exists = chapterFiles.filter((f) => fs.existsSync(f)).length;
  console.log(JSON.stringify({
    id,
    title: j.title,
    subtitle: j.subtitle,
    count: j.count,
    chapters: (j.chapters || []).length,
    exists,
    front: j.front,
    frontExists: j.front ? fs.existsSync(path.join(root, id, j.front)) : false,
    leads: j.leads,
    leadsExists: j.leads ? fs.existsSync(path.join(root, id, j.leads)) : false,
    cover: j.cover || null,
    coverExists: cover ? fs.existsSync(cover) : false,
    accent: (j.theme && j.theme[0] && j.theme[0].main) || null,
    isbn: j.isbn,
    year: j.year,
    price: j.price,
    author: j.author,
    publisher: j.publisher,
    keys: Object.keys(j),
  }, null, 2));
}

console.log('=== a2a manifest keys and sample ===');
const a2a = JSON.parse(fs.readFileSync(path.join(root, 'a2a', 'publish', 'book.json'), 'utf8'));
const shallow = { ...a2a };
if (Array.isArray(shallow.theme)) shallow.theme = shallow.theme.slice(0, 2);
console.log(JSON.stringify(shallow, null, 2));
