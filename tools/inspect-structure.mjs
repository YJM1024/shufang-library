import fs from 'node:fs';
import path from 'node:path';

const root = 'E:/dsh_home/workspaces/ai';
const ids = ['agent-arch', 'context-eng', 'memory', 'rag-interview', 'eval', 'a2a', 'agent-sys-design'];

for (const id of ids) {
  const dir = path.join(root, id);
  const j = JSON.parse(fs.readFileSync(path.join(dir, 'publish', 'book.json'), 'utf8'));
  const front = fs.readFileSync(path.join(dir, j.front), 'utf8');
  const frontH2 = [...front.matchAll(/^##\s+(.+)$/gm)].map((m) => m[1].trim());
  let totalQ = 0;
  const chapters = [];
  for (const file of j.chapters) {
    const raw = fs.readFileSync(path.join(dir, file), 'utf8');
    const chunk = raw.split(/^##\s+/m);
    const preamble = chunk[0].trim();
    const modules = chunk.slice(1).map((part) => {
      const nl = part.indexOf('\n');
      const title = nl === -1 ? part.trim() : part.slice(0, nl).trim();
      const body = nl === -1 ? '' : part.slice(nl + 1);
      const qs = [...body.matchAll(/^###\s+(Q\d+)/gm)].map((m) => m[1]);
      totalQ += qs.length;
      return { title, qs: qs.length, first: qs[0] || '', last: qs[qs.length - 1] || '' };
    });
    const preQ = [...preamble.matchAll(/^###\s+(Q\d+)/gm)].map((m) => m[1]);
    totalQ += preQ.length;
    chapters.push({ file, preambleQ: preQ, modules });
  }
  console.log(`\n### ${id} declared=${j.count} computed=${totalQ}`);
  console.log('front H2:', frontH2.join(' | '));
  for (const c of chapters) {
    console.log(` file ${c.file} preambleQ=[${c.preambleQ.join(',')}] modules=${c.modules.length}`);
    for (const m of c.modules) console.log(`   ${m.title}  q=${m.qs} ${m.first}..${m.last}`);
  }
}
